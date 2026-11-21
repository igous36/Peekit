// 情绪板标注（2026-11-20）：文字便签、箭头和直线、色卡、手绘涂鸦。纯函数，不碰 DOM。
//
// 标注和照片分开存（Board.marks），不参与集合、吸附、整理、缩略图那一套；坐标都是画布坐标（和照片一样）。
// 颜色是 MARK_COLORS 的下标：便签用浅的那个，线和涂鸦用深的那个。
import { bounds, type Box } from './board-layout';
import { normalizeHex } from './color';

export const MARK_COLORS = [
  { key: 'yellow', note: '#FFE89A', ink: '#D99A00' },
  { key: 'pink', note: '#FFC9D6', ink: '#D9436F' },
  { key: 'blue', note: '#C7E3FF', ink: '#2F7AD6' },
  { key: 'green', note: '#CDEDC4', ink: '#3A9447' },
  { key: 'gray', note: '#F2F1EE', ink: '#2A2A2A' },
] as const;

export interface NoteMark {
  id: string;
  kind: 'note';
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  color: number;
  /** 字号（画布 px），新建时按当时的缩放定，屏幕上看起来约 15px */
  size: number;
}

export interface SwatchMark {
  id: string;
  kind: 'swatch';
  x: number;
  y: number;
  w: number;
  h: number;
  colors: string[];
}

export interface LineMark {
  id: string;
  kind: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** 终点有箭头 */
  arrow: boolean;
  color: number;
  /** 线宽（画布 px） */
  width: number;
}

export interface InkMark {
  id: string;
  kind: 'ink';
  /** 点：x0, y0, x1, y1, … */
  pts: number[];
  color: number;
  width: number;
}

export type BoardMark = NoteMark | SwatchMark | LineMark | InkMark;
export type MarkTool = 'select' | 'note' | 'arrow' | 'line' | 'pen';

export const newMarkId = (): string => 'mk-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const colorIdx = (x: unknown): number => (num(x) ? Math.abs(Math.round(x)) % MARK_COLORS.length : 0);

/** 读回来的标注做一遍校验：格式不对的丢掉 */
export function parseMarks(raw: unknown): BoardMark[] {
  if (!Array.isArray(raw)) return [];
  const out: BoardMark[] = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    const o = m as Record<string, unknown>;
    if (typeof o.id !== 'string') continue;
    if (o.kind === 'note' && num(o.x) && num(o.y) && num(o.w) && num(o.h) && o.w > 0 && o.h > 0) {
      out.push({
        id: o.id, kind: 'note', x: o.x, y: o.y, w: o.w, h: o.h,
        text: typeof o.text === 'string' ? o.text.slice(0, 4000) : '', color: colorIdx(o.color), size: num(o.size) && o.size > 0 ? o.size : 16,
      });
    } else if (o.kind === 'swatch' && num(o.x) && num(o.y) && num(o.w) && num(o.h) && Array.isArray(o.colors)) {
      const colors = o.colors.map((c) => (typeof c === 'string' ? normalizeHex(c) : null)).filter((c): c is string => !!c).slice(0, 8);
      if (colors.length) out.push({ id: o.id, kind: 'swatch', x: o.x, y: o.y, w: o.w, h: o.h, colors });
    } else if (o.kind === 'line' && num(o.x1) && num(o.y1) && num(o.x2) && num(o.y2)) {
      out.push({
        id: o.id, kind: 'line', x1: o.x1, y1: o.y1, x2: o.x2, y2: o.y2, arrow: o.arrow === true, color: colorIdx(o.color),
        width: num(o.width) && o.width > 0 ? o.width : 3,
      });
    } else if (o.kind === 'ink' && Array.isArray(o.pts) && o.pts.length >= 4 && o.pts.every(num)) {
      out.push({ id: o.id, kind: 'ink', pts: (o.pts as number[]).slice(0, 20000), color: colorIdx(o.color), width: num(o.width) && o.width > 0 ? o.width : 3 });
    }
  }
  return out;
}

/** 一个标注占的框（画布坐标） */
export function markBox(m: BoardMark): Box {
  if (m.kind === 'note' || m.kind === 'swatch') return { x: m.x, y: m.y, w: m.w, h: m.h };
  if (m.kind === 'line') {
    const x = Math.min(m.x1, m.x2), y = Math.min(m.y1, m.y2);
    return { x, y, w: Math.abs(m.x2 - m.x1), h: Math.abs(m.y2 - m.y1) };
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i + 1 < m.pts.length; i += 2) {
    x0 = Math.min(x0, m.pts[i]);
    y0 = Math.min(y0, m.pts[i + 1]);
    x1 = Math.max(x1, m.pts[i]);
    y1 = Math.max(y1, m.pts[i + 1]);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** 照片和标注合起来的范围：“适应窗口”要把便签、箭头也框进来 */
export function contentBounds(items: readonly Box[], marks: readonly BoardMark[] = []): Box {
  return bounds(marks.length ? [...items, ...marks.map(markBox)] : items);
}

/** 整个标注平移 */
export function moveMark(m: BoardMark, dx: number, dy: number): void {
  if (m.kind === 'note' || m.kind === 'swatch') {
    m.x += dx;
    m.y += dy;
  } else if (m.kind === 'line') {
    m.x1 += dx;
    m.y1 += dy;
    m.x2 += dx;
    m.y2 += dy;
  } else {
    for (let i = 0; i + 1 < m.pts.length; i += 2) {
      m.pts[i] += dx;
      m.pts[i + 1] += dy;
    }
  }
}

/** 点到线段的距离 */
export function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2)) : 0;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** 箭头的两条短边（画布坐标）：长度跟线宽走，夹角 ±28° */
export function arrowHead(m: Pick<LineMark, 'x1' | 'y1' | 'x2' | 'y2' | 'width'>): [number, number, number, number, number, number] {
  const a = Math.atan2(m.y2 - m.y1, m.x2 - m.x1);
  const len = Math.max(10, m.width * 4.5);
  const s = (28 * Math.PI) / 180;
  return [
    m.x2 - len * Math.cos(a - s), m.y2 - len * Math.sin(a - s),
    m.x2, m.y2,
    m.x2 - len * Math.cos(a + s), m.y2 - len * Math.sin(a + s),
  ];
}

/**
 * 手绘的点去抖：和上一个留下的点距离小于 minDist 的丢掉（画布坐标；按缩放换算后大约屏幕上 2px），
 * 最后一个点总是留下
 */
export function thinPoints(pts: readonly number[], minDist: number): number[] {
  if (pts.length <= 4) return [...pts];
  const out = [pts[0], pts[1]];
  for (let i = 2; i + 1 < pts.length; i += 2) {
    const lx = out[out.length - 2], ly = out[out.length - 1];
    if (Math.hypot(pts[i] - lx, pts[i + 1] - ly) >= minDist) out.push(pts[i], pts[i + 1]);
  }
  const n = pts.length;
  if (out[out.length - 2] !== pts[n - 2] || out[out.length - 1] !== pts[n - 1]) out.push(pts[n - 2], pts[n - 1]);
  return out;
}

/** 手绘的 SVG 路径：相邻两点的中点之间用二次曲线连起来，线条圆滑 */
export function inkPath(pts: readonly number[]): string {
  const f = (v: number) => Math.round(v * 10) / 10;
  if (pts.length < 4) return '';
  if (pts.length === 4) return `M${f(pts[0])} ${f(pts[1])}L${f(pts[2])} ${f(pts[3])}`;
  let d = `M${f(pts[0])} ${f(pts[1])}`;
  for (let i = 2; i + 3 < pts.length; i += 2) {
    const mx = (pts[i] + pts[i + 2]) / 2, my = (pts[i + 1] + pts[i + 3]) / 2;
    d += `Q${f(pts[i])} ${f(pts[i + 1])} ${f(mx)} ${f(my)}`;
  }
  const n = pts.length;
  d += `L${f(pts[n - 2])} ${f(pts[n - 1])}`;
  return d;
}

/** 点击位置离手绘线多近（画布坐标） */
export function distToInk(px: number, py: number, pts: readonly number[]): number {
  let best = Infinity;
  for (let i = 0; i + 3 < pts.length; i += 2) best = Math.min(best, distToSegment(px, py, pts[i], pts[i + 1], pts[i + 2], pts[i + 3]));
  return best;
}
