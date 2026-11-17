// 右键菜单（2026-11-17 新增）：右键作品 / 系列时弹出，和左上角菜单同一套样式（.menu-item），跟随深浅色，
// 全屏时用深色。系统自带的右键菜单（另存为、复制图像等）不再出现，这些功能在这里重做（作用于原图）。
//
// 行为：出现在指针位置（放不下就往左 / 往上翻），点外面、Esc、Tab、滚轮、窗口失焦或缩放都会关掉；
// ↑ ↓ Home End 在项之间移动；关掉后焦点回到打开前的位置。全局只有一个实例。
import { el, svgIcon } from './dom';

export interface CtxAction {
  label: string;
  icon?: string[];
  /** 危险操作（移除、删除）：文字用强调样式 */
  danger?: boolean;
  disabled?: boolean;
  run: () => void;
}

/** 'divider' = 分隔线；{ caption } = 顶部的小标题（作品名 / 系列名） */
export type CtxItem = CtxAction | 'divider' | { caption: string };

const MARGIN = 8;

/** 右键 / 菜单键 / Shift+F10 打开菜单的位置：键盘触发时坐标是 0，用元素的位置 */
export function menuPoint(e: MouseEvent, fallback: Element): { x: number; y: number } {
  if (e.clientX || e.clientY) return { x: e.clientX, y: e.clientY };
  const r = fallback.getBoundingClientRect();
  return { x: r.left + Math.min(24, r.width / 2), y: r.bottom };
}

export class ContextMenu {
  readonly root: HTMLElement;
  private open = false;
  private returnFocus: HTMLElement | null = null;

  constructor() {
    this.root = el('div', { class: 'ctx-menu menu-panel', role: 'menu', hidden: true });
    this.root.addEventListener('keydown', (e) => this.onKey(e));
    // 点外面关掉（捕获阶段；右键别处会先关掉这个，再由那边打开新的）
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (this.open && !this.root.contains(e.target as Node)) this.close(false);
      },
      true,
    );
    window.addEventListener('blur', () => this.close(false));
    window.addEventListener('resize', () => this.close(false));
    document.addEventListener('wheel', () => this.close(false), { capture: true, passive: true });
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** 在 (x, y) 打开；label 给读屏软件用 */
  show(items: CtxItem[], x: number, y: number, label: string): void {
    const nodes: HTMLElement[] = [];
    for (const it of items) {
      if (it === 'divider') nodes.push(el('div', { class: 'menu-divider', role: 'separator' }));
      else if ('caption' in it) nodes.push(el('div', { class: 'menu-caption ctx-caption', 'aria-hidden': 'true', title: it.caption }, [it.caption]));
      else nodes.push(this.item(it));
    }
    // 开头 / 结尾 / 连续的分隔线去掉（有的项按条件隐藏后会出现）
    const cleaned = nodes.filter((n, i, arr) => {
      if (!n.classList.contains('menu-divider')) return true;
      const prev = arr.slice(0, i).reverse().find((x) => !x.classList.contains('ctx-caption'));
      const next = arr[i + 1];
      return !!prev && !prev.classList.contains('menu-divider') && !!next;
    });
    if (!cleaned.some((n) => n.getAttribute('role') === 'menuitem')) return;

    this.returnFocus = this.open ? this.returnFocus : (document.activeElement as HTMLElement | null);
    this.root.replaceChildren(...cleaned);
    this.root.setAttribute('aria-label', label);
    this.root.hidden = false;
    this.root.classList.remove('is-shown');
    // 先放到 (0, 0) 量尺寸，再按窗口边界摆好
    this.root.style.left = '0px';
    this.root.style.top = '0px';
    const r = this.root.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const left = x + r.width + MARGIN > vw ? Math.max(MARGIN, x - r.width) : x;
    const top = y + r.height + MARGIN > vh ? Math.max(MARGIN, y - r.height) : y;
    this.root.style.left = `${Math.round(left)}px`;
    this.root.style.top = `${Math.round(top)}px`;
    // 从指针那一角长出来
    this.root.style.transformOrigin = `${left < x ? '100%' : '0'} ${top < y ? '100%' : '0'}`;
    void this.root.offsetWidth;
    this.root.classList.add('is-shown');
    this.open = true;
    this.items()[0]?.focus({ preventScroll: true });
  }

  close(restoreFocus = true): void {
    if (!this.open) return;
    this.open = false;
    this.root.classList.remove('is-shown');
    this.root.hidden = true;
    this.root.replaceChildren();
    const back = this.returnFocus;
    this.returnFocus = null;
    if (restoreFocus && back && document.contains(back)) back.focus({ preventScroll: true });
  }

  private item(a: CtxAction): HTMLElement {
    const children: Node[] = [el('span', { class: 'menu-lead' }, a.icon ? [svgIcon(a.icon, 16)] : [])];
    children.push(el('span', { class: 'menu-label' }, [a.label]));
    const b = el('button', {
      type: 'button',
      class: `menu-item${a.danger ? ' menu-item--danger' : ''}`,
      role: 'menuitem',
    }, children);
    if (a.disabled) {
      b.disabled = true;
      b.setAttribute('aria-disabled', 'true');
    }
    b.addEventListener('click', () => {
      this.close(true);
      a.run();
    });
    return b;
  }

  private items(): HTMLElement[] {
    return [...this.root.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')];
  }

  private onKey(e: KeyboardEvent): void {
    const items = this.items();
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape' || e.key === 'Tab') {
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
