// 时间轴刻度的分段（2026-11-17 新增，针对几万幅的作品库）。纯函数。
//
// 原来每幅作品一根刻度（一个按钮）。10 万幅时时间轴里有 10 万个按钮，换作品时它们的高度 / 颜色一变，
// 浏览器要为 20 万个节点重算样式，一帧要 1 秒多。现在刻度数按轨道宽度封顶（大约每 5px 一根）：
// 作品少时仍是一幅一根，和原来一样；多了就一根刻度代表一段连续的作品（“分段”）。

/** 刻度之间至少隔这么多 px */
export const TICK_MIN_PX = 5;
/** 量不到轨道宽度时（还没排版）按这么多根算 */
export const TICK_FALLBACK = 160;

/** n 幅作品、轨道宽 trackPx 时要几根刻度 */
export function tickCount(n: number, trackPx: number): number {
  if (n <= 0) return 0;
  const max = trackPx > 0 ? Math.max(1, Math.floor(trackPx / TICK_MIN_PX)) : TICK_FALLBACK;
  return Math.min(n, max);
}

/** 第 b 段的第一幅（m 段平分 n 幅；第 b 段 = [start(b), start(b + 1))） */
export const bucketStart = (b: number, n: number, m: number): number => Math.ceil((b * n) / m);

/** 第 i 幅在哪一段（和 bucketStart 一致） */
export const bucketOf = (i: number, n: number, m: number): number =>
  Math.max(0, Math.min(m - 1, Math.floor((i * m) / n)));

/** 第 b 根刻度在轨道上的位置 0–1：一幅一根时就是那一幅的位置，分段时是这一段中间那幅的位置 */
export function tickPosition(b: number, n: number, m: number): number {
  if (n <= 1) return 0.5;
  if (m === n) return b / (n - 1);
  const mid = (bucketStart(b, n, m) + bucketStart(b + 1, n, m) - 1) / 2;
  return mid / (n - 1);
}

// ───────────── 刻度随滑块起伏（2026-11-18） ─────────────
//
// 翻动时，滑块附近的刻度像被它带起来一样鼓起一个小山包，跟着滑块走，停下就落回去。
// - 强度跟着翻动速度（幅 / 秒），不是滑块在屏幕上的速度：几万幅时滑块一次只挪零点几 px，按屏幕速度就几乎看不到
// - 山包宽度跟着刻度间距：刻度密（几万幅，每 5px 一根）时窄一点、一片刻度连成平滑的坡；
//   刻度稀（几幅）时放宽，滑块在两根刻度中间时两边都会起来
// - 不对称，像潮头（2026-11-18 用户要求）：推进方向那一侧窄、陡（翻得越快越陡），身后那一侧稍宽、缓，像拖出的尾迹
// - 停着时不起伏（静止时刻度的高矮表示“当前 / 同系列 / 其它”，不能被打乱）；最高 WAVE_CAP_PX，不碰上面的年份 / 月份文字

/** 山包峰值加高（px） */
export const WAVE_MAX_PX = 10;
/** 任何刻度起伏后最高到这么高（px）：刻度在 44px 高的轨道里居中，再高就碰到上面的文字 */
export const WAVE_CAP_PX = 26;
/** 潮头：推进方向那一侧的山包最多收窄这么多；身后最多放宽这么多 */
export const WAVE_FRONT = 0.4;
export const WAVE_WAKE = 0.5;
/** 每秒翻这么多幅时起伏最大 */
export const WAVE_FULL_SPEED = 8;
/** 山包宽度（高斯的 σ，px）的上下限 */
export const WAVE_SIGMA_MIN = 18;
export const WAVE_SIGMA_MAX = 200;

/** 起伏强度 0–1：翻动速度（幅 / 秒）越快越高，平滑起步，停下归零 */
export function waveStrength(vel: number): number {
  const x = Math.min(1, Math.abs(vel) / WAVE_FULL_SPEED);
  return x * x * (3 - 2 * x);
}

/** 山包宽度（px）：刻度间距的 0.6 倍，夹在上下限之间（2026-11-18 收窄，原来 0.8 倍、26–260） */
export const waveSigma = (spacingPx: number): number =>
  Math.min(WAVE_SIGMA_MAX, Math.max(WAVE_SIGMA_MIN, spacingPx * 0.6));

/**
 * 离滑块 dx px（刻度在右边为正）的刻度加高多少 px。
 * dir = 翻动方向（+1 往后、−1 往前）。按强度：推进方向那一侧最窄到 0.6 倍（潮头），身后那一侧最宽到 1.5 倍（尾迹）
 */
export function waveLift(dx: number, sigma: number, strength: number, dir: number): number {
  if (strength <= 0) return 0;
  const ahead = dir !== 0 && Math.sign(dx) === Math.sign(dir);
  const s = dir === 0 ? sigma : ahead ? sigma * (1 - WAVE_FRONT * strength) : sigma * (1 + WAVE_WAKE * strength);
  return WAVE_MAX_PX * strength * Math.exp(-(dx * dx) / (2 * s * s));
}

/** 起伏后的高度：基础高度 + 加高，最高 WAVE_CAP_PX（基础本来就更高的不变） */
export const waveHeight = (base: number, lift: number): number => Math.max(base, Math.min(WAVE_CAP_PX, base + lift));
