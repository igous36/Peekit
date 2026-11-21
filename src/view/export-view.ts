// 导出（2026-11-21）：整页盖在舞台上（和创作年历同一层），左边实时预览，右边设置。
//
//   ‹ 预览 │ 导出
//   ┌──────────── 预览（和导出用同一份坐标摆 DOM，缩小显示）────────────┐ ┌ 设置 ──────────────┐
//   │                                                                │ │ [ 作品 | 情绪板 ]        │
//   │                                                                │ │ 内容：全部 / 筛选 / 系列▾ │
//   │                                                                │ │ 版式：长图 网格 拼图 PDF │
//   │                                                                │ │ 列数 / 比例 / 页面       │
//   │                                                                │ │ 底色、留白、间距          │
//   │                                                                │ │ 底部说明（标题、作者）    │
//   │                                                                │ │ 每幅的标题和日期、标识    │
//   │                                                                │ │ 尺寸、格式               │
//   │                                                                │ │ 1600 × 18 240 px  [导出] │
//   └────────────────────────────────────────────────────────────────┘ └────────────────────┘
//
// 两种模式：
//   作品    当前预览集的全部作品 / 筛选结果 / 任意一个系列，按版式排
//   情绪板  选一个情绪板，按画布上的样子原样导出（网点底、照片、标注，export-board.ts），没有版式、间距、每幅标题；
//           说明和 Peekit 标识默认关，说明里不写幅数；底色、留白、尺寸这些和作品模式分开记
//
// 设置（除了说明的标题）记在 localStorage（peekit:export），下次打开还是上次的样子。
// 预览只在打开、改设置、窗口变大小时重建；真正导出时才按导出尺寸读图、画到画布上（export-render.ts）。
import type { Work } from '../data/types';
import type { Board, BoardItem } from '../data/boards';
import { groupColor } from '../data/boards';
import { contentBounds } from '../engine/marks';
import { t, type MessageKey } from '../i18n';
import { displayTitle } from '../data/series-ops';
import { el, svgIcon, ICON_PREV, ICON_NEXT } from './dom';
import { fillArt } from './art';
import { markSvg, PEEKIT } from './wordmark';
import { paintMarksStatic } from './board/board-marks';
import {
  brandWidth, dateRange, pageSize, pickCover, planBoardExport, planExport,
  type BoardExportSettings, type BoardPlan, type CollageRatio, type ExportLayout, type ExportPlan, type ExportSettings,
  type ExportSize, type Page, type PdfPageSize, type Spacing,
} from '../engine/export-layout';
import {
  EXPORT_THEMES, renderImage, renderPdf, type ExportBg, type ExportImages, type ExportTexts, type ExportTheme, type RenderControl,
} from './export-render';
import { renderBoard } from './export-board';

export type ExportScope = 'all' | 'filtered' | 'series';
export type ExportMode = 'works' | 'board';

export interface ExportSeries {
  id: string;
  name: string;
  works: readonly Work[];
}

export interface ExportHost {
  /** 当前预览集的全部作品 */
  all(): readonly Work[];
  /** 按星 / 颜色筛选后的作品；没在筛选时 null */
  filtered(): readonly Work[] | null;
  /** 当前预览集里有作品的系列（按系列顺序） */
  seriesList(): readonly ExportSeries[];
  /** 当前这幅所在的系列 */
  currentSeries(): string | null;
  setName(): string;
  /** 预览用的缩略图地址：有就直接给，示例数据 null，还没有 undefined（再用 makeThumb 生成） */
  thumb(w: Work): string | null | undefined;
  /** 还没有缩略图的作品生成一张（预览排队调用，最多同时 3 个） */
  makeThumb(w: Work): Promise<string | null>;
  /** 导出时读图 */
  images(works: readonly Work[]): ExportImages;
  /** 全部情绪板（最近用过的在前） */
  boards(): readonly Board[];
  /** 情绪板里一张照片的缩略图（同 thumb / makeThumb） */
  boardThumb(it: BoardItem): string | null | undefined;
  makeBoardThumb(it: BoardItem): Promise<string | null>;
  /** 导出情绪板时读图（下标是 board.items 的下标） */
  boardImages(b: Board): ExportImages;
  save(bytes: Uint8Array, fileName: string): Promise<string | null>;
  toast(msg: string, sticky?: boolean): void;
  close(): void;
}

/** 两种模式共用的几项（情绪板模式另记一份） */
interface Shared {
  bg: ExportBg;
  margin: Spacing;
  summary: boolean;
  brand: boolean;
  size: ExportSize;
  format: 'jpg' | 'png';
}

export interface Saved extends ExportSettings {
  bg: ExportBg;
  format: 'jpg' | 'png';
  author: string;
  /** 情绪板模式的设置 */
  board: Shared;
}

const KEY = 'peekit:export';
const BOARD_DEFAULTS: Shared = { bg: 'gray', margin: 1, summary: false, brand: false, size: 1, format: 'jpg' };
const DEFAULTS: Saved = {
  layout: 'long', columns: 3, ratio: '16:9', page: 'a4-landscape', margin: 1, gap: 1, captions: false, summary: true, brand: true, size: 1,
  bg: 'white', format: 'jpg', author: '', board: { ...BOARD_DEFAULTS },
};
const LAYOUTS: ExportLayout[] = ['long', 'grid', 'collage', 'pdf'];
const RATIOS: CollageRatio[] = ['16:9', '4:3', '1:1', '3:4', '9:16'];
const PAGES: PdfPageSize[] = ['a4-landscape', 'a4-portrait', 'wide'];
const BGS: ExportBg[] = ['white', 'paper', 'gray', 'ink'];
const SIZES: ExportSize[] = [1, 1.5, 2];
const SPACINGS: Spacing[] = [0, 1, 2];
/** 预览区四周留的空（px） */
const PAD = 40;

/** 版式的小图标：一列、瀑布流、一页拼图、几页纸 */
const LAYOUT_ICONS: Record<ExportLayout, string[]> = {
  long: ['M7 3h10v7H7z', 'M7 12h10v9H7z'],
  grid: ['M4 4h7v9H4z', 'M13 4h7v5h-7z', 'M13 11h7v9h-7z', 'M4 15h7v5H4z'],
  collage: ['M3 5h18v14H3z', 'M6 8h5v8H6z', 'M13 8h5v3h-5z', 'M13 13h5v3h-5z'],
  pdf: ['M8 3h7l4 4v14H8z', 'M15 3v4h4', 'M5 6v15h11'],
};

const pick = <T>(v: unknown, ok: readonly T[], d: T): T => (ok.includes(v as T) ? (v as T) : d);
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);

function loadShared(raw: Partial<Shared> | undefined, d: Shared): Shared {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    bg: pick(r.bg, BGS, d.bg),
    margin: pick(r.margin, SPACINGS, d.margin),
    summary: bool(r.summary, d.summary),
    brand: bool(r.brand, d.brand),
    size: pick(r.size, SIZES, d.size),
    format: pick(r.format, ['jpg', 'png'] as const, d.format),
  };
}

function load(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Saved> | null;
    if (!raw || typeof raw !== 'object') return { ...DEFAULTS, board: { ...BOARD_DEFAULTS } };
    return {
      ...loadShared(raw, DEFAULTS),
      layout: pick(raw.layout, LAYOUTS, DEFAULTS.layout),
      columns: pick(raw.columns, [2, 3, 4], DEFAULTS.columns),
      ratio: pick(raw.ratio, RATIOS, DEFAULTS.ratio),
      page: pick(raw.page, PAGES, DEFAULTS.page),
      gap: pick(raw.gap, SPACINGS, DEFAULTS.gap),
      captions: bool(raw.captions, DEFAULTS.captions),
      author: typeof raw.author === 'string' ? raw.author.slice(0, 80) : '',
      board: loadShared(raw.board, BOARD_DEFAULTS),
    };
  } catch {
    return { ...DEFAULTS, board: { ...BOARD_DEFAULTS } };
  }
}

/** 文件名里不能有的字符换成短横 */
const safeName = (s: string): string => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').trim().slice(0, 120) || 'Peekit';

const fmtNum = (n: number): string => n.toLocaleString();

/** 网点颜色（预览用，和 export-board.ts 一致） */
const dotCss = (bg: ExportBg): [string, string] =>
  bg === 'ink' ? ['rgba(255,255,255,0.12)', 'rgba(255,255,255,0.22)'] : ['rgba(22,22,22,0.17)', 'rgba(22,22,22,0.28)'];

export class ExportView {
  readonly root: HTMLElement;
  private preview: HTMLElement;
  private stage: HTMLElement;
  private panel: HTMLElement;
  private info: HTMLElement;
  private hint: HTMLElement;
  private saveBtn: HTMLButtonElement;
  private saveLabel: HTMLElement;
  private titleInput: HTMLInputElement;
  private authorInput: HTMLInputElement;
  private seriesListEl: HTMLElement;
  private boardListEl: HTMLElement;
  private syncers: (() => void)[] = [];
  private s: Saved = load();
  private mode: ExportMode = 'works';
  private scope: ExportScope = 'all';
  /** 选的系列、情绪板 */
  private seriesId: string | null = null;
  private boardId: string | null = null;
  /** 系列列表展开着 */
  private seriesOpen = false;
  /** 说明的标题：用户改过就不再跟着范围变 */
  private title = '';
  private titleEdited = false;
  private open = false;
  private returnFocus: HTMLElement | null = null;
  private ctl: RenderControl | null = null;
  /** 预览的代次：重建后，之前还没回来的缩略图不再往旧节点里填 */
  private gen = 0;

  constructor(private host: ExportHost) {
    const back = el('button', { type: 'button', class: 'board-back', 'data-i18n-title': 'board.back', 'data-i18n-aria': 'board.back' }, [
      svgIcon(ICON_PREV, 16), el('span', { 'data-i18n': 'board.backShort' }, [t('board.backShort')]),
    ]);
    back.addEventListener('click', () => this.host.close());
    const bar = el('div', { class: 'board-bar cal-bar' }, [
      back,
      el('span', { class: 'board-bar-sep', 'aria-hidden': 'true' }),
      el('h1', { class: 'cal-title', 'data-i18n': 'export.title' }, [t('export.title')]),
    ]);
    this.stage = el('div', { class: 'export-stage' });
    this.preview = el('div', { class: 'export-preview', role: 'img', 'data-i18n-aria': 'export.preview' }, [this.stage]);

    this.titleInput = el('input', { type: 'text', class: 'series-input export-input', maxlength: 120, autocomplete: 'off', spellcheck: 'false' });
    this.titleInput.addEventListener('input', () => {
      this.title = this.titleInput.value;
      this.titleEdited = true;
      this.schedule();
    });
    this.authorInput = el('input', {
      type: 'text', class: 'series-input export-input', maxlength: 80, autocomplete: 'off', spellcheck: 'false',
      'data-i18n-placeholder': 'export.authorPlaceholder', placeholder: t('export.authorPlaceholder'),
    });
    this.authorInput.addEventListener('input', () => {
      this.s.author = this.authorInput.value;
      this.persist();
      this.schedule();
    });
    this.seriesListEl = el('div', { class: 'export-pick-list', role: 'radiogroup', 'data-i18n-aria': 'export.pickSeries', 'aria-label': t('export.pickSeries') });
    this.boardListEl = el('div', { class: 'export-scopes', role: 'radiogroup', 'data-i18n-aria': 'export.mode.board', 'aria-label': t('export.mode.board') });

    this.info = el('p', { class: 'export-info' });
    this.hint = el('p', { class: 'export-hint' });
    this.saveLabel = el('span', {}, [t('export.save')]);
    this.saveBtn = el('button', { type: 'button', class: 'pop-btn pop-btn--primary export-save' }, [this.saveLabel]);
    this.saveBtn.addEventListener('click', () => void this.doExport());

    const scroll = el('div', { class: 'export-panel-scroll' }, this.controls());
    this.panel = el('aside', { class: 'export-panel', 'data-i18n-aria': 'export.title' }, [
      scroll,
      el('div', { class: 'export-foot' }, [this.info, this.hint, this.saveBtn]),
    ]);
    this.root = el('section', { class: 'export', hidden: true, 'data-i18n-aria': 'export.title' }, [
      this.preview,
      el('div', { class: 'board-drag', 'data-tauri-drag-region': '' }),
      bar,
      this.panel,
    ]);

    // 捕获阶段：开着时 Esc 回到预览（在输入框里按 Esc 先离开输入框，系列列表展开着先收起）
    document.addEventListener('keydown', (e) => {
      if (!this.open || e.defaultPrevented || e.key !== 'Escape') return;
      const tg = e.target as HTMLElement | null;
      if (tg?.closest?.('.menu-panel, .ctx-menu, .about-dialog, .palette')) return;
      e.preventDefault();
      e.stopPropagation();
      if (tg instanceof HTMLInputElement) tg.blur();
      else if (this.seriesOpen) {
        this.seriesOpen = false;
        this.sync();
      } else this.host.close();
    }, true);
    let resizeTimer = 0;
    window.addEventListener('resize', () => {
      if (!this.open) return;
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => this.renderPreview(), 120);
    });
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** 打开。board：直接进情绪板模式、选中这个情绪板 */
  show(opts: { board?: string } = {}): void {
    this.returnFocus = document.activeElement as HTMLElement | null;
    const boards = this.host.boards();
    if (opts.board && boards.some((b) => b.id === opts.board)) {
      this.mode = 'board';
      this.boardId = opts.board;
    } else {
      this.mode = 'works';
      if (!this.boardId || !boards.some((b) => b.id === this.boardId)) this.boardId = boards[0]?.id ?? null;
    }
    this.scope = this.host.filtered() ? 'filtered' : 'all';
    this.seriesId = this.host.currentSeries() ?? this.host.seriesList()[0]?.id ?? null;
    this.seriesOpen = false;
    this.titleEdited = false;
    this.title = this.defaultTitle();
    this.titleInput.value = this.title;
    this.authorInput.value = this.s.author;
    this.open = true;
    this.root.hidden = false;
    void this.root.offsetWidth;
    this.root.classList.add('is-open');
    this.sync();
    this.renderPreview();
    this.preview.scrollTop = 0;
    (this.panel.querySelector('[aria-checked="true"]') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    if (this.ctl) this.ctl.cancelled = true;
    this.root.classList.remove('is-open');
    this.root.hidden = true;
    this.gen++;
    this.stage.replaceChildren();
    const back = this.returnFocus;
    this.returnFocus = null;
    if (back && document.contains(back)) back.focus({ preventScroll: true });
  }

  /** 作品库变了（换预览集、筛选、补出缩略图、换了语言）：开着就重建预览 */
  refresh(): void {
    if (!this.open) return;
    if (this.scope === 'filtered' && !this.host.filtered()) this.scope = 'all';
    if (this.scope === 'series' && !this.currentSeries()) this.scope = 'all';
    this.retitle();
    this.sync();
    this.renderPreview();
  }

  // ───────────── 设置 ─────────────

  /** 当前模式下的共用设置（底色、留白、说明、标识、尺寸、格式） */
  private get st(): Shared {
    return this.mode === 'board' ? this.s.board : this.s;
  }

  private currentSeries(): ExportSeries | null {
    return this.host.seriesList().find((x) => x.id === this.seriesId) ?? null;
  }

  private board(): Board | null {
    return this.host.boards().find((b) => b.id === this.boardId) ?? null;
  }

  private works(): readonly Work[] {
    if (this.scope === 'filtered') return this.host.filtered() ?? this.host.all();
    if (this.scope === 'series') return this.currentSeries()?.works ?? this.host.all();
    return this.host.all();
  }

  private defaultTitle(): string {
    if (this.mode === 'board') return this.board()?.name ?? '';
    return this.scope === 'series' ? this.currentSeries()?.name ?? this.host.setName() : this.host.setName();
  }

  /** 换了内容：标题没被改过就跟着换 */
  private retitle(): void {
    if (this.titleEdited) return;
    this.title = this.defaultTitle();
    this.titleInput.value = this.title;
  }

  private persist(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.s));
    } catch {
      /* 存不了就算了，下次用默认值 */
    }
  }

  /** 改了设置：记下来、刷新控件和预览 */
  private set<K extends keyof Saved>(k: K, v: Saved[K]): void {
    this.s[k] = v;
    this.persist();
    this.sync();
    this.renderPreview();
  }

  /** 改当前模式下的共用设置 */
  private setShared<K extends keyof Shared>(k: K, v: Shared[K]): void {
    this.st[k] = v;
    this.persist();
    this.sync();
    this.renderPreview();
  }

  private previewTimer = 0;
  /** 打字时稍等一下再重建预览 */
  private schedule(): void {
    window.clearTimeout(this.previewTimer);
    this.previewTimer = window.setTimeout(() => this.renderPreview(), 160);
  }

  private sync(): void {
    for (const f of this.syncers) f();
  }

  /** 一组单选按钮（分段开关）。labels 是文案 key 或直接的文字 */
  private seg<T>(label: MessageKey, opts: readonly (readonly [T, string])[], get: () => T, set: (v: T) => void, extra = ''): HTMLElement {
    const btns = opts.map(([v, text]) => {
      // 文案 key（export.small 这种）还是直接显示的文字（16:9、JPG、2）
      const key = /^[a-z]+\.[\w.-]+$/.test(text) ? (text as MessageKey) : null;
      const b = el('button', { type: 'button', role: 'radio', class: 'export-seg-btn', ...(key ? { 'data-i18n': key } : {}) }, [key ? t(key) : text]);
      b.addEventListener('click', () => set(v));
      return [v, b] as const;
    });
    const group = el('div', { class: `export-seg ${extra}`, role: 'radiogroup', 'data-i18n-aria': label, 'aria-label': t(label) }, btns.map(([, b]) => b));
    group.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const i = btns.findIndex(([v]) => v === get());
      const j = (i + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length;
      set(btns[j][0]);
      btns[j][1].focus();
    });
    this.syncers.push(() => {
      for (const [v, b] of btns) {
        const on = v === get();
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on ? 0 : -1;
      }
    });
    return group;
  }

  private row(label: MessageKey, control: HTMLElement, visible?: () => boolean): HTMLElement {
    const r = el('div', { class: 'export-row' }, [el('span', { class: 'export-label', 'data-i18n': label }, [t(label)]), control]);
    if (visible) this.syncers.push(() => (r.hidden = !visible()));
    return r;
  }

  private toggle(label: () => string, get: () => boolean, set: (v: boolean) => void, visible?: () => boolean): HTMLElement {
    const text = el('span', { class: 'export-label' });
    const knob = el('span', { class: 'toggle', 'aria-hidden': 'true' }, [el('span', { class: 'toggle-knob' })]);
    const b = el('button', { type: 'button', role: 'switch', class: 'export-switch' }, [text, knob]);
    b.addEventListener('click', () => set(!get()));
    this.syncers.push(() => {
      text.textContent = label();
      b.setAttribute('aria-checked', String(get()));
      knob.classList.toggle('is-on', get());
      if (visible) b.hidden = !visible();
    });
    return b;
  }

  /** 只在某个模式下显示的一块 */
  private only(mode: ExportMode, node: HTMLElement): HTMLElement {
    this.syncers.push(() => (node.hidden = this.mode !== mode));
    return node;
  }

  private setMode(m: ExportMode): void {
    if (m === this.mode) return;
    this.mode = m;
    this.seriesOpen = false;
    this.titleEdited = false;
    this.retitle();
    this.sync();
    this.renderPreview();
    this.preview.scrollTop = 0;
  }

  private controls(): HTMLElement[] {
    const s = this.s;
    const works = () => this.mode === 'works';

    // ── 内容（作品）：全部 / 筛选结果 / 系列 ▾ ──
    const scopeRows = (['all', 'filtered', 'series'] as ExportScope[]).map((k) => {
      const name = el('span', { class: 'export-scope-name' });
      const count = el('span', { class: 'export-scope-count' });
      const chev = k === 'series' ? svgIcon(ICON_NEXT, 14) : null;
      if (chev) chev.classList.add('export-scope-chev');
      const b = el('button', { type: 'button', role: 'radio', class: 'export-scope' }, chev ? [name, count, chev] : [name, count]);
      if (k === 'series') b.setAttribute('aria-haspopup', 'true');
      b.addEventListener('click', () => {
        // 系列：第一次点选中当前系列，再点（或已经选中时点）展开系列列表
        if (k === 'series') this.seriesOpen = this.scope === 'series' ? !this.seriesOpen : false;
        else this.seriesOpen = false;
        this.scope = k;
        this.retitle();
        this.sync();
        this.renderPreview();
      });
      this.syncers.push(() => {
        const sr = this.currentSeries();
        const ws = k === 'all' ? this.host.all() : k === 'filtered' ? this.host.filtered() : sr?.works;
        b.hidden = !ws;
        name.textContent = k === 'all' ? t('export.scopeAll') : k === 'filtered' ? t('export.scopeFiltered') : t('export.scopeSeries', { name: sr?.name ?? '' });
        count.textContent = ws ? t('export.count', { n: ws.length }) : '';
        b.setAttribute('aria-checked', String(this.scope === k));
        if (k === 'series') {
          b.setAttribute('aria-expanded', String(this.seriesOpen));
          b.classList.toggle('is-open', this.seriesOpen);
        }
      });
      return b;
    });
    // 系列列表：展开时列出当前预览集里的全部系列
    this.syncers.push(() => {
      this.seriesListEl.hidden = !(works() && this.scope === 'series' && this.seriesOpen);
      if (this.seriesListEl.hidden) return;
      const list = this.host.seriesList();
      this.seriesListEl.replaceChildren(...list.map((sr) => {
        const b = el('button', { type: 'button', role: 'radio', class: 'export-pick', 'aria-checked': String(sr.id === this.seriesId) }, [
          el('span', { class: 'export-scope-name' }, [sr.name]),
          el('span', { class: 'export-scope-count' }, [t('export.count', { n: sr.works.length })]),
        ]);
        b.addEventListener('click', () => {
          this.seriesId = sr.id;
          this.seriesOpen = false;
          this.retitle();
          this.sync();
          this.renderPreview();
        });
        return b;
      }));
    });
    const scope = el('div', { class: 'export-scopes', role: 'radiogroup', 'data-i18n-aria': 'export.scope', 'aria-label': t('export.scope') }, [
      ...scopeRows, this.seriesListEl,
    ]);

    // ── 内容（情绪板）：情绪板列表 ──
    this.syncers.push(() => {
      if (this.mode !== 'board') return;
      const list = this.host.boards();
      if (!list.length) {
        this.boardListEl.replaceChildren(el('p', { class: 'export-empty' }, [t('export.noBoards')]));
        return;
      }
      this.boardListEl.replaceChildren(...list.map((b) => {
        const btn = el('button', { type: 'button', role: 'radio', class: 'export-scope', 'aria-checked': String(b.id === this.boardId) }, [
          el('span', { class: 'export-scope-name' }, [b.name]),
          el('span', { class: 'export-scope-count' }, [t('board.count', { n: b.items.length })]),
        ]);
        btn.addEventListener('click', () => {
          this.boardId = b.id;
          this.titleEdited = false;
          this.retitle();
          this.sync();
          this.renderPreview();
        });
        return btn;
      }));
    });

    // ── 版式：四张小卡片 ──
    const cards = LAYOUTS.map((k) => {
      const b = el('button', { type: 'button', role: 'radio', class: 'export-layout' }, [
        svgIcon(LAYOUT_ICONS[k], 22), el('span', { 'data-i18n': `export.layout.${k}` }, [t(`export.layout.${k}`)]),
      ]);
      b.addEventListener('click', () => this.set('layout', k));
      this.syncers.push(() => b.setAttribute('aria-checked', String(s.layout === k)));
      return b;
    });
    const layouts = el('div', { class: 'export-layouts', role: 'radiogroup', 'data-i18n-aria': 'export.layout', 'aria-label': t('export.layout') }, cards);

    // ── 底色：四个圆点 ──
    const dots = BGS.map((k) => {
      const sw = el('span', { class: 'export-bg-fill' });
      sw.style.background = EXPORT_THEMES[k].bg;
      const b = el('button', { type: 'button', role: 'radio', class: 'export-bg', 'data-i18n-aria': `export.bg.${k}`, 'aria-label': t(`export.bg.${k}`), 'data-i18n-title': `export.bg.${k}`, title: t(`export.bg.${k}`) }, [sw]);
      b.addEventListener('click', () => this.setShared('bg', k));
      this.syncers.push(() => b.setAttribute('aria-checked', String(this.st.bg === k)));
      return b;
    });
    const bgs = el('div', { class: 'export-bgs', role: 'radiogroup', 'data-i18n-aria': 'export.bg', 'aria-label': t('export.bg') }, dots);

    const spacing = [[0, 'export.small'], [1, 'export.medium'], [2, 'export.large']] as const;
    const isPdf = () => works() && s.layout === 'pdf';
    const summaryFields = el('div', { class: 'export-fields' }, [
      el('label', { class: 'export-field' }, [el('span', { 'data-i18n': 'export.summaryTitle' }, [t('export.summaryTitle')]), this.titleInput]),
      el('label', { class: 'export-field' }, [el('span', { 'data-i18n': 'export.author' }, [t('export.author')]), this.authorInput]),
    ]);
    this.syncers.push(() => (summaryFields.hidden = !this.st.summary));

    return [
      this.seg('export.mode', [['works', 'export.mode.works'], ['board', 'export.mode.board']] as const, () => this.mode, (m) => this.setMode(m), 'is-mode'),
      el('h2', { class: 'export-h', 'data-i18n': 'export.scope' }, [t('export.scope')]),
      this.only('works', scope),
      this.only('board', this.boardListEl),
      this.only('works', el('h2', { class: 'export-h', 'data-i18n': 'export.layout' }, [t('export.layout')])),
      this.only('works', layouts),
      this.row('export.columns', this.seg('export.columns', [[2, '2'], [3, '3'], [4, '4']], () => s.columns, (v) => this.set('columns', v)), () => works() && s.layout === 'grid'),
      this.row('export.ratio', this.seg('export.ratio', RATIOS.map((r) => [r, r] as const), () => s.ratio, (v) => this.set('ratio', v), 'is-wide'), () => works() && s.layout === 'collage'),
      this.row('export.page', this.seg('export.page', PAGES.map((p) => [p, `export.page.${p}`] as const), () => s.page, (v) => this.set('page', v)), isPdf),
      el('h2', { class: 'export-h', 'data-i18n': 'export.look' }, [t('export.look')]),
      this.row('export.bg', bgs),
      this.row('export.margin', this.seg('export.margin', spacing, () => this.st.margin, (v) => this.setShared('margin', v))),
      this.row('export.gap', this.seg('export.gap', spacing, () => s.gap, (v) => this.set('gap', v)), () => works() && !isPdf()),
      el('h2', { class: 'export-h', 'data-i18n': 'export.text' }, [t('export.text')]),
      this.toggle(() => t(isPdf() ? 'export.cover' : 'export.summary'), () => this.st.summary, (v) => this.setShared('summary', v)),
      summaryFields,
      this.toggle(() => t('export.captions'), () => s.captions, (v) => this.set('captions', v), works),
      this.toggle(() => t('export.brand'), () => this.st.brand, (v) => this.setShared('brand', v)),
      el('h2', { class: 'export-h', 'data-i18n': 'export.output' }, [t('export.output')]),
      this.row('export.size', this.seg('export.size', [[1, 'export.size.1'], [1.5, 'export.size.15'], [2, 'export.size.2']] as const, () => this.st.size, (v) => this.setShared('size', v))),
      this.row('export.format', this.seg('export.format', [['jpg', 'JPG'], ['png', 'PNG']] as const, () => this.st.format, (v) => this.setShared('format', v)), () => !isPdf()),
    ];
  }

  // ───────────── 排版 ─────────────

  private plan(works: readonly Work[], s: Saved = this.s): ExportPlan {
    const aspects = works.map((w) => (w.width && w.height ? w.width / w.height : 0.8));
    return planExport(aspects, s, s.layout === 'pdf' ? pickCover(works.map((w) => w.rating)) : []);
  }

  private boardPlan(b: Board, st: Shared = this.s.board): BoardPlan {
    const settings: BoardExportSettings = { margin: st.margin, summary: st.summary, brand: st.brand, size: st.size };
    return planBoardExport(contentBounds(b.items, b.marks), settings);
  }

  /** 当前设置（自检用） */
  get settings(): Saved {
    return { ...this.s, board: { ...this.s.board } };
  }

  /** 按设置 s 把 works 画成文件（PDF 或图片）的字节 */
  render(works: readonly Work[], s: Saved, ctl: RenderControl = {}): Promise<Uint8Array> {
    const plan = this.plan(works, s);
    const texts = this.texts(works);
    const theme = EXPORT_THEMES[s.bg];
    const images = this.host.images(works);
    return s.layout === 'pdf' ? renderPdf(plan, s.page, theme, texts, images, ctl) : renderImage(plan, theme, texts, images, s.format, ctl);
  }

  /** 把一个情绪板画成图片的字节 */
  renderBoardBytes(b: Board, st: Shared = this.s.board, ctl: RenderControl = {}): Promise<Uint8Array> {
    return renderBoard(b, this.boardPlan(b, st), st.bg, EXPORT_THEMES[st.bg], this.boardTexts(b), this.host.boardImages(b), st.format, ctl);
  }

  private texts(works: readonly Work[]): ExportTexts {
    const meta = [this.s.author.trim(), dateRange(works.map((w) => w.date)), t('export.count', { n: works.length })].filter(Boolean).join('  ·  ');
    return {
      title: this.title.trim(),
      meta,
      captions: works.map((w) => ({ title: displayTitle(w), date: w.date })),
    };
  }

  /** 情绪板的说明：标题和作者，不写幅数 */
  private boardTexts(b: Board): ExportTexts {
    return { title: this.title.trim() || b.name, meta: this.s.author.trim(), captions: [] };
  }

  // ───────────── 预览 ─────────────

  private renderPreview(): void {
    if (!this.open) return;
    const gen = ++this.gen;
    this.queue.length = 0;
    const pw = Math.max(200, this.preview.clientWidth - PAD * 2);
    const ph = Math.max(200, this.preview.clientHeight - PAD * 2 - 24);
    this.stage.classList.toggle('is-pages', this.mode === 'works' && this.s.layout === 'pdf');
    if (this.mode === 'board') {
      const b = this.board();
      if (!b || !b.items.length) {
        this.stage.replaceChildren();
        this.updateInfo(null, 0);
        return;
      }
      const plan = this.boardPlan(b);
      const scale = Math.min(pw / plan.page.w, ph / plan.page.h);
      this.stage.replaceChildren(this.boardSheet(b, plan, scale, gen));
      this.updateInfo(null, b.items.length, plan.page);
      return;
    }
    const works = this.works();
    const plan = this.plan(works);
    const texts = this.texts(works);
    const theme = EXPORT_THEMES[this.s.bg];
    const first = plan.pages[0];
    // 缩放：长图、网格按宽；拼图整页放进预览区；PDF 每页按宽（最宽 760）
    const scale = this.s.layout === 'collage'
      ? Math.min(pw / first.w, ph / first.h)
      : Math.min(this.s.layout === 'pdf' ? 760 : 680, pw) / first.w;
    const sheets = plan.pages.map((p) => {
      const sheet = this.sheetBase(p, theme, scale);
      this.worksInto(sheet, p, plan, texts, theme, works, gen);
      this.chromeInto(sheet, p, plan.type, plan.cover, texts, theme);
      return this.wrap(sheet, p, scale);
    });
    this.stage.replaceChildren(...sheets);
    this.updateInfo(plan, works.length);
  }

  private sheetBase(p: Page, theme: ExportTheme, scale: number): HTMLElement {
    const sheet = el('div', { class: 'export-sheet' });
    Object.assign(sheet.style, { width: `${p.w}px`, height: `${p.h}px`, transform: `scale(${scale})`, background: theme.bg, color: theme.ink });
    return sheet;
  }

  private wrap(sheet: HTMLElement, p: Page, scale: number): HTMLElement {
    const wrap = el('div', { class: 'export-sheet-wrap' }, [sheet]);
    Object.assign(wrap.style, { width: `${Math.round(p.w * scale)}px`, height: `${Math.round(p.h * scale)}px` });
    return wrap;
  }

  private worksInto(
    sheet: HTMLElement, p: Page, plan: ExportPlan, texts: ExportTexts, theme: ExportTheme, works: readonly Work[], gen: number,
  ): void {
    const ty = plan.type;
    for (const c of p.cells) {
      const w = works[c.i];
      const canvas = el('span', { class: 'art-canvas' });
      const cell = el('div', { class: 'export-cell' }, [canvas]);
      Object.assign(cell.style, { left: `${c.x}px`, top: `${c.y}px`, width: `${c.w}px`, height: `${c.h}px` });
      this.fillThumb(canvas, w, this.host.thumb(w), () => this.host.makeThumb(w), gen);
      sheet.append(cell);
      if (c.cap) {
        const cap = texts.captions[c.i];
        const line = el('div', { class: `export-cap${plan.capLines === 2 ? ' is-two' : ''}` }, [
          el('span', { class: 'export-cap-title' }, [cap.title]),
          el('span', { class: 'export-cap-date' }, [cap.date]),
        ]);
        Object.assign(line.style, {
          left: `${c.cap.x}px`, top: `${c.cap.y}px`, width: `${c.cap.w}px`, height: `${ty.capLine * plan.capLines}px`,
          fontSize: `${ty.caption}px`, lineHeight: `${ty.capLine}px`, columnGap: `${ty.caption * 0.7}px`,
        });
        (line.lastElementChild as HTMLElement).style.color = theme.sub;
        sheet.append(line);
      }
    }
  }

  /** 细线、说明、Peekit 标识 */
  private chromeInto(
    sheet: HTMLElement, p: Page, ty: ExportPlan['type'], cover: ExportPlan['cover'], texts: ExportTexts, theme: ExportTheme,
  ): void {
    if (p.rule) {
      const r = el('div', { class: 'export-rule' });
      Object.assign(r.style, { left: `${p.rule.x}px`, top: `${p.rule.y}px`, width: `${p.rule.w}px`, height: `${Math.max(1, ty.rule)}px`, background: theme.rule });
      sheet.append(r);
    }
    if (p.summary) {
      const st = p.summary.big && cover ? cover : ty;
      const title = el('div', { class: 'export-sum-title' }, [texts.title]);
      Object.assign(title.style, { left: `${p.summary.x}px`, top: `${p.summary.y}px`, width: `${p.summary.w}px`, fontSize: `${st.title}px`, lineHeight: `${st.titleLine}px` });
      const meta = el('div', { class: 'export-sum-meta' }, [texts.meta]);
      Object.assign(meta.style, {
        left: `${p.summary.x}px`, top: `${p.summary.y + st.titleLine + st.metaGap}px`, width: `${p.summary.w}px`,
        fontSize: `${st.meta}px`, lineHeight: `${st.metaLine}px`, color: theme.sub,
      });
      sheet.append(title, meta);
    }
    if (p.brand) {
      // Peekit 标识：手写字标（灰色）
      const b = p.brand;
      const brand = el('div', { class: 'export-brand', 'aria-hidden': 'true' }, [markSvg(PEEKIT, b.h)]);
      Object.assign(brand.style, { left: `${b.x - brandWidth(b.h)}px`, top: `${b.y}px`, height: `${b.h}px`, color: theme.sub });
      sheet.append(brand);
    }
  }

  /** 情绪板的预览：网点底 + 照片（用画布上同一套样式）+ 标注 */
  private boardSheet(b: Board, plan: BoardPlan, scale: number, gen: number): HTMLElement {
    const st = this.s.board;
    const theme = EXPORT_THEMES[st.bg];
    const p = plan.page;
    const sheet = this.sheetBase(p, theme, scale);
    const [fine, major] = dotCss(st.bg);
    const u = plan.type.caption / 20;
    sheet.style.backgroundImage = [
      `radial-gradient(circle, ${major} 0 ${1.4 * u}px, transparent ${1.4 * u + 0.6}px)`,
      `radial-gradient(circle, ${fine} 0 ${1.1 * u}px, transparent ${1.1 * u + 0.6}px)`,
    ].join(', ');
    sheet.style.backgroundSize = `${plan.dotMajor}px ${plan.dotMajor}px, ${plan.dot}px ${plan.dot}px`;
    sheet.style.backgroundPosition = `${plan.ox - plan.dotMajor / 2}px ${plan.oy - plan.dotMajor / 2}px, ${plan.ox - plan.dot / 2}px ${plan.oy - plan.dot / 2}px`;
    // 画布坐标的一层：照片、标注按画布上的位置摆，整体缩放；描边粗细在导出图上是 1.5u（--bz = k / u）
    const world = el('div', { class: 'export-board-world' });
    Object.assign(world.style, { transform: `translate(${plan.ox}px, ${plan.oy}px) scale(${plan.k})` });
    world.style.setProperty('--bz', String(plan.k / u));
    for (const it of b.items) {
      const canvas = el('span', { class: 'art-canvas' });
      const node = el('div', { class: 'board-item export-board-item' }, [canvas]);
      Object.assign(node.style, { left: `${it.x}px`, top: `${it.y}px`, width: `${it.w}px`, height: `${it.h}px` });
      node.style.setProperty('--gc', groupColor(b, it.group));
      const pseudo: Work = { id: it.id, title: it.title, date: '', series: '', bg: it.color ?? '#808080', shapes: it.shapes };
      this.fillThumb(canvas, pseudo, it.path ? this.host.boardThumb(it) : null, () => this.host.makeBoardThumb(it), gen);
      world.append(node);
    }
    if (b.marks?.length) paintMarksStatic(world, b.marks);
    sheet.append(world);
    this.chromeInto(sheet, p, plan.type, undefined, this.boardTexts(b), theme);
    return this.wrap(sheet, p, scale);
  }

  /** 预览里填一幅：有缩略图直接放；还没有的先显示主色，排队生成，好了再换上（预览重建过就不填旧节点） */
  private fillThumb(canvas: HTMLElement, w: Work, src: string | null | undefined, make: () => Promise<string | null>, gen: number): void {
    const put = (url: string | undefined) => {
      fillArt(canvas, w, undefined);
      if (!url) return;
      const img = el('img', { alt: '', draggable: 'false', decoding: 'async', loading: 'lazy' });
      img.src = url;
      canvas.append(img);
    };
    if (src !== undefined) {
      put(src ?? undefined);
      return;
    }
    put(undefined);
    this.queue.push(async () => {
      if (gen !== this.gen) return;
      const url = await make().catch(() => null);
      if (gen === this.gen && url) put(url);
    });
    this.pump();
  }

  private queue: (() => Promise<void>)[] = [];
  private running = 0;

  private pump(): void {
    while (this.running < 3 && this.queue.length) {
      const job = this.queue.shift()!;
      this.running++;
      void job().finally(() => {
        this.running--;
        this.pump();
      });
    }
  }

  private updateInfo(plan: ExportPlan | null, n: number, boardPage?: Page): void {
    const st = this.st;
    if (boardPage) {
      this.info.textContent = `${st.format.toUpperCase()}  ·  ${fmtNum(boardPage.w)} × ${fmtNum(boardPage.h)} px`;
    } else if (plan && this.s.layout === 'pdf') {
      const p = plan.pages[0];
      this.info.textContent = `PDF  ·  ${t('export.pages', { n: plan.pages.length })}  ·  ${fmtNum(p.w)} × ${fmtNum(p.h)} px`;
    } else if (plan) {
      const p = plan.pages[0];
      this.info.textContent = `${st.format.toUpperCase()}  ·  ${fmtNum(Math.round(p.w))} × ${fmtNum(Math.round(p.h))} px`;
    } else this.info.textContent = '';
    let hint = '';
    // 没有情绪板时列表里已经写了，这里不重复
    if (this.mode === 'board') {
      if (this.host.boards().length && !n) hint = t('export.boardEmpty');
    } else if (!n) hint = t('export.empty');
    else if (plan?.shrunk) hint = t('export.shrunk', { w: fmtNum(Math.round(plan.pages[0].w)), full: fmtNum(pageSize(this.s).w) });
    this.hint.textContent = hint;
    this.hint.hidden = !hint;
    if (!this.ctl) this.saveBtn.disabled = !n;
  }

  // ───────────── 导出 ─────────────

  private async doExport(): Promise<void> {
    if (this.ctl) return;
    const board = this.mode === 'board' ? this.board() : null;
    const works = this.mode === 'works' ? this.works() : [];
    if (board ? !board.items.length : !works.length) return;
    const s = this.settings;
    const total = board ? board.items.length : this.plan(works, s).pages.reduce((x, p) => x + p.cells.length, 0);
    let done = 0;
    const label = () => (this.saveLabel.textContent = t('export.progress', { done, total }));
    const ctl: RenderControl = {
      step: () => {
        done++;
        label();
      },
    };
    this.ctl = ctl;
    this.root.classList.add('is-busy');
    this.saveBtn.disabled = true;
    label();
    try {
      const bytes = board ? await this.renderBoardBytes(board, s.board, ctl) : await this.render(works, s, ctl);
      if (ctl.cancelled) throw new Error('cancelled');
      this.saveLabel.textContent = t('export.saving');
      const ext = board ? s.board.format : s.layout === 'pdf' ? 'pdf' : s.format;
      const name = board ? this.boardTexts(board).title : this.texts(works).title || this.host.setName();
      const to = await this.host.save(bytes, `${safeName(name)}.${ext}`);
      if (to) this.host.toast(t('toast.saved', { name: to.split(/[\\/]/).pop() ?? to }));
    } catch (err) {
      if (ctl.cancelled || String(err).includes('cancelled')) this.host.toast(t('export.cancelled'));
      else this.host.toast(t('toast.actionFailed', { msg: String(err) }));
    } finally {
      this.ctl = null;
      this.root.classList.remove('is-busy');
      this.saveLabel.textContent = t('export.save');
      this.renderPreview();
    }
  }
}
