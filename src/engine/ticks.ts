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
