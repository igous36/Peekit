// 只打包 Inter / JetBrains Mono 的拉丁子集；中文走系统字体（苹方 / 微软雅黑）
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import './styles.css';

import { invoke, isTauri } from '@tauri-apps/api/core';
import { applyTokens } from './tokens';
import { initI18n } from './i18n';
import { sampleLibrary } from './data/sample';
import { applyToSample } from './data/library';
import { createLibraryStore, type StoredData } from './data/persist';
import { loadSets, parseSets } from './data/sets';
import { LibraryService } from './data/service';
import { logError, setThemeBackground } from './data/tauri-io';
import { initTheme, onThemeChange, theme } from './theme';
import type { Library } from './data/types';
import { App } from './app';

async function boot(): Promise<void> {
  applyTokens();
  // 外观先于界面生效：第一帧就是对的深浅
  initTheme();
  setThemeBackground(theme() === 'dark');
  onThemeChange((t) => setThemeBackground(t === 'dark'));
  initI18n();
  const mount = document.getElementById('app');
  if (!mount) return;

  const desktop = isTauri();
  if (desktop) {
    // 前端的未捕获错误打到终端里
    window.addEventListener('error', (e) => logError(`未捕获错误 ${e.message} @ ${e.filename}:${e.lineno}`));
    window.addEventListener('unhandledrejection', (e) => logError(`未处理的 Promise 拒绝 ${String(e.reason)}`));
  }
  const store = createLibraryStore();
  let stored: StoredData = { sets: null, legacy: null };
  try {
    stored = await store.load();
  } catch (err) {
    console.error('读取作品库失败，从空库开始', err);
  }
  // 预览集（v3）；没有就把旧版的单个作品库迁移成第一个预览集
  const data = loadSets(stored.sets, stored.legacy);
  const service = new LibraryService(data, store, desktop);
  if (!parseSets(stored.sets)) store.save(data); // 迁移后立刻写一份 v3

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
  const app = new App(mount, { lib, service, initialIndex: desktop ? 0 : 3, loading, loadLibrary });
  // 调试用：在开发者工具里可以直接改 app.m.pos 再调用 app.render()
  if (import.meta.env.DEV) (window as unknown as { app: App }).app = app;

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
  if (desktop && (await invoke<boolean>('perf_mode').catch(() => false))) {
    const { runPerfProbe } = await import('./perf');
    await runPerfProbe(app);
  }
}

void boot();
