// 界面语言。默认跟随系统，切换后记在 localStorage。
// 静态文案用 data-i18n* 属性标记，切换语言时 applyI18n() 统一刷新；每帧渲染的动态文案直接调用 t()。
//
// 2026-11-18：从中文 / English 扩到 12 种——联合国工作语言（中、英、法、俄、西、阿）加德、意、韩、葡，再加日语、繁体中文。
// 中文、英文在这个文件里（中文是基准，键以它为准）；其余在 locales/ 下，每种一个文件。
// 阿拉伯语只翻译文字，界面布局不做从右到左的镜像（时间轴、卡片的左右有方向含义）。

import { ar } from './locales/ar';
import { de } from './locales/de';
import { es } from './locales/es';
import { fr } from './locales/fr';
import { it } from './locales/it';
import { ko } from './locales/ko';
import { pt } from './locales/pt';
import { ru } from './locales/ru';
import { ja } from './locales/ja';
import { zhTW } from './locales/zh-TW';

/** zh = 简体中文，zh-TW = 繁体中文 */
export type Lang = 'zh' | 'zh-TW' | 'en' | 'ar' | 'de' | 'es' | 'fr' | 'it' | 'ja' | 'ko' | 'pt' | 'ru';

const zh = {
  'app.name': 'Peekit',
  'stage.aria': '画作舞台：左右拖动或方向键切换画作，向下拖动或下方向键拉远镜头查看同系列',
  'hint.browse': '⟷　按住左右拖动 · 浏览时间轴',
  'hint.zoom': '↓　按住向下拖动 · 拉远看同系列',
  'meter.near': '放大',
  'meter.far': '系列',
  'info.aria': '作品信息',
  'info.edit': '编辑标题和系列',
  'info.seriesPos': '系列中第 {i} 幅，共 {n} 幅',
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
  'editor.cancel': '取消',
  'pill.pagePrev': '上一页缩略图',
  'pill.pageNext': '下一页缩略图',
  'toast.workRemoved': '已从预览集移除「{title}」',
  'toast.seriesDeleted': '已删除系列「{name}」，{n} 幅归入未归类',
  'toast.seriesRemoved': '已删除系列「{name}」和其中 {n} 幅作品',
  'timeline.aria': '时间轴',
  'timeline.prev': '上一幅',
  'timeline.next': '下一幅',
  'timeline.tick': '跳到 {title}，{date}',
  'timeline.tickRange': '跳到 {from} – {to}（{n} 幅）',
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
  'empty.title': '把插画文件或文件夹拖到这里',
  'empty.or': '或',
  'empty.pickFiles': '选择文件',
  'empty.pickFolder': '选择文件夹',
  'empty.formats': '支持 PNG、JPG、WebP、GIF、BMP、TIFF、SVG 和相机 RAW',
  'empty.loading': '正在读取作品…',
  'drop.release': '松开即可导入',
  'import.done': '已导入 {n} 幅',
  'import.none': '没有找到新的图片（支持 PNG、JPG、WebP）',
  'import.failed': '导入失败：{msg}',
  'import.desktopOnly': '导入只能在桌面版里用',
  'dialog.images': '图片',
  // 2026-11-17：放大查看、全屏、时间轴月份、预览集
  'hint.magnify': '⤢　向上拖动或滚轮上滑 · 放大',
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
  'sets.current': '当前',
  'sets.rename': '重命名「{name}」',
  'sets.delete': '删除「{name}」',
  'sets.deleteConfirm': '删除「{name}」？',
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
  'ctx.saveRawAs': '将 RAW 原片另存为…',
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
  'color.presets': '预设',
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
  'toast.copying': '正在准备图像…',
  'toast.saved': '已另存为 {name}',
  'toast.actionFailed': '操作失败：{msg}',
  'toast.undo': '撤销',
  'toast.undone': '已撤销',
  'editor.seriesCaption': '所属系列',
  'editor.showAllSeries': '展开全部 {n} 个系列',
  'editor.collapseSeries': '收起系列',
  // 2026-11-18：查看菜单、刷新、右键预览集
  'menu.view': '查看',
  'view.colorScheme': '颜色模式',
  'view.language': '界面语言',
  'view.refresh': '刷新',
  'refresh.running': '正在刷新…',
  'refresh.done': '已刷新：新增 {added} 幅，移除 {removed} 幅',
  'refresh.none': '已刷新，没有变化',
  'refresh.desktopOnly': '刷新只能在桌面版里用',
  'ctx.renameSet': '修改名称',
  'ctx.duplicateSet': '创建副本',
  'ctx.deleteSet': '删除预览集',
  'sets.copyName': '{name} 副本',
  'sets.duplicated': '已创建副本「{name}」',
  // 2026-11-18：左上角计数（圆环 / 文字）
  'counter.label': '第 {i} 幅，共 {n} 幅',
  'counter.toText': '点击显示为数字',
  'counter.toRing': '点击显示为圆环',
  'menu.prefs': '偏好设置',
  'prefs.wheel': '鼠标滚轮',
  'prefs.wheelFlip': '滚轮切换照片',
  'prefs.wheelFlipHint': '上下滚动切换上一张 / 下一张；关闭时用来放大缩小。全屏时始终用来缩放',
  'prefs.wheelFullscreen': '滚轮进入 / 退出全屏',
  'prefs.wheelFullscreenHint': '放大时继续上滑进入全屏，全屏时继续下滑退出',
  'prefs.wheelFullscreenOff': '滚轮切换照片时不可用',
  'menu.openUpdate': '菜单（有新版本）',
  'update.menu': '更新到 {version}',
  'update.downloading': '正在下载更新… {p}%',
  'update.downloadingPlain': '正在下载更新…',
  'update.installing': '正在安装更新…',
  'update.restarting': '正在安装更新，装好后 Peekit 会自动重新打开',
  'update.failed': '更新失败：{msg}',
  'update.retry': '重试',
  'update.menuFailed': '更新失败，点击重试',
  'update.toast': 'Peekit {version} 已发布',
  'update.now': '更新',
  'update.check': '检查更新',
  'update.checking': '正在检查更新…',
  'update.latest': '已是最新版本',
  'update.available': '有新版本 {version}',
  'update.checkFailed': '检查更新失败',
  'prefs.update': '更新',
  'prefs.autoUpdate': '自动检查更新',
  'prefs.autoUpdateHint': '启动时向 GitHub 查询有没有新版本，有的话在菜单里提示；不会自动下载',
  // 情绪板（2026-11-18）
  'hint.lift': '⧉　长按画作 · 拖进情绪板',
  'board.menu': '情绪板',
  'board.new': '新建情绪板',
  'board.addExisting': '加入现有情绪板',
  'board.quickNew': '新建',
  'board.defaultName': '情绪板',
  'board.deleteConfirm': '删除「{name}」？',
  'board.delete': '删除情绪板',
  'board.created': '已新建「{name}」',
  'board.deleted': '已删除「{name}」',
  'board.duplicated': '已创建副本「{name}」',
  'board.added': '已加入「{name}」',
  'board.alreadyIn': '「{name}」里已经有这张了',
  'board.open': '打开',
  'board.nameTitle': '给新情绪板起个名字',
  'board.renameTitle': '修改情绪板名称',
  'board.noneYet': '还没有情绪板，先拖到空格子里新建一个',
  'board.chooseTitle': '加入情绪板',
  'board.back': '返回预览',
  'board.backShort': '预览',
  'board.renameHint': '点击修改名称',
  'board.count': '{n} 张',
  'board.fit': '显示全部',
  'board.emptyTitle': '这个情绪板还是空的',
  'board.emptyHint': '把图片拖进窗口，或者回到预览，长按一幅画拖进来',
  'board.aria': '情绪板画布',
  'board.removed': '已从情绪板移除 {n} 张',
  'board.selected': '已选 {n} 张',
  'board.optimizeSel': '优化所选（{n} 张）',
  'board.optimizeGroup': '优化这个集合（{n} 张）',
  'board.optimizeAll': '一键全局优化',
  'board.removeSel': '移除所选（{n} 张）',
  'board.detach': '从集合中分离',
  'board.focus': '放大查看',
  'board.remove': '从情绪板移除',
  'board.addImages': '添加图片…',
  'board.rename': '修改名称',
  'board.addedN': '已加入 {n} 张',
  'board.already': '这些图片已经在情绪板里了',
  'board.openWhich': '打开哪个情绪板',
  'board.addedSeries': '已把「{series}」的 {n} 张加入「{name}」',
  'board.allAlreadyIn': '这个系列已经都在「{name}」里了',
  'board.pickHint': '点一个格子，把这幅加进情绪板',
  'board.dragSeries': '拖出去：把整个系列加进情绪板',
  'board.mergeSel': '合成一个新集合（{n} 张）',
  // 2026-11-20：星级、画师自检、命令面板、降低透明度
  'rating.set': '评为 {n} 星（按 {n}）',
  'rating.toast': '已评为 {stars}',
  'rating.cleared': '已清除星级',
  'rating.none': '还没有 {n} 星以上的作品',
  'rating.filtered': '只看 {n} 星以上：{count} 幅',
  'rating.showAll': '显示全部作品',
  'rating.clearFilter': '正在只看 {n} 星以上，点击显示全部',
  'rating.filterAtLeast': '只看 {n} 星以上',
  'rating.filterMenu': '星级筛选',
  'check.flip': '水平翻转',
  'check.gray': '灰度',
  'check.blur': '模糊',
  'check.bar': '画师自检',
  'check.withKey': '{name}（{key}）',
  'check.toastOn': '{name}已打开，再按 {key} 关闭',
  'check.toastOff': '{name}已关闭',
  'check.allOff': '已关闭画师自检',
  'check.clearAll': '{names}开着，点击全部关闭',
  'list.sep': '、',
  'palette.menu': '搜索…',
  'palette.placeholder': '搜索作品、系列、预览集、情绪板或操作',
  'palette.none': '没有找到',
  'palette.kindAction': '操作',
  'palette.kindWork': '作品',
  'palette.kindSeries': '系列',
  'palette.kindSet': '预览集',
  'palette.kindBoard': '情绪板',
  'palette.importFiles': '导入文件…',
  'palette.importFolder': '导入文件夹…',
  'palette.on': '开启',
  'palette.off': '关闭',
  'palette.first': '跳到最早的一幅',
  'palette.latest': '跳到最新的一幅',
  'palette.fullscreen': '进入 / 退出全屏',
  'palette.reduceTransparency': '降低透明度',
  'palette.theme': '颜色模式：{mode}',
  'prefs.display': '显示',
  'prefs.reduceTransparency': '降低透明度',
  'prefs.reduceTransparencyHint': '全屏缩放倍率、情绪板拖起时的背景和拖放提示改用实色底；舞台的磨砂玻璃不变',
  'prefs.followingSystem': '。没手动改过时跟随系统的透明效果设置',
  'filter.none': '没有同时符合这些条件的作品',
  'filter.noneShowAll': '这里没有符合筛选条件的作品，已显示全部',
  'filter.showAll': '已显示全部作品',
  'color.showAll': '不再按颜色筛选',
  'color.analyzing': '正在分析作品颜色… {done} / {total}',
  'color.none': '没有带{name}的作品',
  'color.filtered': '只看带{name}的作品：{count} 幅',
  'color.clearFilter': '正在只看带{name}的作品，点击不再按颜色筛选',
  'color.filterMenu': '颜色筛选',
  'color.pickAny': '任意颜色…',
  'color.filterFamily': '只看带{name}的作品',
  'colorf.red': '红色',
  'colorf.orange': '橙色',
  'colorf.yellow': '黄色',
  'colorf.green': '绿色',
  'colorf.cyan': '青色',
  'colorf.blue': '蓝色',
  'colorf.purple': '紫色',
  'colorf.pink': '粉色',
  'colorf.black': '黑色',
  'colorf.white': '白色',
  'colorf.gray': '灰色',
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
  'info.seriesPos': '{i} of {n} in this series',
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
  'editor.cancel': 'Cancel',
  'pill.pagePrev': 'Previous page of thumbnails',
  'pill.pageNext': 'Next page of thumbnails',
  'toast.workRemoved': 'Removed “{title}” from this collection',
  'toast.seriesDeleted': 'Deleted “{name}”; {n} moved to Unsorted',
  'toast.seriesRemoved': 'Deleted “{name}” and its works ({n})',
  'timeline.aria': 'Timeline',
  'timeline.prev': 'Previous',
  'timeline.next': 'Next',
  'timeline.tick': 'Go to {title}, {date}',
  'timeline.tickRange': 'Go to {from} – {to} ({n} works)',
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
  'empty.title': 'Drop image files or folders here',
  'empty.or': 'or',
  'empty.pickFiles': 'Choose files',
  'empty.pickFolder': 'Choose folder',
  'empty.formats': 'PNG, JPG, WebP, GIF, BMP, TIFF, SVG and camera RAW',
  'empty.loading': 'Loading your works…',
  'drop.release': 'Release to import',
  'import.done': 'Imported {n}',
  'import.none': 'No new images found (PNG, JPG, WebP)',
  'import.failed': 'Import failed: {msg}',
  'import.desktopOnly': 'Importing only works in the desktop app',
  'dialog.images': 'Images',
  'hint.magnify': '⤢　Drag up or scroll up · enlarge',
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
  'sets.current': 'current',
  'sets.rename': 'Rename “{name}”',
  'sets.delete': 'Delete “{name}”',
  'sets.deleteConfirm': 'Delete “{name}”?',
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
  'ctx.saveRawAs': 'Save RAW original as…',
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
  'toast.copying': 'Preparing image…',
  'toast.saved': 'Saved as {name}',
  'toast.actionFailed': 'Couldn’t do that: {msg}',
  'toast.undo': 'Undo',
  'toast.undone': 'Undone',
  'editor.seriesCaption': 'Series',
  'editor.showAllSeries': 'Show all {n} series',
  'editor.collapseSeries': 'Show fewer series',
  'menu.view': 'View',
  'view.colorScheme': 'Color scheme',
  'view.language': 'Interface language',
  'view.refresh': 'Refresh',
  'refresh.running': 'Refreshing…',
  'refresh.done': 'Refreshed: {added} added, {removed} removed',
  'refresh.none': 'Refreshed — no changes',
  'refresh.desktopOnly': 'Refreshing only works in the desktop app',
  'ctx.renameSet': 'Rename',
  'ctx.duplicateSet': 'Duplicate',
  'ctx.deleteSet': 'Delete collection',
  'sets.copyName': '{name} copy',
  'sets.duplicated': 'Created “{name}”',
  'counter.label': '{i} of {n}',
  'counter.toText': 'Click to show as numbers',
  'counter.toRing': 'Click to show as a ring',
  'menu.prefs': 'Preferences',
  'prefs.wheel': 'Mouse wheel',
  'prefs.wheelFlip': 'Wheel switches photos',
  'prefs.wheelFlipHint': 'Scroll to go to the previous / next photo; when off, the wheel zooms. In full screen it always zooms',
  'prefs.wheelFullscreen': 'Wheel enters / exits full screen',
  'prefs.wheelFullscreenHint': 'Keep scrolling up while enlarged to go full screen; keep scrolling down in full screen to leave',
  'prefs.wheelFullscreenOff': 'Not available while the wheel switches photos',
  'menu.openUpdate': 'Menu (update available)',
  'update.menu': 'Update to {version}',
  'update.downloading': 'Downloading update… {p}%',
  'update.downloadingPlain': 'Downloading update…',
  'update.installing': 'Installing update…',
  'update.restarting': 'Installing the update. Peekit will reopen when it is done',
  'update.failed': 'Update failed: {msg}',
  'update.retry': 'Retry',
  'update.menuFailed': 'Update failed, click to retry',
  'update.toast': 'Peekit {version} is available',
  'update.now': 'Update',
  'update.check': 'Check for updates',
  'update.checking': 'Checking for updates…',
  'update.latest': 'You are up to date',
  'update.available': 'Version {version} is available',
  'update.checkFailed': 'Could not check for updates',
  'prefs.update': 'Updates',
  'prefs.autoUpdate': 'Check for updates automatically',
  'prefs.autoUpdateHint': 'On startup, asks GitHub whether a new version is out and shows it in the menu. Nothing is downloaded until you choose to update',
  // 情绪板（2026-11-18）
  'hint.lift': '⧉　Hold a painting · drag it to a mood board',
  'board.menu': 'Mood boards',
  'board.new': 'New mood board',
  'board.addExisting': 'Add to a board',
  'board.quickNew': 'New',
  'board.defaultName': 'Mood board',
  'board.deleteConfirm': 'Delete “{name}”?',
  'board.delete': 'Delete board',
  'board.created': 'Created “{name}”',
  'board.deleted': 'Deleted “{name}”',
  'board.duplicated': 'Duplicated as “{name}”',
  'board.added': 'Added to “{name}”',
  'board.alreadyIn': '“{name}” already has this image',
  'board.open': 'Open',
  'board.nameTitle': 'Name the new board',
  'board.renameTitle': 'Rename board',
  'board.noneYet': 'No boards yet. Drop on an empty tile to create one',
  'board.chooseTitle': 'Add to board',
  'board.back': 'Back to viewer',
  'board.backShort': 'Viewer',
  'board.renameHint': 'Click to rename',
  'board.count': '{n} images',
  'board.fit': 'Show all',
  'board.emptyTitle': 'This board is empty',
  'board.emptyHint': 'Drop images into the window, or go back to the viewer, hold a painting and drag it here',
  'board.aria': 'Mood board canvas',
  'board.removed': 'Removed {n} from the board',
  'board.selected': '{n} selected',
  'board.optimizeSel': 'Optimize selection ({n})',
  'board.optimizeGroup': 'Optimize this cluster ({n})',
  'board.optimizeAll': 'Optimize everything',
  'board.removeSel': 'Remove selection ({n})',
  'board.detach': 'Detach from cluster',
  'board.focus': 'Enlarge',
  'board.remove': 'Remove from board',
  'board.addImages': 'Add images…',
  'board.rename': 'Rename',
  'board.addedN': 'Added {n} images',
  'board.already': 'These images are already on the board',
  'board.openWhich': 'Open which board?',
  'board.addedSeries': 'Added {n} from “{series}” to “{name}”',
  'board.allAlreadyIn': 'This whole series is already in “{name}”',
  'board.pickHint': 'Click a tile to add this painting to a board',
  'board.dragSeries': 'Drag out to add the whole series to a board',
  'board.mergeSel': 'Merge into a new cluster ({n})',
  'rating.set': 'Rating: {n} of 5 (press {n})',
  'rating.toast': 'Rated {stars}',
  'rating.cleared': 'Rating cleared',
  'rating.none': 'No works rated {n}★ or higher yet',
  'rating.filtered': 'Showing {n}★ and up: {count}',
  'rating.showAll': 'Show all works',
  'rating.clearFilter': 'Showing {n}★ and up. Click to show all',
  'rating.filterAtLeast': 'Only {n}★ and up',
  'rating.filterMenu': 'Rating filter',
  'check.flip': 'Flip horizontally',
  'check.gray': 'Grayscale',
  'check.blur': 'Blur',
  'check.bar': 'Artist checks',
  'check.withKey': '{name} ({key})',
  'check.toastOn': '{name} on. Press {key} again to turn it off',
  'check.toastOff': '{name} off',
  'check.allOff': 'Artist checks off',
  'check.clearAll': '{names} on. Click to turn them all off',
  'list.sep': ', ',
  'palette.menu': 'Search…',
  'palette.placeholder': 'Search works, series, collections, boards or actions',
  'palette.none': 'No matches',
  'palette.kindAction': 'Action',
  'palette.kindWork': 'Work',
  'palette.kindSeries': 'Series',
  'palette.kindSet': 'Collection',
  'palette.kindBoard': 'Mood board',
  'palette.importFiles': 'Import files…',
  'palette.importFolder': 'Import folder…',
  'palette.on': 'On',
  'palette.off': 'Off',
  'palette.first': 'Go to the earliest work',
  'palette.latest': 'Go to the latest work',
  'palette.fullscreen': 'Enter / exit full screen',
  'palette.reduceTransparency': 'Reduce transparency',
  'palette.theme': 'Color scheme: {mode}',
  'prefs.display': 'Display',
  'prefs.reduceTransparency': 'Reduce transparency',
  'prefs.reduceTransparencyHint': 'Solid backgrounds for the full-screen zoom badge, the mood board picker and the drop hint. The frosted glass on the stage stays',
  'prefs.followingSystem': '. Follows the system transparency setting until you change it here',
  'filter.none': 'No works match all of these filters',
  'filter.noneShowAll': 'Nothing here matches the filters, so all works are shown',
  'filter.showAll': 'Showing all works',
  'color.showAll': 'No longer filtering by color',
  'color.analyzing': 'Analyzing colors… {done} / {total}',
  'color.none': 'No works with {name}',
  'color.filtered': 'Works with {name}: {count}',
  'color.clearFilter': 'Showing works with {name}. Click to stop filtering by color',
  'color.filterMenu': 'Color filter',
  'color.pickAny': 'Any color…',
  'color.filterFamily': 'Only works with {name}',
  'colorf.red': 'red',
  'colorf.orange': 'orange',
  'colorf.yellow': 'yellow',
  'colorf.green': 'green',
  'colorf.cyan': 'cyan',
  'colorf.blue': 'blue',
  'colorf.purple': 'purple',
  'colorf.pink': 'pink',
  'colorf.black': 'black',
  'colorf.white': 'white',
  'colorf.gray': 'gray',
};

export const MESSAGES: Record<Lang, Record<MessageKey, string>> = {
  zh, 'zh-TW': zhTW, en, ar, de, es, fr, it, ja, ko, pt, ru,
};

/** 菜单里的顺序：简体中文、繁体中文、English，其余按英文名排序 */
export const LANGS: readonly Lang[] = ['zh', 'zh-TW', 'en', 'ar', 'de', 'es', 'fr', 'it', 'ja', 'ko', 'pt', 'ru'];

/** 每种语言自己的名字（语言菜单里的主标签） */
export const LANG_NATIVE: Record<Lang, string> = {
  zh: '简体中文',
  'zh-TW': '繁體中文',
  en: 'English',
  ar: 'العربية',
  de: 'Deutsch',
  es: 'Español',
  fr: 'Français',
  it: 'Italiano',
  ja: '日本語',
  ko: '한국어',
  pt: 'Português',
  ru: 'Русский',
};

/** <html lang> 用的语言标签 */
export const langTag = (l: Lang): string => (l === 'zh' ? 'zh-CN' : l);

/** 语言名字查询用的代码（简体 / 繁体要分开问） */
const displayCode = (l: Lang): string => (l === 'zh' ? 'zh-Hans' : l === 'zh-TW' ? 'zh-Hant' : l);

let localNames: { lang: Lang; names: Intl.DisplayNames | null } | null = null;

/** 语言 l 在当前界面语言里叫什么（语言菜单里灰色的副标签）；系统不支持时返回空串 */
export function langLocalName(l: Lang): string {
  if (localNames?.lang !== current) {
    let names: Intl.DisplayNames | null = null;
    try {
      names = new Intl.DisplayNames([langTag(current)], { type: 'language' });
    } catch {
      /* 不支持 Intl.DisplayNames */
    }
    localNames = { lang: current, names };
  }
  try {
    return localNames.names?.of(displayCode(l)) ?? '';
  } catch {
    return '';
  }
}

const isLang = (v: unknown): v is Lang => typeof v === 'string' && (LANGS as readonly string[]).includes(v);

const LANG_KEY = 'peekit:lang';
let current: Lang = detect();
const listeners = new Set<(l: Lang) => void>();

/**
 * 系统语言（如 zh-CN、pt-BR、de）对应的界面语言；不支持的用英文。
 * 中文分简繁：明确写了繁体（zh-Hant）或台湾 / 香港 / 澳门（zh-TW / HK / MO）用繁体，其余用简体
 */
export function langFromLocale(locale: string): Lang {
  const lc = locale.toLowerCase().replace(/_/g, '-');
  if (lc === 'zh' || lc.startsWith('zh-')) return /^zh-(hant|tw|hk|mo)(-|$)/.test(lc) ? 'zh-TW' : 'zh';
  const base = lc.split('-')[0];
  return isLang(base) ? base : 'en';
}

function detect(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (isLang(saved)) return saved;
  } catch {
    /* 读不到就跟随系统 */
  }
  return langFromLocale(typeof navigator !== 'undefined' ? navigator.language || '' : '');
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
    document.documentElement.lang = langTag(l);
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
  document.documentElement.lang = langTag(current);
}
