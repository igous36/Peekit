// 长按拖起画作后的“情绪板阵列”几何（2026-11-18 新增）。纯函数，单位 px，坐标相对窗口中心。
//
// 舞台原来的 8 × 5 玻璃格先略微散开、缩小一点（PICK_PITCH / PICK_TILE），
// 新的格子从背景里浮现，一圈圈往窗口四周扩展，直到铺满整个窗口：
// - 正中间那一行、中线左右两格：左边“新建情绪板”（松手后起名），右边“加入现有情绪板”（松手后弹出列表）
// - 其余完整露在窗口里的格子，按离中心由近到远放现有情绪板的预览（最近改过的在最里面）
// - 剩下的都是空格：拖进去直接用默认名字新建一个情绪板
import { stage } from '../tokens';

/** 阵列的格距和格宽（u）：原来 15.8 / 15，散开 1.1 倍、缩小到 0.88 */
export const PICK_PITCH = 17.4;
export const PICK_TILE = 13.2;
/** 顶部让出菜单栏（px）：这里的格子不放情绪板预览 */
export const PICK_TOP = 48;

export type PickRole = 'new' | 'add' | 'board' | 'empty';

export interface PickTile {
  /** 散开后的中心（相对窗口中心） */
  x: number;
  y: number;
  /** 出发位置：原来就在舞台上的格子从原位出发；新格子从更靠里的地方浮出来 */
  hx: number;
  hy: number;
  /** 出发时的大小（px） */
  size0: number;
  /** 是不是舞台原有的玻璃格 */
  fromStage: boolean;
  /** 离中心几个格距（涟漪延迟、收起顺序用） */
  dist: number;
  role: PickRole;
  /** role = 'board' 时是第几个情绪板（按最近修改排好的列表下标），否则 −1 */
  board: number;
  /** 整格都在窗口里 */
  full: boolean;
}

export interface PickLayout {
  tiles: PickTile[];
  /** 格宽、格距（px） */
  size: number;
  pitch: number;
  /** 最远的格子离中心几个格距 */
  maxDist: number;
}

/** 新格子从这么靠里的地方浮出来（目标位置 × 它） */
const EMERGE_FROM = 0.78;

/** homeScale：舞台镜头当前的缩放（系列视图里是 0.58），原有的玻璃格从那个位置、大小出发 */
export function pickerLayout(vw: number, vh: number, u: number, boardCount: number, homeScale = 1): PickLayout {
  const P = PICK_PITCH * u, S = PICK_TILE * u;
  const stagePitch = (stage.tile + stage.tileGap) * u * homeScale, stageSize = stage.tile * u * homeScale;
  // 列数取偶数（中线两侧对称，正中间是左右两格），最外一列的中心至少到窗口边
  const half = Math.max(stage.gridCols / 2, Math.ceil(vw / 2 / P + 0.5));
  const cols = half * 2;
  // 行数取奇数（正中间一行），最外一行的中心至少到窗口边
  const halfR = Math.max((stage.gridRows - 1) / 2, Math.ceil(vh / 2 / P));
  const rows = halfR * 2 + 1;
  const colShift = half - stage.gridCols / 2;
  const rowShift = halfR - (stage.gridRows - 1) / 2;
  const tiles: PickTile[] = [];
  let maxDist = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (c - (cols - 1) / 2) * P;
      const y = (r - halfR) * P;
      const sc = c - colShift, sr = r - rowShift;
      const fromStage = sc >= 0 && sc < stage.gridCols && sr >= 0 && sr < stage.gridRows;
      const dist = Math.hypot(x, y) / P;
      maxDist = Math.max(maxDist, dist);
      const full =
        Math.abs(x) + S / 2 <= vw / 2 - 8 && Math.abs(y) + S / 2 <= vh / 2 - 8 && y - S / 2 >= -vh / 2 + PICK_TOP;
      let role: PickRole = 'empty';
      if (r === halfR && c === half - 1) role = 'new';
      else if (r === halfR && c === half) role = 'add';
      tiles.push({
        x, y,
        hx: fromStage ? (sc - (stage.gridCols - 1) / 2) * stagePitch : x * EMERGE_FROM,
        hy: fromStage ? (sr - (stage.gridRows - 1) / 2) * stagePitch : y * EMERGE_FROM,
        size0: fromStage ? stageSize : S * 0.45,
        fromStage, dist, role, board: -1, full,
      });
    }
  }
  // 情绪板预览：完整露在窗口里的格子，离中心由近到远（同样远的从正上方顺时针）
  const slots = tiles
    .filter((t) => t.role === 'empty' && t.full)
    .sort((a, b) => a.dist - b.dist || angle(a) - angle(b));
  for (let i = 0; i < Math.min(boardCount, slots.length); i++) {
    slots[i].role = 'board';
    slots[i].board = i;
  }
  return { tiles, size: S, pitch: P, maxDist };
}

/** 从正上方开始顺时针的角度 */
const angle = (t: { x: number; y: number }): number => (Math.atan2(t.x, -t.y) + Math.PI * 2) % (Math.PI * 2);

/** 展开时每个格子开始动的延迟（ms）：原有的格子几乎同时散开，新格子按离中心的距离一圈圈浮现 */
export function openDelay(t: PickTile, firstOuter: number): number {
  return t.fromStage ? t.dist * 10 : 50 + Math.max(0, t.dist - firstOuter) * 34;
}

/** 收起时的延迟（ms）：外圈先收，里圈最后 */
export function closeDelay(t: PickTile, maxDist: number): number {
  return Math.max(0, maxDist - t.dist) * 14;
}

/** 指针在哪个格子上（按散开后的位置，格子四周各算 1/2 个缝），没有返回 −1 */
export function tileAt(tiles: readonly PickTile[], size: number, pitch: number, px: number, py: number): number {
  const reach = size / 2 + (pitch - size) / 2;
  let best = -1, bd = Infinity;
  tiles.forEach((t, i) => {
    const dx = Math.abs(px - t.x), dy = Math.abs(py - t.y);
    if (dx > reach || dy > reach) return;
    const d = dx + dy;
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}
