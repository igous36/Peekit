// 外观：浅色 / 深色 / 跟随系统（2026-11-17 新增）。默认浅色（原设计），切换后记在 localStorage。
// 生效方式：<html data-theme="dark">，tokens.ts 里的深色变量挂在这个选择器上。
// 桌面版顺便把窗口底色换掉，并记下来给下次启动用（Rust 端 set_theme_background），避免启动时先闪一下浅灰。

export type ThemePref = 'light' | 'dark' | 'system';
export type Theme = 'light' | 'dark';

const KEY = 'peekit:theme';
const listeners: ((t: Theme) => void)[] = [];
const query = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

let pref: ThemePref = readPref();
let applied: Theme | null = null;

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* 存储不可用：用默认值 */
  }
  return 'light';
}

/** 偏好 + 系统当前的深浅 → 实际用哪套 */
export function resolveTheme(p: ThemePref, systemDark: boolean): Theme {
  if (p === 'system') return systemDark ? 'dark' : 'light';
  return p;
}

export function themePref(): ThemePref {
  return pref;
}

export function theme(): Theme {
  return resolveTheme(pref, !!query?.matches);
}

export function setThemePref(p: ThemePref): void {
  pref = p;
  try {
    localStorage.setItem(KEY, p);
  } catch {
    /* 存不下就只在这次生效 */
  }
  apply();
}

export function onThemeChange(fn: (t: Theme) => void): void {
  listeners.push(fn);
}

/** 启动时调用一次（在建界面之前，避免先画一帧浅色） */
export function initTheme(): void {
  query?.addEventListener('change', () => {
    if (pref === 'system') apply();
  });
  apply();
}

function apply(): void {
  const t = theme();
  const root = document.documentElement;
  root.dataset.theme = t;
  // 让滚动条、输入框这些系统控件也跟着深浅
  root.style.colorScheme = t;
  if (t === applied) return;
  applied = t;
  for (const fn of listeners) fn(t);
}
