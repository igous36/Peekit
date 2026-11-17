// 小工具：建节点 + 带缓存的样式写入。
// 每帧都会调用 set()，但只有值真的变了才写 DOM，静止的元素不会触发样式失效。

type Attrs = Record<string, string | number | boolean | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') node.className = String(v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) node.append(c);
  return node;
}

export function svgIcon(paths: string[], size: number): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  for (const d of paths) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

export const ICON_PENCIL = ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z'];
export const ICON_PREV = ['M15 18l-6-6 6-6'];
export const ICON_NEXT = ['M9 18l6-6-6-6'];
export const ICON_CHEVRON_DOWN = ['M6 9l6 6 6-6'];
export const ICON_CHECK = ['M5 12.5l4.5 4.5L19 7.5'];
export const ICON_TRASH = ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12', 'M9 7V4h6v3'];
export const ICON_PLUS = ['M12 5v14', 'M5 12h14'];
export const ICON_INFO = ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 11v5', 'M12 7.5h.01'];
export const ICON_COPY = ['M9 9h10v10H9z', 'M5 15V5h10'];
export const ICON_DOWNLOAD = ['M12 4v11', 'M7 10l5 5 5-5', 'M5 20h14'];
export const ICON_FOLDER = ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z'];
export const ICON_REMOVE = ['M5 12h14'];
export const ICON_PALETTE = [
  'M12 3a9 9 0 1 0 0 18c1.2 0 1.6-.9 1.6-1.6 0-.9-.6-1.3-.6-2.1 0-.9.7-1.4 1.6-1.4H17a4 4 0 0 0 4-4c0-4.9-4-8.9-9-8.9Z',
  'M7.5 11.5h.01',
  'M10 7.5h.01',
  'M14.5 7.5h.01',
];

/** 一个元素 + 上次写入的样式值 */
export class Styled<E extends HTMLElement = HTMLElement> {
  private last: Record<string, string> = {};
  private lastText: string | null = null;
  private lastAttr: Record<string, string> = {};

  constructor(public readonly el: E) {}

  /** prop 用 CSS 写法（kebab-case），例如 'box-shadow' */
  set(prop: string, value: string): void {
    if (this.last[prop] === value) return;
    this.last[prop] = value;
    this.el.style.setProperty(prop, value);
  }

  text(value: string): void {
    if (this.lastText === value) return;
    this.lastText = value;
    this.el.textContent = value;
  }

  attr(name: string, value: string): void {
    if (this.lastAttr[name] === value) return;
    this.lastAttr[name] = value;
    this.el.setAttribute(name, value);
  }
}
