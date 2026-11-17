// 空状态卡片、拖放提示、轻提示（toast）。
import { el, Styled } from './dom';

export interface EmptyHandlers {
  pickFiles?: () => void;
  pickFolder?: () => void;
}

/** HANDOFF §8 空状态：舞台只显示玻璃网格，中间一张白色大圆角卡片 */
export class EmptyState {
  readonly root: HTMLElement;
  private loading: HTMLElement;
  private actions: HTMLElement;

  constructor(public handlers: EmptyHandlers = {}) {
    const files = el('button', { type: 'button', class: 'empty-btn empty-btn--primary', 'data-i18n': 'empty.pickFiles' });
    const folder = el('button', { type: 'button', class: 'empty-btn', 'data-i18n': 'empty.pickFolder' });
    files.addEventListener('click', () => this.handlers.pickFiles?.());
    folder.addEventListener('click', () => this.handlers.pickFolder?.());
    this.actions = el('div', { class: 'empty-actions' }, [
      el('p', { class: 'empty-title', 'data-i18n': 'empty.title' }),
      el('p', { class: 'empty-or', 'data-i18n': 'empty.or' }),
      el('div', { class: 'empty-buttons' }, [files, folder]),
      el('p', { class: 'empty-formats', 'data-i18n': 'empty.formats' }),
    ]);
    this.loading = el('p', { class: 'empty-title', 'data-i18n': 'empty.loading', hidden: true });
    this.root = el('div', { class: 'empty-state', hidden: true }, [
      el('div', { class: 'empty-card' }, [this.actions, this.loading]),
    ]);
  }

  private state = '';

  /** 每帧都会调用：状态没变就不碰 DOM */
  set(visible: boolean, loading = false): void {
    const s = `${visible}|${loading}`;
    if (s === this.state) return;
    this.state = s;
    this.root.hidden = !visible;
    this.actions.hidden = loading;
    this.loading.hidden = !loading;
  }
}

/** 拖着文件进窗口时的提示 */
export class DropOverlay {
  readonly root: HTMLElement;

  constructor() {
    this.root = el('div', { class: 'drop-overlay', 'aria-hidden': 'true' }, [
      el('div', { class: 'drop-frame' }, [el('span', { 'data-i18n': 'drop.release' })]),
    ]);
  }

  set(visible: boolean): void {
    this.root.classList.toggle('is-visible', visible);
  }
}

/** 底部轻提示：导入结果等，几秒后自动消失；sticky 的要手动 hide */
export class Toast {
  readonly root: HTMLElement;
  private text: Styled;
  private timer = 0;

  constructor() {
    const span = el('span');
    this.text = new Styled(span);
    this.root = el('div', { class: 'toast', role: 'status', 'aria-live': 'polite' }, [span]);
  }

  show(message: string, sticky = false): void {
    window.clearTimeout(this.timer);
    this.text.text(message);
    this.root.classList.add('is-visible');
    if (!sticky) this.timer = window.setTimeout(() => this.hide(), 2600);
  }

  hide(): void {
    window.clearTimeout(this.timer);
    this.root.classList.remove('is-visible');
  }
}
