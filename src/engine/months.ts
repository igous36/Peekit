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

const monthFormats = new Map<Lang, Intl.DateTimeFormat>();

/** 时间轴上的月份：中文“11月”、英文“Nov”，其余语言用系统的月份简称（2026-11-18） */
export function monthLabel(month: number, lang: Lang): string {
  if (lang === 'zh') return `${month}月`;
  if (lang === 'en') return EN_MONTHS[month - 1] ?? String(month);
  let f = monthFormats.get(lang);
  if (!f) {
    f = new Intl.DateTimeFormat(lang, { month: 'short', timeZone: 'UTC' });
    monthFormats.set(lang, f);
  }
  return f.format(new Date(Date.UTC(2000, month - 1, 1)));
}

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
 * 标签太挤时隐藏一部分，保证显示出来的标签之间至少隔 minGap px（2026-11-17 改：年份也会让位，
 * 之前年份全部保留，几万幅、跨几十年的作品库里年份会叠在一起）。
 * 先放年份、再放月份；同一级里“覆盖的作品多”的优先（年份：到下一个年份之前有几幅；月份：到下一个标签之前有几幅），
 * 所以大部分作品所在的年份一定显示，零星几幅的年份让位。
 * xs 是每个标签的位置（px），total 是作品总数；返回每个标签是否显示。
 */
export function placeLabels(
  labels: readonly TimelineLabel[],
  xs: readonly number[],
  minGap = 34,
  total = labels.length ? labels[labels.length - 1].index + 1 : 0,
): boolean[] {
  const span = labels.map((l, i) => {
    let j = i + 1;
    if (l.kind === 'year') while (j < labels.length && labels[j].kind !== 'year') j++;
    return (j < labels.length ? labels[j].index : total) - l.index;
  });
  const order = labels
    .map((_, i) => i)
    .sort((a, b) => {
      const ka = labels[a].kind === 'year' ? 0 : 1, kb = labels[b].kind === 'year' ? 0 : 1;
      return ka - kb || span[b] - span[a] || a - b;
    });
  const show = labels.map(() => false);
  const placed: number[] = [];
  for (const i of order) {
    if (placed.every((x) => Math.abs(x - xs[i]) >= minGap)) {
      show[i] = true;
      placed.push(xs[i]);
    }
  }
  return show;
}
