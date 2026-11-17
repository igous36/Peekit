import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Tauri 开发服务器约定：固定端口，不清屏，方便看 Rust 端日志
const host = process.env.TAURI_DEV_HOST;
// 关于对话框在浏览器调试时显示的版本号（桌面版读 Tauri 配置）
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8').replace(/^﻿/, ''));

export default defineConfig({
  clearScreen: false,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    // Windows 用 WebView2（Chromium），macOS 用 WKWebView（Safari 14+）
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari14',
    minify: process.env.TAURI_ENV_DEBUG ? false : 'esbuild',
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
