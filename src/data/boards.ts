// 情绪板（2026-11-18 新增）：保存格式和增删改。纯函数，直接改传进来的数据，不碰 Tauri 和 DOM。
//
// 情绪板和预览集互相独立：照片按文件路径记（同一张图可以出现在不同的情绪板里，但同一个情绪板里只放一次），
// 从预览集里移除作品不影响情绪板。全部存在 library.json 的 "boards" key 里。
//
// 每张照片记在画布上的位置和大小，以及属于哪个集合（group）。互相贴着的照片是一个集合，
// 集合决定描边、泛光和阴影的颜色（GROUP_COLORS 的下标）。
import type { Shape } from './types';
import { t } from '../i18n';
import {
  BOARD_GAP, GROUP_GAP, adjacent, bounds, components, fitSize, justify, overlap, type Box,
} from '../engine/board-layout';
import { BoxGrid } from '../engine/box-grid';
import { parseMarks, type BoardMark } from '../engine/marks';

export const BOARDS_VERSION = 1;
/** 情绪板名字的长度上限（和预览集一样） */
export const BOARD_NAME_MAX = 24;

/**
 * 集合的颜色：描边、泛光、阴影的色调（2026-11-18）。
 * 明度、饱和度接近，在浅色和深色底上都看得清；相邻两个色相隔得开，新集合取用得最少的那个
 */
export const GROUP_COLORS = [
  '#E2A23B', '#4C9BE0', '#9A7BE8', '#E0668A', '#3DB896', '#E27841', '#6A88EE', '#A9BE3A', '#CF6AC8', '#3FAEC2',
] as const;

export interface BoardItem {
  id: string;
  /** 原图路径（桌面版） */
  path?: string;
  /** 浏览器调试用：示例作品的 id 和色块 */
  ref?: string;
  shapes?: Shape[];
  title: string;
  /** 原图像素尺寸（已按 EXIF 方向换算），决定比例 */
  pw: number;
  ph: number;
  /** 缩略图缓存键要用 */
  mtime?: number;
  size?: number;
  /** 主色：图片还没加载出来时的底色 */
  color?: string;
  /** 画布上的位置和大小（左上角，画布 px） */
  x: number;
  y: number;
  w: number;
  h: number;
  group: string;
  addedAt: number;
}

export interface BoardGroup {
  id: string;
  /** GROUP_COLORS 的下标 */
  color: number;
}

export interface Board {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** 画的先后顺序：后面的盖在前面的上面 */
  items: BoardItem[];
  groups: BoardGroup[];
  /** 上次关掉时的镜头 */
  cam?: { x: number; y: number; z: number };
  /** 标注（2026-11-20）：便签、箭头和直线、色卡、手绘，画在照片上面（engine/marks.ts） */
  marks?: BoardMark[];
}

export interface SavedBoards {
  version: number;
  boards: Board[];
}

/** 加照片时的来源：一张图片的基本信息 */
export interface PhotoSource {
  path?: string;
  ref?: string;
  shapes?: Shape[];
  title: string;
  pw: number;
  ph: number;
  mtime?: number;
  size?: number;
  color?: string;
}

const rid = (p: string) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const newBoardId = (): string => rid('board-');
export const newItemId = (): string => rid('bi-');
export const newGroupId = (): string => rid('g-');

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const num = (x: unknown, d = 0): number => (typeof x === 'number' && Number.isFinite(x) ? x : d);

export function emptyBoards(): SavedBoards {
  return { version: BOARDS_VERSION, boards: [] };
}

/** 读回来的数据做一遍校验：格式不对的情绪板 / 照片丢掉，别的照常用 */
export function parseBoards(raw: unknown): SavedBoards {
  if (!isObj(raw) || raw.version !== BOARDS_VERSION || !Array.isArray(raw.boards)) return emptyBoards();
  const boards: Board[] = [];
  for (const b of raw.boards) {
    if (!isObj(b) || typeof b.id !== 'string' || typeof b.name !== 'string' || !Array.isArray(b.items)) continue;
    const items: BoardItem[] = [];
    for (const it of b.items) {
      if (!isObj(it) || typeof it.id !== 'string' || typeof it.group !== 'string') continue;
      if (typeof it.path !== 'string' && typeof it.ref !== 'string') continue;
      const w = num(it.w), h = num(it.h);
      if (w <= 0 || h <= 0) continue;
      items.push({
        id: it.id,
        path: typeof it.path === 'string' ? it.path : undefined,
        ref: typeof it.ref === 'string' ? it.ref : undefined,
        shapes: Array.isArray(it.shapes) ? (it.shapes as Shape[]) : undefined,
        title: typeof it.title === 'string' ? it.title : '',
        pw: num(it.pw, w), ph: num(it.ph, h),
        mtime: typeof it.mtime === 'number' ? it.mtime : undefined,
        size: typeof it.size === 'number' ? it.size : undefined,
        color: typeof it.color === 'string' ? it.color : undefined,
        x: num(it.x), y: num(it.y), w, h,
        group: it.group,
        addedAt: num(it.addedAt),
      });
    }
    const groups: BoardGroup[] = Array.isArray(b.groups)
      ? b.groups.filter(isObj).filter((g) => typeof g.id === 'string').map((g) => ({
        id: g.id as string, color: Math.abs(Math.round(num(g.color))) % GROUP_COLORS.length,
      }))
      : [];
    const cam = isObj(b.cam) && num(b.cam.z) > 0 ? { x: num(b.cam.x), y: num(b.cam.y), z: num(b.cam.z) } : undefined;
    const marks = parseMarks(b.marks);
    const board: Board = {
      id: b.id, name: b.name.slice(0, BOARD_NAME_MAX), createdAt: num(b.createdAt), updatedAt: num(b.updatedAt),
      items, groups, cam, ...(marks.length ? { marks } : {}),
    };
    // 照片引用了不存在的集合：补上
    for (const it of items) if (!board.groups.some((g) => g.id === it.group)) addGroup(board, it.group);
    pruneGroups(board);
    boards.push(board);
  }
  return { version: BOARDS_VERSION, boards };
}

/** 最近改过的在前 */
export function boardsByRecent(data: SavedBoards): Board[] {
  return [...data.boards].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** base、base 2、base 3 …里第一个还没被用过的名字 */
export function uniqueBoardName(data: SavedBoards, base?: string): string {
  const b = (base ?? '').trim().slice(0, BOARD_NAME_MAX) || t('board.defaultName');
  const names = new Set(data.boards.map((x) => x.name));
  if (!names.has(b)) return b;
  for (let k = 2; ; k++) {
    const suffix = ` ${k}`;
    const name = b.slice(0, BOARD_NAME_MAX - suffix.length) + suffix;
    if (!names.has(name)) return name;
  }
}

export function createBoard(data: SavedBoards, name?: string, now = Date.now()): Board {
  const b: Board = {
    id: newBoardId(), name: uniqueBoardName(data, name), createdAt: now, updatedAt: now, items: [], groups: [],
  };
  data.boards.push(b);
  return b;
}

export function renameBoard(data: SavedBoards, id: string, name: string): boolean {
  const b = data.boards.find((x) => x.id === id);
  const v = name.trim().slice(0, BOARD_NAME_MAX);
  if (!b || !v || v === b.name) return false;
  b.name = v;
  return true;
}

/** 复制一份（名字是「xxx 副本」），放在原来那个后面；找不到返回 null */
export function duplicateBoard(data: SavedBoards, id: string, now = Date.now()): Board | null {
  const i = data.boards.findIndex((x) => x.id === id);
  if (i < 0) return null;
  const src = data.boards[i];
  const copy: Board = {
    ...structuredClone(src),
    id: newBoardId(),
    name: uniqueBoardName(data, t('sets.copyName', { name: src.name })),
    createdAt: now,
    updatedAt: now,
  };
  copy.items = copy.items.map((it) => ({ ...it, id: newItemId() }));
  data.boards.splice(i + 1, 0, copy);
  return copy;
}

export function deleteBoard(data: SavedBoards, id: string): Board | null {
  const i = data.boards.findIndex((x) => x.id === id);
  if (i < 0) return null;
  return data.boards.splice(i, 1)[0];
}

/** 同一张图（同一个文件 / 同一幅示例作品）已经在这个情绪板里了 */
export function hasPhoto(b: Board, p: { path?: string; ref?: string }): boolean {
  return b.items.some((it) => (p.path && it.path === p.path) || (!p.path && p.ref && it.ref === p.ref));
}

// ───────────── 集合 ─────────────

export function groupColor(b: Board, groupId: string): string {
  const g = b.groups.find((x) => x.id === groupId);
  return GROUP_COLORS[(g?.color ?? 0) % GROUP_COLORS.length];
}

/** 新集合的颜色：现有集合里用得最少的（一样少取靠前的），避开 avoid 里的颜色 */
export function pickGroupColor(b: Board, avoid: readonly number[] = []): number {
  const used = new Array<number>(GROUP_COLORS.length).fill(0);
  for (const g of b.groups) used[g.color % GROUP_COLORS.length]++;
  let best = 0, bu = Infinity;
  for (let i = 0; i < GROUP_COLORS.length; i++) {
    const u = used[i] + (avoid.includes(i) ? 1000 : 0);
    if (u < bu) {
      bu = u;
      best = i;
    }
  }
  return best;
}

export function addGroup(b: Board, id = newGroupId(), avoid: readonly number[] = []): BoardGroup {
  const g = { id, color: pickGroupColor(b, avoid) };
  b.groups.push(g);
  return g;
}

/** 去掉没有照片的集合 */
export function pruneGroups(b: Board): void {
  const used = new Set(b.items.map((it) => it.group));
  b.groups = b.groups.filter((g) => used.has(g.id));
}

export const membersOf = (b: Board, groupId: string): BoardItem[] => b.items.filter((it) => it.group === groupId);

/**
 * 集合拆分：groupIds 里的每个集合按“互相贴着”重新算连通分量，断开了就拆成几个集合。
 * 照片最多的那一块保留原来的 id 和颜色，其余的换新集合（颜色避开原来的）。返回新建的集合 id
 */
export function splitGroups(b: Board, groupIds: Iterable<string>): string[] {
  const created: string[] = [];
  for (const gid of new Set(groupIds)) {
    const members = membersOf(b, gid);
    if (members.length < 2) continue;
    const comps = components(members, BOARD_GAP).sort((p, q) => q.length - p.length);
    if (comps.length < 2) continue;
    const base = b.groups.find((g) => g.id === gid)?.color ?? 0;
    for (const comp of comps.slice(1)) {
      const g = addGroup(b, newGroupId(), [base]);
      for (const i of comp) members[i].group = g.id;
      created.push(g.id);
    }
  }
  pruneGroups(b);
  return created;
}

/** 把 from 集合并进 into（颜色用 into 的） */
export function mergeGroups(b: Board, into: string, from: Iterable<string>): void {
  const set = new Set(from);
  set.delete(into);
  if (!set.size) return;
  for (const it of b.items) if (set.has(it.group)) it.group = into;
  pruneGroups(b);
}

/** 和这张照片贴着的照片所在的集合（不含它自己的） */
export function touchingGroups(b: Board, item: BoardItem): string[] {
  const out = new Set<string>();
  for (const o of b.items) {
    if (o === item || o.group === item.group) continue;
    if (Math.abs(o.x - item.x) > 4000) continue;
    if (adjacent(item, o, BOARD_GAP)) out.add(o.group);
  }
  return [...out];
}


// ───────────── 加照片 ─────────────

/**
 * 在 near 附近找一块空地放下 w × h（左上角），和别的照片至少隔 pad。
 * 从 near 出发绕圈找，步长随圈数变大；找不到就放到所有照片的右边
 */
export function findFreeSpot(b: Board, w: number, h: number, near: { x: number; y: number }, pad = GROUP_GAP / 2): { x: number; y: number } {
  const boxes = b.items as readonly Box[];
  // 照片多的时候用网格只查附近的（2026-11-19 压测后改：几千张时每个候选位置都和所有照片比太慢）
  const grid = boxes.length > 32 ? new BoxGrid(boxes) : null;
  const hits: number[] = [];
  const fits = (x: number, y: number) => {
    const me = { x, y, w, h };
    if (!grid) return !boxes.some((o) => overlap(me, o, pad));
    hits.length = 0;
    grid.query(x, y, w, h, pad, hits);
    return !hits.some((i) => overlap(me, boxes[i], pad));
  };
  const x0 = near.x - w / 2, y0 = near.y - h / 2;
  if (fits(x0, y0)) return { x: x0, y: y0 };
  const step = Math.max(24, Math.min(w, h) / 3);
  for (let ring = 1; ring < 60; ring++) {
    const r = ring * step;
    const n = Math.max(8, Math.round((2 * Math.PI * r) / step));
    let best: { x: number; y: number } | null = null, bd = Infinity;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const x = x0 + Math.cos(a) * r, y = y0 + Math.sin(a) * r * 0.8;
      if (!fits(x, y)) continue;
      // 同一圈里优先水平方向（画布通常是横着铺开的）
      const d = Math.abs(Math.sin(a));
      if (d < bd) {
        bd = d;
        best = { x, y };
      }
    }
    if (best) return best;
  }
  const bb = bounds(boxes);
  return { x: bb.x + bb.w + pad, y: bb.y };
}

/**
 * 加照片：一张时按默认大小放在 near 附近的空地，自己成一个集合（不会自动吸附到别的集合上）；
 * 多张时按最密结构（等高行）排成一块，成一个新集合。已经在情绪板里的图跳过。
 * near 默认是现有照片的中心（空画布是原点）。返回新加的照片
 */
export function addPhotos(b: Board, photos: readonly PhotoSource[], near?: { x: number; y: number }, now = Date.now()): BoardItem[] {
  const seen = new Set<string>();
  const fresh = photos.filter((p) => {
    const key = p.path ?? `ref:${p.ref}`;
    if (seen.has(key) || hasPhoto(b, p)) return false;
    seen.add(key);
    return true;
  });
  if (!fresh.length) return [];
  let at = near;
  if (!at) {
    const bb = bounds(b.items);
    at = b.items.length ? { x: bb.x + bb.w / 2, y: bb.y + bb.h / 2 } : { x: 0, y: 0 };
  }
  const g = addGroup(b);
  const aspects = fresh.map((p) => (p.pw > 0 && p.ph > 0 ? p.pw / p.ph : 0.8));
  const boxes = fresh.length === 1 ? [{ x: 0, y: 0, ...fitSize(aspects[0]) }] : justify(aspects, 1.5);
  const bb = bounds(boxes);
  const spot = findFreeSpot(b, bb.w, bb.h, at);
  const items = fresh.map((p, i): BoardItem => ({
    id: newItemId(),
    path: p.path, ref: p.ref, shapes: p.shapes,
    title: p.title, pw: p.pw, ph: p.ph, mtime: p.mtime, size: p.size, color: p.color,
    x: spot.x + boxes[i].x - bb.x, y: spot.y + boxes[i].y - bb.y, w: boxes[i].w, h: boxes[i].h,
    group: g.id, addedAt: now,
  }));
  b.items.push(...items);
  b.updatedAt = now;
  return items;
}

/** 移除照片，断开的集合拆开。返回被移除的照片（撤销用） */
export function removeItems(b: Board, ids: ReadonlySet<string>, now = Date.now()): BoardItem[] {
  const gone = b.items.filter((it) => ids.has(it.id));
  if (!gone.length) return [];
  b.items = b.items.filter((it) => !ids.has(it.id));
  splitGroups(b, gone.map((it) => it.group));
  pruneGroups(b);
  b.updatedAt = now;
  return gone;
}
