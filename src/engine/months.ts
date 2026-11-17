// 时间轴的月份：按月跳转、年份 / 月份标签和它们的避让（2026-11-17 新增）。纯函数。
import type { Lang } from '../i18n';

/** "2025.06.14" → "2025.06"；日期未知返回空字符串 */
export const monthKey = (date: string): string => (/^\d{4}\.\d{2}/.test(date) ? date.slice(0, 7) : '');

/**
 * 右键箭头按月跳。dir = 1：下个月的第一幅；已经在最后一个月就到最后一幅。
 * dir = −1：不在本月第一幅时先回到本月第一幅；已经在本月第一幅才到上个月的第一幅；
 * 已经在第一个月就到第一幅。
 * dates 按时间顺序（和作品列表一致）。
 */
export function monthJump(dates: readonly string[], cur: number, dir: 1 | -1): number {
  const n = dates.length;
  if (n === 0) return 0;
  const c = Math.max(0, Math.min(n - 1, cur));
  const key = monthKey(dates[c]);
  if (dir > 0) {
    for (let i = c + 1; i < n; i++) if (monthKey(dates[i]) !== key) return i;
    return n - 1;
  }
  // 先退到本月第一幅；已经在本月第一幅了，再往前一个月
  let start = c;
  while (start > 0 && monthKey(dates[start - 1]) === key) start--;
  if (start < c || start === 0) return start;
  let j = start - 1;
  const prevKey = monthKey(dates[j]);
  while (j > 0 && monthKey(dates[j - 1]) === prevKey) j--;
  return j;
}

const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const monthLabel = (month: number, lang: Lang): string =>
  lang === 'zh' ? `${month}月` : EN_MONTHS[month - 1] ?? String(month);

export interface TimelineLabel {
  /** 标在第几幅上方 */
  index: number;
  kind: 'year' | 'month';
  text: string;
}

/** 每年第一幅标年份；其余每个月的第一幅标月份 */
export function timelineLabels(dates: readonly string[], lang: Lang): TimelineLabel[] {
  const out: TimelineLabel[] = [];
  let lastYear = '';
  let lastMonth = '';
  dates.forEach((d, i) => {
    const mk = monthKey(d);
    if (!mk) return;
    const year = mk.slice(0, 4);
    if (year !== lastYear) out.push({ index: i, kind: 'year', text: year });
    else if (mk !== lastMonth) out.push({ index: i, kind: 'month', text: monthLabel(Number(mk.slice(5, 7)), lang) });
    lastYear = year;
    lastMonth = mk;
  });
  return out;
}

/**
 * 标签太挤时隐藏一部分：年份优先，全部保留；月份按顺序放，离任何已放的标签不到 minGap px 就隐藏。
 * xs 是每个标签的位置（px），返回每个标签是否显示。
 */
export function placeLabels(labels: readonly TimelineLabel[], xs: readonly number[], minGap = 34): boolean[] {
  const show = labels.map((l) => l.kind === 'year');
  const placed = labels.flatMap((l, i) => (l.kind === 'year' ? [xs[i]] : []));
  labels.forEach((l, i) => {
    if (l.kind !== 'month') return;
    if (placed.every((x) => Math.abs(x - xs[i]) >= minGap)) {
      show[i] = true;
      placed.push(xs[i]);
    }
  });
  return show;
}
