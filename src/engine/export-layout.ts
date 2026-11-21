// 导出排版（2026-11-21）：长图、网格、拼图、PDF 作品集。只算几何，输出像素坐标；画图在 view/export-render.ts，
// 预览（view/export-view.ts）用同一份坐标摆 DOM。
//
// 尺寸都按“单位” u 算，整张图跟着导出尺寸等比放大：长图、网格 u = 宽 / 1600；拼图和 PDF 的一页 u = 长边 / 1600。
// 文字只放在留白里（每幅下面的标题行、底部说明、PDF 封面），不叠在作品上。
//
//   长图   一列，作品占满内容宽（竖幅最高到宽的 1.25 倍，再高就收窄、居中）
//   网格   2–4 列瀑布流：按顺序放进当前最矮的一列，不裁切
//   拼图   固定比例的一页（16:9、4:3…）：等高行，行数取让作品总面积最大的那个，整块居中
//   PDF    封面（说明 + 最多 6 幅的拼图）+ 一页一幅
import { linearPartition } from './board-layout';
import { clamp } from './math';

export type ExportLayout = 'long' | 'grid' | 'collage' | 'pdf';
export type CollageRatio = '16:9' | '4:3' | '1:1' | '3:4' | '9:16';
export type PdfPageSize = 'a4-landscape' | 'a4-portrait' | 'wide';
export type ExportSize = 1 | 1.5 | 2;
/** 留白、间距的三档：小 / 中 / 大 */
export type Spacing = 0 | 1 | 2;

export interface ExportSettings {
  layout: ExportLayout;
  /** 网格列数 2–4 */
  columns: number;
  ratio: CollageRatio;
  page: PdfPageSize;
  margin: Spacing;
  gap: Spacing;
  /** 每幅下面写标题和日期 */
  captions: boolean;
  /** 底部一段总说明（PDF 是封面） */
  summary: boolean;
  /** 右下角的 Peekit 标识（手写字标） */
  brand: boolean;
  size: ExportSize;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Cell extends Rect {
  /** 第几幅（对应传进来的作品顺序） */
  i: number;
  /** 标题行：文字框左上角和可用宽度（行高见 ExportType.capLine） */
  cap?: { x: number; y: number; w: number };
}

export interface Page {
  w: number;
  h: number;
  cells: Cell[];
  /** 总说明：标题文字框左上角、可用宽度；big = PDF 封面的大号版本 */
  summary?: { x: number; y: number; w: number; big: boolean };
  /** 说明上面的一条细线 */
  rule?: { x: number; y: number; w: number };
  /** Peekit 标识（手写字标）：右边缘 x、顶 y、高 h（宽见 brandWidth） */
  brand?: { x: number; y: number; h: number };
}

/** 标识只有手写字标，宽高比和字标的 viewBox 一样（440 × 190） */
export const BRAND_ASPECT = 440 / 190;
export const brandWidth = (h: number): number => h * BRAND_ASPECT;

export interface ExportType {
  caption: number;
  capLine: number;
  title: number;
  titleLine: number;
  meta: number;
  metaLine: number;
  /** 说明里标题和下一行之间的空 */
  metaGap: number;
  rule: number;
}

export interface ExportPlan {
  pages: Page[];
  type: ExportType;
  /** PDF 封面上说明的大号字 */
  cover?: ExportType;
  /** 每幅的标题和日期占几行：格子窄（网格多列、拼图）时分两行，日期在标题下面 */
  capLines: 1 | 2;
  /** 太大了，自动缩小过（画布有尺寸上限） */
  shrunk: boolean;
}

/** 长图 / 网格的宽、拼图的长边、PDF 一页的长边（尺寸 1× 时，px） */
export const BASE_WIDTH = 1600;
export const COLLAGE_LONG = 1920;
export const PDF_LONG = 2000;
/** 画布上限：单边、面积（WebView2 / Chromium 的硬上限是 32767 和约 2.68 亿像素，留余量） */
export const MAX_SIDE = 30000;
export const MAX_AREA = 160e6;

const MARGIN = [64, 112, 168];
const GAP = [20, 44, 80];
/** 竖幅在长图里最高是内容宽的多少倍 */
const LONG_MAX_TALL = 1.25;
const ASPECT_MIN = 0.25, ASPECT_MAX = 4;

const RATIOS: Record<CollageRatio, number> = { '16:9': 16 / 9, '4:3': 4 / 3, '1:1': 1, '3:4': 3 / 4, '9:16': 9 / 16 };
/** PDF 页面（点）：A4 横、A4 竖、16:9 宽屏 */
export const PDF_POINTS: Record<PdfPageSize, [number, number]> = {
  'a4-landscape': [842, 595], 'a4-portrait': [595, 842], wide: [960, 540],
};

const okAspect = (a: number): number => (Number.isFinite(a) && a > 0 ? clamp(a, ASPECT_MIN, ASPECT_MAX) : 0.8);

function typeFor(u: number, big = false): ExportType {
  const caption = 20 * u, title = (big ? 72 : 40) * u, meta = (big ? 26 : 22) * u;
  return {
    caption, capLine: caption * 1.45,
    title, titleLine: title * 1.25,
    meta, metaLine: meta * 1.45,
    metaGap: (big ? 18 : 10) * u,
    rule: Math.max(1, u),
  };
}

/** 标题行占的高度（图片底到下一样东西） */
const capBlock = (u: number, lines = 1): number => 16 * u + typeFor(u).capLine * lines;
/** 格子比这个窄（u）时标题和日期分两行 */
const CAP_ONE_LINE_MIN = 520;
/** 说明占的高度（细线到说明底） */
function summaryBlock(t: ExportType, u: number): number {
  return 40 * u + t.titleLine + t.metaGap + t.metaLine;
}

/** 导出的像素尺寸：长图 / 网格是宽，拼图是长边 */
export function pageSize(s: ExportSettings): { w: number; h: number } {
  if (s.layout === 'collage') {
    const r = RATIOS[s.ratio] ?? 16 / 9;
    const long = Math.round(COLLAGE_LONG * s.size);
    return r >= 1 ? { w: long, h: Math.round(long / r) } : { w: Math.round(long * r), h: long };
  }
  if (s.layout === 'pdf') {
    const [pw, ph] = PDF_POINTS[s.page] ?? PDF_POINTS['a4-landscape'];
    const long = Math.round(PDF_LONG * s.size);
    return pw >= ph ? { w: long, h: Math.round((long * ph) / pw) } : { w: Math.round((long * pw) / ph), h: long };
  }
  return { w: Math.round(BASE_WIDTH * s.size), h: 0 };
}

/**
 * 排版。aspects：每幅的宽高比（按导出顺序）；cover：PDF 封面上放哪几幅（下标）。
 * 长图、网格太大时整体缩小到画布放得下（shrunk = true）
 */
export function planExport(aspects: readonly number[], s: ExportSettings, cover: readonly number[] = []): ExportPlan {
  const a = aspects.map(okAspect);
  if (s.layout === 'collage') return collagePlan(a, s);
  if (s.layout === 'pdf') return pdfPlan(a, s, cover);
  const W = pageSize(s).w;
  let plan = s.layout === 'grid' ? gridPlan(a, s, W) : longPlan(a, s, W);
  const p = plan.pages[0];
  const f = Math.min(1, MAX_SIDE / p.h, Math.sqrt(MAX_AREA / (p.w * p.h)));
  if (f < 1) {
    const w2 = Math.floor(W * f);
    plan = s.layout === 'grid' ? gridPlan(a, s, w2) : longPlan(a, s, w2);
    plan.shrunk = true;
  }
  return plan;
}

/** 字标的高（u）：长图、网格、拼图（和 40u 的说明标题分量相当）；PDF 封面；PDF 每页 */
const BRAND_H = 46, BRAND_COVER_H = 60, BRAND_PAGE_H = 32;

/** 标识和说明放在同一行：标识靠右、和标题行垂直居中，说明让出这段宽度 */
function brandBesideSummary(page: Page, right: number, titleLine: number, bh: number, u: number): void {
  const sm = page.summary!;
  page.brand = { x: right, y: sm.y + (titleLine - bh) / 2, h: bh };
  sm.w = Math.max(0, sm.w - brandWidth(bh) - 40 * u);
}

/** 作品和下面的说明 / 标识之间的空：跟着留白走，不跟间距（调间距不该挪动说明） */
const sepFor = (M: number, u: number): number => Math.max(56 * u, 0.6 * M);

/** 内容底 y 之后接上说明（和标识），定出整页高度 */
function finishLong(page: Page, bottom: number, s: ExportSettings, u: number, M: number, t: ExportType): void {
  const bh = BRAND_H * u;
  if (s.summary) {
    const ry = bottom + sepFor(M, u);
    page.rule = { x: M, y: ry, w: page.w - 2 * M };
    page.summary = { x: M, y: ry + 40 * u, w: page.w - 2 * M, big: false };
    if (s.brand) brandBesideSummary(page, page.w - M, t.titleLine, bh, u);
    page.h = Math.round(ry + summaryBlock(t, u) + M);
  } else if (s.brand) {
    // 没有说明：标识单独一行，靠右
    const y = bottom + sepFor(M, u);
    page.brand = { x: page.w - M, y, h: bh };
    page.h = Math.round(y + bh + M);
  } else page.h = Math.round(bottom + M);
}

function longPlan(a: readonly number[], s: ExportSettings, W: number): ExportPlan {
  const u = W / BASE_WIDTH;
  const M = MARGIN[s.margin] * u, G = GAP[s.gap] * u;
  const t = typeFor(u);
  const CW = W - 2 * M;
  const cap = s.captions ? capBlock(u) : 0;
  const cells: Cell[] = [];
  let y = M;
  a.forEach((r, i) => {
    let w = CW, h = CW / r;
    if (h > CW * LONG_MAX_TALL) {
      h = CW * LONG_MAX_TALL;
      w = h * r;
    }
    const x = M + (CW - w) / 2;
    const c: Cell = { i, x, y, w, h };
    if (s.captions) c.cap = { x, y: y + h + 16 * u, w };
    cells.push(c);
    y += h + cap + G;
  });
  const page: Page = { w: W, h: 0, cells };
  finishLong(page, a.length ? y - G : y, s, u, M, t);
  return { pages: [page], type: t, capLines: 1, shrunk: false };
}

function gridPlan(a: readonly number[], s: ExportSettings, W: number): ExportPlan {
  const u = W / BASE_WIDTH;
  const M = MARGIN[s.margin] * u, G = GAP[s.gap] * u;
  const t = typeFor(u);
  const n = clamp(Math.round(s.columns), 2, 4);
  const cw = (W - 2 * M - G * (n - 1)) / n;
  const lines = cw < CAP_ONE_LINE_MIN * u ? 2 : 1;
  const cap = s.captions ? capBlock(u, lines) : 0;
  const cols = new Array<number>(n).fill(M);
  const cells: Cell[] = [];
  a.forEach((r, i) => {
    // 放进最矮的一列（一样高放左边）
    let k = 0;
    for (let j = 1; j < n; j++) if (cols[j] < cols[k] - 0.5) k = j;
    const x = M + k * (cw + G), y = cols[k], h = cw / r;
    const c: Cell = { i, x, y, w: cw, h };
    if (s.captions) c.cap = { x, y: y + h + 16 * u, w: cw };
    cells.push(c);
    cols[k] = y + h + cap + G;
  });
  const page: Page = { w: W, h: 0, cells };
  const bottom = a.length ? Math.max(...cols) - G : M;
  finishLong(page, bottom, s, u, M, t);
  return { pages: [page], type: t, capLines: lines, shrunk: false };
}

/** 铺满左右的排法面积不到“撑满高度”那种的这么多，才改用撑满高度的 */
const FULL_WIDTH_MIN = 0.8;

interface Rows {
  cells: Cell[];
  area: number;
  w: number;
  h: number;
}

/**
 * 等高行塞进一个框（box）。行数在估计值附近试几种（2026-11-21 改）：
 * - 优先让每行正好铺满框宽（左右和下面的说明、细线对齐，调间距不会改变左右的留白），贴着框顶，排不满的高度留在下面；
 * - 铺满宽度要么放不下、要么面积比“撑满高度”的排法少太多（作品很少时）才撑满高度，整块水平居中。
 * cap：每行下面标题行的高度（不写标题时 0）；start = 靠左上（PDF 封面，和下面的标题对齐）
 */
export function fillBox(a: readonly number[], box: Rect, gap: number, cap: number, capTop: number, start = false): Cell[] {
  const n = a.length;
  if (!n || box.w <= 0 || box.h <= 0) return [];
  const S = a.reduce((x, v) => x + v, 0);
  const k0 = clamp(Math.round(Math.sqrt((S * box.h) / box.w)), 1, n);
  let fit: Rows | null = null;
  let full: Rows | null = null;
  for (let k = Math.max(1, k0 - 2); k <= Math.min(n, k0 + 2); k++) {
    const rows = linearPartition(a, k);
    const sums = rows.map((r) => r.reduce((x, i) => x + a[i], 0));
    // 用宽 W' 时总高 = W'·Σ(1/sum) − Σ(行内空隙/sum) + 行间空隙 + 标题行
    let s1 = 0, sg = 0;
    rows.forEach((r, j) => {
      s1 += 1 / sums[j];
      sg += (gap * (r.length - 1)) / sums[j];
    });
    const fixed = gap * (k - 1) + cap * k;
    const build = (W: number): Rows | null => {
      const cells: Cell[] = [];
      let y = 0, area = 0;
      for (let j = 0; j < rows.length; j++) {
        const h = (W - gap * (rows[j].length - 1)) / sums[j];
        if (!(h > 0)) return null;
        let x = 0;
        for (const i of rows[j]) {
          const w = h * a[i];
          cells.push({ i, x, y, w, h });
          area += w * h;
          x += w + gap;
        }
        y += h + cap + gap;
      }
      return { cells, area, w: W, h: y - gap };
    };
    // 撑满高度：解出正好填满框高的 W'（不超过框宽）
    const c = build(Math.min(box.w, (box.h - fixed + sg) / s1));
    if (c && (!fit || c.area > fit.area)) fit = c;
    // 铺满宽度：用框宽时总高放得下
    if (box.w * s1 - sg + fixed <= box.h + 0.5) {
      const f = build(box.w);
      if (f && (!full || f.area > full.area)) full = f;
    }
  }
  const pick = full && (!fit || full.area >= FULL_WIDTH_MIN * fit.area) ? full : fit;
  if (!pick) return [];
  const spans = pick === full;
  const ox = start || spans ? box.x : box.x + (box.w - pick.w) / 2;
  const oy = start || spans ? box.y : box.y + Math.max(0, (box.h - pick.h) / 2);
  return pick.cells
    .map((cl) => {
      const out: Cell = { i: cl.i, x: cl.x + ox, y: cl.y + oy, w: cl.w, h: cl.h };
      if (cap > 0) out.cap = { x: out.x, y: out.y + out.h + capTop, w: out.w };
      return out;
    })
    .sort((p, q) => p.i - q.i);
}

function collagePlan(a: readonly number[], s: ExportSettings): ExportPlan {
  const { w: W, h: H } = pageSize(s);
  const u = Math.max(W, H) / BASE_WIDTH;
  const M = MARGIN[s.margin] * u;
  const t = typeFor(u);
  const page: Page = { w: W, h: H, cells: [] };
  let bottom = H - M;
  const bh = BRAND_H * u;
  if (s.summary) {
    const top = H - M - summaryBlock(t, u);
    page.rule = { x: M, y: top, w: W - 2 * M };
    page.summary = { x: M, y: top + 40 * u, w: W - 2 * M, big: false };
    if (s.brand) brandBesideSummary(page, W - M, t.titleLine, bh, u);
    bottom = top - sepFor(M, u);
  } else if (s.brand) {
    page.brand = { x: W - M, y: H - M - bh, h: bh };
    bottom = H - M - bh - sepFor(M, u);
  }
  const cap = s.captions ? capBlock(u, 2) : 0;
  const box = { x: M, y: M, w: W - 2 * M, h: bottom - M };
  page.cells = fillBox(a, box, collageGap(a.length, box, s.gap, u), cap, 16 * u);
  return { pages: [page], type: t, capLines: 2, shrunk: false };
}

/** 拼图的间距占“平均每幅边长”的比例：小 / 中 / 大 */
const COLLAGE_GAP_RATIO = [0.05, 0.09, 0.15];

/**
 * 拼图的间距随作品数变（2026-11-21）：一页里作品越多、每幅越小，间距跟着缩小。
 * 平均每幅的边长按“框的面积 ÷ 幅数”开方估计，间距取它的固定比例，不超过长图、网格用的那一档
 * （作品少时和那一档一样）
 */
export function collageGap(n: number, box: Rect, level: Spacing, u: number): number {
  const fixed = GAP[level] * u;
  if (n <= 0 || box.w <= 0 || box.h <= 0) return fixed;
  return Math.min(fixed, COLLAGE_GAP_RATIO[level] * Math.sqrt((box.w * box.h) / n));
}

function pdfPlan(a: readonly number[], s: ExportSettings, cover: readonly number[]): ExportPlan {
  const { w: W, h: H } = pageSize(s);
  const u = Math.max(W, H) / BASE_WIDTH;
  const M = MARGIN[s.margin] * u * 1.15;
  const t = typeFor(u);
  const pages: Page[] = [];
  const big = typeFor(u, true);
  if (s.summary) {
    // 封面：上面是几幅作品的拼图，左下角大号说明
    const sumH = big.titleLine + big.metaGap + big.metaLine;
    const top = H - M - sumH;
    const page: Page = { w: W, h: H, cells: [], summary: { x: M, y: top, w: W - 2 * M, big: true } };
    if (s.brand) brandBesideSummary(page, W - M, big.titleLine, BRAND_COVER_H * u, u);
    const picks = cover.filter((i) => i >= 0 && i < a.length).slice(0, 6);
    const cells = fillBox(picks.map((i) => a[i]), { x: M, y: M, w: W - 2 * M, h: top - 72 * u - M }, 16 * u, 0, 0, true);
    page.cells = cells.map((c) => ({ ...c, i: picks[c.i] }));
    pages.push(page);
  }
  const cap = s.captions ? capBlock(u) : 0;
  a.forEach((r, i) => {
    const bw = W - 2 * M, bh = H - 2 * M - cap;
    let w = bw, h = bw / r;
    if (h > bh) {
      h = bh;
      w = h * r;
    }
    const x = (W - w) / 2, y = M + (bh - h) / 2;
    const c: Cell = { i, x, y, w, h };
    if (s.captions) c.cap = { x, y: y + h + 16 * u, w };
    const page: Page = { w: W, h: H, cells: [c] };
    // 没有封面时每页右下角留白里一个小标识（有封面就只放封面上）
    if (s.brand && !s.summary) {
      const bh = BRAND_PAGE_H * u;
      page.brand = { x: W - M, y: H - M / 2 - bh / 2, h: bh };
    }
    pages.push(page);
  });
  return { pages, type: t, cover: s.summary ? big : undefined, capLines: 1, shrunk: false };
}

// ───────────── 情绪板导出（2026-11-21） ─────────────

/** 情绪板导出的设置（和作品导出分开记） */
export interface BoardExportSettings {
  margin: Spacing;
  summary: boolean;
  brand: boolean;
  size: ExportSize;
}

/** 情绪板导出图的长边（1× 时，px） */
export const BOARD_LONG = 2400;

export interface BoardPlan {
  page: Page;
  type: ExportType;
  /** 画布坐标 → 导出像素：px = ox + x · k */
  k: number;
  ox: number;
  oy: number;
  /** 网点：细点间距、粗点间距（导出像素），网格原点和画布原点对齐 */
  dot: number;
  dotMajor: number;
}

/** 网点：画布上细点间距是 24 × 4^j（和情绪板画布一样），挑一个让导出图上的间距落在 [18u, 72u) 的 */
const BOARD_DOT = 24;

/**
 * 情绪板按画布上的样子原样导出：content 是照片和标注合起来的范围（画布坐标），
 * 等比缩放放进一张图，长边是 BOARD_LONG × 尺寸；四周留白，下面可选说明、Peekit 标识（同长图）
 */
export function planBoardExport(content: Rect, s: BoardExportSettings): BoardPlan {
  const L = Math.round(BOARD_LONG * s.size);
  const u = L / BASE_WIDTH;
  const M = MARGIN[s.margin] * u;
  const t = typeFor(u);
  const bh = BRAND_H * u;
  const sep = sepFor(M, u);
  const extra = s.summary ? sep + summaryBlock(t, u) : s.brand ? sep + bh : 0;
  const bw = Math.max(1, content.w), bhh = Math.max(1, content.h);
  // 先按横图算（宽 = 长边），高超过长边就按竖图算（高 = 长边）
  let W = L;
  let k = (W - 2 * M) / bw;
  let H = bhh * k + 2 * M + extra;
  if (H > L) {
    H = L;
    k = Math.max(0.01, (H - 2 * M - extra) / bhh);
    W = bw * k + 2 * M;
  }
  W = Math.round(W);
  H = Math.round(H);
  const ox = M + (W - 2 * M - bw * k) / 2 - content.x * k;
  const oy = M - content.y * k;
  const page: Page = { w: W, h: H, cells: [] };
  const bottom = M + bhh * k;
  if (s.summary) {
    const ry = bottom + sep;
    page.rule = { x: M, y: ry, w: W - 2 * M };
    page.summary = { x: M, y: ry + 40 * u, w: W - 2 * M, big: false };
    if (s.brand) brandBesideSummary(page, W - M, t.titleLine, bh, u);
  } else if (s.brand) {
    page.brand = { x: W - M, y: bottom + sep, h: bh };
  }
  const j = Math.ceil(Math.log((18 * u) / (BOARD_DOT * k)) / Math.log(4));
  const dot = BOARD_DOT * Math.pow(4, j) * k;
  return { page, type: t, k, ox, oy, dot, dotMajor: dot * 4 };
}

/** 作品日期（2025.03.08 这种）→ 说明里的时间范围“2023.04 – 2025.11”；同一个月只写一个；都不知道返回空 */
export function dateRange(dates: readonly string[]): string {
  const ms = dates.map((d) => /^(\d{4})\.(\d{2})/.exec(d)).filter((m): m is RegExpExecArray => !!m).map((m) => `${m[1]}.${m[2]}`);
  if (!ms.length) return '';
  ms.sort();
  const lo = ms[0], hi = ms[ms.length - 1];
  return lo === hi ? lo : `${lo} – ${hi}`;
}

/** PDF 封面挑哪几幅：打星最高的在前（同星按原顺序），最多 6 幅，再按原顺序排回去 */
export function pickCover(ratings: readonly (number | undefined)[], max = 6): number[] {
  const idx = ratings.map((_, i) => i);
  if (idx.length <= max) return idx;
  const rated = idx.filter((i) => (ratings[i] ?? 0) > 0).sort((p, q) => (ratings[q] ?? 0) - (ratings[p] ?? 0) || p - q);
  if (rated.length >= max) return rated.slice(0, max).sort((p, q) => p - q);
  // 打星的不够：剩下的从没打星的里均匀挑
  const rest = idx.filter((i) => !((ratings[i] ?? 0) > 0));
  const need = max - rated.length;
  const even = Array.from({ length: need }, (_, k) => rest[Math.floor(((k + 0.5) * rest.length) / need)]);
  return [...rated, ...even].sort((p, q) => p - q);
}
