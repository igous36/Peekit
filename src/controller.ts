// 运动控制：一个 requestAnimationFrame 循环推进所有弹簧，加上指针、滚轮、键盘输入和导航。
// 移植自原型 Component 的 kick / step / onDown / onMove / onUp / onWheel / onKey / go / prev / next。
// 所有弹簧都静止后循环自动停下；有新输入再 kick() 启动。
import type { Motion } from './engine/motion';
import { stepMotion, type Axis, type Spring } from './engine/springs';
import {
  CLICK_GUARD_MS, dragPosition, dragZoom, lockAxis, pushSample, releasePosition, releaseZoom, stageUnit,
  type Sample,
} from './engine/gesture';
import { keyAction, WheelAccumulator, type NavAction } from './engine/discrete';
import { clamp } from './engine/math';
import { spring } from './tokens';

export interface UiFlags {
  /** 是否已经有过任何交互（操作提示只出现到第一次交互） */
  touched: boolean;
  /** 当前锁定的拖动方向 */
  axis: Axis | null;
}

export interface ControllerHost {
  readonly ui: UiFlags;
  workCount(): number;
  render(): void;
}

interface DragState {
  id: number;
  x0: number;
  y0: number;
  p0: number;
  z0: number;
  axis: Axis | null;
  el: HTMLElement;
  samples: Sample[];
}

/** 落位手感，原型 Tweaks 里的“动效 · 手感”，默认标准 */
export type Feel = 'soft' | 'standard' | 'snappy';
const FEELS: Record<Feel, Spring> = {
  soft: spring.settleSoft,
  standard: spring.settleStandard,
  snappy: spring.settleSnappy,
};

export class Controller {
  feel: Feel = 'standard';

  private drag: DragState | null = null;
  private navMove = false;
  private dragEndAt = 0;
  private raf = 0;
  private last = 0;
  private vw = window.innerWidth;
  private vh = window.innerHeight;
  private reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  private wheel = new WheelAccumulator();

  constructor(private host: ControllerHost, readonly m: Motion) {
    window.addEventListener('resize', () => {
      this.vw = window.innerWidth;
      this.vh = window.innerHeight;
    });
    // 切换“减少动态效果”后重新渲染一次（速度倾斜、镜头俯仰会立即关掉）
    this.reducedQuery.addEventListener('change', () => this.kick());
  }

  /** 系统开启了“减少动态效果” */
  get reduced(): boolean {
    return this.reducedQuery.matches;
  }

  /** 循环是否在跑（调试 / 测试用） */
  get running(): boolean {
    return this.raf !== 0;
  }

  attach(root: HTMLElement, stage: HTMLElement): void {
    stage.addEventListener('pointerdown', this.onDown);
    stage.addEventListener('wheel', this.onWheel, { passive: true });
    stage.addEventListener('keydown', this.onKey);
    root.addEventListener('pointermove', this.onMove);
    root.addEventListener('pointerup', this.onUp);
    root.addEventListener('pointercancel', this.onUp);
  }

  kick(): void {
    if (!this.raf) this.raf = requestAnimationFrame(this.step);
  }

  private step = (now: number): void => {
    this.raf = 0;
    const dt = this.last ? (now - this.last) / 1000 : 1 / 60;
    this.last = now;
    const reduced = this.reduced;
    const r = stepMotion(this.m, dt, {
      axis: this.drag ? this.drag.axis : null,
      dragging: this.drag !== null,
      feel: reduced ? spring.reducedMotion : FEELS[this.feel],
      navMove: this.navMove,
      avoidGlass: !reduced,
    });
    this.navMove = r.navMove;
    this.host.render();
    if (r.settled) {
      this.last = 0;
      return;
    }
    this.raf = requestAnimationFrame(this.step);
  };

  private touch(): void {
    this.host.ui.touched = true;
  }

  // ───────────── 指针 ─────────────

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const m = this.m;
    // 正在动的画作被“接住”：目标 = 当前位置。还不锁轴、不捕获指针
    m.posT = m.pos;
    m.zoomT = m.zoom;
    this.navMove = false;
    this.drag = {
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      p0: m.pos,
      z0: m.zoom,
      axis: null,
      el: e.currentTarget as HTMLElement,
      samples: [{ t: performance.now(), p: m.pos, z: m.zoom }],
    };
    this.kick();
  };

  private onMove = (e: PointerEvent): void => {
    const m = this.m;
    const u = stageUnit(this.vw, this.vh);
    // 指针相对窗口中心的位置（u），中间画作的轻微倾斜用
    m.oxT = (e.clientX - this.vw / 2) / u;
    m.oyT = (e.clientY - this.vh / 2) / u;
    if (!m.hp) {
      m.hp = 1;
      m.ox = m.oxT;
      m.oy = m.oyT;
    }
    const d = this.drag;
    if (d && d.id === e.pointerId) {
      const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
      if (!d.axis) {
        const axis = lockAxis(dx, dy);
        if (!axis) {
          this.kick();
          return;
        }
        d.axis = axis;
        // 锁轴后才捕获指针，这样点按按钮不会被吞
        try {
          d.el.setPointerCapture(e.pointerId);
        } catch {
          /* 指针已经抬起等情况，忽略 */
        }
        this.host.ui.axis = axis;
        this.touch();
      }
      if (d.axis === 'x') {
        m.posT = dragPosition(d.p0, dx, u, m.zoom, this.host.workCount());
      } else {
        m.zoomT = dragZoom(d.z0, dy, this.vh);
      }
      pushSample(d.samples, { t: performance.now(), p: m.posT, z: m.zoomT });
    }
    this.kick();
  };

  private onUp = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    this.drag = null;
    const m = this.m, n = this.host.workCount();
    if (d.axis === 'x') {
      m.posT = releasePosition(d.samples, m.posT, n);
      this.dragEndAt = performance.now();
    } else if (d.axis === 'y') {
      m.zoomT = releaseZoom(d.samples, m.zoomT);
      this.dragEndAt = performance.now();
    } else {
      // 点按（没超过 6px）：吸附到最近一幅，镜头吸附到 0 或 1
      m.posT = clamp(Math.round(m.pos), 0, n - 1);
      m.zoomT = m.zoomT > 0.5 ? 1 : 0;
    }
    if (d.axis) this.host.ui.axis = null;
    this.kick();
  };

  // ───────────── 触控板 / 滚轮、方向键 ─────────────

  private onWheel = (e: WheelEvent): void => {
    const a = this.wheel.feed(e.deltaX, e.deltaY, performance.now());
    if (a) this.apply(a);
    this.kick();
  };

  private onKey = (e: KeyboardEvent): void => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const a = keyAction(e.key);
    if (!a) return;
    e.preventDefault();
    this.apply(a);
  };

  private apply(a: NavAction): void {
    const m = this.m, n = this.host.workCount();
    if (a.kind === 'step') {
      m.posT = clamp(Math.round(m.posT) + a.delta, 0, n - 1);
      this.navMove = true;
    } else {
      m.zoomT = a.target;
    }
    this.touch();
    this.kick();
  }

  // ───────────── 导航 ─────────────

  /** 跳到第 i 幅；fromThumb 时同时把镜头推回。拖动刚结束时忽略，返回是否生效 */
  go = (i: number, fromThumb = false): boolean => {
    if (performance.now() - this.dragEndAt < CLICK_GUARD_MS) return false;
    this.m.posT = i;
    this.navMove = true;
    if (fromThumb) this.m.zoomT = 0;
    this.touch();
    this.kick();
    return true;
  };

  prev = (): void => {
    this.go(Math.max(0, Math.round(this.m.posT) - 1));
  };

  next = (): void => {
    this.go(Math.min(this.host.workCount() - 1, Math.round(this.m.posT) + 1));
  };

  /** 当前目标作品（编辑系列时用 posT，而不是正在动的 pos） */
  targetIndex(): number {
    return clamp(Math.round(this.m.posT), 0, this.host.workCount() - 1);
  }
}
