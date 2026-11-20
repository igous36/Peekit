// 星级和按星筛选（2026-11-20）。纯函数，不碰 DOM。
//
// - 每幅作品可以打 1–5 星，0 / 没有 = 没打星。信息卡上点星星、按数字键 1–5 打星，0 清除。
// - 筛选：查看菜单里选“只看 N 星以上”，时间轴、系列视图、左右切换都只剩星级 ≥ N 的作品。
//   App 同时持有全部作品（full）和筛选后的（view），两者共用同一批作品对象；这里负责从 full 算出 view，
//   以及两边下标的换算。

import type { Work } from '../data/types';

export const MAX_RATING = 5;

/** 读回来的星级：不是 1–5 的整数就当没打星（返回 0） */
export function clampRating(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  const r = Math.round(v);
  return r >= 1 && r <= MAX_RATING ? r : 0;
}

/** 点第 n 颗星：已经是 n 星就清除（再点一下取消），否则设成 n */
export function toggleRating(current: number, n: number): number {
  return clampRating(current) === n ? 0 : clampRating(n);
}

/** 数字键 → 星级：1–5 打星，0 清除；其余返回 null（小键盘的数字也算） */
export function ratingFromKey(key: string): number | null {
  if (key.length !== 1 || key < '0' || key > '5') return null;
  return key.charCodeAt(0) - 48;
}

/** 这幅够不够筛选线：min = 0 表示不筛选 */
export const passes = (w: Pick<Work, 'rating'>, min: number): boolean => min <= 0 || clampRating(w.rating) >= min;

/** 筛选后的作品（保持原来的先后顺序）；min = 0 原样返回同一个数组 */
export function filterByRating<T extends Pick<Work, 'rating'>>(works: T[], min: number): T[] {
  return min <= 0 ? works : works.filter((w) => passes(w, min));
}

/** 有多少幅够得上 min 星 */
export function countAtLeast(works: readonly Pick<Work, 'rating'>[], min: number): number {
  let n = 0;
  for (const w of works) if (passes(w, min)) n++;
  return n;
}

/**
 * 全部作品里的第 fullIndex 幅，在筛选后的列表里对应第几幅：
 * 它本身留下来了就是它；被筛掉了就找它后面最近的一幅留下来的，后面没有就找前面的。
 * view 为空返回 0。
 */
export function viewIndexOf<T>(full: readonly T[], view: readonly T[], fullIndex: number): number {
  if (!view.length) return 0;
  if (full === view) return Math.max(0, Math.min(view.length - 1, fullIndex));
  const at = new Map(view.map((w, i) => [w, i]));
  const start = Math.max(0, Math.min(full.length - 1, fullIndex));
  for (let i = start; i < full.length; i++) {
    const j = at.get(full[i]);
    if (j !== undefined) return j;
  }
  for (let i = start - 1; i >= 0; i--) {
    const j = at.get(full[i]);
    if (j !== undefined) return j;
  }
  return 0;
}
