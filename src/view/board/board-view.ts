// 情绪板画布（2026-11-18 新增）。几何在 engine/board-layout.ts，数据在 data/boards.ts。
//
// 画面（从下到上）：点阵背景 → 画布（所有照片，一个 transform 表示镜头）→ 对齐线、框选框 → 四周的渐进模糊 → 顶栏 → 全屏层。
//
// 交互：
// - 滚轮：空白处以光标为中心缩放画布；在照片上往上滚 = 单独放大这张（聚焦），往下滚 = 缩小 / 退出聚焦。
//   触控板双指滑动平移，捏合缩放。按住中键（或空格 + 左键）拖动画布
// - 左键拖照片：单独拿出来移动，靠近别的照片的边会被吸过去（隔一条缝，并且有一条边和它在同一直线上），
//   松手后加入那个集合；放在空白处就自己成一个集合。长按再拖：整个集合一起移动
// - 光标移到照片边缘：按住拖动调整大小（保持比例），拖动的那条边会对齐附近照片的边
// - 左键在空白处拖：框选；右键：一键全局优化 / 优化所选 / 优化这个集合 / 分离 / 移除等
// - 聚焦时：全向拖动画面，松手停到最近的照片；方向键换到那个方向的下一张；双击照片全屏
//
// 性能（2026-11-19 压测后改，几千张照片时）：
// - 画布是常驻的合成层：平移、缩放只改它的矩阵，不重绘照片；缩放停下 160ms 后、倍率偏离上次栅格化超过 8%
//   （或缩小到不到一半）才重新栅格化一次（去掉 will-change 一帧再加回来），只是让画面变清晰
// - 描边粗细（--bz）在缩放过程中跟着连续变，屏幕上一直是 1.5px：照片不多时每帧更新，很多时每变 22% 更新一次
//   （原来只在停下时更新，缩放中描边跟着画布一起变粗变细，停下时一下子跳回来）
// - 每帧只给弹簧在动（或刚停下、状态变了）的照片写样式
// - 视野裁剪：视野四周外扩半屏以外的照片 visibility: hidden，不加载图片
// - 照片多（> MINI_MIN_ITEMS 张）的情绪板，照片在屏幕上小时用 384 的小缩略图。换档只在镜头停下后做，带缓冲；
//   换图时先在后台解码好新图再换上，中间不会空一下（原来缩放中直接改 src，图片会一闪一闪）
// - 视野里照片特别多（> HEAVY_SHOWN 张，每张在屏幕上都很小）时进远景档：去掉泛光、阴影和圆角，只留描边。
//   只在停下重画时切换；照片不多的情绪板缩放时不会切（原来按倍率 0.3 切，缩放时泛光会突然出现 / 消失）
// - 视野里超过 HEAVY_SHOWN 张时，四边的背景模糊换成底色渐隐（背景模糊在下面的内容大面积变化时很贵）
// - 一次要移动超过 CROSSFADE_MIN 张时（一键优化等），画布整体淡出、换位置、再淡入，不逐张滑动
// - 聚焦时用一整块底色遮罩盖住其余照片（一个元素），不再逐张淡出；照片多时打开情绪板不逐张浮现
//
// 动效：镜头是临界阻尼弹簧；照片的位置、大小各有弹簧（吸附时用更硬的磁吸弹簧），整理时按阅读顺序错开 12ms 依次滑到新位置；
// 拿起的照片放大一点、阴影变深、按速度轻轻倾斜；打开情绪板时照片按离屏幕中心的距离依次浮现。
import { t } from '../../i18n';
import { el, svgIcon, Styled, ICON_COPY, ICON_FOLDER, ICON_PENCIL, ICON_PIN, ICON_PLUS, ICON_PREV, ICON_TRASH } from '../dom';
import type { CtxItem } from '../context-menu';
import { menuPoint } from '../context-menu';
import { scalar, stepScalar, type Scalar, type Spring } from '../../engine/springs';
import { clamp, r3 } from '../../engine/math';
import { isWheelNotch } from '../../engine/discrete';
import { magnifyTargets } from '../../engine/magnify';
import {
  BOARD_GAP, GROUP_GAP, PHOTO_MAX_RESIZE, PHOTO_MIN_SIDE, SNAP_PX, UNSNAP_PX, bounds, fitCam, focusCam, gather, nearestBox,
  neighborIn, overlap, readingOrder, repack, separate, shelfPack, snapPosition, toWorld, zoomAround,
  type Box, type Cam, type Guide, type Snap,
} from '../../engine/board-layout';
import {
  addGroup, addPhotos, groupColor, membersOf, mergeGroups, pruneGroups, removeItems, splitGroups, touchingGroups,
  type Board, type BoardItem, type PhotoSource,
} from '../../data/boards';
import { spring } from '../../tokens';
import { prefs, wheelCanToggleFullscreen } from '../../prefs';
import { markSvg, MOOD_BOARDS, WORDMARK_HEIGHT, writeMark } from '../wordmark';
import { MarkLayer } from './board-marks';
import { MARK_COLORS, contentBounds, type MarkTool } from '../../engine/marks';

/** 标注工具条的图标（2026-11-20）：选择、便签、箭头、直线、画笔、色卡 */
const ICON_CURSOR = ['M6 3l12 9-5.5 1.2L15 19l-2.5 1.2-2.6-5.8L6 18Z'];
const ICON_NOTE = ['M5 4h14v10l-6 6H5z', 'M13 20v-6h6'];
const ICON_ARROW = ['M5 19 19 5', 'M10 5h9v9'];
const ICON_LINE = ['M5 19 19 5'];
const ICON_SCRIBBLE = ['M4 16c2.5-5 4.5-6 5.5-4s-1 6 1.5 5.5S15 9 17.5 8s1.5 5 2.5 6'];
const ICON_SWATCH = ['M4 6h4v12H4z', 'M10 6h4v12h-4z', 'M16 6h4v12h-4z'];

const ICON_OPTIMIZE = ['M4 4h7v7H4z', 'M13 4h7v4h-7z', 'M13 10h7v10h-7z', 'M4 13h7v7H4z'];
const ICON_FIT = ['M4 9V4h5', 'M20 9V4h-5', 'M4 15v5h5', 'M20 15v5h-5'];
const ICON_MERGE = ['M4 4h6v6H4z', 'M14 14h6v6h-6z', 'M10 7h4a3 3 0 0 1 3 3v4'];
const ICON_DETACH = ['M8 8h8v8H8z', 'M3 3l3 3', 'M21 21l-3-3', 'M21 3l-3 3', 'M3 21l3-3'];

export interface BoardViewHost {
  kick(): void;
  toast(msg: string, action?: { label: string; run: () => void }): void;
  contextMenu(items: CtxItem[], x: number, y: number, label: string): void;
  /** 回到预览 */
  back(): void;
  /** 改动后稍后写盘 */
  save(): void;
  /** 照片的缩略图地址（还没生成就排队，好了会调 refreshImages）；mini = 要 384 的小缩略图 */
  thumb(it: BoardItem, mini: boolean): string | undefined;
  /** 原图（停留 300ms 后才要）：解码好之后回调 */
  hiRes(it: BoardItem, done: (url: string) => void): void;
  /** 系统全屏 */
  setFullscreen(on: boolean): void;
  /** 选择图片文件加进来（桌面版） */
  pickImages(): Promise<PhotoSource[]>;
  copyImage(it: BoardItem): void;
  reveal(it: BoardItem): void;
  /** 改情绪板名字（浮层） */
  rename(x: number, y: number): void;
  /** 示例数据的占位图（浏览器调试） */
  paintSample(it: BoardItem, canvas: HTMLElement): void;
  /** 把这个情绪板弹成置顶参考小窗（2026-11-20，只读） */
  openReference?(): void;
  /** 一张照片的主色（最多 5 个，生成色卡用，2026-11-20） */
  swatchesFor(it: BoardItem): Promise<string[]>;
  desktop: boolean;
}

interface Node {
  it: BoardItem;
  el: HTMLElement;
  st: Styled;
  canvas: HTMLElement;
  img: HTMLImageElement | null;
  src: string;
  x: Scalar;
  y: Scalar;
  w: Scalar;
  /** 拿起来的程度（放大、阴影、倾斜） */
  lift: Scalar;
  /** 出现 0–1（打开情绪板、新加进来时依次浮现） */
  appear: Scalar;
  appearAt: number;
  /** 整理时错开出发 */
  moveAt: number;
  pending: Box | null;
  sp: Spring;
  /** 当前排版宽高（px）：大小变了才改，平时只改 transform */
  lw: number;
  lh: number;
  tilt: Scalar;
  color: string;
  /** 这一帧要重写样式（大小、可见性、全屏交接变了） */
  dirty: boolean;
  /** 上一帧弹簧还在动：这一帧停下了，要把最终值写一次 */
  wasMoving: boolean;
  /** 在视野里（四周外扩半屏）：不在的不绘制、不加载图片 */
  shown: boolean;
  /** 用哪一档图片：mini = 长边 384 的小缩略图，full = 1600 缩略图（或原图） */
  lod: 'mini' | 'full';
  /** 拿起来了：单独一个合成层，显示深阴影 */
  liftOn: boolean;
}

type Drag =
  | { kind: 'pan'; id: number; x0: number; y0: number; cam0: Cam }
  | { kind: 'marquee'; id: number; x0: number; y0: number; x1: number; y1: number; base: Set<string> }
  | { kind: 'press'; id: number; x0: number; y0: number; node: Node; shift: boolean; timer: number }
  | {
    kind: 'move'; id: number; x0: number; y0: number; nodes: Node[]; starts: { x: number; y: number }[];
    snap: Snap | null; whole: boolean; lastX: number; lastT: number; vx: number;
  }
  | { kind: 'resize'; id: number; x0: number; y0: number; node: Node; handle: string; box0: Box }
  | { kind: 'focus'; id: number; x0: number; y0: number; cam0: Cam; samples: { t: number; x: number; y: number }[]; moved: boolean };

/** 系统开启“减少动态效果”：照片不倾斜、不依次浮现，整理时不回弹 */
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/** 长按多久算“拎起整个集合” */
const HOLD_MS = 380;
/** 按下后移动超过这么多 px 才算拖动 */
const DRAG_PX = 4;
/** 照片边缘多宽算调整大小的把手（屏幕 px，里外各算一部分） */
const EDGE_OUT = 7;
const EDGE_IN = 6;
/** 点阵间距（画布 px）：细点每 24，粗点每 4 格 */
const DOT = 24;
/** 镜头动到这里才算静止（画布 px / 缩放） */
const CAM_EPS = 0.02;
/** 照片总数不超过这么多时，缩放过程中每帧更新描边粗细（重算样式、重画不贵）；更多时每变 22% 才更新一次 */
const BZ_LIVE_MAX = 800;
/** 照片在屏幕上的长边（物理像素）小于 MINI_IN 时换成 384 的小缩略图，大于 MINI_OUT 时换回 1600 的（中间不动，来回缩放不会反复换） */
const MINI_IN = 320;
const MINI_OUT = 380;
/** 照片多于这么多张的情绪板才用小缩略图（照片少时 1600 的缩略图解码也不费事，不用换来换去） */
const MINI_MIN_ITEMS = 150;
/** 照片多于这么多张在视野里时，打开情绪板不逐张浮现（整个画布一起淡入） */
const STAGGER_MAX = 60;
/** 视野里多于这么多张：四边不做背景模糊，换成底色渐隐 */
const HEAVY_SHOWN = 600;
/** 一次要移动多于这么多张：整体淡出淡入，不逐张滑动 */
const CROSSFADE_MIN = 600;

export class BoardView {
  readonly root: HTMLElement;
  private dots: Styled;
  private dotsMajor: Styled;
  private world: Styled;
  private guides: SVGSVGElement;
  private guideLines: SVGLineElement[] = [];
  private marquee: Styled;
  private bar: HTMLElement;
  /** 顶栏最左边的手写字标「Mood boards」（替换预览里的 Peekit） */
  private mark: SVGSVGElement;
  private titleBtn: HTMLButtonElement;
  private titleText: Styled;
  private countText: Styled;
  private zoomBtn: HTMLButtonElement;
  private zoomText: Styled;
  private empty: HTMLElement;
  private full: HTMLElement;
  private fullBg: Styled;
  private fullImg: HTMLImageElement;
  private fullSt: Styled;
  private fullCanvas: HTMLElement;

  board: Board | null = null;
  private nodes = new Map<string, Node>();
  private order: Node[] = [];
  private cam = { x: scalar(0), y: scalar(0), z: scalar(1) };
  /** 打开 / 关上 0–1 */
  private op = scalar(0);
  private time = 0;
  private drag: Drag | null = null;
  private selected = new Set<string>();
  private focus: { id: string; prev: Cam } | null = null;
  private fullState: { id: string; t: Scalar; rect0: { cx: number; cy: number; w: number; h: number } } | null = null;
  private hiResUrl: { id: string; url: string } | null = null;
  private hiResTimer = 0;
  private targetGroup: string | null = null;
  private space = false;
  private vw = window.innerWidth;
  private vh = window.innerHeight;
  private wheelPanTimer = 0;
  private zoomShownAt = 0;
  /** 这一帧要重写样式的照片（step 里收集） */
  private live: Node[] = [];
  /** 画布层上次按哪个倍率栅格化 */
  private rasterZ = 1;
  /** 1 = 上一帧去掉了 will-change，这一帧加回来 */
  private rasterPhase = 0;
  private far = false;
  /** 要不要进远景档、当前写进去的描边倍率 */
  private wantFar = false;
  /** 镜头动过、还没在停下后重新挑缩略图档位 */
  private lodPending = false;
  private bzSet = 1;
  private lastCam = { tx: NaN, ty: NaN, z: NaN };
  private camChangedAt = 0;
  private cullAt = 0;
  /** 拿到最上面的照片用递增的 z-index，不用给所有照片重新编号 */
  private zTop = 0;
  /** 上次画出来的选中状态（只改变化了的） */
  private shownSel = new Set<string>();
  /** 聚焦时盖住其余照片的底色遮罩（画布里的一个元素） */
  private dim: Styled;
  private groupColors = new Map<string, string>();
  private heavy = false;
  /** 大量照片一起换位置时画布的淡出淡入（0–1）；淡到底时把位置一次换好，见 crossfade */
  private fade = scalar(1);
  private fadeApply: (() => void) | null = null;
  /** 标注层（2026-11-20）和底部的工具条 */
  private marks: MarkLayer;
  private toolBtns = new Map<MarkTool, HTMLButtonElement>();
  private colorDots: HTMLButtonElement[] = [];
  private shownColor = -1;

  constructor(private host: BoardViewHost) {
    const dots = el('div', { class: 'board-dots' });
    const major = el('div', { class: 'board-dots board-dots--major' });
    this.dots = new Styled(dots);
    this.dotsMajor = new Styled(major);
    const world = el('div', { class: 'board-world' });
    this.world = new Styled(world);
    const dim = el('div', { class: 'board-dim', 'aria-hidden': 'true' });
    world.append(dim);
    this.dim = new Styled(dim);
    const NS = 'http://www.w3.org/2000/svg';
    this.guides = document.createElementNS(NS, 'svg');
    this.guides.setAttribute('class', 'board-guides');
    for (let i = 0; i < 5; i++) {
      const l = document.createElementNS(NS, 'line');
      this.guides.append(l);
      this.guideLines.push(l);
    }
    const marquee = el('div', { class: 'board-marquee', hidden: true });
    this.marquee = new Styled(marquee);
    const edges = ['t', 'b', 'l', 'r'].map((s) => el('div', { class: `board-edge board-edge--${s}`, 'aria-hidden': 'true' }));

    // 顶栏：返回预览 + 情绪板名字（点一下改名）+ 张数；右下角缩放倍率（点一下显示全部）
    const back = el('button', { type: 'button', class: 'board-back', 'data-i18n-title': 'board.back', 'data-i18n-aria': 'board.back' }, [
      svgIcon(ICON_PREV, 16), el('span', { 'data-i18n': 'board.backShort' }),
    ]);
    back.addEventListener('click', () => this.host.back());
    const name = el('span', { class: 'board-title-name' });
    const count = el('span', { class: 'board-title-count' });
    this.titleText = new Styled(name);
    this.countText = new Styled(count);
    this.titleBtn = el('button', { type: 'button', class: 'board-title', 'data-i18n-title': 'board.renameHint' }, [name, count]);
    this.titleBtn.addEventListener('click', () => {
      const r = this.titleBtn.getBoundingClientRect();
      this.host.rename(r.left, r.bottom + 8);
    });
    this.mark = markSvg(MOOD_BOARDS, WORDMARK_HEIGHT, 'board-mark');
    this.bar = el('div', { class: 'board-bar' }, [
      this.mark, back, el('span', { class: 'board-bar-sep', 'aria-hidden': 'true' }), this.titleBtn,
    ]);
    const zt = el('span');
    this.zoomText = new Styled(zt);
    this.zoomBtn = el('button', { type: 'button', class: 'board-zoom', 'data-i18n-title': 'board.fit' }, [svgIcon(ICON_FIT, 14), zt]);
    this.zoomBtn.addEventListener('click', () => this.fitAll());
    this.empty = el('div', { class: 'board-empty', hidden: true }, [
      el('p', { class: 'board-empty-title', 'data-i18n': 'board.emptyTitle' }),
      el('p', { class: 'board-empty-hint', 'data-i18n': 'board.emptyHint' }),
    ]);
    // 全屏层：深色底 + 一张图（从照片在画布上的位置长出来）
    this.fullBg = new Styled(el('div', { class: 'board-full-bg' }));
    this.fullCanvas = el('div', { class: 'board-full-canvas' });
    this.fullImg = el('img', { class: 'board-full-img', alt: '', draggable: 'false', decoding: 'async' });
    this.fullCanvas.append(this.fullImg);
    this.fullSt = new Styled(this.fullCanvas);
    this.full = el('div', { class: 'board-full', hidden: true }, [this.fullBg.el, this.fullCanvas]);
    this.full.addEventListener('dblclick', () => this.closeFull());
    this.full.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.deltaY > 0) this.closeFull();
    }, { passive: false });

    // 标注层（2026-11-20）：在画布里、所有照片上面
    this.marks = new MarkLayer({
      zoom: () => this.cam.z.v,
      toWorld: (sx, sy) => toWorld(this.camNow(), sx, sy, this.vw, this.vh),
      changed: () => {
        if (this.board) this.board.updatedAt = Date.now();
        this.host.save();
        this.host.kick();
      },
      toast: (msg, action) => this.host.toast(msg, action),
      contextMenu: (items, x, y, label) => this.host.contextMenu(items, x, y, label),
      clearPhotoSelection: () => this.select([]),
      toolDone: () => this.setTool('select'),
    });
    world.append(this.marks.el);
    const tools = this.buildTools();

    const canvas = el('div', { class: 'board-canvas', tabindex: 0, 'data-i18n-aria': 'board.aria' }, [
      dots, major, world, this.guides, marquee, this.empty, ...edges,
    ]);
    this.root = el('section', { class: 'board', hidden: true }, [
      canvas,
      el('div', { class: 'board-drag', 'data-tauri-drag-region': '' }),
      this.bar,
      this.zoomBtn,
      tools,
      this.full,
    ]);
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onHover);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('dblclick', this.onDblClick);
    canvas.addEventListener('contextmenu', this.onContext);
    canvas.addEventListener('auxclick', (e) => e.preventDefault());
    // 捕获阶段：情绪板开着时先于舞台的按键处理（Esc 不会被舞台当成“推回镜头”吃掉）
    document.addEventListener('keydown', this.onKey, true);
    document.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.space = false;
    });
    window.addEventListener('resize', () => {
      this.vw = window.innerWidth;
      this.vh = window.innerHeight;
      if (this.focus) this.focusOn(this.nodes.get(this.focus.id) ?? null);
      this.host.kick();
    });
  }

  private get canvasEl(): HTMLElement {
    return this.root.firstElementChild as HTMLElement;
  }

  // ───────────── 标注工具条（2026-11-20） ─────────────

  /** 底部正中：选择 / 便签 / 箭头 / 直线 / 画笔 │ 5 个颜色 */
  private buildTools(): HTMLElement {
    const tools: [MarkTool, string[], string][] = [
      ['select', ICON_CURSOR, 'V'], ['note', ICON_NOTE, 'N'], ['arrow', ICON_ARROW, 'A'], ['line', ICON_LINE, 'L'], ['pen', ICON_SCRIBBLE, 'P'],
    ];
    const btns = tools.map(([k, icon, key]) => {
      const label = t('check.withKey', { name: t(`marks.tool.${k}`), key });
      const b = el('button', { type: 'button', class: 'board-tool', 'aria-pressed': String(k === 'select'), 'aria-label': label, title: label }, [svgIcon(icon, 18)]);
      b.addEventListener('click', () => this.setTool(k));
      this.toolBtns.set(k, b);
      return b;
    });
    this.colorDots = MARK_COLORS.map((c, i) => {
      const label = t(`marks.color.${c.key}`);
      const b = el('button', { type: 'button', class: 'board-tool-color', 'aria-pressed': String(i === 0), 'aria-label': label, title: label }, [el('span')]);
      (b.firstElementChild as HTMLElement).style.background = c.ink;
      b.addEventListener('click', () => {
        this.marks.setColor(i);
        this.paintToolColors();
      });
      return b;
    });
    const bar = el('div', { class: 'board-tools', role: 'toolbar', 'data-i18n-aria': 'marks.toolbar' }, [
      ...btns, el('span', { class: 'board-tools-sep', 'aria-hidden': 'true' }), ...this.colorDots,
    ]);
    bar.addEventListener('pointerdown', (e) => e.stopPropagation());
    return bar;
  }

  private setTool(k: MarkTool): void {
    this.marks.tool = k;
    for (const [key, b] of this.toolBtns) b.setAttribute('aria-pressed', String(key === k));
    this.root.dataset.tool = k;
    if (k !== 'select') this.marks.select(null);
  }

  /** 色点：选中了标注就亮它的颜色，否则亮新标注会用的颜色（每帧调，没变不改 DOM） */
  private paintToolColors(): void {
    const c = this.marks.selectedColor() ?? this.marks.color;
    if (c === this.shownColor) return;
    this.shownColor = c;
    this.colorDots.forEach((b, i) => b.setAttribute('aria-pressed', String(i === c)));
  }

  /** 右键照片“生成色卡”：取它的主色，在右边放一张色卡 */
  private async makeSwatch(it: BoardItem): Promise<void> {
    const colors = await this.host.swatchesFor(it).catch(() => [] as string[]);
    if (!colors.length) {
      this.host.toast(t('marks.swatchFailed'));
      return;
    }
    this.marks.addSwatch(colors, it);
  }

  get isOpen(): boolean {
    return this.op.t > 0.5;
  }

  /** 完全盖住舞台了（舞台可以不画） */
  get covering(): boolean {
    return this.op.v > 0.999 && this.op.t === 1;
  }

  get fullscreen(): boolean {
    return !!this.fullState && this.fullState.t.t === 1;
  }

  // ───────────── 打开 / 关上 ─────────────

  open(board: Board, focusItem?: string): void {
    this.board = board;
    this.selected.clear();
    this.focus = null;
    this.closeFullNow();
    this.drag = null;
    this.rebuild();
    this.marks.setBoard(board);
    this.setTool('select');
    this.updateTitle();
    const vw = this.vw, vh = this.vh;
    const cam = board.cam ?? fitCam(contentBounds(board.items, board.marks), vw, vh);
    setCam(this.cam, cam);
    this.root.hidden = false;
    this.root.classList.remove('is-focus');
    this.dim.el.classList.remove('is-on');
    // 画布层按当前倍率栅格化；远景档、描边粗细跟着定
    this.rasterZ = cam.z;
    this.rasterPhase = 0;
    this.world.set('will-change', 'transform');
    this.setBz(cam.z);
    this.cull();
    this.setFar();
    if (this.op.v < 0.01) {
      this.op.v = 0;
      this.time = 0;
      // 照片按离屏幕中心的距离依次浮现；视野里照片太多时不逐张浮现（整个画布一起淡入）
      const vis = this.order.filter((n) => n.shown);
      if (vis.length <= STAGGER_MAX) this.staggerAppear(vis, 40);
      // Peekit 跟着舞台一起被情绪板盖住淡出，然后 Mood boards 按笔顺写出来
      writeMark(this.mark, MOOD_BOARDS);
    }
    this.op.t = 1;
    if (focusItem) {
      const n = this.nodes.get(focusItem);
      if (n) {
        const fc = fitCam(bounds(board.items), vw, vh);
        // 新加进来的照片不在视野里：镜头移过去
        const inView = Math.abs(n.it.x + n.it.w / 2 - cam.x) * cam.z < vw / 2 && Math.abs(n.it.y + n.it.h / 2 - cam.y) * cam.z < vh / 2;
        if (!inView) setCamTarget(this.cam, fc);
        this.selected.add(focusItem);
      }
    }
    this.canvasEl.focus({ preventScroll: true });
    this.host.kick();
  }

  close(): void {
    if (!this.board) return;
    this.rememberCam();
    this.closeFull();
    this.focus = null;
    this.root.classList.remove('is-focus');
    this.dim.el.classList.remove('is-on');
    this.op.t = 0;
    this.host.save();
    this.host.kick();
  }

  /** 换了别的情绪板 / 情绪板被删掉 */
  detach(): void {
    this.board = null;
    this.marks.setBoard(null);
    for (const n of this.order) n.el.remove();
    this.nodes.clear();
    this.order = [];
    this.op.v = this.op.t = 0;
    this.root.hidden = true;
  }

  private rememberCam(): void {
    if (!this.board) return;
    const c = this.focus?.prev ?? { x: this.cam.x.t, y: this.cam.y.t, z: this.cam.z.t };
    this.board.cam = { x: Math.round(c.x * 10) / 10, y: Math.round(c.y * 10) / 10, z: Math.round(c.z * 1000) / 1000 };
  }

  updateTitle(): void {
    const b = this.board;
    if (!b) return;
    this.titleText.text(b.name);
    this.countText.text(t('board.count', { n: b.items.length }));
    this.empty.hidden = b.items.length > 0;
  }

  // ───────────── 节点 ─────────────

  private rebuild(): void {
    const b = this.board;
    for (const n of this.order) n.el.remove();
    this.nodes.clear();
    this.order = [];
    if (!b) return;
    this.shownSel = new Set();
    for (const it of b.items) this.addNode(it);
    this.restack();
    this.syncColors();
  }

  private addNode(it: BoardItem): Node {
    // 一张照片只有一个 div（里面一张 <img>）：描边、泛光、阴影都是它自己的 box-shadow，不用伪元素和包一层的 span
    // （2026-11-19 压测：几千张时每多一个带层级的伪元素就多几千个绘制层）
    const node = el('div', { class: 'board-item', 'data-id': it.id });
    const n: Node = {
      it, el: node, st: new Styled(node), canvas: node, img: null, src: '',
      x: scalar(it.x), y: scalar(it.y), w: scalar(it.w), lift: scalar(0), appear: scalar(1), appearAt: 0, moveAt: 0,
      pending: null, sp: spring.boardItem, lw: 0, lh: 0, tilt: scalar(0), color: '',
      dirty: true, wasMoving: false, shown: true, lod: 'full', liftOn: false,
    };
    this.world.el.append(node);
    this.nodes.set(it.id, n);
    this.order.push(n);
    return n;
  }

  /**
   * 照片内容：原图（聚焦 / 全屏时）或这一档的缩略图；还没好时已经有图就先留着，没有就用主色 / 示例色块。
   * 只给视野里的照片调用（见 cull）
   */
  private paint(n: Node): void {
    const it = n.it;
    const hi = this.hiResUrl && this.hiResUrl.id === it.id ? this.hiResUrl.url : undefined;
    const url = hi ?? this.host.thumb(it, n.lod === 'mini');
    if (!url) {
      if (n.src) return;
      if (it.shapes) {
        n.src = 'shapes';
        n.img = null;
        this.host.paintSample(it, n.canvas);
      } else {
        n.canvas.style.background = it.color ?? 'var(--color-chip)';
      }
      return;
    }
    if (url === n.src) return;
    n.src = url;
    n.canvas.style.background = it.color ?? 'var(--color-chip)';
    if (n.img && n.img.getAttribute('src')) {
      // 已经有图（换档、换原图）：先在后台解码好再换上，直接改 src 的话新图出来之前会空一下
      const img = n.img;
      const pre = new Image();
      pre.decoding = 'async';
      pre.src = url;
      let done = false;
      const swap = () => {
        if (done) return;
        done = true;
        if (n.src === url && n.img === img) img.src = url;
      };
      pre.decode().then(swap, swap);
      // 万一一直解码不完（窗口在后台时可能被推迟），0.8 秒后照样换上
      window.setTimeout(swap, 800);
      return;
    }
    if (!n.img) {
      n.img = el('img', { alt: '', draggable: 'false', decoding: 'async' });
      n.canvas.replaceChildren(n.img);
    }
    n.img.src = url;
  }

  /** 缩略图到位 / 原图解码好了：换上（视野外的等进视野再说） */
  refreshImages(): void {
    for (const n of this.order) if (n.shown) this.paint(n);
    if (this.fullState) this.paintFull();
  }

  /**
   * 视野裁剪：当前镜头和目标镜头的视野（四周各外扩半屏）的并集以外的照片不绘制、不加载图片；
   * 范围里的照片按目标倍率下在屏幕上的大小挑缩略图档位
   */
  private cull(final = false): void {
    if (!this.board) return;
    this.cullAt = performance.now();
    const vw = this.vw, vh = this.vh;
    const cams = [this.camNow(), this.camTarget()];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of cams) {
      const hw = vw / c.z, hh = vh / c.z;
      x0 = Math.min(x0, c.x - hw);
      x1 = Math.max(x1, c.x + hw);
      y0 = Math.min(y0, c.y - hh);
      y1 = Math.max(y1, c.y + hh);
    }
    const need = this.cam.z.t * (window.devicePixelRatio || 1);
    const useMini = this.order.length > MINI_MIN_ITEMS;
    const fid = this.fullState?.id;
    let shownCount = 0;
    for (const n of this.order) {
      const it = n.it;
      const x = Math.min(n.x.v, it.x), y = Math.min(n.y.v, it.y);
      const w = Math.max(n.w.v, it.w), h = w * (it.h / it.w);
      const inside = n.liftOn || it.id === fid || !(x > x1 || x + w + Math.abs(n.x.v - it.x) < x0 || y > y1 || y + h + Math.abs(n.y.v - it.y) < y0);
      if (inside !== n.shown) {
        n.shown = inside;
        n.dirty = true;
      }
      if (!inside) continue;
      shownCount++;
      // 缩略图档位：已经有图的只在镜头停下后（final）才换，带缓冲；还没图的直接按现在该用的档
      let lod: 'mini' | 'full' = n.lod;
      if (!useMini) lod = 'full';
      else if (final || !n.src) {
        const px = Math.max(it.w, it.h) * need;
        if (px < MINI_IN) lod = 'mini';
        else if (px > MINI_OUT) lod = 'full';
        else if (!n.src) lod = 'mini';
      }
      if (lod !== n.lod || !n.src) {
        n.lod = lod;
        this.paint(n);
      }
    }
    const heavy = shownCount > HEAVY_SHOWN;
    this.wantFar = heavy;
    if (heavy !== this.heavy) {
      this.heavy = heavy;
      this.root.classList.toggle('is-heavy', heavy);
    }
  }

  /** 远景档（视野里照片特别多时）：去掉泛光、阴影和圆角。只在停下重画时调用，缩放过程中不切 */
  private setFar(): void {
    if (this.wantFar === this.far) return;
    this.far = this.wantFar;
    this.world.el.classList.toggle('is-far', this.far);
  }

  /** 描边粗细按这个倍率算（屏幕上 1.5px） */
  private setBz(z: number): void {
    this.bzSet = z;
    this.world.set('--bz', String(Math.round(z * 10000) / 10000));
  }

  /** 画布层需要按新倍率重新栅格化：放大超过 8%（会糊）、缩小到不到 1/1.8（太费内存），或远景档要换 */
  private needsReraster(z: number): boolean {
    return z > this.rasterZ * 1.08 || z < this.rasterZ / 1.8 || this.wantFar !== this.far;
  }

  /**
   * 镜头停下 160ms 后，倍率偏离上次栅格化太多：去掉 will-change 一帧再加回来，浏览器按新倍率重画一次画布层
   * （动的时候一直是合成层缩放，不重画）。同时更新描边粗细、远景档和视野裁剪
   */
  private updateRaster(zo: number, now: number): void {
    if (this.rasterPhase === 1) {
      this.world.set('will-change', 'transform');
      this.rasterPhase = 0;
      return;
    }
    if (now - this.camChangedAt < 160 || !this.needsReraster(zo)) return;
    this.rasterZ = zo;
    this.setBz(zo);
    this.cull();
    this.setFar();
    this.world.set('will-change', 'auto');
    this.rasterPhase = 1;
    this.host.kick();
  }

  /** 按 board.items 的顺序排上下层 */
  private restack(): void {
    const b = this.board;
    if (!b) return;
    const idx = new Map(b.items.map((it, i) => [it.id, i]));
    this.order.sort((p, q) => (idx.get(p.it.id) ?? 0) - (idx.get(q.it.id) ?? 0));
    this.order.forEach((n, i) => n.st.set('z-index', String(i + 1)));
    this.zTop = this.order.length + 1;
  }

  /** 拿起的照片放到最上面：数据里挪到最后（保存上下层），界面上只改它们自己的 z-index */
  private toFront(nodes: Node[]): void {
    const b = this.board;
    if (!b) return;
    const ids = new Set(nodes.map((n) => n.it.id));
    b.items = [...b.items.filter((it) => !ids.has(it.id)), ...b.items.filter((it) => ids.has(it.id))];
    const set = new Set(nodes);
    this.order = [...this.order.filter((n) => !set.has(n)), ...nodes];
    for (const n of nodes) n.st.set('z-index', String(++this.zTop));
  }

  private staggerAppear(nodes: Node[], base: number): void {
    if (reducedMotion.matches) return;
    const c = this.camNow();
    for (const n of nodes) {
      const sx = (n.it.x + n.it.w / 2 - c.x) * c.z, sy = (n.it.y + n.it.h / 2 - c.y) * c.z;
      n.appear.v = 0;
      n.appear.vel = 0;
      n.appear.t = 0;
      n.appearAt = this.time + base + Math.min(320, Math.hypot(sx, sy) * 0.28);
    }
  }

  // ───────────── 镜头 ─────────────

  private camNow(): Cam {
    return { x: this.cam.x.v, y: this.cam.y.v, z: this.cam.z.v };
  }

  private camTarget(): Cam {
    return { x: this.cam.x.t, y: this.cam.y.t, z: this.cam.z.t };
  }

  fitAll(): void {
    const b = this.board;
    if (!b) return;
    this.exitFocus(false);
    setCamTarget(this.cam, fitCam(contentBounds(b.items, b.marks), this.vw, this.vh));
    this.showZoom();
    this.host.kick();
  }

  private showZoom(): void {
    this.zoomShownAt = performance.now();
  }

  // ───────────── 聚焦（单张放大）和全屏 ─────────────

  private focusOn(n: Node | null): void {
    if (!n) return;
    const prev = this.focus?.prev ?? this.camTarget();
    this.focus = { id: n.it.id, prev };
    this.root.classList.add('is-focus');
    // 一整块底色遮罩盖住其余照片，聚焦的那张放到遮罩上面（只动两个元素）
    const bb = bounds(this.board?.items ?? []);
    const pad = Math.max(this.vw, this.vh) * 4 / Math.max(0.05, this.cam.z.t);
    this.dim.set('transform', `translate(${r3(bb.x - pad)}px, ${r3(bb.y - pad)}px)`);
    this.dim.set('width', `${r3(bb.w + pad * 2)}px`);
    this.dim.set('height', `${r3(bb.h + pad * 2)}px`);
    this.dim.set('z-index', String(++this.zTop));
    n.st.set('z-index', String(++this.zTop));
    this.dim.el.classList.add('is-on');
    setCamTarget(this.cam, focusCam(n.it, this.vw, this.vh));
    this.requestHiRes(n.it);
    this.host.kick();
  }

  private exitFocus(restore = true): void {
    if (!this.focus) return;
    const prev = this.focus.prev;
    this.focus = null;
    this.root.classList.remove('is-focus');
    this.dim.el.classList.remove('is-on');
    if (restore) setCamTarget(this.cam, prev);
    this.requestHiRes(null);
    this.host.kick();
  }

  private requestHiRes(it: BoardItem | null): void {
    window.clearTimeout(this.hiResTimer);
    if (!it) return;
    if (this.hiResUrl?.id === it.id) return;
    this.hiResTimer = window.setTimeout(() => {
      this.host.hiRes(it, (url) => {
        const want = this.focus?.id ?? this.fullState?.id;
        if (want !== it.id) return;
        this.hiResUrl = { id: it.id, url };
        this.refreshImages();
        this.host.kick();
      });
    }, 300);
  }

  private screenRect(it: BoardItem): { cx: number; cy: number; w: number; h: number } {
    const c = this.camNow();
    return {
      cx: (it.x + it.w / 2 - c.x) * c.z + this.vw / 2,
      cy: (it.y + it.h / 2 - c.y) * c.z + this.vh / 2,
      w: it.w * c.z,
      h: it.h * c.z,
    };
  }

  openFull(n: Node): void {
    const rect0 = this.screenRect(n.it);
    this.fullState = { id: n.it.id, t: scalar(0), rect0 };
    this.fullState.t.t = 1;
    this.full.hidden = false;
    this.paintFull();
    this.layoutFull();
    this.requestHiRes(n.it);
    this.host.setFullscreen(true);
    this.host.kick();
  }

  private paintFull(): void {
    const f = this.fullState;
    if (!f) return;
    const n = this.nodes.get(f.id);
    if (!n) return;
    const hi = this.hiResUrl && this.hiResUrl.id === f.id ? this.hiResUrl.url : undefined;
    const url = hi ?? this.host.thumb(n.it, false) ?? '';
    if (!url && n.it.shapes) {
      // 示例数据（浏览器调试）：用色块画
      this.host.paintSample(n.it, this.fullCanvas);
      return;
    }
    if (this.fullImg.parentNode !== this.fullCanvas) this.fullCanvas.replaceChildren(this.fullImg);
    if (this.fullImg.getAttribute('src') !== url) {
      if (url) this.fullImg.src = url;
      else this.fullImg.removeAttribute('src');
    }
    this.fullCanvas.style.background = n.it.color ?? 'var(--color-chip)';
  }

  /** 全屏框（按全屏后的窗口尺寸排一次版，之后只改 transform） */
  private layoutFull(): void {
    const f = this.fullState;
    const n = f && this.nodes.get(f.id);
    if (!n) return;
    const r = magnifyTargets(n.it.w / n.it.h, Math.max(this.vw, screen.width), Math.max(this.vh, screen.height)).full;
    this.fullCanvas.style.width = `${r3(r.w)}px`;
    this.fullCanvas.style.height = `${r3(r.h)}px`;
  }

  closeFull(): void {
    const f = this.fullState;
    if (!f || f.t.t === 0) return;
    f.t.t = 0;
    const n = this.nodes.get(f.id);
    if (n) f.rect0 = this.screenRect(n.it);
    this.host.setFullscreen(false);
    this.host.kick();
  }

  private closeFullNow(): void {
    if (!this.fullState) return;
    if (this.fullState.t.t === 1) this.host.setFullscreen(false);
    this.fullState = null;
    this.full.hidden = true;
  }

  private fullStep(dx: number, dy: number): void {
    const f = this.fullState;
    if (!f) return;
    const list = this.order.map((n) => n.it);
    const i = list.findIndex((it) => it.id === f.id);
    const j = neighborIn(list, i, dx, dy);
    if (j < 0) return;
    f.id = list[j].id;
    this.paintFull();
    this.layoutFull();
    this.requestHiRes(list[j]);
    this.fullCanvas.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
    this.host.kick();
  }

  // ───────────── 改动：加照片、移除、整理 ─────────────

  /** 加照片（拖进窗口 / 选择文件）：放在视野中间附近 */
  addPhotos(photos: readonly PhotoSource[]): number {
    const b = this.board;
    if (!b) return 0;
    const c = this.camTarget();
    const added = addPhotos(b, photos, { x: c.x, y: c.y });
    const nodes = added.map((it) => this.addNode(it));
    this.restack();
    this.syncColors();
    this.cull();
    if (nodes.length <= STAGGER_MAX) this.staggerAppear(nodes, 0);
    // 新照片不全在视野里：镜头退到能看见全部
    const bb = bounds(added);
    const z = c.z;
    if (Math.abs(bb.x - c.x) * z > this.vw / 2 || Math.abs(bb.x + bb.w - c.x) * z > this.vw / 2 ||
      Math.abs(bb.y - c.y) * z > this.vh / 2 || Math.abs(bb.y + bb.h - c.y) * z > this.vh / 2) {
      setCamTarget(this.cam, fitCam(bounds(b.items), this.vw, this.vh));
    }
    this.changed();
    return added.length;
  }

  private changed(): void {
    this.board!.updatedAt = Date.now();
    this.updateTitle();
    this.syncColors();
    this.cull();
    this.host.save();
    this.host.kick();
  }

  removeSelection(ids: Iterable<string>): void {
    const b = this.board;
    if (!b) return;
    const set = new Set(ids);
    if (!set.size) return;
    const snap = { items: b.items.map((it) => ({ ...it })), groups: b.groups.map((g) => ({ ...g })) };
    const gone = removeItems(b, set);
    if (!gone.length) return;
    for (const it of gone) {
      const n = this.nodes.get(it.id);
      if (!n) continue;
      n.el.remove();
      this.nodes.delete(it.id);
    }
    this.order = this.order.filter((n) => !set.has(n.it.id));
    for (const id of set) this.selected.delete(id);
    if (this.focus && set.has(this.focus.id)) this.exitFocus();
    this.changed();
    const board = b;
    this.host.toast(t('board.removed', { n: gone.length }), {
      label: t('toast.undo'),
      run: () => {
        if (this.board !== board) return;
        board.items = snap.items;
        board.groups = snap.groups;
        this.rebuild();
        this.changed();
      },
    });
  }

  /** 整理：一组照片排成最密（等高行），并成一个集合；挡住的其他集合整块推开 */
  optimize(ids: readonly string[]): void {
    const b = this.board;
    if (!b || ids.length < 1) return;
    const set = new Set(ids);
    const items = b.items.filter((it) => set.has(it.id));
    if (!items.length) return;
    const boxes = repack(items, items.map((it) => it.pw / it.ph || it.w / it.h));
    // 用选中照片里最多的那个集合的颜色
    const tally = new Map<string, number>();
    for (const it of items) tally.set(it.group, (tally.get(it.group) ?? 0) + 1);
    const gid = [...tally.entries()].sort((p, q) => q[1] - p[1])[0][0];
    const oldGroups = new Set(items.map((it) => it.group));
    items.forEach((it, i) => {
      Object.assign(it, { x: boxes[i].x, y: boxes[i].y, w: boxes[i].w, h: boxes[i].h });
      it.group = gid;
    });
    pruneGroups(b);
    splitGroups(b, oldGroups);
    this.pushOthersAway(set);
    this.animateTo(readingOrder(items).map((i) => items[i]), b.items.filter((it) => !set.has(it.id)));
    this.changed();
  }

  /**
   * 合成一个新集合：选中的照片大小不变，挨个贴到一起（见 engine/board-layout.ts 的 gather），换一个新颜色；
   * 原来的集合剩下的部分照常拆分，挡住的其他集合整块推开
   */
  mergeSelection(ids: readonly string[]): void {
    const b = this.board;
    if (!b) return;
    const set = new Set(ids);
    const items = b.items.filter((it) => set.has(it.id));
    if (items.length < 2) return;
    const oldGroups = new Set(items.map((it) => it.group));
    const avoid = [...oldGroups].map((id) => b.groups.find((g) => g.id === id)?.color ?? -1);
    const pos = gather(items);
    const g = addGroup(b, undefined, avoid);
    items.forEach((it, i) => {
      it.x = pos[i].x;
      it.y = pos[i].y;
      it.group = g.id;
    });
    splitGroups(b, oldGroups);
    pruneGroups(b);
    this.pushOthersAway(set);
    this.animateTo(readingOrder(items).map((i) => items[i]), b.items.filter((it) => !set.has(it.id)));
    this.changed();
  }

  /** 一键全局优化：每个集合各自排密，再把集合当成整块按行摆开，整体中心不变；镜头退到能看见全部 */
  optimizeAll(): void {
    const b = this.board;
    if (!b || !b.items.length) return;
    const before = bounds(b.items);
    const groups = b.groups.map((g) => membersOf(b, g.id)).filter((m) => m.length);
    const packed = groups.map((m) => {
      const boxes = repack(m, m.map((it) => it.pw / it.ph || it.w / it.h));
      return { m, boxes, bb: bounds(boxes) };
    });
    // 集合按原来的阅读顺序摆
    const order = readingOrder(packed.map((p) => p.bb));
    const pos = shelfPack(order.map((i) => packed[i].bb), GROUP_GAP, clamp(this.vw / this.vh, 1, 2));
    const cx = before.x + before.w / 2, cy = before.y + before.h / 2;
    order.forEach((gi, k) => {
      const p = packed[gi];
      const dx = pos[k].x + cx - p.bb.x, dy = pos[k].y + cy - p.bb.y;
      p.m.forEach((it, i) => Object.assign(it, { x: p.boxes[i].x + dx, y: p.boxes[i].y + dy, w: p.boxes[i].w, h: p.boxes[i].h }));
    });
    this.animateTo(order.flatMap((gi) => readingOrder(packed[gi].m).map((i) => packed[gi].m[i])), []);
    setCamTarget(this.cam, fitCam(bounds(b.items), this.vw, this.vh));
    this.exitFocus(false);
    this.changed();
  }

  /** 选中照片以外的集合，和选中的照片重叠了：整块推开 */
  private pushOthersAway(fixedIds: ReadonlySet<string>): void {
    const b = this.board!;
    const blocks: { items: BoardItem[]; fixed: boolean }[] = [{ items: b.items.filter((it) => fixedIds.has(it.id)), fixed: true }];
    const byGroup = new Map<string, BoardItem[]>();
    for (const it of b.items) {
      if (fixedIds.has(it.id)) continue;
      const list = byGroup.get(it.group);
      if (list) list.push(it);
      else byGroup.set(it.group, [it]);
    }
    for (const items of byGroup.values()) blocks.push({ items, fixed: false });
    const boxes = blocks.map((bl) => bounds(bl.items));
    const off = separate(boxes, blocks.map((bl) => bl.fixed), GROUP_GAP / 2);
    blocks.forEach((bl, i) => {
      if (bl.fixed || (!off[i].dx && !off[i].dy)) return;
      for (const it of bl.items) {
        it.x += off[i].dx;
        it.y += off[i].dy;
      }
    });
  }

  /**
   * 照片滑到 it 上记的新位置：first 按顺序错开出发，others 一起走。
   * 要动的照片太多（几千张一起滑，每帧都要重画整个画布）时改成整体淡出、换位置、再淡入
   */
  private animateTo(first: readonly BoardItem[], others: readonly BoardItem[]): void {
    const moving = first.length + others.filter((it) => {
      const n = this.nodes.get(it.id);
      return n && (n.x.t !== it.x || n.y.t !== it.y || n.w.t !== it.w);
    }).length;
    if (moving > CROSSFADE_MIN && !reducedMotion.matches) {
      this.crossfade([...first, ...others]);
      return;
    }
    first.forEach((it, i) => {
      const n = this.nodes.get(it.id);
      if (n) this.retarget(n, Math.min(i * 12, 360));
    });
    for (const it of others) {
      const n = this.nodes.get(it.id);
      if (n && (n.x.t !== it.x || n.y.t !== it.y || n.w.t !== it.w)) this.retarget(n, 0);
    }
  }

  /** 画布淡出（0.12s 左右），淡到底时这些照片直接跳到新位置，再淡入 */
  private crossfade(items: readonly BoardItem[]): void {
    const jump = () => {
      for (const it of items) {
        const n = this.nodes.get(it.id);
        if (!n) continue;
        n.pending = null;
        n.x.v = n.x.t = it.x;
        n.y.v = n.y.t = it.y;
        n.w.v = n.w.t = it.w;
        n.x.vel = n.y.vel = n.w.vel = 0;
        n.dirty = true;
      }
      this.cull();
    };
    // 已经在淡出了：把这次的也并进去
    const prev = this.fadeApply;
    this.fadeApply = prev ? () => { prev(); jump(); } : jump;
    this.fade.t = 0;
    this.host.kick();
  }

  private retarget(n: Node, delay: number): void {
    const rm = reducedMotion.matches;
    n.sp = rm ? spring.reducedMotion : spring.boardItem;
    n.moveAt = this.time + (rm ? 0 : delay);
    n.pending = { x: n.it.x, y: n.it.y, w: n.it.w, h: n.it.h };
  }

  /** 集合颜色变了（合并、拆开）：描边、泛光跟着换 */
  private syncColors(): void {
    const b = this.board;
    if (!b) return;
    const colors = this.groupColors;
    colors.clear();
    for (const g of b.groups) colors.set(g.id, groupColor(b, g.id));
    for (const n of this.order) {
      const c = colors.get(n.it.group) ?? groupColor(b, n.it.group);
      if (c !== n.color) {
        n.color = c;
        n.el.style.setProperty('--gc', c);
      }
    }
  }

  // ───────────── 命中 ─────────────

  private boxesExcept(skip: ReadonlySet<Node>): { boxes: Box[]; nodes: Node[] } {
    const boxes: Box[] = [], nodes: Node[] = [];
    for (const n of this.order) {
      if (skip.has(n)) continue;
      boxes.push(n.it);
      nodes.push(n);
    }
    return { boxes, nodes };
  }

  /** 屏幕上 (x, y) 处最上面的照片 */
  private nodeAt(sx: number, sy: number): Node | null {
    const c = this.camNow();
    const p = toWorld(c, sx, sy, this.vw, this.vh);
    for (let i = this.order.length - 1; i >= 0; i--) {
      const n = this.order[i];
      const x = n.x.v, y = n.y.v, w = n.w.v, h = w * (n.it.h / n.it.w);
      if (p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h) return n;
    }
    return null;
  }

  /** 照片边缘的把手：n / s / e / w / ne / nw / se / sw */
  private handleAt(sx: number, sy: number): { node: Node; handle: string } | null {
    if (this.focus || this.fullState) return null;
    const c = this.camNow();
    const p = toWorld(c, sx, sy, this.vw, this.vh);
    const out = EDGE_OUT / c.z, inn = EDGE_IN / c.z, corner = (EDGE_IN + 8) / c.z;
    for (let i = this.order.length - 1; i >= 0; i--) {
      const n = this.order[i];
      const b = n.it;
      if (p.x < b.x - out || p.x > b.x + b.w + out || p.y < b.y - out || p.y > b.y + b.h + out) continue;
      const nearL = p.x < b.x + inn, nearR = p.x > b.x + b.w - inn;
      const nearT = p.y < b.y + inn, nearB = p.y > b.y + b.h - inn;
      const cL = p.x < b.x + corner, cR = p.x > b.x + b.w - corner, cT = p.y < b.y + corner, cB = p.y > b.y + b.h - corner;
      if ((cT && cL) && (nearT || nearL)) return { node: n, handle: 'nw' };
      if ((cT && cR) && (nearT || nearR)) return { node: n, handle: 'ne' };
      if ((cB && cL) && (nearB || nearL)) return { node: n, handle: 'sw' };
      if ((cB && cR) && (nearB || nearR)) return { node: n, handle: 'se' };
      if (nearL) return { node: n, handle: 'w' };
      if (nearR) return { node: n, handle: 'e' };
      if (nearT) return { node: n, handle: 'n' };
      if (nearB) return { node: n, handle: 's' };
      return null; // 在照片里面（不在边上）：上面的照片挡住了下面的把手
    }
    return null;
  }

  // ───────────── 指针 ─────────────

  private onHover = (e: PointerEvent): void => {
    if (this.drag || e.buttons) return;
    let cursor = '';
    if (this.space) cursor = 'grab';
    else if (this.focus) cursor = 'grab';
    else if (this.marks.tool !== 'select') cursor = 'crosshair';
    else {
      const h = this.handleAt(e.clientX, e.clientY);
      if (h) cursor = h.handle === 'n' || h.handle === 's' ? 'ns-resize' : h.handle === 'e' || h.handle === 'w' ? 'ew-resize' : h.handle === 'nw' || h.handle === 'se' ? 'nwse-resize' : 'nesw-resize';
    }
    if (this.canvasEl.style.cursor !== cursor) this.canvasEl.style.cursor = cursor;
  };

  private onDown = (e: PointerEvent): void => {
    if (!this.board || this.drag) return;
    this.canvasEl.focus({ preventScroll: true });
    const x = e.clientX, y = e.clientY;
    if (e.button === 1 || (e.button === 0 && this.space)) {
      e.preventDefault();
      this.drag = { kind: 'pan', id: e.pointerId, x0: x, y0: y, cam0: this.camNow() };
      this.capture(e.pointerId);
      this.canvasEl.style.cursor = 'grabbing';
      return;
    }
    if (e.button !== 0) return;
    // 标注工具（便签、箭头、直线、画笔）：按下就开始画，交给标注层（2026-11-20）
    if (!this.focus && this.marks.down(e)) {
      e.preventDefault();
      return;
    }
    if (this.focus) {
      this.drag = { kind: 'focus', id: e.pointerId, x0: x, y0: y, cam0: this.camNow(), samples: [{ t: performance.now(), x, y }], moved: false };
      this.capture(e.pointerId);
      return;
    }
    const h = this.handleAt(x, y);
    if (h) {
      const b = h.node.it;
      this.drag = { kind: 'resize', id: e.pointerId, x0: x, y0: y, node: h.node, handle: h.handle, box0: { x: b.x, y: b.y, w: b.w, h: b.h } };
      this.toFront([h.node]);
      this.select([h.node.it.id]);
      this.capture(e.pointerId);
      return;
    }
    const n = this.nodeAt(x, y);
    // 点到照片或空白：取消标注的选中
    this.marks.select(null);
    if (n) {
      const d: Drag = { kind: 'press', id: e.pointerId, x0: x, y0: y, node: n, shift: e.shiftKey || e.ctrlKey || e.metaKey, timer: 0 };
      // 长按：拎起整个集合（集合里的照片一起浮起来）
      d.timer = window.setTimeout(() => {
        if (this.drag !== d) return;
        const members = this.order.filter((m) => m.it.group === n.it.group);
        this.startMove(d, members, true);
      }, HOLD_MS);
      this.drag = d;
      this.capture(e.pointerId);
      return;
    }
    // 空白处：框选（按住 Shift / Ctrl 是在已选的基础上加）
    const base = e.shiftKey || e.ctrlKey || e.metaKey ? new Set(this.selected) : new Set<string>();
    this.drag = { kind: 'marquee', id: e.pointerId, x0: x, y0: y, x1: x, y1: y, base };
    this.capture(e.pointerId);
  };

  private capture(id: number): void {
    try {
      this.canvasEl.setPointerCapture(id);
    } catch {
      /* 忽略 */
    }
  }

  private startMove(d: Extract<Drag, { kind: 'press' }>, nodes: Node[], whole: boolean): void {
    window.clearTimeout(d.timer);
    this.toFront(nodes);
    for (const n of nodes) {
      n.lift.t = 1;
      n.sp = spring.follow;
      n.moveAt = 0;
      n.pending = null;
    }
    if (!this.selected.has(d.node.it.id) || whole) this.select(nodes.map((n) => n.it.id));
    this.drag = {
      kind: 'move', id: d.id, x0: d.x0, y0: d.y0, nodes, starts: nodes.map((n) => ({ x: n.it.x, y: n.it.y })),
      snap: null, whole, lastX: d.x0, lastT: performance.now(), vx: 0,
    };
    this.canvasEl.style.cursor = 'grabbing';
    this.host.kick();
  }

  private onMove = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const x = e.clientX, y = e.clientY;
    const z = this.cam.z.v;
    if (d.kind === 'pan') {
      const cx = d.cam0.x - (x - d.x0) / z, cy = d.cam0.y - (y - d.y0) / z;
      jumpCam(this.cam, { x: cx, y: cy, z: this.cam.z.t });
    } else if (d.kind === 'focus') {
      if (!d.moved && Math.hypot(x - d.x0, y - d.y0) < DRAG_PX) return;
      d.moved = true;
      this.canvasEl.style.cursor = 'grabbing';
      jumpCam(this.cam, { x: d.cam0.x - (x - d.x0) / z, y: d.cam0.y - (y - d.y0) / z, z: this.cam.z.t });
      d.samples.push({ t: performance.now(), x, y });
      if (d.samples.length > 6) d.samples.shift();
    } else if (d.kind === 'marquee') {
      d.x1 = x;
      d.y1 = y;
      this.updateMarquee(d);
    } else if (d.kind === 'press') {
      if (Math.hypot(x - d.x0, y - d.y0) < DRAG_PX) return;
      // 拖的是多选里的一张：选中的一起动；否则单独拿出来
      const multi = this.selected.has(d.node.it.id) && this.selected.size > 1;
      const nodes = multi ? this.order.filter((n) => this.selected.has(n.it.id)) : [d.node];
      this.startMove(d, nodes, multi);
      this.onMove(e);
      return;
    } else if (d.kind === 'move') {
      const now = performance.now();
      const dt = Math.max(1, now - d.lastT) / 1000;
      d.vx = d.vx * 0.7 + ((x - d.lastX) / dt) * 0.3;
      d.lastX = x;
      d.lastT = now;
      const dx = (x - d.x0) / z, dy = (y - d.y0) / z;
      if (d.nodes.length === 1 && !d.whole) {
        const n = d.nodes[0];
        const px = d.starts[0].x + dx, py = d.starts[0].y + dy;
        const { boxes, nodes } = this.boxesExcept(new Set(d.nodes));
        // 已经吸住了：拖开超过 UNSNAP_PX 才挣脱，在边界上不会来回跳
        let snap = d.snap;
        if (snap && Math.hypot(snap.x - px, snap.y - py) > UNSNAP_PX / z) snap = null;
        const fresh = snapPosition(n.it.w, n.it.h, px, py, boxes, SNAP_PX / z);
        if (fresh && (!snap || fresh.d < snap.d - 2 / z)) snap = fresh;
        else if (snap) {
          // 保持吸住的那个位置，但重新算一下它还合不合法（别的照片没动，所以只更新距离）
          snap = { ...snap, d: Math.hypot(snap.x - px, snap.y - py) };
        }
        d.snap = snap;
        n.sp = (snap ? spring.boardMagnet : spring.follow);
        n.x.t = snap ? snap.x : px;
        n.y.t = snap ? snap.y : py;
        this.setTargetGroup(snap ? nodes[snap.target].it.group : null);
        this.drawGuides(snap ? snap.guides : []);
        n.tilt.t = clamp(d.vx * 0.004, -5, 5);
      } else {
        d.nodes.forEach((n, i) => {
          n.x.t = d.starts[i].x + dx;
          n.y.t = d.starts[i].y + dy;
          n.tilt.t = clamp(d.vx * 0.002, -2.5, 2.5);
        });
      }
    } else if (d.kind === 'resize') {
      this.resizeTo(d, (x - d.x0) / z, (y - d.y0) / z);
    }
    this.host.kick();
  };

  private onUp = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    this.canvasEl.style.cursor = '';
    if (d.kind === 'press') {
      window.clearTimeout(d.timer);
      // 单击照片：选中它（Shift / Ctrl 加选 / 取消）
      const id = d.node.it.id;
      if (d.shift) {
        if (this.selected.has(id)) this.selected.delete(id);
        else this.selected.add(id);
        this.syncSelection();
      } else this.select([id]);
    } else if (d.kind === 'marquee') {
      this.marquee.el.hidden = true;
      if (Math.hypot(d.x1 - d.x0, d.y1 - d.y0) < DRAG_PX && !d.base.size) this.select([]);
    } else if (d.kind === 'focus') {
      if (!d.moved) {
        // 单击：点到别的照片就聚焦它，点空白退出聚焦
        const n = this.nodeAt(e.clientX, e.clientY);
        if (n && n.it.id !== this.focus?.id) this.focusOn(n);
        else if (!n) this.exitFocus();
      } else {
        // 全向拖动后：按松手时的速度往前推一点，停到离那里最近的照片
        const s = d.samples;
        const a = s[0], b = s[s.length - 1];
        const dt = Math.max(16, b.t - a.t) / 1000;
        const z = this.cam.z.v;
        const vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt;
        const px = this.cam.x.v - (vx * 0.18) / z, py = this.cam.y.v - (vy * 0.18) / z;
        const list = this.order.map((n) => n.it);
        const i = nearestBox(list, px, py);
        this.focusOn(i >= 0 ? this.order[i] : null);
      }
    } else if (d.kind === 'move') {
      this.drop(d);
    } else if (d.kind === 'resize') {
      this.finishResize(d.node);
    }
    this.host.kick();
  };

  /** 松手放下拖着的照片：吸附 / 并入集合 / 自成一个集合 */
  private drop(d: Extract<Drag, { kind: 'move' }>): void {
    const b = this.board!;
    this.drawGuides([]);
    this.setTargetGroup(null);
    for (const n of d.nodes) {
      n.lift.t = 0;
      n.tilt.t = 0;
      n.sp = spring.boardItem;
    }
    if (d.nodes.length === 1 && !d.whole) {
      const n = d.nodes[0];
      const it = n.it;
      const { boxes, nodes } = this.boxesExcept(new Set(d.nodes));
      let snap = d.snap;
      const box: Box = { x: n.x.t, y: n.y.t, w: it.w, h: it.h };
      // 没吸住但压在别的照片上：放到离它最近的合法位置（贴着它）
      if (!snap && boxes.some((o) => overlap(box, o))) snap = snapPosition(it.w, it.h, box.x, box.y, boxes, Infinity);
      const old = it.group;
      if (snap) {
        it.x = snap.x;
        it.y = snap.y;
        const target = nodes[snap.target].it.group;
        it.group = target;
        mergeGroups(b, target, touchingGroups(b, it));
      } else {
        it.x = box.x;
        it.y = box.y;
        // 放在空白处：自己成一个集合（原来就是一个人的集合就不用换）
        if (membersOf(b, old).length > 1) it.group = addGroup(b, undefined, [b.groups.find((g) => g.id === old)?.color ?? -1]).id;
      }
      splitGroups(b, [old]);
      n.x.t = it.x;
      n.y.t = it.y;
      n.sp = snap ? spring.boardMagnet : spring.boardItem;
    } else {
      // 一起移动的几张：位置跟手放下；挡住了别的集合就把那些集合整块推开
      const moved = new Set(d.nodes.map((n) => n.it.id));
      d.nodes.forEach((n) => {
        n.it.x = n.x.t;
        n.it.y = n.y.t;
      });
      const oldGroups = d.nodes.map((n) => n.it.group);
      this.pushOthersAway(moved);
      splitGroups(b, oldGroups);
      this.animateTo([], b.items.filter((it) => !moved.has(it.id)));
    }
    this.changed();
  }

  private resizeTo(d: Extract<Drag, { kind: 'resize' }>, dx: number, dy: number): void {
    const b0 = d.box0, a = b0.w / b0.h, h = d.handle;
    const right = b0.x + b0.w, bottom = b0.y + b0.h;
    let s: number;
    if (h === 'e') s = (b0.w + dx) / b0.w;
    else if (h === 'w') s = (b0.w - dx) / b0.w;
    else if (h === 's') s = (b0.h + dy) / b0.h;
    else if (h === 'n') s = (b0.h - dy) / b0.h;
    else {
      const sx = (h.includes('e') ? b0.w + dx : b0.w - dx) / b0.w;
      const sy = (h.includes('s') ? b0.h + dy : b0.h - dy) / b0.h;
      s = Math.max(sx, sy);
    }
    const minS = PHOTO_MIN_SIDE / Math.min(b0.w, b0.h), maxS = PHOTO_MAX_RESIZE / Math.max(b0.w, b0.h);
    s = clamp(s, minS, maxS);
    let w = b0.w * s;
    // 拖动的那条边对齐附近照片的边（或正好隔一条缝贴上去）
    const z = this.cam.z.v;
    const { boxes } = this.boxesExcept(new Set([d.node]));
    const lineFor = (ww: number) => {
      const hh = ww / a;
      return {
        x: h.includes('w') ? right - ww : h.includes('e') ? b0.x + ww : null,
        y: h.includes('n') ? bottom - hh : h.includes('s') ? b0.y + hh : null,
      };
    };
    const edges = lineFor(w);
    let best: { w: number; d: number; g: Guide } | null = null;
    const thr = SNAP_PX / z;
    for (const o of boxes) {
      if (edges.x !== null) {
        for (const v of [o.x, o.x + o.w, o.x - BOARD_GAP, o.x + o.w + BOARD_GAP]) {
          const dd = Math.abs(v - edges.x);
          if (dd > thr || (best && dd >= best.d)) continue;
          const ww = h.includes('w') ? right - v : v - b0.x;
          if (ww <= 0) continue;
          best = { w: ww, d: dd, g: { x1: v, y1: Math.min(o.y, b0.y), x2: v, y2: Math.max(o.y + o.h, b0.y + ww / a) } };
        }
      }
      if (edges.y !== null) {
        for (const v of [o.y, o.y + o.h, o.y - BOARD_GAP, o.y + o.h + BOARD_GAP]) {
          const dd = Math.abs(v - edges.y);
          if (dd > thr || (best && dd >= best.d)) continue;
          const hh = h.includes('n') ? bottom - v : v - b0.y;
          if (hh <= 0) continue;
          best = { w: hh * a, d: dd, g: { x1: Math.min(o.x, b0.x), y1: v, x2: Math.max(o.x + o.w, b0.x + hh * a), y2: v } };
        }
      }
    }
    if (best && best.w / b0.w >= minS && best.w / b0.w <= maxS) w = best.w;
    this.drawGuides(best ? [best.g] : []);
    const hh = w / a;
    const it = d.node.it;
    it.w = w;
    it.h = hh;
    it.x = h.includes('w') ? right - w : h === 'n' || h === 's' ? b0.x : b0.x;
    it.y = h.includes('n') ? bottom - hh : b0.y;
    const n = d.node;
    n.sp = spring.follow;
    n.x.t = it.x;
    n.y.t = it.y;
    n.w.t = it.w;
    n.pending = null;
  }

  /**
   * 调整完大小：同一个集合里压到的照片按缝推开（同一行 / 列的会依次让开），
   * 别的集合整块推开、和这个集合保持集合间距（不会被推得贴上来，看起来像连在一起）
   */
  private finishResize(n: Node): void {
    const b = this.board!;
    this.drawGuides([]);
    n.sp = spring.boardItem;
    const members = b.items.filter((it) => it.group === n.it.group);
    const off = separate(members, members.map((it) => it === n.it), BOARD_GAP);
    members.forEach((it, i) => {
      it.x += off[i].dx;
      it.y += off[i].dy;
    });
    this.pushOthersAway(new Set(members.map((it) => it.id)));
    this.animateTo([], b.items.filter((it) => it !== n.it));
    this.changed();
  }

  private updateMarquee(d: Extract<Drag, { kind: 'marquee' }>): void {
    const x0 = Math.min(d.x0, d.x1), y0 = Math.min(d.y0, d.y1);
    const w = Math.abs(d.x1 - d.x0), h = Math.abs(d.y1 - d.y0);
    const m = this.marquee;
    m.el.hidden = w < DRAG_PX && h < DRAG_PX;
    m.set('transform', `translate(${r3(x0)}px, ${r3(y0)}px)`);
    m.set('width', `${r3(w)}px`);
    m.set('height', `${r3(h)}px`);
    const c = this.camNow();
    const a = toWorld(c, x0, y0, this.vw, this.vh), b = toWorld(c, x0 + w, y0 + h, this.vw, this.vh);
    const box: Box = { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
    const sel = new Set(d.base);
    for (const n of this.order) if (overlap(box, n.it)) sel.add(n.it.id);
    this.selected = sel;
    this.syncSelection();
  }

  private select(ids: readonly string[]): void {
    this.selected = new Set(ids);
    this.syncSelection();
  }

  /** 选中状态画到照片上：只改变化了的（框选时每次移动都会调用，几千张时不能每次都改一遍） */
  private syncSelection(): void {
    for (const id of this.shownSel) if (!this.selected.has(id)) this.nodes.get(id)?.el.classList.remove('is-selected');
    for (const id of this.selected) if (!this.shownSel.has(id)) this.nodes.get(id)?.el.classList.add('is-selected');
    this.shownSel = new Set(this.selected);
  }

  /** 拖动时，要吸附过去的那个集合整体亮一点 */
  private setTargetGroup(g: string | null): void {
    if (g === this.targetGroup) return;
    this.targetGroup = g;
    for (const n of this.order) n.el.classList.toggle('is-target', g !== null && n.it.group === g);
  }

  private guideWorld: Guide[] = [];

  private drawGuides(gs: Guide[]): void {
    this.guideWorld = gs;
    this.renderGuides();
  }

  private renderGuides(): void {
    const c = this.camNow();
    this.guideLines.forEach((l, i) => {
      const g = this.guideWorld[i];
      if (!g) {
        l.setAttribute('visibility', 'hidden');
        return;
      }
      const pad = 10;
      const vertical = g.x1 === g.x2;
      const x1 = (g.x1 - c.x) * c.z + this.vw / 2 - (vertical ? 0 : pad);
      const x2 = (g.x2 - c.x) * c.z + this.vw / 2 + (vertical ? 0 : pad);
      const y1 = (g.y1 - c.y) * c.z + this.vh / 2 - (vertical ? pad : 0);
      const y2 = (g.y2 - c.y) * c.z + this.vh / 2 + (vertical ? pad : 0);
      l.setAttribute('x1', String(r3(x1)));
      l.setAttribute('y1', String(r3(y1)));
      l.setAttribute('x2', String(r3(x2)));
      l.setAttribute('y2', String(r3(y2)));
      l.setAttribute('visibility', 'visible');
    });
  }

  // ───────────── 滚轮、双击、右键、键盘 ─────────────

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (!this.board || this.drag?.kind === 'move' || this.drag?.kind === 'resize') return;
    const x = e.clientX, y = e.clientY;
    const notch = isWheelNotch(e.deltaMode, (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY);
    if (e.ctrlKey && !notch) {
      // 触控板捏合：连续缩放
      this.exitFocusSoft();
      const c = this.camTarget();
      setCamTarget(this.cam, zoomAround(c, c.z * Math.exp(-e.deltaY * 0.012), x, y, this.vw, this.vh));
      this.showZoom();
      this.host.kick();
      return;
    }
    if (notch || e.ctrlKey) {
      const dir = Math.sign(e.deltaY);
      if (!dir) return;
      const steps = clamp(Math.round(Math.abs((e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY ?? 120) / 120), 1, 4);
      if (this.focus) {
        if (dir > 0) this.exitFocus();
        else if (wheelCanToggleFullscreen(prefs())) {
          const n = this.nodes.get(this.focus.id);
          if (n) this.openFull(n);
        }
        return;
      }
      const n = this.nodeAt(x, y);
      if (dir < 0 && n && this.cam.z.t < focusCam(n.it, this.vw, this.vh).z * 0.97) {
        this.focusOn(n);
        return;
      }
      const c = this.camTarget();
      setCamTarget(this.cam, zoomAround(c, c.z * Math.pow(dir < 0 ? 1.25 : 0.8, steps), x, y, this.vw, this.vh));
      this.showZoom();
      this.host.kick();
      return;
    }
    // 触控板双指滑动：平移（聚焦时停下后吸到最近的照片）
    const z = this.cam.z.v;
    jumpCam(this.cam, { x: this.cam.x.v + e.deltaX / z, y: this.cam.y.v + e.deltaY / z, z: this.cam.z.t });
    if (this.focus) {
      window.clearTimeout(this.wheelPanTimer);
      this.wheelPanTimer = window.setTimeout(() => {
        const list = this.order.map((n2) => n2.it);
        const i = nearestBox(list, this.cam.x.v, this.cam.y.v);
        this.focusOn(i >= 0 ? this.order[i] : null);
      }, 160);
    }
    this.host.kick();
  };

  /** 捏合缩放时退出聚焦，但镜头留在当前位置 */
  private exitFocusSoft(): void {
    if (this.focus) this.exitFocus(false);
  }

  private onDblClick = (e: MouseEvent): void => {
    const n = this.nodeAt(e.clientX, e.clientY);
    if (n) this.openFull(n);
    else this.fitAll();
  };

  private onContext = (e: MouseEvent): void => {
    e.preventDefault();
    const b = this.board;
    if (!b) return;
    const { x, y } = menuPoint(e, this.canvasEl);
    const n = this.nodeAt(e.clientX || x, e.clientY || y);
    const items: CtxItem[] = [];
    const sel = [...this.selected].filter((id) => this.nodes.has(id));
    if (n && !this.selected.has(n.it.id)) this.select([n.it.id]);
    // 选中的照片分属好几个集合：可以合成一个新集合
    const multiGroup = new Set(sel.map((id) => this.nodes.get(id)!.it.group)).size > 1;
    const mergeItem: CtxItem = { label: t('board.mergeSel', { n: sel.length }), icon: ICON_MERGE, run: () => this.mergeSelection(sel) };
    if (n && sel.length > 1 && this.selected.has(n.it.id)) {
      // 多选
      items.push(
        { caption: t('board.selected', { n: sel.length }) },
        { label: t('board.optimizeSel', { n: sel.length }), icon: ICON_OPTIMIZE, run: () => this.optimize(sel) },
      );
      if (multiGroup) items.push(mergeItem);
      items.push(
        'divider',
        { label: t('board.removeSel', { n: sel.length }), icon: ICON_TRASH, danger: true, run: () => this.removeSelection(sel) },
      );
      this.host.contextMenu(items, x, y, t('board.selected', { n: sel.length }));
      return;
    }
    if (n) {
      const it = n.it;
      const members = membersOf(b, it.group);
      items.push({ caption: it.title });
      if (members.length > 1) {
        items.push(
          { label: t('board.optimizeGroup', { n: members.length }), icon: ICON_OPTIMIZE, run: () => this.optimize(members.map((m) => m.id)) },
          { label: t('board.detach'), icon: ICON_DETACH, run: () => this.detachItem(n) },
        );
      }
      items.push({ label: t('board.focus'), icon: ICON_FIT, run: () => this.focusOn(n) });
      // 生成色卡（2026-11-20）：取这张的主色，在右边放一张色卡
      items.push({ label: t('marks.makeSwatch'), icon: ICON_SWATCH, run: () => void this.makeSwatch(it) });
      if (it.path && this.host.desktop) {
        items.push(
          'divider',
          { label: t('ctx.copyImage'), icon: ICON_COPY, run: () => this.host.copyImage(it) },
          { label: t('ctx.reveal'), icon: ICON_FOLDER, run: () => this.host.reveal(it) },
        );
      }
      items.push('divider', { label: t('board.remove'), icon: ICON_TRASH, danger: true, run: () => this.removeSelection([it.id]) });
      this.host.contextMenu(items, x, y, t('ctx.label', { name: it.title }));
      return;
    }
    items.push({ caption: b.name });
    if (sel.length > 1) {
      items.push({ label: t('board.optimizeSel', { n: sel.length }), icon: ICON_OPTIMIZE, run: () => this.optimize(sel) });
      if (multiGroup) items.push(mergeItem);
    }
    items.push(
      { label: t('board.optimizeAll'), icon: ICON_OPTIMIZE, disabled: b.items.length < 2, run: () => this.optimizeAll() },
      { label: t('board.fit'), icon: ICON_FIT, disabled: !b.items.length, run: () => this.fitAll() },
    );
    if (this.host.desktop) items.push('divider', { label: t('board.addImages'), icon: ICON_PLUS, run: () => void this.pickAndAdd() });
    // 置顶参考小窗（2026-11-20）
    if (this.host.openReference) {
      items.push('divider', { label: t('ref.openBoard'), icon: ICON_PIN, disabled: !b.items.length, run: () => this.host.openReference?.() });
    }
    items.push('divider', { label: t('board.rename'), icon: ICON_PENCIL, run: () => this.host.rename(x, y) });
    this.host.contextMenu(items, x, y, t('ctx.label', { name: b.name }));
  };

  private async pickAndAdd(): Promise<void> {
    const photos = await this.host.pickImages();
    if (!photos.length) return;
    const n = this.addPhotos(photos);
    this.host.toast(n ? t('board.addedN', { n }) : t('board.already'));
  }

  /** 从集合中分离：挪到集合旁边的空地，自己成一个集合 */
  private detachItem(n: Node): void {
    const b = this.board!;
    const it = n.it;
    const old = it.group;
    const rest = membersOf(b, old).filter((m) => m !== it);
    const bb = bounds(rest);
    const others = b.items.filter((m) => m !== it);
    let x = bb.x + bb.w + GROUP_GAP / 2, y = it.y;
    for (let k = 0; k < 40 && others.some((o) => overlap({ x, y, w: it.w, h: it.h }, o, GROUP_GAP / 3)); k++) y += it.h / 2;
    it.x = x;
    it.y = y;
    it.group = addGroup(b, undefined, [b.groups.find((g) => g.id === old)?.color ?? -1]).id;
    splitGroups(b, [old]);
    this.animateTo([it], []);
    this.changed();
  }

  private onKey = (e: KeyboardEvent): void => {
    if (!this.isOpen || !this.board || e.defaultPrevented) return;
    const tg = e.target as HTMLElement | null;
    if (tg && (tg instanceof HTMLInputElement || tg instanceof HTMLTextAreaElement || tg.closest('.menu-panel, .popover'))) return;
    if (e.code === 'Space') {
      this.space = true;
      if (tg === this.canvasEl || tg === document.body) e.preventDefault();
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    // 标注（2026-11-20）：工具快捷键；Esc 先退回选择工具、再取消选中的标注；Delete 删选中的标注
    const toolKey: Record<string, MarkTool> = { v: 'select', n: 'note', a: 'arrow', l: 'line', p: 'pen' };
    const tk = !mod && !e.altKey && !this.fullState && !this.focus ? toolKey[e.key.toLowerCase()] : undefined;
    if (tk) {
      e.preventDefault();
      e.stopPropagation();
      this.setTool(tk);
      return;
    }
    if (e.key === 'Escape' && (this.marks.tool !== 'select' || this.marks.selected) && !this.fullState) {
      e.preventDefault();
      e.stopPropagation();
      if (this.marks.tool !== 'select') this.setTool('select');
      else this.marks.select(null);
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.marks.selected && !this.fullState) {
      e.preventDefault();
      this.marks.deleteSelected();
      return;
    }
    if (e.key === 'Escape') {
      // 全屏 → 退出全屏；聚焦 → 退出聚焦；其余直接回到预览（选中的顺手取消）
      e.preventDefault();
      e.stopPropagation();
      if (this.fullState && this.fullState.t.t === 1) this.closeFull();
      else if (this.focus) this.exitFocus();
      else {
        this.select([]);
        this.host.back();
      }
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected.size && !this.fullState) {
      e.preventDefault();
      this.removeSelection([...this.selected]);
    } else if (mod && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault();
      this.select(this.order.map((n) => n.it.id));
    } else if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      const dx = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
      const dy = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
      if (this.fullState && this.fullState.t.t === 1) {
        this.fullStep(dx, dy);
      } else if (this.focus) {
        const list = this.order.map((n) => n.it);
        const j = neighborIn(list, list.findIndex((it) => it.id === this.focus!.id), dx, dy);
        if (j >= 0) this.focusOn(this.order[j]);
      } else {
        const c = this.camTarget();
        setCamTarget(this.cam, { x: c.x + (dx * 120) / c.z, y: c.y + (dy * 120) / c.z, z: c.z });
        this.host.kick();
      }
    } else if (e.key === '0' && !mod) {
      this.fitAll();
    } else if ((e.key === '=' || e.key === '+' || e.key === '-') && !this.focus) {
      const c = this.camTarget();
      setCamTarget(this.cam, zoomAround(c, c.z * (e.key === '-' ? 0.8 : 1.25), this.vw / 2, this.vh / 2, this.vw, this.vh));
      this.showZoom();
      this.host.kick();
    } else if (e.key === 'F11' || (e.key === 'Enter' && this.focus)) {
      e.preventDefault();
      if (this.fullState && this.fullState.t.t === 1) this.closeFull();
      else {
        const id = this.focus?.id ?? [...this.selected][0];
        const n = id ? this.nodes.get(id) : undefined;
        if (n) this.openFull(n);
      }
    }
  };

  // ───────────── 每帧 ─────────────

  /** 推进弹簧，返回是否还在动 */
  step(dt: number): boolean {
    if (!this.board && this.op.v === 0) return false;
    this.time += dt * 1000;
    let busy = !stepScalar(this.op, spring.boardOpen, dt);
    const cs = spring.boardCam;
    busy = !stepScalar(this.cam.x, cs, dt, CAM_EPS / this.cam.z.v) || busy;
    busy = !stepScalar(this.cam.y, cs, dt, CAM_EPS / this.cam.z.v) || busy;
    busy = !stepScalar(this.cam.z, cs, dt, 1e-4) || busy;
    // 只有弹簧在动（或刚停下、状态变了）的照片这一帧要写样式
    const live = this.live;
    live.length = 0;
    for (const n of this.order) {
      let m = false;
      if (n.pending) {
        if (this.time >= n.moveAt) {
          n.x.t = n.pending.x;
          n.y.t = n.pending.y;
          n.w.t = n.pending.w;
          n.pending = null;
        } else m = true;
      }
      if (n.appear.t === 0) {
        if (this.time >= n.appearAt) n.appear.t = 1;
        m = true;
      }
      m = !stepScalar(n.x, n.sp, dt, 0.05) || m;
      m = !stepScalar(n.y, n.sp, dt, 0.05) || m;
      m = !stepScalar(n.w, n.sp, dt, 0.05) || m;
      m = !stepScalar(n.lift, spring.liftScale, dt) || m;
      m = !stepScalar(n.tilt, spring.pickHover, dt, 0.01) || m;
      m = !stepScalar(n.appear, spring.pickTile, dt) || m;
      if (m || n.wasMoving || n.dirty) live.push(n);
      n.wasMoving = m;
      if (m) busy = true;
    }
    // 镜头停下后还要等一会儿重新栅格化
    if (this.board && (this.rasterPhase === 1 || this.needsReraster(this.cam.z.t) || this.lodPending)) busy = true;
    // 整体淡出淡入：淡到底时换好位置，再淡回来
    if (this.fadeApply && this.fade.v < 0.04) {
      const apply = this.fadeApply;
      this.fadeApply = null;
      apply();
      this.fade.t = 1;
    }
    // 临界阻尼，淡出、淡入各约 0.15s
    busy = !stepScalar(this.fade, [700, 53], dt) || busy;
    const f = this.fullState;
    if (f) {
      busy = !stepScalar(f.t, spring.magnify, dt) || busy;
      if (f.t.t === 0 && f.t.v === 0) {
        const fn = this.nodes.get(f.id);
        if (fn) {
          fn.dirty = true;
          live.push(fn);
        }
        this.fullState = null;
        this.full.hidden = true;
        this.requestHiRes(this.focus ? this.nodes.get(this.focus.id)?.it ?? null : null);
      }
    }
    if (this.op.t === 0 && this.op.v === 0 && this.board) {
      this.root.hidden = true;
      this.board = null;
      this.marks.setBoard(null);
      for (const n of this.order) n.el.remove();
      this.nodes.clear();
      this.order = [];
    }
    // 缩放倍率停一会儿后淡出
    if (performance.now() - this.zoomShownAt < 1400) busy = true;
    return busy;
  }

  /** 把一张照片的弹簧值写成样式 */
  private renderNode(n: Node): void {
    const it = n.it;
    n.dirty = false;
    const hidden = !n.shown || (!!this.fullState && this.fullState.id === it.id && this.fullState.t.v > 0.01);
    n.st.set('visibility', hidden ? 'hidden' : '');
    if (!n.shown) return;
    const w = n.w.v, h = w * (it.h / it.w);
    // 大小目标变了才改排版宽高（按目标大小排，动画中只缩放）
    const lw = n.w.t, lh = n.w.t * (it.h / it.w);
    if (Math.abs(lw - n.lw) > 0.5 || Math.abs(lh - n.lh) > 0.5) {
      n.lw = lw;
      n.lh = lh;
      n.st.set('width', `${r3(lw)}px`);
      n.st.set('height', `${r3(lh)}px`);
    }
    const ap = clamp(n.appear.v, 0, 1.2);
    const lift = n.lift.v;
    const s = (w / n.lw) * (1 + 0.03 * lift) * (0.86 + 0.14 * ap);
    const x = n.x.v + w / 2 - n.lw / 2, y = n.y.v + h / 2 - n.lh / 2;
    const rot = reducedMotion.matches ? 0 : n.tilt.v;
    n.st.set('transform', rot ? `translate(${r3(x)}px, ${r3(y)}px) rotate(${r3(rot)}deg) scale(${r3(s)})` : `translate(${r3(x)}px, ${r3(y)}px) scale(${r3(s)})`);
    n.st.set('opacity', ap >= 1 ? '' : String(r3(clamp(ap, 0, 1))));
    // 拿起来的照片单独一个合成层（拖动时只是合成器移动它），换成更深的阴影
    const liftOn = lift > 0.01 || n.lift.t > 0;
    if (liftOn !== n.liftOn) {
      n.liftOn = liftOn;
      n.el.classList.toggle('is-lifted', liftOn);
    }
  }

  render(): void {
    if (this.root.hidden) return;
    const vw = this.vw, vh = this.vh;
    const op = clamp(this.op.v, 0, 1);
    this.root.style.opacity = op > 0.999 ? '' : String(r3(op));
    const c = this.camNow();
    const z = c.z;
    // 打开 / 关上时整个画布轻轻缩放（从 0.96 长到 1）
    const zo = z * (0.96 + 0.04 * op);
    const tx = vw / 2 - c.x * zo, ty = vh / 2 - c.y * zo;
    this.world.set('transform', `translate(${r3(tx)}px, ${r3(ty)}px) scale(${r3(zo)})`);
    // 画布是常驻合成层：镜头动的时候只改矩阵；停下后按需要重新栅格化一次（见 updateRaster）
    const now = performance.now();
    const lc = this.lastCam;
    const camMoved = lc.tx !== tx || lc.ty !== ty || lc.z !== zo;
    if (camMoved) {
      this.lodPending = true;
      lc.tx = tx;
      lc.ty = ty;
      lc.z = zo;
      this.camChangedAt = now;
    }
    // 描边粗细跟着缩放连续变：照片不多时每帧更新（屏幕上一直 1.5px），很多时每变 22% 更新一次
    const bzStep = this.order.length <= BZ_LIVE_MAX ? 0.004 : 0.2;
    if (Math.abs(Math.log(zo / this.bzSet)) > bzStep) this.setBz(zo);
    this.updateRaster(zo, now);
    this.world.set('opacity', this.fade.v >= 0.999 ? '' : String(r3(clamp(this.fade.v, 0, 1))));
    // 视野裁剪：镜头或照片在动时每 150ms 更新一次
    if ((camMoved || this.live.length) && now - this.cullAt > 150) this.cull();
    // 镜头停下 160ms 后再挑一次缩略图档位（缩放过程中不换图）
    if (this.lodPending && now - this.camChangedAt >= 160) {
      this.lodPending = false;
      this.cull(true);
    }
    // 点阵：细点间距 = 24 × 4^k 画布 px，让屏幕上的间距落在 [12, 48) px；快到 12 时淡出，粗点接替
    const k = Math.ceil(Math.log(12 / (DOT * zo)) / Math.log(4));
    const fine = DOT * Math.pow(4, k) * zo;
    const fa = clamp((fine - 12) / 10, 0, 1);
    this.dots.set('background-size', `${r3(fine)}px ${r3(fine)}px`);
    this.dots.set('background-position', `${r3(tx - fine / 2)}px ${r3(ty - fine / 2)}px`);
    this.dots.set('opacity', String(r3(fa)));
    const major = fine * 4;
    this.dotsMajor.set('background-size', `${r3(major)}px ${r3(major)}px`);
    this.dotsMajor.set('background-position', `${r3(tx - major / 2)}px ${r3(ty - major / 2)}px`);
    // 照片：只写这一帧在动（或状态变了）的；全屏时那一张由全屏层接替
    for (const n of this.live) this.renderNode(n);
    for (const n of this.order) if (n.dirty) this.renderNode(n);
    const fn = this.fullState ? this.nodes.get(this.fullState.id) : undefined;
    if (fn) this.renderNode(fn);
    this.renderGuides();
    this.paintToolColors();
    // 缩放倍率
    const showZoom = performance.now() - this.zoomShownAt < 1200;
    this.zoomBtn.classList.toggle('is-active', showZoom);
    this.zoomText.text(`${Math.round(z * 100)}%`);
    // 全屏层
    const f = this.fullState;
    if (f) {
      const n = this.nodes.get(f.id);
      if (n) {
        const ft = clamp(f.t.v, 0, 1.05);
        const from = f.t.t === 1 ? f.rect0 : this.screenRect(n.it);
        if (f.t.t === 0) f.rect0 = from;
        const to = magnifyTargets(n.it.w / n.it.h, vw, vh).full;
        const W = parseFloat(this.fullCanvas.style.width) || to.w;
        const cx = from.cx + (to.cx - from.cx) * ft, cy = from.cy + (to.cy - from.cy) * ft;
        const cw = from.w + (to.w - from.w) * ft;
        const s = cw / W;
        const H = parseFloat(this.fullCanvas.style.height) || to.h;
        this.fullSt.set('transform', `translate(${r3(cx - W / 2)}px, ${r3(cy - H / 2)}px) scale(${r3(s)})`);
        this.fullSt.set('border-radius', `${r3((1 - clamp(ft, 0, 1)) * 6 / Math.max(s, 0.01))}px`);
        this.fullBg.set('opacity', String(r3(clamp(ft, 0, 1))));
      }
    }
  }
}

function setCam(c: { x: Scalar; y: Scalar; z: Scalar }, v: Cam): void {
  c.x.v = c.x.t = v.x;
  c.y.v = c.y.t = v.y;
  c.z.v = c.z.t = v.z;
  c.x.vel = c.y.vel = c.z.vel = 0;
}

function setCamTarget(c: { x: Scalar; y: Scalar; z: Scalar }, v: Cam): void {
  c.x.t = v.x;
  c.y.t = v.y;
  c.z.t = v.z;
}

/** 跟手：当前值和目标一起改（拖动画布），缩放照常弹簧过去 */
function jumpCam(c: { x: Scalar; y: Scalar; z: Scalar }, v: Cam): void {
  c.x.v = c.x.t = v.x;
  c.y.v = c.y.t = v.y;
  c.x.vel = c.y.vel = 0;
  c.z.t = v.z;
}
