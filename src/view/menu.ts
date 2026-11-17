// 左上角三道杠菜单（2026-11-17 重做）：
//
//   导入文件到…        ›      → 二级：+ 新建预览集 / 现有预览集列表
//   导入文件夹到…      ›      → 同上
//   ───────
//   预览集
//   ✓ 我的作品   128   ✎ 🗑   ← 点名字切换；✎ 原地改名；🗑 原地确认删除（只删预览集，不删图片）
//     旅行速写    36   ✎ 🗑
//   + 新建预览集
//   ───────
//   外观  [浅色] [深色] [跟随系统]      ← 2026-11-17 新增
//   语言  [中文] [English]
//   ───────
//   ⓘ 关于 Peekit                      ← 2026-11-17 新增
//
// 面板内容在每次打开 / 切换视图 / 改名删除后重建（用户操作时，不在每帧）。
// 进出二级视图时有过渡（2026-11-17 新增）：旧内容滑出淡出、新内容从另一侧滑入，面板高度跟着过渡。
import { lang, setLang, t, type Lang, type MessageKey } from '../i18n';
import { setThemePref, themePref, type ThemePref } from '../theme';
import { SET_NAME_MAX } from '../data/sets';
import { el, svgIcon, ICON_CHECK, ICON_INFO, ICON_NEXT, ICON_PENCIL, ICON_PLUS, ICON_PREV, ICON_TRASH } from './dom';
import { Dropdown } from './dropdown';

const ICON_MENU = ['M4 7h16', 'M4 12h16', 'M4 17h16'];

/** 进出二级视图的过渡时长（ms），和 CSS 里的 menu-in / menu-out 一致 */
const VIEW_MS = 220;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

export interface SetInfo {
  id: string;
  name: string;
  count: number;
  current: boolean;
}

export type ImportKind = 'files' | 'folder';

export interface MenuHandlers {
  sets: () => SetInfo[];
  /** target：'new' = 导入到新建预览集；否则是现有预览集的 id */
  importTo: (kind: ImportKind, target: 'new' | string) => void;
  switchSet: (id: string) => void;
  newSet: () => void;
  renameSet: (id: string, name: string) => void;
  deleteSet: (id: string) => void;
  /** 打开“关于 Peekit” */
  about: () => void;
}

export class AppMenu {
  readonly root: HTMLElement;
  private panel: HTMLElement;
  private dropdown: Dropdown;
  private view: 'main' | ImportKind = 'main';
  private editing: string | null = null;
  private confirming: string | null = null;

  constructor(private handlers: MenuHandlers) {
    const button = el(
      'button',
      {
        type: 'button',
        class: 'win-btn menu-btn',
        'aria-controls': 'app-menu',
        'data-i18n-aria': 'menu.open',
        'data-i18n-title': 'menu.open',
      },
      [svgIcon(ICON_MENU, 18)],
    );
    this.panel = el('div', { id: 'app-menu', class: 'menu-panel', role: 'menu', 'data-i18n-aria': 'menu.open' });
    this.root = el('div', { class: 'app-menu' }, [button, this.panel]);
    this.dropdown = new Dropdown(this.root, button, this.panel, () => {
      this.view = 'main';
      this.editing = null;
      this.confirming = null;
      this.rebuild();
    });
  }

  get isOpen(): boolean {
    return this.dropdown.isOpen;
  }

  // ───────────── 构建面板 ─────────────

  private rebuild(): void {
    this.panel.replaceChildren(...(this.view === 'main' ? this.mainView() : this.importView(this.view)));
  }

  private go(view: 'main' | ImportKind, focus?: (el: HTMLElement) => boolean): void {
    // 进二级：旧内容往左滑出、新内容从右滑入；返回反过来
    this.slide(view === 'main' ? -1 : 1, () => {
      this.view = view;
      this.editing = null;
      this.confirming = null;
      this.rebuild();
    });
    this.dropdown.focusItem(focus);
  }

  private ghostTimer = 0;

  /**
   * 换视图的过渡：旧的那些节点挪进一层叠在上面的“残影”里滑出淡出（不可聚焦），
   * 新内容从另一侧滑入，面板高度从旧值过渡到新值。减少动态效果时直接换。
   */
  private slide(dir: 1 | -1, swap: () => void): void {
    const panel = this.panel;
    if (reducedMotion.matches) {
      swap();
      return;
    }
    window.clearTimeout(this.ghostTimer);
    panel.querySelector('.menu-ghost')?.remove();
    const from = panel.offsetHeight;
    const old = [...panel.childNodes];
    swap();
    const ghost = el('div', { class: 'menu-ghost', 'aria-hidden': 'true' });
    ghost.inert = true;
    ghost.append(...old);
    panel.append(ghost);
    const to = panel.offsetHeight;
    panel.classList.remove('is-sliding-fwd', 'is-sliding-back');
    // 强制重排，让动画从头开始（连续快速切换时也是）
    void panel.offsetWidth;
    panel.classList.add(dir > 0 ? 'is-sliding-fwd' : 'is-sliding-back');
    panel.style.height = `${from}px`;
    void panel.offsetWidth;
    panel.style.height = `${to}px`;
    this.ghostTimer = window.setTimeout(() => {
      ghost.remove();
      panel.classList.remove('is-sliding-fwd', 'is-sliding-back');
      panel.style.height = '';
    }, VIEW_MS + 30);
  }

  private item(label: string, act: () => void, opts: { icon?: string[]; trail?: Node; cls?: string; role?: string } = {}) {
    const children: Node[] = [];
    if (opts.icon) children.push(el('span', { class: 'menu-lead' }, [svgIcon(opts.icon, 16)]));
    children.push(el('span', { class: 'menu-label' }, [label]));
    if (opts.trail) children.push(opts.trail);
    const b = el('button', { type: 'button', class: `menu-item ${opts.cls ?? ''}`.trim(), role: opts.role ?? 'menuitem' }, children);
    b.addEventListener('click', act);
    return b;
  }

  private caption(key: MessageKey): HTMLElement {
    return el('div', { class: 'menu-caption', 'aria-hidden': 'true' }, [t(key)]);
  }

  private divider(): HTMLElement {
    return el('div', { class: 'menu-divider', role: 'separator' });
  }

  private mainView(): HTMLElement[] {
    const chevron = () => el('span', { class: 'menu-trail' }, [svgIcon(ICON_NEXT, 14)]);
    const out: HTMLElement[] = [
      this.item(t('menu.importFilesTo'), () => this.go('files'), { trail: chevron() }),
      this.item(t('menu.importFolderTo'), () => this.go('folder'), { trail: chevron() }),
      this.divider(),
      this.caption('sets.title'),
    ];
    for (const s of this.handlers.sets()) out.push(this.setRow(s));
    out.push(
      this.item(t('sets.new').replace(/^\+\s*/, ''), () => {
        this.dropdown.close(true);
        this.handlers.newSet();
      }, { icon: ICON_PLUS, cls: 'menu-item--new' }),
      this.divider(),
      this.caption('menu.theme'),
      this.themeRow(),
      this.caption('menu.language'),
      this.langRow(),
      this.divider(),
      this.item(t('about.menu'), () => {
        this.dropdown.close(false);
        this.handlers.about();
      }, { icon: ICON_INFO }),
    );
    return out;
  }

  /** 外观：浅色 / 深色 / 跟随系统（和语言同一种分段按钮） */
  private themeRow(): HTMLElement {
    const row = el('div', { class: 'menu-langs menu-langs--3', role: 'group', 'aria-label': t('menu.theme') });
    for (const p of ['light', 'dark', 'system'] as ThemePref[]) {
      const on = themePref() === p;
      const b = el('button', {
        type: 'button', class: `menu-lang${on ? ' is-selected' : ''}`, role: 'menuitemradio', 'aria-checked': String(on),
        'data-theme-pref': p,
      }, [t(`theme.${p}` as MessageKey)]);
      b.addEventListener('click', () => {
        setThemePref(p);
        this.rebuild();
        this.dropdown.focusItem((x) => x.dataset.themePref === p);
      });
      row.append(b);
    }
    return row;
  }

  private setRow(s: SetInfo): HTMLElement {
    if (this.editing === s.id) return this.renameRow(s);
    if (this.confirming === s.id) return this.confirmRow(s);
    const main = el('button', {
      type: 'button',
      class: 'menu-item menu-set-main',
      role: 'menuitemradio',
      'aria-checked': String(s.current),
      title: s.name,
      'data-set': s.id,
    }, [
      el('span', { class: 'menu-lead' }, s.current ? [svgIcon(ICON_CHECK, 16)] : []),
      el('span', { class: 'menu-label' }, [s.name]),
      el('span', { class: 'menu-count' }, [String(s.count)]),
    ]);
    main.addEventListener('click', () => {
      this.dropdown.close(true);
      if (!s.current) this.handlers.switchSet(s.id);
    });
    const rename = el('button', {
      type: 'button', class: 'menu-icon', role: 'menuitem', 'aria-label': t('sets.rename', { name: s.name }),
      title: t('sets.rename', { name: s.name }), 'data-rename': s.id,
    }, [svgIcon(ICON_PENCIL, 15)]);
    rename.addEventListener('click', () => {
      this.editing = s.id;
      this.confirming = null;
      this.rebuild();
      this.panel.querySelector<HTMLInputElement>('.menu-input')?.select();
      this.panel.querySelector<HTMLInputElement>('.menu-input')?.focus();
    });
    const del = el('button', {
      type: 'button', class: 'menu-icon', role: 'menuitem', 'aria-label': t('sets.delete', { name: s.name }),
      title: t('sets.delete', { name: s.name }), 'data-delete': s.id,
    }, [svgIcon(ICON_TRASH, 15)]);
    del.addEventListener('click', () => {
      this.confirming = s.id;
      this.editing = null;
      this.rebuild();
      this.dropdown.focusItem((x) => x.dataset.cancel === s.id);
    });
    return el('div', { class: 'menu-set', role: 'none' }, [main, rename, del]);
  }

  private renameRow(s: SetInfo): HTMLElement {
    const input = el('input', {
      type: 'text', class: 'menu-input', value: s.name, maxlength: SET_NAME_MAX,
      'aria-label': t('sets.rename', { name: s.name }), placeholder: t('sets.namePlaceholder'),
      autocomplete: 'off', spellcheck: 'false',
    });
    let done = false;
    const finish = (commit: boolean) => {
      if (done) return;
      done = true;
      if (commit) this.handlers.renameSet(s.id, input.value);
      this.editing = null;
      this.rebuild();
      this.dropdown.focusItem((x) => x.dataset.rename === s.id);
    };
    input.addEventListener('keydown', (e) => {
      // 中文输入法组字时的回车是选字
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
    return el('div', { class: 'menu-set menu-set--editing', role: 'none' }, [input]);
  }

  private confirmRow(s: SetInfo): HTMLElement {
    const cancel = el('button', { type: 'button', class: 'menu-confirm-btn', role: 'menuitem', 'data-cancel': s.id }, [
      t('sets.cancel'),
    ]);
    const ok = el('button', { type: 'button', class: 'menu-confirm-btn menu-confirm-btn--danger', role: 'menuitem' }, [
      t('sets.confirmDelete'),
    ]);
    cancel.addEventListener('click', () => {
      this.confirming = null;
      this.rebuild();
      this.dropdown.focusItem((x) => x.dataset.delete === s.id);
    });
    ok.addEventListener('click', () => {
      this.confirming = null;
      this.handlers.deleteSet(s.id);
      this.rebuild();
      this.dropdown.focusItem();
    });
    return el('div', { class: 'menu-confirm', role: 'none' }, [
      el('p', { class: 'menu-confirm-title' }, [t('sets.deleteConfirm', { name: s.name })]),
      el('p', { class: 'menu-confirm-hint' }, [t('sets.deleteHint')]),
      el('div', { class: 'menu-confirm-actions', role: 'none' }, [cancel, ok]),
    ]);
  }

  private importView(kind: ImportKind): HTMLElement[] {
    const title = t(kind === 'files' ? 'menu.importFilesTo' : 'menu.importFolderTo');
    const back = this.item(title, () => this.go('main', (x) => x.textContent === title), {
      icon: ICON_PREV,
      cls: 'menu-item--back',
    });
    back.setAttribute('aria-label', `${t('menu.back')}：${title}`);
    const pick = (target: 'new' | string) => () => {
      this.dropdown.close(true);
      this.handlers.importTo(kind, target);
    };
    const out: HTMLElement[] = [
      back,
      this.divider(),
      this.item(t('menu.toNewSet'), pick('new'), { icon: ICON_PLUS, cls: 'menu-item--new' }),
      this.caption('menu.toExisting'),
    ];
    for (const s of this.handlers.sets()) {
      const trail = el('span', { class: 'menu-trail' }, [
        ...(s.current ? [el('span', { class: 'menu-tag' }, [t('sets.current')])] : []),
        el('span', { class: 'menu-count' }, [String(s.count)]),
      ]);
      const b = this.item(s.name, pick(s.id), { trail });
      b.title = s.name;
      out.push(b);
    }
    return out;
  }

  private langRow(): HTMLElement {
    const row = el('div', { class: 'menu-langs', role: 'group', 'aria-label': t('menu.language') });
    for (const l of ['zh', 'en'] as Lang[]) {
      const on = lang() === l;
      const b = el('button', {
        type: 'button', class: `menu-lang${on ? ' is-selected' : ''}`, role: 'menuitemradio', 'aria-checked': String(on),
      }, [t(`lang.${l}` as MessageKey)]);
      b.addEventListener('click', () => {
        setLang(l);
        this.rebuild();
        this.dropdown.focusItem((x) => x.getAttribute('aria-checked') === 'true' && x.classList.contains('menu-lang'));
      });
      row.append(b);
    }
    return row;
  }
}
