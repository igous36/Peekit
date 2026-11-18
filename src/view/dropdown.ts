// 下拉面板的公共行为：开 / 关、点外面收起、Esc、↑ ↓ Home End 在菜单项之间移动。
// 左上角菜单和预览集切换器共用；同一时间只开一个。
const all = new Set<Dropdown>();

/** 在右键菜单里（右键菜单单独挂在界面最外层，不在下拉面板里） */
const inCtxMenu = (t: EventTarget | null): boolean => t instanceof Element && !!t.closest('.ctx-menu');

export class Dropdown {
  isOpen = false;

  constructor(
    readonly root: HTMLElement,
    readonly button: HTMLButtonElement,
    readonly panel: HTMLElement,
    /** 打开前调用：重建面板内容 */
    private beforeOpen: () => void = () => {},
  ) {
    all.add(this);
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    button.addEventListener('click', () => (this.isOpen ? this.close(false) : this.show(false)));
    button.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.show(true);
      }
    });
    panel.addEventListener('keydown', (e) => this.onKey(e));
    // 点面板外面收起（捕获阶段，赶在舞台的拖动之前）
    document.addEventListener(
      'pointerdown',
      (e) => {
        // 右键菜单（比如右键预览集）里的点击不算点外面（2026-11-18）
        if (this.isOpen && !this.root.contains(e.target as Node) && !inCtxMenu(e.target)) this.close(false);
      },
      true,
    );
    root.addEventListener('focusout', (e) => {
      if (this.isOpen && e.relatedTarget && !this.root.contains(e.relatedTarget as Node) && !inCtxMenu(e.relatedTarget)) {
        this.close(false);
      }
    });
  }

  items(): HTMLElement[] {
    // 过渡中的旧内容（.menu-ghost，inert）、禁用的项（比如变灰的偏好设置）不算
    return [...this.panel.querySelectorAll<HTMLElement>('[role^="menuitem"], .menu-input')].filter(
      (x) => !x.closest('[hidden], [inert]') && !(x as HTMLButtonElement).disabled && x.getAttribute('aria-disabled') !== 'true',
    );
  }

  show(focusFirst: boolean): void {
    for (const d of all) if (d !== this) d.close(false);
    this.beforeOpen();
    this.isOpen = true;
    this.root.classList.add('is-open');
    this.button.setAttribute('aria-expanded', 'true');
    if (focusFirst) this.items()[0]?.focus();
  }

  close(restoreFocus: boolean): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.remove('is-open');
    this.button.setAttribute('aria-expanded', 'false');
    if (restoreFocus || this.root.contains(document.activeElement)) this.button.focus({ preventScroll: true });
  }

  /** 内容重建后把焦点放回某一项（或第一项） */
  focusItem(match?: (el: HTMLElement) => boolean): void {
    const items = this.items();
    (items.find((x) => (match ? match(x) : false)) ?? items[0])?.focus();
  }

  private onKey(e: KeyboardEvent): void {
    // 输入框里的按键（改名）自己处理
    if (e.target instanceof HTMLInputElement) return;
    const items = this.items();
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.close(true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      items[(i + d + items.length) % items.length]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      items[e.key === 'Home' ? 0 : items.length - 1]?.focus();
    }
  }
}
