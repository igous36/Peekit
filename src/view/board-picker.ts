// 情绪板阵列（2026-11-18 新增，几何见 engine/picker.ts）。两种打开方式：
//
// 拖着进来（open）：长按中间那幅，或者拖信息卡上的系列标签（整个系列）。
// 1. 提起：替身接替卡片（拖系列时从标签那么小长出来，是一叠照片，角上写张数），缩小、阴影变深，跟着指针走；
//    跟手弹簧接近临界阻尼（一点点重量、不甩），按指针速度轻轻倾斜。
// 2. 展开：背景磨砂变浓，原来的玻璃格略微散开、缩小；新格子从背景里浮现，按离中心的距离一圈圈往外扩，直到铺满窗口；
//    窗口四边再盖一圈渐进模糊。正中间左右两格是“新建情绪板”和“加入现有情绪板”，其余是现有情绪板的预览和空格。
// 3. 悬停：指针下的格子放大、描边变亮，周围的格子被轻轻推开。替身被最近的格子中心吸过去一点：
//    吸力在格子中心最大、到格子边上减到 0，所以在格子之间移动是连续的，不会一格一格地跳。
// 4. 松手：落进格子（格子弹一下），按格子的种类交给 app 处理（起名 / 选情绪板 / 直接加入）；
//    没落在格子上、Esc、取消：替身飞回原位。之后格子从外圈往里收起，磨砂散去。
//
// 点选（browse）：在系列视图里继续往下拉 / 往下滚，当前这幅还不在任何情绪板里时打开。没有替身，
// 直接点格子：加进那个情绪板（或新建）后打开它。Esc、往上滚收起。
//
// 所有弹簧由 Controller 的同一个 rAF 循环推进（App.stepExtra → step）。节点在第一次打开时建好，之后复用。
import { t } from '../i18n';
import { el, svgIcon, ICON_PLUS } from './dom';
import { closeDelay, openDelay, pickerLayout, tileAt, type PickLayout, type PickTile } from '../engine/picker';
import { scalar, stepScalar, type Scalar } from '../engine/springs';
import { clamp, r3 } from '../engine/math';
import { spring } from '../tokens';

/** 系统开启“减少动态效果”：不倾斜、不摆动，弹簧不回弹 */
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const ICON_STACK = ['M12 3l9 5-9 5-9-5 9-5Z', 'M3 13l9 5 9-5', 'M3 17.5l9 5 9-5'];

/** 拖起的东西：一幅画作，或者一个系列（一叠） */
export interface LiftSource {
  /** 图片地址（缩略图或原图）；没有就用底色 / 色块 */
  src?: string;
  bg: string;
  title: string;
  /** 出发位置（中心、宽高，px）：画作是卡片本身；系列是标签处的一个 4:5 框 */
  rect: { cx: number; cy: number; w: number; h: number };
  /** 示例数据的占位图（浏览器调试） */
  art?: (canvas: HTMLElement) => void;
  /** 出发时的缩放：画作 1（和卡片重合）；系列从标签那么小长出来 */
  startScale?: number;
  /** 系列：后面再垫两张（地址或底色），右上角写张数 */
  stack?: { backs: { src?: string; bg: string }[]; count: number };
}

export interface BoardPreview {
  id: string;
  name: string;
  count: number;
  /** 缩到 0–1 的位置（整个情绪板的外框按比例放进预览框）和图片 */
  items: { x: number; y: number; w: number; h: number; url?: string; color?: string; ring: string }[];
}

export type PickTarget = { kind: 'new' } | { kind: 'add' } | { kind: 'empty' } | { kind: 'board'; boardId: string };
export type PickMode = 'drag' | 'browse';

export interface PickerHost {
  kick(): void;
  /** 现有情绪板（最近改过的在前） */
  boards(): BoardPreview[];
  /** 落进 / 点了格子：返回加进去的情绪板 id；null = 取消 */
  drop(target: PickTarget, anchor: { x: number; y: number; w: number; h: number }): Promise<string | null>;
  /** 收起完毕 */
  finished(added: string | null, mode: PickMode): void;
  /** 松手后舞台不要把这一下当成单击 */
  suppressClick(): void;
}

interface TileNode {
  root: HTMLElement;
  body: HTMLElement;
  art: HTMLElement;
  name: HTMLElement;
  count: HTMLElement;
  q: Scalar;
  hov: Scalar;
  pulse: Scalar;
  /** 什么时候开始往目标走（ms，相对打开时刻） */
  startAt: number;
  target: number;
  tile: PickTile | null;
  boardId: string | null;
  role: string;
}

type Phase = 'idle' | 'drag' | 'browse' | 'wait' | 'close';

/** 替身大小：长边是格宽的这么多倍；正对格子中心时缩到这么多倍；落进格子后 */
const LIFT_LONG = 1.18;
const HOVER_LONG = 0.9;
const LAND_LONG = 0.6;
/** 替身被格子中心吸过去的比例（正对中心时；到格子边上减到 0） */
const MAGNET = 0.16;
/** 格子悬停时放大、邻居被推开的距离（px） */
const HOVER_GROW = 0.07;
const PUSH_PX = 9;

export class BoardPicker {
  readonly root: HTMLElement;
  private scrimEl: HTMLElement;
  private edges: HTMLElement;
  private grid: HTMLElement;
  private ghost: HTMLElement;
  private ghostCanvas: HTMLElement;
  private ghostShadow: HTMLElement;
  private ghostBacks: HTMLElement[];
  private ghostBadge: HTMLElement;
  private label: HTMLElement;
  private hint: HTMLElement;
  private pool: TileNode[] = [];
  private layout: PickLayout | null = null;
  private phase: Phase = 'idle';
  private mode: PickMode = 'drag';
  private time = 0;
  private scrim = scalar(0);
  // 替身：中心（px）、缩放、平面旋转、俯仰 / 偏转、透明度、提起程度
  private gx = scalar(0);
  private gy = scalar(0);
  private gs = scalar(1);
  private grot = scalar(0);
  private gtx = scalar(0);
  private gty = scalar(0);
  private gop = scalar(1);
  private glift = scalar(0);
  private w0 = 1;
  private h0 = 1;
  private home = { cx: 0, cy: 0, s: 1 };
  private grab = { dx: 0, dy: 0 };
  private pointer = { id: -1, x: 0, y: 0, t: 0, vx: 0, vy: 0 };
  private hover = -1;
  private returning = false;
  /** 拖的是系列：取消时替身缩回标签里淡出（舞台上没有要交还的卡片） */
  private fadeHome = false;
  private added: string | null = null;
  /** 舞台上那张卡片的可见度：拖走时 0，收起时淡回 1 */
  readonly cardAlpha = scalar(1);
  private vw = 0;
  private vh = 0;
  private closeTimer = 0;

  constructor(private host: PickerHost) {
    this.scrimEl = el('div', { class: 'pick-scrim' });
    this.grid = el('div', { class: 'pick-grid' });
    // 四边的渐进模糊（和情绪板画布同一套样式）
    this.edges = el('div', { class: 'pick-edges', 'aria-hidden': 'true' },
      ['t', 'b', 'l', 'r'].map((s) => el('div', { class: `board-edge board-edge--${s}` })));
    this.ghostCanvas = el('span', { class: 'art-canvas' });
    this.ghostShadow = el('span', { class: 'pick-ghost-shadow' });
    this.ghostBacks = [0, 1].map((i) => el('span', { class: `pick-ghost-back pick-ghost-back--${i}`, hidden: true }));
    this.ghostBadge = el('span', { class: 'pick-ghost-badge', hidden: true });
    this.ghost = el('div', { class: 'pick-ghost' }, [...this.ghostBacks, this.ghostShadow, this.ghostCanvas]);
    this.label = el('div', { class: 'pick-label', 'aria-live': 'polite' });
    this.hint = el('div', { class: 'pick-hint', hidden: true });
    this.root = el('div', { class: 'board-picker', hidden: true, 'aria-hidden': 'true' }, [
      this.scrimEl, this.grid, this.edges, this.ghost, this.ghostBadge, this.label, this.hint,
    ]);
    this.root.addEventListener('pointermove', this.onMove);
    this.root.addEventListener('pointerup', this.onUp);
    this.root.addEventListener('pointercancel', () => {
      if (this.phase === 'drag') this.cancel();
    });
    this.root.addEventListener('lostpointercapture', () => {
      if (this.phase === 'drag') this.cancel();
    });
    // 点选时往上滚 = 收起（和往下滚打开反过来）
    this.root.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (this.phase === 'browse' && e.deltaY < 0) this.cancel();
    }, { passive: false });
    document.addEventListener('keydown', (e) => {
      if ((this.phase === 'drag' || this.phase === 'browse') && e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.cancel();
      }
    }, true);
    window.addEventListener('resize', () => {
      if (this.phase === 'drag' || this.phase === 'browse') this.cancel();
    });
    window.addEventListener('blur', () => {
      if (this.phase === 'drag') this.cancel();
    });
  }

  get active(): boolean {
    return this.phase !== 'idle';
  }

  /**
   * 展开阵列（两种方式共用）。homeScale：舞台镜头的缩放（系列视图里玻璃格更小，原有的格子从那个大小出发）
   */
  private expand(mode: PickMode, homeScale: number): PickLayout {
    this.vw = window.innerWidth;
    this.vh = window.innerHeight;
    const u = Math.min(this.vh / 100, this.vw * 0.006) || 1;
    const boards = this.host.boards();
    const layout = (this.layout = pickerLayout(this.vw, this.vh, u, boards.length, homeScale));
    this.mode = mode;
    this.time = 0;
    this.hover = -1;
    this.returning = false;
    this.fadeHome = false;
    this.added = null;
    window.clearTimeout(this.closeTimer);
    set(this.scrim, 0);
    this.scrim.t = 1;
    while (this.pool.length < layout.tiles.length) this.pool.push(this.makeTile());
    const firstOuter = Math.min(...layout.tiles.filter((x) => !x.fromStage).map((x) => x.dist), Infinity);
    this.pool.forEach((n, i) => {
      const tile = layout.tiles[i] ?? null;
      n.tile = tile;
      n.root.hidden = !tile;
      if (!tile) return;
      set(n.q, 0);
      set(n.hov, 0);
      set(n.pulse, 0);
      n.target = 1;
      n.startAt = openDelay(tile, firstOuter);
      n.root.classList.remove('is-hover');
      const st = n.root.style;
      st.width = st.height = `${r3(layout.size)}px`;
      st.marginLeft = st.marginTop = `${r3(-layout.size / 2)}px`;
      this.fillTile(n, tile, tile.board >= 0 ? boards[tile.board] : null);
    });
    this.label.textContent = '';
    this.root.hidden = false;
    this.root.classList.add('is-open');
    this.root.classList.toggle('is-browse', mode === 'browse');
    return layout;
  }

  /** 拖起（画作或系列）：pointerId 之后的移动、松手都由这里接手 */
  open(src: LiftSource, pointerId: number, px: number, py: number, homeScale = 1): void {
    this.expand('drag', homeScale);
    this.phase = 'drag';
    this.hint.hidden = true;
    // 替身：按出发框的尺寸排版一次，之后只改 transform
    const r = src.rect;
    this.w0 = Math.max(1, r.w);
    this.h0 = Math.max(1, r.h);
    const s0 = src.startScale ?? 1;
    this.home = { cx: r.cx, cy: r.cy, s: s0 };
    this.fadeHome = !!src.stack;
    const gst = this.ghost.style;
    gst.width = `${r3(this.w0)}px`;
    gst.height = `${r3(this.h0)}px`;
    gst.visibility = '';
    this.paintCanvas(this.ghostCanvas, src.src, src.bg, src.art);
    this.ghostBacks.forEach((b, i) => {
      const back = src.stack?.backs[i];
      b.hidden = !back;
      if (back) this.paintCanvas(b, back.src, back.bg);
    });
    this.ghostBadge.hidden = !src.stack;
    this.ghostBadge.textContent = src.stack ? String(src.stack.count) : '';
    // 抓住的那一点（系列：标签中心）
    this.grab = src.stack ? { dx: 0, dy: 0 } : { dx: px - r.cx, dy: py - r.cy };
    this.pointer = { id: pointerId, x: px, y: py, t: performance.now(), vx: 0, vy: 0 };
    set(this.gx, r.cx);
    set(this.gy, r.cy);
    set(this.gs, s0);
    set(this.grot, 0);
    set(this.gtx, 0);
    set(this.gty, 0);
    set(this.gop, 1);
    set(this.glift, 0);
    this.glift.t = 1;
    this.aimGhost();
    // 画作：舞台上那张由替身接替；系列：舞台不动
    set(this.cardAlpha, src.stack ? 1 : 0);
    try {
      this.root.setPointerCapture(pointerId);
    } catch {
      /* 指针已经抬起：直接取消 */
      this.cancel();
    }
    this.host.kick();
  }

  /** 点选：没有替身，直接点格子 */
  browse(homeScale = 1): void {
    this.expand('browse', homeScale);
    this.phase = 'browse';
    this.ghost.style.visibility = 'hidden';
    set(this.gop, 0);
    set(this.cardAlpha, 1);
    this.hint.textContent = t('board.pickHint');
    this.hint.hidden = false;
    this.host.kick();
  }

  private paintCanvas(canvas: HTMLElement, src: string | undefined, bg: string, art?: (c: HTMLElement) => void): void {
    canvas.replaceChildren();
    canvas.style.background = bg;
    if (src) canvas.append(el('img', { src, alt: '', draggable: 'false' }));
    else art?.(canvas);
  }

  private liftScale(long: number): number {
    const S = this.layout?.size ?? 100;
    return Math.min(1, (S * long) / Math.max(this.w0, this.h0));
  }

  private makeTile(): TileNode {
    const art = el('div', { class: 'pick-art' });
    const name = el('span', { class: 'pick-name' });
    const count = el('span', { class: 'pick-count' });
    const body = el('div', { class: 'pick-body' }, [art, el('div', { class: 'pick-caption' }, [name, count])]);
    const root = el('div', { class: 'pick-tile' }, [body]);
    this.grid.append(root);
    return {
      root, body, art, name, count, q: scalar(0), hov: scalar(0), pulse: scalar(0),
      startAt: 0, target: 1, tile: null, boardId: null, role: '',
    };
  }

  /** 按格子的种类填内容（打开时，以及加进新情绪板之后） */
  private fillTile(n: TileNode, tile: PickTile, board: BoardPreview | null): void {
    const role = board ? 'board' : tile.role === 'board' ? 'empty' : tile.role;
    n.role = role;
    n.boardId = board?.id ?? null;
    n.root.className = `pick-tile pick-tile--${role}${n.root.classList.contains('is-hover') ? ' is-hover' : ''}`;
    n.art.replaceChildren();
    n.name.textContent = '';
    n.count.textContent = '';
    if (role === 'new') {
      n.art.append(svgIcon(ICON_PLUS, 22));
      n.name.textContent = t('board.new');
    } else if (role === 'add') {
      n.art.append(svgIcon(ICON_STACK, 22));
      n.name.textContent = t('board.addExisting');
    } else if (role === 'empty') {
      n.art.append(svgIcon(ICON_PLUS, 16));
      n.name.textContent = t('board.quickNew');
    } else if (board) {
      for (const it of board.items) {
        const m = el('span', { class: 'pick-mini' });
        const st = m.style;
        st.left = `${r3(it.x * 100)}%`;
        st.top = `${r3(it.y * 100)}%`;
        st.width = `${r3(it.w * 100)}%`;
        st.height = `${r3(it.h * 100)}%`;
        st.background = it.color ?? 'var(--color-chip)';
        st.setProperty('--ring', it.ring);
        if (it.url) m.append(el('img', { src: it.url, alt: '', draggable: 'false', decoding: 'async' }));
        n.art.append(m);
      }
      n.name.textContent = board.name;
      n.count.textContent = String(board.count);
    }
  }

  /** 情绪板预览的缩略图陆续生成好了：换上（只重画预览格） */
  refreshBoards(): void {
    if (this.phase !== 'drag' && this.phase !== 'browse') return;
    const boards = this.host.boards();
    for (const n of this.pool) {
      if (!n.tile || n.role !== 'board' || !n.boardId) continue;
      const b = boards.find((x) => x.id === n.boardId);
      if (b) this.fillTile(n, n.tile, b);
    }
  }

  // ───────────── 指针 ─────────────

  private onMove = (e: PointerEvent): void => {
    if (this.phase === 'browse') {
      this.setHover(this.hitTile(e.clientX, e.clientY));
      this.host.kick();
      return;
    }
    if (this.phase !== 'drag' || e.pointerId !== this.pointer.id) return;
    const p = this.pointer;
    const now = performance.now();
    const dt = Math.max(1, now - p.t) / 1000;
    // 指针速度（px/s），平滑一下：倾斜用
    p.vx = p.vx * 0.75 + ((e.clientX - p.x) / dt) * 0.25;
    p.vy = p.vy * 0.75 + ((e.clientY - p.y) / dt) * 0.25;
    p.x = e.clientX;
    p.y = e.clientY;
    p.t = now;
    this.setHover(this.hitTile(p.x, p.y));
    this.aimGhost();
    this.host.kick();
  };

  private hitTile(x: number, y: number): number {
    const L = this.layout;
    if (!L) return -1;
    const i = tileAt(L.tiles, L.size, L.pitch, x - this.vw / 2, y - this.vh / 2);
    // 还没浮出来的格子不算
    return i >= 0 && this.pool[i].q.v > 0.6 ? i : -1;
  }

  private setHover(i: number): void {
    if (i === this.hover) return;
    if (this.hover >= 0) {
      this.pool[this.hover].hov.t = 0;
      this.pool[this.hover].root.classList.remove('is-hover');
    }
    this.hover = i;
    if (i >= 0) {
      const n = this.pool[i];
      n.hov.t = 1;
      n.root.classList.add('is-hover');
    }
    this.label.textContent = i >= 0 && this.phase === 'drag' ? (this.pool[i].name.textContent ?? '') : '';
  }

  /**
   * 替身的目标：跟着指针（抓住的那一点随缩放一起缩）。最近的格子中心有一点吸力：
   * 权重 w = (1 − (d / 半个格距)²)²，正对中心时 1，到格子边上 0，在格子之间移动时位置和大小都是连续变化的
   */
  private aimGhost(): void {
    const p = this.pointer;
    const L = this.layout;
    let w = 0, tx = 0, ty = 0;
    if (L && this.hover >= 0) {
      const tile = L.tiles[this.hover];
      tx = this.vw / 2 + tile.x;
      ty = this.vh / 2 + tile.y;
      const d = Math.max(Math.abs(p.x - tx), Math.abs(p.y - ty)) / (L.pitch / 2);
      const k = clamp(1 - d * d, 0, 1);
      w = k * k;
    }
    const s = this.liftScale(LIFT_LONG + (HOVER_LONG - LIFT_LONG) * w);
    this.gs.t = s;
    let x = p.x - this.grab.dx * s, y = p.y - this.grab.dy * s;
    x += (tx - x) * MAGNET * w;
    y += (ty - y) * MAGNET * w;
    this.gx.t = x;
    this.gy.t = y;
    // 按速度倾斜：横着甩向那一侧转一点，俯仰 / 偏转像纸被空气推着（幅度都很小）
    const k = reducedMotion.matches ? 0 : 1;
    this.grot.t = clamp(p.vx * 0.003, -5, 5) * k;
    this.gty.t = clamp(p.vx * 0.006, -8, 8) * k;
    this.gtx.t = clamp(-p.vy * 0.006, -8, 8) * k;
  }

  private onUp = (e: PointerEvent): void => {
    if (this.phase === 'browse') {
      const i = this.hitTile(e.clientX, e.clientY);
      if (i >= 0) this.choose(i);
      return;
    }
    if (this.phase !== 'drag' || e.pointerId !== this.pointer.id) return;
    this.host.suppressClick();
    try {
      this.root.releasePointerCapture(e.pointerId);
    } catch {
      /* 忽略 */
    }
    const i = this.hover;
    if (i < 0 || !this.layout) {
      this.cancel();
      return;
    }
    this.label.textContent = '';
    // 落进格子：替身吸到格子中间、缩小摆正
    const tile = this.layout.tiles[i];
    this.gx.t = this.vw / 2 + tile.x;
    this.gy.t = this.vh / 2 + tile.y;
    this.gs.t = this.liftScale(LAND_LONG);
    this.grot.t = this.gtx.t = this.gty.t = 0;
    this.choose(i);
  };

  /** 落进 / 点了第 i 格：格子弹一下，交给 app 处理 */
  private choose(i: number): void {
    if (!this.layout) return;
    const n = this.pool[i];
    const tile = this.layout.tiles[i];
    const from = this.phase;
    this.phase = 'wait';
    n.pulse.vel = -3.2;
    const target: PickTarget =
      n.role === 'board' && n.boardId ? { kind: 'board', boardId: n.boardId } : { kind: n.role as 'new' | 'add' | 'empty' };
    const size = this.layout.size;
    const cx = this.vw / 2 + tile.x, cy = this.vh / 2 + tile.y;
    const anchor = { x: cx - size / 2, y: cy - size / 2, w: size, h: size };
    this.host.kick();
    void this.host.drop(target, anchor).then(
      (id) => this.landed(i, id, from),
      () => this.landed(i, null, from),
    );
  }

  /** app 处理完：加进去了就让格子换上新内容、替身被格子“吞”进去，再收起；取消就飞回去（点选时留着继续选） */
  private landed(i: number, id: string | null, from: Phase): void {
    if (this.phase !== 'wait') return;
    if (!id) {
      if (from === 'browse') {
        this.phase = 'browse';
        return;
      }
      this.cancel();
      return;
    }
    this.added = id;
    const n = this.pool[i];
    const preview = this.host.boards().find((b) => b.id === id) ?? null;
    if (n.tile && preview && n.role !== 'new' && n.role !== 'add') this.fillTile(n, n.tile, preview);
    // 加进的情绪板如果在阵列里（从“加入现有”选的），那一格也弹一下、刷新预览
    this.pool.forEach((m, k) => {
      if (k !== i && m.boardId === id && m.tile && preview) {
        this.fillTile(m, m.tile, preview);
        m.pulse.vel = -3.2;
      }
    });
    n.pulse.vel = -2.4;
    this.gs.t = this.liftScale(LAND_LONG * 0.55);
    this.gop.t = 0;
    this.glift.t = 0;
    this.host.kick();
    this.closeTimer = window.setTimeout(() => this.close(), from === 'browse' ? 260 : 380);
  }

  /** 取消：替身飞回原位（系列：缩回标签里淡出），阵列同时收起 */
  cancel(): void {
    if (this.phase === 'idle' || this.phase === 'close') return;
    if (this.mode === 'drag') {
      this.returning = true;
      this.gx.t = this.home.cx;
      this.gy.t = this.home.cy;
      this.gs.t = this.home.s;
      this.grot.t = this.gtx.t = this.gty.t = 0;
      this.gop.t = this.fadeHome ? 0 : 1;
      this.glift.t = 0;
    }
    this.close();
  }

  private close(): void {
    window.clearTimeout(this.closeTimer);
    const L = this.layout;
    this.phase = 'close';
    this.setHover(-1);
    this.label.textContent = '';
    this.hint.hidden = true;
    this.root.classList.remove('is-open');
    try {
      if (this.root.hasPointerCapture(this.pointer.id)) this.root.releasePointerCapture(this.pointer.id);
    } catch {
      /* 忽略 */
    }
    this.scrim.t = 0;
    for (const n of this.pool) {
      if (!n.tile) continue;
      n.target = 0;
      n.startAt = this.time + (L ? closeDelay(n.tile, L.maxDist) : 0);
    }
    // 加进去了：卡片在舞台上淡回来；取消：等替身飞回原位再交接
    if (!this.returning || this.fadeHome) this.cardAlpha.t = 1;
    this.host.kick();
  }

  // ───────────── 每帧 ─────────────

  /** 推进弹簧，返回是否还在动 */
  step(dt: number): boolean {
    if (this.phase === 'idle') return false;
    this.time += dt * 1000;
    let busy = false;
    // 指针不动时速度慢慢归零（倾斜回正）
    const p = this.pointer;
    if (this.phase === 'drag' && performance.now() - p.t > 40) {
      const k = Math.exp(-dt * 12);
      p.vx *= k;
      p.vy *= k;
      this.aimGhost();
      if (Math.abs(p.vx) + Math.abs(p.vy) > 2) busy = true;
    }
    const rm = reducedMotion.matches;
    const L = spring.lift, S = rm ? spring.reducedMotion : spring.liftScale;
    const T = rm ? spring.reducedMotion : spring.pickTile;
    busy = !stepScalar(this.gx, L, dt, 0.05) || busy;
    busy = !stepScalar(this.gy, L, dt, 0.05) || busy;
    busy = !stepScalar(this.gs, S, dt) || busy;
    busy = !stepScalar(this.grot, spring.liftTilt, dt, 0.01) || busy;
    busy = !stepScalar(this.gtx, spring.liftTilt, dt, 0.01) || busy;
    busy = !stepScalar(this.gty, spring.liftTilt, dt, 0.01) || busy;
    busy = !stepScalar(this.gop, spring.pickHover, dt) || busy;
    busy = !stepScalar(this.glift, S, dt) || busy;
    busy = !stepScalar(this.scrim, spring.boardOpen, dt) || busy;
    // 替身飞回原位：到了就交还给舞台（卡片立刻显示，替身藏起来，看不出交接）
    if (this.returning && !this.fadeHome && this.cardAlpha.t === 0) {
      const near = Math.abs(this.gx.v - this.home.cx) < 1.5 && Math.abs(this.gy.v - this.home.cy) < 1.5 && Math.abs(this.gs.v - 1) < 0.01;
      if (near) {
        set(this.cardAlpha, 1);
        this.gop.v = this.gop.t = 0;
      }
    }
    busy = !stepScalar(this.cardAlpha, spring.boardOpen, dt) || busy;
    for (const n of this.pool) {
      if (!n.tile) continue;
      if (this.time >= n.startAt && n.q.t !== n.target) n.q.t = n.target;
      if (n.q.t !== n.target) busy = true;
      busy = !stepScalar(n.q, T, dt) || busy;
      busy = !stepScalar(n.hov, spring.pickHover, dt) || busy;
      busy = !stepScalar(n.pulse, [300, 14], dt) || busy;
    }
    if (this.phase === 'close' && !busy) {
      this.phase = 'idle';
      this.root.hidden = true;
      set(this.cardAlpha, 1);
      this.host.finished(this.added, this.mode);
      return false;
    }
    return busy;
  }

  render(): void {
    if (this.phase === 'idle' || !this.layout) return;
    const L = this.layout;
    const sc = String(r3(clamp(this.scrim.v, 0, 1)));
    this.scrimEl.style.opacity = sc;
    this.edges.style.opacity = sc;
    this.hint.style.opacity = sc;
    // 悬停格子推开邻居
    const hov = this.hover >= 0 ? this.pool[this.hover] : null;
    const ht = hov?.tile ?? null;
    const hk = hov ? clamp(hov.hov.v, 0, 1.2) : 0;
    for (const n of this.pool) {
      const tile = n.tile;
      if (!tile) continue;
      const q = n.q.v;
      if (q <= 0.001 && n.target === 0) {
        if (n.root.style.visibility !== 'hidden') n.root.style.visibility = 'hidden';
        continue;
      }
      if (n.root.style.visibility === 'hidden') n.root.style.visibility = '';
      let x = tile.hx + (tile.x - tile.hx) * q;
      let y = tile.hy + (tile.y - tile.hy) * q;
      if (ht && n !== hov) {
        const dx = tile.x - ht.x, dy = tile.y - ht.y;
        const d = Math.hypot(dx, dy) / L.pitch;
        const fall = d < 1.6 ? 1 : d < 2.6 ? 1 - (d - 1.6) : 0;
        if (fall > 0) {
          x += (dx / (d * L.pitch)) * PUSH_PX * hk * fall;
          y += (dy / (d * L.pitch)) * PUSH_PX * hk * fall;
        }
      }
      const size = tile.size0 + (L.size - tile.size0) * q;
      const k = (size / L.size) * (1 + HOVER_GROW * n.hov.v) * (1 + 0.25 * n.pulse.v);
      n.root.style.transform = `translate3d(${r3(x)}px, ${r3(y)}px, 0) scale(${r3(Math.max(0, k))})`;
      // 原有的格子很快变实（它们在磨砂下面的“原身”同时被模糊掉）；新格子按进度淡入
      const op = tile.fromStage ? clamp(q * 3, 0, 1) : clamp(q * 1.6 - 0.15, 0, 1);
      n.root.style.opacity = String(r3(op));
      n.body.style.opacity = String(r3(clamp((q - 0.55) / 0.4, 0, 1)));
    }
    if (this.mode === 'browse') return;
    // 替身
    const gs = Math.max(0.01, this.gs.v);
    const gx = this.gx.v - this.w0 / 2, gy = this.gy.v - this.h0 / 2;
    const g = this.ghost.style;
    g.transform =
      `translate3d(${r3(gx)}px, ${r3(gy)}px, 0) perspective(700px) rotateX(${r3(this.gtx.v)}deg) rotateY(${r3(this.gty.v)}deg) rotateZ(${r3(this.grot.v)}deg) scale(${r3(gs)})`;
    g.opacity = String(r3(clamp(this.gop.v, 0, 1)));
    this.ghostShadow.style.opacity = String(r3(clamp(this.glift.v, 0, 1)));
    // 张数角标在替身外面单独摆（不跟着替身缩小），贴在右上角
    if (!this.ghostBadge.hidden) {
      const bs = this.ghostBadge.style;
      bs.transform = `translate3d(${r3(this.gx.v + (this.w0 * gs) / 2)}px, ${r3(this.gy.v - (this.h0 * gs) / 2)}px, 0) translate(-60%, -40%) scale(${r3(clamp(gs / this.liftScale(LIFT_LONG), 0, 1))})`;
      bs.opacity = g.opacity;
    }
    // 格子名字跟在替身下面
    const ls = this.label.style;
    ls.transform = `translate3d(${r3(this.gx.v)}px, ${r3(this.gy.v + (this.h0 * gs) / 2 + 14)}px, 0) translateX(-50%)`;
  }
}

function set(s: Scalar, v: number): void {
  s.v = s.t = v;
  s.vel = 0;
}
