// 时间轴上方的色条（2026-11-20）：鼠标在时间轴上停一会儿，浮出一条由每幅作品主色连成的长条
// （像“电影条码”），和下面的刻度一一对齐；点一下跳到那一幅，悬停时上方显示那一幅的标题和日期。
// 颜色怎么排在 engine/barcode.ts。画在一张 canvas 上，只在出现时、作品或颜色变了时重画（不在每帧画），
// 每帧只挪当前位置的那根细线。
import type { Work } from '../data/types';
import { displayTitle } from '../data/series-ops';
import { t } from '../i18n';
import { r3 } from '../engine/math';
import { BAND_MIN_PX, barcodeColumns, barcodeStops, indexAt } from '../engine/barcode';
import { el, Styled } from './dom';

/** 色条本身的高度（CSS px） */
const STRIP_H = 22;
/** 悬停这么久才浮出来，离开这么久才收起（ms） */
const SHOW_DELAY = 650;
const HIDE_DELAY = 220;
/** 浮出来以后多久重画一次（缩略图陆续到位，主色会变） */
const REFRESH_MS = 1200;

export class ColorStrip {
  readonly root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private now: Styled;
  private hair: Styled;
  private tip: Styled;
  private shown = false;
  private showTimer = 0;
  private hideTimer = 0;
  private refreshTimer = 0;
  private works: readonly Work[] = [];
  private drawnFor: readonly Work[] | null = null;
  private drawnW = 0;

  constructor(
    /** 时间轴整个胶囊（悬停它才浮出来）和刻度轨道（色条和它对齐） */
    private host: HTMLElement,
    private track: HTMLElement,
    /** 一幅作品的主色；还不知道返回 null */
    private colorOf: (w: Work) => string | null,
    private go: (index: number) => void,
  ) {
    this.canvas = el('canvas', { class: 'tl-strip-canvas', 'aria-hidden': 'true' });
    const now = el('span', { class: 'tl-strip-now', 'aria-hidden': 'true' });
    const hair = el('span', { class: 'tl-strip-hair', 'aria-hidden': 'true' });
    const tip = el('span', { class: 'tl-strip-tip', 'aria-hidden': 'true' });
    this.now = new Styled(now);
    this.hair = new Styled(hair);
    this.tip = new Styled(tip);
    const body = el('div', { class: 'tl-strip-body' }, [this.canvas, now, hair]);
    this.root = el('div', { class: 'tl-strip', 'aria-hidden': 'true' }, [tip, body]);

    host.addEventListener('pointerenter', () => this.arm());
    host.addEventListener('pointerleave', () => this.disarm());
    // 在时间轴上按下（拖指示条、点刻度）：先不出来，免得挡视线
    host.addEventListener('pointerdown', (e) => {
      if (!this.root.contains(e.target as Node)) window.clearTimeout(this.showTimer);
    });
    body.addEventListener('pointermove', (e) => this.hover(e.clientX));
    body.addEventListener('pointerleave', () => {
      this.hair.set('opacity', '0');
      this.tip.set('opacity', '0');
    });
    body.addEventListener('click', (e) => {
      const n = this.works.length;
      if (n) this.go(indexAt(this.fraction(e.clientX), n));
    });
  }

  /** 每帧调用：记下作品列表，浮出来时挪当前位置的细线 */
  update(works: readonly Work[], pos: number): void {
    this.works = works;
    if (!this.shown) return;
    if (works !== this.drawnFor) this.draw();
    const n = works.length;
    const x = n > 1 ? Math.max(0, Math.min(1, pos / (n - 1))) : 0.5;
    this.now.set('left', `${r3(x * 100)}%`);
  }

  private arm(): void {
    window.clearTimeout(this.hideTimer);
    if (this.shown) return;
    window.clearTimeout(this.showTimer);
    this.showTimer = window.setTimeout(() => this.show(), SHOW_DELAY);
  }

  private disarm(): void {
    window.clearTimeout(this.showTimer);
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.hide(), HIDE_DELAY);
  }

  private show(): void {
    if (!this.works.length) return;
    this.shown = true;
    this.place();
    this.draw();
    this.root.classList.add('is-shown');
    window.clearInterval(this.refreshTimer);
    this.refreshTimer = window.setInterval(() => this.draw(), REFRESH_MS);
  }

  private hide(): void {
    this.shown = false;
    window.clearInterval(this.refreshTimer);
    this.root.classList.remove('is-shown');
  }

  /** 和刻度轨道左右对齐（轨道在胶囊里的位置） */
  private place(): void {
    const hr = this.host.getBoundingClientRect();
    const tr = this.track.getBoundingClientRect();
    this.root.style.left = `${Math.round(tr.left - hr.left)}px`;
    this.root.style.width = `${Math.round(tr.width)}px`;
  }

  private fraction(clientX: number): number {
    const r = this.canvas.getBoundingClientRect();
    return r.width > 0 ? Math.max(0, Math.min(1, (clientX - r.left) / r.width)) : 0;
  }

  private hover(clientX: number): void {
    const n = this.works.length;
    if (!n) return;
    const i = indexAt(this.fraction(clientX), n);
    const x = n > 1 ? i / (n - 1) : 0.5;
    const w = this.works[i];
    this.hair.set('left', `${r3(x * 100)}%`);
    this.hair.set('opacity', '1');
    this.tip.text(`${displayTitle(w)} · ${w.date || t('date.unknown')}`);
    this.tip.set('left', `${r3(x * 100)}%`);
    this.tip.set('opacity', '1');
  }

  private draw(): void {
    const works = this.works;
    const cssW = this.canvas.clientWidth || this.track.clientWidth;
    if (!works.length || cssW <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.round(cssW * dpr)), H = Math.round(STRIP_H * dpr);
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    this.drawnFor = works;
    this.drawnW = W;
    const g = this.canvas.getContext('2d');
    if (!g) return;
    const colors = works.map((w) => this.colorOf(w));
    const fallback = getComputedStyle(this.root).getPropertyValue('--color-chip').trim() || '#888888';
    g.clearRect(0, 0, W, H);
    g.fillStyle = fallback;
    g.fillRect(0, 0, W, H);
    if (works.length <= cssW / BAND_MIN_PX) {
      // 作品少：每幅一段纯色，段与段之间柔和过渡
      const grad = g.createLinearGradient(0, 0, W, 0);
      for (const s of barcodeStops(colors, fallback)) grad.addColorStop(s.at, s.color);
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
    } else {
      // 作品多：一列设备像素一个颜色（这一列覆盖到的作品取平均），就是电影条码
      const cols = barcodeColumns(colors, W);
      for (let x = 0; x < cols.length; x++) {
        const c = cols[x];
        if (!c) continue;
        g.fillStyle = c;
        g.fillRect(x, 0, 1, H);
      }
    }
  }

  /** 宽度变了（缩放窗口）：浮着的时候重新对齐、重画 */
  resize(): void {
    if (!this.shown) return;
    this.place();
    if (Math.round((this.canvas.clientWidth || 0) * (window.devicePixelRatio || 1)) !== this.drawnW) this.draw();
  }
}
