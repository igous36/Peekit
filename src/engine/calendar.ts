// 创作年历（2026-11-20）：按年统计作品，热力图、每月幅数、连续创作天数、这一年的颜色、最常画的系列。纯函数。
//
// 日期取作品的显示日期（元数据日期，没有就是文件修改时间，YYYY.MM.DD，本地时区），和信息卡上看到的一样。
import type { Work } from '../data/types';
import { colorDistance } from './swatches';

export interface Ymd {
  y: number;
  /** 1–12 */
  m: number;
  d: number;
}

/** 作品是哪一天画的；日期未知返回 null */
export function workDay(w: Pick<Work, 'date' | 'ts'>): Ymd | null {
  const m = /^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/.exec(w.date ?? '');
  if (m) return { y: +m[1], m: +m[2], d: +m[3] };
  if (w.ts && w.ts > 0) {
    const t = new Date(w.ts);
    return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate() };
  }
  return null;
}

const p2 = (n: number) => String(n).padStart(2, '0');
export const dayKey = (d: Ymd): string => `${d.y}-${p2(d.m)}-${p2(d.d)}`;

/** 有作品的年份，从新到旧 */
export function yearsOf(works: readonly Pick<Work, 'date' | 'ts'>[]): number[] {
  const ys = new Set<number>();
  for (const w of works) {
    const d = workDay(w);
    if (d) ys.add(d.y);
  }
  return [...ys].sort((a, b) => b - a);
}

export interface YearStats {
  year: number;
  total: number;
  /** 日期 → 那天画的作品（在传进来的列表里的下标，按先后） */
  days: Map<string, number[]>;
  /** 每月幅数，下标 0–11 */
  months: number[];
  /** 画了画的天数 */
  activeDays: number;
  /** 最长连续创作天数（这一年之内） */
  streak: { days: number; from: string; to: string } | null;
  /** 幅数最多的月份（0–11），一幅都没有是 -1 */
  busiestMonth: number;
  /** 一天之内画得最多的那天 */
  busiestDay: { key: string; count: number } | null;
  /** 这一年的颜色：所有作品的主色组成按占比合起来，相近的并在一起，最多 8 个 */
  colors: { hex: string; share: number }[];
  /** 画得最多的系列（系列 id → 幅数，从多到少） */
  series: { id: string; count: number }[];
}

/** 合并颜色时，OKLab 距离小于这个算同一个 */
const COLOR_MERGE = 0.09;
const MAX_COLORS = 8;

/**
 * 一年的统计。colorsOf：一幅作品的主色组成（没有就返回 null，不算进颜色里）
 */
export function yearStats(
  works: readonly Pick<Work, 'date' | 'ts' | 'series'>[],
  year: number,
  colorsOf: (i: number) => { hex: string; share: number }[] | null = () => null,
): YearStats {
  const days = new Map<string, number[]>();
  const months = new Array<number>(12).fill(0);
  const series = new Map<string, number>();
  const acc: { hex: string; w: number }[] = [];
  let total = 0;
  works.forEach((w, i) => {
    const d = workDay(w);
    if (!d || d.y !== year) return;
    total++;
    const k = dayKey(d);
    const list = days.get(k);
    if (list) list.push(i);
    else days.set(k, [i]);
    months[d.m - 1]++;
    series.set(w.series, (series.get(w.series) ?? 0) + 1);
    for (const c of colorsOf(i) ?? []) {
      const hit = acc.find((a) => colorDistance(a.hex, c.hex) < COLOR_MERGE);
      if (hit) hit.w += c.share;
      else acc.push({ hex: c.hex, w: c.share });
    }
  });

  // 最长连续：按日期排好，相邻两天差一天就接上
  const keys = [...days.keys()].sort();
  let streak: YearStats['streak'] = null;
  let runFrom = 0;
  for (let i = 0; i < keys.length; i++) {
    if (i > 0 && dayDiff(keys[i - 1], keys[i]) !== 1) runFrom = i;
    const len = i - runFrom + 1;
    if (!streak || len > streak.days) streak = { days: len, from: keys[runFrom], to: keys[i] };
  }

  let busiestMonth = -1;
  months.forEach((n, i) => {
    if (n > 0 && (busiestMonth < 0 || n > months[busiestMonth])) busiestMonth = i;
  });
  let busiestDay: YearStats['busiestDay'] = null;
  for (const [key, list] of days) {
    if (!busiestDay || list.length > busiestDay.count || (list.length === busiestDay.count && key < busiestDay.key)) {
      busiestDay = { key, count: list.length };
    }
  }
  const wsum = acc.reduce((a, c) => a + c.w, 0) || 1;
  const colors = acc
    .sort((a, b) => b.w - a.w)
    .slice(0, MAX_COLORS)
    .map((c) => ({ hex: c.hex, share: c.w / wsum }));

  return {
    year, total, days, months, activeDays: days.size, streak, busiestMonth, busiestDay, colors,
    series: [...series.entries()].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count),
  };
}

/** 两个 YYYY-MM-DD 相差几天（按日历日，不受夏令时影响） */
export function dayDiff(a: string, b: string): number {
  const t = (k: string) => Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10));
  return Math.round((t(b) - t(a)) / 86_400_000);
}

/** 热力图的深浅：0 = 没画，1–4 按这一天的幅数占全年单日最多的比例 */
export function heatLevel(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  return Math.max(1, Math.min(4, Math.ceil((count / max) * 4)));
}

export interface GridCell {
  key: string;
  /** 第几周（列），0 起 */
  col: number;
  /** 一周里的第几天（行），0 = 一周的第一天 */
  row: number;
  month: number;
}

/**
 * 热力图的格子：一列一周，一行一个星期几。firstDay：一周从哪天开始，1 = 周一 … 7 = 周日（ISO）。
 * 返回这一年每一天的格子，以及每个月第一天所在的列（月份标签用）
 */
export function yearGrid(year: number, firstDay = 1): { cells: GridCell[]; cols: number; monthCols: number[] } {
  const cells: GridCell[] = [];
  const monthCols = new Array<number>(12).fill(0);
  const jan1 = new Date(Date.UTC(year, 0, 1));
  // ISO 星期几：1 = 周一 … 7 = 周日
  const iso = (dt: Date) => ((dt.getUTCDay() + 6) % 7) + 1;
  const lead = (iso(jan1) - firstDay + 7) % 7;
  let cols = 0;
  for (let dt = jan1; dt.getUTCFullYear() === year; dt = new Date(dt.getTime() + 86_400_000)) {
    const doy = Math.round((dt.getTime() - jan1.getTime()) / 86_400_000);
    const col = Math.floor((doy + lead) / 7);
    const row = (doy + lead) % 7;
    const month = dt.getUTCMonth();
    if (dt.getUTCDate() === 1) monthCols[month] = col;
    cells.push({ key: dayKey({ y: year, m: month + 1, d: dt.getUTCDate() }), col, row, month });
    cols = col + 1;
  }
  return { cells, cols, monthCols };
}

/** 界面语言的一周第一天（ISO 1–7）；系统不支持就按周一 */
export function firstDayOfWeek(locale: string): number {
  try {
    const loc = new Intl.Locale(locale) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };
    const info = loc.getWeekInfo?.() ?? loc.weekInfo;
    if (info && info.firstDay >= 1 && info.firstDay <= 7) return info.firstDay;
  } catch {
    /* 不支持 */
  }
  return 1;
}
