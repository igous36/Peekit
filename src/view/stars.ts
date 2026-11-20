// 一排 5 颗星（2026-11-20）：信息卡上给作品打星，查看菜单里选筛选线，都用这一个组件。
//
// - 悬停预览：指针在第 n 颗上时前 n 颗亮起（亮色比真正选中的淡一点），离开恢复
// - 点第 n 颗：交给 onPick(n)，由调用方决定是设成 n 还是清除（见 engine/rating.ts 的 toggleRating）
// - 键盘：整排只占一个 Tab 位（当前那颗，没有就是第 1 颗）；←/→ 换焦点，回车 / 空格选中
import { MAX_RATING, clampRating } from '../engine/rating';
import { onLangChange } from '../i18n';
import { el, svgIcon, ICON_STAR } from './dom';

export interface StarRowOptions {
  /** 每颗星的读屏名字和悬停提示，n = 1–5 */
  label: (n: number) => string;
  onPick: (n: number) => void;
  /** 图标尺寸（px） */
  size?: number;
  cls?: string;
}

export class StarRow {
  readonly root: HTMLElement;
  private stars: HTMLButtonElement[] = [];
  private value = 0;
  private hover = 0;
  private tabbable = true;
  /** 键盘焦点在第几颗（0 = 不在这一排） */
  private focusN = 0;

  constructor(private opts: StarRowOptions) {
    this.root = el('div', { class: `stars ${opts.cls ?? ''}`.trim(), role: 'group' });
    for (let n = 1; n <= MAX_RATING; n++) {
      const b = el('button', { type: 'button', class: 'star', 'data-n': n, tabindex: -1 }, [svgIcon(ICON_STAR, opts.size ?? 16)]);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.opts.onPick(n);
      });
      b.addEventListener('pointerenter', () => this.preview(n));
      b.addEventListener('keydown', (e) => this.onKey(e, n));
      // 键盘移到哪颗，哪颗就是这一排的 Tab 位（离开这一排后回到当前星级那颗）
      b.addEventListener('focus', () => {
        this.focusN = n;
        this.paint();
      });
      this.stars.push(b);
      this.root.append(b);
    }
    this.root.addEventListener('pointerleave', () => this.preview(0));
    this.root.addEventListener('focusout', (e) => {
      if (this.root.contains(e.relatedTarget as Node | null)) return;
      this.focusN = 0;
      this.paint();
    });
    this.relabel();
    this.paint();
    // 整个应用里只建两排（信息卡、查看菜单），各自常驻，直接订阅语言切换
    onLangChange(() => this.relabel());
  }

  get rating(): number {
    return this.value;
  }

  set(v: number): void {
    const r = clampRating(v);
    if (r === this.value) return;
    this.value = r;
    this.paint();
  }

  /** 换了界面语言 */
  relabel(): void {
    this.stars.forEach((b, i) => {
      const s = this.opts.label(i + 1);
      b.setAttribute('aria-label', s);
      b.title = s;
    });
  }

  /** 让整排能 / 不能被 Tab 到（信息卡淡出时） */
  setTabbable(on: boolean): void {
    if (on === this.tabbable) return;
    this.tabbable = on;
    this.paint();
  }

  private preview(n: number): void {
    if (n === this.hover) return;
    this.hover = n;
    this.paint();
  }

  private paint(): void {
    const roving = this.focusN || Math.max(1, this.value);
    this.stars.forEach((b, i) => {
      const n = i + 1;
      b.classList.toggle('is-on', n <= this.value);
      b.classList.toggle('is-preview', this.hover > 0 && n <= this.hover && n > this.value);
      b.classList.toggle('is-dim', this.hover > 0 && n > this.hover && n <= this.value);
      b.setAttribute('aria-pressed', String(n <= this.value));
      b.tabIndex = this.tabbable && n === roving ? 0 : -1;
    });
  }

  private onKey(e: KeyboardEvent, n: number): void {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    // 方向键只在这一排里移动焦点，不要冒泡到舞台去切换作品
    e.preventDefault();
    e.stopPropagation();
    const to = Math.max(1, Math.min(MAX_RATING, n + step));
    this.stars[to - 1].focus();
  }
}
