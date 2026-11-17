// 离散输入：方向键和触控板 / 滚轮。移植自原型的 onKey / onWheel。
// 只决定“做什么”，不碰运动状态；由 Controller 执行。

export type NavAction =
  | { kind: 'step'; delta: 1 | -1 }
  | { kind: 'zoom'; target: 0 | 1 };

/** ← / → 切换一幅；↓ 拉远；↑ / Esc 推回 */
export function keyAction(key: string): NavAction | null {
  switch (key) {
    case 'ArrowRight':
      return { kind: 'step', delta: 1 };
    case 'ArrowLeft':
      return { kind: 'step', delta: -1 };
    case 'ArrowDown':
      return { kind: 'zoom', target: 1 };
    case 'ArrowUp':
    case 'Escape':
      return { kind: 'zoom', target: 0 };
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
        const target = this.accY > 0 ? 1 : 0;
        this.accY = 0;
        this.firedAt = now;
        return { kind: 'zoom', target };
      }
    }
    return null;
  }
}
