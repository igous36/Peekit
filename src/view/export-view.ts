// 导出（2026-11-21）：整页盖在舞台上（和创作年历同一层），左边实时预览，右边设置。
//
//   ‹ 预览 │ 导出
//   ┌──────────── 预览（和导出用同一份坐标摆 DOM，缩小显示）────────────┐ ┌ 设置 ──────────────┐
//   │                                                                │ │ 内容：全部 / 筛选 / 系列 │
//   │                                                                │ │ 版式：长图 网格 拼图 PDF │
//   │                                                                │ │ 列数 / 比例 / 页面       │
//   │                                                                │ │ 底色、留白、间距          │
//   │                                                                │ │ 底部说明（标题、作者）    │
//   │                                                                │ │ 每幅的标题和日期          │
//   │                                                                │ │ 尺寸、格式               │
//   │                                                                │ │ 1600 × 18 240 px  [导出] │
//   └────────────────────────────────────────────────────────────────┘ └────────────────────┘
//
// 设置（除了说明的标题）记在 localStorage（peekit:export），下次打开还是上次的样子。
// 预览只在打开、改设置、窗口变大小时重建；真正导出时才按导出尺寸读图、画到画布上（export-render.ts）。
import type { Work } from '../data/types';
import { t, type MessageKey } from '../i18n';
import { displayTitle } from '../data/series-ops';
import { el, svgIcon, ICON_PREV } from './dom';
import { fillArt } from './art';
import { markSvg, PEEKIT } from './wordmark';
import {
  brandWidth, dateRange, pageSize, pickCover, planExport,
  type CollageRatio, type ExportLayout, type ExportPlan, type ExportSettings, type ExportSize, type PdfPageSize, type Spacing,
} from '../engine/export-layout';
import {
  EXPORT_THEMES, renderImage, renderPdf, type ExportBg, type ExportImages, type ExportTexts, type RenderControl,
} from './export-render';

export type ExportScope = 'all' | 'filtered' | 'series';

export interface ExportHost {
  /** 当前预览集的全部作品 */
  all(): readonly Work[];
  /** 按星 / 颜色筛选后的作品；没在筛选时 null */
  filtered(): readonly Work[] | null;
  /** 当前这幅所在的系列 */
  series(): { name: string; works: readonly Work[] } | null;
  setName(): string;
  /** 预览用的缩略图地址：有就直接给，没有给一个生成它的 promise；示例数据 null */
  thumb(w: Work): string | null | undefined;
  /** 还没有缩略图的作品生成一张（预览排队调用，最多同时 3 个） */
  makeThumb(w: Work): Promise<string | null>;
  /** 导出时读图 */
  images(works: readonly Work[]): ExportImages;
  save(bytes: Uint8Array, fileName: string): Promise<string | null>;
  toast(msg: string, sticky?: boolean): void;
  close(): void;
}

export interface Saved extends ExportSettings {
  bg: ExportBg;
  format: 'jpg' | 'png';
  author: string;
}

const KEY = 'peekit:export';
const DEFAULTS: Saved = {
  layout: 'long', columns: 3, ratio: '16:9', page: 'a4-landscape', margin: 1, gap: 1, captions: false, summary: true, brand: true, size: 1,
  bg: 'white', format: 'jpg', author: '',
};
const LAYOUTS: ExportLayout[] = ['long', 'grid', 'collage', 'pdf'];
const RATIOS: CollageRatio[] = ['16:9', '4:3', '1:1', '3:4', '9:16'];
const PAGES: PdfPageSize[] = ['a4-landscape', 'a4-portrait', 'wide'];
const BGS: ExportBg[] = ['white', 'paper', 'gray', 'ink'];
const SIZES: ExportSize[] = [1, 1.5, 2];
/** 拼图里作品多于这个数，提示会很小 */
const CROWDED = 30;
/** 预览区四周留的空（px） */
const PAD = 40;

/** 版式的小图标：一列、瀑布流、一页拼图、几页纸 */
const LAYOUT_ICONS: Record<ExportLayout, string[]> = {
  long: ['M7 3h10v7H7z', 'M7 12h10v9H7z'],
  grid: ['M4 4h7v9H4z', 'M13 4h7v5h-7z', 'M13 11h7v9h-7z', 'M4 15h7v5H4z'],
  collage: ['M3 5h18v14H3z', 'M6 8h5v8H6z', 'M13 8h5v3h-5z', 'M13 13h5v3h-5z'],
  pdf: ['M8 3h7l4 4v14H8z', 'M15 3v4h4', 'M5 6v15h11'],
};

function load(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Saved> | null;
    if (!raw || typeof raw !== 'object') return { ...DEFAULTS };
    const pick = <T>(v: unknown, ok: readonly T[], d: T): T => (ok.includes(v as T) ? (v as T) : d);
    return {
      layout: pick(raw.layout, LAYOUTS, DEFAULTS.layout),
      columns: pick(raw.columns, [2, 3, 4], DEFAULTS.columns),
      ratio: pick(raw.ratio, RATIOS, DEFAULTS.ratio),
      page: pick(raw.page, PAGES, DEFAULTS.page),
      margin: pick(raw.margin, [0, 1, 2] as Spacing[], DEFAULTS.margin),
      gap: pick(raw.gap, [0, 1, 2] as Spacing[], DEFAULTS.gap),
      captions: typeof raw.captions === 'boolean' ? raw.captions : DEFAULTS.captions,
      summary: typeof raw.summary === 'boolean' ? raw.summary : DEFAULTS.summary,
      brand: typeof raw.brand === 'boolean' ? raw.brand : DEFAULTS.brand,
      size: pick(raw.size, SIZES, DEFAULTS.size),
      bg: pick(raw.bg, BGS, DEFAULTS.bg),
      format: pick(raw.format, ['jpg', 'png'] as const, DEFAULTS.format),
      author: typeof raw.author === 'string' ? raw.author.slice(0, 80) : '',
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/** 文件名里不能有的字符换成短横 */
const safeName = (s: string): string => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').trim().slice(0, 120) || 'Peekit';

const fmtNum = (n: number): string => n.toLocaleString();

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
  private syncers: (() => void)[] = [];
  private s: Saved = load();
  private scope: ExportScope = 'all';
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

    // 捕获阶段：开着时 Esc 回到预览（在输入框里按 Esc 先离开输入框）
    document.addEventListener('keydown', (e) => {
      if (!this.open || e.defaultPrevented || e.key !== 'Escape') return;
      const tg = e.target as HTMLElement | null;
      if (tg?.closest?.('.menu-panel, .ctx-menu, .about-dialog, .palette')) return;
      e.preventDefault();
      e.stopPropagation();
      if (tg instanceof HTMLInputElement) tg.blur();
      else this.host.close();
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

  show(): void {
    this.returnFocus = document.activeElement as HTMLElement | null;
    this.scope = this.host.filtered() ? 'filtered' : 'all';
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

  /** 作品库变了（换预览集、筛选、补出缩略图）：开着就重建预览 */
  refresh(): void {
    if (!this.open) return;
    if (this.scope === 'filtered' && !this.host.filtered()) this.scope = 'all';
    if (this.scope === 'series' && !this.host.series()) this.scope = 'all';
    if (!this.titleEdited) {
      this.title = this.defaultTitle();
      this.titleInput.value = this.title;
    }
    this.sync();
    this.renderPreview();
  }

  // ───────────── 设置 ─────────────

  private works(): readonly Work[] {
    if (this.scope === 'filtered') return this.host.filtered() ?? this.host.all();
    if (this.scope === 'series') return this.host.series()?.works ?? this.host.all();
    return this.host.all();
  }

  private defaultTitle(): string {
    return this.scope === 'series' ? this.host.series()?.name ?? this.host.setName() : this.host.setName();
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

  private toggle(label: () => string, get: () => boolean, set: (v: boolean) => void): HTMLElement {
    const text = el('span', { class: 'export-label' });
    const knob = el('span', { class: 'toggle', 'aria-hidden': 'true' }, [el('span', { class: 'toggle-knob' })]);
    const b = el('button', { type: 'button', role: 'switch', class: 'export-switch' }, [text, knob]);
    b.addEventListener('click', () => set(!get()));
    this.syncers.push(() => {
      text.textContent = label();
      b.setAttribute('aria-checked', String(get()));
      knob.classList.toggle('is-on', get());
    });
    return b;
  }

  private controls(): HTMLElement[] {
    const s = this.s;
    // 内容
    const scopeRows = (['all', 'filtered', 'series'] as ExportScope[]).map((k) => {
      const name = el('span', { class: 'export-scope-name' });
      const count = el('span', { class: 'export-scope-count' });
      const b = el('button', { type: 'button', role: 'radio', class: 'export-scope' }, [name, count]);
      b.addEventListener('click', () => {
        this.scope = k;
        if (!this.titleEdited) {
          this.title = this.defaultTitle();
          this.titleInput.value = this.title;
        }
        this.sync();
        this.renderPreview();
      });
      this.syncers.push(() => {
        const f = this.host.filtered(), sr = this.host.series();
        const works = k === 'all' ? this.host.all() : k === 'filtered' ? f : sr?.works;
        b.hidden = !works;
        name.textContent = k === 'all' ? t('export.scopeAll') : k === 'filtered' ? t('export.scopeFiltered') : t('export.scopeSeries', { name: sr?.name ?? '' });
        count.textContent = works ? t('export.count', { n: works.length }) : '';
        b.setAttribute('aria-checked', String(this.scope === k));
      });
      return b;
    });
    const scope = el('div', { class: 'export-scopes', role: 'radiogroup', 'data-i18n-aria': 'export.scope', 'aria-label': t('export.scope') }, scopeRows);

    // 版式：四张小卡片
    const cards = LAYOUTS.map((k) => {
      const b = el('button', { type: 'button', role: 'radio', class: 'export-layout' }, [
        svgIcon(LAYOUT_ICONS[k], 22), el('span', { 'data-i18n': `export.layout.${k}` }, [t(`export.layout.${k}`)]),
      ]);
      b.addEventListener('click', () => this.set('layout', k));
      this.syncers.push(() => b.setAttribute('aria-checked', String(s.layout === k)));
      return b;
    });
    const layouts = el('div', { class: 'export-layouts', role: 'radiogroup', 'data-i18n-aria': 'export.layout', 'aria-label': t('export.layout') }, cards);

    // 底色：四个圆点
    const dots = BGS.map((k) => {
      const sw = el('span', { class: 'export-bg-fill' });
      sw.style.background = EXPORT_THEMES[k].bg;
      const b = el('button', { type: 'button', role: 'radio', class: 'export-bg', 'data-i18n-aria': `export.bg.${k}`, 'aria-label': t(`export.bg.${k}`), 'data-i18n-title': `export.bg.${k}`, title: t(`export.bg.${k}`) }, [sw]);
      b.addEventListener('click', () => this.set('bg', k));
      this.syncers.push(() => b.setAttribute('aria-checked', String(s.bg === k)));
      return b;
    });
    const bgs = el('div', { class: 'export-bgs', role: 'radiogroup', 'data-i18n-aria': 'export.bg', 'aria-label': t('export.bg') }, dots);

    const spacing = [[0, 'export.small'], [1, 'export.medium'], [2, 'export.large']] as const;
    const isPdf = () => s.layout === 'pdf';
    const summaryFields = el('div', { class: 'export-fields' }, [
      el('label', { class: 'export-field' }, [el('span', { 'data-i18n': 'export.summaryTitle' }, [t('export.summaryTitle')]), this.titleInput]),
      el('label', { class: 'export-field' }, [el('span', { 'data-i18n': 'export.author' }, [t('export.author')]), this.authorInput]),
    ]);
    this.syncers.push(() => (summaryFields.hidden = !s.summary));

    return [
      el('h2', { class: 'export-h', 'data-i18n': 'export.scope' }, [t('export.scope')]),
      scope,
      el('h2', { class: 'export-h', 'data-i18n': 'export.layout' }, [t('export.layout')]),
      layouts,
      this.row('export.columns', this.seg('export.columns', [[2, '2'], [3, '3'], [4, '4']], () => s.columns, (v) => this.set('columns', v)), () => s.layout === 'grid'),
      this.row('export.ratio', this.seg('export.ratio', RATIOS.map((r) => [r, r] as const), () => s.ratio, (v) => this.set('ratio', v), 'is-wide'), () => s.layout === 'collage'),
      this.row('export.page', this.seg('export.page', PAGES.map((p) => [p, `export.page.${p}`] as const), () => s.page, (v) => this.set('page', v)), isPdf),
      el('h2', { class: 'export-h', 'data-i18n': 'export.look' }, [t('export.look')]),
      this.row('export.bg', bgs),
      this.row('export.margin', this.seg('export.margin', spacing, () => s.margin, (v) => this.set('margin', v))),
      this.row('export.gap', this.seg('export.gap', spacing, () => s.gap, (v) => this.set('gap', v)), () => !isPdf()),
      el('h2', { class: 'export-h', 'data-i18n': 'export.text' }, [t('export.text')]),
      this.toggle(() => t(isPdf() ? 'export.cover' : 'export.summary'), () => s.summary, (v) => this.set('summary', v)),
      summaryFields,
      this.toggle(() => t('export.captions'), () => s.captions, (v) => this.set('captions', v)),
      this.toggle(() => t('export.brand'), () => s.brand, (v) => this.set('brand', v)),
      el('h2', { class: 'export-h', 'data-i18n': 'export.output' }, [t('export.output')]),
      this.row('export.size', this.seg('export.size', [[1, 'export.size.1'], [1.5, 'export.size.15'], [2, 'export.size.2']] as const, () => s.size, (v) => this.set('size', v))),
      this.row('export.format', this.seg('export.format', [['jpg', 'JPG'], ['png', 'PNG']] as const, () => s.format, (v) => this.set('format', v)), () => !isPdf()),
    ];
  }

  // ───────────── 预览 ─────────────

  private plan(works: readonly Work[], s: Saved = this.s): ExportPlan {
    const aspects = works.map((w) => (w.width && w.height ? w.width / w.height : 0.8));
    return planExport(aspects, s, s.layout === 'pdf' ? pickCover(works.map((w) => w.rating)) : []);
  }

  /** 当前设置（自检用） */
  get settings(): Saved {
    return { ...this.s };
  }

  /** 按设置 s 把 works 画成文件（PDF 或图片）的字节 */
  render(works: readonly Work[], s: Saved, ctl: RenderControl = {}): Promise<Uint8Array> {
    const plan = this.plan(works, s);
    const texts = this.texts(works);
    const theme = EXPORT_THEMES[s.bg];
    const images = this.host.images(works);
    return s.layout === 'pdf' ? renderPdf(plan, s.page, theme, texts, images, ctl) : renderImage(plan, theme, texts, images, s.format, ctl);
  }

  private texts(works: readonly Work[]): ExportTexts {
    const meta = [this.s.author.trim(), dateRange(works.map((w) => w.date)), t('export.count', { n: works.length })].filter(Boolean).join('  ·  ');
    return {
      title: this.title.trim(),
      meta,
      captions: works.map((w) => ({ title: displayTitle(w), date: w.date })),
    };
  }

  private renderPreview(): void {
    if (!this.open) return;
    const gen = ++this.gen;
    this.queue.length = 0;
    const works = this.works();
    const plan = this.plan(works);
    const texts = this.texts(works);
    const theme = EXPORT_THEMES[this.s.bg];
    const pw = Math.max(200, this.preview.clientWidth - PAD * 2);
    const ph = Math.max(200, this.preview.clientHeight - PAD * 2 - 24);
    const first = plan.pages[0];
    // 缩放：长图、网格按宽；拼图整页放进预览区；PDF 每页按宽（最宽 760）
    const scale = this.s.layout === 'collage'
      ? Math.min(pw / first.w, ph / first.h)
      : Math.min(this.s.layout === 'pdf' ? 760 : 680, pw) / first.w;
    const sheets = plan.pages.map((p) => this.sheet(p, plan, texts, theme.bg, theme.ink, theme.sub, theme.rule, works, scale, gen));
    this.stage.replaceChildren(...sheets);
    this.stage.classList.toggle('is-pages', this.s.layout === 'pdf');
    this.updateInfo(plan, works.length);
  }

  private sheet(
    p: ExportPlan['pages'][number], plan: ExportPlan, texts: ExportTexts,
    bg: string, ink: string, sub: string, rule: string, works: readonly Work[], scale: number, gen: number,
  ): HTMLElement {
    const sheet = el('div', { class: 'export-sheet' });
    Object.assign(sheet.style, { width: `${p.w}px`, height: `${p.h}px`, transform: `scale(${scale})`, background: bg, color: ink });
    const ty = plan.type;
    for (const c of p.cells) {
      const w = works[c.i];
      const canvas = el('span', { class: 'art-canvas' });
      const cell = el('div', { class: 'export-cell' }, [canvas]);
      Object.assign(cell.style, { left: `${c.x}px`, top: `${c.y}px`, width: `${c.w}px`, height: `${c.h}px` });
      this.fillCell(canvas, w, gen);
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
        (line.lastElementChild as HTMLElement).style.color = sub;
        sheet.append(line);
      }
    }
    if (p.rule) {
      const r = el('div', { class: 'export-rule' });
      Object.assign(r.style, { left: `${p.rule.x}px`, top: `${p.rule.y}px`, width: `${p.rule.w}px`, height: `${Math.max(1, ty.rule)}px`, background: rule });
      sheet.append(r);
    }
    if (p.summary) {
      const st = p.summary.big && plan.cover ? plan.cover : ty;
      const title = el('div', { class: 'export-sum-title' }, [texts.title]);
      Object.assign(title.style, { left: `${p.summary.x}px`, top: `${p.summary.y}px`, width: `${p.summary.w}px`, fontSize: `${st.title}px`, lineHeight: `${st.titleLine}px` });
      const meta = el('div', { class: 'export-sum-meta' }, [texts.meta]);
      Object.assign(meta.style, {
        left: `${p.summary.x}px`, top: `${p.summary.y + st.titleLine + st.metaGap}px`, width: `${p.summary.w}px`,
        fontSize: `${st.meta}px`, lineHeight: `${st.metaLine}px`, color: sub,
      });
      sheet.append(title, meta);
    }
    if (p.brand) {
      // Peekit 标识：手写字标（灰色）
      const b = p.brand;
      const brand = el('div', { class: 'export-brand', 'aria-hidden': 'true' }, [markSvg(PEEKIT, b.h)]);
      Object.assign(brand.style, { left: `${b.x - brandWidth(b.h)}px`, top: `${b.y}px`, height: `${b.h}px`, color: sub });
      sheet.append(brand);
    }
    const wrap = el('div', { class: 'export-sheet-wrap' }, [sheet]);
    Object.assign(wrap.style, { width: `${Math.round(p.w * scale)}px`, height: `${Math.round(p.h * scale)}px` });
    return wrap;
  }

  private fillCell(canvas: HTMLElement, w: Work, gen: number): void {
    const src = this.host.thumb(w);
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
    // 还没有缩略图：先显示主色，排队生成，好了再换上（预览重建过就不填旧节点）
    put(undefined);
    this.queue.push(async () => {
      if (gen !== this.gen) return;
      const url = await this.host.makeThumb(w).catch(() => null);
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

  private updateInfo(plan: ExportPlan, n: number): void {
    const p = plan.pages[0];
    if (this.s.layout === 'pdf') {
      this.info.textContent = `PDF  ·  ${t('export.pages', { n: plan.pages.length })}  ·  ${fmtNum(p.w)} × ${fmtNum(p.h)} px`;
    } else {
      this.info.textContent = `${this.s.format.toUpperCase()}  ·  ${fmtNum(Math.round(p.w))} × ${fmtNum(Math.round(p.h))} px`;
    }
    let hint = '';
    if (!n) hint = t('export.empty');
    else if (plan.shrunk) hint = t('export.shrunk', { w: fmtNum(Math.round(p.w)), full: fmtNum(pageSize(this.s).w) });
    else if (this.s.layout === 'collage' && n > CROWDED) hint = t('export.crowded');
    this.hint.textContent = hint;
    this.hint.hidden = !hint;
    if (!this.ctl) this.saveBtn.disabled = !n;
  }

  // ───────────── 导出 ─────────────

  private async doExport(): Promise<void> {
    if (this.ctl) return;
    const works = this.works();
    if (!works.length) return;
    const s = { ...this.s };
    const plan = this.plan(works, s);
    const total = plan.pages.reduce((x, p) => x + p.cells.length, 0);
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
    const texts = this.texts(works);
    try {
      const bytes = await this.render(works, s, ctl);
      if (ctl.cancelled) throw new Error('cancelled');
      this.saveLabel.textContent = t('export.saving');
      const ext = s.layout === 'pdf' ? 'pdf' : s.format;
      const to = await this.host.save(bytes, `${safeName(texts.title || this.host.setName())}.${ext}`);
      if (to) this.host.toast(t('toast.saved', { name: to.split(/[\\/]/).pop() ?? to }));
    } catch (err) {
      if (ctl.cancelled || String(err).includes('cancelled')) this.host.toast(t('export.cancelled'));
      else this.host.toast(t('toast.actionFailed', { msg: String(err) }));
    } finally {
      this.ctl = null;
      this.root.classList.remove('is-busy');
      this.saveLabel.textContent = t('export.save');
      this.saveBtn.disabled = !this.works().length;
    }
  }
}
