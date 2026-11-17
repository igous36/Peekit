// 放大查看 / 全屏的图层（2026-11-17 新增）。
// 图层按“全屏框”排版（最大尺寸），每帧只改 transform（translate + scale ≤ 1）和 opacity：
// mag = 0 时和舞台中间那张卡片完全重合，接替它放大，所以切换是无缝的。
// 动画进行时开 will-change: transform；停下后关掉，让浏览器按最终尺寸重新栅格化，保证清晰。
import type { Work } from '../data/types';
import { r3, clamp } from '../engine/math';
import { magnifierRect, magnifierTransform, magnifyTargets, type Rect } from '../engine/magnify';
import { magDragSpan, stageUnit } from '../engine/gesture';
import { el, Styled } from './dom';
import { artKey, fillArt } from './art';

export interface MagnifierFrame {
  work: Work | null;
  /** 原图（解码好的）或缩略图 */
  src: string | undefined;
  mag: number;
  fs: number;
  /** 舞台中间那张卡片在屏幕上的位置 */
  card: Rect;
  /** pos − cur：放大状态下左右切换时，图层跟着方向滑走再换 */
  frac: number;
  vw: number;
  vh: number;
  /** 弹簧还在动 */
  animating: boolean;
}

export class Magnifier {
  readonly root: HTMLElement;
  private frame: Styled;
  private backdrop: Styled;
  private canvas: HTMLElement;
  private key = '';
  private box = '';
  private shown = false;
  private fullscreenLook: boolean | null = null;

  constructor(private onArtError: (workId: string) => void) {
    this.canvas = el('span', { class: 'art-canvas' });
    const frame = el('div', { class: 'mag-frame' }, [this.canvas]);
    this.frame = new Styled(frame);
    // 全屏的深色底：跟着 fs 淡入，盖住舞台和玻璃网格（2026-11-17 用户要求全屏用深色底、不显示玻璃格）
    const backdrop = el('div', { class: 'mag-backdrop' });
    this.backdrop = new Styled(backdrop);
    this.root = el('div', { class: 'magnifier', 'aria-hidden': 'true' }, [backdrop, frame]);
  }

  render(f: MagnifierFrame): void {
    const dark = f.work ? clamp(f.fs, 0, 1) : 0;
    this.backdrop.set('visibility', dark > 0.001 ? 'visible' : 'hidden');
    this.backdrop.set('opacity', String(r3(dark)));

    const visible = !!f.work && f.mag > 0.001;
    if (visible !== this.shown) {
      this.shown = visible;
      this.frame.set('visibility', visible ? 'visible' : 'hidden');
    }
    if (!visible || !f.work) return;
    const w = f.work;
    const aspect = w.width && w.height ? w.width / w.height : undefined;

    const k = artKey(w, f.src);
    if (k !== this.key) {
      this.key = k;
      fillArt(this.canvas, w, f.src, () => this.onArtError(w.id));
    }

    // 排版尺寸 = 全屏框；只在窗口或画作比例变化时改（不在每帧改）
    const full = magnifyTargets(aspect, f.vw, f.vh).full;
    const box = `${r3(full.w)}|${r3(full.h)}|${f.vw}|${f.vh}`;
    if (box !== this.box) {
      this.box = box;
      const st = this.frame.el.style;
      st.width = `${full.w}px`;
      st.height = `${full.h}px`;
      st.left = `${full.cx - full.w / 2}px`;
      st.top = `${full.cy - full.h / 2}px`;
    }

    // 全屏时去掉圆角和阴影，铺满屏幕
    const fullLook = f.fs > 0.5;
    if (fullLook !== this.fullscreenLook) {
      this.fullscreenLook = fullLook;
      this.frame.el.classList.toggle('is-fullscreen', fullLook);
    }

    const rect = magnifierRect(f.card, aspect, f.vw, f.vh, f.mag, f.fs);
    const tr = magnifierTransform(rect, full);
    // 放大后左右切换：画作跟着手指 1:1 滑动并淡出，换图后从另一边滑入淡入。
    // 滑动距离和拖动换算一致（一幅 = magDragSpan），手指拖多远画就走多远
    const slide = clamp(f.mag, 0, 1);
    const span = magDragSpan(stageUnit(f.vw, f.vh), f.vw);
    const tx = tr.tx - f.frac * span * slide;
    const opacity = 1 - (1 - clamp(1 - Math.abs(f.frac) * 1.7, 0, 1)) * slide;
    this.frame.set('transform', `translate3d(${r3(tx)}px, ${r3(tr.ty)}px, 0) scale(${r3(tr.s)})`);
    this.frame.set('opacity', String(r3(opacity)));
    this.frame.set('will-change', f.animating || Math.abs(f.frac) > 0.001 ? 'transform, opacity' : 'auto');
  }
}
