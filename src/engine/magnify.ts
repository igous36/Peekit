// 放大查看 / 全屏的几何（2026-11-17 新增）。纯函数，单位都是 CSS px。
//
// 放大层是一个按“全屏框”排版的图层，用 translate + scale（≤ 1）摆到当前位置：
// - mag = 0：和舞台中间那张卡片重合（无缝接替）
// - mag = 1, fs = 0：放大框——几乎占满窗口，顶部让出菜单栏
// - mag = 1, fs = 1：全屏框——按比例铺满整个屏幕
import { clamp } from './math';

export interface Rect {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

/** 放大框的边距（px）：顶部让出 64px 给菜单和窗口按钮，其余三边 24px */
export const MAG_MARGIN = { top: 64, bottom: 24, side: 24 } as const;

const DEFAULT_ASPECT = 0.8;
const okAspect = (r: number | undefined): number => (r && r > 0 && Number.isFinite(r) ? r : DEFAULT_ASPECT);

/** 宽高比为 aspect 的矩形，按比例放进 availW × availH，中心在 (cx, cy) */
export function fitRect(aspect: number | undefined, availW: number, availH: number, cx: number, cy: number): Rect {
  const r = okAspect(aspect);
  const aw = Math.max(1, availW), ah = Math.max(1, availH);
  return aw / ah > r ? { cx, cy, w: ah * r, h: ah } : { cx, cy, w: aw, h: aw / r };
}

/** 放大框和全屏框 */
export function magnifyTargets(aspect: number | undefined, vw: number, vh: number): { enlarged: Rect; full: Rect } {
  const { top, bottom, side } = MAG_MARGIN;
  return {
    enlarged: fitRect(aspect, vw - side * 2, vh - top - bottom, vw / 2, (top + vh - bottom) / 2),
    full: fitRect(aspect, vw, vh, vw / 2, vh / 2),
  };
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function lerpRect(a: Rect, b: Rect, t: number): Rect {
  return { cx: lerp(a.cx, b.cx, t), cy: lerp(a.cy, b.cy, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t) };
}

/** 舞台中间那张卡片在屏幕上的位置（忽略透视旋转，中间那张本来就几乎不转） */
export function cardRect(
  x: number, y: number, artW: number, artH: number, s: number, u: number, cameraScale: number, vw: number, vh: number,
): Rect {
  return {
    cx: vw / 2 + x * u * cameraScale,
    cy: vh / 2 + y * u * cameraScale,
    w: artW * u * s * cameraScale,
    h: artH * u * s * cameraScale,
  };
}

/**
 * 当前帧放大层应该在的位置：卡片 → 放大框 → 全屏框。
 * view：全屏时滚轮缩放的视图（2026-11-18，见 fszoom.ts），全屏框按它缩放、平移；不传就是适应屏幕
 */
export function magnifierRect(
  card: Rect, aspect: number | undefined, vw: number, vh: number, mag: number, fs: number,
  view: { z: number; px: number; py: number } = { z: 1, px: 0, py: 0 },
): Rect {
  const t = magnifyTargets(aspect, vw, vh);
  const full = { cx: t.full.cx + view.px, cy: t.full.cy + view.py, w: t.full.w * view.z, h: t.full.h * view.z };
  const target = lerpRect(t.enlarged, full, clamp(fs, 0, 1));
  return lerpRect(card, target, clamp(mag, 0, 1.2));
}

/** 放大层按全屏框排版，这里算出把它摆到 rect 需要的 translate（相对全屏框中心）和 scale */
export function magnifierTransform(rect: Rect, full: Rect): { tx: number; ty: number; s: number } {
  return { tx: rect.cx - full.cx, ty: rect.cy - full.cy, s: rect.w / full.w };
}

/**
 * 放大层的圆角（2026-11-18）：放大层按全屏框排版、再缩小（scale = s）摆到位置上，圆角也跟着缩小，
 * 交接时和卡片对不上（缩回单幅那一下圆角会突然变大）。所以圆角按帧设：
 * 屏幕上看起来的圆角从卡片的圆角 cardR（mag = 0，和卡片一模一样）直线过渡到放大后看起来的圆角 magR
 * （mag = 1，和原来一样：放大层排版尺寸下的圆角 × 放大后的 scale），全屏时（fs → 1）归零。
 * 返回放大层自己坐标里的值（scale 之前），也就是看起来的值 ÷ 当前 scale s。
 */
export function magFrameRadius(mag: number, fs: number, s: number, cardR: number, magR: number): number {
  if (!(s > 0)) return 0;
  const m = clamp(mag, 0, 1);
  const apparent = (cardR + (magR - cardR) * m) * (1 - clamp(fs, 0, 1));
  return apparent / s;
}
