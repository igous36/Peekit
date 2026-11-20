// 偏好设置（2026-11-18 新增，左上角 ≡ 菜单 → 偏好设置）。记在 localStorage。
//
// 目前两项，都是鼠标滚轮的：
// - wheelFlip：滚轮切换照片（往下滚下一张、往上滚上一张）；关闭时（默认）滚轮推拉镜头：系列视图 / 单幅 / 放大 / 全屏。
//   全屏时滚轮始终是缩放画面，不受这一项影响
// - wheelFullscreen：滚轮能不能进入 / 退出全屏（默认能：放大时继续上滑进全屏，全屏适应屏幕时继续下滑退出）。
//   滚轮切换照片时这一项不起作用（菜单里显示成关、变灰），关掉切换照片后恢复成原来设的值——所以单独存，不去改它
// - autoUpdate（2026-11-18 加）：启动时自动检查更新（默认开；只查不下载，见 updater.ts）
// - reduceTransparency（2026-11-20 加）：降低透明度。null（默认）= 跟随系统的“透明效果”设置，
//   在菜单里拨过一次就记成 true / false（见 transparency.ts）

export interface Prefs {
  wheelFlip: boolean;
  wheelFullscreen: boolean;
  autoUpdate: boolean;
  reduceTransparency: boolean | null;
}

export const DEFAULT_PREFS: Prefs = { wheelFlip: false, wheelFullscreen: true, autoUpdate: true, reduceTransparency: null };

const KEY = 'peekit:prefs';
const listeners = new Set<(p: Prefs) => void>();

/** 读存过的偏好（缺的项用默认值，类型不对的忽略） */
export function parsePrefs(raw: unknown): Prefs {
  const p = { ...DEFAULT_PREFS };
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (typeof o.wheelFlip === 'boolean') p.wheelFlip = o.wheelFlip;
    if (typeof o.wheelFullscreen === 'boolean') p.wheelFullscreen = o.wheelFullscreen;
    if (typeof o.autoUpdate === 'boolean') p.autoUpdate = o.autoUpdate;
    if (typeof o.reduceTransparency === 'boolean') p.reduceTransparency = o.reduceTransparency;
  }
  return p;
}

function load(): Prefs {
  try {
    const s = localStorage.getItem(KEY);
    return parsePrefs(s ? JSON.parse(s) : null);
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

let current: Prefs = load();

export const prefs = (): Readonly<Prefs> => current;

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
  if (current[key] === value) return;
  current = { ...current, [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* 存不了就只在这次生效 */
  }
  for (const fn of listeners) fn(current);
}

export function onPrefsChange(fn: (p: Prefs) => void): void {
  listeners.add(fn);
}

/** 滚轮实际能不能进入 / 退出全屏：滚轮切换照片时不能（不管 wheelFullscreen 存的是什么） */
export const wheelCanToggleFullscreen = (p: Pick<Prefs, 'wheelFlip' | 'wheelFullscreen'>): boolean => !p.wheelFlip && p.wheelFullscreen;
