// 界面语言：中文 / English。默认跟随系统，切换后记在 localStorage。
// 静态文案用 data-i18n* 属性标记，切换语言时 applyI18n() 统一刷新；每帧渲染的动态文案直接调用 t()。

export type Lang = 'zh' | 'en';

const zh = {
  'app.name': 'Peekit',
  'stage.aria': '画作舞台：左右拖动或方向键切换画作，向下拖动或下方向键拉远镜头查看同系列',
  'hint.browse': '⟷　按住左右拖动 · 浏览时间轴',
  'hint.zoom': '↓　按住向下拖动 · 拉远看同系列',
  'meter.near': '近',
  'meter.far': '远',
  'info.aria': '作品信息',
  'info.edit': '编辑标题和系列',
  'info.sameSeries': '同系列 {n} 幅',
  'info.dragDown': '向下拖动查看全部',
  'date.unknown': '日期未知',
  'series.unassigned': '未归类',
  'series.unnamed': '未命名系列',
  'series.newName': '新系列 {n}',
  'pill.count': '{n} 幅',
  'pill.single': '这个系列只有这一幅',
  'editor.title': '作品标题',
  'editor.series': '系列标签',
  'editor.seriesPlaceholder': '输入系列名',
  'editor.pick': '「{title}」归入系列',
  'editor.new': '+ 新建系列',
  'editor.done': '完成',
  'timeline.aria': '时间轴',
  'timeline.prev': '上一幅',
  'timeline.next': '下一幅',
  'timeline.tick': '跳到 {title}，{date}',
  'card.current': '当前作品：{title}',
  'card.view': '查看 {title}',
  'card.broken': '无法打开这张图',
  'thumb.view': '查看 {title}（{date}）',
  'announce': '{title}，{date}，{series}',
  'window.group': '窗口',
  'window.minimize': '最小化',
  'window.maximize': '最大化',
  'window.restore': '还原',
  'window.close': '关闭',
  'menu.open': '菜单',
  'menu.importFiles': '导入文件…',
  'menu.importFolder': '导入文件夹…',
  'menu.language': '语言',
  'lang.zh': '中文',
  'lang.en': 'English',
  'empty.title': '把插画文件或文件夹拖到这里',
  'empty.or': '或',
  'empty.pickFiles': '选择文件',
  'empty.pickFolder': '选择文件夹',
  'empty.formats': '支持 PNG、JPG、WebP',
  'empty.loading': '正在读取作品…',
  'drop.release': '松开即可导入',
  'import.done': '已导入 {n} 幅',
  'import.none': '没有找到新的图片（支持 PNG、JPG、WebP）',
  'import.failed': '导入失败：{msg}',
  'import.desktopOnly': '导入只能在桌面版里用',
  'dialog.images': '图片',
};

export type MessageKey = keyof typeof zh;

const en: Record<MessageKey, string> = {
  'app.name': 'Peekit',
  'stage.aria': 'Artwork stage: drag sideways or use ←/→ to switch; drag down or press ↓ to zoom out and see the series',
  'hint.browse': '⟷　Drag sideways · browse the timeline',
  'hint.zoom': '↓　Drag down · see the whole series',
  'meter.near': 'Near',
  'meter.far': 'Far',
  'info.aria': 'Artwork info',
  'info.edit': 'Edit title and series',
  'info.sameSeries': '{n} in this series',
  'info.dragDown': 'Drag down to see all',
  'date.unknown': 'Unknown date',
  'series.unassigned': 'Unsorted',
  'series.unnamed': 'Untitled series',
  'series.newName': 'New series {n}',
  'pill.count': '{n}',
  'pill.single': 'The only work in this series',
  'editor.title': 'Title',
  'editor.series': 'Series',
  'editor.seriesPlaceholder': 'Series name',
  'editor.pick': 'Move “{title}” to',
  'editor.new': '+ New series',
  'editor.done': 'Done',
  'timeline.aria': 'Timeline',
  'timeline.prev': 'Previous',
  'timeline.next': 'Next',
  'timeline.tick': 'Go to {title}, {date}',
  'card.current': 'Current: {title}',
  'card.view': 'View {title}',
  'card.broken': 'Can’t open this image',
  'thumb.view': 'View {title} ({date})',
  'announce': '{title}, {date}, {series}',
  'window.group': 'Window',
  'window.minimize': 'Minimize',
  'window.maximize': 'Maximize',
  'window.restore': 'Restore',
  'window.close': 'Close',
  'menu.open': 'Menu',
  'menu.importFiles': 'Import files…',
  'menu.importFolder': 'Import folder…',
  'menu.language': 'Language',
  'lang.zh': '中文',
  'lang.en': 'English',
  'empty.title': 'Drop image files or folders here',
  'empty.or': 'or',
  'empty.pickFiles': 'Choose files',
  'empty.pickFolder': 'Choose folder',
  'empty.formats': 'PNG, JPG and WebP',
  'empty.loading': 'Loading your works…',
  'drop.release': 'Release to import',
  'import.done': 'Imported {n}',
  'import.none': 'No new images found (PNG, JPG, WebP)',
  'import.failed': 'Import failed: {msg}',
  'import.desktopOnly': 'Importing only works in the desktop app',
  'dialog.images': 'Images',
};

export const MESSAGES: Record<Lang, Record<MessageKey, string>> = { zh, en };

const LANG_KEY = 'peekit:lang';
let current: Lang = detect();
const listeners = new Set<(l: Lang) => void>();

function detect(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'zh' || saved === 'en') return saved;
  } catch {
    /* 读不到就跟随系统 */
  }
  const sys = typeof navigator !== 'undefined' ? navigator.language || '' : '';
  return sys.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export const lang = (): Lang => current;

/** 取文案；{name} 占位符用 params 替换 */
export function t(key: MessageKey, params?: Record<string, string | number>, l: Lang = current): string {
  let s = MESSAGES[l][key];
  if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

export function setLang(l: Lang): void {
  if (l === current) return;
  current = l;
  try {
    localStorage.setItem(LANG_KEY, l);
  } catch {
    /* 存不了就只在本次生效 */
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = l === 'zh' ? 'zh-CN' : 'en';
    applyI18n(document.body);
  }
  for (const fn of listeners) fn(l);
}

export function onLangChange(fn: (l: Lang) => void): void {
  listeners.add(fn);
}

/** 刷新 root 里所有带 data-i18n* 属性的静态文案 */
export function applyI18n(root: ParentNode): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n as MessageKey);
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-aria]')) {
    el.setAttribute('aria-label', t(el.dataset.i18nAria as MessageKey));
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
    el.title = t(el.dataset.i18nTitle as MessageKey);
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-placeholder]')) {
    el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder as MessageKey));
  }
}

/** 启动时调用一次：设置 <html lang> */
export function initI18n(): void {
  document.documentElement.lang = current === 'zh' ? 'zh-CN' : 'en';
}
