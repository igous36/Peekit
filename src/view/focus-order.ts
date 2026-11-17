// HANDOFF §9 的焦点顺序：系列缩略图要排在时间轴“下一幅”之后。
// 缩略图必须放在舞台的镜头容器里才能跟着缩放，DOM 顺序排在信息卡前面，
// 所以缩略图可见时接管 Tab / Shift+Tab，把它们挪到时间轴后面；不可见时完全走浏览器默认顺序。

const FOCUSABLE = 'button, input, select, textarea, [tabindex]';

function tabbables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) =>
      el.tabIndex >= 0 &&
      !(el as HTMLButtonElement).disabled &&
      el.getClientRects().length > 0 &&
      getComputedStyle(el).visibility !== 'hidden',
  );
}

export interface FocusOrderOptions {
  /** 当前可 Tab 的缩略图 */
  thumbs: () => HTMLElement[];
  /** 缩略图排在这个元素之后（时间轴“下一幅”） */
  after: HTMLElement;
}

export function installFocusOrder(root: HTMLElement, opts: FocusOrderOptions): void {
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return;
    const thumbs = opts.thumbs();
    if (thumbs.length === 0) return;
    const set = new Set(thumbs);
    const order = tabbables(root).filter((el) => !set.has(el));
    const k = order.indexOf(opts.after);
    if (k < 0) return;
    order.splice(k + 1, 0, ...thumbs);
    const i = order.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const j = i + (e.shiftKey ? -1 : 1);
    // 走出两端时交给浏览器（离开页面 / 回到开头）
    if (j < 0 || j >= order.length) return;
    e.preventDefault();
    order[j].focus();
  });
}
