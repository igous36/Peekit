// 应用外壳：持有作品库和运动状态，组装各个视图，render() 把状态算成样式。
// 弹簧积分和输入处理在 Controller 里；render() 由 Controller 的 rAF 循环每帧调用一次。
import type { Library, Series, Work } from './data/types';
import { createMotion, type Motion } from './engine/motion';
import { currentOf, rowFade, headerOpacity, needsOriginalFor } from './engine/mapping';
import { clamp } from './engine/math';
import { Controller, type UiFlags } from './controller';
import { UNASSIGNED_COLOR } from './tokens';
import { applyI18n, onLangChange, t } from './i18n';
import { el } from './view/dom';
import { StageView } from './view/stage';
import { Hud } from './view/hud';
import { InfoPanel } from './view/info';
import { Timeline } from './view/timeline';
import { WindowControls } from './view/window-controls';
import { AppMenu } from './view/menu';
import { DropOverlay, EmptyState, Toast } from './view/overlays';
import { installFocusOrder } from './view/focus-order';
import type { LibraryService } from './data/service';
import type { Source } from './data/library';
import {
  assetUrl, classifyDropped, diagnoseImage, logError, makeThumbnail, onFileDrop, pickFiles, pickFolders,
} from './data/tauri-io';
import { ThumbLoader } from './data/thumb-loader';
import {
  assignWork, createSeries, displayName, displayTitle, finalizeNames, renameSeries, setCustomTitle, visibleSeries,
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
}

/** 在某一幅停留超过这么久才加载原图（HANDOFF §8） */
const HIRES_DWELL_MS = 300;
/** 缩略图加载失败后的重试间隔 */
const THUMB_RETRY_MS = [400, 1200];
const needsOriginal = (w: Work): boolean =>
  needsOriginalFor(w.width, w.height, window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);

export class App {
  readonly root: HTMLElement;
  readonly m: Motion;
  readonly ui: UiState = { editing: false, touched: false, axis: null, hoverThumb: null };
  readonly controller: Controller;

  private lib: Library;
  private service: LibraryService;
  private seriesById = new Map<string, Series>();
  private stage: StageView;
  private hud: Hud;
  private info: InfoPanel;
  private timeline: Timeline;
  private empty: EmptyState;
  private drop: DropOverlay;
  private toast: Toast;
  private thumbs: ThumbLoader | null = null;
  private announced = -1;
  private labelsVersion = 0;
  private isEmpty: boolean | null = null;
  private loading: boolean;
  private importing = false;
  // 原图：停留 300ms 后加载、解码好再换上
  private hiRes: { id: string; url: string } | null = null;
  private hiResFor: string | null = null;
  private hiResTimer = 0;
  private loaderCur = -1;
  private loaderWorks: readonly Work[] | null = null;
  private saveTimer = 0;
  private thumbRetries = new Map<string, number>();

  constructor(mount: HTMLElement, opts: AppOptions) {
    this.lib = opts.lib;
    this.service = opts.service;
    this.loading = !!opts.loading;
    this.indexSeries();
    const n = this.lib.works.length;
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
    });
    this.hud = new Hud({ startEdit: this.startEdit });
    this.info = new InfoPanel({
      startEdit: this.startEdit,
      retitle: this.retitle,
      rename: this.rename,
      pick: this.pick,
      newSeries: this.newSeries,
      finish: this.finishEdit,
    });
    this.timeline = new Timeline({ go: (i) => ctl.go(i), prev: ctl.prev, next: ctl.next });
    const menu = new AppMenu({ importFiles: () => this.importVia(pickFiles), importFolder: () => this.importVia(pickFolders) });
    this.empty = new EmptyState({ pickFiles: () => this.importVia(pickFiles), pickFolder: () => this.importVia(pickFolders) });
    this.drop = new DropOverlay();
    this.toast = new Toast();

    // DOM 顺序即焦点顺序：舞台 → 菜单 → 信息卡 → 时间轴 → 窗口按钮（HANDOFF §9）
    this.root = el('div', { class: 'app' }, [
      this.stage.section,
      this.hud.dragRegion,
      menu.root,
      this.hud.wordmark,
      this.hud.meter,
      this.hud.pill,
      this.info.root,
      this.hud.hint,
      this.empty.root,
      this.timeline.root,
      this.toast.root,
      new WindowControls().root,
      this.drop.root,
      this.hud.live,
    ]);
    mount.replaceChildren(this.root);
    applyI18n(this.root);
    ctl.attach(this.root, this.stage.section);
    installFocusOrder(this.root, { thumbs: () => this.stage.liveThumbs(), after: this.timeline.nextButton });
    onLangChange(() => {
      this.labelsVersion++;
      ctl.kick();
    });

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
        if (phase === 'drop' && paths.length) void this.importSources(classifyDropped(paths));
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

  /** 换成新的作品列表，定位到第 focus 幅（直接跳过去，不做动画） */
  setLibrary(lib: Library, focus: number): void {
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
    const n = lib.works.length;
    const i = clamp(focus, 0, Math.max(0, n - 1));
    const m = this.m;
    m.pos = m.posT = i;
    m.posV = 0;
    m.zoom = m.zoomT = 0;
    m.zoomV = 0;
    m.mot = 0;
    this.ui.editing = false;
    this.hiRes = null;
    this.hiResFor = null;
    this.announced = -1;
    this.controller.kick();
  }

  private async importVia(pick: () => Promise<Source[]>): Promise<void> {
    if (!this.service.desktop) {
      this.toast.show(t('import.desktopOnly'));
      return;
    }
    try {
      await this.importSources(await pick());
    } catch (err) {
      this.toast.show(t('import.failed', { msg: String(err) }));
    }
  }

  async importSources(sources: Source[]): Promise<void> {
    if (!sources.length || this.importing) return;
    this.importing = true;
    this.toast.show(t('empty.loading'), true);
    this.controller.kick();
    try {
      const keep = this.lib.works[this.controller.targetIndex()]?.id;
      const r = await this.service.import(sources);
      const added = new Set(r.added);
      // 有新作品就跳到第一幅新作品，否则留在原来那幅
      let focus = r.lib.works.findIndex((w) => added.has(w.id));
      if (focus < 0) focus = Math.max(0, r.lib.works.findIndex((w) => w.id === keep));
      this.setLibrary(r.lib, focus);
      this.ui.touched = false; // 第一次有作品时显示操作提示
      this.toast.show(r.added.length ? t('import.done', { n: r.added.length }) : t('import.none'));
    } catch (err) {
      this.toast.show(t('import.failed', { msg: String(err) }));
    } finally {
      this.importing = false;
    }
  }

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

  private requestHiRes(w: Work | undefined): void {
    const id = w && w.path && !w.broken && this.hiResEnabled && needsOriginal(w) ? w.id : null;
    if (id === this.hiResFor) return;
    this.hiResFor = id;
    this.hiRes = null;
    window.clearTimeout(this.hiResTimer);
    if (!w || !id) return;
    this.hiResTimer = window.setTimeout(() => {
      const url = assetUrl(w.path!);
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      img
        .decode()
        .then(() => {
          if (this.hiResFor === id) {
            this.hiRes = { id, url };
            this.controller.kick();
          }
        })
        .catch(() => {
          /* 原图解码失败：继续用缩略图 */
        });
    }, HIRES_DWELL_MS);
  }

  // ───────────── 标题和系列编辑（HANDOFF §4 SeriesEditor / §5） ─────────────
  // 都作用在“目标那一幅”（posT 四舍五入），和原型一致

  private persist(): void {
    this.service.save(this.lib);
  }

  private persistSoon(): void {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.persist(), 800);
  }

  private target(): Work | undefined {
    return this.lib.works[this.controller.targetIndex()];
  }

  private startEdit = (): void => {
    if (!this.target()) return;
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
    this.labelsVersion++; // 标题可能改了，时间轴刻度的读屏标签跟着刷新
    this.persist();
    this.render();
    // 焦点回到展示态的铅笔按钮，键盘用户不会丢失位置
    if (hadFocus) this.info.editButton.focus({ preventScroll: true });
    this.controller.kick();
  };

  // ───────────── 每帧渲染 ─────────────

  render(): void {
    const works = this.lib.works;
    const n = works.length;
    const m = this.m;

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
        members: [], fade: 1, hoverThumb: null, grabbing: false, reduced: this.controller.reduced, hiRes: null,
      });
      return;
    }

    const { cur, frac } = currentOf(m.pos, n);
    const wc = works[cur];
    const sc = this.seriesOf(wc);
    const members: number[] = [];
    for (let i = 0; i < n; i++) if (i !== cur && works[i].series === wc.series) members.push(i);
    const fade = rowFade(frac);
    const zc = clamp(m.zoom, 0, 1);

    this.requestHiRes(wc);
    if (this.thumbs && (cur !== this.loaderCur || works !== this.loaderWorks)) {
      this.loaderCur = cur;
      this.loaderWorks = works;
      this.thumbs.update(works, cur);
    }

    this.stage.render({
      works, pos: m.pos, posV: m.posV, zoom: m.zoom, zoomV: m.zoomV, press: m.press,
      ox: m.ox, oy: m.oy, mot: m.mot, cur, members, fade, hoverThumb: this.ui.hoverThumb,
      grabbing: this.ui.axis !== null,
      reduced: this.controller.reduced,
      hiRes: this.hiRes,
    });
    this.hud.render({
      cur, n, zc,
      meterVisible: this.ui.axis === 'y',
      hintVisible: !this.ui.touched,
      header: {
        name: displayName(sc),
        color: sc.color,
        count: members.length + 1,
        opacity: headerOpacity(zc, fade),
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
    this.info.render({ work: wc, series: sc, count: members.length + 1, frac, edit });
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
