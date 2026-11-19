// 每帧的弹簧积分和玻璃运动系数：移植自原型的 step()。纯函数，只改传进来的 Motion。
import type { Motion } from './motion';
import { spring } from '../tokens';

/** [k, c]，质量 1 */
export type Spring = readonly [number, number];
export type Axis = 'x' | 'y';

/** 每帧分 4 小步半隐式欧拉 */
export const SUBSTEPS = 4;
/** dt 上限 1/30 s（掉帧时不让弹簧炸开） */
export const MAX_DT = 1 / 30;

export const clampDt = (dt: number): number => Math.max(0.001, Math.min(dt, MAX_DT));

export interface StepOptions {
  /** 锁定的拖动方向；还没锁轴或没在拖动为 null */
  axis: Axis | null;
  /** 指针是否按着（锁轴之前也算） */
  dragging: boolean;
  /** 落位弹簧（标准 / 柔和 / 灵敏 / 减少动态效果） */
  feel: Spring;
  /** 非拖动的切换（点击、按钮）还在路上 */
  navMove: boolean;
  /** 减少动态效果时为 false：玻璃不避让 */
  avoidGlass: boolean;
  /** 放大 / 全屏用的弹簧，默认 spring.magnify */
  magSpring?: Spring;
}

export interface StepResult {
  navMove: boolean;
  settled: boolean;
}

/** 推进一帧。dt 单位秒（内部会夹到 [0.001, 1/30]）。 */
export function stepMotion(m: Motion, dtRaw: number, o: StepOptions): StepResult {
  const dt = clampDt(dtRaw);
  const kp = o.axis === 'x' ? spring.follow : o.feel;
  const kz: Spring = o.axis === 'y' ? spring.follow : [o.feel[0] * 0.85, o.feel[1]];
  const [kPress, cPress] = spring.press;
  const [kFz, cFz] = spring.fsZoom;
  // 纵向拖动时放大程度跟着手指走（向上拖放大），用跟手弹簧
  const [kMag, cMag] = o.axis === 'y' ? spring.follow : (o.magSpring ?? spring.magnify);
  const pt = o.axis ? 1 : 0;
  const h = dt / SUBSTEPS;
  for (let i = 0; i < SUBSTEPS; i++) {
    let b = -kMag * (m.mag - m.magT) - cMag * m.magV;
    m.magV += b * h;
    m.mag += m.magV * h;
    b = -kMag * (m.fs - m.fsT) - cMag * m.fsV;
    m.fsV += b * h;
    m.fs += m.fsV * h;
    let a = -kp[0] * (m.pos - m.posT) - kp[1] * m.posV;
    m.posV += a * h;
    m.pos += m.posV * h;
    a = -kz[0] * (m.zoom - m.zoomT) - kz[1] * m.zoomV;
    m.zoomV += a * h;
    m.zoom += m.zoomV * h;
    // 缩略图换页入场：和镜头推拉同一个弹簧，入场节奏和拉远镜头时一样
    a = -kz[0] * (m.pg - 1) - kz[1] * m.pgV;
    m.pgV += a * h;
    m.pg += m.pgV * h;
    // 全屏缩放：缩放和平移用同一个临界阻尼弹簧，光标下的那一点在整个过渡里保持不动
    a = -kFz * (m.fz - m.fzT) - cFz * m.fzV;
    m.fzV += a * h;
    m.fz += m.fzV * h;
    a = -kFz * (m.fpx - m.fpxT) - cFz * m.fpxV;
    m.fpxV += a * h;
    m.fpx += m.fpxV * h;
    a = -kFz * (m.fpy - m.fpyT) - cFz * m.fpyV;
    m.fpyV += a * h;
    m.fpy += m.fpyV * h;
    a = -kPress * (m.press - pt) - cPress * m.pressV;
    m.pressV += a * h;
    m.press += m.pressV * h;
  }

  // 指针位置每帧插值 14%（按 60fps 归一化）
  const f = 1 - Math.pow(0.86, dt * 60);
  m.ox += (m.oxT - m.ox) * f;
  m.oy += (m.oyT - m.oy) * f;

  let navMove = o.navMove;
  if (navMove && Math.abs(m.pos - m.posT) <= 0.15) navMove = false;

  // 玻璃运动系数：一松手 moving 就变 false，玻璃立刻开始合拢
  const moving = o.avoidGlass && (o.axis === 'x' || navMove);
  m.mot += ((moving ? 1 : 0) - m.mot) * (1 - Math.exp(-dt * (moving ? 18 : 11)));

  const settled =
    !o.dragging &&
    Math.abs(m.pos - m.posT) < 1e-4 && Math.abs(m.posV) < 1e-3 &&
    Math.abs(m.zoom - m.zoomT) < 1e-4 && Math.abs(m.zoomV) < 1e-3 &&
    Math.abs(m.press) < 1e-3 && Math.abs(m.pressV) < 1e-3 &&
    Math.abs(m.ox - m.oxT) < 0.02 && Math.abs(m.oy - m.oyT) < 0.02 &&
    Math.abs(m.mag - m.magT) < 1e-4 && Math.abs(m.magV) < 1e-3 &&
    Math.abs(m.fs - m.fsT) < 1e-4 && Math.abs(m.fsV) < 1e-3 &&
    Math.abs(m.pg - 1) < 1e-4 && Math.abs(m.pgV) < 1e-3 &&
    Math.abs(m.fz - m.fzT) < 1e-4 && Math.abs(m.fzV) < 1e-3 &&
    Math.abs(m.fpx - m.fpxT) < 0.05 && Math.abs(m.fpxV) < 0.5 &&
    Math.abs(m.fpy - m.fpyT) < 0.05 && Math.abs(m.fpyV) < 0.5 &&
    m.mot < 0.002;
  if (settled) {
    m.mot = 0;
    m.pg = 1;
    m.pgV = 0;
    m.fz = m.fzT;
    m.fzV = 0;
    m.fpx = m.fpxT;
    m.fpxV = 0;
    m.fpy = m.fpyT;
    m.fpyV = 0;
    m.mag = m.magT;
    m.magV = 0;
    m.fs = m.fsT;
    m.fsV = 0;
    m.pos = m.posT;
    m.posV = 0;
    m.zoom = m.zoomT;
    m.zoomV = 0;
    m.press = 0;
    m.pressV = 0;
  }
  return { navMove, settled };
}

// ───────────── 单个标量弹簧（2026-11-18，情绪板和拖起阵列用） ─────────────

/** v 当前值、t 目标、vel 速度 */
export interface Scalar {
  v: number;
  t: number;
  vel: number;
}

export const scalar = (v: number): Scalar => ({ v, t: v, vel: 0 });

/** 推进 dt 秒（和 stepMotion 一样分 4 小步半隐式欧拉），返回是否已经静止；静止时吸附到目标 */
export function stepScalar(s: Scalar, sp: Spring, dt: number, eps = 1e-3): boolean {
  if (s.v === s.t && s.vel === 0) return true;
  const h = clampDt(dt) / SUBSTEPS;
  for (let i = 0; i < SUBSTEPS; i++) {
    const a = -sp[0] * (s.v - s.t) - sp[1] * s.vel;
    s.vel += a * h;
    s.v += s.vel * h;
  }
  if (Math.abs(s.v - s.t) < eps && Math.abs(s.vel) < eps * 10) {
    s.v = s.t;
    s.vel = 0;
    return true;
  }
  return false;
}
