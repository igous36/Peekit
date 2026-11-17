// “修改颜色”调色器（2026-11-17 新增，右键系列 → 修改颜色）：
//
//   系列颜色  ● 夏日
//        ╭── 色相环 ──╮       拖旋钮（或在环上点）选色相，圆盘实时预览
//        │  ( 圆盘 )  │       点常用色：颜色从那个方向“倒进”圆盘，旋钮带回弹转过去
//        ╰────────────╯
//          #C27F4B            可以直接输入色值
//   浓淡 ━━━━━●━━━━━          只在低饱和范围里取（12–60%），明暗 36–72%，和现有系列色一个调子
//   明暗 ━━━━●━━━━━━
//   常用色
//   ● ● ● ● ● ●              选中圈带回弹地滑到选中的那个
//   ● ● ● ● ● ●
//               [取消] [完成]
//
// 打开时色相环转着展开、常用色依次弹出。拖动时整个界面里这个系列的圆点实时变色（preview），
// 点“完成”才保存；取消 / Esc / 点外面恢复原来的颜色。减少动态效果时去掉这些动画。
import { t, type MessageKey } from '../i18n';
import { seriesPresets } from '../tokens';
import {
  MUTED, angleFromPoint, clampMuted, hexToHsl, hslToHex, nearestAngle, normalizeHex, ringGradient,
} from '../engine/color';
import { el } from './dom';
import { Popover } from './popover';

/** 色相环的粗细（px），和 CSS 一致 */
const RING = 18;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

export interface ColorPickerHandlers {
  /** 颜色变了（拖动中也会调）：实时预览 */
  preview: (hex: string) => void;
  commit: (hex: string) => void;
  cancel: () => void;
}

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

  // 当前颜色：h / s / l 是调色器的状态（滑条、旋钮），hex 是实际选中的颜色
  private h = 0;
  private s = 40;
  private l = 56;
  private hex = '#808080';
  /** 旋钮的累计角度（不折回 0–360，转动时走近的那一边） */
  private angle = 0;
  private handlers: ColorPickerHandlers | null = null;
  private dragging = -1;
  private ink$: { anim: Animation; hex: string } | null = null;

  constructor() {
    this.headDot = el('span', { class: 'dot cp-head-dot' });
    this.nameEl = el('span', { class: 'cp-name' });
    const head = el('p', { class: 'pop-title' }, [el('span', { 'data-i18n': 'color.title' }), this.headDot, this.nameEl]);

    // ── 色相环 + 旋钮 + 圆盘 ──
    const ring = el('div', { class: 'cp-ring' });
    ring.style.background = ringGradient();
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
      this.l = Number(this.light.value);
      this.apply('slider');
    });
    const slider = (key: MessageKey, input: HTMLInputElement) =>
      el('label', { class: 'cp-slider' }, [el('span', { 'data-i18n': key }), input]);

    // ── 常用色 ──
    this.sel = el('span', { class: 'cp-sel', 'aria-hidden': 'true' });
    this.grid = el('div', { class: 'cp-swatches', role: 'group', 'data-i18n-aria': 'color.presets' }, [this.sel]);
    seriesPresets.forEach((p, i) => {
      const name = `color.${p.key}`;
      const b = el('button', {
        type: 'button', class: 'cp-swatch', 'aria-pressed': 'false', 'data-i18n-aria': name, 'data-i18n-title': name,
      });
      b.style.background = p.hex;
      b.style.setProperty('--i', String(i));
      b.addEventListener('click', () => {
        const r = b.getBoundingClientRect();
        this.setHex(p.hex, 'preset', { x: r.left + r.width / 2, y: r.top + r.height / 2 });
      });
      this.swatches.push(b);
      this.grid.append(b);
    });

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

  open(series: { name: string; color: string }, x: number, y: number, handlers: ColorPickerHandlers): void {
    this.pop.dismiss(); // 上一次还开着：先按取消处理
    this.handlers = handlers;
    this.nameEl.textContent = series.name;
    this.nameEl.title = series.name;
    // 先显示（量好尺寸、摆好位置），再按当前颜色摆旋钮和选中圈（它们要用到布局）
    this.pop.show(x, y, `${t('color.title')} · ${series.name}`, this.knob);
    this.setHex(series.color, 'init');
  }

  // ───────────── 取色 ─────────────

  /** 从色值取色（常用色、输入、打开时） */
  private setHex(hex: string, source: Source, origin?: { x: number; y: number }): void {
    const n = normalizeHex(hex);
    if (!n) return;
    const c = hexToHsl(n);
    // 灰色没有色相：保留旋钮原来的色相
    if (c.s > 0.5) this.h = c.h;
    this.s = clamp(c.s, MUTED.sMin, MUTED.sMax);
    this.l = clamp(c.l, MUTED.lMin, MUTED.lMax);
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
    // 色相环和滑条只在低饱和范围里取色；常用色和输入的色值原样保留
    if (source === 'ring' || source === 'slider') this.hex = hslToHex(clampMuted({ h: this.h, s: this.s, l: this.l }));
    const hex = this.hex;
    const animated = source === 'preset' || source === 'hex';

    if (animated) this.pour(hex, origin);
    else this.setDisc(hex);

    // 旋钮：常用色 / 输入时带回弹地转过去，拖动时直接跟手
    this.angle = source === 'init' ? this.h : nearestAngle(this.angle, this.h);
    this.arm.classList.toggle('is-spring', animated);
    this.arm.style.transform = `rotate(${this.angle.toFixed(2)}deg)`;
    this.knob.style.background = hex;
    this.knob.setAttribute('aria-valuenow', String(Math.round(this.h) % 360));
    this.knob.setAttribute('aria-valuetext', hex);

    const h = this.h.toFixed(1), s = this.s.toFixed(1), l = this.l.toFixed(1);
    this.sat.value = String(Math.round(this.s));
    this.light.value = String(Math.round(this.l));
    this.sat.style.background = `linear-gradient(to right, hsl(${h} ${MUTED.sMin}% ${l}%), hsl(${h} ${MUTED.sMax}% ${l}%))`;
    this.light.style.background = `linear-gradient(to right, hsl(${h} ${s}% ${MUTED.lMin}%), hsl(${h} ${s}% ${MUTED.lMax}%))`;
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
      this.ink.style.visibility = 'hidden';
    }
    this.disc.style.background = hex;
  }

  /** 新颜色从 origin 的方向“倒进”圆盘（圆形裁切从圆盘边上那一点长满） */
  private pour(hex: string, origin?: { x: number; y: number }): void {
    // 上一次还没倒满：直接把它倒满，再开始这一次
    if (this.ink$) this.setDisc(this.ink$.hex);
    if (reducedMotion.matches || typeof this.ink.animate !== 'function') {
      this.setDisc(hex);
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
      this.disc.style.background = hex;
      this.ink.style.visibility = 'hidden';
    };
  }

  /** 常用色的选中圈：滑到选中的那个（带回弹）；当前颜色不是常用色就淡出 */
  private moveSelection(instant: boolean): void {
    const i = seriesPresets.findIndex((p) => p.hex === this.hex);
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
