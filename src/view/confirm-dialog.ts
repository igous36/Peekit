// 屏幕中央的确认框（2026-11-20，删除预览集 / 情绪板；原来是在菜单里原地展开一行确认）：
//
//   删除「旅行速写」？
//                       [取消]  [删除]
//
// 和“关于 Peekit”同一套外观（半透明遮罩、白卡、面板阴影，全屏时用深色变量）。
// 打开时焦点在“取消”上（不小心按回车也删不掉）；Esc、点遮罩 = 取消；Tab 只在两个按钮之间转。
// 开着它的菜单留在遮罩后面不收起（dropdown.ts 把 .confirm-scrim 里的点击、焦点当成菜单自己的），
// 删完菜单列表原地更新。
import { t } from '../i18n';
import { el } from './dom';

export interface ConfirmOptions {
  title: string;
  /** 确认按钮的文字（默认“删除”） */
  confirmLabel?: string;
}

export class ConfirmDialog {
  readonly root: HTMLElement;
  private title: HTMLElement;
  private ok: HTMLButtonElement;
  private cancel: HTMLButtonElement;
  private onConfirm: (() => void) | null = null;
  private returnFocus: HTMLElement | null = null;
  private closeTimer = 0;

  constructor() {
    this.title = el('h2', { id: 'confirm-title', class: 'confirm-title' });
    this.cancel = el('button', { type: 'button', class: 'about-btn confirm-btn' });
    this.ok = el('button', { type: 'button', class: 'about-btn about-btn--primary confirm-btn' });
    this.cancel.addEventListener('click', () => this.close(false));
    this.ok.addEventListener('click', () => this.close(true));
    const dialog = el('div', {
      class: 'about-dialog confirm-dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'confirm-title',
    }, [this.title, el('div', { class: 'about-actions' }, [this.cancel, this.ok])]);
    this.root = el('div', { class: 'about-scrim confirm-scrim', hidden: true }, [dialog]);
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.close(false);
    });
    this.root.addEventListener('keydown', (e) => this.onKey(e));
  }

  get isOpen(): boolean {
    return !this.root.hidden && this.root.classList.contains('is-open');
  }

  /** 打开；点了确认才调用 confirm（在确认框关掉、焦点放回原处之后） */
  open(opts: ConfirmOptions, confirm: () => void): void {
    window.clearTimeout(this.closeTimer);
    if (!this.isOpen) this.returnFocus = document.activeElement as HTMLElement | null;
    this.onConfirm = confirm;
    this.title.textContent = opts.title;
    this.cancel.textContent = t('sets.cancel');
    this.ok.textContent = opts.confirmLabel ?? t('sets.confirmDelete');
    this.root.hidden = false;
    void this.root.offsetWidth;
    this.root.classList.add('is-open');
    this.cancel.focus({ preventScroll: true });
  }

  private close(confirmed: boolean): void {
    if (!this.isOpen) return;
    const run = confirmed ? this.onConfirm : null;
    this.onConfirm = null;
    this.root.classList.remove('is-open');
    // 等淡出结束再隐藏
    this.closeTimer = window.setTimeout(() => (this.root.hidden = true), 160);
    const back = this.returnFocus;
    this.returnFocus = null;
    if (back && document.contains(back)) back.focus({ preventScroll: true });
    run?.();
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.close(false);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      (document.activeElement === this.cancel ? this.ok : this.cancel).focus();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      // 左右键在两个按钮之间换（和系统对话框一样）
      e.preventDefault();
      (e.key === 'ArrowLeft' ? this.cancel : this.ok).focus();
    }
    // 其余按键不往外传：数字打星、H / G / B 这些单键快捷键在确认框开着时不响应
    e.stopPropagation();
  }
}
