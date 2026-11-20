// 新旧对比（2026-11-20）：两幅配成一对（比如旧作和重画的那一版），并排 / 拖动分割线 / 半透明叠加着看。纯函数。
//
// 配对存在作品上（Work.pair = 另一幅的 id，两边互相指着），一幅最多和一幅配对：
// 和新的一幅配对时，原来的那一对自动拆开。
import type { Work } from '../data/types';
import { dayDiff, dayKey, workDay } from './calendar';

/** 把 a、b 配成一对（两边互相指着）；它们原来各自的搭档如果指着它们，就拆开 */
export function pairWorks(byId: ReadonlyMap<string, Work>, a: Work, b: Work): void {
  if (a === b) return;
  for (const w of [a, b]) {
    const old = w.pair ? byId.get(w.pair) : undefined;
    if (old && old !== a && old !== b && old.pair === w.id) delete old.pair;
  }
  a.pair = b.id;
  b.pair = a.id;
}

/** 拆开 w 的那一对 */
export function unpair(byId: ReadonlyMap<string, Work>, w: Work): void {
  const p = w.pair ? byId.get(w.pair) : undefined;
  if (p && p.pair === w.id) delete p.pair;
  delete w.pair;
}

/** w 的搭档（对方不在了、或者对方已经不指着 w，算没有） */
export function partnerOf(byId: ReadonlyMap<string, Work>, w: Work): Work | null {
  const p = w.pair ? byId.get(w.pair) : undefined;
  return p && p.pair === w.id ? p : null;
}

/** 两幅按日期先后排：[早的, 晚的]；日期一样或未知时保持传进来的顺序 */
export function olderFirst(a: Work, b: Work): [Work, Work] {
  const da = workDay(a), db = workDay(b);
  if (da && db && dayDiff(dayKey(da), dayKey(db)) < 0) return [b, a];
  if (!da && db) return [a, b];
  return [a, b];
}

export interface Gap {
  years: number;
  months: number;
  days: number;
}

/** 两幅相隔多久（按日历算：几年几个月；不到一个月按天）；有一幅日期未知返回 null */
export function gapBetween(a: Work, b: Work): Gap | null {
  let da = workDay(a), db = workDay(b);
  if (!da || !db) return null;
  if (dayDiff(dayKey(da), dayKey(db)) < 0) [da, db] = [db, da];
  let months = (db.y - da.y) * 12 + (db.m - da.m);
  if (db.d < da.d) months--;
  if (months <= 0) return { years: 0, months: 0, days: dayDiff(dayKey(da), dayKey(db)) };
  return { years: Math.floor(months / 12), months: months % 12, days: 0 };
}

/** 对比时的看法：并排、拖动分割线、半透明叠加 */
export type CompareMode = 'side' | 'split' | 'overlay';
export const COMPARE_MODES: readonly CompareMode[] = ['side', 'split', 'overlay'];

/** 同步缩放的视图：z 1 = 适应框；px / py 是画面中心相对框中心的偏移（框宽 / 框高的比例） */
export interface CompareView {
  z: number;
  px: number;
  py: number;
}

export const COMPARE_MAX_ZOOM = 8;

/**
 * 以光标为中心缩放：cx / cy 是光标相对框中心的位置（框宽 / 框高的比例，-0.5–0.5），k 是缩放倍数。
 * 缩回 1 时回到正中；平移量限制在画面不离开框太远
 */
export function zoomView(v: CompareView, k: number, cx: number, cy: number): CompareView {
  const z = Math.max(1, Math.min(COMPARE_MAX_ZOOM, v.z * k));
  if (z <= 1.0001) return { z: 1, px: 0, py: 0 };
  const r = z / v.z;
  return clampView({ z, px: cx - (cx - v.px) * r, py: cy - (cy - v.py) * r });
}

/** 平移限制：画面的边最多移到框的中线 */
export function clampView(v: CompareView): CompareView {
  const lim = (v.z - 1) / 2 + 0.25 * (v.z > 1 ? 1 : 0);
  const c = (x: number) => Math.max(-lim, Math.min(lim, x));
  return { z: v.z, px: c(v.px), py: c(v.py) };
}
