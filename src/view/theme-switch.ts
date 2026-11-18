// 颜色模式拨动开关（2026-11-18 新增，在“查看”菜单里）：三档 浅色 ☀ ｜ 跟随系统 ◐ ｜ 深色 ☾。
//
//   ╭──────────────╮
//   │ (☀)   ◐    ☾ │   旋钮停在哪一档就是哪个模式；轨道颜色、旋钮的样子跟着变：
//   ╰──────────────╯   太阳（暖色圆）→ 半明半暗 → 月牙（参考的拨动开关用内阴影做月牙）
//
// 跟随系统那一档（2026-11-18 用户反馈不明显后改）：旋钮的明暗和轨道反过来（暗的一半在白天那边、
// 亮的一半在夜晚那边，交错），旋钮里的分界是柔和的过渡（像月球的明暗分界线），轨道上的分界是清楚的直线。
// 平面风格：试过球面明暗、高光、S 形分界，用户觉得太拟物，改回平面。
//
// 操作：点轨道上的某一档直接切过去；按住旋钮（或轨道任意位置）左右拖，松手吸附到最近的一档；
// 键盘 ← → 切换（单选组）。拖动时旋钮跟手、没有过渡；松手后带回弹地滑到位。
import { t } from '../i18n';
import type { ThemePref } from '../theme';
import { el } from './dom';

export const THEME_STOPS: readonly ThemePref[] = ['light', 'system', 'dark'];
/** 相邻两档的间距（px），和 CSS 一致 */
export const STOP_PX = 27;
/** 移动超过这么多 px 才算拖动（否则是点击） */
const DRAG_SLOP = 3;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 轨道上淡淡的三个小图标 */
function glyph(kind: ThemePref): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 12 12');
  svg.setAttribute('width', '12');
  svg.setAttribute('height', '12');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('ts-glyph', `ts-glyph--${kind}`);
  const add = (tag: string, attrs: Record<string, string>) => {
    const n = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    svg.append(n);
  };
  if (kind === 'light') {
    add('circle', { cx: '6', cy: '6', r: '2.2', fill: 'currentColor' });
    add('path', {
      d: 'M6 .8v1.4M6 9.8v1.4M.8 6h1.4M9.8 6h1.4M2.3 2.3l1 1M8.7 8.7l1 1M2.3 9.7l1-1M8.7 3.3l1-1',
      stroke: 'currentColor', 'stroke-width': '1.1', 'stroke-linecap': 'round',
    });
  } else if (kind === 'system') {
    add('circle', { cx: '6', cy: '6', r: '4.4', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.1' });
    add('path', { d: 'M6 1.6a4.4 4.4 0 0 1 0 8.8Z', fill: 'currentColor' });
  } else {
    add('path', { d: 'M9.6 7.6A4.4 4.4 0 0 1 4.4 2.4a4.4 4.4 0 1 0 5.2 5.2Z', fill: 'currentColor' });
  }
  return svg;
}

/** 拖到 x（旋钮相对第一档的偏移，px）松手：吸附到最近的一档 */
export function stopAt(x: number): number {
  return Math.min(THEME_STOPS.length - 1, Math.max(0, Math.round(x / STOP_PX)));
}

export class ThemeSwitch {
  readonly root: HTMLElement;
  private knob: HTMLElement;
  private stops: HTMLButtonElement[];
  private pref: ThemePref = 'system';
  private drag: { id: number; x0: number; k0: number; moved: boolean } | null = null;

  constructor(private onChange: (p: ThemePref) => void) {
    // 旋钮的三种样子各一层，换档时交叉淡入淡出（背景图没法直接过渡）
    this.knob = el('span', { class: 'ts-knob', 'aria-hidden': 'true' }, THEME_STOPS.map((p) =>
      el('span', { class: `ts-face ts-face--${p}` }),
    ));
    this.stops = THEME_STOPS.map((p) => {
      const b = el('button', { type: 'button', class: 'ts-stop', role: 'radio', 'data-pref': p, tabindex: -1 });
      b.addEventListener('keydown', this.onKey);
      return b;
    });
    const track = el('span', { class: 'ts-track', 'aria-hidden': 'true' }, THEME_STOPS.map(glyph));
    this.root = el('div', { class: 'theme-switch', role: 'radiogroup' }, [track, this.knob, ...this.stops]);
    this.root.addEventListener('pointerdown', this.onDown);
    this.root.addEventListener('pointermove', this.onMove);
    this.root.addEventListener('pointerup', this.onUp);
    this.root.addEventListener('pointercancel', this.onCancel);
    this.relabel();
  }

  /** 当前选中的那一档（菜单的上下键导航用它） */
  get focusTarget(): HTMLButtonElement {
    return this.stops[THEME_STOPS.indexOf(this.pref)];
  }

  set(p: ThemePref): void {
    this.pref = p;
    this.root.dataset.pref = p;
    this.stops.forEach((b, i) => {
      const on = THEME_STOPS[i] === p;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
  }

  /** 换语言后刷新无障碍标签 */
  relabel(): void {
    this.root.setAttribute('aria-label', t('view.colorScheme'));
    this.stops.forEach((b, i) => {
      const name = t(`theme.${THEME_STOPS[i]}` as const);
      b.setAttribute('aria-label', name);
      b.title = name;
    });
  }

  private choose(i: number, focus: boolean): void {
    const p = THEME_STOPS[i];
    if (p !== this.pref) {
      this.set(p);
      this.onChange(p);
    }
    if (focus) this.stops[i].focus({ preventScroll: true });
  }

  private onKey = (e: KeyboardEvent): void => {
    const i = THEME_STOPS.indexOf(this.pref);
    let next = -1;
    if (e.key === 'ArrowLeft') next = Math.max(0, i - 1);
    else if (e.key === 'ArrowRight') next = Math.min(THEME_STOPS.length - 1, i + 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = THEME_STOPS.length - 1;
    if (next < 0) return;
    // ← → 在这里换档，不交给菜单（菜单里 ← 是关掉子菜单）
    e.preventDefault();
    e.stopPropagation();
    this.choose(next, true);
  };

  // ───────────── 拖动 / 点击 ─────────────

  /** 指针相对第一档旋钮位置的偏移（px） */
  private pointerX(e: PointerEvent): number {
    const r = this.root.getBoundingClientRect();
    // 第一档旋钮中心在左边 3 + 12 px 处
    return e.clientX - r.left - 15;
  }

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    try {
      this.root.setPointerCapture(e.pointerId);
    } catch {
      /* 忽略 */
    }
    this.drag = { id: e.pointerId, x0: e.clientX, k0: THEME_STOPS.indexOf(this.pref) * STOP_PX, moved: false };
  };

  private onMove = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x0;
    if (!d.moved && Math.abs(dx) < DRAG_SLOP) return;
    if (!d.moved) {
      d.moved = true;
      // 按在旋钮外面就拖：旋钮先跳到指针下面再跟手
      const px = this.pointerX(e) - dx;
      if (Math.abs(px - d.k0) > 12) d.k0 = Math.min(2 * STOP_PX, Math.max(0, px));
      this.root.classList.add('is-dragging');
    }
    const x = Math.min(2 * STOP_PX, Math.max(0, d.k0 + dx));
    this.knob.style.transform = `translateX(${x}px)`;
    // 拖过中点就预览那一档的样子（轨道颜色、旋钮形状）
    this.root.dataset.pref = THEME_STOPS[stopAt(x)];
  };

  private onUp = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    this.root.classList.remove('is-dragging');
    this.knob.style.transform = '';
    const i = d.moved
      ? stopAt(Math.min(2 * STOP_PX, Math.max(0, d.k0 + (e.clientX - d.x0))))
      : stopAt(this.pointerX(e));
    this.root.dataset.pref = this.pref;
    this.choose(i, true);
  };

  private onCancel = (): void => {
    this.drag = null;
    this.root.classList.remove('is-dragging');
    this.knob.style.transform = '';
    this.root.dataset.pref = this.pref;
  };
}
