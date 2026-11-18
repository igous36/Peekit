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

/**
 * 放大查看 / 全屏时拖动一幅要划过的距离：窗口宽度的 60%（2026-11-17 新增）。
 * 这时画作几乎铺满窗口，还按舞台卡片的 29u（约 250px）算的话轻轻一划就过去好几幅。
 */
export const MAG_DRAG_SPAN = 0.6;

/** 放大查看 / 全屏时拖动一幅对应的像素（不小于平时的 29u） */
export const magDragSpan = (u: number, vw: number): number => Math.max(29 * u, MAG_DRAG_SPAN * vw);

/**
 * 横向拖动：pos = 起点 − dx / (29u · 镜头缩放)，超出首尾加橡皮筋。
 * span：一幅对应的像素，放大查看 / 全屏时传 magDragSpan()；不传就按 29u · 镜头缩放。
 */
export function dragPosition(p0: number, dx: number, u: number, zoom: number, n: number, span?: number): number {
  const cs = 1 - 0.42 * clamp(zoom, 0, 1);
  const p = p0 - dx / (span ?? 29 * u * cs);
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

/**
 * 横向松手：按速度往前投射 0.18s（最多 ±3 幅），四舍五入后吸附。
 * from：放大查看 / 全屏时传按下时的那一幅，一次最多只切到相邻的一幅（不会甩过头）。
 */
export function releasePosition(samples: readonly Sample[], posT: number, n: number, from?: number): number {
  const v = sampleVelocityX(samples);
  const proj = posT + clamp(v * PROJECT_X_S, -PROJECT_X_MAX, PROJECT_X_MAX);
  let i = Math.round(proj);
  if (from !== undefined) i = clamp(i, from - 1, from + 1);
  return clamp(i, 0, n - 1);
}

// ───────────── 纵向：镜头三级（2026-11-17 改） ─────────────
//
// 纵向拖动控制一个连续的“档位” level：−1 = 放大查看，0 = 单幅，1 = 系列视图。
// 向下拖拉远看系列（原型就有），向上拖放大（2026-11-17 新增，之前向上拖只是橡皮筋）。
// level ≥ 0 时就是镜头 zoom，< 0 时是放大程度 mag 的相反数。

/** 纵向拖满窗口高度的 35% 等于走一档 */
export const ZOOM_DRAG_SPAN = 0.35;
/** 超出 [−1, 1] 时橡皮筋再乘 0.4 */
export const ZOOM_RUBBER = 0.4;
/** 纵向松手投射时间（秒） */
export const PROJECT_Y_S = 0.15;

export type CameraLevel = -1 | 0 | 1;

/** 当前档位：zoom − mag（两者最多一个不为 0） */
export const cameraLevel = (zoom: number, mag: number): number => clamp(zoom, 0, 1) - clamp(mag, 0, 1);

/** 档位 → 镜头和放大的目标值 */
export const levelTargets = (level: number): { zoomT: number; magT: number } =>
  level >= 0 ? { zoomT: level, magT: 0 } : { zoomT: 0, magT: -level };

/** 纵向拖动：level = 起点 + dy / (窗口高 · 0.35)，向下 = 拉远，向上 = 放大 */
export function dragLevel(l0: number, dy: number, vh: number): number {
  const l = l0 + dy / (vh * ZOOM_DRAG_SPAN);
  if (l < -1) return -1 - rubber(-1 - l) * ZOOM_RUBBER;
  if (l > 1) return 1 + rubber(l - 1) * ZOOM_RUBBER;
  return l;
}

/** 最近 100ms 的档位速度（每秒） */
export function sampleVelocityZ(samples: readonly Sample[]): number {
  const a = samples[0], b = samples[samples.length - 1];
  const dt = Math.max(0.016, (b.t - a.t) / 1000);
  return (b.z - a.z) / dt;
}

/**
 * 纵向松手：投射 0.15s，吸附到最近的一档（> 0.5 系列视图，< −0.5 放大，其余单幅）；
 * 一次最多离开起点一档（from），从系列视图甩得再快也只回到单幅，不会直接放大。
 */
export function releaseLevel(samples: readonly Sample[], levelT: number, from: CameraLevel): CameraLevel {
  const proj = levelT + sampleVelocityZ(samples) * PROJECT_Y_S;
  const to = proj > 0.5 ? 1 : proj < -0.5 ? -1 : 0;
  return clamp(to, from - 1, from + 1) as CameraLevel;
}

// ───────────── 放大时继续往上拖：进全屏（2026-11-18） ─────────────
//
// 只有按下时就在放大（from = −1）才算：从单幅一路往上拖，这次最多到放大（和滚轮的卡位一个道理，防冲过头）。
// 拖过放大那一档后，画面往全屏方向走（深色底淡入、画面变大），带橡皮筋；松手时拉过 FS_PULL_ENTER 就进全屏，否则弹回。

/** 松手时超过放大这么多（档位单位，一档 = 窗口高 × 0.35，未加橡皮筋）就进全屏：约窗口高的 10% */
export const FS_PULL_ENTER = 0.3;
/** 拖动中全屏预览最多到这么多（fs 的目标值，< 0.5，不会真的切到系统全屏） */
export const FS_PREVIEW_MAX = 0.45;

/** 拖过放大那一档多少（档位单位，未加橡皮筋）；没拖过是 0 */
export function fsPull(l0: number, dy: number, vh: number): number {
  return Math.max(0, -1 - (l0 + dy / (vh * ZOOM_DRAG_SPAN)));
}

/** 拖动中全屏的预览（越拉越难拉，最多 FS_PREVIEW_MAX）；拉到 FS_PULL_ENTER 时约 0.25 */
export const fsPreview = (pull: number): number => FS_PREVIEW_MAX * (1 - 1 / (1 + Math.max(0, pull) * 4));
