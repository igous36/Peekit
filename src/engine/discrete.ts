// 离散输入：方向键和触控板 / 滚轮。移植自原型的 onKey / onWheel。
// 只决定“做什么”，不碰运动状态；由 Controller 执行。
//
// 2026-11-17 起镜头有三级：系列视图 ← 单幅 → 放大查看（全屏是放大查看的一种）。
// “拉近”（↑ / 滚轮上滑）和“拉远”（↓ / 滚轮下滑）在这三级之间一级一级走。

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
/** 两次触发至少间隔 380ms，冷却期内的事件直接丢弃 */
export const WHEEL_COOLDOWN_MS = 380;

/** 触控板 / 滚轮累加器 */
export class WheelAccumulator {
  private accX = 0;
  private accY = 0;
  private firedAt = -Infinity;

  /** 喂一个 wheel 事件；达到阈值时返回动作 */
  feed(deltaX: number, deltaY: number, now: number): NavAction | null {
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

/** 镜头三级之间怎么走：返回新的目标（zoomT 0/1，magT 0/1，fsT 0/1） */
export interface CameraTargets {
  zoomT: number;
  magT: number;
  fsT: number;
}

export function cameraStep(t: CameraTargets, kind: 'in' | 'out' | 'escape'): CameraTargets {
  const series = t.zoomT > 0.5, mag = t.magT > 0.5, full = t.fsT > 0.5;
  if (kind === 'in') {
    if (series) return { zoomT: 0, magT: 0, fsT: 0 };
    return { zoomT: 0, magT: 1, fsT: t.fsT };
  }
  if (kind === 'out') {
    if (full || mag) return { zoomT: 0, magT: 0, fsT: 0 };
    return { zoomT: 1, magT: 0, fsT: 0 };
  }
  // Esc：全屏 → 退出全屏回到单幅；放大 → 单幅；系列视图 → 单幅
  return { zoomT: 0, magT: 0, fsT: 0 };
}
