// 放大查看 / 全屏的图层（2026-11-17 新增）。
// 图层按“全屏框”排版（最大尺寸），每帧只改 transform（translate + scale ≤ 1）和 opacity：
// mag = 0 时和舞台中间那张卡片完全重合，接替它放大，所以切换是无缝的。
// 动画进行时开 will-change: transform；停下后关掉，让浏览器按最终尺寸重新栅格化，保证清晰。
import type { Work } from '../data/types';
import { r3, clamp } from '../engine/math';
import { magFrameRadius, magnifierRect, magnifierTransform, magnifyTargets, type Rect } from '../engine/magnify';
import { magDragSpan, stageUnit } from '../engine/gesture';
import { CORNER_K, cornerScale, radius } from '../tokens';
import { el, Styled } from './dom';
import { artKey, fillArt } from './art';

// 圆角（屏幕上看起来的值）：卡片的圆角，和放大层排版尺寸下的圆角（2026-11-18）。
// 支持超椭圆圆角时两者都乘补偿倍数，和 styles.css 里的 @supports 一致
const CORNER = typeof CSS !== 'undefined' && CSS.supports?.('corner-shape', `superellipse(${CORNER_K})`) ? cornerScale(CORNER_K) : 1;
const CARD_RADIUS = parseFloat(radius['radius-art']) * CORNER;
const FRAME_RADIUS = 16 * CORNER;

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
  /** 全屏时的滚轮缩放 / 平移（2026-11-18）：z 1 = 适应屏幕，px / py 画面中心相对屏幕中心的偏移 */
  view?: { z: number; px: number; py: number };
}

export class Magnifier {
  readonly root: HTMLElement;
  private frame: Styled;
  /**
   * 放大层的阴影（2026-11-18 从放大层本身拆出来）：按“卡片大小”排版，mag = 0 时不缩放，
   * 和卡片的阴影一模一样；之后跟着放大层一起放大（阴影也跟着变大变柔，像物体抬起来）。
   * 原来阴影在放大层上、跟着 scale 缩小，缩回单幅交接时阴影会突然变重
   */
  private shadow: Styled;
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
    const shadow = el('div', { class: 'mag-shadow' });
    this.shadow = new Styled(shadow);
    this.root = el('div', { class: 'magnifier', 'aria-hidden': 'true' }, [backdrop, shadow, frame]);
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
    // 全屏时没有阴影
    this.shadow.set('visibility', visible && f.fs < 0.999 ? 'visible' : 'hidden');
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

    // 放大层按全屏框排版；全屏缩放时 scale 会大于 1，停下后 will-change 去掉，浏览器按实际大小重新栅格化，仍然清晰
    const rect = magnifierRect(f.card, aspect, f.vw, f.vh, f.mag, f.fs, f.view);
    const tr = magnifierTransform(rect, full);
    // 放大后左右切换：画作跟着手指 1:1 滑动并淡出，换图后从另一边滑入淡入。
    // 滑动距离和拖动换算一致（一幅 = magDragSpan），手指拖多远画就走多远
    const slide = clamp(f.mag, 0, 1);
    const span = magDragSpan(stageUnit(f.vw, f.vh), f.vw);
    const tx = tr.tx - f.frac * span * slide;
    const opacity = 1 - (1 - clamp(1 - Math.abs(f.frac) * 1.7, 0, 1)) * slide;
    this.frame.set('transform', `translate3d(${r3(tx)}px, ${r3(tr.ty)}px, 0) scale(${r3(tr.s)})`);
    this.frame.set('opacity', String(r3(opacity)));
    const willChange = f.animating || Math.abs(f.frac) > 0.001 ? 'transform, opacity' : 'auto';
    this.frame.set('will-change', willChange);
    // 圆角：交接时（mag = 0）和卡片一样，放大后和原来一样，全屏归零（只改绘制，不触发重排）
    const s1 = magnifierRect(f.card, aspect, f.vw, f.vh, 1, 0).w / full.w;
    this.frame.set('border-radius', `${r3(magFrameRadius(f.mag, f.fs, tr.s, CARD_RADIUS, FRAME_RADIUS * s1))}px`);

    // 阴影：按 mag = 0 时的大小（就是卡片的大小）排版，再按 s / s0 放大，交接时和卡片的阴影完全一样
    const s0 = magnifierRect(f.card, aspect, f.vw, f.vh, 0, 0).w / full.w;
    if (s0 > 0) {
      const w0 = full.w * s0, h0 = full.h * s0;
      this.shadow.set('width', `${r3(w0)}px`);
      this.shadow.set('height', `${r3(h0)}px`);
      this.shadow.set('left', `${r3(full.cx - w0 / 2)}px`);
      this.shadow.set('top', `${r3(full.cy - h0 / 2)}px`);
      this.shadow.set('transform', `translate3d(${r3(tx)}px, ${r3(tr.ty)}px, 0) scale(${r3(tr.s / s0)})`);
      this.shadow.set('opacity', String(r3(opacity * (1 - clamp(f.fs, 0, 1)))));
      this.shadow.set('will-change', willChange);
    }
  }
}
