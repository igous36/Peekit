// 界面语言：中文 / English。默认跟随系统，切换后记在 localStorage。
// 静态文案用 data-i18n* 属性标记，切换语言时 applyI18n() 统一刷新；每帧渲染的动态文案直接调用 t()。

export type Lang = 'zh' | 'en';

const zh = {
  'app.name': 'Peekit',
  'stage.aria': '画作舞台：左右拖动或方向键切换画作，向下拖动或下方向键拉远镜头查看同系列',
  'hint.browse': '⟷　按住左右拖动 · 浏览时间轴',
  'hint.zoom': '↓　按住向下拖动 · 拉远看同系列',
  'meter.near': '放大',
  'meter.far': '系列',
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
  'editor.new': '+ 新建系列',
  'editor.done': '完成',
  'pill.pagePrev': '上一页缩略图',
  'pill.pageNext': '下一页缩略图',
  'toast.workRemoved': '已从预览集移除「{title}」',
  'toast.seriesDeleted': '已删除系列「{name}」，{n} 幅归入未归类',
  'toast.seriesRemoved': '已删除系列「{name}」和其中 {n} 幅作品',
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
  // 2026-11-17：放大查看、全屏、时间轴月份、预览集
  'hint.magnify': '⤢　按住、向上拖动或滚轮上滑 · 放大',
  'fullscreen.hint': '双击或按 Esc 退出全屏',
  'window.exitFullscreen': '退出全屏',
  'timeline.prevTitle': '上一幅（右键：上个月）',
  'timeline.nextTitle': '下一幅（右键：下个月）',
  'timeline.scrub': '时间轴位置，可拖动',
  'timeline.scrubValue': '第 {i} 幅，共 {n} 幅：{title}',
  'sets.title': '预览集',
  'sets.defaultName': '我的作品',
  'sets.newName': '新预览集',
  'sets.switch': '切换预览集：{name}',
  'sets.new': '+ 新建预览集',
  'sets.count': '{n} 幅',
  'sets.current': '当前',
  'sets.rename': '重命名「{name}」',
  'sets.delete': '删除「{name}」',
  'sets.deleteConfirm': '删除「{name}」？',
  'sets.deleteHint': '只删除这个预览集，图片文件不会被删除。',
  'sets.cancel': '取消',
  'sets.confirmDelete': '删除',
  'sets.namePlaceholder': '预览集名称',
  'sets.created': '已新建预览集「{name}」',
  'sets.deleted': '已删除预览集「{name}」',
  'menu.importFilesTo': '导入文件到…',
  'menu.importFolderTo': '导入文件夹到…',
  'menu.back': '返回',
  'menu.toNewSet': '新建预览集',
  'menu.toExisting': '现有预览集',
  'menu.theme': '外观',
  'theme.light': '浅色',
  'theme.dark': '深色',
  'theme.system': '跟随系统',
  'about.menu': '关于 Peekit',
  'about.title': '关于 Peekit',
  'about.by': 'by {author}',
  'about.license': '基于 GPL-3.0 开源',
  'about.github': '访问 GitHub 仓库',
  'about.close': '关闭',
  'ctx.copyImage': '复制图像',
  'ctx.saveAs': '将图像另存为…',
  'ctx.reveal': '在资源管理器中显示',
  'ctx.removeWork': '从预览集移除',
  'ctx.deleteSeriesKeep': '删除系列，保留照片',
  'ctx.deleteSeriesAll': '删除系列和照片',
  'ctx.label': '「{name}」的操作',
  'ctx.renameSeries': '修改名称',
  'ctx.recolorSeries': '修改颜色',
  'rename.title': '修改系列名称',
  'color.title': '系列颜色',
  'color.hue': '色相',
  'color.sat': '浓淡',
  'color.light': '明暗',
  'color.hex': '色值',
  'color.presets': '常用色',
  'color.clay': '陶土',
  'color.mist': '雾蓝',
  'color.wisteria': '藤紫',
  'color.rose': '玫瑰',
  'color.mustard': '芥黄',
  'color.moss': '苔绿',
  'color.sage': '鼠尾草',
  'color.teal': '墨青',
  'color.slate': '岩蓝',
  'color.brick': '砖红',
  'color.blush': '烟粉',
  'color.stone': '暖灰',
  'pop.cancel': '取消',
  'pop.done': '完成',
  'toast.copied': '已复制图像',
  'toast.saved': '已另存为 {name}',
  'toast.actionFailed': '操作失败：{msg}',
  'toast.undo': '撤销',
  'toast.undone': '已撤销',
  'editor.seriesCaption': '所属系列',
  'editor.showAllSeries': '展开全部 {n} 个系列',
  'editor.collapseSeries': '收起系列',
};

export type MessageKey = keyof typeof zh;

const en: Record<MessageKey, string> = {
  'app.name': 'Peekit',
  'stage.aria': 'Artwork stage: drag sideways or use ←/→ to switch; drag down or press ↓ to zoom out and see the series',
  'hint.browse': '⟷　Drag sideways · browse the timeline',
  'hint.zoom': '↓　Drag down · see the whole series',
  'meter.near': 'Enlarge',
  'meter.far': 'Series',
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
  'editor.new': '+ New series',
  'editor.done': 'Done',
  'pill.pagePrev': 'Previous page of thumbnails',
  'pill.pageNext': 'Next page of thumbnails',
  'toast.workRemoved': 'Removed “{title}” from this collection',
  'toast.seriesDeleted': 'Deleted “{name}”; {n} moved to Unsorted',
  'toast.seriesRemoved': 'Deleted “{name}” and its works ({n})',
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
  'hint.magnify': '⤢　Hold, drag up or scroll up · enlarge',
  'fullscreen.hint': 'Double-click or press Esc to exit full screen',
  'window.exitFullscreen': 'Exit full screen',
  'timeline.prevTitle': 'Previous (right-click: previous month)',
  'timeline.nextTitle': 'Next (right-click: next month)',
  'timeline.scrub': 'Timeline position, draggable',
  'timeline.scrubValue': '{i} of {n}: {title}',
  'sets.title': 'Collections',
  'sets.defaultName': 'My works',
  'sets.newName': 'New collection',
  'sets.switch': 'Switch collection: {name}',
  'sets.new': '+ New collection',
  'sets.count': '{n}',
  'sets.current': 'current',
  'sets.rename': 'Rename “{name}”',
  'sets.delete': 'Delete “{name}”',
  'sets.deleteConfirm': 'Delete “{name}”?',
  'sets.deleteHint': 'Only the collection is removed. Your image files stay where they are.',
  'sets.cancel': 'Cancel',
  'sets.confirmDelete': 'Delete',
  'sets.namePlaceholder': 'Collection name',
  'sets.created': 'Created “{name}”',
  'sets.deleted': 'Deleted “{name}”',
  'menu.importFilesTo': 'Import files to…',
  'menu.importFolderTo': 'Import folder to…',
  'menu.back': 'Back',
  'menu.toNewSet': 'New collection',
  'menu.toExisting': 'Existing collections',
  'menu.theme': 'Appearance',
  'theme.light': 'Light',
  'theme.dark': 'Dark',
  'theme.system': 'System',
  'about.menu': 'About Peekit',
  'about.title': 'About Peekit',
  'about.by': 'by {author}',
  'about.license': 'Open source under GPL-3.0',
  'about.github': 'View on GitHub',
  'about.close': 'Close',
  'ctx.copyImage': 'Copy image',
  'ctx.saveAs': 'Save image as…',
  'ctx.reveal': 'Show in File Explorer',
  'ctx.removeWork': 'Remove from collection',
  'ctx.deleteSeriesKeep': 'Delete series, keep photos',
  'ctx.deleteSeriesAll': 'Delete series and photos',
  'ctx.label': 'Actions for “{name}”',
  'ctx.renameSeries': 'Rename',
  'ctx.recolorSeries': 'Change color',
  'rename.title': 'Rename series',
  'color.title': 'Series color',
  'color.hue': 'Hue',
  'color.sat': 'Tone',
  'color.light': 'Light',
  'color.hex': 'Hex',
  'color.presets': 'Presets',
  'color.clay': 'Clay',
  'color.mist': 'Mist',
  'color.wisteria': 'Wisteria',
  'color.rose': 'Rose',
  'color.mustard': 'Mustard',
  'color.moss': 'Moss',
  'color.sage': 'Sage',
  'color.teal': 'Teal',
  'color.slate': 'Slate',
  'color.brick': 'Brick',
  'color.blush': 'Blush',
  'color.stone': 'Stone',
  'pop.cancel': 'Cancel',
  'pop.done': 'Done',
  'toast.copied': 'Image copied',
  'toast.saved': 'Saved as {name}',
  'toast.actionFailed': 'Couldn’t do that: {msg}',
  'toast.undo': 'Undo',
  'toast.undone': 'Undone',
  'editor.seriesCaption': 'Series',
  'editor.showAllSeries': 'Show all {n} series',
  'editor.collapseSeries': 'Show fewer series',
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
