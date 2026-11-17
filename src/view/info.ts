// 右上角信息卡：展示态（系列芯片 + 铅笔、标题、日期、源文件名、同系列数量）和编辑态（作品标题 + SeriesEditor）。
// 两套节点都只建一次，用 hidden 切换；芯片按系列 id 复用节点。
import type { Series, Work } from '../data/types';
import { SERIES_NAME_MAX, TITLE_MAX, displayName, displayTitle } from '../data/series-ops';
import { t } from '../i18n';
import { r3 } from '../engine/math';
import { infoSlide } from '../engine/mapping';
import { el, svgIcon, ICON_PENCIL, Styled } from './dom';

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
  /** 不为 null 时显示编辑态 */
  edit: EditFrame | null;
}

export interface InfoHandlers {
  startEdit?: () => void;
  retitle?: (title: string) => void;
  rename?: (name: string) => void;
  pick?: (seriesId: string) => void;
  newSeries?: () => void;
  finish?: () => void;
}

interface Chip {
  btn: Styled<HTMLButtonElement>;
  dot: Styled;
  name: Styled;
}

/**
 * 文本框的实时输入：中文输入法组字时不回调（否则会闪拼音），组字结束再回调；
 * 组字时的回车是选字，不是完成。
 */
function bindLiveInput(input: HTMLInputElement, onChange: (v: string) => void, onFinish: () => void): void {
  input.addEventListener('input', (e) => {
    if ((e as InputEvent).isComposing) return;
    onChange(input.value);
  });
  input.addEventListener('compositionend', () => onChange(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      onFinish();
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

  private editBlock: HTMLElement;
  private titleInput: HTMLInputElement;
  private seriesInput: HTMLInputElement;
  private pickLabel: Styled;
  private chipRow: HTMLElement;
  private newBtn: HTMLButtonElement;
  private chips = new Map<string, Chip>();
  private chipOrder: string[] = [];
  private editing = false;
  private editSeriesId: string | null = null;
  private editWorkId: string | null = null;

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
    const slide = el('div', { class: 'info-slide' }, [
      el('div', { class: 'info-head' }, [el('span', { class: 'chip' }, [dot, chipName]), this.editButton]),
      title,
      date,
      source,
    ]);
    const count = el('span');
    this.viewBlock = el('div', { class: 'info-view' }, [
      slide,
      el('div', { class: 'divider' }),
      el('div', { class: 'info-foot' }, [count, el('span', { 'data-i18n': 'info.dragDown' })]),
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
    bindLiveInput(this.titleInput, (v) => this.handlers.retitle?.(v), finish);
    bindLiveInput(this.seriesInput, (v) => this.handlers.rename?.(v), finish);

    const pickLabel = el('p', { class: 'editor-caption editor-pick' });
    this.pickLabel = new Styled(pickLabel);
    this.newBtn = el('button', { type: 'button', class: 'series-new', 'data-i18n': 'editor.new' });
    this.newBtn.addEventListener('click', () => this.handlers.newSeries?.());
    this.chipRow = el('div', { class: 'series-chips' }, [this.newBtn]);
    const done = el('button', { type: 'button', class: 'editor-done', 'data-i18n': 'editor.done' });
    done.addEventListener('click', finish);
    this.editBlock = el('div', { class: 'info-editor', hidden: true }, [
      el('label', { class: 'editor-caption editor-label', for: 'work-title', 'data-i18n': 'editor.title' }),
      this.titleInput,
      el('label', { class: 'editor-caption editor-label editor-label--gap', for: 'series-name', 'data-i18n': 'editor.series' }),
      this.seriesInput,
      pickLabel,
      this.chipRow,
      done,
    ]);

    this.root = el('aside', { class: 'info', 'data-i18n-aria': 'info.aria' }, [this.viewBlock, this.editBlock]);
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
    }
    if (f.edit) this.renderEditor(f.edit);
    else {
      this.editSeriesId = null;
      this.editWorkId = null;
    }

    if (editing) return;
    const w = f.work;
    const shown = displayTitle(w);
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
    this.pickLabel.text(t('editor.pick', { title: displayTitle(e.work) }));

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
      const nodes = ids.map((id) => this.chips.get(id)!.btn.el);
      this.chipRow.replaceChildren(...nodes, this.newBtn);
    }
  }

  private makeChip(id: string): Chip {
    const dot = el('span', { class: 'dot' });
    const name = el('span', { class: 'chip-name' });
    const btn = el('button', { type: 'button', class: 'series-chip', 'aria-pressed': 'false' }, [dot, name]);
    btn.addEventListener('click', () => this.handlers.pick?.(id));
    const chip = { btn: new Styled(btn), dot: new Styled(dot), name: new Styled(name) };
    this.chips.set(id, chip);
    return chip;
  }
}
