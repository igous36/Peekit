// 浮层卡片的公共行为（2026-11-17 新增，“修改颜色 / 修改名称”用）：
// 出现在右键的位置附近（放不下就往左 / 往上翻，贴着窗口边留 12px），从那一角弹出来；
// 点外面、Esc、窗口缩放 = 取消（dismiss）；Tab 只在卡片里转；关掉后焦点回到打开前的位置。
import { el } from './dom';

const EDGE = 12;
const CLOSE_MS = 160;

export class Popover {
  readonly root: HTMLElement;
  private open = false;
  private returnFocus: HTMLElement | null = null;
  private hideTimer = 0;
  /** 取消（点外面、Esc、缩放窗口）时调用 */
  onDismiss: () => void = () => {};

  constructor(className: string, children: Node[]) {
    this.root = el('div', { class: `popover ${className}`, role: 'dialog', hidden: true }, children);
    this.root.addEventListener('keydown', (e) => this.onKey(e));
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (this.open && !this.root.contains(e.target as Node)) this.dismiss();
      },
      true,
    );
    window.addEventListener('resize', () => this.dismiss());
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** 在 (x, y) 附近打开；label 给读屏软件；focus 是打开后先聚焦的元素 */
  show(x: number, y: number, label: string, focus?: HTMLElement): void {
    window.clearTimeout(this.hideTimer);
    if (!this.open) this.returnFocus = document.activeElement as HTMLElement | null;
    this.root.setAttribute('aria-label', label);
    this.root.hidden = false;
    this.root.classList.remove('is-open');
    this.root.style.left = '0px';
    this.root.style.top = '0px';
    const r = this.root.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = x + r.width + EDGE > vw ? x - r.width : x;
    let top = y + r.height + EDGE > vh ? y - r.height : y;
    left = Math.max(EDGE, Math.min(vw - r.width - EDGE, left));
    top = Math.max(EDGE, Math.min(vh - r.height - EDGE, top));
    this.root.style.left = `${Math.round(left)}px`;
    this.root.style.top = `${Math.round(top)}px`;
    // 从指针所在的那一角弹出来
    const ox = Math.max(0, Math.min(r.width, x - left));
    const oy = Math.max(0, Math.min(r.height, y - top));
    this.root.style.transformOrigin = `${Math.round(ox)}px ${Math.round(oy)}px`;
    void this.root.offsetWidth;
    this.root.classList.add('is-open');
    this.open = true;
    (focus ?? this.focusables()[0])?.focus({ preventScroll: true });
  }

  /** 关掉（不调用 onDismiss；确认 / 取消由使用方先处理好） */
  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.root.classList.remove('is-open');
    this.hideTimer = window.setTimeout(() => (this.root.hidden = true), CLOSE_MS);
    const back = this.returnFocus;
    this.returnFocus = null;
    if (back && document.contains(back)) back.focus({ preventScroll: true });
  }

  dismiss(): void {
    if (!this.open) return;
    this.onDismiss();
    this.hide();
  }

  private focusables(): HTMLElement[] {
    return [...this.root.querySelectorAll<HTMLElement>('button:not([disabled]), input, [tabindex="0"]')].filter(
      (x) => !x.closest('[hidden]'),
    );
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      // 输入法组字时的 Esc 是取消组字
      if (e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      e.stopPropagation();
      this.dismiss();
    } else if (e.key === 'Tab') {
      const f = this.focusables();
      if (!f.length) return;
      const i = f.indexOf(document.activeElement as HTMLElement);
      e.preventDefault();
      f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length]?.focus();
    }
  }
}
