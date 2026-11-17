// 拖动的数学部分：锁轴、1:1 跟手、橡皮筋、松手惯性投射。移植自原型的 onMove / onUp。
import { clamp } from './math';
import type { Axis } from './springs';

/** 移动超过 6px 才锁轴（这样按钮点击不会被吞） */
export const AXIS_LOCK_PX = 6;
/** 速度用最近 100ms 的采样首尾差 */
export const SAMPLE_WINDOW_MS = 100;
/** 松手后横向投射时间（秒）和最多投射幅数 */
export const PROJECT_X_S = 0.18;
export const PROJECT_X_MAX = 3;
/** 拖动结束后多久之内忽略点击（ms） */
export const CLICK_GUARD_MS = 250;

/** 舞台单位 u = min(1vh, 0.6vw)，单位 px */
export const stageUnit = (w: number, h: number): number => Math.min(h / 100, w * 0.006) || 1;

/** 橡皮筋：超出量 o（幅）→ 实际超出量，上限 0.55 */
export const rubber = (o: number): number => 0.55 * (1 - 1 / (1 + o * 0.9));

/** 按主方向锁轴；还没超过阈值返回 null */
export function lockAxis(dx: number, dy: number): Axis | null {
  if (Math.hypot(dx, dy) < AXIS_LOCK_PX) return null;
  return Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
}

/** 横向拖动：pos = 起点 − dx / (29u · 镜头缩放)，超出首尾加橡皮筋 */
export function dragPosition(p0: number, dx: number, u: number, zoom: number, n: number): number {
  const cs = 1 - 0.42 * clamp(zoom, 0, 1);
  const p = p0 - dx / (29 * u * cs);
  if (p < 0) return -rubber(-p);
  if (p > n - 1) return n - 1 + rubber(p - (n - 1));
  return p;
}

export interface Sample {
  /** performance.now()，ms */
  t: number;
  p: number;
  z: number;
}

/** 追加采样，只保留最近 100ms（至少留 2 个） */
export function pushSample(samples: Sample[], s: Sample): void {
  samples.push(s);
  while (samples.length > 2 && s.t - samples[0].t > SAMPLE_WINDOW_MS) samples.shift();
}

/** 最近 100ms 的横向速度（幅/秒） */
export function sampleVelocityX(samples: readonly Sample[]): number {
  const a = samples[0], b = samples[samples.length - 1];
  const dt = Math.max(0.016, (b.t - a.t) / 1000);
  return (b.p - a.p) / dt;
}

/** 横向松手：按速度往前投射 0.18s（最多 ±3 幅），四舍五入后吸附 */
export function releasePosition(samples: readonly Sample[], posT: number, n: number): number {
  const v = sampleVelocityX(samples);
  const proj = posT + clamp(v * PROJECT_X_S, -PROJECT_X_MAX, PROJECT_X_MAX);
  return clamp(Math.round(proj), 0, n - 1);
}

// ───────────── 纵向：推拉镜头 ─────────────

/** 纵向拖满窗口高度的 35% 等于 zoom 从 0 到 1 */
export const ZOOM_DRAG_SPAN = 0.35;
/** 超出 [0, 1] 时橡皮筋再乘 0.4 */
export const ZOOM_RUBBER = 0.4;
/** 纵向松手投射时间（秒） */
export const PROJECT_Y_S = 0.15;

/** 纵向拖动：zoom = 起点 + dy / (窗口高 · 0.35)，向下 = 拉远 */
export function dragZoom(z0: number, dy: number, vh: number): number {
  const z = z0 + dy / (vh * ZOOM_DRAG_SPAN);
  if (z < 0) return -rubber(-z) * ZOOM_RUBBER;
  if (z > 1) return 1 + rubber(z - 1) * ZOOM_RUBBER;
  return z;
}

/** 最近 100ms 的镜头速度（每秒） */
export function sampleVelocityZ(samples: readonly Sample[]): number {
  const a = samples[0], b = samples[samples.length - 1];
  const dt = Math.max(0.016, (b.t - a.t) / 1000);
  return (b.z - a.z) / dt;
}

/** 纵向松手：投射 0.15s，> 0.5 进系列视图（1），否则回到单幅（0） */
export function releaseZoom(samples: readonly Sample[], zoomT: number): 0 | 1 {
  const proj = zoomT + sampleVelocityZ(samples) * PROJECT_Y_S;
  return proj > 0.5 ? 1 : 0;
}
