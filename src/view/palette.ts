// 命令面板（2026-11-20，Ctrl+K / 菜单 → 搜索）：窗口上方居中一个白色面板，上面是输入框，下面是结果。
// 作品、系列、预览集、情绪板和常用操作放在一起搜（打分见 engine/search.ts）。
//
// - 没输入时列出常用操作、预览集和情绪板；输入后按分数排，最多 50 项
// - ↑ ↓ 换选中项，回车执行，Esc / 点外面关掉；焦点一直在输入框里（选中项用 aria-activedescendant 告诉读屏）
// - 中文输入法组字时不搜，组字结束再搜；组字时的回车是选字
// 打开时才建结果行（用户操作时，不在每帧），关掉后焦点回到打开前的位置。
import { t, type MessageKey } from '../i18n';
import { prepare, search, type Prepared, type SearchItem, type SearchKind } from '../engine/search';
import { el, svgIcon, ICON_BOARD, ICON_BOLT, ICON_IMAGE, ICON_LAYERS, ICON_SEARCH } from './dom';

const KIND_ICON: Record<SearchKind, string[]> = {
  action: ICON_BOLT,
  work: ICON_IMAGE,
  series: ICON_LAYERS,
  set: ICON_LAYERS,
  board: ICON_BOARD,
};

const KIND_LABEL: Record<SearchKind, MessageKey> = {
  action: 'palette.kindAction',
  work: 'palette.kindWork',
  series: 'palette.kindSeries',
  set: 'palette.kindSet',
  board: 'palette.kindBoard',
};

export interface PaletteSource {
  /** 没输入时列出来的（常用操作、预览集、情绪板） */
  initial: SearchItem[];
  /** 能搜到的全部；作品很多时第一次输入才建（见 App.openPalette） */
  all: () => SearchItem[];
  /** 输入框的提示（2026-11-20：挑一幅来对比时换成“选一幅来对比”）；不给就是默认的 */
  placeholder?: string;
}

export class Palette {
  readonly root: HTMLElement;
  private panel: HTMLElement;
  private input: HTMLInputElement;
  private list: HTMLElement;
  private empty: HTMLElement;
  private source: PaletteSource | null = null;
  private prepared: Prepared[] | null = null;
  private results: SearchItem[] = [];
  private active = 0;
  private returnFocus: HTMLElement | null = null;
  private seq = 0;

  constructor() {
    this.input = el('input', {
      class: 'palette-input', type: 'text', autocomplete: 'off', spellcheck: 'false',
      role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'palette-list', 'aria-autocomplete': 'list',
      'data-i18n-placeholder': 'palette.placeholder', 'data-i18n-aria': 'palette.placeholder',
    });
    this.list = el('div', { id: 'palette-list', class: 'palette-list', role: 'listbox' });
    this.empty = el('p', { class: 'palette-empty', 'data-i18n': 'palette.none', hidden: true });
    this.panel = el('div', { class: 'palette', role: 'dialog', 'aria-modal': 'true', 'data-i18n-aria': 'palette.menu' }, [
      el('div', { class: 'palette-head' }, [
        el('span', { class: 'palette-glass', 'aria-hidden': 'true' }, [svgIcon(ICON_SEARCH, 18)]),
        this.input,
        el('kbd', { class: 'palette-esc', 'aria-hidden': 'true' }, ['Esc']),
      ]),
      this.list,
      this.empty,
    ]);
    this.root = el('div', { class: 'palette-layer', hidden: true }, [this.panel]);
    // 点面板外面：关掉
    this.root.addEventListener('pointerdown', (e) => {
      if (!this.panel.contains(e.target as Node)) this.close();
    });
    this.input.addEventListener('input', (e) => {
      if ((e as InputEvent).isComposing) return;
      this.update();
    });
    this.input.addEventListener('compositionend', () => this.update());
    this.input.addEventListener('keydown', (e) => this.onKey(e));
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(source: PaletteSource): void {
    if (!this.isOpen) this.returnFocus = document.activeElement as HTMLElement | null;
    this.source = source;
    this.prepared = null;
    this.root.hidden = false;
    this.input.value = '';
    const hint = source.placeholder ?? t('palette.placeholder');
    this.input.placeholder = hint;
    this.input.setAttribute('aria-label', hint);
    this.update();
    void this.panel.offsetWidth;
    this.root.classList.add('is-open');
    this.input.focus({ preventScroll: true });
  }

  close(): void {
    if (!this.isOpen) return;
    // 先让输入框失焦：只是藏起来的话，焦点还挂在它上面，方向键、快捷键都收不到
    this.input.blur();
    this.root.classList.remove('is-open');
    this.root.hidden = true;
    this.source = null;
    this.prepared = null;
    this.list.replaceChildren();
    const back = this.returnFocus;
    this.returnFocus = null;
    if (back && document.contains(back)) back.focus({ preventScroll: true });
  }

  private update(): void {
    const src = this.source;
    if (!src) return;
    const q = this.input.value;
    if (q.trim()) {
      this.prepared ??= prepare(src.all());
      this.results = search(q, this.prepared);
    } else {
      this.results = src.initial;
    }
    this.active = 0;
    this.renderList(!!q.trim());
  }

  private renderList(searching: boolean): void {
    const id = ++this.seq;
    const rows = this.results.map((it, i) => {
      const row = el('div', {
        id: `palette-opt-${id}-${i}`, class: 'palette-row', role: 'option', 'aria-selected': 'false',
      }, [
        el('span', { class: 'palette-icon', 'aria-hidden': 'true' }, [svgIcon(KIND_ICON[it.kind], 16)]),
        el('span', { class: 'palette-text' }, [
          el('span', { class: 'palette-label' }, [it.label]),
          ...(it.sub ? [el('span', { class: 'palette-sub' }, [it.sub])] : []),
        ]),
        it.shortcut
          ? el('kbd', { class: 'palette-kbd' }, [it.shortcut])
          : el('span', { class: 'palette-kind' }, [t(KIND_LABEL[it.kind])]),
      ]);
      row.addEventListener('pointermove', () => this.setActive(i, false));
      row.addEventListener('click', () => this.runAt(i));
      return row;
    });
    this.list.replaceChildren(...rows);
    this.empty.hidden = !searching || rows.length > 0;
    this.setActive(0, true);
  }

  private setActive(i: number, scroll: boolean): void {
    const rows = this.list.children;
    if (!rows.length) {
      this.input.removeAttribute('aria-activedescendant');
      return;
    }
    this.active = (i + rows.length) % rows.length;
    for (let k = 0; k < rows.length; k++) {
      const on = k === this.active;
      rows[k].classList.toggle('is-active', on);
      rows[k].setAttribute('aria-selected', String(on));
    }
    const row = rows[this.active] as HTMLElement;
    this.input.setAttribute('aria-activedescendant', row.id);
    if (scroll) row.scrollIntoView({ block: 'nearest' });
  }

  private runAt(i: number): void {
    const it = this.results[i];
    if (!it) return;
    // 先关面板（焦点回到打开前的位置），再执行：执行时可能要打开别的浮层、换焦点
    this.close();
    it.run();
  }

  private onKey(e: KeyboardEvent): void {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      this.setActive(this.active + (e.key === 'ArrowDown' ? 1 : -1), true);
    } else if (e.key === 'Enter') {
      this.runAt(this.active);
    } else if (e.key === 'Escape') {
      this.close();
    } else if (e.key === 'Tab') {
      // 焦点只留在输入框里
    } else {
      // 其余按键照常输入；打字的键别让文档上的单键快捷键（数字打星、H / G / B）收到。
      // F5 这类功能键照常冒泡（文档上要拦掉 WebView 默认的整页刷新）
      if (e.key.length === 1) e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  }
}
