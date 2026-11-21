// 只打包 Inter / JetBrains Mono 的拉丁子集；中文走系统字体（苹方 / 微软雅黑）
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import './styles.css';

import { invoke, isTauri } from '@tauri-apps/api/core';
import { applyTokens, tokensApplied } from './tokens';
import { initI18n } from './i18n';
import { sampleLibrary } from './data/sample';
import { applyToSample } from './data/library';
import { createLibraryStore, type StoredData } from './data/persist';
import { loadSets, parseSets } from './data/sets';
import { LibraryService } from './data/service';
import { parseBoards } from './data/boards';
import { BoardStore } from './data/board-store';
import { logError, setThemeBackground } from './data/tauri-io';
import { initTheme, onThemeChange, theme } from './theme';
import { initTransparency } from './transparency';
import type { Library } from './data/types';
import { App } from './app';

async function boot(): Promise<void> {
  applyTokens();
  // 外观先于界面生效：第一帧就是对的深浅
  initTheme();
  initTransparency();
  setThemeBackground(theme() === 'dark');
  onThemeChange((t) => setThemeBackground(t === 'dark'));
  initI18n();
  const mount = document.getElementById('app');
  if (!mount) return;

  // 置顶参考小窗（2026-11-20）：地址带 ?ref=… 时只显示一幅画或一个只读情绪板，不建整个应用
  const params = new URLSearchParams(location.search);
  if (params.get('ref')) {
    const { bootReference } = await import('./ref/reference');
    await bootReference(params, mount);
    return;
  }

  const desktop = isTauri();
  if (desktop) {
    // 自检：设计变量没生效（比如被 CSP 拦了）时界面会整个没有颜色，打到终端里方便定位
    if (!tokensApplied()) logError('设计变量没有生效（--color-bg 为空），界面会缺少颜色和卡片样式');
    else void invoke('log_info', { msg: '启动自检：设计变量已生效' }).catch(() => {});
    // 前端的未捕获错误打到终端里
    window.addEventListener('error', (e) => logError(`未捕获错误 ${e.message} @ ${e.filename}:${e.lineno}`));
    window.addEventListener('unhandledrejection', (e) => logError(`未处理的 Promise 拒绝 ${String(e.reason)}`));
  }
  const store = createLibraryStore();
  let stored: StoredData = { sets: null, legacy: null, boards: null };
  try {
    stored = await store.load();
  } catch (err) {
    console.error('读取作品库失败，从空库开始', err);
  }
  // 预览集（v3）；没有就把旧版的单个作品库迁移成第一个预览集
  const data = loadSets(stored.sets, stored.legacy);
  const service = new LibraryService(data, store, desktop);
  if (!parseSets(stored.sets)) store.save(data); // 迁移后立刻写一份 v3
  // 情绪板（2026-11-18）：和预览集互相独立
  const boards = new BoardStore(parseBoards(stored.boards), store);

  // 浏览器调试：第一个预览集显示示例数据，其余是空的（浏览器里不能导入）
  const sampleSetId = data.sets[0].id;
  const loadLibrary = async (): Promise<Library> => {
    if (desktop) return (await service.rescan()).lib;
    if (service.current.id !== sampleSetId) return { works: [], series: [] };
    const lib = sampleLibrary();
    applyToSample(lib, service.saved);
    return lib;
  };

  // 桌面版：先显示界面（空状态 / 读取中），再扫描当前预览集导入过的文件夹和文件
  let lib: Library = { works: [], series: [] };
  let loading = false;
  if (desktop) loading = service.saved.sources.length > 0;
  else lib = await loadLibrary();
  const app = new App(mount, { lib, service, boards, initialIndex: desktop ? 0 : 3, loading, loadLibrary });
  // 调试用：在开发者工具里可以直接改 app.m.pos 再调用 app.render()
  if (import.meta.env.DEV) {
    (window as unknown as { app: App }).app = app;
    // 情绪板压测（2026-11-19）：开发者工具里 await boardStress() 或 boardStress([500])
    (window as unknown as { boardStress: (c?: number[]) => Promise<void> }).boardStress = async (counts?: number[]) =>
      (await import('./perf-board')).runBoardStress(app, (m) => console.log(m), counts);
  }

  if (desktop && loading) {
    try {
      const r = await service.rescan();
      // 打开时停在最新的一幅
      app.setLibrary(r.lib, r.lib.works.length - 1);
    } catch (err) {
      console.error('扫描作品失败', err);
      app.setLibrary({ works: [], series: service.saved.series }, 0);
    }
  }

  // 性能探针：只在 PEEKIT_PERF=1 启动时运行
  // 性能探针：只在 PEEKIT_PERF=1（舞台）或 PEEKIT_PERF=board（情绪板压测）启动时运行
  const perf = desktop ? await invoke<string>('perf_mode').catch(() => '') : '';
  if (perf === '1' || perf === 'board') {
    const { runPerfProbe, runBoardProbe } = await import('./perf');
    await (perf === 'board' ? runBoardProbe(app) : runPerfProbe(app));
  } else if (perf === 'ref') {
    // 置顶参考小窗自检（2026-11-20）：开一个单幅、一个情绪板的小窗，小窗把加载结果打到终端，然后关掉主窗口
    const { runRefProbe } = await import('./perf');
    await runRefProbe(app);
  } else if (perf === 'export') {
    // 导出自检（2026-11-21）：用真实作品各导出一次长图（高清，读原图）、网格、拼图、PDF，只打日志不保存，然后关掉主窗口
    const { runExportProbe } = await import('./perf');
    await runExportProbe(app);
  }
}

void boot();
