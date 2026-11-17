// 预览集（2026-11-17 新增）：每个预览集是一套独立的作品库——自己的导入来源、系列、作品归属和标题。
// 全部存在同一个 library.json 里（key "sets"，version 3）。纯函数，直接改传进来的数据。
//
// 旧版（v2，只有一个作品库，key "library"）会迁移成第一个预览集；旧 key 原样保留不删，方便回退。
import { emptySaved, parseSaved, type SavedLibrary } from './library';
import { t } from '../i18n';

export const SETS_VERSION = 3;
/** 预览集名字的长度上限 */
export const SET_NAME_MAX = 24;

export interface PreviewSet {
  id: string;
  name: string;
  createdAt: number;
  /** 上次扫描到的作品数（切换器里显示，不用先扫描） */
  count: number;
  library: SavedLibrary;
}

export interface SavedSets {
  version: number;
  current: string;
  sets: PreviewSet[];
}

export function newSetId(): string {
  return 'set-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

function makeSet(name: string, makeId: () => string, library: SavedLibrary = emptySaved()): PreviewSet {
  return { id: makeId(), name: name.slice(0, SET_NAME_MAX), createdAt: Date.now(), count: 0, library };
}

/** 校验读回来的 v3 数据；格式不对返回 null */
export function parseSets(raw: unknown): SavedSets | null {
  if (!isObj(raw) || raw.version !== SETS_VERSION || !Array.isArray(raw.sets) || typeof raw.current !== 'string') return null;
  const sets: PreviewSet[] = [];
  for (const s of raw.sets) {
    if (!isObj(s) || typeof s.id !== 'string' || typeof s.name !== 'string') return null;
    const library = parseSaved(s.library);
    if (!library) return null;
    sets.push({
      id: s.id,
      name: s.name,
      createdAt: typeof s.createdAt === 'number' ? s.createdAt : 0,
      count: typeof s.count === 'number' ? s.count : Object.keys(library.works).length,
      library,
    });
  }
  if (sets.length === 0) return null;
  const current = sets.some((s) => s.id === raw.current) ? raw.current : sets[0].id;
  return { version: SETS_VERSION, current, sets };
}

/**
 * 启动时：有 v3 就用 v3；没有就把旧的 v2 作品库迁移成第一个预览集「我的作品」；都没有就建一个空的。
 */
export function loadSets(rawSets: unknown, rawLegacy: unknown, makeId: () => string = newSetId): SavedSets {
  const v3 = parseSets(rawSets);
  if (v3) return v3;
  const legacy = parseSaved(rawLegacy);
  const first = makeSet(t('sets.defaultName'), makeId, legacy ?? emptySaved());
  if (legacy) first.count = Object.keys(legacy.works).length;
  return { version: SETS_VERSION, current: first.id, sets: [first] };
}

export function currentSet(s: SavedSets): PreviewSet {
  return s.sets.find((x) => x.id === s.current) ?? s.sets[0];
}

/** base、base 2、base 3 …里第一个还没被用过的名字 */
export function uniqueSetName(s: SavedSets, base: string): string {
  const b = base.trim().slice(0, SET_NAME_MAX) || t('sets.newName');
  const names = new Set(s.sets.map((x) => x.name));
  if (!names.has(b)) return b;
  for (let k = 2; ; k++) {
    const suffix = ` ${k}`;
    const name = b.slice(0, SET_NAME_MAX - suffix.length) + suffix;
    if (!names.has(name)) return name;
  }
}

/** 新建一个空的预览集（不切换过去） */
export function createSet(s: SavedSets, name?: string, makeId: () => string = newSetId): PreviewSet {
  const set = makeSet(uniqueSetName(s, name ?? t('sets.newName')), makeId);
  s.sets.push(set);
  return set;
}

/** 改名：去掉首尾空白；空名字不改，返回是否改了 */
export function renameSet(s: SavedSets, id: string, name: string): boolean {
  const set = s.sets.find((x) => x.id === id);
  const v = name.trim().slice(0, SET_NAME_MAX);
  if (!set || !v || v === set.name) return false;
  set.name = v;
  return true;
}

export function setCurrent(s: SavedSets, id: string): boolean {
  if (!s.sets.some((x) => x.id === id) || s.current === id) return false;
  s.current = id;
  return true;
}

/**
 * 删除预览集（只删记录，不碰图片文件）。删的是当前这个就切到相邻的一个；
 * 删光了就自动建一个空的「我的作品」。返回删除后是否换了当前预览集。
 */
export function deleteSet(s: SavedSets, id: string, makeId: () => string = newSetId): boolean {
  const i = s.sets.findIndex((x) => x.id === id);
  if (i < 0) return false;
  s.sets.splice(i, 1);
  if (s.sets.length === 0) s.sets.push(makeSet(t('sets.defaultName'), makeId));
  if (s.current !== id) return false;
  s.current = s.sets[Math.min(i, s.sets.length - 1)].id;
  return true;
}

/** 从导入的来源给新预览集起名：单个文件夹用文件夹名，其余用「新预览集」 */
export function nameFromSources(paths: readonly string[], kind: 'file' | 'folder'): string | undefined {
  if (kind !== 'folder' || paths.length !== 1) return undefined;
  const parts = paths[0].replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || undefined;
}
