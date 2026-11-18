// 系列标签编辑：改名、把作品归入某个系列、新建系列、完成时补全空名字；作品自定义标题。
// 移植自原型的 onRename / assign / newSeries / finishEdit。直接改传进来的 Library（不碰 DOM）。
// 2026-11-17 新增：从预览集移除作品、删除系列（作品归入未归类，或连同作品一起移除）。
import type { Library, Series, Work } from './types';
import { seriesPalette, UNASSIGNED_COLOR } from '../tokens';
import { t } from '../i18n';

/**
 * 系列名的长度上限。原型是 16；2026-11-17 文件夹导入改成「文件夹-子文件夹-…」的层级名，
 * 16 个字放不下末级文件夹名，放宽到 40（芯片和胶囊里过长的名字用省略号）。
 */
export const SERIES_NAME_MAX = 40;

/** “未归类”系列的固定 id：单独选的文件、被删系列里的作品放这里 */
export const UNSORTED_ID = 'unsorted';
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

/** 确保“未归类”系列存在（名字随界面语言），返回它的 id */
export function ensureUnsorted(lib: Library): string {
  if (!lib.series.some((s) => s.id === UNSORTED_ID)) {
    lib.series.push({ id: UNSORTED_ID, name: t('series.unassigned'), color: UNASSIGNED_COLOR });
  }
  return UNSORTED_ID;
}

/**
 * 从预览集里移除作品（源文件不动）。works 换成新数组（时间轴等按数组身份判断要不要重建），
 * 返回真正移除的作品 id。
 */
export function removeWorks(lib: Library, ids: ReadonlySet<string>): string[] {
  const removed = lib.works.filter((w) => ids.has(w.id)).map((w) => w.id);
  if (removed.length) lib.works = lib.works.filter((w) => !ids.has(w.id));
  return removed;
}

/**
 * 删除系列。
 * - withWorks = false：系列里的作品归入“未归类”（“未归类”本身不能这样删，返回空）
 * - withWorks = true：系列里的作品一起从预览集移除
 * 返回被移除的作品 id（只有 withWorks 时才有）。
 */
export function deleteSeries(lib: Library, seriesId: string, withWorks: boolean): string[] {
  let removed: string[] = [];
  if (withWorks) {
    removed = removeWorks(lib, new Set(lib.works.filter((w) => w.series === seriesId).map((w) => w.id)));
  } else {
    if (seriesId === UNSORTED_ID) return [];
    const members = lib.works.filter((w) => w.series === seriesId);
    if (members.length) {
      const to = ensureUnsorted(lib);
      for (const w of members) w.series = to;
    }
  }
  lib.series = lib.series.filter((s) => s.id !== seriesId);
  return removed;
}

// ───────────── 编辑卡的快照：取消时恢复、判断有没有改动（2026-11-17） ─────────────

/** 编辑卡打开时的系列列表（名字、颜色）和每幅作品的归属 / 自定义标题 */
export interface EditSnapshot {
  series: Series[];
  works: Map<string, { series: string; customTitle?: string }>;
}

export function snapshotEdit(lib: Library): EditSnapshot {
  return {
    series: lib.series.map((s) => ({ ...s })),
    works: new Map(lib.works.map((w) => [w.id, { series: w.series, customTitle: w.customTitle }])),
  };
}

/** 恢复到快照（取消编辑） */
export function restoreEdit(lib: Library, snap: EditSnapshot): void {
  lib.series = snap.series.map((s) => ({ ...s }));
  for (const w of lib.works) {
    const s = snap.works.get(w.id);
    if (!s) continue;
    w.series = s.series;
    if (s.customTitle) w.customTitle = s.customTitle;
    else delete w.customTitle;
  }
}

/**
 * 和快照比有没有改动（编辑卡的“取消”按钮据此可不可点）。
 * 改了又改回原样（比如打字再删掉）算没改动；空的自定义标题和没有自定义标题一样。
 */
export function editChanged(snap: EditSnapshot, lib: Library): boolean {
  if (snap.series.length !== lib.series.length) return true;
  for (let i = 0; i < lib.series.length; i++) {
    const a = snap.series[i], b = lib.series[i];
    if (a.id !== b.id || a.name !== b.name || a.color !== b.color) return true;
  }
  for (const w of lib.works) {
    const s = snap.works.get(w.id);
    if (!s) continue;
    if (s.series !== w.series || (s.customTitle ?? '') !== (w.customTitle ?? '')) return true;
  }
  return false;
}

export function newSeriesId(): string {
  return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
