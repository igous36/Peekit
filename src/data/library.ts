// 作品库：保存格式（v2）和“扫描结果 + 保存数据 → 作品列表”的合并。纯函数，不碰 Tauri 和 DOM。
//
// 保存的内容（应用数据目录的 library.json）：
// - sources：导入过的文件 / 文件夹，每次启动重新扫描，文件夹里新加的图会自动出现
// - series：系列列表（包括已经空了的系列）
// - folderSeries：文件夹 → 自动建的系列，同一文件夹后来新加的图归进同一个系列
// - works：按文件路径记归属、自定义标题、主色，以及上次扫描的元数据（文件没变就不用重新读）
import type { Library, Series, Work } from './types';
import { nextSeriesColor, newSeriesId, SERIES_NAME_MAX } from './series-ops';
import { t } from '../i18n';
import { UNASSIGNED_COLOR, color } from '../tokens';

export const SAVE_VERSION = 2;
/** “未归类”系列的固定 id：单独选的文件放这里 */
export const UNSORTED_ID = 'unsorted';

export interface Source {
  path: string;
  kind: 'file' | 'folder';
}

export interface SavedWork {
  series?: string;
  customTitle?: string;
  /** 主色（第一次生成缩略图时算出来） */
  color?: string;
  // 上次扫描的元数据
  mtime?: number;
  size?: number;
  date?: string | null;
  ts?: number;
  width?: number;
  height?: number;
}

export interface SavedLibrary {
  version: number;
  sources: Source[];
  series: Series[];
  folderSeries: Record<string, string>;
  works: Record<string, SavedWork>;
}

/** Rust 端 scan_sources 返回的一项 */
export interface ScanItem {
  path: string;
  fileName: string;
  title: string;
  folder: string | null;
  folderName: string | null;
  date: string | null;
  ts: number;
  mtime: number;
  size: number;
  width: number;
  height: number;
}

export function emptySaved(): SavedLibrary {
  return { version: SAVE_VERSION, sources: [], series: [], folderSeries: {}, works: {} };
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const isSeries = (x: unknown): x is Series =>
  isObj(x) && typeof x.id === 'string' && typeof x.name === 'string' && typeof x.color === 'string';
const isSource = (x: unknown): x is Source =>
  isObj(x) && typeof x.path === 'string' && (x.kind === 'file' || x.kind === 'folder');

/** 读回来的数据做一遍校验；格式不对就当没有 */
export function parseSaved(raw: unknown): SavedLibrary | null {
  if (!isObj(raw) || raw.version !== SAVE_VERSION) return null;
  const { sources, series, folderSeries, works } = raw;
  if (!Array.isArray(sources) || !sources.every(isSource)) return null;
  if (!Array.isArray(series) || !series.every(isSeries)) return null;
  if (!isObj(folderSeries) || !isObj(works)) return null;
  return {
    version: SAVE_VERSION,
    sources: sources.map((s) => ({ path: s.path, kind: s.kind })),
    series: series.map((s) => ({ id: s.id, name: s.name, color: s.color })),
    folderSeries: Object.fromEntries(Object.entries(folderSeries).filter(([, v]) => typeof v === 'string')) as Record<
      string,
      string
    >,
    works: Object.fromEntries(Object.entries(works).filter(([, v]) => isObj(v))) as Record<string, SavedWork>,
  };
}

/** 修改时间 → 本地日期 YYYY.MM.DD（元数据里没有日期时用） */
export function formatLocalDate(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime()) || ms <= 0) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

/** 加入新来源（去重；路径大小写按 Windows 习惯不敏感） */
export function addSources(saved: SavedLibrary, add: Source[]): Source[] {
  const key = (p: string) => p.replace(/[\\/]+$/, '').toLowerCase();
  const have = new Set(saved.sources.map((s) => key(s.path)));
  const fresh: Source[] = [];
  for (const s of add) {
    const k = key(s.path);
    if (have.has(k)) continue;
    have.add(k);
    fresh.push(s);
  }
  saved.sources.push(...fresh);
  return fresh;
}

/** 给扫描用的“已知元数据”：文件没变就复用 */
export function knownMeta(saved: SavedLibrary): Record<string, Required<Pick<SavedWork, 'mtime' | 'size' | 'ts' | 'width' | 'height'>> & { date: string | null }> {
  const out: ReturnType<typeof knownMeta> = {};
  for (const [path, w] of Object.entries(saved.works)) {
    if (w.mtime !== undefined && w.size !== undefined && w.ts !== undefined && w.width && w.height) {
      out[path] = { mtime: w.mtime, size: w.size, ts: w.ts, width: w.width, height: w.height, date: w.date ?? null };
    }
  }
  return out;
}

function ensureSeries(saved: SavedLibrary, id: string, name: string, colorHex: string): string {
  if (!saved.series.some((s) => s.id === id)) saved.series.push({ id, name, color: colorHex });
  return id;
}

/**
 * 扫描结果 + 保存的数据 → 作品列表（按日期从早到晚）。会就地更新 saved（新系列、元数据缓存）。
 * 归属规则：保存过就用保存的；没保存过的，文件夹里的图按文件夹自动建系列，单独选的文件放进“未归类”。
 */
export function mergeScan(
  saved: SavedLibrary,
  items: readonly ScanItem[],
  makeId: () => string = newSeriesId,
): { lib: Library; added: string[] } {
  const seriesIds = () => new Set(saved.series.map((s) => s.id));
  let ids = seriesIds();
  const added: string[] = [];
  const works: Work[] = [];

  for (const it of items) {
    const prev = saved.works[it.path];
    if (!prev) added.push(it.path);
    let sid = prev?.series && ids.has(prev.series) ? prev.series : undefined;
    if (!sid && it.folder) {
      const fs = saved.folderSeries[it.folder];
      if (fs && ids.has(fs)) sid = fs;
      else {
        const name = (it.folderName || t('series.unnamed')).slice(0, SERIES_NAME_MAX);
        sid = ensureSeries(saved, makeId(), name, nextSeriesColor(saved.series));
        saved.folderSeries[it.folder] = sid;
        ids = seriesIds();
      }
    }
    if (!sid) {
      sid = ensureSeries(saved, UNSORTED_ID, t('series.unassigned'), UNASSIGNED_COLOR);
      ids = seriesIds();
    }

    saved.works[it.path] = {
      ...prev,
      series: sid,
      mtime: it.mtime,
      size: it.size,
      date: it.date,
      ts: it.ts,
      width: it.width,
      height: it.height,
    };
    const w: Work = {
      id: it.path,
      path: it.path,
      title: it.title,
      fileName: it.fileName,
      date: it.date ?? formatLocalDate(it.mtime),
      ts: it.ts,
      series: sid,
      bg: prev?.color ?? color['color-chip'],
      width: it.width,
      height: it.height,
    };
    if (prev?.customTitle) w.customTitle = prev.customTitle;
    works.push(w);
  }

  works.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0) || (a.fileName ?? a.title).localeCompare(b.fileName ?? b.title));
  return { lib: { works, series: saved.series.map((s) => ({ ...s })) }, added };
}

/** 示例数据（浏览器调试）：把保存的归属和自定义标题套上去 */
export function applyToSample(lib: Library, saved: SavedLibrary): void {
  if (saved.series.length) lib.series = saved.series.map((s) => ({ ...s }));
  for (const w of lib.works) {
    const sw = saved.works[w.id];
    if (!sw) continue;
    if (sw.series) w.series = sw.series;
    if (sw.customTitle) w.customTitle = sw.customTitle;
  }
}

/** 编辑之后把当前状态写回 saved（保留元数据缓存和主色） */
export function updateSaved(saved: SavedLibrary, lib: Library): void {
  saved.series = lib.series.map((s) => ({ ...s }));
  for (const w of lib.works) {
    const prev = saved.works[w.id] ?? {};
    const next: SavedWork = { ...prev, series: w.series };
    if (w.customTitle?.trim()) next.customTitle = w.customTitle;
    else delete next.customTitle;
    if (w.path && w.bg !== color['color-chip']) next.color = w.bg;
    saved.works[w.id] = next;
  }
}
