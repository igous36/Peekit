// 左上角三道杠菜单：导入文件 / 导入文件夹 / 语言（中文 · English）。
// 点外面、按 Esc、选了某一项都会收起；键盘可以用 ↑ ↓ 在菜单项之间移动。
import { lang, setLang, type Lang, type MessageKey } from '../i18n';
import { el, svgIcon } from './dom';

const ICON_MENU = ['M4 7h16', 'M4 12h16', 'M4 17h16'];

export interface MenuHandlers {
  importFiles?: () => void;
  importFolder?: () => void;
}

export class AppMenu {
  readonly root: HTMLElement;
  private button: HTMLButtonElement;
  private panel: HTMLElement;
  private langButtons: Record<Lang, HTMLButtonElement>;
  private open = false;

  constructor(public handlers: MenuHandlers = {}) {
    this.button = el(
      'button',
      {
        type: 'button',
        class: 'win-btn menu-btn',
        'aria-haspopup': 'menu',
        'aria-expanded': 'false',
        'aria-controls': 'app-menu',
        'data-i18n-aria': 'menu.open',
        'data-i18n-title': 'menu.open',
      },
      [svgIcon(ICON_MENU, 18)],
    );
    const importFiles = this.item('menu.importFiles', () => this.handlers.importFiles?.());
    const importFolder = this.item('menu.importFolder', () => this.handlers.importFolder?.());
    const zh = this.langItem('zh');
    const en = this.langItem('en');
    this.langButtons = { zh, en };
    this.panel = el('div', { id: 'app-menu', class: 'menu-panel', role: 'menu', 'data-i18n-aria': 'menu.open' }, [
      importFiles,
      importFolder,
      el('div', { class: 'menu-divider', role: 'separator' }),
      el('div', { class: 'menu-caption', 'data-i18n': 'menu.language', 'aria-hidden': 'true' }),
      el('div', { class: 'menu-langs', role: 'group', 'data-i18n-aria': 'menu.language' }, [zh, en]),
    ]);
    this.root = el('div', { class: 'app-menu' }, [this.button, this.panel]);
    this.syncLang();

    this.button.addEventListener('click', () => (this.open ? this.close(false) : this.show(false)));
    this.button.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.show(true);
      }
    });
    this.panel.addEventListener('keydown', (e) => this.onKey(e));
    // 点菜单外面收起（捕获阶段，赶在舞台的拖动之前）
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (this.open && !this.root.contains(e.target as Node)) this.close(false);
      },
      true,
    );
    this.root.addEventListener('focusout', (e) => {
      if (this.open && !this.root.contains(e.relatedTarget as Node | null)) this.close(false);
    });
  }

  private item(key: MessageKey, act: () => void): HTMLButtonElement {
    const b = el('button', { type: 'button', class: 'menu-item', role: 'menuitem', 'data-i18n': key });
    b.addEventListener('click', () => {
      this.close(true);
      act();
    });
    return b;
  }

  private langItem(l: Lang): HTMLButtonElement {
    const b = el('button', { type: 'button', class: 'menu-lang', role: 'menuitemradio', 'data-i18n': `lang.${l}` });
    b.addEventListener('click', () => {
      setLang(l);
      this.syncLang();
    });
    return b;
  }

  private syncLang(): void {
    for (const l of ['zh', 'en'] as const) {
      const on = lang() === l;
      this.langButtons[l].setAttribute('aria-checked', String(on));
      this.langButtons[l].classList.toggle('is-selected', on);
    }
  }

  private items(): HTMLButtonElement[] {
    return [...this.panel.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]')];
  }

  private show(focusFirst: boolean): void {
    this.open = true;
    this.root.classList.add('is-open');
    this.button.setAttribute('aria-expanded', 'true');
    this.syncLang();
    if (focusFirst) this.items()[0]?.focus();
  }

  private close(restoreFocus: boolean): void {
    if (!this.open) return;
    this.open = false;
    this.root.classList.remove('is-open');
    this.button.setAttribute('aria-expanded', 'false');
    if (restoreFocus || this.root.contains(document.activeElement)) this.button.focus({ preventScroll: true });
  }

  private onKey(e: KeyboardEvent): void {
    const items = this.items();
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close(true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      items[(i + d + items.length) % items.length]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      items[e.key === 'Home' ? 0 : items.length - 1]?.focus();
    }
  }
}
