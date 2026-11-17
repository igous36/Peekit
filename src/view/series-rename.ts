// “修改名称”浮层（2026-11-17 新增，右键系列 → 修改名称）：
//
//   修改系列名称  ● 夏日
//   [ 夏日                    ]
//               [取消] [完成]
//
// 打开时全选旧名字；回车 / 完成保存，Esc / 取消 / 点外面放弃。名字为空时“完成”不可点。
// 中文输入法组字时的回车是选字，不算完成。
import { t } from '../i18n';
import { SERIES_NAME_MAX } from '../data/series-ops';
import { el } from './dom';
import { Popover } from './popover';

export class RenamePopover {
  readonly root: HTMLElement;
  private pop: Popover;
  private dot: HTMLElement;
  private input: HTMLInputElement;
  private done: HTMLButtonElement;
  private commit: ((name: string) => void) | null = null;

  constructor() {
    this.dot = el('span', { class: 'dot' });
    this.input = el('input', {
      class: 'series-input', type: 'text', maxlength: SERIES_NAME_MAX, spellcheck: 'false', autocomplete: 'off',
      'data-i18n-aria': 'rename.title',
    });
    const cancel = el('button', { type: 'button', class: 'pop-btn', 'data-i18n': 'pop.cancel' });
    this.done = el('button', { type: 'button', class: 'pop-btn pop-btn--primary', 'data-i18n': 'pop.done' });
    cancel.addEventListener('click', () => this.pop.dismiss());
    this.done.addEventListener('click', () => this.finish());
    this.input.addEventListener('input', () => (this.done.disabled = !this.input.value.trim()));
    this.input.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        this.finish();
      }
    });
    this.pop = new Popover('rename-pop', [
      el('p', { class: 'pop-title' }, [el('span', { 'data-i18n': 'rename.title' }), this.dot]),
      this.input,
      el('div', { class: 'pop-actions' }, [cancel, this.done]),
    ]);
    this.pop.onDismiss = () => (this.commit = null);
    this.root = this.pop.root;
  }

  open(series: { name: string; color: string }, x: number, y: number, commit: (name: string) => void): void {
    this.pop.dismiss();
    this.commit = commit;
    this.dot.style.background = series.color;
    this.input.value = series.name;
    this.done.disabled = !series.name.trim();
    this.pop.show(x, y, t('rename.title'), this.input);
    this.input.select();
  }

  private finish(): void {
    const name = this.input.value.trim();
    if (!name) return;
    const c = this.commit;
    this.commit = null;
    c?.(name);
    this.pop.hide();
  }
}
