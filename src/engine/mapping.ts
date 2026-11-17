// 画作映射、玻璃避让、缩略图浮现等每帧计算：全部是纯函数，移植自原型的 renderVals()。
// 这里只算数，不碰 DOM；拼样式字符串和写 DOM 在 view/ 里。
import { clamp, clamp01, smoothstep } from './math';
import { stage } from '../tokens';

/** 超过这个距离的画作不渲染 */
export const RENDER_RANGE = 2.65;

// ───────────── 卡片尺寸（跟随画作比例） ─────────────

export interface ArtSize {
  /** 宽、高（u），scale = 1 时 */
  w: number;
  h: number;
}

const ART_AREA = stage.artW * stage.artH;
const DEFAULT_ASPECT = stage.artW / stage.artH;
export const DEFAULT_ART: ArtSize = { w: stage.artW, h: stage.artH };

const validAspect = (aspect: number | undefined): number =>
  aspect !== undefined && aspect > 0 && Number.isFinite(aspect) ? aspect : DEFAULT_ASPECT;

/** 宽高比 = 宽 / 高。卡片和 4:5 卡片面积相同，再限制在最大框内；4:5 正好是 44.8 × 56 */
export function artSize(aspect?: number): ArtSize {
  const r = validAspect(aspect);
  // 4:5 直接用规范尺寸，避免开方带来的浮点误差
  if (Math.abs(r - DEFAULT_ASPECT) < 1e-6) return { ...DEFAULT_ART };
  let w = Math.sqrt(ART_AREA * r);
  let h = Math.sqrt(ART_AREA / r);
  if (h > stage.artMaxH) {
    h = stage.artMaxH;
    w = h * r;
  }
  if (w > stage.artMaxW) {
    w = stage.artMaxW;
    h = w / r;
  }
  return { w, h };
}

/** Rust 端缩略图的长边（px），和 thumbs.rs 的 THUMB_EDGE 一致 */
export const THUMB_EDGE = 1600;

/**
 * 停留 300ms 后要不要换原图（第 6 阶段实测后加的判断）：
 * - 原图不大于缩略图（≤ 1600px）：换。缩略图是有损重编码，原图更干净，小图解码也便宜。
 * - 屏幕上这张卡片需要的物理像素比缩略图还多（例如 4K 屏最大化）：换，否则会糊。
 * - 其余情况（原图远大于屏幕需要，比如 9504×5344 的照片）：不换。缩略图已经比需要的清晰，
 *   看不出区别，而解码几千万像素会让接下来的拖动卡顿上百毫秒。
 */
export function needsOriginalFor(
  width: number | undefined,
  height: number | undefined,
  viewW: number,
  viewH: number,
  dpr: number,
): boolean {
  if (!width || !height) return true;
  if (Math.max(width, height) <= THUMB_EDGE) return true;
  const art = artSize(width / height);
  const u = Math.min(viewH / 100, viewW * 0.006);
  return Math.max(art.w, art.h) * u * dpr > THUMB_EDGE;
}

/** 系列缩略图：按比例完整放进 21 × 26 的框 */
export function thumbSize(aspect?: number): ArtSize {
  const r = validAspect(aspect);
  return r > stage.thumbW / stage.thumbH ? { w: stage.thumbW, h: stage.thumbW / r } : { w: stage.thumbH * r, h: stage.thumbH };
}

export interface PaintingFrame {
  /** 位置（u），以窗口中心为原点 */
  x: number;
  y: number;
  /** 最终缩放（已乘按压） */
  s: number;
  /** 按压前的外框半宽 / 半高（u），玻璃避让用，偏保守 */
  hw: number;
  hh: number;
  /** 在玻璃后的程度 0–1 */
  behind: number;
  /** 是否在玻璃前 */
  front: boolean;
  opacity: number;
  /** 模糊（px） */
  blur: number;
  brightness: number;
  /** 旋转（deg） */
  ry: number;
  rx: number;
  z: number;
  /** 阴影强度 */
  sh: number;
  /** min(|d|, 1)，阴影几何用 */
  am: number;
}

export interface PaintingInput {
  /** 按压弹簧，已夹在 [−0.2, 1.2] */
  press: number;
  /** 归一化指针位置 [−1, 1] */
  pxN: number;
  pyN: number;
  /** 横向速度（幅/秒），已夹在 [−12, 12] */
  vel: number;
}

/** §7.1：d = 画作序号 − pos。超出渲染范围返回 null。art 是这幅的卡片尺寸（默认 4:5）。 */
export function paintingAt(d: number, inp: PaintingInput, art: ArtSize = DEFAULT_ART): PaintingFrame | null {
  const a = Math.abs(d);
  if (a > RENDER_RANGE) return null;
  const sg = d < 0 ? -1 : 1;
  const front = a < 1.5;
  let x: number, s: number, y = 0;
  if (a <= 1) {
    x = d * 29;
    s = 1 - 0.26 * a;
  } else {
    x = sg * (29 + (a - 1) * 20);
    s = Math.max(0.4, 0.74 - 0.19 * (a - 1));
    y = (a - 1) * 1.5;
  }
  const behind = smoothstep(1.35, 1.5, a) * (1 - smoothstep(2.4, 2.6, a));
  const hw = (art.w / 2) * s;
  const hh = (art.h / 2) * s;
  s *= 1 - 0.035 * inp.press;

  let opacity: number;
  if (a <= 1.15) opacity = 1;
  else if (front) opacity = 1 - ((a - 1.15) / 0.35) * 0.2;
  else opacity = Math.max(0, 0.8 * (1 - (a - 1.5) / 0.95));

  const blur = a <= 1 ? 0 : front ? (a - 1) * 12 : 6;
  const brightness = a <= 1 ? 1 - 0.06 * a : 0.94;
  const nearC = Math.max(0, 1 - a * 2);
  const ry = -clamp(d, -1, 1) * 10 + inp.pxN * 6 * nearC + clamp(-inp.vel * 1.6, -12, 12);
  const rx = -inp.pyN * 5 * nearC;
  const z = front ? 60 - Math.round(a * 20) : 5 - Math.round(a);
  const sh = a <= 1 ? 0.3 - 0.14 * a : front ? (0.16 * (1.5 - a)) / 0.5 : 0;

  return { x, y, s, hw, hh, behind, front, opacity, blur, brightness, ry, rx, z, sh, am: Math.min(a, 1) };
}

/**
 * 阴影：§7.1 的强度 sh 在中间（a = 0 时 0.30）和侧边（a = 1 时 0.16）两档之间线性变化，
 * 玻璃前 1 < a < 1.5 时从 0.16 降到 0。渲染时用两层固定阴影（shadow-art-center / shadow-art-side）
 * 按这两个权重叠加，只改透明度：0.30·center + 0.16·side 正好等于 sh。
 */
export function shadowWeights(a: number): { center: number; side: number } {
  if (a <= 1) return { center: 1 - a, side: a };
  if (a < 1.5) return { center: 0, side: (1.5 - a) / 0.5 };
  return { center: 0, side: 0 };
}

// ───────────── 玻璃网格 ─────────────

/** 格子中心距（u）= 格宽 + 间距 */
export const TILE_PITCH = stage.tile + stage.tileGap;
export const TILE_HALF = stage.tile / 2;
export const GRID_W = stage.gridCols * stage.tile + (stage.gridCols - 1) * stage.tileGap;
export const GRID_H = stage.gridRows * stage.tile + (stage.gridRows - 1) * stage.tileGap;

export interface Sinker {
  x: number;
  y: number;
  hw: number;
  hh: number;
  /** behind 系数 */
  k: number;
}

/** 第 c 列、第 r 行玻璃格的中心（u） */
export function tileCenter(c: number, r: number): { tx: number; ty: number } {
  return {
    tx: (c - (stage.gridCols - 1) / 2) * TILE_PITCH,
    ty: (r - (stage.gridRows - 1) / 2) * TILE_PITCH,
  };
}

/** §3 glass-edge-fade：从网格中心往外透明度降到 50% */
export function tileEdgeFade(c: number, r: number): number {
  const hc = (stage.gridCols - 1) / 2, hr = (stage.gridRows - 1) / 2;
  const e = Math.max(Math.abs(c - hc) / hc, Math.abs(r - hr) / hr);
  return 1 - 0.5 * clamp01((e - 0.45) / 0.55);
}

export interface TileFrame {
  /** 避让程度 0–1 */
  f: number;
  /** 缩放原点（%） */
  ox: number;
  oy: number;
}

/** §7.2：一个玻璃格对所有玻璃后画作取最大的避让 */
export function tileAvoid(tx: number, ty: number, sinkers: readonly Sinker[], mot: number): TileFrame {
  let f = 0, ox = 50, oy = 50;
  if (mot <= 0.001) return { f, ox, oy };
  for (const sk of sinkers) {
    const bx = sk.hw + TILE_HALF, by = sk.hh + TILE_HALF;
    const gap = Math.max(Math.abs(tx - sk.x) - bx, Math.abs(ty - sk.y) - by);
    const raw = clamp01((3 - gap) / 3) * sk.k * mot;
    const fi = raw * raw * (3 - 2 * raw);
    if (fi > f) {
      f = fi;
      ox = 50 + 50 * clamp((tx - sk.x) / bx, -1, 1);
      oy = 50 + 50 * clamp((ty - sk.y) / by, -1, 1);
    }
  }
  return { f, ox, oy };
}

/** 玻璃后、看得见的画作的外框（u），用来判断哪些玻璃格真的需要背景模糊 */
export interface BackdropRect {
  x: number;
  y: number;
  hw: number;
  hh: number;
}

/**
 * 性能（第 6 阶段实测）：backdrop-filter 只模糊玻璃“下面”的东西——纯色背景和玻璃后的画作；
 * 玻璃前的画作层级更高，不在背景里。纯色背景模糊后还是同一个颜色，
 * 所以附近（模糊半径 + 余量之内）没有玻璃后画作的格子，关掉模糊在视觉上完全一样。
 * margin 是额外余量（u），覆盖模糊半径、画作自身的模糊和透视旋转带来的变形。
 */
export function tileNeedsBackdrop(tx: number, ty: number, behind: readonly BackdropRect[], margin: number): boolean {
  const half = TILE_HALF + margin;
  for (const b of behind) {
    // 透视旋转（最多约 22°）会让近的一边变大，外框再放大 12% 保守估计
    const hw = b.hw * 1.12, hh = b.hh * 1.12;
    if (Math.abs(tx - b.x) < half + hw && Math.abs(ty - b.y) < half + hh) return true;
  }
  return false;
}

/** 玻璃格最终透明度 = 边缘淡出 × (1 − 0.6f) */
export const tileOpacity = (edge: number, f: number): number => edge * (1 - 0.6 * f);

/** 玻璃格圆角（u）：1.16u → 7.5u（圆） */
export const tileRadius = (f: number): number => 1.16 + f * 6.34;

/** 从画作帧收集“玻璃后”的画作 */
export function collectSinker(p: PaintingFrame, out: Sinker[]): void {
  if (p.behind > 0.002) out.push({ x: p.x, y: p.y, hw: p.hw, hh: p.hh, k: p.behind });
}

// ───────────── 镜头、缩略图、界面卡片 ─────────────

export const cameraScale = (zoom: number): number => 1 - 0.42 * zoom;
export const cameraTilt = (zoomV: number): number => clamp(-zoomV * 4, -6, 6);

/** 当前序号和偏离量：cur = round(pos)，frac = pos − cur（首尾外夹住） */
export function currentOf(pos: number, n: number): { cur: number; frac: number } {
  const cur = clamp(Math.round(pos), 0, n - 1);
  return { cur, frac: clamp(pos, 0, n - 1) - cur };
}

/** 横向拖到两幅之间时，系列缩略图整排淡出 */
export const rowFade = (frac: number): number => clamp01(1 - Math.abs(frac) * 2.2);

export interface ThumbFrame {
  x: number;
  y: number;
  s: number;
  /** 浮现进度（缓动后） */
  e: number;
  opacity: number;
  blur: number;
}

/** 第 k 个同系列缩略图（共 count 个）；zc = clamp(zoom, 0, 1) */
export function thumbAt(k: number, count: number, zc: number, fade: number, hovered: boolean): ThumbFrame {
  const topN = Math.ceil(count / 2);
  const top = k < topN;
  const row = top ? -1 : 1;
  const idx = top ? k : k - topN;
  const cnt = top ? topN : count - topN;
  const x = (idx - (cnt - 1) / 2) * 25;
  const t = clamp01((zc - 0.12 - idx * 0.08 - (row > 0 ? 0.04 : 0)) / 0.55);
  const e = 1 - Math.pow(1 - t, 3);
  const y = row * (30 + 17 * e) + (hovered ? -1.2 : 0);
  const s = (0.82 + 0.18 * e) * (hovered ? 1.05 : 1);
  return { x, y, s, e, opacity: e * fade, blur: (1 - e) * 8 };
}

/** 系列标题胶囊的显示程度 */
export const headerOpacity = (zc: number, fade: number): number => clamp01((zc - 0.4) / 0.5) * fade;

/** 信息卡内容跟着拖动方向滑走 */
export function infoSlide(frac: number): { tx: number; opacity: number } {
  return { tx: -frac * 28, opacity: clamp01(1 - Math.abs(frac) * 1.7) };
}

/** 时间轴指示条：left 0–1，宽度 px */
export function indicator(pos: number, n: number, vel: number): { left: number; width: number } {
  return {
    left: clamp(n > 1 ? pos / (n - 1) : 0.5, 0, 1),
    width: Math.round(clamp(22 + Math.abs(vel) * 3, 22, 48)),
  };
}
