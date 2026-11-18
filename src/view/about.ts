// “关于 Peekit”对话框（2026-11-17 新增，参考传统桌面软件的关于窗口）：
//
//   关于 Peekit                                ✕
//   [图标]  Peekit 0.1.0 x64
//           by igous36
//           基于 GPL-3.0 开源
//           已是最新版本 · 检查更新        ← 2026-11-18 自动更新：状态 + 一个文字按钮（检查 / 更新 / 重试）
//                       [访问 GitHub 仓库]  [关闭]
//
// 模态：半透明遮罩盖住应用，Tab 只在对话框里转，Esc / 点遮罩 / 关闭按钮关掉，焦点回到打开前的位置。
import iconUrl from '../../src-tauri/icons/128x128.png';
import { t } from '../i18n';
import type { UpdateState } from '../updater';
import { aboutUpdateLine } from './update-labels';
import { el, svgIcon } from './dom';

export const REPO_URL = 'https://github.com/igous36/Peekit';
export const AUTHOR = 'igous36';

const ICON_CLOSE = ['M6 6l12 12', 'M18 6L6 18'];
const ICON_GITHUB_ARROW = ['M7 17L17 7', 'M8 7h9v9'];

/** WebView2 的 UA 里带着系统架构 */
export function archLabel(ua: string = navigator.userAgent): string {
  if (/arm64|aarch64/i.test(ua)) return 'ARM64';
  if (/Win64|x64|WOW64|x86_64|amd64/i.test(ua)) return 'x64';
  return '';
}

export interface AboutHandlers {
  version: () => Promise<string>;
  openRepo: () => void;
  /** 手动检查更新 */
  checkUpdate: () => void;
  /** 下载并安装新版本 */
  installUpdate: () => void;
}


export class AboutDialog {
  readonly root: HTMLElement;
  private dialog: HTMLElement;
  private versionEl: HTMLElement;
  private updateStatus: HTMLElement;
  private updateBtn: HTMLButtonElement;
  private update: UpdateState = { kind: 'idle' };
  private returnFocus: HTMLElement | null = null;
  private closeTimer = 0;

  constructor(private handlers: AboutHandlers) {
    const close = el('button', { type: 'button', class: 'icon-btn about-x', 'data-i18n-aria': 'about.close' }, [
      svgIcon(ICON_CLOSE, 16),
    ]);
    close.addEventListener('click', () => this.close());
    this.versionEl = el('p', { class: 'about-name' }, ['Peekit']);
    this.updateStatus = el('span', { class: 'about-update-status', role: 'status', 'aria-live': 'polite' });
    this.updateBtn = el('button', { type: 'button', class: 'about-link' });
    this.updateBtn.addEventListener('click', () => {
      const a = aboutUpdateLine(this.update).action;
      if (a === 'check') this.handlers.checkUpdate();
      else if (a === 'install') this.handlers.installUpdate();
    });
    const github = el('button', { type: 'button', class: 'about-btn' }, [
      el('span', { 'data-i18n': 'about.github' }),
      svgIcon(ICON_GITHUB_ARROW, 14),
    ]);
    github.title = REPO_URL;
    github.addEventListener('click', () => this.handlers.openRepo());
    const ok = el('button', { type: 'button', class: 'about-btn about-btn--primary', 'data-i18n': 'about.close' });
    ok.addEventListener('click', () => this.close());

    this.dialog = el('div', {
      class: 'about-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'about-title',
    }, [
      el('div', { class: 'about-head' }, [el('h2', { id: 'about-title', class: 'about-title', 'data-i18n': 'about.title' }), close]),
      el('div', { class: 'about-body' }, [
        el('img', { class: 'about-icon', src: iconUrl, alt: '', width: 64, height: 64, draggable: 'false' }),
        el('div', { class: 'about-text' }, [
          this.versionEl,
          el('p', { class: 'about-by' }, [t('about.by', { author: AUTHOR })]),
          el('p', { class: 'about-license', 'data-i18n': 'about.license' }),
          el('p', { class: 'about-update' }, [this.updateStatus, this.updateBtn]),
        ]),
      ]),
      el('div', { class: 'about-actions' }, [github, ok]),
    ]);
    this.root = el('div', { class: 'about-scrim', hidden: true }, [this.dialog]);
    // 点遮罩（对话框外面）关掉
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.close();
    });
    this.root.addEventListener('keydown', (e) => this.onKey(e));
  }

  /** 自动更新的状态变了（app 订阅 Updater 后传进来）；语言切换后打开时也会重画 */
  setUpdate(s: UpdateState): void {
    this.update = s;
    const line = aboutUpdateLine(s);
    this.updateStatus.textContent = line.status;
    this.updateStatus.title = s.kind === 'failed' ? s.msg : '';
    // 按钮消失前如果有焦点，挪到“关闭”上，免得焦点掉到 body
    if (!line.action && document.activeElement === this.updateBtn) { const f = this.focusables(); f[f.length - 1]?.focus({ preventScroll: true }); }
    this.updateBtn.hidden = !line.action;
    this.updateBtn.textContent = line.label;
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  async open(): Promise<void> {
    window.clearTimeout(this.closeTimer);
    this.returnFocus = document.activeElement as HTMLElement | null;
    this.root.hidden = false;
    void this.root.offsetWidth;
    this.root.classList.add('is-open');
    this.focusables()[this.focusables().length - 1]?.focus({ preventScroll: true });
    this.setUpdate(this.update);
    const v = await this.handlers.version().catch(() => '');
    const arch = archLabel();
    this.versionEl.textContent = ['Peekit', v, arch].filter(Boolean).join(' ');
  }

  close(): void {
    if (!this.isOpen) return;
    this.root.classList.remove('is-open');
    // 等淡出结束再隐藏
    this.closeTimer = window.setTimeout(() => (this.root.hidden = true), 160);
    const back = this.returnFocus;
    this.returnFocus = null;
    if (back && document.contains(back)) back.focus({ preventScroll: true });
  }

  private focusables(): HTMLElement[] {
    return [...this.dialog.querySelectorAll<HTMLElement>('button')].filter((b) => !b.hidden);
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    } else if (e.key === 'Tab') {
      // 焦点只在对话框里转
      const f = this.focusables();
      const i = f.indexOf(document.activeElement as HTMLElement);
      e.preventDefault();
      f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length]?.focus();
    }
  }
}
