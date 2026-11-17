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
import { applyToSample, emptySaved, parseSaved } from './data/library';
import { createLibraryStore } from './data/persist';
import { LibraryService } from './data/service';
import { logError } from './data/tauri-io';
import type { Library } from './data/types';
import { App } from './app';

async function boot(): Promise<void> {
  applyTokens();
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
  let raw: unknown = null;
  try {
    raw = await store.load();
  } catch (err) {
    console.error('读取作品库失败，从空库开始', err);
  }
  const saved = parseSaved(raw) ?? emptySaved();
  const service = new LibraryService(saved, store, desktop);

  // 桌面版：先显示界面（空状态 / 读取中），再扫描导入过的文件夹和文件。
  // 浏览器调试：用示例数据。
  let lib: Library;
  let loading = false;
  if (desktop) {
    lib = { works: [], series: [] };
    loading = saved.sources.length > 0;
  } else {
    lib = sampleLibrary();
    applyToSample(lib, saved);
  }
  const app = new App(mount, { lib, service, initialIndex: desktop ? 0 : 3, loading });
  // 调试用：在开发者工具里可以直接改 app.m.pos 再调用 app.render()
  if (import.meta.env.DEV) (window as unknown as { app: App }).app = app;

  if (desktop && loading) {
    try {
      const r = await service.rescan();
      // 打开时停在最新的一幅
      app.setLibrary(r.lib, r.lib.works.length - 1);
    } catch (err) {
      console.error('扫描作品失败', err);
      app.setLibrary({ works: [], series: saved.series }, 0);
    }
  }

  // 性能探针：只在 PEEKIT_PERF=1 启动时运行
  if (desktop && (await invoke<boolean>('perf_mode').catch(() => false))) {
    const { runPerfProbe } = await import('./perf');
    await runPerfProbe(app);
  }
}

void boot();
