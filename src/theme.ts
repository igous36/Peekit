// 外观：浅色 / 深色 / 跟随系统（2026-11-17 新增）。切换后记在 localStorage。
// 2026-11-18 起新安装默认跟随系统（之前默认浅色；已经选过的保持不变）。
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
  return 'system';
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
  apply(true);
}

export function onThemeChange(fn: (t: Theme) => void): void {
  listeners.push(fn);
}

/** 启动时调用一次（在建界面之前，避免先画一帧浅色） */
export function initTheme(): void {
  query?.addEventListener('change', () => {
    if (pref === 'system') apply(true);
  });
  apply(false);
}

const reducedMotion = typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

/**
 * 换上当前该用的深浅。animate：真的换了深浅时整个界面交叉淡入淡出（2026-11-18，用户反馈一下子变色闪眼睛），
 * 用 View Transitions（旧画面截图淡出、新画面淡入，时长在 styles.css）；不支持或减少动态效果时直接换
 */
function apply(animate: boolean): void {
  const t = theme();
  const root = document.documentElement;
  const commit = () => {
    root.dataset.theme = t;
    // 让滚动条、输入框这些系统控件也跟着深浅
    root.style.colorScheme = t;
  };
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
  if (animate && root.dataset.theme !== t && doc.startViewTransition && !reducedMotion?.matches) {
    // 过渡期间挂个标记：菜单的子菜单看到它就先不收起（flyout.ts）
    root.classList.add('is-theme-fading');
    const done = () => root.classList.remove('is-theme-fading');
    doc.startViewTransition(commit).finished.then(done, done);
  } else {
    commit();
  }
  if (t === applied) return;
  applied = t;
  for (const fn of listeners) fn(t);
}
