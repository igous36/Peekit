// 系列标签编辑：改名、把作品归入某个系列、新建系列、完成时补全空名字；作品自定义标题。
// 移植自原型的 onRename / assign / newSeries / finishEdit。直接改传进来的 Library（不碰 DOM）。
import type { Library, Series, Work } from './types';
import { seriesPalette } from '../tokens';
import { t } from '../i18n';

/** 系列名输入框的长度上限 */
export const SERIES_NAME_MAX = 16;
/** 自定义标题的长度上限 */
export const TITLE_MAX = 60;

/** 系列显示名：空名字显示“未命名系列” */
export const displayName = (s: Series): string => s.name || t('series.unnamed');

/** 作品显示标题：自定义标题优先，没有就用源文件标题 */
export const displayTitle = (w: Work): string => w.customTitle?.trim() || w.title;

/** 实时改名（输入过程中允许为空，完成时再补全） */
export function renameSeries(lib: Library, seriesId: string, name: string): void {
  const s = lib.series.find((x) => x.id === seriesId);
  if (s) s.name = name.slice(0, SERIES_NAME_MAX);
}

/** 改自定义标题；空字符串表示恢复成源文件标题 */
export function setCustomTitle(lib: Library, workIndex: number, title: string): void {
  const w = lib.works[workIndex];
  if (!w) return;
  const v = title.slice(0, TITLE_MAX);
  if (v.trim()) w.customTitle = v;
  else delete w.customTitle;
}

/** 把第 workIndex 幅移到 seriesId */
export function assignWork(lib: Library, workIndex: number, seriesId: string): void {
  const w = lib.works[workIndex];
  if (w) w.series = seriesId;
}

/** 按 §3 的顺序取第一个还没被用过的系列色，全用过就按数量轮换 */
export function nextSeriesColor(series: readonly Series[]): string {
  const used = new Set(series.map((s) => s.color.toUpperCase()));
  return seriesPalette.find((c) => !used.has(c.toUpperCase())) ?? seriesPalette[series.length % seriesPalette.length];
}

/**
 * 新建「新系列 N」并把第 workIndex 幅移进去。
 * N 取最小的、还没被用过的正整数。示例数据（3 个系列）下和原型一致：新系列 1 → #C27F4B，新系列 2 → #5FA3C9 …
 */
export function createSeries(lib: Library, workIndex: number, makeId: () => string = newSeriesId): Series {
  const names = new Set(lib.series.map((s) => s.name));
  let k = 1;
  while (names.has(t('series.newName', { n: k }))) k++;
  const s: Series = { id: makeId(), name: t('series.newName', { n: k }), color: nextSeriesColor(lib.series) };
  lib.series.push(s);
  assignWork(lib, workIndex, s.id);
  return s;
}

/** 完成编辑：名字为空（或全是空白）的系列补成“未命名系列” */
export function finalizeNames(lib: Library): void {
  for (const s of lib.series) {
    if (!s.name.trim()) s.name = t('series.unnamed');
  }
}

/** 芯片列表：作品都移走的系列自动隐藏（数据保留） */
export function visibleSeries(lib: Library): Series[] {
  const inUse = new Set(lib.works.map((w) => w.series));
  return lib.series.filter((s) => inUse.has(s.id));
}

export function newSeriesId(): string {
  return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
