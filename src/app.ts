// 应用外壳：持有作品库和运动状态，组装各个视图，render() 把状态算成样式。
// 弹簧积分和输入处理在 Controller 里；render() 由 Controller 的 rAF 循环每帧调用一次。
import type { Library, Series, Work } from './data/types';
import { createMotion, type Motion } from './engine/motion';
import {
  currentOf, rowFade, headerOpacity, needsOriginalFor, paintingAt, artSize, cameraScale, thumbCaps, thumbPage,
  type ThumbCaps, type ThumbPage,
} from './engine/mapping';
import { cardRect } from './engine/magnify';
import { monthJump } from './engine/months';
import { cameraLevel, stageUnit } from './engine/gesture';
import { clamp } from './engine/math';
import { Controller, type UiFlags } from './controller';
import { UNASSIGNED_COLOR } from './tokens';
import { applyI18n, onLangChange, t } from './i18n';
import { el, Styled } from './view/dom';
import { StageView } from './view/stage';
import { Hud } from './view/hud';
import { InfoPanel } from './view/info';
import { Timeline } from './view/timeline';
import { WindowControls } from './view/window-controls';
import { AppMenu, type ImportKind, type SetInfo } from './view/menu';
import { SetSwitcher } from './view/set-switcher';
import { Magnifier } from './view/magnifier';
import { DropOverlay, EmptyState, Toast } from './view/overlays';
import { ContextMenu, type CtxItem } from './view/context-menu';
import { AboutDialog, REPO_URL } from './view/about';
import { ICON_COPY, ICON_DOWNLOAD, ICON_FOLDER, ICON_PALETTE, ICON_PENCIL, ICON_REMOVE, ICON_TRASH } from './view/dom';
import { ColorPicker } from './view/series-color';
import { RenamePopover } from './view/series-rename';
import { installFocusOrder } from './view/focus-order';
import type { LibraryService } from './data/service';
import type { Source } from './data/library';
import { nameFromSources } from './data/sets';
import {
  appVersion, assetUrl, classifyDropped, copyImage, diagnoseImage, logError, makeThumbnail, onFileDrop, openExternal,
  pickFiles, pickFolders, revealInFolder, saveImageAs, setWindowFullscreen,
} from './data/tauri-io';
import { ThumbLoader } from './data/thumb-loader';
import {
  assignWork, createSeries, deleteSeries, displayName, displayTitle, finalizeNames, removeWorks, renameSeries,
  setCustomTitle, visibleSeries, UNSORTED_ID,
} from './data/series-ops';

export interface UiState extends UiFlags {
  editing: boolean;
  hoverThumb: string | null;
}

export interface AppOptions {
  lib: Library;
  service: LibraryService;
  initialIndex: number;
  /** 启动时还在扫描导入过的来源 */
  loading?: boolean;
  /** 加载当前预览集的作品（桌面版：重新扫描；浏览器调试：示例数据或空） */
  loadLibrary: () => Promise<Library>;
}

/** 在某一幅停留超过这么久才加载原图（HANDOFF §8） */
const HIRES_DWELL_MS = 300;
/** 缩略图加载失败后的重试间隔 */
const THUMB_RETRY_MS = [400, 1200];
/** 全屏时鼠标离顶边这么近，对应一侧的顶栏图标才浮出来 */
const REVEAL_ZONE_PX = 64;

const needsOriginal = (w: Work, magnified: boolean): boolean =>
  needsOriginalFor(w.width, w.height, window.innerWidth, window.innerHeight, window.devicePixelRatio || 1, magnified);

const aspectOf = (w: Work): number | undefined => (w.width && w.height ? w.width / w.height : undefined);

/** 编辑卡打开时的系列列表和每幅作品的归属 / 自定义标题 */
interface EditSnapshot {
  series: Series[];
  works: Map<string, { series: string; customTitle?: string }>;
}

/** 右键删除前的作品库状态（撤销用） */
interface UndoSnapshot {
  works: Work[];
  seriesOf: Map<string, string>;
  series: Series[];
  /** 被标成“已移除”的作品 */
  removed: string[];
  /** 撤销后停在哪一幅 */
  focusId: string | undefined;
}

export class App {
  readonly root: HTMLElement;
  readonly m: Motion;
  readonly ui: UiState = { editing: false, touched: false, axis: null, hoverThumb: null };
  readonly controller: Controller;

  private lib: Library;
  private service: LibraryService;
  private loadLibrary: () => Promise<Library>;
  private seriesById = new Map<string, Series>();
  private stage: StageView;
  private hud: Hud;
  private info: InfoPanel;
  private timeline: Timeline;
  private menu: AppMenu;
  private switcher: SetSwitcher;
  private magnifier: Magnifier;
  private winControls: WindowControls;
  private empty: EmptyState;
  private drop: DropOverlay;
  private toast: Toast;
  private infoFade: Styled;
  private timelineFade: Styled;
  private ctxMenu: ContextMenu;
  private colorPicker: ColorPicker;
  private renamePop: RenamePopover;
  private about: AboutDialog;
  /** 编辑卡打开时的快照：点外面 / Esc 放弃修改时恢复 */
  private editSnapshot: EditSnapshot | null = null;
  /** 最近一次右键删除的快照：提示条里“撤销”用；作品库被换掉（导入、切换预览集）后作废 */
  private undo: UndoSnapshot | null = null;
  private thumbs: ThumbLoader | null = null;
  private announced = -1;
  private labelsVersion = 0;
  private isEmpty: boolean | null = null;
  private loading: boolean;
  private importing = false;
  private loadToken = 0;
  // 原图：停留 300ms 后加载、解码好再换上
  private hiRes: { id: string; url: string } | null = null;
  private hiResFor: string | null = null;
  private hiResTimer = 0;
  private loaderCur = -1;
  private loaderWorks: readonly Work[] | null = null;
  // 系列视图缩略图分页：每排容量（按窗口尺寸缓存）、手动翻到的页（换了作品就回到自动）
  private caps: ThumbCaps = { top: 1, bottom: 1 };
  private capsKey = '';
  private pageSel: number | null = null;
  private pageCur = -1;
  private lastPage: ThumbPage | null = null;
  private saveTimer = 0;
  private thumbRetries = new Map<string, number>();
  private reveal = { left: false, right: false };

  constructor(mount: HTMLElement, opts: AppOptions) {
    this.lib = opts.lib;
    this.service = opts.service;
    this.loadLibrary = opts.loadLibrary;
    this.loading = !!opts.loading;
    this.indexSeries();
    const n = this.lib.works.length;
    if (n) this.service.noteCount(n);
    this.m = createMotion(clamp(opts.initialIndex, 0, Math.max(0, n - 1)));
    const ctl = (this.controller = new Controller(this, this.m));

    this.stage = new StageView({
      go: (i, fromThumb) => {
        const thumbFocused = fromThumb && document.activeElement?.classList.contains('thumb');
        // 用键盘点了缩略图：镜头推回后缩略图会隐藏，焦点交还给舞台，方向键可以继续用
        if (ctl.go(i, fromThumb) && thumbFocused) this.stage.section.focus({ preventScroll: true });
      },
      thumbHover: (id) => {
        this.ui.hoverThumb = id;
        ctl.kick();
      },
      artError: (id, original, src) => {
        if (this.service.desktop) void diagnoseImage(src);
        this.onArtError(id, original);
      },
      // 右键画作 / 缩略图；放大查看时右键的是放大层下面的舞台，算当前那幅
      menu: (index, x, y) => {
        const i = index >= 0 ? index : ctl.magnified ? currentOf(this.m.pos, this.lib.works.length).cur : -1;
        if (i >= 0) this.openWorkMenu(i, x, y);
      },
    });
    this.magnifier = new Magnifier((id) => this.onArtError(id, this.hiRes?.id === id));
    this.hud = new Hud({
      startEdit: this.startEdit,
      pagePrev: () => this.turnPage(-1),
      pageNext: () => this.turnPage(1),
      seriesMenu: (x, y) => {
        const w = this.lib.works[currentOf(this.m.pos, this.lib.works.length).cur];
        if (w) this.openSeriesMenu(w.series, x, y);
      },
    });
    this.info = new InfoPanel({
      startEdit: this.startEdit,
      retitle: this.retitle,
      rename: this.rename,
      pick: this.pick,
      newSeries: this.newSeries,
      finish: this.finishEdit,
      cancel: this.cancelEdit,
      seriesMenu: (id, x, y) => this.openSeriesMenu(id, x, y),
    });
    this.timeline = new Timeline({
      go: (i) => ctl.go(i),
      prev: ctl.prev,
      next: ctl.next,
      monthJump: (dir) => this.monthJump(dir),
      scrubStart: () => ctl.scrubStart(),
      scrubTo: (p) => ctl.scrubTo(p),
      scrubEnd: () => ctl.scrubEnd(),
    });
    this.menu = new AppMenu({
      sets: this.setInfos,
      importTo: (kind, target) => void this.importTo(kind, target),
      switchSet: this.switchSet,
      newSet: this.newSet,
      renameSet: this.renameSet,
      deleteSet: this.deleteSet,
      about: () => void this.about.open(),
    });
    this.ctxMenu = new ContextMenu();
    this.colorPicker = new ColorPicker();
    this.renamePop = new RenamePopover();
    this.about = new AboutDialog({
      version: appVersion,
      openRepo: () => void openExternal(REPO_URL).catch((err) => this.toast.show(t('toast.actionFailed', { msg: String(err) }))),
    });
    this.switcher = new SetSwitcher({ sets: this.setInfos, switchSet: this.switchSet, newSet: this.newSet });
    this.hud.setSlot.append(this.switcher.root);
    this.empty = new EmptyState({
      pickFiles: () => void this.importTo('files', this.service.current.id),
      pickFolder: () => void this.importTo('folder', this.service.current.id),
    });
    this.drop = new DropOverlay();
    this.toast = new Toast();
    this.winControls = new WindowControls(() => ctl.toggleFullscreen());
    this.infoFade = new Styled(this.info.root);
    this.timelineFade = new Styled(this.timeline.root);

    // DOM 顺序即焦点顺序：舞台 → 菜单 → 预览集 → 信息卡 → 时间轴 → 窗口按钮（HANDOFF §9）
    this.root = el('div', { class: 'app' }, [
      this.stage.section,
      this.magnifier.root,
      this.hud.dragRegion,
      this.menu.root,
      this.hud.wordmark,
      this.hud.meter,
      this.hud.pill,
      this.info.root,
      this.hud.hint,
      this.empty.root,
      this.timeline.root,
      this.toast.root,
      this.winControls.root,
      this.drop.root,
      this.ctxMenu.root,
      this.colorPicker.root,
      this.renamePop.root,
      this.about.root,
      this.hud.live,
    ]);
    mount.replaceChildren(this.root);
    applyI18n(this.root);
    // 系统自带的右键菜单不再出现（“另存为 / 复制图像”在自绘菜单里重做）；文本框保留，方便复制粘贴
    document.addEventListener('contextmenu', (e) => {
      const target = e.target as Element | null;
      if (!target?.closest?.('input, textarea')) e.preventDefault();
    });
    ctl.attach(this.root, this.stage.section);
    installFocusOrder(this.root, { thumbs: () => this.stage.liveThumbs(), after: this.timeline.nextButton });
    onLangChange(() => {
      this.labelsVersion++;
      this.updateSetChip();
      ctl.kick();
    });
    this.root.addEventListener('pointermove', this.onRevealMove);
    this.updateSetChip();

    if (this.service.desktop) {
      this.thumbs = new ThumbLoader(
        async (w) => {
          const { mtime, size } = this.service.fileInfo(w.id);
          try {
            const r = await makeThumbnail(w.path!, mtime, size);
            return { url: assetUrl(r.path), color: r.color };
          } catch (err) {
            logError(`缩略图生成失败 ${w.path}: ${String(err)}`);
            throw err;
          }
        },
        () => {
          this.persistSoon(); // 主色要存下来，下次启动加载前就有底色
          ctl.kick();
        },
      );
      void onFileDrop((phase, paths) => {
        this.drop.set(phase === 'over');
        if (phase === 'drop' && paths.length) void this.importSources(classifyDropped(paths), this.service.current.id);
      });
    }
    this.render();
  }

  workCount(): number {
    return this.lib.works.length;
  }

  private indexSeries(): void {
    this.seriesById.clear();
    for (const s of this.lib.series) this.seriesById.set(s.id, s);
  }

  private seriesOf(w: Work): Series {
    return this.seriesById.get(w.series) ?? { id: w.series, name: t('series.unassigned'), color: UNASSIGNED_COLOR };
  }

  // ───────────── 全屏（Controller 调用） ─────────────

  setFullscreen(on: boolean): void {
    this.root.classList.toggle('is-fullscreen', on);
    this.winControls.setFullscreen(on);
    this.reveal = { left: false, right: false };
    this.root.classList.remove('reveal-left', 'reveal-right');
    if (on) this.toast.show(t('fullscreen.hint'));
    void setWindowFullscreen(on).catch((err) => logError(`切换全屏失败: ${String(err)}`));
  }

  /** 全屏时：鼠标到顶部左半边浮出菜单和字标，右半边浮出窗口按钮 */
  private onRevealMove = (e: PointerEvent): void => {
    if (!this.controller.fullscreen) return;
    const top = e.clientY < REVEAL_ZONE_PX;
    const left = top && e.clientX < window.innerWidth / 2;
    const right = top && !left;
    if (left !== this.reveal.left) this.root.classList.toggle('reveal-left', left);
    if (right !== this.reveal.right) this.root.classList.toggle('reveal-right', right);
    this.reveal = { left, right };
  };

  // ───────────── 作品库：导入、换库 ─────────────

  /** 当前作品列表（只读；性能探针用） */
  get works(): readonly Work[] {
    return this.lib.works;
  }

  get seriesList(): Series[] {
    return this.lib.series;
  }

  /** 性能探针：可以临时关掉原图加载，单独测量它的影响 */
  hiResEnabled = true;

  /** 性能探针运行期间不保存任何东西 */
  freezeSaving(): void {
    window.clearTimeout(this.saveTimer);
    this.service.freeze();
  }

  /**
   * 换成新的作品列表，定位到第 focus 幅（直接跳过去，不做动画）。
   * keepCamera：移除作品后用，镜头（系列视图）保持不变；keepUndo：删除 / 撤销自己调用时不作废撤销。
   */
  setLibrary(lib: Library, focus: number, keepCamera = false, keepUndo = false): void {
    // 作品库换掉了（导入、切换预览集、重新扫描）：之前的“撤销”作废
    if (!keepUndo) this.undo = null;
    // 重新扫描后作品对象是新的：已经到位的缩略图和主色接着用，不用重新请求、也不会闪一下
    const prev = new Map(this.lib.works.map((w) => [w.id, w]));
    for (const w of lib.works) {
      const old = prev.get(w.id);
      if (old?.thumb && !old.broken) {
        w.thumb = old.thumb;
        w.bg = old.bg;
      }
    }
    this.lib = lib;
    this.indexSeries();
    this.loading = false;
    this.labelsVersion++;
    if (lib.works.length) this.service.noteCount(lib.works.length);
    const n = lib.works.length;
    const i = clamp(focus, 0, Math.max(0, n - 1));
    const m = this.m;
    m.pos = m.posT = i;
    m.posV = 0;
    if (!keepCamera || n === 0) {
      m.zoom = m.zoomT = 0;
      m.zoomV = 0;
    }
    m.mot = 0;
    this.ui.editing = false;
    this.hiRes = null;
    this.hiResFor = null;
    this.announced = -1;
    this.updateSetChip();
    this.controller.kick();
  }

  /** 选择文件 / 文件夹，导入到新建预览集（target = 'new'）或某个现有预览集 */
  private async importTo(kind: ImportKind, target: 'new' | string): Promise<void> {
    if (!this.service.desktop) {
      this.toast.show(t('import.desktopOnly'));
      return;
    }
    try {
      const sources = await (kind === 'files' ? pickFiles() : pickFolders());
      if (!sources.length) return;
      let targetId = target;
      if (target === 'new') {
        const set = this.service.createSet(nameFromSources(sources.map((s) => s.path), kind === 'files' ? 'file' : 'folder'));
        targetId = set.id;
      }
      await this.importSources(sources, targetId);
    } catch (err) {
      this.toast.show(t('import.failed', { msg: String(err) }));
    }
  }

  async importSources(sources: Source[], targetSetId: string): Promise<void> {
    if (!sources.length || this.importing) return;
    this.flushSave(); // 先把当前预览集没写盘的修改存好，再换
    this.importing = true;
    const switching = targetSetId !== this.service.current.id;
    this.toast.show(t('empty.loading'), true);
    this.controller.kick();
    const token = ++this.loadToken;
    try {
      const keep = switching ? undefined : this.lib.works[this.controller.targetIndex()]?.id;
      const r = await this.service.import(sources, targetSetId);
      if (token !== this.loadToken) return;
      const added = new Set(r.added);
      // 有新作品就跳到第一幅新作品，否则留在原来那幅（换了预览集就到最新一幅）
      let focus = r.lib.works.findIndex((w) => added.has(w.id));
      if (focus < 0) focus = keep ? Math.max(0, r.lib.works.findIndex((w) => w.id === keep)) : r.lib.works.length - 1;
      this.setLibrary(r.lib, focus);
      this.ui.touched = false; // 第一次有作品时显示操作提示
      this.toast.show(r.added.length ? t('import.done', { n: r.added.length }) : t('import.none'));
    } catch (err) {
      this.toast.show(t('import.failed', { msg: String(err) }));
    } finally {
      this.importing = false;
      this.updateSetChip();
    }
  }

  // ───────────── 预览集 ─────────────

  private setInfos = (): SetInfo[] => {
    const cur = this.service.current.id;
    return this.service.sets.map((s) => ({
      id: s.id,
      name: s.name,
      count: s.id === cur && !this.loading ? this.lib.works.length : s.count,
      current: s.id === cur,
    }));
  };

  private updateSetChip(): void {
    this.switcher.update(this.service.current.name);
  }

  /** 加载当前预览集（切换、删除后）：先显示“正在读取”，旧的加载结果作废 */
  private async reloadCurrent(): Promise<void> {
    const token = ++this.loadToken;
    if (this.controller.magnified) this.controller.magnify(false);
    this.setLibrary({ works: [], series: [] }, 0);
    this.loading = true;
    this.updateSetChip();
    this.controller.kick();
    try {
      const lib = await this.loadLibrary();
      if (token !== this.loadToken) return;
      this.setLibrary(lib, lib.works.length - 1);
    } catch (err) {
      if (token !== this.loadToken) return;
      this.loading = false;
      this.toast.show(t('import.failed', { msg: String(err) }));
    }
  }

  private switchSet = (id: string): void => {
    this.flushSave();
    if (this.service.switchTo(id)) void this.reloadCurrent();
  };

  private newSet = (): void => {
    this.flushSave();
    const s = this.service.createSet();
    this.service.switchTo(s.id);
    this.toast.show(t('sets.created', { name: s.name }));
    void this.reloadCurrent();
  };

  private renameSet = (id: string, name: string): void => {
    if (this.service.renameSet(id, name)) this.updateSetChip();
  };

  private deleteSet = (id: string): void => {
    const name = this.service.sets.find((s) => s.id === id)?.name ?? '';
    this.flushSave();
    const changed = this.service.deleteSet(id);
    this.toast.show(t('sets.deleted', { name }));
    this.updateSetChip();
    if (changed) void this.reloadCurrent();
  };

  // ───────────── 图片 ─────────────

  private onArtError(id: string, original: boolean): void {
    if (original) {
      // 原图读不了就继续用缩略图
      if (this.hiRes?.id === id) this.hiRes = null;
      this.controller.kick();
      return;
    }
    const w = this.lib.works.find((x) => x.id === id);
    if (!w) return;
    // 刚生成的缩略图可能正被杀毒软件扫描、短暂锁住：先隔 0.4s、1.2s 各重试一次，再判定读不了
    const n = this.thumbRetries.get(id) ?? 0;
    if (w.thumb && n < THUMB_RETRY_MS.length) {
      this.thumbRetries.set(id, n + 1);
      const base = w.thumb.split('?')[0];
      window.setTimeout(() => {
        w.thumb = `${base}?retry=${n + 1}`;
        this.controller.kick();
      }, THUMB_RETRY_MS[n]);
      return;
    }
    w.broken = true;
    this.controller.kick();
  }

  /** 停留 300ms 后加载原图；放大查看时按全屏尺寸判断需不需要 */
  private requestHiRes(w: Work | undefined): void {
    const magnified = this.controller.magnified;
    const ok = w && w.path && !w.broken && this.hiResEnabled && needsOriginal(w, magnified);
    const key = ok && w ? `${w.id}${magnified ? '|mag' : ''}` : null;
    if (key === this.hiResFor) return;
    this.hiResFor = key;
    this.hiRes = null;
    window.clearTimeout(this.hiResTimer);
    if (!w || !key) return;
    const id = w.id;
    this.hiResTimer = window.setTimeout(() => {
      const url = assetUrl(w.path!);
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      img
        .decode()
        .then(() => {
          if (this.hiResFor === key) {
            this.hiRes = { id, url };
            this.controller.kick();
          }
        })
        .catch(() => {
          /* 原图解码失败：继续用缩略图 */
        });
    }, HIRES_DWELL_MS);
  }

  // ───────────── 系列视图缩略图分页 ─────────────

  /**
   * 每排能放几张：按窗口尺寸缓存，窗口变了才重新量一次信息卡的位置（上排要躲开它）。
   * 信息卡还没显示（空状态）时只按窗口宽度算，不缓存，下次再量。
   */
  private thumbCapsFor(vw: number, vh: number): ThumbCaps {
    const key = `${vw}x${vh}`;
    if (key === this.capsKey) return this.caps;
    const r = this.info.root.getBoundingClientRect();
    if (r.width <= 0) return thumbCaps(vw, vh, vw);
    this.capsKey = key;
    this.caps = thumbCaps(vw, vh, r.left);
    return this.caps;
  }

  /** 胶囊里的 ‹ ›：只翻缩略图，不换当前作品；新一页按拉远镜头时的节奏依次浮现 */
  private turnPage(dir: 1 | -1): void {
    const p = this.lastPage;
    if (!p || p.pages <= 1) return;
    const next = clamp(p.page + dir, 0, p.pages - 1);
    if (next === p.page) return;
    this.pageSel = next;
    this.m.pg = 0;
    this.m.pgV = 0;
    this.ui.hoverThumb = null;
    this.controller.kick();
  }

  private monthJump(dir: 1 | -1): void {
    const works = this.lib.works;
    if (!works.length) return;
    this.controller.go(monthJump(works.map((w) => w.date), this.controller.targetIndex(), dir));
  }

  // ───────────── 标题和系列编辑（HANDOFF §4 SeriesEditor / §5） ─────────────
  // 都作用在“目标那一幅”（posT 四舍五入），和原型一致

  private persist(): void {
    this.service.save(this.lib);
  }

  private persistSoon(): void {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = 0;
      this.persist();
    }, 800);
  }

  /** 换预览集之前：把还没写盘的修改存进当前预览集 */
  private flushSave(): void {
    if (!this.saveTimer) return;
    window.clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    this.persist();
  }

  private target(): Work | undefined {
    return this.lib.works[this.controller.targetIndex()];
  }

  private startEdit = (): void => {
    if (!this.target()) return;
    // 记下打开前的状态：点外面 / Esc 放弃时恢复（标题、系列名、归属、新建的系列）
    if (!this.ui.editing) {
      this.editSnapshot = {
        series: this.lib.series.map((s) => ({ ...s })),
        works: new Map(this.lib.works.map((w) => [w.id, { series: w.series, customTitle: w.customTitle }])),
      };
    }
    this.ui.editing = true;
    this.ui.touched = true;
    this.render(); // 先同步渲染出编辑态，输入框才能拿到焦点
    this.info.focusInput();
    this.controller.kick();
  };

  private retitle = (title: string): void => {
    if (!this.target()) return;
    setCustomTitle(this.lib, this.controller.targetIndex(), title);
    this.persist();
    this.controller.kick();
  };

  private rename = (name: string): void => {
    const w = this.target();
    if (!w) return;
    renameSeries(this.lib, w.series, name);
    this.persist();
    this.controller.kick();
  };

  private pick = (seriesId: string): void => {
    if (!this.target()) return;
    assignWork(this.lib, this.controller.targetIndex(), seriesId);
    this.persist();
    this.controller.kick();
  };

  private newSeries = (): void => {
    if (!this.target()) return;
    createSeries(this.lib, this.controller.targetIndex());
    this.indexSeries();
    this.persist();
    this.controller.kick();
  };

  private finishEdit = (): void => {
    const hadFocus = this.info.hasFocusInEditor();
    finalizeNames(this.lib);
    this.ui.editing = false;
    this.editSnapshot = null;
    this.labelsVersion++; // 标题可能改了，时间轴刻度的读屏标签跟着刷新
    this.persist();
    this.render();
    // 焦点回到展示态的铅笔按钮，键盘用户不会丢失位置
    if (hadFocus) this.info.editButton.focus({ preventScroll: true });
    this.controller.kick();
  };

  /** 点编辑卡外面 / Esc：放弃这次的修改，恢复到打开编辑卡之前，然后关闭 */
  private cancelEdit = (): void => {
    if (!this.ui.editing) return;
    const snap = this.editSnapshot;
    if (snap) {
      this.lib.series = snap.series.map((s) => ({ ...s }));
      for (const w of this.lib.works) {
        const s = snap.works.get(w.id);
        if (!s) continue;
        w.series = s.series;
        if (s.customTitle) w.customTitle = s.customTitle;
        else delete w.customTitle;
      }
      this.indexSeries();
    }
    this.finishEdit();
  };

  // ───────────── 右键菜单：作品 / 系列（2026-11-17 改，原来在编辑卡里）；源文件都不动 ─────────────

  private openWorkMenu(index: number, x: number, y: number): void {
    const w = this.lib.works[index];
    if (!w) return;
    const file = this.service.desktop && w.path ? w.path : null;
    const items: CtxItem[] = [{ caption: displayTitle(w) }];
    if (file) {
      const fail = (err: unknown) => this.toast.show(t('toast.actionFailed', { msg: String(err) }));
      items.push(
        {
          label: t('ctx.copyImage'),
          icon: ICON_COPY,
          run: () => void copyImage(assetUrl(file)).then(() => this.toast.show(t('toast.copied')), fail),
        },
        {
          label: t('ctx.saveAs'),
          icon: ICON_DOWNLOAD,
          run: () =>
            void saveImageAs(file).then((to) => {
              if (to) this.toast.show(t('toast.saved', { name: to.split(/[\\/]/).pop() ?? to }));
            }, fail),
        },
        { label: t('ctx.reveal'), icon: ICON_FOLDER, run: () => void revealInFolder(file).catch(fail) },
        'divider',
      );
    }
    items.push({ label: t('ctx.removeWork'), icon: ICON_TRASH, danger: true, run: () => this.removeWorkAt(index) });
    this.ctxMenu.show(items, x, y, t('ctx.label', { name: displayTitle(w) }));
  }

  private openSeriesMenu(seriesId: string, x: number, y: number): void {
    const s = this.seriesById.get(seriesId);
    const name = s ? displayName(s) : t('series.unassigned');
    const items: CtxItem[] = [{ caption: name }];
    if (s) {
      items.push(
        { label: t('ctx.renameSeries'), icon: ICON_PENCIL, run: () => this.renameSeriesAt(s, x, y) },
        { label: t('ctx.recolorSeries'), icon: ICON_PALETTE, run: () => this.recolorSeriesAt(s, x, y) },
        'divider',
      );
    }
    // “未归类”不能只删系列（作品本来就在这里），只能连同照片一起删
    if (seriesId !== UNSORTED_ID) {
      items.push({ label: t('ctx.deleteSeriesKeep'), icon: ICON_REMOVE, run: () => this.deleteSeriesById(seriesId, false) });
    }
    items.push({ label: t('ctx.deleteSeriesAll'), icon: ICON_TRASH, danger: true, run: () => this.deleteSeriesById(seriesId, true) });
    this.ctxMenu.show(items, x, y, t('ctx.label', { name }));
  }

  /**
   * 右键系列 → 修改名称 / 修改颜色（2026-11-17 新增）。
   * 编辑卡开着时，改动同时写进编辑卡的快照：之后在编辑卡里点“取消”不会把这次改的名字 / 颜色也恢复掉。
   */
  private patchEditSnapshot(id: string, patch: Partial<Series>): void {
    const s = this.editSnapshot?.series.find((x) => x.id === id);
    if (s) Object.assign(s, patch);
  }

  private renameSeriesAt(s: Series, x: number, y: number): void {
    this.renamePop.open({ name: displayName(s), color: s.color }, x, y, (name) => {
      renameSeries(this.lib, s.id, name);
      this.patchEditSnapshot(s.id, { name: s.name });
      this.info.refreshEditor(); // 编辑卡里的“系列标签”框换成新名字
      this.labelsVersion++;
      this.persist();
      this.controller.kick();
    });
  }

  private recolorSeriesAt(s: Series, x: number, y: number): void {
    const original = s.color;
    this.colorPicker.open({ name: displayName(s), color: s.color }, x, y, {
      // 拖动中界面里这个系列的圆点就跟着变（只改内存，不写盘）
      preview: (hex) => {
        s.color = hex;
        this.controller.kick();
      },
      commit: (hex) => {
        s.color = hex;
        this.patchEditSnapshot(s.id, { color: hex });
        this.persist();
        this.controller.kick();
      },
      cancel: () => {
        s.color = original;
        this.controller.kick();
      },
    });
  }

  /** 删除前的快照（撤销用）；先把编辑卡里的修改保存掉，免得放弃编辑时把删掉的东西恢复回来 */
  private snapshotForUndo(): UndoSnapshot {
    if (this.ui.editing) this.finishEdit();
    finalizeNames(this.lib);
    return {
      works: this.lib.works,
      seriesOf: new Map(this.lib.works.map((w) => [w.id, w.series])),
      series: this.lib.series.map((s) => ({ ...s })),
      removed: [],
      focusId: this.target()?.id,
    };
  }

  /** 删除之后停在哪：原来那幅还在就停在它，否则停在原位置往后第一幅没被删的（没有就往前找） */
  private focusAfter(old: readonly Work[], focusId: string | undefined, gone: ReadonlySet<string>): number {
    const works = this.lib.works;
    if (!works.length) return 0;
    const at = Math.max(0, old.findIndex((w) => w.id === focusId));
    const keep = old.slice(at).find((w) => !gone.has(w.id)) ?? old.slice(0, at).reverse().find((w) => !gone.has(w.id));
    return keep ? Math.max(0, works.findIndex((w) => w.id === keep.id)) : 0;
  }

  /** 换掉作品列表后（删除、撤销）：镜头不变，焦点交还舞台 */
  private afterRemoval(focus: number): void {
    const hadFocus = this.root.contains(document.activeElement) && document.activeElement !== this.stage.section;
    this.setLibrary(this.lib, focus, true, true);
    this.render();
    if (hadFocus) this.stage.section.focus({ preventScroll: true });
  }

  private removeWorkAt(index: number): void {
    const w = this.lib.works[index];
    if (!w) return;
    const snap = this.snapshotForUndo();
    const removed = removeWorks(this.lib, new Set([w.id]));
    snap.removed = removed;
    this.service.removeWorks(removed, this.lib);
    this.afterRemoval(this.focusAfter(snap.works, snap.focusId, new Set(removed)));
    this.offerUndo(snap, t('toast.workRemoved', { title: displayTitle(w) }));
  }

  private deleteSeriesById(seriesId: string, withWorks: boolean): void {
    const s = this.seriesById.get(seriesId);
    const name = s ? displayName(s) : t('series.unassigned');
    const n = this.lib.works.filter((w) => w.series === seriesId).length;
    const snap = this.snapshotForUndo();
    const removed = deleteSeries(this.lib, seriesId, withWorks);
    this.indexSeries();
    snap.removed = removed;
    if (withWorks) {
      this.service.removeWorks(removed, this.lib);
      this.afterRemoval(this.focusAfter(snap.works, snap.focusId, new Set(removed)));
      this.offerUndo(snap, t('toast.seriesRemoved', { name, n }));
    } else {
      this.persist();
      this.labelsVersion++;
      this.controller.kick();
      this.offerUndo(snap, t('toast.seriesDeleted', { name, n }));
    }
  }

  private offerUndo(snap: UndoSnapshot, message: string): void {
    this.undo = snap;
    this.toast.show(message, { action: { label: t('toast.undo'), run: () => this.runUndo(snap) } });
  }

  /** 撤销最近一次右键删除：作品列表、归属、系列列表恢复原样，“已移除”的标记去掉 */
  private runUndo(snap: UndoSnapshot): void {
    if (this.undo !== snap) return;
    this.undo = null;
    if (this.ui.editing) this.finishEdit();
    this.lib.works = snap.works;
    for (const w of this.lib.works) w.series = snap.seriesOf.get(w.id) ?? w.series;
    this.lib.series = snap.series.map((s) => ({ ...s }));
    this.indexSeries();
    this.service.restoreWorks(snap.removed, this.lib);
    const focus = Math.max(0, this.lib.works.findIndex((w) => w.id === snap.focusId));
    this.afterRemoval(focus);
    this.toast.show(t('toast.undone'));
  }

  // ───────────── 每帧渲染 ─────────────

  render(): void {
    const works = this.lib.works;
    const n = works.length;
    const m = this.m;
    const vw = window.innerWidth, vh = window.innerHeight;

    const empty = n === 0;
    if (empty !== this.isEmpty) {
      this.isEmpty = empty;
      this.root.classList.toggle('is-empty', empty);
    }
    this.empty.set(empty, this.loading || this.importing);
    if (empty) {
      // HANDOFF §8 空状态：舞台只显示玻璃网格
      this.stage.render({
        works, pos: 0, posV: 0, zoom: 0, zoomV: 0, press: m.press, ox: m.ox, oy: m.oy, mot: 0, cur: -1,
        members: [], fade: 1, hoverThumb: null, grabbing: false, reduced: this.controller.reduced, hiRes: null, mag: 0, fs: 0,
      });
      this.magnifier.render({ work: null, src: undefined, mag: 0, fs: 0, card: { cx: 0, cy: 0, w: 0, h: 0 }, frac: 0, vw, vh, animating: false });
      return;
    }

    const { cur, frac } = currentOf(m.pos, n);
    const wc = works[cur];
    const sc = this.seriesOf(wc);
    // 同系列的所有作品（含当前）；系列视图的缩略图按窗口能放下的数量分页
    const series: number[] = [];
    for (let i = 0; i < n; i++) if (works[i].series === wc.series) series.push(i);
    if (cur !== this.pageCur) {
      this.pageCur = cur;
      this.pageSel = null; // 换了作品：回到“当前那幅所在的页”
    }
    const page = thumbPage(series, cur, this.thumbCapsFor(vw, vh), this.pageSel);
    this.lastPage = page;
    const fade = rowFade(frac);
    const zc = clamp(m.zoom, 0, 1);
    const mag = clamp(m.mag, 0, 1);

    this.requestHiRes(wc);
    if (this.thumbs && (cur !== this.loaderCur || works !== this.loaderWorks)) {
      this.loaderCur = cur;
      this.loaderWorks = works;
      this.thumbs.update(works, cur);
    }

    this.stage.render({
      works, pos: m.pos, posV: m.posV, zoom: m.zoom, zoomV: m.zoomV, press: m.press,
      ox: m.ox, oy: m.oy, mot: m.mot, cur, members: page.items, thumbTop: page.top, thumbIn: m.pg,
      fade, hoverThumb: this.ui.hoverThumb,
      grabbing: this.ui.axis !== null,
      reduced: this.controller.reduced,
      hiRes: this.hiRes,
      mag,
      fs: clamp(m.fs, 0, 1),
    });

    // 放大层：从舞台中间那张卡片的位置长出来
    const art = artSize(aspectOf(wc));
    const p = paintingAt(cur - m.pos, { press: clamp(m.press, -0.2, 1.2), pxN: 0, pyN: 0, vel: 0 }, art);
    const card = p
      ? cardRect(p.x, p.y, art.w, art.h, p.s, stageUnit(vw, vh), cameraScale(m.zoom), vw, vh)
      : { cx: vw / 2, cy: vh / 2, w: 0, h: 0 };
    this.magnifier.render({
      work: wc,
      src: this.hiRes && this.hiRes.id === wc.id ? this.hiRes.url : wc.thumb,
      mag,
      fs: clamp(m.fs, 0, 1),
      card,
      frac,
      vw,
      vh,
      animating:
        Math.abs(m.mag - m.magT) > 1e-3 || Math.abs(m.magV) > 1e-3 || Math.abs(m.fs - m.fsT) > 1e-3 || Math.abs(m.fsV) > 1e-3,
    });

    // 放大时信息卡、时间轴、提示、系列胶囊淡出，不挡画
    const uiOpacity = 1 - mag;
    this.infoFade.set('opacity', String(Math.round(uiOpacity * 1000) / 1000));
    this.infoFade.set('pointer-events', mag > 0.5 ? 'none' : 'auto');
    this.timelineFade.set('opacity', String(Math.round(uiOpacity * 1000) / 1000));
    this.timelineFade.set('pointer-events', mag > 0.5 ? 'none' : 'auto');

    this.hud.render({
      cur, n, zc,
      level: cameraLevel(m.zoom, m.mag),
      meterVisible: this.ui.axis === 'y',
      hintVisible: !this.ui.touched && mag < 0.01,
      header: {
        name: displayName(sc),
        color: sc.color,
        count: series.length,
        opacity: headerOpacity(zc, fade) * uiOpacity,
        page: page.page,
        pages: page.pages,
      },
    });

    let edit = null;
    if (this.ui.editing) {
      const ew = works[this.controller.targetIndex()];
      edit = {
        work: ew,
        series: this.seriesOf(ew),
        chips: visibleSeries(this.lib).map((s) => ({
          id: s.id, name: displayName(s), color: s.color, selected: s.id === ew.series,
        })),
      };
    }
    this.info.render({ work: wc, series: sc, count: series.length, frac, zoom: zc, edit });
    this.timeline.render({ works, cur, pos: m.pos, vel: m.posV, labelsVersion: this.labelsVersion });

    if (cur !== this.announced) {
      // 首次渲染不播报，之后每次切换作品播报“标题，日期，系列名”
      if (this.announced >= 0) {
        this.hud.announce(
          t('announce', { title: displayTitle(wc), date: wc.date || t('date.unknown'), series: displayName(sc) }),
        );
      }
      this.announced = cur;
    }
  }
}
