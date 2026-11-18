// 全屏时的滚轮缩放（2026-11-18 新增）：以光标为中心放大缩小，像 Windows 自带的照片查看器。纯函数。
//
// 视图 = 缩放 z（1 = 适应屏幕，也就是原来的全屏框）+ 画面中心相对屏幕中心的偏移 (px, py)（屏幕 px）。
// - 向上滚放大、向下滚缩小，光标下的那一点不动；最小缩到适应屏幕
// - 已经是适应屏幕时再往下滚：画面只“缩一点点”（橡皮筋，最多 RUBBER_MAX），停下就弹回；
//   继续往下滚（累计超过 EXIT_UNDER，大约鼠标第二格）就退出全屏
// - 放大后画面比屏幕大的那一边可以拖动平移，边缘不会拖进屏幕里；比屏幕小的那一边居中

export interface FsView {
  z: number;
  px: number;
  py: number;
}

export const FIT: FsView = { z: 1, px: 0, py: 0 };

/** 滚轮每 1px 的缩放（鼠标一格 100px ≈ ×1.32；2026-11-18 用户觉得慢，0.002 → 0.0028） */
export const ZOOM_PER_PX = 0.0028;
/** 适应屏幕后继续往下滚：最多再缩这么多（每格 3% 左右，越往后越难缩） */
export const RUBBER_MAX = 0.07;
/** 橡皮筋的软度：往下滚这么多 px 时缩到一半 */
export const RUBBER_HALF = 140;
/**
 * 适应屏幕后继续往下滚累计超过这么多就退出全屏：鼠标一格 100，第一格缩一点，第二格退出。
 * （2026-11-18 曾改成 300 + “停一下才能退出”，用户觉得不方便退出，改回 200，只保留落地后的短暂缓冲）
 */
export const EXIT_UNDER = 200;
/** 停下多久后橡皮筋弹回、累计清零（ms）；一格一格慢慢往下滚（间隔在这之内）也能累计 */
export const RUBBER_RESET_MS = 450;
/** 滚轮事件间隔不到这么久算同一次滚动（ms）；快速一划的事件间隔通常只有几十毫秒 */
export const GESTURE_GAP_MS = 220;
/**
 * 从放大状态缩回适应屏幕（“落地”）后的缓冲：这次滚动剩下的往下滚（事件间隔都不到 GESTURE_GAP_MS）
 * 只有橡皮筋、不会退出，吸收掉快速一划的惯性；最长 LAND_HOLD_MS，一直不停地转滚轮最终也能退出。
 * 停一下再往下滚就按正常累计（两格退出）
 */
export const LAND_HOLD_MS = 500;
/** 缓冲期里橡皮筋最多缩到这么多累计量（撞墙的手感） */
export const LANDED_CAP = 120;
/** 倍率提示：停止缩放后多久隐藏（ms） */
export const BADGE_HIDE_MS = 1200;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** 最大缩放：至少 4 倍；原图比屏幕大很多时，允许放到原图像素的 4 倍 */
export function maxZoom(baseW: number, naturalW: number | undefined, dpr: number): number {
  const fitScale = naturalW && baseW > 0 ? (baseW * dpr) / naturalW : 1;
  return Math.max(4, 4 / fitScale);
}

/** 夹住偏移：画面比屏幕小的那一边居中；比屏幕大的那一边边缘不能进到屏幕里 */
export function clampView(v: FsView, baseW: number, baseH: number, vw: number, vh: number): FsView {
  const mx = Math.max(0, (baseW * v.z - vw) / 2);
  const my = Math.max(0, (baseH * v.z - vh) / 2);
  // `|| 0` 把 −0 变成 0
  return { z: v.z, px: clamp(v.px, -mx, mx) || 0, py: clamp(v.py, -my, my) || 0 };
}

/** 以屏幕上的点 (sx, sy) 为中心缩放 f 倍（z 夹在 [1, zMax]），这一点下的画面不动 */
export function zoomAt(
  v: FsView, f: number, sx: number, sy: number, baseW: number, baseH: number, vw: number, vh: number, zMax: number,
): FsView {
  const from = Math.max(v.z, 1);
  const z = clamp(from * f, 1, zMax);
  const k = z / from;
  const cx = vw / 2 + v.px, cy = vh / 2 + v.py;
  return clampView({ z, px: sx + (cx - sx) * k - vw / 2, py: sy + (cy - sy) * k - vh / 2 }, baseW, baseH, vw, vh);
}

export function panBy(v: FsView, dx: number, dy: number, baseW: number, baseH: number, vw: number, vh: number): FsView {
  return clampView({ z: v.z, px: v.px + dx, py: v.py + dy }, baseW, baseH, vw, vh);
}

/** 橡皮筋：适应屏幕后继续往下滚了 under px，画面缩到多少（1 → 1 − RUBBER_MAX，越往后越难缩） */
export function rubberZoom(under: number): number {
  return 1 - RUBBER_MAX * (1 - 1 / (1 + Math.max(0, under) / RUBBER_HALF));
}

/**
 * 缩放倍率（%）：100% = 原图的一个像素对屏幕上一个物理像素（和 Windows 照片查看器一样）。
 * 不知道原图尺寸时，适应屏幕算 100%
 */
export function zoomPercent(z: number, baseW: number, naturalW: number | undefined, dpr: number): number {
  if (!naturalW) return Math.round(z * 100);
  return Math.round(((baseW * z * dpr) / naturalW) * 100);
}

// ───────────── 滚轮手势：放大缩小、橡皮筋、退出全屏 ─────────────
//
// 从放大状态缩回适应屏幕（“落地”）后，这次滚动剩下的往下滚只有橡皮筋（撞墙的手感），吸收掉快速一划的惯性，
// 不会顺势滚出全屏；停一下（或一直转超过 LAND_HOLD_MS）后再往下滚，就按正常累计：第一格缩一点，第二格退出。
// 一开始就在适应屏幕（没有落地）时没有缓冲。

export interface FsWheelGate {
  /** 适应屏幕后往下滚的累计量（px） */
  under: number;
  /** 落地的时间（ms）；没落地是 −∞ */
  landedAt: number;
  /** 上一下是不是在缓冲里（缓冲刚结束时累计从零算） */
  held: boolean;
  /** 上一个滚轮事件的时间（ms） */
  last: number;
}

export const newWheelGate = (): FsWheelGate => ({ under: 0, landedAt: -Infinity, held: false, last: -Infinity });

/**
 * 喂一个全屏里的竖向滚轮事件（dy > 0 往下），z 是当前目标缩放，返回要做什么：
 * 'zoom' 以光标为中心缩放（放大，或还没缩回适应屏幕；缩回时调用方再调 landWheelGate）；
 * 'rubber' 已经是适应屏幕，画面缩一点点（按 gate.under）；'exit' 退出全屏
 */
export function feedWheelGate(g: FsWheelGate, dy: number, now: number, z: number): 'zoom' | 'rubber' | 'exit' {
  const gap = now - g.last;
  g.last = now;
  if (dy < 0) {
    g.under = 0;
    g.landedAt = -Infinity;
    g.held = false;
    return 'zoom';
  }
  if (z > 1.0001) return 'zoom';
  // 刚落地、这次滚动还没停：只有橡皮筋
  if (gap <= GESTURE_GAP_MS && now - g.landedAt < LAND_HOLD_MS) {
    g.held = true;
    g.under = Math.min(g.under + dy, LANDED_CAP);
    return 'rubber';
  }
  g.landedAt = -Infinity;
  if (g.held) {
    // 缓冲刚结束：从零开始累计，之后两格退出
    g.held = false;
    g.under = 0;
  }
  g.under += dy;
  return g.under >= EXIT_UNDER ? 'exit' : 'rubber';
}

/** 这一下从放大状态缩回了适应屏幕：这次滚动剩下的往下滚只有橡皮筋 */
export function landWheelGate(g: FsWheelGate, now: number): void {
  g.landedAt = now;
  g.last = now;
  g.under = 0;
}

/** 停下 RUBBER_RESET_MS 后：累计清零（画面弹回由调用方处理） */
export function resetWheelGate(g: FsWheelGate): void {
  g.under = 0;
  g.landedAt = -Infinity;
  g.held = false;
}

/**
 * 滚轮退出全屏之后，同一次滚动剩下的事件（间隔都不到 GESTURE_GAP_MS）全部吞掉，
 * 不会接着把镜头拉到系列视图。exitedAt 为 0 表示没在吞；返回这个事件要不要吞，以及之后的 exitedAt
 * （一旦停顿过就清零，之后的滚动不再受影响）
 */
export function swallowAfterExit(exitedAt: number, lastWheel: number, now: number): { swallow: boolean; exitedAt: number } {
  if (exitedAt > 0 && lastWheel >= exitedAt && now - lastWheel <= GESTURE_GAP_MS) return { swallow: true, exitedAt };
  return { swallow: false, exitedAt: 0 };
}

/** 滚轮的 delta 统一成 px（按行 / 按页滚动的鼠标） */
export function wheelPx(deltaY: number, deltaMode: number, vh: number): number {
  return deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * vh : deltaY;
}
