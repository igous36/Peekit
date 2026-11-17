// 运动控制：一个 requestAnimationFrame 循环推进所有弹簧，加上指针、滚轮、键盘输入和导航。
// 移植自原型 Component 的 kick / step / onDown / onMove / onUp / onWheel / onKey / go / prev / next。
// 所有弹簧都静止后循环自动停下；有新输入再 kick() 启动。
//
// 2026-11-17 新增：放大查看（按住左键 / 滚轮上滑 / ↑），单击恢复；双击 / F11 全屏；
// 时间轴指示条拖动（scrub）。
import type { Motion } from './engine/motion';
import { stepMotion, type Axis, type Spring } from './engine/springs';
import {
  CLICK_GUARD_MS, cameraLevel, dragLevel, dragPosition, levelTargets, lockAxis, magDragSpan, pushSample, releaseLevel,
  releasePosition, stageUnit, type CameraLevel,
  type Sample,
} from './engine/gesture';
import { cameraStep, keyAction, WheelAccumulator, type CameraTargets, type NavAction } from './engine/discrete';
import { clamp } from './engine/math';
import { spring } from './tokens';

/** 按住不动这么久就放大 */
export const LONG_PRESS_MS = 350;
/** 放大状态下单击后等这么久，确认不是双击的第一下再恢复 */
export const DOUBLE_CLICK_WAIT_MS = 320;

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
  /** 系统全屏的进入 / 退出（界面状态由 Motion.fsT 决定） */
  setFullscreen(on: boolean): void;
}

interface DragState {
  id: number;
  x0: number;
  y0: number;
  p0: number;
  /** 按下时的镜头档位（连续值，−1 放大 / 0 单幅 / 1 系列视图） */
  l0: number;
  /** 按下前停在的那一档 */
  from: CameraLevel;
  axis: Axis | null;
  el: HTMLElement;
  samples: Sample[];
  /** 这次按住触发了放大：松手后不算单击 */
  peeked: boolean;
  /** 放大状态下纵向拖动：只用来退出放大，不推拉镜头 */
  exitMag: boolean;
  /** 按下时正在放大查看 / 全屏：拖动换算按窗口宽度，一次最多切一幅 */
  mag: boolean;
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
  private scrubbing = false;
  private navMove = false;
  private dragEndAt = 0;
  private raf = 0;
  private last = 0;
  private vw = window.innerWidth;
  private vh = window.innerHeight;
  private reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  private wheel = new WheelAccumulator();
  private pressTimer = 0;
  private restoreTimer = 0;

  constructor(private host: ControllerHost, readonly m: Motion) {
    window.addEventListener('resize', () => {
      this.vw = window.innerWidth;
      this.vh = window.innerHeight;
      this.kick(); // 进出全屏后放大层要按新窗口尺寸重新摆
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

  /** 正在放大查看（含全屏） */
  get magnified(): boolean {
    return this.m.magT > 0.5;
  }

  get fullscreen(): boolean {
    return this.m.fsT > 0.5;
  }

  attach(root: HTMLElement, stage: HTMLElement): void {
    stage.addEventListener('pointerdown', this.onDown);
    stage.addEventListener('wheel', this.onWheel, { passive: true });
    stage.addEventListener('keydown', this.onKey);
    stage.addEventListener('click', this.onClick);
    stage.addEventListener('dblclick', this.onDblClick);
    root.addEventListener('pointermove', this.onMove);
    root.addEventListener('pointerup', this.onUp);
    root.addEventListener('pointercancel', this.onUp);
    // 全屏时焦点可能不在舞台上：Esc / F11 在整个窗口都生效
    document.addEventListener('keydown', (e) => {
      if (e.defaultPrevented || isTyping(e.target)) return;
      if (e.key === 'F11' || (e.key === 'Escape' && this.fullscreen)) {
        e.preventDefault();
        this.apply(keyAction(e.key)!);
      }
    });
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
      axis: this.drag ? this.drag.axis : this.scrubbing ? 'x' : null,
      dragging: this.drag !== null || this.scrubbing,
      feel: reduced ? spring.reducedMotion : FEELS[this.feel],
      navMove: this.navMove,
      avoidGlass: !reduced,
      magSpring: reduced ? spring.reducedMotion : spring.magnify,
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

  // ───────────── 镜头三级：系列视图 ← 单幅 → 放大 / 全屏 ─────────────

  private targets(): CameraTargets {
    return { zoomT: this.m.zoomT, magT: this.m.magT, fsT: this.m.fsT };
  }

  setCamera(t: CameraTargets): void {
    const wasFull = this.fullscreen;
    window.clearTimeout(this.restoreTimer);
    this.m.zoomT = t.zoomT;
    this.m.magT = t.magT;
    this.m.fsT = t.fsT;
    if (wasFull !== t.fsT > 0.5) this.host.setFullscreen(t.fsT > 0.5);
    this.touch();
    this.kick();
  }

  magnify(on: boolean): void {
    this.setCamera(on ? { zoomT: 0, magT: 1, fsT: this.m.fsT } : { zoomT: 0, magT: 0, fsT: 0 });
  }

  toggleFullscreen = (): void => {
    this.setCamera(this.fullscreen ? { zoomT: 0, magT: 0, fsT: 0 } : { zoomT: 0, magT: 1, fsT: 1 });
  };

  // ───────────── 指针 ─────────────

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const m = this.m;
    // 按下前停在哪一档（松手时最多离开它一档）
    const from: CameraLevel = this.magnified ? -1 : m.zoomT > 0.5 ? 1 : 0;
    // 正在动的画作被“接住”：目标 = 当前位置。还不锁轴、不捕获指针
    m.posT = m.pos;
    m.zoomT = m.zoom;
    this.navMove = false;
    const l0 = cameraLevel(m.zoom, m.mag);
    const d: DragState = {
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      p0: m.pos,
      l0,
      from,
      axis: null,
      el: e.currentTarget as HTMLElement,
      samples: [{ t: performance.now(), p: m.pos, z: l0 }],
      peeked: false,
      exitMag: false,
      mag: this.magnified,
    };
    this.drag = d;
    // 按住不动 0.35s：放大查看（松开后保持，单击 / 滚轮下滑 / Esc 恢复）
    window.clearTimeout(this.pressTimer);
    if (!this.magnified) {
      this.pressTimer = window.setTimeout(() => {
        if (this.drag === d && !d.axis) {
          d.peeked = true;
          this.magnify(true);
        }
      }, LONG_PRESS_MS);
    }
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
        if (d.peeked) return; // 已经放大了：之后的移动不算拖动
        const axis = lockAxis(dx, dy);
        if (!axis) {
          this.kick();
          return;
        }
        window.clearTimeout(this.pressTimer);
        d.axis = axis;
        // 锁轴后才捕获指针，这样点按按钮不会被吞
        try {
          d.el.setPointerCapture(e.pointerId);
        } catch {
          /* 指针已经抬起等情况，忽略 */
        }
        this.host.ui.axis = axis;
        this.touch();
        // 全屏时纵向拖动：直接退出全屏和放大，这次拖动不推拉镜头（全屏的深色底不适合跟着手指缩）
        if (axis === 'y' && this.fullscreen) {
          d.exitMag = true;
          this.magnify(false);
        }
      }
      if (d.axis === 'x') {
        const span = d.mag ? magDragSpan(u, this.vw) : undefined;
        m.posT = dragPosition(d.p0, dx, u, m.zoom, this.host.workCount(), span);
      } else if (!d.exitMag) {
        // 纵向：向下拉远看系列，向上放大（2026-11-17 新增），都跟着手指连续变化
        const t = levelTargets(dragLevel(d.l0, dy, this.vh));
        m.zoomT = t.zoomT;
        m.magT = t.magT;
      }
      pushSample(d.samples, { t: performance.now(), p: m.posT, z: cameraLevel(m.zoomT, m.magT) });
    }
    this.kick();
  };

  private onUp = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    window.clearTimeout(this.pressTimer);
    this.drag = null;
    const m = this.m, n = this.host.workCount();
    if (d.axis === 'x') {
      m.posT = releasePosition(d.samples, m.posT, n, d.mag ? Math.round(d.p0) : undefined);
      this.dragEndAt = performance.now();
    } else if (d.axis === 'y') {
      if (!d.exitMag) {
        // 吸附到最近的一档：系列视图 / 单幅 / 放大查看
        const to = releaseLevel(d.samples, cameraLevel(m.zoomT, m.magT), d.from);
        this.setCamera({ zoomT: to === 1 ? 1 : 0, magT: to === -1 ? 1 : 0, fsT: 0 });
      }
      this.dragEndAt = performance.now();
    } else {
      // 点按（没超过 6px）：吸附到最近一幅，镜头吸附到 0 或 1
      m.posT = clamp(Math.round(m.pos), 0, n - 1);
      m.zoomT = m.zoomT > 0.5 ? 1 : 0;
      // 按住放大的这一下松手不算单击（否则会立刻恢复）
      if (d.peeked) this.dragEndAt = performance.now();
    }
    if (d.axis) this.host.ui.axis = null;
    this.kick();
  };

  /** 放大状态下单击：等一下确认不是双击，再恢复。全屏时单击不退出（防误触） */
  private onClick = (): void => {
    if (performance.now() - this.dragEndAt < CLICK_GUARD_MS) return;
    if (!this.magnified || this.fullscreen) return;
    window.clearTimeout(this.restoreTimer);
    this.restoreTimer = window.setTimeout(() => this.magnify(false), DOUBLE_CLICK_WAIT_MS);
  };

  private onDblClick = (): void => {
    window.clearTimeout(this.restoreTimer);
    this.toggleFullscreen();
  };

  // ───────────── 时间轴指示条拖动 ─────────────

  scrubStart(): void {
    this.scrubbing = true;
    this.navMove = false;
    this.touch();
    this.kick();
  }

  /** p：连续位置（幅） */
  scrubTo(p: number): void {
    this.m.posT = clamp(p, 0, Math.max(0, this.host.workCount() - 1));
    this.kick();
  }

  scrubEnd(): void {
    if (!this.scrubbing) return;
    this.scrubbing = false;
    this.m.posT = this.targetIndex();
    this.dragEndAt = performance.now();
    this.kick();
  }

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
      this.touch();
      this.kick();
    } else if (a.kind === 'fullscreen') {
      this.toggleFullscreen();
    } else {
      this.setCamera(cameraStep(this.targets(), a.kind));
    }
  }

  // ───────────── 导航 ─────────────

  /** 跳到第 i 幅；fromThumb 时同时把镜头推回。拖动刚结束时忽略，返回是否生效 */
  go = (i: number, fromThumb = false): boolean => {
    if (performance.now() - this.dragEndAt < CLICK_GUARD_MS) return false;
    this.m.posT = clamp(i, 0, Math.max(0, this.host.workCount() - 1));
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

function isTyping(t: EventTarget | null): boolean {
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;
}
