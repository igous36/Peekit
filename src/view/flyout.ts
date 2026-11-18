// 级联子菜单（2026-11-18 新增）：左上角菜单的“查看 ›”、查看里的“界面语言 ›”。
// 像传统软件的菜单：悬停一小会儿（或点击、→ / 回车）在右边弹出；指针移开、移到别的项上一会儿后收起；
// 子菜单里 ↑ ↓ Home End 移动，← / Esc 收起回到上一级。右边放不下就弹到左边，下面放不下就往上挪。
//
// 子菜单挂在菜单根节点（.app-menu）里、和主面板并列（主面板会滚动和裁切，不能放在里面），
// 所以点子菜单不算“点外面”，菜单整体收起时子菜单也跟着收起（CSS 跟着 .app-menu.is-open）。
import { el } from './dom';

/** 悬停多久弹出 / 移开多久收起（ms） */
const OPEN_DELAY = 120;
const CLOSE_DELAY = 260;
const GAP = 4;
const EDGE = 8;

export class Flyout {
  readonly el: HTMLElement;
  private anchor: HTMLElement | null = null;
  private openTimer = 0;
  private closeTimer = 0;
  /** 打开时依次调用，用来关掉同级的其他子菜单 */
  onOpen: () => void = () => {};
  /** 下一级子菜单（悬停在下一级上时，这一级不收起） */
  child: Flyout | null = null;

  constructor(
    private host: HTMLElement,
    /** 每次打开 / 刷新时重建内容 */
    private build: () => Node[],
    private label: () => string,
  ) {
    this.el = el('div', { class: 'menu-panel menu-flyout', role: 'menu' });
    this.el.addEventListener('keydown', this.onKey);
    this.el.addEventListener('pointerenter', () => window.clearTimeout(this.closeTimer));
    this.el.addEventListener('pointerleave', () => this.scheduleClose());
    host.append(this.el);
  }

  get isOpen(): boolean {
    return this.el.classList.contains('is-shown');
  }

  /** 是否有指针悬停在这一级或更下一级上 */
  private hovered(): boolean {
    return this.el.matches(':hover') || !!this.anchor?.matches(':hover') || !!this.child?.hovered();
  }

  /** 绑定到菜单里的某一项（主面板每次重建后重新绑定）；已经打开着就跟到新位置、刷新内容 */
  attach(anchor: HTMLElement): void {
    this.anchor = anchor;
    anchor.setAttribute('aria-haspopup', 'menu');
    anchor.setAttribute('aria-expanded', String(this.isOpen));
    anchor.classList.toggle('is-active', this.isOpen);
    anchor.addEventListener('pointerenter', () => {
      window.clearTimeout(this.closeTimer);
      window.clearTimeout(this.openTimer);
      if (!this.isOpen) this.openTimer = window.setTimeout(() => this.open(false), OPEN_DELAY);
    });
    anchor.addEventListener('pointerleave', () => {
      window.clearTimeout(this.openTimer);
      this.scheduleClose();
    });
    anchor.addEventListener('click', () => {
      window.clearTimeout(this.openTimer);
      if (!this.isOpen) this.open(false);
    });
    anchor.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        this.open(true);
      }
    });
  }

  open(focusFirst: boolean): void {
    if (!this.anchor || !this.anchor.isConnected) return;
    window.clearTimeout(this.closeTimer);
    this.onOpen();
    if (!this.isOpen) {
      this.el.setAttribute('aria-label', this.label());
      this.el.replaceChildren(...this.build());
      this.el.classList.add('is-shown');
      this.anchor.setAttribute('aria-expanded', 'true');
      this.anchor.classList.add('is-active');
    }
    this.place();
    if (focusFirst) this.items()[0]?.focus({ preventScroll: true });
  }

  close(): void {
    window.clearTimeout(this.openTimer);
    window.clearTimeout(this.closeTimer);
    this.child?.close();
    if (!this.isOpen) return;
    // 焦点在子菜单里：交回给打开它的那一项
    const hadFocus = this.el.contains(document.activeElement);
    this.el.classList.remove('is-shown');
    this.anchor?.setAttribute('aria-expanded', 'false');
    this.anchor?.classList.remove('is-active');
    if (hadFocus) this.anchor?.focus({ preventScroll: true });
  }

  /**
   * 打开着就重建内容（换语言之后），保持打开，焦点留在原来那一项；下一级子菜单也跟着刷新。
   * 上一级重建后要先 attach 到新的那一项、放进页面，再调这个
   */
  refresh(): void {
    if (!this.isOpen) return;
    const focused = document.activeElement instanceof HTMLElement && this.el.contains(document.activeElement)
      ? this.items().indexOf(document.activeElement)
      : -1;
    this.el.setAttribute('aria-label', this.label());
    this.el.replaceChildren(...this.build());
    this.place();
    if (focused >= 0) this.items()[focused]?.focus({ preventScroll: true });
    this.child?.refresh();
  }

  items(): HTMLElement[] {
    return [...this.el.querySelectorAll<HTMLElement>('[role^="menuitem"], .ts-stop[aria-checked="true"]')];
  }

  private scheduleClose(): void {
    window.clearTimeout(this.closeTimer);
    this.closeTimer = window.setTimeout(() => {
      // 正在切换深浅色（整个界面交叉淡化，theme.ts）：悬停状态不准，等过渡完再看（2026-11-18，换模式时菜单不要自己关）
      if (document.documentElement.classList.contains('is-theme-fading')) {
        this.scheduleClose();
        return;
      }
      if (!this.hovered()) this.close();
    }, CLOSE_DELAY);
  }

  /** 摆在那一项的右边，和它顶部对齐；放不下就翻到左边 / 往上挪 */
  private place(): void {
    const a = this.anchor;
    if (!a) return;
    const panel = (a.closest('.menu-panel') as HTMLElement | null) ?? a;
    const hr = this.host.getBoundingClientRect();
    const ar = a.getBoundingClientRect();
    const pr = panel.getBoundingClientRect();
    const w = this.el.offsetWidth, h = this.el.offsetHeight;
    let left = pr.right + GAP;
    if (left + w > window.innerWidth - EDGE) left = Math.max(EDGE, pr.left - GAP - w);
    let top = ar.top - 6;
    top = Math.max(EDGE, Math.min(top, window.innerHeight - EDGE - h));
    this.el.style.left = `${Math.round(left - hr.left)}px`;
    this.el.style.top = `${Math.round(top - hr.top)}px`;
    this.child?.isOpen && this.child.place();
  }

  private onKey = (e: KeyboardEvent): void => {
    // 下一级子菜单里的按键自己处理
    if (this.child?.el.contains(e.target as Node)) return;
    const items = this.items();
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const d = e.key === 'ArrowDown' ? 1 : -1;
      items[(i + d + items.length) % items.length]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      items[e.key === 'Home' ? 0 : items.length - 1]?.focus();
    } else if (e.key === 'ArrowLeft' || e.key === 'Escape') {
      this.close();
      this.anchor?.focus({ preventScroll: true });
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  };
}
