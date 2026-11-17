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

export interface ToastAction {
  label: string;
  run: () => void;
}

/** 有操作按钮（撤销）时多留一会儿 */
const TOAST_MS = 2600;
const TOAST_ACTION_MS = 6000;

/**
 * 底部轻提示：导入结果等，几秒后自动消失；sticky 的要手动 hide。
 * 2026-11-17：可以带一个操作按钮（右键删除后的“撤销”），指针停在上面时不消失。
 */
export class Toast {
  readonly root: HTMLElement;
  private text: Styled;
  private actionBtn: HTMLButtonElement;
  private action: ToastAction | null = null;
  private timer = 0;
  private hovering = false;
  private sticky = false;

  constructor() {
    const span = el('span');
    this.text = new Styled(span);
    this.actionBtn = el('button', { type: 'button', class: 'toast-action', hidden: true });
    this.actionBtn.addEventListener('click', () => {
      const a = this.action;
      this.hide();
      a?.run();
    });
    this.root = el('div', { class: 'toast', role: 'status', 'aria-live': 'polite' }, [span, this.actionBtn]);
    this.root.addEventListener('pointerenter', () => {
      this.hovering = true;
      window.clearTimeout(this.timer);
    });
    this.root.addEventListener('pointerleave', () => {
      this.hovering = false;
      this.arm();
    });
  }

  show(message: string, opts: boolean | { sticky?: boolean; action?: ToastAction } = false): void {
    const o = typeof opts === 'boolean' ? { sticky: opts } : opts;
    window.clearTimeout(this.timer);
    this.text.text(message);
    this.action = o.action ?? null;
    this.actionBtn.hidden = !this.action;
    this.actionBtn.textContent = this.action?.label ?? '';
    this.root.classList.toggle('has-action', !!this.action);
    this.root.classList.add('is-visible');
    this.sticky = !!o.sticky;
    this.arm();
  }

  private arm(): void {
    window.clearTimeout(this.timer);
    if (this.sticky || this.hovering) return;
    this.timer = window.setTimeout(() => this.hide(), this.action ? TOAST_ACTION_MS : TOAST_MS);
  }

  hide(): void {
    window.clearTimeout(this.timer);
    this.action = null;
    this.root.classList.remove('is-visible', 'has-action');
  }
}
