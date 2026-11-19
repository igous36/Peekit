// 情绪板的几何（2026-11-18 新增）。纯函数，单位是画布 px（镜头缩放为 1 时等于屏幕 px）。
//
// - 照片默认大小：和预览卡片一样按面积归一，横竖图分量相同（fitSize）
// - 吸附：一张照片贴到另一张的上下左右，留 BOARD_GAP 的缝，并且有一条边和对方在同一直线上（snapPosition）
// - 集合：互相贴着的照片是一个集合（components）
// - 最密排布：等高行（justified rows），每行的照片上下边对齐、左右两端对齐，行的划分用线性划分求最均匀（justify）
// - 一键全局优化：每个集合各自排密，再把集合当成整块按行摆开（shelfPack）
// - 推开重叠（separate）、按方向找相邻照片（neighborIn）、画布镜头（Cam）
import { clamp } from './math';
import { BoxGrid, cellFor } from './box-grid';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 吸附后两张照片之间的缝 */
export const BOARD_GAP = 12;
/** 一键全局优化后集合之间的间距 */
export const GROUP_GAP = 96;
/** 新照片的默认面积：4:5 的照片是 288 × 360 */
export const PHOTO_AREA = 288 * 360;
/** 默认大小的长边上限（很长的全景图不会太大） */
export const PHOTO_MAX_SIDE = 440;
/** 拖边调整大小：短边下限、长边上限 */
export const PHOTO_MIN_SIDE = 56;
export const PHOTO_MAX_RESIZE = 2400;
/** 吸附距离（屏幕 px，换算到画布要除以缩放） */
export const SNAP_PX = 26;
/** 拖开多远才挣脱吸附（屏幕 px）：比吸附距离大一点，在边界上不会来回跳 */
export const UNSNAP_PX = 38;
/** 判断“贴着”的容差 */
const TOL = 2;

const okAspect = (a: number): number => (a > 0 && Number.isFinite(a) ? a : 0.8);

/** 按面积归一的默认大小，长边不超过 maxSide */
export function fitSize(aspect: number, area = PHOTO_AREA, maxSide = PHOTO_MAX_SIDE): { w: number; h: number } {
  const a = okAspect(aspect);
  let w = Math.sqrt(area * a);
  let h = Math.sqrt(area / a);
  if (w > maxSide) {
    w = maxSide;
    h = maxSide / a;
  }
  if (h > maxSide) {
    h = maxSide;
    w = maxSide * a;
  }
  return { w, h };
}

/** 两个框之间留不到 pad 的距离就算重叠（贴着、正好隔 pad 不算） */
export function overlap(a: Box, b: Box, pad = 0): boolean {
  return (
    a.x < b.x + b.w + pad - TOL && b.x < a.x + a.w + pad - TOL &&
    a.y < b.y + b.h + pad - TOL && b.y < a.y + a.h + pad - TOL
  );
}

const span = (a0: number, a1: number, b0: number, b1: number): number => Math.min(a1, b1) - Math.max(a0, b0);

/** 两张照片隔着 gap 贴在一起（左右或上下，另一个方向上有重合） */
export function adjacent(a: Box, b: Box, gap = BOARD_GAP): boolean {
  const t = TOL * 2;
  const side = Math.abs(a.x + a.w + gap - b.x) <= t || Math.abs(b.x + b.w + gap - a.x) <= t;
  if (side && span(a.y, a.y + a.h, b.y, b.y + b.h) > TOL) return true;
  const stack = Math.abs(a.y + a.h + gap - b.y) <= t || Math.abs(b.y + b.h + gap - a.y) <= t;
  return stack && span(a.x, a.x + a.w, b.x, b.x + b.w) > TOL;
}

/** 连通分量（互相贴着的照片算一组），返回下标数组，每组按原顺序 */
export function components(boxes: readonly Box[], gap = BOARD_GAP): number[][] {
  const n = boxes.length;
  const parent = boxes.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  // 只和附近格子里的框比（网格索引，2026-11-19 压测后改；原来两两比较，3000 张要 40ms）
  const grid = new BoxGrid(boxes);
  const near: number[] = [];
  for (let i = 0; i < n; i++) {
    const b = boxes[i];
    near.length = 0;
    grid.query(b.x, b.y, b.w, b.h, gap + TOL * 2 + 1, near);
    for (const j of near) if (j > i && adjacent(b, boxes[j], gap)) parent[find(i)] = find(j);
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(i);
    else groups.set(r, [i]);
  }
  return [...groups.values()];
}

export function bounds(boxes: readonly Box[]): Box {
  if (!boxes.length) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** 两个框之间的最短距离（重叠为 0） */
export function boxGap(a: Box, b: Box): number {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
  return Math.hypot(dx, dy);
}

// ───────────── 吸附 ─────────────

/** 吸附时画的对齐线（画布坐标） */
export interface Guide {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Snap {
  x: number;
  y: number;
  /** 贴上去的那一张（others 里的下标） */
  target: number;
  /** 离想放的位置多远 */
  d: number;
  guides: Guide[];
}

/** 宽 w 高 h 的照片贴到 o 四周的 8 个位置：左右两侧（上边或下边对齐）、上下两侧（左边或右边对齐） */
export function snapCandidates(w: number, h: number, o: Box, gap = BOARD_GAP): { x: number; y: number; guide: Guide }[] {
  const out: { x: number; y: number; guide: Guide }[] = [];
  const right = o.x + o.w + gap, left = o.x - gap - w;
  const below = o.y + o.h + gap, above = o.y - gap - h;
  for (const x of [right, left]) {
    const x0 = Math.min(o.x, x), x1 = Math.max(o.x + o.w, x + w);
    out.push({ x, y: o.y, guide: { x1: x0, y1: o.y, x2: x1, y2: o.y } });
    out.push({ x, y: o.y + o.h - h, guide: { x1: x0, y1: o.y + o.h, x2: x1, y2: o.y + o.h } });
  }
  for (const y of [below, above]) {
    const y0 = Math.min(o.y, y), y1 = Math.max(o.y + o.h, y + h);
    out.push({ x: o.x, y, guide: { x1: o.x, y1: y0, x2: o.x, y2: y1 } });
    out.push({ x: o.x + o.w - w, y, guide: { x1: o.x + o.w, y1: y0, x2: o.x + o.w, y2: y1 } });
  }
  return out;
}

/**
 * 把左上角想放在 (px, py) 的照片吸附到最近的合法位置：距离不超过 threshold，放下后和任何照片都不重叠（至少隔 gap）。
 * 找不到返回 null。threshold = Infinity 时找最近的合法位置（松手时压在别的照片上用）
 */
export function snapPosition(
  w: number, h: number, px: number, py: number, others: readonly Box[], threshold: number, gap = BOARD_GAP, grid?: BoxGrid,
): Snap | null {
  if (threshold === Infinity) return nearestSnap(w, h, px, py, others, gap, grid);
  let best: Snap | null = null;
  const me: Box = { x: px, y: py, w, h };
  const scratch: number[] = [];
  for (let i = 0; i < others.length; i++) {
    const o = others[i];
    // 离得太远的照片不用看
    if (boxGap(me, o) > threshold + gap) continue;
    for (const c of snapCandidates(w, h, o, gap)) {
      const d = Math.hypot(c.x - px, c.y - py);
      if (d > threshold || (best && d >= best.d)) continue;
      if (freeAt({ x: c.x, y: c.y, w, h }, others, gap, grid, scratch)) best = { x: c.x, y: c.y, target: i, d, guides: [c.guide] };
    }
  }
  if (best) best.guides.push(...alignGuides({ x: best.x, y: best.y, w, h }, others, best.guides[0]));
  return best;
}

/** box 放在这里和 others 都不重叠（至少隔 gap）；有网格就只查附近的 */
export function freeAt(box: Box, others: readonly Box[], gap: number, grid?: BoxGrid, scratch: number[] = []): boolean {
  if (!grid) {
    for (const o of others) if (overlap(box, o, gap)) return false;
    return true;
  }
  scratch.length = 0;
  grid.query(box.x, box.y, box.w, box.h, gap, scratch);
  for (const j of scratch) if (overlap(box, others[j], gap)) return false;
  return true;
}

/**
 * 离 (px, py) 最近的合法吸附位置（松手时压在照片上、合成集合用）。从近到远扩大搜索半径：
 * 只拿半径内的照片生成候选，按距离排好后找第一个不重叠的；离原位不超过“半径 − 缝”的才可信
 * （更远的照片生成的候选不会比它更近），否则半径翻倍。几千张时比把所有候选都试一遍快得多
 */
function nearestSnap(w: number, h: number, px: number, py: number, others: readonly Box[], gap: number, grid?: BoxGrid): Snap | null {
  if (!others.length) return null;
  const g = grid ?? new BoxGrid(others);
  const scratch: number[] = [];
  const near: number[] = [];
  for (let r = g.cell; ; r *= 2) {
    near.length = 0;
    g.query(px, py, w, h, r, near);
    const all = near.length >= others.length;
    const cands: { x: number; y: number; d: number; target: number; guide: Guide }[] = [];
    for (const i of near) {
      for (const c of snapCandidates(w, h, others[i], gap)) cands.push({ ...c, d: Math.hypot(c.x - px, c.y - py), target: i });
    }
    cands.sort((a, b) => a.d - b.d);
    for (const c of cands) {
      if (!all && c.d > r - gap - 1) break;
      if (!freeAt({ x: c.x, y: c.y, w, h }, others, gap, g, scratch)) continue;
      const s: Snap = { x: c.x, y: c.y, target: c.target, d: c.d, guides: [c.guide] };
      s.guides.push(...alignGuides({ x: s.x, y: s.y, w, h }, others, c.guide));
      return s;
    }
    if (all) return null;
  }
}

/** 吸附后顺带对齐的其他边（和别的照片的边在同一直线上），画成额外的对齐线 */
export function alignGuides(b: Box, others: readonly Box[], skip?: Guide): Guide[] {
  const out: Guide[] = [];
  const vertical = (g: Guide) => g.x1 === g.x2;
  const same = (g: Guide) =>
    !!skip && vertical(g) === vertical(skip) && (vertical(g) ? Math.abs(g.x1 - skip.x1) < 0.5 : Math.abs(g.y1 - skip.y1) < 0.5);
  for (const o of others) {
    if (boxGap(b, o) > 400) continue;
    for (const y of [b.y, b.y + b.h]) {
      for (const oy of [o.y, o.y + o.h]) {
        if (Math.abs(y - oy) > 0.5) continue;
        const g = { x1: Math.min(b.x, o.x), y1: y, x2: Math.max(b.x + b.w, o.x + o.w), y2: y };
        if (!same(g) && !out.some((q) => q.y1 === q.y2 && Math.abs(q.y1 - y) < 0.5)) out.push(g);
      }
    }
    for (const x of [b.x, b.x + b.w]) {
      for (const ox of [o.x, o.x + o.w]) {
        if (Math.abs(x - ox) > 0.5) continue;
        const g = { x1: x, y1: Math.min(b.y, o.y), x2: x, y2: Math.max(b.y + b.h, o.y + o.h) };
        if (!same(g) && !out.some((q) => q.x1 === q.x2 && Math.abs(q.x1 - x) < 0.5)) out.push(g);
      }
    }
  }
  return out.slice(0, 4);
}

// ───────────── 最密排布：等高行 ─────────────

/**
 * 线性划分：把 a 按顺序切成 k 段，每段的和尽量接近平均值（平方误差最小），返回每段的下标。
 * O(k·n²)，几百张照片也很快
 */
export function linearPartition(a: readonly number[], k: number): number[][] {
  const n = a.length;
  k = clamp(Math.round(k), 1, Math.max(1, n));
  if (n === 0) return [];
  const pre = [0];
  for (const v of a) pre.push(pre[pre.length - 1] + v);
  const avg = pre[n] / k;
  const cost = (i: number, j: number) => (pre[j] - pre[i] - avg) ** 2;
  // 2026-11-19 压测后改：一行的宽高比之和只在 [0.4 × 平均, 1.6 × 平均 + 最宽一张] 里找断点（最优解基本不会超出这个范围），
  // 从 O(k·n²) 降到约 O(n²)、常数小得多；万一这样分不出来，再退回不限范围
  const maxA = Math.max(...a);
  const rows = partitionDp(pre, k, cost, 0.4 * avg, 1.6 * avg + maxA) ?? partitionDp(pre, k, cost, 0, Infinity)!;
  return rows;
}

function partitionDp(
  pre: readonly number[], k: number, cost: (i: number, j: number) => number, lo: number, hi: number,
): number[][] | null {
  const n = pre.length - 1;
  // dp[r][j]：前 j 个分成 r 段的最小代价
  const dp: number[][] = [];
  const cut: number[][] = [];
  for (let r = 0; r <= k; r++) {
    dp.push(new Array(n + 1).fill(Infinity));
    cut.push(new Array(n + 1).fill(0));
  }
  dp[0][0] = 0;
  for (let r = 1; r <= k; r++) {
    for (let j = r; j <= n; j++) {
      // 从 j − 1 往前，这一行的和超过 hi 就停（前缀和单调）
      for (let i = j - 1; i >= r - 1; i--) {
        const sum = pre[j] - pre[i];
        if (sum > hi && i < j - 1) break;
        if (sum < lo && i > r - 1) continue;
        const v = dp[r - 1][i] + cost(i, j);
        if (v < dp[r][j]) {
          dp[r][j] = v;
          cut[r][j] = i;
        }
      }
    }
  }
  if (!Number.isFinite(dp[k][n])) return null;
  const rows: number[][] = [];
  let j = n;
  for (let r = k; r >= 1; r--) {
    const i = cut[r][j];
    const row: number[] = [];
    for (let x = i; x < j; x++) row.push(x);
    rows.unshift(row);
    j = i;
  }
  return rows;
}

/**
 * 按行摆：所有行同宽 W，每行等高（行高 = 可用宽度 / 这一行宽高比之和），
 * W 取让平均每张照片面积等于 area 的那个值（解一元二次方程）
 */
function layoutRows(a: readonly number[], rows: readonly number[][], gap: number, area: number): Box[] {
  let s1 = 0, sg = 0, sg2 = 0;
  const sums = rows.map((r) => r.reduce((s, i) => s + a[i], 0));
  rows.forEach((r, j) => {
    const g = gap * (r.length - 1);
    s1 += 1 / sums[j];
    sg += g / sums[j];
    sg2 += (g * g) / sums[j];
  });
  const n = a.length;
  const disc = sg * sg - s1 * (sg2 - n * area);
  const W = (sg + Math.sqrt(Math.max(0, disc))) / s1;
  const out: Box[] = new Array(n);
  let y = 0;
  rows.forEach((r, j) => {
    const h = (W - gap * (r.length - 1)) / sums[j];
    let x = 0;
    for (const i of r) {
      const w = h * a[i];
      out[i] = { x, y, w, h };
      x += w + gap;
    }
    // 消掉浮点误差：最后一张的右边正好落在 W
    const last = out[r[r.length - 1]];
    last.w = W - last.x;
    y += h + gap;
  });
  return out;
}

/**
 * 最密排布：等高行。aspects 按阅读顺序给，结果和它一一对应，左上角在 (0, 0)。
 * 整体外形尽量接近 targetAspect，行高尽量一致；平均每张照片面积 area
 */
export function justify(aspects: readonly number[], targetAspect = 1.5, gap = BOARD_GAP, area = PHOTO_AREA): Box[] {
  const n = aspects.length;
  if (!n) return [];
  const a = aspects.map(okAspect);
  const S = a.reduce((s, v) => s + v, 0);
  const k0 = clamp(Math.round(Math.sqrt(S / targetAspect)), 1, n);
  let best: Box[] = [];
  let bestScore = Infinity;
  // 照片很多时只试一种行数（每种都要跑一遍划分；几千张时三种要好几百毫秒，外形差别也很小）
  for (const k of n > 600 ? [k0] : [k0 - 1, k0, k0 + 1]) {
    if (k < 1 || k > n) continue;
    const rows = linearPartition(a, k);
    const boxes = layoutRows(a, rows, gap, area);
    const bb = bounds(boxes);
    const hs = rows.map((r) => Math.log(boxes[r[0]].h));
    const mean = hs.reduce((s, v) => s + v, 0) / hs.length;
    const spread = Math.sqrt(hs.reduce((s, v) => s + (v - mean) ** 2, 0) / hs.length);
    const score = Math.abs(Math.log(bb.w / bb.h / targetAspect)) + 0.8 * spread;
    if (score < bestScore) {
      bestScore = score;
      best = boxes;
    }
  }
  return best;
}

/** 按阅读顺序排：先按行（中心 y 落在同一带里的算一行），行内从左到右 */
export function readingOrder(boxes: readonly Box[]): number[] {
  const idx = boxes.map((_, i) => i).sort((i, j) => boxes[i].y + boxes[i].h / 2 - (boxes[j].y + boxes[j].h / 2));
  const rows: number[][] = [];
  for (const i of idx) {
    const b = boxes[i];
    const cy = b.y + b.h / 2;
    const row = rows[rows.length - 1];
    if (row) {
      const r0 = boxes[row[0]];
      if (Math.abs(cy - (r0.y + r0.h / 2)) < Math.min(b.h, r0.h) * 0.5) {
        row.push(i);
        continue;
      }
    }
    rows.push([i]);
  }
  return rows.flatMap((r) => r.sort((i, j) => boxes[i].x - boxes[j].x));
}

/**
 * 把一组照片重新排密：按现在的阅读顺序做等高行，左上角对齐原来的外框左上角，
 * 外形比例沿用原来外框的比例（限制在 0.6–2.4 之间），平均面积沿用原来的平均面积
 */
export function repack(boxes: readonly Box[], aspects: readonly number[], gap = BOARD_GAP): Box[] {
  if (!boxes.length) return [];
  const order = readingOrder(boxes);
  const bb = bounds(boxes);
  const area = boxes.reduce((s, b) => s + b.w * b.h, 0) / boxes.length;
  const target = clamp(bb.w / Math.max(1, bb.h), 0.6, 2.4);
  const packed = justify(order.map((i) => aspects[i]), boxes.length === 1 ? aspects[0] : target, gap, area);
  const pb = bounds(packed);
  // 新外框的中心放在原来外框的中心
  const ox = bb.x + bb.w / 2 - pb.w / 2, oy = bb.y + bb.h / 2 - pb.h / 2;
  const out: Box[] = new Array(boxes.length);
  order.forEach((i, k) => {
    const p = packed[k];
    out[i] = { x: p.x + ox, y: p.y + oy, w: p.w, h: p.h };
  });
  return out;
}

/**
 * 合成一个集合（2026-11-18）：大小都不变，从离整体中心最近的那张开始，其余按离中心由近到远，
 * 每张贴到已经放好的照片旁边离它原来位置最近的合法吸附位置（隔一条缝、有一条边对齐）。
 * 已经贴着放好的照片、又不压到别的，就留在原地。结果连成一片，相对位置大致不变。返回每张的新左上角
 */
export function gather(boxes: readonly Box[], gap = BOARD_GAP): { x: number; y: number }[] {
  const n = boxes.length;
  if (!n) return [];
  const bb = bounds(boxes);
  const cx = bb.x + bb.w / 2, cy = bb.y + bb.h / 2;
  const dist = (b: Box) => Math.hypot(b.x + b.w / 2 - cx, b.y + b.h / 2 - cy);
  const order = boxes.map((_, i) => i).sort((i, j) => dist(boxes[i]) - dist(boxes[j]));
  const placed: Box[] = [];
  const grid = new BoxGrid(placed, cellFor(boxes), n, false);
  const near: number[] = [];
  const out: { x: number; y: number }[] = new Array(n);
  for (const i of order) {
    const b = boxes[i];
    near.length = 0;
    grid.query(b.x, b.y, b.w, b.h, gap + TOL * 2 + 1, near);
    const stay = !placed.length || (near.some((j) => adjacent(placed[j], b, gap)) && !near.some((j) => overlap(placed[j], b, gap)));
    const s = stay ? null : snapPosition(b.w, b.h, b.x, b.y, placed, Infinity, gap, grid);
    const x = s ? s.x : b.x, y = s ? s.y : b.y;
    out[i] = { x, y };
    placed.push({ x, y, w: b.w, h: b.h });
    grid.insert(placed.length - 1);
  }
  return out;
}

/**
 * 整块摆放（一键全局优化里摆集合）：按顺序一行行放，行宽取让整体接近 targetAspect 的值，每行水平居中、上边对齐。
 * 返回每块左上角，整体中心在 (0, 0)
 */
export function shelfPack(blocks: readonly { w: number; h: number }[], gap = GROUP_GAP, targetAspect = 1.6): { x: number; y: number }[] {
  if (!blocks.length) return [];
  const area = blocks.reduce((s, b) => s + (b.w + gap) * (b.h + gap), 0);
  const maxW = Math.max(...blocks.map((b) => b.w));
  const rowW = Math.max(maxW, Math.sqrt(area * targetAspect));
  const rows: { items: number[]; w: number; h: number }[] = [];
  let cur = { items: [] as number[], w: 0, h: 0 };
  blocks.forEach((b, i) => {
    const nw = cur.items.length ? cur.w + gap + b.w : b.w;
    if (cur.items.length && nw > rowW) {
      rows.push(cur);
      cur = { items: [], w: 0, h: 0 };
    }
    cur.w = cur.items.length ? cur.w + gap + b.w : b.w;
    cur.h = Math.max(cur.h, b.h);
    cur.items.push(i);
  });
  rows.push(cur);
  const totalW = Math.max(...rows.map((r) => r.w));
  const totalH = rows.reduce((s, r) => s + r.h, 0) + gap * (rows.length - 1);
  const out: { x: number; y: number }[] = new Array(blocks.length);
  let y = -totalH / 2;
  for (const r of rows) {
    let x = -totalW / 2 + (totalW - r.w) / 2;
    for (const i of r.items) {
      out[i] = { x, y };
      x += blocks[i].w + gap;
    }
    y += r.h + gap;
  }
  return out;
}

/**
 * 推开重叠：fixed[i] 为 true 的框不动，其余沿穿透最浅的方向推开，至少隔 gap。
 * 两个都能动时各让一半。返回每个框的位移
 */
export function separate(boxes: readonly Box[], fixed: readonly boolean[], gap: number, iterations = 48): { dx: number; dy: number }[] {
  const b = boxes.map((x) => ({ ...x }));
  const near: number[] = [];
  for (let it = 0; it < iterations; it++) {
    let moved = false;
    // 每轮按当前位置重建网格，只和附近的比（2026-11-19 压测后改：3000 张两两比较一次要 0.75 秒）。
    // 这一轮里被推动过的框可能漏掉几对，下一轮会补上；没有任何移动的那一轮网格是准确的，所以结束时一定没有重叠
    const grid = new BoxGrid(b, cellFor(b));
    for (let i = 0; i < b.length; i++) {
      near.length = 0;
      const bi = b[i];
      grid.query(bi.x, bi.y, bi.w, bi.h, gap + 1, near);
      for (const j of near) {
        if (j === i || (fixed[i] && fixed[j])) continue;
        const p = b[i], q = b[j];
        if (!overlap(p, q, gap)) continue;
        const px = Math.min(p.x + p.w + gap - q.x, q.x + q.w + gap - p.x);
        const py = Math.min(p.y + p.h + gap - q.y, q.y + q.h + gap - p.y);
        const alongX = px <= py;
        const amount = (alongX ? px : py) + 0.5;
        const dirQ = alongX
          ? (q.x + q.w / 2 >= p.x + p.w / 2 ? 1 : -1)
          : (q.y + q.h / 2 >= p.y + p.h / 2 ? 1 : -1);
        const shareQ = fixed[i] ? 1 : fixed[j] ? 0 : 0.5;
        const shareP = 1 - shareQ;
        if (alongX) {
          q.x += dirQ * amount * shareQ;
          p.x -= dirQ * amount * shareP;
        } else {
          q.y += dirQ * amount * shareQ;
          p.y -= dirQ * amount * shareP;
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
  return b.map((x, i) => ({ dx: x.x - boxes[i].x, dy: x.y - boxes[i].y }));
}

/** 离 (x, y) 最近的照片（点在框里距离为 0，同样近的取中心更近的）；没有照片返回 −1 */
export function nearestBox(boxes: readonly Box[], x: number, y: number): number {
  let best = -1, bd = Infinity;
  boxes.forEach((b, i) => {
    const dx = Math.max(b.x - x, 0, x - b.x - b.w);
    const dy = Math.max(b.y - y, 0, y - b.y - b.h);
    const d = Math.hypot(dx, dy) * 4 + Math.hypot(b.x + b.w / 2 - x, b.y + b.h / 2 - y);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

/** 从第 from 张往 (dx, dy) 方向找下一张：在方向两侧约 50° 的扇形里，沿方向近、偏离少的优先；没有返回 −1 */
export function neighborIn(boxes: readonly Box[], from: number, dx: number, dy: number): number {
  const f = boxes[from];
  if (!f) return -1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
  let best = -1, bs = Infinity;
  boxes.forEach((b, i) => {
    if (i === from) return;
    const vx = b.x + b.w / 2 - cx, vy = b.y + b.h / 2 - cy;
    const along = vx * ux + vy * uy;
    if (along <= 1) return;
    const perp = Math.abs(vx * uy - vy * ux);
    if (perp > along * 1.2) return;
    const s = along + perp * 2;
    if (s < bs) {
      bs = s;
      best = i;
    }
  });
  return best;
}

// ───────────── 画布镜头 ─────────────

/** 镜头：屏幕中心对着画布上的 (x, y)，缩放 z */
export interface Cam {
  x: number;
  y: number;
  z: number;
}

export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 8;

export function toScreen(c: Cam, wx: number, wy: number, vw: number, vh: number): { x: number; y: number } {
  return { x: (wx - c.x) * c.z + vw / 2, y: (wy - c.y) * c.z + vh / 2 };
}

export function toWorld(c: Cam, sx: number, sy: number, vw: number, vh: number): { x: number; y: number } {
  return { x: (sx - vw / 2) / c.z + c.x, y: (sy - vh / 2) / c.z + c.y };
}

/** 以屏幕上的 (sx, sy) 为中心缩放到 z：光标下的那一点不动 */
export function zoomAround(c: Cam, z: number, sx: number, sy: number, vw: number, vh: number): Cam {
  const nz = clamp(z, ZOOM_MIN, ZOOM_MAX);
  const w = toWorld(c, sx, sy, vw, vh);
  return { x: w.x - (sx - vw / 2) / nz, y: w.y - (sy - vh / 2) / nz, z: nz };
}

/**
 * 把框放进窗口：四周留 pad，顶部再让出 top（菜单栏），缩放不超过 zMax。
 * 空框（没有照片）回到原点、缩放 1
 */
export function fitCam(b: Box, vw: number, vh: number, pad = 72, top = 56, zMax = 1.25): Cam {
  if (b.w <= 0 || b.h <= 0) return { x: 0, y: 0, z: 1 };
  const aw = Math.max(80, vw - pad * 2), ah = Math.max(80, vh - pad * 2 - top);
  const z = clamp(Math.min(aw / b.w, ah / b.h, zMax), ZOOM_MIN, ZOOM_MAX);
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 - top / 2 / z, z };
}

/** 单张放大（聚焦）：照片占窗口高度的 frac（宽度不超过 0.82 窗宽），居中，顶部让出 top */
export function focusCam(b: Box, vw: number, vh: number, frac = 0.72, top = 56): Cam {
  const z = clamp(Math.min(((vh - top) * frac) / b.h, (vw * 0.82) / b.w), ZOOM_MIN, ZOOM_MAX);
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 - top / 2 / z, z };
}
