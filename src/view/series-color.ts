// “修改颜色”调色器（2026-11-17 新增，右键系列 → 修改颜色）：
//
//   系列颜色  ● 夏日
//        ╭── 色相环 ──╮       拖旋钮（或在环上点）选色相，圆盘实时预览
//        │  ( 圆盘 )  │       点预设色：颜色从那个方向“倒进”圆盘，旋钮带回弹转过去
//        ╰────────────╯
//          #C27F4B            可以直接输入色值
//   浓淡 ━━━━━●━━━━━          只在低饱和范围里取（12–60%），明暗 36–72%，和现有系列色一个调子
//   明暗 ━━━━●━━━━━━
//   预设色
//   ● ● ● ● ● ●              选中圈带回弹地滑到选中的那个
//   ● ● ● ● ● ●
//               [取消] [完成]
//
// 打开时色相环转着展开、预设色依次弹出。拖动时整个界面里这个系列的圆点实时变色（preview），
// 点“完成”才保存；取消 / Esc / 点外面恢复原来的颜色。减少动态效果时去掉这些动画。
//
// 全范围模式（2026-11-21，按颜色筛选的“任意颜色”）：同一个样子，但两条滑条是 HSV 的饱和度和明度，
// 都能拉到 0 和 100（纯灰 / 最鲜艳、纯黑 / 最亮），色相环画得鲜艳一些；没有色值输入；预设色是 11 个色系。
import { t, type MessageKey } from '../i18n';
import { seriesPresets } from '../tokens';
import {
  MUTED, angleFromPoint, clampMuted, hexToHsl, hexToHsv, hslToHex, hsvToHex, nearestAngle, normalizeHex, ringGradient,
} from '../engine/color';
import { COLOR_FAMILIES } from '../engine/swatches';
import { el } from './dom';
import { Popover } from './popover';

/** 色相环的粗细（px），和 CSS 一致 */
const RING = 18;
/** 全范围模式下色相环的浓淡 */
const FULL_RING_TONE = { s: 78, l: 56 };
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

export interface ColorPickerHandlers {
  /** 颜色变了（拖动中也会调）：实时预览 */
  preview: (hex: string) => void;
  commit: (hex: string) => void;
  cancel: () => void;
}

export interface ColorPickerOptions {
  /** muted：系列色（HSL，只在低饱和、中等明暗里取，带色值输入）；full：任意颜色（HSV 全范围，没有色值输入） */
  range?: 'muted' | 'full';
  /** 标题（默认“系列颜色”） */
  title?: MessageKey;
}

interface Preset {
  hex: string;
  label: MessageKey;
}

const MUTED_PRESETS: readonly Preset[] = seriesPresets.map((p) => ({ hex: p.hex, label: `color.${p.key}` as MessageKey }));
const FULL_PRESETS: readonly Preset[] = COLOR_FAMILIES.map((f) => ({ hex: f.hex, label: `colorf.${f.key}` as MessageKey }));

type Source = 'init' | 'ring' | 'slider' | 'hex' | 'preset';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export class ColorPicker {
  readonly root: HTMLElement;
  private pop: Popover;
  private headDot: HTMLElement;
  private nameEl: HTMLElement;
  private wheel: HTMLElement;
  private arm: HTMLElement;
  private knob: HTMLElement;
  private disc: HTMLElement;
  private ink: HTMLElement;
  private hexInput: HTMLInputElement;
  private sat: HTMLInputElement;
  private light: HTMLInputElement;
  private grid: HTMLElement;
  private sel: HTMLElement;
  private swatches: HTMLButtonElement[] = [];
  private presets: readonly Preset[] = [];
  private ring: HTMLElement;
  private titleEl: HTMLElement;
  /** 全范围模式（HSV） */
  private full = false;

  // 当前颜色：h / s / l（全范围模式是 h / s / v）是调色器的状态（滑条、旋钮），hex 是实际选中的颜色
  private h = 0;
  private s = 40;
  private l = 56;
  private v = 100;
  private hex = '#808080';
  /** 旋钮的累计角度（不折回 0–360，转动时走近的那一边） */
  private angle = 0;
  private handlers: ColorPickerHandlers | null = null;
  private dragging = -1;
  private ink$: { anim: Animation; hex: string } | null = null;

  constructor() {
    this.headDot = el('span', { class: 'dot cp-head-dot' });
    this.nameEl = el('span', { class: 'cp-name' });
    this.titleEl = el('span', { 'data-i18n': 'color.title' });
    const head = el('p', { class: 'pop-title' }, [this.titleEl, this.headDot, this.nameEl]);

    // ── 色相环 + 旋钮 + 圆盘 ──
    const ring = el('div', { class: 'cp-ring' });
    ring.style.background = ringGradient();
    this.ring = ring;
    this.knob = el('span', {
      class: 'cp-knob', role: 'slider', tabindex: 0, 'aria-valuemin': 0, 'aria-valuemax': 359, 'data-i18n-aria': 'color.hue',
    });
    this.arm = el('div', { class: 'cp-arm' }, [this.knob]);
    this.ink = el('span', { class: 'cp-ink' });
    this.disc = el('div', { class: 'cp-disc' }, [this.ink]);
    this.wheel = el('div', { class: 'cp-wheel' }, [ring, this.arm, this.disc]);
    this.wheel.addEventListener('pointerdown', this.onWheelDown);
    this.wheel.addEventListener('pointermove', this.onWheelMove);
    this.wheel.addEventListener('pointerup', this.onWheelUp);
    this.wheel.addEventListener('pointercancel', this.onWheelUp);
    this.knob.addEventListener('keydown', this.onKnobKey);

    // ── 色值 ──
    this.hexInput = el('input', {
      class: 'cp-hex', type: 'text', maxlength: 7, spellcheck: 'false', autocomplete: 'off', 'data-i18n-aria': 'color.hex',
    });
    this.hexInput.addEventListener('change', () => this.fromHexInput());
    this.hexInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      this.fromHexInput();
    });

    // ── 浓淡 / 明暗 ──
    const range = (min: number, max: number) => el('input', { class: 'cp-range', type: 'range', min, max, step: 1 });
    this.sat = range(MUTED.sMin, MUTED.sMax);
    this.light = range(MUTED.lMin, MUTED.lMax);
    this.sat.addEventListener('input', () => {
      this.s = Number(this.sat.value);
      this.apply('slider');
    });
    this.light.addEventListener('input', () => {
      if (this.full) this.v = Number(this.light.value);
      else this.l = Number(this.light.value);
      this.apply('slider');
    });
    const slider = (key: MessageKey, input: HTMLInputElement) =>
      el('label', { class: 'cp-slider' }, [el('span', { 'data-i18n': key }), input]);

    // ── 预设色 ──
    this.sel = el('span', { class: 'cp-sel', 'aria-hidden': 'true' });
    this.grid = el('div', { class: 'cp-swatches', role: 'group', 'data-i18n-aria': 'color.presets' }, [this.sel]);
    this.setPresets(MUTED_PRESETS);

    // ── 取消 / 完成 ──
    const cancel = el('button', { type: 'button', class: 'pop-btn', 'data-i18n': 'pop.cancel' });
    const done = el('button', { type: 'button', class: 'pop-btn pop-btn--primary', 'data-i18n': 'pop.done' });
    cancel.addEventListener('click', () => this.pop.dismiss());
    done.addEventListener('click', () => {
      const h = this.handlers;
      this.handlers = null;
      h?.commit(this.hex);
      this.pop.hide();
    });

    this.pop = new Popover('color-picker', [
      head,
      this.wheel,
      this.hexInput,
      slider('color.sat', this.sat),
      slider('color.light', this.light),
      el('p', { class: 'cp-caption', 'data-i18n': 'color.presets' }),
      this.grid,
      el('div', { class: 'pop-actions' }, [cancel, done]),
    ]);
    this.pop.onDismiss = () => {
      const h = this.handlers;
      this.handlers = null;
      h?.cancel();
    };
    this.root = this.pop.root;
  }

  open(
    series: { name: string; color: string }, x: number, y: number, handlers: ColorPickerHandlers, opts: ColorPickerOptions = {},
  ): void {
    this.pop.dismiss(); // 上一次还开着：先按取消处理
    this.handlers = handlers;
    // 模式：滑条范围、色值输入、预设色、色相环（都在显示前改好，量尺寸时才准）
    this.full = opts.range === 'full';
    const title = opts.title ?? 'color.title';
    this.titleEl.dataset.i18n = title;
    this.titleEl.textContent = t(title);
    this.hexInput.hidden = this.full;
    this.sat.min = String(this.full ? 0 : MUTED.sMin);
    this.sat.max = String(this.full ? 100 : MUTED.sMax);
    this.light.min = String(this.full ? 0 : MUTED.lMin);
    this.light.max = String(this.full ? 100 : MUTED.lMax);
    this.ring.style.background = this.full ? ringGradient(FULL_RING_TONE) : ringGradient();
    this.setPresets(this.full ? FULL_PRESETS : MUTED_PRESETS);
    this.nameEl.textContent = series.name;
    this.nameEl.title = series.name;
    this.nameEl.hidden = !series.name;
    // 先显示（量好尺寸、摆好位置），再按当前颜色摆旋钮和选中圈（它们要用到布局）
    this.pop.show(x, y, series.name ? `${t(title)} · ${series.name}` : t(title), this.knob);
    this.setHex(series.color, 'init');
  }

  /** 换一组预设色（系列色 / 色系），同一组不重建 */
  private setPresets(list: readonly Preset[]): void {
    if (list === this.presets) return;
    this.presets = list;
    for (const b of this.swatches) b.remove();
    this.swatches = list.map((p, i) => {
      const b = el('button', {
        type: 'button', class: 'cp-swatch', 'aria-pressed': 'false',
        'data-i18n-aria': p.label, 'data-i18n-title': p.label, 'aria-label': t(p.label), title: t(p.label),
      });
      b.style.background = p.hex;
      b.style.setProperty('--i', String(i));
      b.addEventListener('click', () => {
        const r = b.getBoundingClientRect();
        this.setHex(p.hex, 'preset', { x: r.left + r.width / 2, y: r.top + r.height / 2 });
      });
      this.grid.append(b);
      return b;
    });
  }

  // ───────────── 取色 ─────────────

  /** 从色值取色（预设色、输入、打开时） */
  private setHex(hex: string, source: Source, origin?: { x: number; y: number }): void {
    const n = normalizeHex(hex);
    if (!n) return;
    if (this.full) {
      const c = hexToHsv(n);
      // 灰色、黑色没有色相：保留旋钮原来的色相
      if (c.s > 0.5 && c.v > 0.5) this.h = c.h;
      this.s = c.s;
      this.v = c.v;
    } else {
      const c = hexToHsl(n);
      // 灰色没有色相：保留旋钮原来的色相
      if (c.s > 0.5) this.h = c.h;
      this.s = clamp(c.s, MUTED.sMin, MUTED.sMax);
      this.l = clamp(c.l, MUTED.lMin, MUTED.lMax);
    }
    this.hex = n;
    this.apply(source, origin);
  }

  private fromHexInput(): void {
    const n = normalizeHex(this.hexInput.value);
    if (!n) {
      // 不合法：抖一下，恢复成当前色值
      this.hexInput.value = this.hex;
      this.hexInput.classList.remove('is-invalid');
      void this.hexInput.offsetWidth;
      this.hexInput.classList.add('is-invalid');
      return;
    }
    if (n !== this.hex) {
      const r = this.hexInput.getBoundingClientRect();
      this.setHex(n, 'hex', { x: r.left + r.width / 2, y: r.top });
    }
  }

  /** 把当前状态画出来：圆盘、旋钮、滑条、色值、选中圈，并通知预览 */
  private apply(source: Source, origin?: { x: number; y: number }): void {
    // 色相环和滑条只在低饱和范围里取色（全范围模式不限）；预设色和输入的色值原样保留
    if (source === 'ring' || source === 'slider') {
      this.hex = this.full ? hsvToHex({ h: this.h, s: this.s, v: this.v }) : hslToHex(clampMuted({ h: this.h, s: this.s, l: this.l }));
    }
    const hex = this.hex;
    const animated = source === 'preset' || source === 'hex';

    if (animated) this.pour(hex, origin);
    else this.setDisc(hex);

    // 旋钮：预设色 / 输入时带回弹地转过去，拖动时直接跟手
    this.angle = source === 'init' ? this.h : nearestAngle(this.angle, this.h);
    this.arm.classList.toggle('is-spring', animated);
    this.arm.style.transform = `rotate(${this.angle.toFixed(2)}deg)`;
    this.knob.style.background = hex;
    this.knob.setAttribute('aria-valuenow', String(Math.round(this.h) % 360));
    this.knob.setAttribute('aria-valuetext', hex);

    this.sat.value = String(Math.round(this.s));
    if (this.full) {
      // HSV：固定色相和明度时 RGB 随饱和度线性变化，固定饱和度时随明度线性变化，两端两个色值的渐变就是准的
      this.light.value = String(Math.round(this.v));
      this.sat.style.background = `linear-gradient(to right, ${hsvToHex({ h: this.h, s: 0, v: this.v })}, ${hsvToHex({ h: this.h, s: 100, v: this.v })})`;
      this.light.style.background = `linear-gradient(to right, #000000, ${hsvToHex({ h: this.h, s: this.s, v: 100 })})`;
    } else {
      const h = this.h.toFixed(1), s = this.s.toFixed(1), l = this.l.toFixed(1);
      this.light.value = String(Math.round(this.l));
      this.sat.style.background = `linear-gradient(to right, hsl(${h} ${MUTED.sMin}% ${l}%), hsl(${h} ${MUTED.sMax}% ${l}%))`;
      this.light.style.background = `linear-gradient(to right, hsl(${h} ${s}% ${MUTED.lMin}%), hsl(${h} ${s}% ${MUTED.lMax}%))`;
    }
    if (document.activeElement !== this.hexInput || source !== 'hex') this.hexInput.value = hex;
    this.headDot.style.background = hex;
    this.moveSelection(source === 'init');
    if (source !== 'init') this.handlers?.preview(hex);
  }

  private setDisc(hex: string): void {
    if (this.ink$) {
      this.ink$.anim.onfinish = null;
      this.ink$.anim.cancel();
      this.ink$ = null;
      // 倒到一半被打断：圆盘直接换色再收起墨水层（否则圆盘从倒之前的颜色过渡，旧颜色会闪一下）
      this.snapDisc(hex);
      this.ink.style.visibility = 'hidden';
      return;
    }
    this.disc.style.background = hex;
  }

  /**
   * 圆盘直接换成 hex，不走 CSS 的颜色过渡（2026-11-18 修复：倒满后收起墨水层时，
   * 圆盘底色要从旧颜色过渡 100ms，墨水层一收旧颜色就闪一下）
   */
  private snapDisc(hex: string): void {
    this.disc.style.transition = 'none';
    this.disc.style.background = hex;
    void this.disc.offsetWidth; // 先按“无过渡”生效，再恢复过渡
    this.disc.style.transition = '';
  }

  /** 新颜色从 origin 的方向“倒进”圆盘（圆形裁切从圆盘边上那一点长满） */
  private pour(hex: string, origin?: { x: number; y: number }): void {
    // 上一次还没倒满：直接把它倒满，再开始这一次
    if (this.ink$) this.setDisc(this.ink$.hex);
    if (reducedMotion.matches || typeof this.ink.animate !== 'function') {
      this.snapDisc(hex);
      return;
    }
    let ox = 50, oy = 50;
    const r = this.disc.getBoundingClientRect();
    if (origin && r.width > 0) {
      const dx = origin.x - (r.left + r.width / 2), dy = origin.y - (r.top + r.height / 2);
      const len = Math.hypot(dx, dy) || 1;
      ox = 50 + (50 * dx) / len;
      oy = 50 + (50 * dy) / len;
    }
    this.ink.style.background = hex;
    this.ink.style.visibility = 'visible';
    const anim = this.ink.animate(
      [{ clipPath: `circle(0% at ${ox}% ${oy}%)` }, { clipPath: `circle(145% at ${ox}% ${oy}%)` }],
      { duration: 480, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
    );
    this.ink$ = { anim, hex };
    anim.onfinish = () => {
      if (this.ink$?.anim !== anim) return;
      this.ink$ = null;
      this.snapDisc(hex);
      this.ink.style.visibility = 'hidden';
    };
  }

  /** 预设色的选中圈：滑到选中的那个（带回弹）；当前颜色不是预设色就淡出 */
  private moveSelection(instant: boolean): void {
    const i = this.presets.findIndex((p) => p.hex === this.hex);
    this.swatches.forEach((b, k) => b.setAttribute('aria-pressed', String(k === i)));
    if (i < 0) {
      this.sel.classList.remove('is-on');
      return;
    }
    const b = this.swatches[i];
    const tr = `translate(${b.offsetLeft + b.offsetWidth / 2}px, ${b.offsetTop + b.offsetHeight / 2}px)`;
    if (instant || !this.sel.classList.contains('is-on')) {
      // 刚出现：直接放到位置上，只做淡入，不从别处滑过来
      this.sel.classList.add('is-instant');
      this.sel.style.transform = tr;
      void this.sel.offsetWidth;
      this.sel.classList.remove('is-instant');
    } else {
      this.sel.style.transform = tr;
    }
    this.sel.classList.add('is-on');
  }

  // ───────────── 色相环的拖动和键盘 ─────────────

  private hueAt(e: PointerEvent): { hue: number; onRing: boolean } {
    const r = this.wheel.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy), outer = r.width / 2;
    return { hue: angleFromPoint(dx, dy), onRing: d >= outer - RING - 8 && d <= outer + 8 };
  }

  private onWheelDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const { hue, onRing } = this.hueAt(e);
    if (!onRing) return; // 点中间的圆盘不算
    e.preventDefault();
    this.dragging = e.pointerId;
    try {
      this.wheel.setPointerCapture(e.pointerId);
    } catch {
      /* 忽略 */
    }
    this.wheel.classList.add('is-dragging');
    this.knob.focus({ preventScroll: true });
    this.h = hue;
    this.apply('ring');
  };

  private onWheelMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.dragging) return;
    this.h = this.hueAt(e).hue;
    this.apply('ring');
  };

  private onWheelUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.dragging) return;
    this.dragging = -1;
    this.wheel.classList.remove('is-dragging');
  };

  /** ← → ↑ ↓ 每次 2°，按住 Shift 15°；PageUp / PageDown 30° */
  private onKnobKey = (e: KeyboardEvent): void => {
    const step = e.shiftKey ? 15 : 2;
    const d: Record<string, number> = {
      ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: 30, PageDown: -30,
    };
    if (!(e.key in d)) return;
    e.preventDefault();
    this.h = (((this.h + d[e.key]) % 360) + 360) % 360;
    this.apply('ring');
  };
}
