// 新旧对比（2026-11-20）：整页深色底（和全屏一样），两幅一起看。配对和相隔多久在 engine/compare.ts。
//
//                 [ 并排 | 分割 | 叠加 ]                    ⇄  ✕
//   并排：左边早的、右边晚的，各自适应半边；下面各写标题和日期
//   分割：两幅叠在同一个框里，一条竖线分开，左边是早的、右边是晚的；拖竖线（或 ←/→）换比例
//   叠加：晚的那幅半透明盖在早的上面，底部滑条调透明度（或 ←/→）
//                       相隔 1 年 3 个月
//
// 滚轮以光标为中心缩放、拖动平移，两幅同步（看局部细节）；双击回到适应框。Esc / ✕ 关掉。
// 先显示缩略图，原图读好了再换上。
import type { Work } from '../data/types';
import { displayTitle } from '../data/series-ops';
import { t, type MessageKey } from '../i18n';
import { r3 } from '../engine/math';
import {
  COMPARE_MODES, clampView, gapBetween, olderFirst, zoomView, type CompareMode, type CompareView as View,
} from '../engine/compare';
import { el, svgIcon, ICON_CLOSE } from './dom';
import { fillArt } from './art';

const ICON_SWAP = ['M7 7h13', 'M16 3l4 4-4 4', 'M17 17H4', 'M8 13l-4 4 4 4'];
const MODE_KEY: Record<CompareMode, MessageKey> = { side: 'compare.side', split: 'compare.split', overlay: 'compare.overlay' };

export interface CompareHost {
  /** 先用的图（缩略图） */
  thumb: (w: Work) => string | undefined;
  /** 原图地址（读不了返回 null） */
  original: (w: Work) => Promise<string | null>;
  close: () => void;
}

interface Layer {
  frame: HTMLElement;
  zoom: HTMLElement;
  canvas: HTMLElement;
  caption: HTMLElement;
}

export class CompareViewer {
  readonly root: HTMLElement;
  private stage: HTMLElement;
  private modeBtns = new Map<CompareMode, HTMLButtonElement>();
  private gapText: HTMLElement;
  private slider: HTMLInputElement;
  private sliderWrap: HTMLElement;
  private divider: HTMLElement;
  private layers: [Layer, Layer];
  private pair: [Work, Work] | null = null;
  private mode: CompareMode = 'side';
  private split = 0.5;
  private alpha = 0.5;
  private view: View = { z: 1, px: 0, py: 0 };
  private open = false;
  private token = 0;
  private drag: { id: number; kind: 'split' | 'pan'; x: number; y: number; v: View; w: number; h: number } | null = null;
  private returnFocus: HTMLElement | null = null;

  constructor(private host: CompareHost) {
    const seg = el('div', { class: 'cmp-modes', role: 'radiogroup', 'data-i18n-aria': 'compare.title' });
    for (const m of COMPARE_MODES) {
      const b = el('button', { type: 'button', class: 'cmp-mode', role: 'radio', 'aria-checked': 'false', 'data-i18n': MODE_KEY[m] });
      b.addEventListener('click', () => this.setMode(m));
      this.modeBtns.set(m, b);
      seg.append(b);
    }
    const swap = el('button', { type: 'button', class: 'cmp-icon', 'data-i18n-aria': 'compare.swap', 'data-i18n-title': 'compare.swap' }, [svgIcon(ICON_SWAP, 18)]);
    swap.addEventListener('click', () => this.swap());
    const close = el('button', { type: 'button', class: 'cmp-icon', 'data-i18n-aria': 'compare.close', 'data-i18n-title': 'compare.close' }, [svgIcon(ICON_CLOSE, 18)]);
    close.addEventListener('click', () => this.host.close());
    const makeLayer = (): Layer => {
      const canvas = el('span', { class: 'art-canvas' });
      const zoom = el('div', { class: 'cmp-zoom' }, [canvas]);
      const frame = el('div', { class: 'cmp-frame' }, [zoom]);
      const caption = el('p', { class: 'cmp-caption' });
      return { frame, zoom, canvas, caption };
    };
    this.layers = [makeLayer(), makeLayer()];
    this.divider = el('div', { class: 'cmp-divider', 'aria-hidden': 'true' }, [el('span', { class: 'cmp-handle' })]);
    this.stage = el('div', { class: 'cmp-stage' }, [
      this.layers[0].frame, this.layers[1].frame, this.divider, this.layers[0].caption, this.layers[1].caption,
    ]);
    this.gapText = el('p', { class: 'cmp-gap' });
    this.slider = el('input', { type: 'range', min: 0, max: 100, value: 50, class: 'cmp-slider', 'data-i18n-aria': 'compare.opacity' });
    this.slider.addEventListener('input', () => {
      this.alpha = Number(this.slider.value) / 100;
      this.paint();
    });
    this.sliderWrap = el('label', { class: 'cmp-slider-wrap' }, [el('span', { 'data-i18n': 'compare.opacity' }), this.slider]);
    this.root = el('section', { class: 'compare', hidden: true, role: 'dialog', 'aria-modal': 'true', 'data-i18n-aria': 'compare.title' }, [
      el('div', { class: 'board-drag', 'data-tauri-drag-region': '' }),
      this.stage,
      el('div', { class: 'cmp-bar' }, [seg]),
      el('div', { class: 'cmp-tools' }, [swap, close]),
      el('div', { class: 'cmp-foot' }, [this.gapText, this.sliderWrap]),
    ]);

    this.stage.addEventListener('wheel', this.onWheel, { passive: false });
    this.stage.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    this.stage.addEventListener('dblclick', () => {
      this.view = { z: 1, px: 0, py: 0 };
      this.paint();
    });
    document.addEventListener('keydown', this.onKey, true);
    window.addEventListener('resize', () => this.open && this.layout());
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** 打开 a、b 的对比：早的在左（并排）/ 底下（叠加） */
  show(a: Work, b: Work): void {
    if (!this.open) this.returnFocus = document.activeElement as HTMLElement | null;
    this.pair = olderFirst(a, b);
    this.view = { z: 1, px: 0, py: 0 };
    this.split = 0.5;
    this.open = true;
    this.root.hidden = false;
    void this.root.offsetWidth;
    this.root.classList.add('is-open');
    this.fill();
    this.setMode(this.mode);
    this.modeBtns.get(this.mode)?.focus({ preventScroll: true });
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.token++;
    this.root.classList.remove('is-open');
    this.root.hidden = true;
    const back = this.returnFocus;
    this.returnFocus = null;
    if (back && document.contains(back)) back.focus({ preventScroll: true });
  }

  private swap(): void {
    if (!this.pair) return;
    this.pair = [this.pair[1], this.pair[0]];
    this.fill();
    this.layout();
  }

  private setMode(m: CompareMode): void {
    this.mode = m;
    for (const [k, b] of this.modeBtns) b.setAttribute('aria-checked', String(k === m));
    this.root.dataset.mode = m;
    this.layout();
  }

  /** 填图：先缩略图，原图好了再换 */
  private fill(): void {
    const pair = this.pair;
    if (!pair) return;
    const token = ++this.token;
    pair.forEach((w, i) => {
      const L = this.layers[i];
      fillArt(L.canvas, w, this.host.thumb(w));
      L.caption.textContent = `${displayTitle(w)} · ${w.date || t('date.unknown')}`;
      void this.host.original(w).then((url) => {
        if (!url || token !== this.token) return;
        const img = new Image();
        img.decoding = 'async';
        img.src = url;
        void img.decode().then(() => {
          if (token === this.token) fillArt(L.canvas, w, url);
        }, () => {});
      });
    });
    const gap = gapBetween(pair[0], pair[1]);
    const same = gap && !gap.years && !gap.months && !gap.days;
    this.gapText.textContent = !gap ? '' : same ? t('compare.sameDay') : t('compare.gap', { text: gapLabel(gap) });
  }

  // ───────────── 排版 ─────────────

  /** 按模式和窗口大小摆两个框（只在打开、换模式、缩放窗口时算，不在每帧） */
  private layout(): void {
    const pair = this.pair;
    if (!pair) return;
    const W = window.innerWidth, H = window.innerHeight;
    const top = 76, bottom = 96, side = 48, gap = 32;
    const aspect = (w: Work) => (w.width && w.height ? w.width / w.height : 0.8);
    const fit = (a: number, x: number, y: number, w: number, h: number) => {
      const s = Math.min(w / a, h);
      const fw = s * a, fh = s;
      return { x: x + (w - fw) / 2, y: y + (h - fh) / 2, w: fw, h: fh };
    };
    const areaH = H - top - bottom;
    let rects: { x: number; y: number; w: number; h: number }[];
    if (this.mode === 'side') {
      const colW = (W - 2 * side - gap) / 2;
      rects = [fit(aspect(pair[0]), side, top, colW, areaH - 28), fit(aspect(pair[1]), side + colW + gap, top, colW, areaH - 28)];
    } else {
      // 分割、叠加：两幅放在同一个框里（框按早的那幅的比例），晚的那幅在框里适应
      const r = fit(aspect(pair[0]), side, top, W - 2 * side, areaH);
      rects = [r, r];
    }
    rects.forEach((r, i) => {
      const L = this.layers[i];
      Object.assign(L.frame.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
      if (this.mode === 'side') {
        Object.assign(L.caption.style, { left: `${r.x}px`, top: `${r.y + r.h + 12}px`, width: `${r.w}px`, textAlign: 'center' });
      } else {
        Object.assign(L.caption.style, {
          left: `${i === 0 ? r.x : r.x + r.w / 2}px`, top: `${r.y + r.h + 12}px`, width: `${r.w / 2}px`, textAlign: i === 0 ? 'left' : 'right',
        });
      }
    });
    this.paint();
  }

  /** 缩放、分割线、透明度：只改 transform / clip-path / opacity */
  private paint(): void {
    const v = this.view;
    for (const L of this.layers) {
      const w = L.frame.clientWidth, h = L.frame.clientHeight;
      L.zoom.style.transform = `translate(${r3(v.px * w)}px, ${r3(v.py * h)}px) scale(${r3(v.z)})`;
    }
    const top = this.layers[1];
    if (this.mode === 'split') {
      top.frame.style.clipPath = `inset(0 0 0 ${r3(this.split * 100)}%)`;
      top.frame.style.opacity = '1';
      const f = this.layers[0].frame;
      this.divider.style.left = `${r3(f.offsetLeft + this.split * f.clientWidth)}px`;
      this.divider.style.top = `${f.offsetTop}px`;
      this.divider.style.height = `${f.clientHeight}px`;
    } else if (this.mode === 'overlay') {
      top.frame.style.clipPath = 'none';
      top.frame.style.opacity = String(r3(this.alpha));
    } else {
      top.frame.style.clipPath = 'none';
      top.frame.style.opacity = '1';
    }
    this.slider.value = String(Math.round(this.alpha * 100));
  }

  // ───────────── 输入 ─────────────

  private frameAt(x: number, y: number): HTMLElement | null {
    for (const L of this.layers) {
      const r = L.frame.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return L.frame;
    }
    return null;
  }

  private onWheel = (e: WheelEvent): void => {
    if (!this.open) return;
    const f = this.frameAt(e.clientX, e.clientY);
    if (!f) return;
    e.preventDefault();
    const r = f.getBoundingClientRect();
    const k = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0018));
    this.view = zoomView(this.view, k, (e.clientX - r.left) / r.width - 0.5, (e.clientY - r.top) / r.height - 0.5);
    this.paint();
  };

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const f = this.frameAt(e.clientX, e.clientY);
    const nearDivider = this.mode === 'split' && Math.abs(e.clientX - this.divider.getBoundingClientRect().left) < 24;
    // 分割模式：抓竖线（或者没放大时在框里随便拖）换比例；放大了在别处拖是平移
    const kind = this.mode === 'split' && (nearDivider || this.view.z <= 1) ? 'split' : this.view.z > 1 && f ? 'pan' : null;
    if (!kind || (!f && !nearDivider)) return;
    e.preventDefault();
    const r = (f ?? this.layers[0].frame).getBoundingClientRect();
    this.drag = { id: e.pointerId, kind, x: e.clientX, y: e.clientY, v: this.view, w: r.width, h: r.height };
    if (kind === 'split') this.splitTo(e.clientX);
    this.root.classList.add(kind === 'split' ? 'is-splitting' : 'is-panning');
  };

  private onMove = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    if (d.kind === 'split') this.splitTo(e.clientX);
    else {
      this.view = clampView({ z: d.v.z, px: d.v.px + (e.clientX - d.x) / d.w, py: d.v.py + (e.clientY - d.y) / d.h });
      this.paint();
    }
  };

  private onUp = (e: PointerEvent): void => {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    this.drag = null;
    this.root.classList.remove('is-splitting', 'is-panning');
  };

  private splitTo(clientX: number): void {
    const r = this.layers[0].frame.getBoundingClientRect();
    this.split = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    this.paint();
  }

  private onKey = (e: KeyboardEvent): void => {
    if (!this.open || e.defaultPrevented) return;
    const tg = e.target as HTMLElement | null;
    if (tg?.closest?.('.menu-panel, .ctx-menu, .palette')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.host.close();
      return;
    }
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && tg !== this.slider) {
      const d = e.key === 'ArrowLeft' ? -0.05 : 0.05;
      if (this.mode === 'split') this.split = Math.max(0, Math.min(1, this.split + d));
      else if (this.mode === 'overlay') this.alpha = Math.max(0, Math.min(1, this.alpha + d));
      else return;
      e.preventDefault();
      e.stopPropagation();
      this.paint();
    } else if (e.key === '1' || e.key === '2' || e.key === '3') {
      e.preventDefault();
      e.stopPropagation();
      this.setMode(COMPARE_MODES[Number(e.key) - 1]);
    }
  };
}

/** “1 年 3 个月”“23 天”“同一天” */
export function gapLabel(g: { years: number; months: number; days: number }): string {
  const parts: string[] = [];
  if (g.years) parts.push(t('compare.years', { n: g.years }));
  if (g.months) parts.push(t('compare.months', { n: g.months }));
  if (!g.years && !g.months) parts.push(g.days ? t('compare.days', { n: g.days }) : t('compare.sameDay'));
  return parts.join(' ');
}
