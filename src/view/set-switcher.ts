// 字标旁边的预览集胶囊（2026-11-17 新增）：显示当前预览集名字，点开是预览集列表（带作品数），
// 点一个就切换；最下面可以新建。改名、删除在左上角菜单里。
import { t } from '../i18n';
import { el, svgIcon, Styled, ICON_CHECK, ICON_CHEVRON_DOWN, ICON_PLUS } from './dom';
import { Dropdown } from './dropdown';
import type { SetInfo } from './menu';

export interface SwitcherHandlers {
  sets: () => SetInfo[];
  switchSet: (id: string) => void;
  newSet: () => void;
}

export class SetSwitcher {
  readonly root: HTMLElement;
  private chip: HTMLButtonElement;
  private name: Styled;
  private panel: HTMLElement;
  private dropdown: Dropdown;

  constructor(private handlers: SwitcherHandlers) {
    const name = el('span', { class: 'set-chip-name' });
    this.name = new Styled(name);
    this.chip = el('button', { type: 'button', class: 'set-chip', 'aria-controls': 'set-panel' }, [
      name,
      el('span', { class: 'set-chip-caret' }, [svgIcon(ICON_CHEVRON_DOWN, 14)]),
    ]);
    this.panel = el('div', { id: 'set-panel', class: 'menu-panel set-panel', role: 'menu' });
    this.root = el('div', { class: 'set-switch' }, [this.chip, this.panel]);
    this.dropdown = new Dropdown(this.root, this.chip, this.panel, () => this.rebuild());
  }

  get isOpen(): boolean {
    return this.dropdown.isOpen;
  }

  /** 当前预览集名字（语言切换、改名、切换后调用） */
  update(name: string): void {
    this.name.text(name);
    const label = t('sets.switch', { name });
    if (this.chip.getAttribute('aria-label') !== label) {
      this.chip.setAttribute('aria-label', label);
      this.chip.title = label;
    }
  }

  private rebuild(): void {
    const items: HTMLElement[] = [el('div', { class: 'menu-caption', 'aria-hidden': 'true' }, [t('sets.title')])];
    for (const s of this.handlers.sets()) {
      const b = el('button', {
        type: 'button', class: 'menu-item', role: 'menuitemradio', 'aria-checked': String(s.current), title: s.name,
      }, [
        el('span', { class: 'menu-lead' }, s.current ? [svgIcon(ICON_CHECK, 16)] : []),
        el('span', { class: 'menu-label' }, [s.name]),
        el('span', { class: 'menu-count' }, [String(s.count)]),
      ]);
      b.addEventListener('click', () => {
        this.dropdown.close(true);
        if (!s.current) this.handlers.switchSet(s.id);
      });
      items.push(b);
    }
    const add = el('button', { type: 'button', class: 'menu-item menu-item--new', role: 'menuitem' }, [
      el('span', { class: 'menu-lead' }, [svgIcon(ICON_PLUS, 16)]),
      el('span', { class: 'menu-label' }, [t('sets.new').replace(/^\+\s*/, '')]),
    ]);
    add.addEventListener('click', () => {
      this.dropdown.close(true);
      this.handlers.newSet();
    });
    items.push(el('div', { class: 'menu-divider', role: 'separator' }), add);
    this.panel.replaceChildren(...items);
  }
}
