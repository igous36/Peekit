// 运动控制：一个 requestAnimationFrame 循环推进所有弹簧，加上指针、滚轮、键盘输入和导航。
// 移植自原型 Component 的 kick / step / onDown / onMove / onUp / onWheel / onKey / go / prev / next。
// 所有弹簧都静止后循环自动停下；有新输入再 kick() 启动。
//
// 2026-11-17 新增：放大查看（按住左键 / 滚轮上滑 / ↑），单击恢复；双击 / F11 全屏；
// 时间轴指示条拖动（scrub）。
// 2026-11-18：长按中间那幅改成“拖起”（交给 BoardPicker，拖进情绪板），长按别处仍是放大；
// 情绪板和拖起阵列的弹簧也在这个循环里推进（host.stepExtra），全部静止才停。
import type { Motion } from './engine/motion';
import { stepMotion, type Axis, type Spring } from './engine/springs';
import {
  AXIS_LOCK_PX, CLICK_GUARD_MS, cameraLevel, dragLevel, dragPosition, levelTargets, lockAxis, magDragSpan, pushSample,
  releaseLevel, releasePosition, stageUnit, type CameraLevel, fsPull, fsPreview, FS_PULL_ENTER,
  type Sample, boardPull, BOARD_PULL_ENTER,
} from './engine/gesture';
import {
  FIT, RUBBER_RESET_MS, ZOOM_PER_PX, feedWheelGate, landWheelGate, maxZoom, newWheelGate, panBy, resetWheelGate,
  rubberZoom, swallowAfterExit, wheelPx, zoomAt, type FsView, type FsWheelGate,
} from './engine/fszoom';
import {
  cameraStep, DETENT_NUDGE, DETENT_RELEASE_MS, feedDetent, isWheelNotch, keyAction, landDetent, newDetent, WheelAccumulator,
  wheelLanding, flipAction,
  type CameraDetent, type CameraTargets, type NavAction,
} from './engine/discrete';
import { clamp } from './engine/math';
import { spring } from './tokens';
import { prefs, wheelCanToggleFullscreen } from './prefs';

/** 按住不动这么久就放大（按在中间那幅上是拖起） */
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
  /** 全屏缩放用：当前作品适应屏幕时的大小（px）、原图宽度、屏幕像素比 */
  fsBase(): { w: number; h: number; naturalW?: number; dpr: number };
  /** 全屏缩放了一下：底部显示缩放倍率（停一会儿自动隐藏） */
  zoomActivity(): void;
  /** 已经在头 / 尾还往外翻（按键、滚轮、时间轴按钮）：左上角计数提示到头了（2026-11-18） */
  edgeBump(): void;
  /** 舞台以外的弹簧（拖起阵列、情绪板）走一帧，返回是否还在动 */
  stepExtra?(dt: number): boolean;
  /** 长按到时间：按在中间那幅上就拖起它（返回 true，之后的指针事件由拖起阵列接手） */
  lift?(pointerId: number, x: number, y: number): boolean;
  /** 情绪板开着时，舞台的全局按键（F11 / Esc）不处理 */
  blockKeys?(): boolean;
  /** 系列视图里继续往下拉 / 往下滚 / ↓：进入当前这幅所在的情绪板 */
  boardsGesture?(): void;
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
  /** 放大时继续往上拖：拖过放大那一档多少（2026-11-18，进全屏用） */
  pull?: number;
  axis: Axis | null;
  el: HTMLElement;
  samples: Sample[];
  /** 这次按住触发了放大：松手后不算单击 */
  peeked: boolean;
  /** 放大状态下纵向拖动：只用来退出放大，不推拉镜头 */
  exitMag: boolean;
  /** 按下时正在放大查看 / 全屏：拖动换算按窗口宽度，一次最多切一幅 */
  mag: boolean;
  /** 全屏且放大了：这次拖动用来平移画面（不切换作品、不退出全屏） */
  pan: { px0: number; py0: number; moving: boolean } | null;
  /** 指针现在的位置（长按拖起时从这里开始） */
  lx: number;
  ly: number;
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

  /** 停在系列视图（镜头目标拉远、没有放大） */
  get inSeries(): boolean {
    return this.m.zoomT > 0.5 && this.m.magT < 0.5;
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
      if (e.defaultPrevented || isTyping(e.target) || this.host.blockKeys?.()) return;
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
    const busy = this.host.stepExtra?.(dt) ?? false;
    const r = stepMotion(this.m, dt, {
      axis: this.drag ? this.drag.axis : this.scrubbing ? 'x' : null,
      dragging: this.drag !== null || this.scrubbing,
      feel: reduced ? spring.reducedMotion : FEELS[this.feel],
      navMove: this.navMove,
      // 放大 / 全屏时只看得到一幅：左右切换不触发玻璃避让（2026-11-18）
      avoidGlass: !reduced && !this.magnified,
      magSpring: reduced ? spring.reducedMotion : spring.magnify,
    });
    this.navMove = r.navMove;
    this.host.render();
    if (r.settled && !busy) {
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
    if (wasFull !== t.fsT > 0.5) {
      // 进出全屏：滚轮缩放回到适应屏幕
      this.resetFsView();
      this.host.setFullscreen(t.fsT > 0.5);
    }
    this.touch();
    this.kick();
  }

  // ───────────── 全屏时的滚轮缩放（2026-11-18，规则见 engine/fszoom.ts） ─────────────

  /** 滚轮手势状态：橡皮筋累计、是否刚从放大缩回适应屏幕（见 engine/fszoom.ts） */
  private gate: FsWheelGate = newWheelGate();
  private fsUnderTimer = 0;
  /** 滚轮进出全屏的时间、上一个滚轮事件的时间：进出全屏后同一次滚动剩下的事件吞掉 */
  private wheelSwallowAt = 0;
  private lastWheelAt = 0;
  /** 单幅卡位（滚轮从放大 / 系列视图滚回单幅后，见 engine/discrete.ts） */
  private detent: CameraDetent = newDetent();
  private nudgeTimer = 0;

  /** 全屏缩放的目标视图 */
  private setFsView(v: FsView): void {
    this.m.fzT = v.z;
    this.m.fpxT = v.px;
    this.m.fpyT = v.py;
  }

  /** 立刻回到适应屏幕（换作品、进出全屏时），不做动画 */
  resetFsView(): void {
    const m = this.m;
    m.fz = m.fzT = 1;
    m.fpx = m.fpxT = 0;
    m.fpy = m.fpyT = 0;
    m.fzV = m.fpxV = m.fpyV = 0;
    resetWheelGate(this.gate);
    window.clearTimeout(this.fsUnderTimer);
  }

  /** 全屏且放大了（拖动用来平移，原图要加载） */
  get fsZoomed(): boolean {
    return this.fullscreen && this.m.fzT > 1.01;
  }

  /**
   * 全屏时的竖向滚轮：以光标为中心缩放。已经是适应屏幕时往下滚：先缩一点点（橡皮筋），
   * 继续往下（累计超过 EXIT_UNDER）就退出全屏；停下一会儿橡皮筋弹回。
   * 刚从放大缩回适应屏幕时，这次滚动剩下的往下滚（最长 0.5 秒）只有橡皮筋、不会退出（规则见 engine/fszoom.ts）
   */
  private fsWheel(e: WheelEvent, now: number): void {
    const m = this.m;
    const b = this.host.fsBase();
    const dy = wheelPx(e.deltaY, e.deltaMode, this.vh);
    const view: FsView = { z: m.fzT, px: m.fpxT, py: m.fpyT };
    window.clearTimeout(this.fsUnderTimer);
    this.touch();
    let act = feedWheelGate(this.gate, dy, now, view.z);
    // 偏好设置关掉了“滚轮进入 / 退出全屏”（或滚轮在切换照片）：到底了只有橡皮筋，不退出
    if (act === 'exit' && !wheelCanToggleFullscreen(prefs())) act = 'rubber';
    if (act === 'exit') {
      // 继续往下：退出全屏（回到单幅）；这次滚动剩下的事件吞掉，不会接着拉到系列视图
      this.wheelSwallowAt = now;
      this.wheel.reset();
      this.magnify(false);
      return;
    }
    if (act === 'zoom') {
      // 放大，或者还没缩回适应屏幕：缩放到光标所在的点（最小到适应屏幕）
      const zMax = maxZoom(b.w, b.naturalW, b.dpr);
      const next = zoomAt(view, Math.exp(-dy * ZOOM_PER_PX), e.clientX, e.clientY, b.w, b.h, this.vw, this.vh, zMax);
      // 这一下从放大状态缩回了适应屏幕：接下来一小段时间往下滚只有橡皮筋（吸收快速一划的惯性）
      if (dy > 0 && view.z > 1.0001 && next.z <= 1.0001) landWheelGate(this.gate, now);
      this.setFsView(next);
    } else {
      this.setFsView({ z: rubberZoom(this.gate.under), px: 0, py: 0 });
    }
    this.host.zoomActivity();
    this.fsUnderTimer = window.setTimeout(() => {
      resetWheelGate(this.gate);
      if (this.m.fzT < 1) {
        this.setFsView(FIT);
        this.kick();
      }
    }, RUBBER_RESET_MS);
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
      pan: this.fsZoomed ? { px0: m.fpxT, py0: m.fpyT, moving: false } : null,
      lx: e.clientX,
      ly: e.clientY,
    };
    this.drag = d;
    // 按住不动 0.35s：放大查看（松开后保持，单击 / 滚轮下滑 / Esc 恢复）
    window.clearTimeout(this.pressTimer);
    if (!this.magnified) {
      this.pressTimer = window.setTimeout(() => {
        if (this.drag !== d || d.axis) return;
        // 按在中间那幅上：拖起来（拖进情绪板）；这次按住不再算拖动 / 单击
        if (this.host.lift?.(d.id, d.lx, d.ly)) {
          this.drag = null;
          this.dragEndAt = performance.now();
          m.posT = clamp(Math.round(m.pos), 0, Math.max(0, this.host.workCount() - 1));
          this.touch();
          this.kick();
          return;
        }
        d.peeked = true;
        this.magnify(true);
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
      d.lx = e.clientX;
      d.ly = e.clientY;
    }
    if (d && d.id === e.pointerId && d.pan) {
      // 全屏且放大了：拖动平移画面（跟手：当前值和目标一起改），不切换作品、不退出全屏
      const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
      if (!d.pan.moving) {
        if (Math.hypot(dx, dy) < AXIS_LOCK_PX) return;
        d.pan.moving = true;
        try {
          d.el.setPointerCapture(e.pointerId);
        } catch {
          /* 忽略 */
        }
        this.host.ui.axis = 'x'; // 光标变成“抓着”
      }
      const b = this.host.fsBase();
      const v = panBy({ z: m.fzT, px: d.pan.px0, py: d.pan.py0 }, dx, dy, b.w, b.h, this.vw, this.vh);
      m.fpx = m.fpxT = v.px;
      m.fpy = m.fpyT = v.py;
      m.fpxV = m.fpyV = 0;
      this.kick();
      return;
    }
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
        // 按下时就在放大：继续往上拖，画面往全屏方向走（预览，不会真切到系统全屏）；从单幅出发的这次最多到放大
        if (d.from === -1) {
          d.pull = fsPull(d.l0, dy, this.vh);
          m.fsT = fsPreview(d.pull);
        }
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
    if (d.pan) {
      // 平移结束：拖过的不算单击
      if (d.pan.moving) {
        this.dragEndAt = performance.now();
        this.host.ui.axis = null;
      }
      this.kick();
      return;
    }
    if (d.axis === 'x') {
      m.posT = releasePosition(d.samples, m.posT, n, d.mag ? Math.round(d.p0) : undefined);
      this.dragEndAt = performance.now();
    } else if (d.axis === 'y') {
      if (!d.exitMag) {
        if (d.from === -1 && (d.pull ?? 0) >= FS_PULL_ENTER) {
          // 放大时往上拉过门槛：进全屏（2026-11-18）
          this.setCamera({ zoomT: 0, magT: 1, fsT: 1 });
        } else if (d.from === 1 && this.host.boardsGesture && boardPull(d.l0, d.ly - d.y0, this.vh) >= BOARD_PULL_ENTER) {
          // 系列视图里继续往下拉过门槛：镜头回到系列视图，进入情绪板（2026-11-18）
          this.setCamera({ zoomT: 1, magT: 0, fsT: 0 });
          this.host.boardsGesture();
        } else {
          // 吸附到最近的一档：系列视图 / 单幅 / 放大查看（拉全屏没过门槛就弹回放大）
          const to = releaseLevel(d.samples, cameraLevel(m.zoomT, m.magT), d.from);
          this.setCamera({ zoomT: to === 1 ? 1 : 0, magT: to === -1 ? 1 : 0, fsT: 0 });
        }
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

  /** 刚松手的这一下不算单击（拖起阵列松手后） */
  suppressClick(): void {
    this.dragEndAt = performance.now();
  }

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
    const now = performance.now();
    const last = this.lastWheelAt;
    this.lastWheelAt = now;
    // 刚用滚轮退出 / 进入全屏：同一次滚动剩下的事件吞掉（退出后不会顺势拉到系列视图，进入后不会接着放大画面）；停顿过一次就不再吞
    const after = swallowAfterExit(this.wheelSwallowAt, last, now);
    this.wheelSwallowAt = after.exitedAt;
    if (after.swallow) return;
    // 全屏时竖向滚轮用来缩放（横向滚动照常切换作品）
    if (this.fullscreen && e.deltaY !== 0 && Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
      this.fsWheel(e, now);
      this.kick();
      return;
    }
    // 鼠标滚轮的一格立刻推拉一级；触控板照旧累计 + 冷却
    const notch = isWheelNotch(e.deltaMode, (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY);
    const p = prefs();
    // 单幅卡位：刚滚回单幅，这次滚动里同方向再滚只顶一下，不冲到另一头（规则见 engine/discrete.ts）
    const vertical = e.deltaY !== 0 && Math.abs(e.deltaY) >= Math.abs(e.deltaX);
    if (!p.wheelFlip && vertical && feedDetent(this.detent, e.deltaY, now, notch)) {
      this.wheel.reset();
      this.nudgeDetent(Math.sign(e.deltaY));
      this.kick();
      return;
    }
    const a = this.wheel.feed(e.deltaX, e.deltaY, now, notch);
    // 偏好设置“滚轮切换照片”（2026-11-18）：纵向滚轮翻上一幅 / 下一幅，不推拉镜头
    if (a && p.wheelFlip) {
      this.apply(flipAction(a));
    } else if (a && a.kind === 'in' && this.magnified && !wheelCanToggleFullscreen(p)) {
      // 关掉了“滚轮进入 / 退出全屏”：放大时再往上滚不进全屏
    } else if (a && a.kind === 'out' && this.inSeries && this.host.boardsGesture) {
      // 系列视图里再往下滚：进入情绪板；这次滚动剩下的事件吞掉（2026-11-18）
      this.wheelSwallowAt = now;
      this.wheel.reset();
      this.host.boardsGesture();
    } else if (a) {
      const from = this.targets();
      this.apply(a);
      // 防冲过头（2026-11-18 起放大再往上是全屏）：落到单幅、往上落到放大是卡位；进了全屏吞掉这次滚动剩下的
      if (a.kind === 'in' || a.kind === 'out') {
        const land = wheelLanding(from, this.targets(), a.kind);
        if (land === 'detent') {
          landDetent(this.detent, a.kind === 'out' ? 1 : -1, now);
        } else if (land === 'swallow') {
          this.wheelSwallowAt = now;
          this.wheel.reset();
        }
      }
    }
    this.kick();
  };

  /**
   * 卡位顶一下：镜头往 dir 那边动一点点，停下 DETENT_RELEASE_MS 后弹回。
   * 在单幅：往下顶向系列视图、往上顶向放大；在放大：往上顶向全屏（全屏底色、画面都只动一点点，不会真进全屏）
   */
  private nudgeDetent(dir: number): void {
    const m = this.m;
    if (m.magT > 0.5 && m.fsT < 0.5) {
      if (dir < 0) m.fsT = DETENT_NUDGE;
    } else if (dir > 0) {
      m.zoomT = DETENT_NUDGE;
    } else {
      m.magT = DETENT_NUDGE;
    }
    this.touch();
    window.clearTimeout(this.nudgeTimer);
    this.nudgeTimer = window.setTimeout(() => {
      // 期间别的操作改了镜头就不动它
      if (m.zoomT === DETENT_NUDGE) m.zoomT = 0;
      if (m.magT === DETENT_NUDGE) m.magT = 0;
      if (m.fsT === DETENT_NUDGE) m.fsT = 0;
      this.kick();
    }, DETENT_RELEASE_MS);
  }

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
      const from = Math.round(m.posT);
      m.posT = clamp(from + a.delta, 0, n - 1);
      if (n > 0 && m.posT === from) this.host.edgeBump();
      this.navMove = true;
      this.touch();
      this.kick();
    } else if (a.kind === 'fullscreen') {
      this.toggleFullscreen();
    } else if (a.kind === 'out' && this.inSeries && this.host.boardsGesture) {
      this.host.boardsGesture();
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
    const i = Math.round(this.m.posT);
    if (i <= 0) this.host.edgeBump();
    this.go(Math.max(0, i - 1));
  };

  next = (): void => {
    const i = Math.round(this.m.posT), n = this.host.workCount();
    if (i >= n - 1) this.host.edgeBump();
    this.go(Math.min(n - 1, i + 1));
  };

  /** 当前目标作品（编辑系列时用 posT，而不是正在动的 pos） */
  targetIndex(): number {
    return clamp(Math.round(this.m.posT), 0, this.host.workCount() - 1);
  }
}

function isTyping(t: EventTarget | null): boolean {
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;
}
