// 画师自检（2026-11-20）：水平翻转、灰度、模糊。画师检查画面的老办法：
// 镜像看形体歪没歪，去色看明暗关系，眯眼（模糊）看大的块面和构图。
// 开着时舞台上的画作、系列缩略图、放大 / 全屏的那幅都跟着变；只在这次运行里有效，换作品、按 Esc 都不会关。
// 纯函数，不碰 DOM。

export type CheckKind = 'flip' | 'gray' | 'blur';

export const CHECK_KINDS: readonly CheckKind[] = ['flip', 'gray', 'blur'];

/** 快捷键（不分大小写）：H 翻转（horizontal）、G 灰度（gray）、B 模糊（blur） */
export const CHECK_KEYS: Readonly<Record<CheckKind, string>> = { flip: 'H', gray: 'G', blur: 'B' };

export type CheckState = Record<CheckKind, boolean>;

export const NO_CHECKS: Readonly<CheckState> = { flip: false, gray: false, blur: false };

/** 按键 → 哪一项；不是这三个键返回 null */
export function checkFromKey(key: string): CheckKind | null {
  if (key.length !== 1) return null;
  const k = key.toUpperCase();
  return CHECK_KINDS.find((c) => CHECK_KEYS[c] === k) ?? null;
}

export const anyCheck = (s: Readonly<CheckState>): boolean => s.flip || s.gray || s.blur;

/** 切换一项，返回新的状态（不改原来的） */
export function toggleCheck(s: Readonly<CheckState>, k: CheckKind): CheckState {
  return { ...s, [k]: !s[k] };
}
