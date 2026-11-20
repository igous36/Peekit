// 左上角三道杠菜单（2026-11-17 重做）：
//
//   导入文件到…        ›      → 二级：+ 新建预览集 / 现有预览集列表
//   导入文件夹到…      ›      → 同上
//   ───────
//   预览集
//   ✓ 我的作品   128   ✎ 🗑   ← 点名字切换；✎ 原地改名；🗑 屏幕中央弹出确认框（只删预览集，不删图片）
//     旅行速写    36   ✎ 🗑
//   + 新建预览集
//   ───────
//   ⓘ 关于 Peekit                      ← 2026-11-17 新增
//
// 2026-11-18：
// - “查看 ›”放在“导入文件夹到…”下面，悬停或点击在右边弹出（级联子菜单，见 flyout.ts）：
//     颜色模式   (☀ ◐ ☾)      ← 三档拨动开关（theme-switch.ts），原来的“外观”三个按钮去掉
//     界面语言              ›  ← 再弹出一级：10 种语言，原来的“语言”两个按钮去掉
//     ───────
//     刷新                 F5  ← 重新扫描当前预览集导入过的文件夹 / 文件
// - 右键预览集：修改名称 / 创建副本 / 删除预览集（改名走原地输入框，删除走确认框）
//
// 2026-11-18：预览集下面是情绪板，格式和预览集一样：
//     情绪板
//     ✓ 灵感   12   ✎ 🗑      ← 点名字打开；✎ 原地改名；🗑 屏幕中央弹出确认框（只删情绪板，不删图片）
//     + 新建情绪板
//   右键情绪板：修改名称 / 创建副本 / 删除情绪板。两种列表共用 listRow
//
// 2026-11-20：
// - 最上面一行“搜索…  Ctrl K”，打开命令面板（palette.ts）
// - “查看 ›”里加了星级筛选（一行 5 颗星）、颜色筛选（11 个色块 + 任意颜色）
//   和画师自检三行（水平翻转 H / 灰度 G / 模糊 B，点了不关菜单）
// - 偏好设置加“显示 → 降低透明度”（transparency.ts）
// - 删除预览集 / 情绪板：原来在列表里原地展开一行确认，改成屏幕中央的确认框（confirm-dialog.ts），
//   只问“删除「xxx」？”，不再写“图片文件不会被删除”；菜单留在确认框后面，删完列表原地更新
//
// 面板内容在每次打开 / 切换视图 / 改名删除后重建（用户操作时，不在每帧）。
// 进出二级视图时有过渡（2026-11-17 新增）：旧内容滑出淡出、新内容从另一侧滑入，面板高度跟着过渡。
import { LANGS, lang, langLocalName, LANG_NATIVE, langTag, setLang, t, type MessageKey } from '../i18n';
import { setThemePref, themePref } from '../theme';
import { prefs, setPref, wheelCanToggleFullscreen, type Prefs } from '../prefs';
import { toggleReduceTransparency, transparencyReduced } from '../transparency';
import {
  el, svgIcon, ICON_BLUR, ICON_CALENDAR, ICON_CHECK, ICON_DOWNLOAD, ICON_FLIP, ICON_GRAY, ICON_INFO, ICON_NEXT, ICON_PENCIL, ICON_PLUS, ICON_PREV,
  ICON_SEARCH, ICON_SLIDERS, ICON_TRASH,
} from './dom';
import { percentOf, type UpdateState } from '../updater';
import { showsUpdateRow, updateRowLabel } from './update-labels';
import { Dropdown } from './dropdown';
import { Flyout } from './flyout';
import { ThemeSwitch } from './theme-switch';
import { menuPoint, type CtxItem } from './context-menu';
import { setContextItems, setRenameRow } from './set-rows';
import type { ConfirmOptions } from './confirm-dialog';
import { StarRow } from './stars';
import { CHECK_KEYS, CHECK_KINDS, type CheckKind } from '../engine/checks';
import { toggleRating } from '../engine/rating';
import { COLOR_FAMILIES, type ColorFilter } from '../engine/swatches';

const ICON_MENU = ['M4 7h16', 'M4 12h16', 'M4 17h16'];

/** 进出二级视图的过渡时长（ms），和 CSS 里的 menu-in / menu-out 一致 */
const VIEW_MS = 220;
/** 偏好设置的说明：悬停这么久才浮出来（快速划过不闪） */
const TIP_DELAY = 250;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

export interface SetInfo {
  id: string;
  name: string;
  count: number;
  current: boolean;
}

export type ImportKind = 'files' | 'folder';
/** 菜单面板现在显示哪一页：主视图、“导入到…”二级视图、偏好设置（2026-11-18） */
type MenuView = 'main' | ImportKind | 'prefs';

/** 预览集 / 情绪板列表一行能做的事（两种列表共用一套行，见 listRow） */
interface ListOps {
  open: (id: string) => void;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
  duplicate: (id: string) => string | null;
  /** 已经是当前的那一个：点了不用再打开（预览集）；情绪板每次都打开 */
  skipCurrent: boolean;
}

export interface MenuHandlers {
  sets: () => SetInfo[];
  /** target：'new' = 导入到新建预览集；否则是现有预览集的 id */
  importTo: (kind: ImportKind, target: 'new' | string) => void;
  switchSet: (id: string) => void;
  newSet: () => void;
  renameSet: (id: string, name: string) => void;
  deleteSet: (id: string) => void;
  /** 复制预览集，返回副本的 id（失败返回 null） */
  duplicateSet: (id: string) => string | null;
  /** 刷新：重新扫描当前预览集 */
  refresh: () => void;
  /** 弹出右键菜单（全局只有一个，由 app 持有） */
  contextMenu: (items: CtxItem[], x: number, y: number, label: string) => void;
  /** 打开“关于 Peekit” */
  about: () => void;
  /** 下载并安装新版本（菜单顶上的“更新到 x.y.z”） */
  installUpdate: () => void;
  /** 情绪板（2026-11-18）：列表（current = 正在看的那个）、打开、新建、改名、删除、复制 */
  boards: () => SetInfo[];
  openBoard: (id: string) => void;
  newBoard: () => void;
  renameBoard: (id: string, name: string) => void;
  deleteBoard: (id: string) => void;
  duplicateBoard: (id: string) => string | null;
  /** 星级筛选（2026-11-20）：现在只看几星以上（0 = 全部），以及改筛选线 */
  ratingFilter: () => number;
  setRatingFilter: (n: number) => void;
  /** 按颜色筛选（2026-11-20）：现在的颜色条件、改条件（null = 不按颜色）、弹系统取色框挑任意颜色 */
  colorFilter: () => ColorFilter | null;
  setColorFilter: (f: ColorFilter | null) => void;
  pickColor: () => void;
  /** 画师自检（2026-11-20）：翻转 / 灰度 / 模糊现在开没开，切换一项 */
  checks: () => Readonly<Record<CheckKind, boolean>>;
  toggleCheck: (k: CheckKind) => void;
  /** 打开命令面板（Ctrl+K，2026-11-20） */
  openPalette: () => void;
  /** 打开创作年历（2026-11-20） */
  openCalendar: () => void;
  /** 屏幕中央的确认框（2026-11-20，删除预览集 / 情绪板）：点了确认才调用 run */
  confirm: (opts: ConfirmOptions, run: () => void) => void;
}

export class AppMenu {
  readonly root: HTMLElement;
  private panel: HTMLElement;
  private dropdown: Dropdown;
  private view: MenuView = 'main';
  private editing: string | null = null;
  private viewFly: Flyout;
  private langFly: Flyout;
  private themeSwitch: ThemeSwitch;
  private filterStars: StarRow;
  /** 偏好设置说明的浮动标签（和子菜单一样挂在菜单根节点里，主面板会裁切） */
  private tip: HTMLElement;
  private button: HTMLButtonElement;
  /** 自动更新的状态（app 订阅 Updater 后传进来） */
  private update: UpdateState = { kind: 'idle' };

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
    this.button = button;
    this.panel = el('div', { id: 'app-menu', class: 'menu-panel', role: 'menu', 'data-i18n-aria': 'menu.open' });
    this.tip = el('div', { class: 'menu-panel menu-tip', 'aria-hidden': 'true' });
    this.root = el('div', { class: 'app-menu' }, [button, this.panel, this.tip]);
    this.dropdown = new Dropdown(this.root, button, this.panel, () => {
      this.view = 'main';
      this.editing = null;
      this.viewFly.close();
      this.rebuild();
    });
    this.themeSwitch = new ThemeSwitch((p) => setThemePref(p));
    // 星级筛选（2026-11-20）：点第 n 颗 = 只看 n 星以上，再点同一颗 = 显示全部
    this.filterStars = new StarRow({
      label: (n) => t('rating.filterAtLeast', { n }),
      onPick: (n) => {
        this.handlers.setRatingFilter(toggleRating(this.handlers.ratingFilter(), n));
        this.filterStars.set(this.handlers.ratingFilter());
      },
      size: 15,
      cls: 'menu-stars',
    });
    this.viewFly = new Flyout(this.root, () => this.viewItems(), () => t('menu.view'));
    // 语言列表按内容变宽（最宽 320px）：本族语名字永远完整显示，灰色副标签放不下才省略
    this.langFly = new Flyout(this.root, () => this.langItems(), () => t('view.language'), 'menu-flyout--lang');
    this.viewFly.child = this.langFly;
  }

  get isOpen(): boolean {
    return this.dropdown.isOpen;
  }

  close(): void {
    this.dropdown.close(false);
  }

  /** 菜单以外改了筛选线、自检开关（快捷键、状态标签、命令面板）：开着的“查看”子菜单跟着更新 */
  refresh(): void {
    this.filterStars.set(this.handlers.ratingFilter());
    if (this.isOpen) this.viewFly.refresh();
  }

  // ───────────── 构建面板 ─────────────

  private rebuild(): void {
    this.hideTip();
    const v = this.view;
    this.panel.replaceChildren(...(v === 'main' ? this.mainView() : v === 'prefs' ? this.prefsView() : this.importView(v)));
    // “查看”子菜单跟到新的那一项上（开着就刷新内容）；不在主视图就收起
    const anchor = this.panel.querySelector<HTMLElement>('[data-flyout="view"]');
    if (anchor) {
      this.viewFly.attach(anchor);
      this.viewFly.refresh();
    } else {
      this.viewFly.close();
    }
  }

  private go(view: MenuView, focus?: (el: HTMLElement) => boolean): void {
    // 进二级：旧内容往左滑出、新内容从右滑入；返回反过来
    this.slide(view === 'main' ? -1 : 1, () => {
      this.view = view;
      this.editing = null;
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
    const view = this.item(t('menu.view'), () => {}, { trail: chevron() });
    view.dataset.flyout = 'view';
    const out: HTMLElement[] = [];
    // 有新版本时，最上面一行“更新到 x.y.z”（2026-11-18 自动更新）
    const update = this.updateRow();
    if (update) out.push(update, this.divider());
    // 搜索（命令面板，2026-11-20）：作品、系列、预览集、情绪板和常用操作
    const search = this.item(t('palette.menu'), () => {
      this.dropdown.close(false);
      this.handlers.openPalette();
    }, { icon: ICON_SEARCH, trail: el('span', { class: 'menu-kbd' }, ['Ctrl K']) });
    out.push(
      search,
      this.divider(),
      this.item(t('menu.importFilesTo'), () => this.go('files'), { trail: chevron() }),
      this.item(t('menu.importFolderTo'), () => this.go('folder'), { trail: chevron() }),
      view,
      // 创作年历（2026-11-20）：整页
      this.item(t('calendar.title'), () => {
        this.dropdown.close(false);
        this.handlers.openCalendar();
      }, { icon: ICON_CALENDAR }),
      this.divider(),
      this.caption('sets.title'),
    );
    for (const s of this.handlers.sets()) out.push(this.listRow(s, this.setOps));
    out.push(
      this.item(t('sets.new').replace(/^\+\s*/, ''), () => {
        this.dropdown.close(true);
        this.handlers.newSet();
      }, { icon: ICON_PLUS, cls: 'menu-item--new' }),
      this.divider(),
      // 情绪板（2026-11-18）：和预览集同样的格式
      this.caption('board.menu'),
      ...this.handlers.boards().map((b) => this.listRow(b, this.boardOps)),
      this.item(t('board.new'), () => {
        this.dropdown.close(true);
        this.handlers.newBoard();
      }, { icon: ICON_PLUS, cls: 'menu-item--new' }),
      this.divider(),
      // 偏好设置（2026-11-18）：二级视图，和“导入到…”一样滑进去
      this.item(t('menu.prefs'), () => this.go('prefs', (x) => x.dataset.pref === 'wheelFlip'), {
        icon: ICON_SLIDERS,
        trail: el('span', { class: 'menu-trail' }, [svgIcon(ICON_NEXT, 14)]),
      }),
      this.item(t('about.menu'), () => {
        this.dropdown.close(false);
        this.handlers.about();
      }, { icon: ICON_INFO }),
    );
    return out;
  }

  // ───────────── 自动更新 ─────────────

  /** 自动更新的状态变了：≡ 按钮上的蓝点、读屏名字，菜单开着时原地更新那一行（下载进度） */
  setUpdate(s: UpdateState): void {
    const had = showsUpdateRow(this.update);
    this.update = s;
    const has = showsUpdateRow(s);
    const key: MessageKey = has ? 'menu.openUpdate' : 'menu.open';
    this.button.classList.toggle('has-update', has);
    this.button.dataset.i18nAria = key;
    this.button.dataset.i18nTitle = key;
    this.button.setAttribute('aria-label', t(key));
    this.button.title = t(key);
    const row = this.panel.querySelector<HTMLElement>('[data-update]');
    if (row && has) this.paintUpdateRow(row);
    else if (had !== has && this.isOpen && this.view === 'main' && !this.editing) this.rebuild();
  }

  private updateRow(): HTMLElement | null {
    if (!showsUpdateRow(this.update)) return null;
    const b = this.item('', () => {
      // 下载 / 安装中点了没反应（进度在底部提示条里）
      if (b.getAttribute('aria-disabled') === 'true') return;
      this.dropdown.close(true);
      this.handlers.installUpdate();
    }, {
      icon: ICON_DOWNLOAD,
      cls: 'menu-item--update',
      trail: el('span', { class: 'menu-trail' }, [el('span', { class: 'menu-update-dot', 'aria-hidden': 'true' })]),
    });
    b.dataset.update = '';
    this.paintUpdateRow(b);
    return b;
  }

  private paintUpdateRow(b: HTMLElement): void {
    const s = this.update;
    const busy = s.kind === 'downloading' || s.kind === 'installing';
    const label = b.querySelector('.menu-label');
    if (label) label.textContent = updateRowLabel(s);
    b.classList.toggle('is-busy', busy);
    b.classList.toggle('is-failed', s.kind === 'failed');
    b.setAttribute('aria-disabled', String(busy));
    // 下载进度画在这一行底部（细线）
    const p = s.kind === 'downloading' ? percentOf(s.got, s.total) : s.kind === 'installing' ? 100 : null;
    b.style.setProperty('--update-p', p === null ? '0' : String(p / 100));
    if (s.kind === 'failed') b.title = s.msg;
    else b.removeAttribute('title');
  }

  // ───────────── 查看（级联子菜单） ─────────────

  /** 查看：颜色模式开关、界面语言 ›、刷新 */
  private viewItems(): HTMLElement[] {
    this.themeSwitch.set(themePref());
    this.themeSwitch.relabel();
    const scheme = el('div', { class: 'menu-switch-row', role: 'none' }, [
      el('span', { class: 'menu-label', 'aria-hidden': 'true' }, [t('view.colorScheme')]),
      this.themeSwitch.root,
    ]);
    const language = this.item(t('view.language'), () => {}, {
      trail: el('span', { class: 'menu-trail' }, [svgIcon(ICON_NEXT, 14)]),
    });
    language.dataset.flyout = 'lang';
    this.langFly.attach(language);
    const refresh = this.item(t('view.refresh'), () => {
      this.dropdown.close(true);
      this.handlers.refresh();
    }, { trail: el('span', { class: 'menu-kbd' }, ['F5']) });
    // 星级筛选（2026-11-20）：一行文字 + 5 颗星，当前筛选线以内的星亮着
    this.filterStars.set(this.handlers.ratingFilter());
    const filter = el('div', { class: 'menu-switch-row menu-stars-row', role: 'none' }, [
      el('span', { class: 'menu-label', 'aria-hidden': 'true' }, [t('rating.filterMenu')]),
      this.filterStars.root,
    ]);
    // 画师自检（2026-11-20）：翻转 / 灰度 / 模糊，点了不关菜单，原地打勾
    const icons: Record<CheckKind, string[]> = { flip: ICON_FLIP, gray: ICON_GRAY, blur: ICON_BLUR };
    const state = this.handlers.checks();
    const checks = CHECK_KINDS.map((k) => {
      const b = this.item(t(`check.${k}`), () => {
        this.handlers.toggleCheck(k);
        this.viewFly.refresh();
        this.viewFly.items().find((x) => x.dataset.check === k)?.focus({ preventScroll: true });
      }, {
        icon: icons[k],
        trail: el('span', { class: 'menu-trail' }, [
          ...(state[k] ? [svgIcon(ICON_CHECK, 15)] : []),
          el('span', { class: 'menu-kbd' }, [CHECK_KEYS[k]]),
        ]),
        role: 'menuitemcheckbox',
      });
      b.setAttribute('aria-checked', String(state[k]));
      b.dataset.check = k;
      return b;
    });
    return [scheme, language, this.divider(), filter, this.colorRow(), ...checks, this.divider(), refresh];
  }

  /**
   * 颜色筛选（2026-11-20）：一行文字，下面 11 个色块（红橙黄绿青蓝紫粉 + 黑白灰）和一个“任意颜色”。
   * 点色块 = 只看有这个颜色的作品，再点同一个 = 不按颜色筛；点“任意颜色”弹系统取色框（带吸管）
   */
  private colorRow(): HTMLElement {
    const cur = this.handlers.colorFilter();
    const swatch = (label: string, on: boolean, fill: string, act: () => void, cls = '') => {
      const b = el('button', {
        type: 'button', class: `color-dot ${cls}`.trim(), role: 'menuitemradio', 'aria-checked': String(on),
        'aria-label': label, title: label,
      }, [el('span', { class: 'color-dot-fill' })]);
      (b.firstElementChild as HTMLElement).style.background = fill;
      b.addEventListener('click', act);
      return b;
    };
    const dots = COLOR_FAMILIES.map((f) => {
      const on = cur?.kind === 'family' && cur.family === f.key;
      return swatch(t(`colorf.${f.key}`), on, f.hex, () => {
        this.handlers.setColorFilter(on ? null : { kind: 'family', family: f.key });
      });
    });
    const custom = cur?.kind === 'hex' ? cur.hex : null;
    dots.push(swatch(custom ? `${t('color.pickAny')} ${custom}` : t('color.pickAny'), !!custom,
      custom ?? 'conic-gradient(from 90deg, #E85A4F, #EBC53A, #5BAA55, #3FB2B8, #3E7BD6, #8B5FD0, #E275AE, #E85A4F)',
      () => this.handlers.pickColor(), 'color-dot--any'));
    return el('div', { class: 'menu-colors', role: 'none' }, [
      el('span', { class: 'menu-label menu-colors-label', 'aria-hidden': 'true' }, [t('color.filterMenu')]),
      el('div', { class: 'menu-colors-grid', role: 'group', 'aria-label': t('color.filterMenu') }, dots),
    ]);
  }

  /** 界面语言：本族语名字 + 当前界面语言里的名字（灰色），当前语言打勾 */
  private langItems(): HTMLElement[] {
    return LANGS.map((l) => {
      const on = lang() === l;
      const native = LANG_NATIVE[l];
      const local = langLocalName(l);
      const label = el('span', { class: 'menu-label', lang: langTag(l) }, [native]);
      const extra = local && local !== native ? local : '';
      const b = el('button', {
        type: 'button', class: 'menu-item menu-item--lang', role: 'menuitemradio', 'aria-checked': String(on), 'data-lang': l,
        // 灰色副标签可能被省略：悬停显示完整的
        title: extra ? `${native} — ${extra}` : native,
      }, [
        el('span', { class: 'menu-lead' }, on ? [svgIcon(ICON_CHECK, 16)] : []),
        label,
        ...(extra ? [el('span', { class: 'menu-trail' }, [el('span', { class: 'menu-trail-text' }, [extra])])] : []),
      ]);
      b.addEventListener('click', () => {
        if (lang() === l) return;
        setLang(l);
        // 换了语言：主面板、查看、语言列表都按新语言重建（保持打开，焦点放在刚选的语言上）
        this.rebuild();
        this.langFly.items().find((x) => x.dataset.lang === l)?.focus({ preventScroll: true });
      });
      return b;
    });
  }

  // ───────────── 预览集 ─────────────

  /** 右键预览集：修改名称 / 创建副本 / 删除预览集 */
  private setOps: ListOps = {
    open: (id) => this.handlers.switchSet(id),
    rename: (id, name) => this.handlers.renameSet(id, name),
    remove: (id) => this.handlers.deleteSet(id),
    duplicate: (id) => this.handlers.duplicateSet(id),
    skipCurrent: true,
  };

  private boardOps: ListOps = {
    open: (id) => this.handlers.openBoard(id),
    rename: (id, name) => this.handlers.renameBoard(id, name),
    remove: (id) => this.handlers.deleteBoard(id),
    duplicate: (id) => this.handlers.duplicateBoard(id),
    skipCurrent: false,
  };

  private listMenu(s: SetInfo, ops: ListOps, e: MouseEvent, target: HTMLElement): void {
    e.preventDefault();
    e.stopPropagation();
    const { x, y } = menuPoint(e, target);
    const items = setContextItems(s, {
      rename: () => this.beginRename(s.id),
      duplicate: () => {
        const id = ops.duplicate(s.id);
        this.rebuild();
        this.dropdown.focusItem((x) => x.dataset.set === id);
      },
      remove: () => this.beginDelete(s, ops),
    }, ops === this.boardOps ? t('board.delete') : undefined);
    this.handlers.contextMenu(items, x, y, t('ctx.label', { name: s.name }));
  }

  /** 原地改名（输入框） */
  private beginRename(id: string): void {
    this.editing = id;
    this.rebuild();
    const input = this.panel.querySelector<HTMLInputElement>('.menu-input');
    input?.focus();
    input?.select();
  }

  /**
   * 删除（2026-11-20 改）：屏幕中央弹出确认框“删除「xxx」？”，菜单留在后面。
   * 取消：焦点回到原来那个 🗑；删除：列表原地更新，焦点放到第一项
   */
  private beginDelete(s: SetInfo, ops: ListOps): void {
    const title = t(ops === this.boardOps ? 'board.deleteConfirm' : 'sets.deleteConfirm', { name: s.name });
    this.handlers.confirm({ title }, () => {
      ops.remove(s.id);
      if (!this.isOpen) return;
      this.rebuild();
      this.dropdown.focusItem();
    });
  }

  /** 列表里的一行：预览集和情绪板共用（点名字打开 / 切换，✎ 原地改名，🗑 弹出确认框，右键菜单） */
  private listRow(s: SetInfo, ops: ListOps): HTMLElement {
    if (this.editing === s.id) {
      return setRenameRow(s, (commit, value) => {
        if (commit) ops.rename(s.id, value);
        this.editing = null;
        this.rebuild();
        this.dropdown.focusItem((x) => x.dataset.rename === s.id);
      });
    }
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
      if (!s.current || !ops.skipCurrent) ops.open(s.id);
    });
    const rename = el('button', {
      type: 'button', class: 'menu-icon', role: 'menuitem', 'aria-label': t('sets.rename', { name: s.name }),
      title: t('sets.rename', { name: s.name }), 'data-rename': s.id,
    }, [svgIcon(ICON_PENCIL, 15)]);
    rename.addEventListener('click', () => this.beginRename(s.id));
    const del = el('button', {
      type: 'button', class: 'menu-icon', role: 'menuitem', 'aria-label': t('sets.delete', { name: s.name }),
      title: t('sets.delete', { name: s.name }), 'data-delete': s.id,
    }, [svgIcon(ICON_TRASH, 15)]);
    del.addEventListener('click', () => this.beginDelete(s, ops));
    const row = el('div', { class: 'menu-set', role: 'none' }, [main, rename, del]);
    // 右键（或菜单键 / Shift+F10）整行都可以
    row.addEventListener('contextmenu', (e) => this.listMenu(s, ops, e, main));
    return row;
  }

  // ───────────── 偏好设置（2026-11-18） ─────────────
  //
  //   ‹ 偏好设置
  //   ───────
  //   鼠标滚轮
  //   滚轮切换照片                 ( ○)   ← 打开：往下滚下一张、往上滚上一张；关闭（默认）：滚轮推拉镜头。全屏时始终是缩放
  //   上下滚动切换上一张 / 下一张…
  //   滚轮进入 / 退出全屏           (● )   ← 上面打开时显示成关、变灰；上面关掉后恢复成原来设的值（单独存，见 prefs.ts）
  //   放大时继续上滑进入全屏…

  private prefsView(): HTMLElement[] {
    const title = t('menu.prefs');
    const back = this.item(title, () => this.go('main', (x) => x.textContent === title), {
      icon: ICON_PREV,
      cls: 'menu-item--back',
    });
    back.setAttribute('aria-label', `${t('menu.back')}：${title}`);
    const flip = this.prefRow('wheelFlip', t('prefs.wheelFlip'), () => setPref('wheelFlip', !prefs().wheelFlip));
    const fs = this.prefRow('wheelFullscreen', t('prefs.wheelFullscreen'), () =>
      setPref('wheelFullscreen', !prefs().wheelFullscreen),
    );
    // 自动检查更新（2026-11-18）：只查不下载，关掉后还能在“关于”里手动检查
    const auto = this.prefRow('autoUpdate', t('prefs.autoUpdate'), () => setPref('autoUpdate', !prefs().autoUpdate));
    // 降低透明度（2026-11-20）：默认跟随系统，拨过一次就按这里的
    const glass = this.prefRow('reduceTransparency', t('prefs.reduceTransparency'), () => toggleReduceTransparency());
    const rows = [
      back, this.divider(), this.caption('prefs.wheel'), flip, fs,
      this.divider(), this.caption('prefs.display'), glass,
      this.divider(), this.caption('prefs.update'), auto,
    ];
    this.syncPrefs(rows);
    return rows;
  }

  /** 一行偏好：整行是按钮（点哪里都切换），左边名字 + 说明，右边开关 */
  private prefRow(key: keyof Prefs, label: string, toggle: () => void): HTMLButtonElement {
    const b = el('button', { type: 'button', class: 'menu-item menu-pref', role: 'menuitemcheckbox', 'data-pref': key }, [
      el('span', { class: 'menu-pref-text' }, [
        el('span', { class: 'menu-pref-label' }, [label]),
        el('span', { class: 'menu-pref-hint' }),
      ]),
      el('span', { class: 'toggle', 'aria-hidden': 'true' }, [el('span', { class: 'toggle-knob' })]),
    ]);
    b.addEventListener('click', () => {
      // 变灰的项（滚轮切换照片时的“滚轮进入 / 退出全屏”）点了没反应；不用 disabled 属性，是为了悬停时还能显示说明
      if (b.getAttribute('aria-disabled') === 'true') return;
      toggle();
      // 原地更新（不重建），开关带动画滑过去；下面那一项跟着变灰 / 恢复
      this.syncPrefs([...this.panel.querySelectorAll<HTMLElement>('.menu-pref')]);
      if (this.tipFor) this.showTip(this.tipFor, true);
    });
    // 说明文字（2026-11-18 改）：不常驻，悬停 / 键盘聚焦在这一行时，在菜单右边浮出一个小标签
    b.addEventListener('pointerenter', () => this.showTip(b));
    b.addEventListener('pointerleave', () => this.hideTip(b));
    b.addEventListener('focus', () => {
      if (b.matches(':focus-visible')) this.showTip(b, true);
    });
    b.addEventListener('blur', () => this.hideTip(b));
    return b;
  }

  // ───────────── 偏好说明的浮动标签 ─────────────

  private tipTimer = 0;
  /** 现在显示的是哪一行的说明 */
  private tipFor: HTMLElement | null = null;

  /** 停 TIP_DELAY 后（now = 立刻）在菜单面板右边、和这一行对齐的地方显示说明 */
  private showTip(row: HTMLElement, now = false): void {
    window.clearTimeout(this.tipTimer);
    const show = () => {
      if (!row.isConnected) return;
      const text = row.querySelector('.menu-pref-hint')?.textContent ?? '';
      if (!text) return;
      this.tip.textContent = text;
      const hr = this.root.getBoundingClientRect();
      const pr = this.panel.getBoundingClientRect();
      const rr = row.getBoundingClientRect();
      this.tip.style.left = `${Math.round(pr.right + 8 - hr.left)}px`;
      this.tip.style.top = `${Math.round(rr.top + rr.height / 2 - hr.top)}px`;
      this.tip.classList.add('is-shown');
      this.tipFor = row;
    };
    if (now || this.tip.classList.contains('is-shown')) show();
    else this.tipTimer = window.setTimeout(show, TIP_DELAY);
  }

  private hideTip(row?: HTMLElement): void {
    if (row && this.tipFor && row !== this.tipFor && this.tip.classList.contains('is-shown')) return;
    window.clearTimeout(this.tipTimer);
    this.tip.classList.remove('is-shown');
    this.tipFor = null;
  }

  /** 按当前偏好更新几行开关的状态、说明文字、能不能点 */
  private syncPrefs(rows: HTMLElement[]): void {
    const p = prefs();
    const state: Record<keyof Prefs, { on: boolean; disabled: boolean; hint: string }> = {
      wheelFlip: { on: p.wheelFlip, disabled: false, hint: t('prefs.wheelFlipHint') },
      // 滚轮切换照片时：显示成关、变灰（存的值不动，关掉切换照片后恢复）
      wheelFullscreen: {
        on: wheelCanToggleFullscreen(p),
        disabled: p.wheelFlip,
        hint: t(p.wheelFlip ? 'prefs.wheelFullscreenOff' : 'prefs.wheelFullscreenHint'),
      },
      autoUpdate: { on: p.autoUpdate, disabled: false, hint: t('prefs.autoUpdateHint') },
      reduceTransparency: {
        on: transparencyReduced(),
        disabled: false,
        hint: t('prefs.reduceTransparencyHint') + (p.reduceTransparency === null ? t('prefs.followingSystem') : ''),
      },
    };
    for (const row of rows) {
      const key = row.dataset.pref as keyof Prefs | undefined;
      if (!key || !(key in state)) continue;
      const s = state[key];
      row.setAttribute('aria-checked', String(s.on));
      row.querySelector('.toggle')?.classList.toggle('is-on', s.on);
      row.classList.toggle('is-disabled', s.disabled);
      row.setAttribute('aria-disabled', String(s.disabled));
      const hint = row.querySelector('.menu-pref-hint');
      if (hint) hint.textContent = s.hint;
    }
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

}
