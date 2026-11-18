// 离散输入：方向键和触控板 / 滚轮。移植自原型的 onKey / onWheel。
// 只决定“做什么”，不碰运动状态；由 Controller 执行。
//
// 2026-11-17 起镜头有三级：系列视图 ← 单幅 → 放大查看（全屏是放大查看的一种）。
// “拉近”（↑ / 滚轮上滑）和“拉远”（↓ / 滚轮下滑）在这三级之间一级一级走。

import { GESTURE_GAP_MS } from './fszoom';

export type NavAction =
  | { kind: 'step'; delta: 1 | -1 }
  /** 拉近一级：系列视图 → 单幅 → 放大 */
  | { kind: 'in' }
  /** 拉远一级：全屏 / 放大 → 单幅 → 系列视图 */
  | { kind: 'out' }
  /** Esc：退出全屏 → 退出放大 → 回到单幅 */
  | { kind: 'escape' }
  /** F11：切换全屏 */
  | { kind: 'fullscreen' };

/** ← / → 切换一幅；↑ 拉近；↓ 拉远；Esc 退一级；F11 全屏 */
export function keyAction(key: string): NavAction | null {
  switch (key) {
    case 'ArrowRight':
      return { kind: 'step', delta: 1 };
    case 'ArrowLeft':
      return { kind: 'step', delta: -1 };
    case 'ArrowUp':
      return { kind: 'in' };
    case 'ArrowDown':
      return { kind: 'out' };
    case 'Escape':
      return { kind: 'escape' };
    case 'F11':
      return { kind: 'fullscreen' };
    default:
      return null;
  }
}

/** 累计 deltaX 超过 40 翻一幅 */
export const WHEEL_X_THRESHOLD = 40;
/** 累计 deltaY 超过 60 推拉镜头 */
export const WHEEL_Y_THRESHOLD = 60;
/** 两次触发至少间隔 380ms，冷却期内的事件直接丢弃（给触控板的惯性用；鼠标滚轮的一格不受限制，见 isWheelNotch） */
export const WHEEL_COOLDOWN_MS = 380;

/**
 * 这个滚轮事件是不是鼠标滚轮的一格（2026-11-18）：Chromium 里 wheelDeltaY 是“格数 × 120”，
 * 触控板是零碎的小数值；按行 / 按页滚动的也是鼠标。
 * 鼠标的一格是一次明确的操作，纵向推拉镜头时立刻走一级，不吃冷却——镜头有三级后，
 * 连滚两格（系列视图 → 单幅 → 放大）第二格被冷却吞掉，会“顿一下”
 */
export function isWheelNotch(deltaMode: number, wheelDeltaY: number | undefined): boolean {
  if (deltaMode !== 0) return true;
  return !!wheelDeltaY && wheelDeltaY % 120 === 0;
}

/** 触控板 / 滚轮累加器 */
export class WheelAccumulator {
  private accX = 0;
  private accY = 0;
  private firedAt = -Infinity;

  /** 清掉累计（2026-11-18：滚轮退出全屏后，之前累计的不能留到下一次滚动） */
  reset(): void {
    this.accX = 0;
    this.accY = 0;
  }

  /** 喂一个 wheel 事件；达到阈值时返回动作。notch = 鼠标滚轮的一格（见 isWheelNotch） */
  feed(deltaX: number, deltaY: number, now: number, notch = false): NavAction | null {
    if (notch && deltaY !== 0 && Math.abs(deltaY) >= Math.abs(deltaX)) {
      // 鼠标滚轮一格：立刻推拉一级，不受冷却限制
      this.accX = 0;
      this.accY = 0;
      this.firedAt = now;
      return deltaY > 0 ? { kind: 'out' } : { kind: 'in' };
    }
    if (now - this.firedAt < WHEEL_COOLDOWN_MS) return null;
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      this.accX += deltaX;
      this.accY = 0;
      if (Math.abs(this.accX) > WHEEL_X_THRESHOLD) {
        const delta = this.accX > 0 ? 1 : -1;
        this.accX = 0;
        this.firedAt = now;
        return { kind: 'step', delta };
      }
    } else {
      this.accY += deltaY;
      this.accX = 0;
      if (Math.abs(this.accY) > WHEEL_Y_THRESHOLD) {
        // 向下滚（deltaY > 0）拉远，向上滚拉近
        const action: NavAction = this.accY > 0 ? { kind: 'out' } : { kind: 'in' };
        this.accY = 0;
        this.firedAt = now;
        return action;
      }
    }
    return null;
  }
}

// ───────────── 单幅卡位（2026-11-18） ─────────────
//
// 鼠标滚一格就走一级以后，从放大 / 系列视图往回滚时多滚一下，容易冲过单幅到另一头。
// 所以单幅是个“卡位”：滚轮把镜头带回单幅后，这次滚动（事件间隔不到 GESTURE_GAP_MS）里同方向
// 再滚只“顶一下”（镜头往那边动一点点再弹回），不会冲过去：
// - 停一下再滚：立刻走一级（一格一格慢慢滚照样灵活）
// - 鼠标一直不停地滚：顶住最多 DETENT_HOLD_MS，之后下一格就过去（想一口气滚到另一头也行）
// - 触控板：这一划（含惯性）剩下的都顶住，抬手再划才过去
// - 反方向滚：卡位立刻解除

/** 鼠标在卡位上最多顶住多久（ms） */
export const DETENT_HOLD_MS = 350;
/** 顶一下时镜头往那边动多少（zoomT / magT 的目标值，0–1） */
export const DETENT_NUDGE = 0.05;
/** 最后一下顶住之后多久弹回（ms） */
export const DETENT_RELEASE_MS = 180;

export interface CameraDetent {
  /** 卡位在等哪个方向（1 往下拉远，−1 往上拉近）；0 = 没有卡位 */
  dir: number;
  /** 回到单幅的时间（ms） */
  at: number;
  /** 上一个纵向滚轮事件的时间（ms） */
  last: number;
}

export const newDetent = (): CameraDetent => ({ dir: 0, at: -Infinity, last: -Infinity });

/** 滚轮刚把镜头带回单幅（dir：这一下的方向）：接下来同方向再滚先顶住 */
export function landDetent(d: CameraDetent, dir: number, now: number): void {
  d.dir = Math.sign(dir);
  d.at = now;
  d.last = now;
}

/**
 * 喂一个纵向滚轮事件（dy > 0 往下），返回 true = 卡位顶住（这个事件只顶一下，不推拉镜头）。
 * notch：是不是鼠标滚轮的一格（见 isWheelNotch）
 */
export function feedDetent(d: CameraDetent, dy: number, now: number, notch: boolean): boolean {
  const gap = now - d.last;
  d.last = now;
  if (d.dir === 0 || dy === 0) return false;
  if (Math.sign(dy) === d.dir && gap <= GESTURE_GAP_MS && (!notch || now - d.at < DETENT_HOLD_MS)) return true;
  d.dir = 0;
  return false;
}

export type CameraLevelName = 'series' | 'single' | 'magnify' | 'fullscreen';

export function levelOf(t: CameraTargets): CameraLevelName {
  if (t.fsT > 0.5) return 'fullscreen';
  if (t.magT > 0.5) return 'magnify';
  if (t.zoomT > 0.5) return 'series';
  return 'single';
}

/**
 * 滚轮推拉镜头落到新的一级之后怎么防“冲过头”（2026-11-18）：
 * - 'detent'：卡位（见上面），这次滚动里同方向再滚只顶一下——落到单幅（从放大或系列视图回来），
 *   或者往上落到放大（再往上就进全屏了）
 * - 'swallow'：进了全屏，这次滚动剩下的事件全部吞掉（不然一进全屏就接着放大画面），停一下再滚才开始缩放
 * - null：没换级，或者已经到头（系列视图再往下没东西了）
 */
export function wheelLanding(from: CameraTargets, to: CameraTargets, kind: 'in' | 'out'): 'detent' | 'swallow' | null {
  const a = levelOf(from), b = levelOf(to);
  if (a === b) return null;
  if (b === 'fullscreen') return 'swallow';
  if (b === 'single') return 'detent';
  if (b === 'magnify' && kind === 'in') return 'detent';
  return null;
}

/** 镜头几级之间怎么走：返回新的目标（zoomT 0/1，magT 0/1，fsT 0/1） */
export interface CameraTargets {
  zoomT: number;
  magT: number;
  fsT: number;
}

export function cameraStep(t: CameraTargets, kind: 'in' | 'out' | 'escape'): CameraTargets {
  const series = t.zoomT > 0.5, mag = t.magT > 0.5, full = t.fsT > 0.5;
  if (kind === 'in') {
    if (series) return { zoomT: 0, magT: 0, fsT: 0 };
    // 2026-11-18：放大再拉近一级就是全屏（滚轮上滑 / ↑）；全屏后不再变（全屏里的滚轮是缩放）
    if (mag) return { zoomT: 0, magT: 1, fsT: 1 };
    return { zoomT: 0, magT: 1, fsT: t.fsT };
  }
  if (kind === 'out') {
    if (full || mag) return { zoomT: 0, magT: 0, fsT: 0 };
    return { zoomT: 1, magT: 0, fsT: 0 };
  }
  // Esc：全屏 → 退出全屏回到单幅；放大 → 单幅；系列视图 → 单幅
  return { zoomT: 0, magT: 0, fsT: 0 };
}

/**
 * 偏好设置“滚轮切换照片”（2026-11-18）：纵向滚轮的推拉换成翻一幅——往下滚（原来是拉远）= 下一幅，
 * 往上滚（原来是拉近）= 上一幅。横向、其它动作不变
 */
export function flipAction(a: NavAction): NavAction {
  if (a.kind === 'out') return { kind: 'step', delta: 1 };
  if (a.kind === 'in') return { kind: 'step', delta: -1 };
  return a;
}
