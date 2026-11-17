// 右上角信息卡：展示态（系列芯片 + 铅笔、标题、日期、源文件名、同系列数量）和编辑态（作品标题 + SeriesEditor）。
// 两套节点都只建一次，用 hidden 切换；芯片按系列 id 复用节点。
//
// 2026-11-17 修改：
// - 编辑态里不再有“移出这幅 / 删除系列”按钮，改成右键作品 / 系列（见 context-menu.ts）
// - “「xxx」归入系列”改成“所属系列”；系列多于 3 个时默认收起：显示前 3 个，第 4 个磨砂渐隐，
//   下面的 ⌄ 展开全部（再点 ⌃ 收起）
// - 点卡片外面、按 Esc：放弃这次的修改并关闭（恢复到打开编辑卡之前）；“完成”、回车：保存
// - 右键系列芯片：弹出删除系列的菜单
import type { Series, Work } from '../data/types';
import { SERIES_NAME_MAX, TITLE_MAX, displayName, displayTitle } from '../data/series-ops';
import { t } from '../i18n';
import { r3 } from '../engine/math';
import { infoSlide } from '../engine/mapping';
import { el, svgIcon, ICON_CHEVRON_DOWN, ICON_PENCIL, Styled } from './dom';
import { menuPoint } from './context-menu';

/** 系列多于这么多个时收起 */
export const SERIES_COLLAPSED_MAX = 3;
/** 展开 / 收起的高度过渡（ms），和 CSS 一致 */
const EXPAND_MS = 260;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

export interface ChipData {
  id: string;
  name: string;
  color: string;
  selected: boolean;
}

export interface EditFrame {
  /** 正在编辑的作品（目标位置 posT 那一幅） */
  work: Work;
  series: Series;
  chips: ChipData[];
}

export interface InfoFrame {
  work: Work;
  series: Series;
  /** 同系列总数（含当前） */
  count: number;
  frac: number;
  /** 镜头拉远程度 0–1（系列视图）：“向下拖动查看全部”跟着淡出，回到单幅时再出现 */
  zoom: number;
  /** 不为 null 时显示编辑态 */
  edit: EditFrame | null;
}

export interface InfoHandlers {
  startEdit?: () => void;
  retitle?: (title: string) => void;
  rename?: (name: string) => void;
  pick?: (seriesId: string) => void;
  newSeries?: () => void;
  /** 保存并关闭（“完成”、回车） */
  finish?: () => void;
  /** 放弃这次的修改并关闭（点卡片外面、Esc） */
  cancel?: () => void;
  /** 右键系列（编辑态的芯片、展示态的系列标签）；x / y 是菜单位置 */
  seriesMenu?: (seriesId: string, x: number, y: number) => void;
}

interface Chip {
  btn: Styled<HTMLButtonElement>;
  dot: Styled;
  name: Styled;
}

/**
 * 文本框的实时输入：中文输入法组字时不回调（否则会闪拼音），组字结束再回调；
 * 组字时的回车是选字，不是完成。回车 = 保存，Esc = 放弃。
 */
function bindLiveInput(
  input: HTMLInputElement,
  onChange: (v: string) => void,
  onFinish: () => void,
  onCancel: () => void,
): void {
  input.addEventListener('input', (e) => {
    if ((e as InputEvent).isComposing) return;
    onChange(input.value);
  });
  input.addEventListener('compositionend', () => onChange(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      onFinish();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  });
}

export class InfoPanel {
  readonly root: HTMLElement;
  /** 展示态的铅笔按钮：编辑完成后焦点回到这里 */
  readonly editButton: HTMLButtonElement;

  private viewBlock: HTMLElement;
  private slide: Styled;
  private dot: Styled;
  private chipName: Styled;
  private title: Styled<HTMLHeadingElement>;
  private date: Styled;
  private source: Styled;
  private count: Styled;
  private dragHint: Styled;
  private viewSeriesId: string | null = null;

  private editBlock: HTMLElement;
  private titleInput: HTMLInputElement;
  private seriesInput: HTMLInputElement;
  private chipWrap: HTMLElement;
  private chipRow: HTMLElement;
  private newBtn: HTMLButtonElement;
  private toggleBtn: HTMLButtonElement;
  private chips = new Map<string, Chip>();
  private chipOrder: string[] = [];
  private editing = false;
  private editSeriesId: string | null = null;
  private editWorkId: string | null = null;
  /** 系列多于 3 个时是否展开 */
  private expanded = false;
  private collapseKey = '';
  private expandTimer = 0;

  constructor(public handlers: InfoHandlers = {}) {
    // ── 展示态 ──
    const dot = el('span', { class: 'dot' });
    const chipName = el('span', { class: 'chip-name' });
    this.editButton = el('button', { type: 'button', class: 'icon-btn info-edit', 'data-i18n-aria': 'info.edit' }, [
      svgIcon(ICON_PENCIL, 16),
    ]);
    this.editButton.addEventListener('click', () => this.handlers.startEdit?.());
    const title = el('h1', { class: 'info-title' });
    const date = el('p', { class: 'info-date' });
    const source = el('p', { class: 'info-source' });
    const seriesTag = el('span', { class: 'chip' }, [dot, chipName]);
    // 右键展示态的系列标签：删除系列
    seriesTag.addEventListener('contextmenu', (e) => {
      if (!this.viewSeriesId) return;
      e.preventDefault();
      const p = menuPoint(e, seriesTag);
      this.handlers.seriesMenu?.(this.viewSeriesId, p.x, p.y);
    });
    const slide = el('div', { class: 'info-slide' }, [
      el('div', { class: 'info-head' }, [seriesTag, this.editButton]),
      title,
      date,
      source,
    ]);
    const count = el('span');
    const dragHint = el('span', { 'data-i18n': 'info.dragDown' });
    this.dragHint = new Styled(dragHint);
    this.viewBlock = el('div', { class: 'info-view' }, [
      slide,
      el('div', { class: 'divider' }),
      el('div', { class: 'info-foot' }, [count, dragHint]),
    ]);
    this.slide = new Styled(slide);
    this.dot = new Styled(dot);
    this.chipName = new Styled(chipName);
    this.title = new Styled(title);
    this.date = new Styled(date);
    this.source = new Styled(source);
    this.count = new Styled(count);

    // ── 编辑态 ──
    const textInput = (id: string, max: number) =>
      el('input', { id, class: 'series-input', type: 'text', maxlength: max, autocomplete: 'off', spellcheck: 'false' });
    this.titleInput = textInput('work-title', TITLE_MAX);
    this.seriesInput = textInput('series-name', SERIES_NAME_MAX);
    this.seriesInput.setAttribute('data-i18n-placeholder', 'editor.seriesPlaceholder');
    const finish = () => this.handlers.finish?.();
    const cancel = () => this.handlers.cancel?.();
    bindLiveInput(this.titleInput, (v) => this.handlers.retitle?.(v), finish, cancel);
    bindLiveInput(this.seriesInput, (v) => this.handlers.rename?.(v), finish, cancel);

    this.newBtn = el('button', { type: 'button', class: 'series-new', 'data-i18n': 'editor.new' });
    this.newBtn.addEventListener('click', () => this.handlers.newSeries?.());
    this.chipRow = el('div', { class: 'series-chips', id: 'series-chips' });
    this.chipWrap = el('div', { class: 'series-chips-wrap' }, [this.chipRow]);
    this.toggleBtn = el('button', {
      type: 'button', class: 'series-toggle', 'aria-expanded': 'false', 'aria-controls': 'series-chips', hidden: true,
    }, [svgIcon(ICON_CHEVRON_DOWN, 18)]);
    this.toggleBtn.addEventListener('click', () => this.setExpanded(!this.expanded));
    const done = el('button', { type: 'button', class: 'editor-done', 'data-i18n': 'editor.done' });
    done.addEventListener('click', finish);

    this.editBlock = el('div', { class: 'info-editor', hidden: true }, [
      el('label', { class: 'editor-caption editor-label', for: 'work-title', 'data-i18n': 'editor.title' }),
      this.titleInput,
      el('label', { class: 'editor-caption editor-label editor-label--gap', for: 'series-name', 'data-i18n': 'editor.series' }),
      this.seriesInput,
      el('p', { class: 'editor-caption editor-pick', 'data-i18n': 'editor.seriesCaption' }),
      this.chipWrap,
      el('div', { class: 'series-foot' }, [this.newBtn, this.toggleBtn]),
      done,
    ]);
    // 焦点在芯片、按钮上时按 Esc 也是放弃
    this.editBlock.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || e.target instanceof HTMLInputElement) return;
      e.preventDefault();
      e.stopPropagation();
      cancel();
    });

    this.root = el('aside', { class: 'info', 'data-i18n-aria': 'info.aria' }, [this.viewBlock, this.editBlock]);

    // 编辑时点卡片外面：放弃修改并关闭（捕获阶段，赶在舞台拖动之前；右键菜单里的点击不算）
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (!this.editing) return;
        const target = e.target as Element | null;
        // 右键菜单和从它打开的浮层（改名、调色）里的点击不算“外面”
        if (!target || this.root.contains(target) || target.closest?.('.ctx-menu, .popover')) return;
        this.handlers.cancel?.();
      },
      true,
    );
  }

  /** 系列在别处改了名（右键 → 修改名称）：下一帧把编辑卡里的“系列标签”框换成新名字 */
  refreshEditor(): void {
    this.editSeriesId = null;
  }

  /** 焦点是否在编辑器里 */
  hasFocusInEditor(): boolean {
    return this.editBlock.contains(document.activeElement);
  }

  /** 打开编辑态后聚焦第一个输入框（作品标题），光标放到最后 */
  focusInput(): void {
    this.titleInput.focus({ preventScroll: true });
    const end = this.titleInput.value.length;
    this.titleInput.setSelectionRange(end, end);
  }

  render(f: InfoFrame): void {
    const editing = f.edit !== null;
    if (editing !== this.editing) {
      this.editing = editing;
      this.viewBlock.hidden = editing;
      this.editBlock.hidden = !editing;
      if (editing) {
        // 每次打开都是收起的（2026-11-17 用户要求默认关闭；选中的系列在上面的“系列标签”框里能看到名字）
        this.expanded = false;
        this.collapseKey = '';
      }
    }
    if (f.edit) this.renderEditor(f.edit);
    else {
      this.editSeriesId = null;
      this.editWorkId = null;
    }

    if (editing) return;
    const w = f.work;
    const shown = displayTitle(w);
    this.viewSeriesId = f.series.id;
    this.dot.set('background', f.series.color);
    this.chipName.text(displayName(f.series));
    this.title.text(shown);
    this.title.attr('title', shown);
    this.date.text(w.date || t('date.unknown'));
    // 设了自定义标题时，在日期下面用小字显示源文件名
    const src = w.customTitle?.trim() ? (w.fileName ?? w.title) : '';
    this.source.text(src);
    this.source.attr('title', src);
    this.source.set('display', src ? 'block' : 'none');
    this.count.text(t('info.sameSeries', { n: f.count }));
    // 已经在看全部了，提示就没有意义：拉远到一半时完全淡出
    this.dragHint.set('opacity', String(r3(Math.max(0, Math.min(1, 1 - f.zoom / 0.5)))));
    const s = infoSlide(f.frac);
    this.slide.set('transform', `translateX(${r3(s.tx)}px)`);
    this.slide.set('opacity', String(r3(s.opacity)));
  }

  private renderEditor(e: EditFrame): void {
    // 刚打开、或者换了一幅：标题框换成那一幅的自定义标题，占位符是源文件标题
    if (e.work.id !== this.editWorkId) {
      this.editWorkId = e.work.id;
      this.titleInput.value = e.work.customTitle ?? '';
      this.titleInput.placeholder = e.work.title;
    }
    // 刚打开、或者当前作品换了系列：系列框换成那个系列的名字。同一个系列里打字时不回写，避免打断输入
    if (e.series.id !== this.editSeriesId) {
      this.editSeriesId = e.series.id;
      this.seriesInput.value = e.series.name;
    }

    // 芯片：按系列 id 复用节点，顺序变了才重新排
    const ids = e.chips.map((c) => c.id);
    for (const c of e.chips) {
      let chip = this.chips.get(c.id);
      if (!chip) chip = this.makeChip(c.id);
      chip.dot.set('background', c.color);
      chip.name.text(c.name);
      chip.btn.attr('title', c.name);
      chip.btn.attr('aria-pressed', String(c.selected));
      chip.btn.el.classList.toggle('is-selected', c.selected);
    }
    if (ids.join('\n') !== this.chipOrder.join('\n')) {
      this.chipOrder = ids;
      this.chipRow.replaceChildren(...ids.map((id) => this.chips.get(id)!.btn.el));
    }
    this.applyCollapse();
  }

  /**
   * 收起状态：前 3 个正常，第 4 个磨砂渐隐（点它也能展开），其余隐藏；
   * 展开状态：全部显示。只有系列数或展开状态变了才改 DOM。
   */
  private applyCollapse(): void {
    const n = this.chipOrder.length;
    const many = n > SERIES_COLLAPSED_MAX;
    const key = `${n}|${many && this.expanded}|${this.chipOrder.join(',')}`;
    if (key === this.collapseKey) return;
    this.collapseKey = key;
    this.chipOrder.forEach((id, i) => {
      const btn = this.chips.get(id)!.btn.el;
      const folded = many && !this.expanded;
      btn.hidden = folded && i > SERIES_COLLAPSED_MAX;
      const peek = folded && i === SERIES_COLLAPSED_MAX;
      btn.classList.toggle('is-peek', peek);
      btn.tabIndex = peek ? -1 : 0;
      if (peek) btn.setAttribute('aria-hidden', 'true');
      else btn.removeAttribute('aria-hidden');
    });
    this.toggleBtn.hidden = !many;
    this.toggleBtn.setAttribute('aria-expanded', String(many && this.expanded));
    this.toggleBtn.classList.toggle('is-expanded', many && this.expanded);
    const label = this.expanded ? t('editor.collapseSeries') : t('editor.showAllSeries', { n });
    this.toggleBtn.setAttribute('aria-label', label);
    this.toggleBtn.title = label;
  }

  /** 展开 / 收起：芯片区高度从旧值过渡到新值，新露出来的芯片淡入 */
  private setExpanded(v: boolean): void {
    if (v === this.expanded) return;
    const wrap = this.chipWrap;
    const from = wrap.offsetHeight;
    this.expanded = v;
    this.applyCollapse();
    if (reducedMotion.matches) return;
    window.clearTimeout(this.expandTimer);
    const to = wrap.offsetHeight;
    wrap.classList.remove('is-animating');
    wrap.style.height = `${from}px`;
    void wrap.offsetWidth;
    wrap.classList.add('is-animating', v ? 'is-opening' : 'is-closing');
    wrap.style.height = `${to}px`;
    this.expandTimer = window.setTimeout(() => {
      wrap.classList.remove('is-animating', 'is-opening', 'is-closing');
      wrap.style.height = '';
    }, EXPAND_MS + 20);
  }

  private makeChip(id: string): Chip {
    const dot = el('span', { class: 'dot' });
    const name = el('span', { class: 'chip-name' });
    const btn = el('button', { type: 'button', class: 'series-chip', 'aria-pressed': 'false' }, [dot, name]);
    btn.addEventListener('click', () => {
      // 收起时第 4 个（磨砂的那个）只用来展开
      if (btn.classList.contains('is-peek')) this.setExpanded(true);
      else this.handlers.pick?.(id);
    });
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const p = menuPoint(e, btn);
      this.handlers.seriesMenu?.(id, p.x, p.y);
    });
    const chip = { btn: new Styled(btn), dot: new Styled(dot), name: new Styled(name) };
    this.chips.set(id, chip);
    return chip;
  }
}
