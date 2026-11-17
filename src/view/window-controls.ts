// 右上角的窗口按钮：最小化、最大化 / 还原、关闭。
// 无边框窗口（decorations: false）没有系统按钮，这里自己画。
// 只在 Tauri 里显示；浏览器里调试布局时可以加 ?window-controls 强制显示（按钮不起作用）。
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { applyI18n, type MessageKey } from '../i18n';
import { el, svgIcon } from './dom';

const ICON_MINIMIZE = ['M5 12h14'];
const ICON_MAXIMIZE = ['M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z'];
const ICON_RESTORE = [
  'M9 9V6.5A1.5 1.5 0 0 1 10.5 5h7A1.5 1.5 0 0 1 19 6.5v7a1.5 1.5 0 0 1-1.5 1.5H15',
  'M6.5 9h7A1.5 1.5 0 0 1 15 10.5v7a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 5 17.5v-7A1.5 1.5 0 0 1 6.5 9z',
];
const ICON_CLOSE = ['M6 6l12 12', 'M18 6L6 18'];

export class WindowControls {
  readonly root: HTMLElement;
  private maxBtn: HTMLButtonElement;
  private maximized = false;
  private fullscreen = false;

  /** exitFullscreen：全屏时中间那个按钮变成“退出全屏” */
  constructor(private exitFullscreen: () => void = () => {}) {
    const min = this.button('window.minimize', ICON_MINIMIZE);
    this.maxBtn = this.button('window.maximize', ICON_MAXIMIZE);
    const close = this.button('window.close', ICON_CLOSE, 'win-btn--close');
    this.root = el('div', { class: 'window-controls', role: 'group', 'data-i18n-aria': 'window.group' }, [
      min, this.maxBtn, close,
    ]);

    const inTauri = isTauri();
    const forced = import.meta.env.DEV && new URLSearchParams(location.search).has('window-controls');
    if (!inTauri && !forced) {
      this.root.hidden = true;
      return;
    }
    if (!inTauri) return;

    const win = getCurrentWindow();
    min.addEventListener('click', () => void win.minimize());
    this.maxBtn.addEventListener('click', () => {
      if (this.fullscreen) this.exitFullscreen();
      else void win.toggleMaximize();
    });
    close.addEventListener('click', () => void win.close());

    // 双击拖动区、系统快捷键（Win+↑）等也会改变最大化状态，所以跟着 resize 事件同步图标
    const sync = async () => this.setMaximized(await win.isMaximized());
    void sync();
    void win.onResized(() => void sync());
  }

  private button(key: MessageKey, icon: string[], extra = ''): HTMLButtonElement {
    return el(
      'button',
      { type: 'button', class: `win-btn ${extra}`.trim(), 'data-i18n-aria': key, 'data-i18n-title': key },
      [svgIcon(icon, 16)],
    );
  }

  private setMaximized(on: boolean): void {
    if (on === this.maximized) return;
    this.maximized = on;
    this.syncMaxButton();
  }

  /** 进入 / 退出全屏时调用 */
  setFullscreen(on: boolean): void {
    if (on === this.fullscreen) return;
    this.fullscreen = on;
    this.syncMaxButton();
  }

  private syncMaxButton(): void {
    const key: MessageKey = this.fullscreen ? 'window.exitFullscreen' : this.maximized ? 'window.restore' : 'window.maximize';
    this.maxBtn.dataset.i18nAria = key;
    this.maxBtn.dataset.i18nTitle = key;
    applyI18n(this.root);
    this.maxBtn.replaceChildren(svgIcon(this.fullscreen || this.maximized ? ICON_RESTORE : ICON_MAXIMIZE, 16));
  }
}
