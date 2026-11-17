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
    m.mot < 0.002;
  if (settled) {
    m.mot = 0;
    m.pg = 1;
    m.pgV = 0;
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
