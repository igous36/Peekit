// 降低透明度（2026-11-20，偏好设置 → 显示）。
//
// Peekit 的菜单、提示条、信息卡本来就是实色白底；半透明、上面又有字或要看清的只有几处：
// 全屏缩放的倍率胶囊、情绪板拖起阵列的背景和格子、拖文件进窗口的提示、情绪板四边的模糊。
// 打开后这几处改用实色底、去掉背景模糊（styles.css 里 :root[data-transparency="reduced"] 那一节）。
// 舞台上的磨砂玻璃格不变（画作沉到玻璃后面是 Peekit 的核心效果，2026-11-20 用户决定保留）。
//
// 默认跟随系统：Windows 的“设置 → 个性化 → 颜色 → 透明效果”关掉时，WebView2 的
// prefers-reduced-transparency 媒体查询是 reduce。菜单里拨过一次开关后就按用户选的来。
import { onPrefsChange, prefs, setPref } from './prefs';

const query = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-transparency: reduce)') : null;

/** 系统设置要求降低透明度（不支持这个媒体查询的环境当作不要求） */
export const systemReducesTransparency = (): boolean => !!query?.matches;

/** 现在实际是不是降低透明度：用户拨过开关就按用户的，没拨过跟随系统 */
export function resolveReduced(pref: boolean | null, system: boolean): boolean {
  return pref ?? system;
}

export const transparencyReduced = (): boolean => resolveReduced(prefs().reduceTransparency, systemReducesTransparency());

/** 菜单里的开关：切到和现在相反的状态，并记下来（之后不再跟随系统） */
export function toggleReduceTransparency(): void {
  setPref('reduceTransparency', !transparencyReduced());
}

function apply(): void {
  const root = document.documentElement;
  if (transparencyReduced()) root.dataset.transparency = 'reduced';
  else delete root.dataset.transparency;
}

/** 启动时调用一次：按偏好 / 系统设置挂上属性，之后跟着变 */
export function initTransparency(): void {
  apply();
  query?.addEventListener('change', apply);
  onPrefsChange(apply);
}
