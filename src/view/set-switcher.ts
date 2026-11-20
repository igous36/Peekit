// 字标旁边的预览集胶囊（2026-11-17 新增）：显示当前预览集名字，点开是预览集列表（带作品数），
// 点一个就切换；最下面可以新建。
// 2026-11-18：右键（或菜单键 / Shift+F10）列表里的预览集：修改名称（原地输入框）/ 创建副本 / 删除预览集，
// 和左上角三道杠菜单里的一样（共用 set-rows.ts）。
// 2026-11-20：删除改成屏幕中央的确认框（confirm-dialog.ts），和三道杠菜单一致
import { t } from '../i18n';
import { el, svgIcon, Styled, ICON_CHECK, ICON_CHEVRON_DOWN, ICON_PLUS } from './dom';
import { Dropdown } from './dropdown';
import { menuPoint, type CtxItem } from './context-menu';
import { setContextItems, setRenameRow } from './set-rows';
import type { SetInfo } from './menu';
import type { ConfirmOptions } from './confirm-dialog';

export interface SwitcherHandlers {
  sets: () => SetInfo[];
  switchSet: (id: string) => void;
  newSet: () => void;
  renameSet: (id: string, name: string) => void;
  deleteSet: (id: string) => void;
  /** 复制预览集，返回副本的 id（失败返回 null） */
  duplicateSet: (id: string) => string | null;
  /** 弹出右键菜单（全局只有一个，由 app 持有） */
  contextMenu: (items: CtxItem[], x: number, y: number, label: string) => void;
  /** 屏幕中央的确认框：点了确认才调用 run */
  confirm: (opts: ConfirmOptions, run: () => void) => void;
}

export class SetSwitcher {
  readonly root: HTMLElement;
  private chip: HTMLButtonElement;
  private name: Styled;
  private panel: HTMLElement;
  private dropdown: Dropdown;
  /** 正在原地改名的预览集 */
  private editing: string | null = null;

  constructor(private handlers: SwitcherHandlers) {
    const name = el('span', { class: 'set-chip-name' });
    this.name = new Styled(name);
    this.chip = el('button', { type: 'button', class: 'set-chip', 'aria-controls': 'set-panel' }, [
      name,
      el('span', { class: 'set-chip-caret' }, [svgIcon(ICON_CHEVRON_DOWN, 14)]),
    ]);
    this.panel = el('div', { id: 'set-panel', class: 'menu-panel set-panel', role: 'menu' });
    this.root = el('div', { class: 'set-switch' }, [this.chip, this.panel]);
    this.dropdown = new Dropdown(this.root, this.chip, this.panel, () => {
      this.editing = null;
      this.rebuild();
    });
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
    for (const s of this.handlers.sets()) items.push(this.row(s));
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

  private row(s: SetInfo): HTMLElement {
    if (this.editing === s.id) {
      return setRenameRow(s, (commit, value) => {
        if (commit) this.handlers.renameSet(s.id, value);
        this.editing = null;
        this.rebuild();
        this.dropdown.focusItem((x) => x.dataset.set === s.id);
      });
    }
    const b = el('button', {
      type: 'button', class: 'menu-item', role: 'menuitemradio', 'aria-checked': String(s.current), title: s.name,
      'data-set': s.id,
    }, [
      el('span', { class: 'menu-lead' }, s.current ? [svgIcon(ICON_CHECK, 16)] : []),
      el('span', { class: 'menu-label' }, [s.name]),
      el('span', { class: 'menu-count' }, [String(s.count)]),
    ]);
    b.addEventListener('click', () => {
      this.dropdown.close(true);
      if (!s.current) this.handlers.switchSet(s.id);
    });
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const { x, y } = menuPoint(e, b);
      const items = setContextItems(s, {
        rename: () => {
          this.editing = s.id;
          this.rebuild();
          const input = this.panel.querySelector<HTMLInputElement>('.menu-input');
          input?.focus();
          input?.select();
        },
        duplicate: () => {
          const id = this.handlers.duplicateSet(s.id);
          this.rebuild();
          this.dropdown.focusItem((x) => x.dataset.set === id);
        },
        remove: () => {
          this.handlers.confirm({ title: t('sets.deleteConfirm', { name: s.name }) }, () => {
            this.handlers.deleteSet(s.id);
            if (!this.isOpen) return;
            this.rebuild();
            this.dropdown.focusItem();
          });
        },
      });
      this.handlers.contextMenu(items, x, y, t('ctx.label', { name: s.name }));
    });
    return b;
  }
}
