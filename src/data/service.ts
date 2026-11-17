// 作品库服务：持有保存的数据，负责导入、重新扫描、保存。
// 扫描只在 Tauri 里可用；浏览器调试时只做保存（示例数据）。
import type { Library } from './types';
import type { LibraryStore } from './persist';
import { addSources, knownMeta, mergeScan, updateSaved, type SavedLibrary, type Source } from './library';
import { scanSources } from './tauri-io';

export interface ScanOutcome {
  lib: Library;
  /** 这次新出现的作品（路径） */
  added: string[];
  /** 找不到的来源 */
  missing: string[];
}

export class LibraryService {
  constructor(
    readonly saved: SavedLibrary,
    private store: LibraryStore | null,
    /** 是否在 Tauri 里（能扫描、能生成缩略图） */
    readonly desktop: boolean,
  ) {}

  private frozen = false;

  /** 之后不再保存（性能探针会临时换掉作品列表） */
  freeze(): void {
    this.frozen = true;
  }

  /** 编辑之后保存 */
  save(lib: Library): void {
    if (this.frozen) return;
    updateSaved(this.saved, lib);
    this.store?.save(this.saved);
  }

  /** 重新扫描所有导入过的来源 */
  async rescan(): Promise<ScanOutcome> {
    const r = await scanSources(this.saved.sources, knownMeta(this.saved));
    const m = mergeScan(this.saved, r.items);
    this.store?.save(this.saved);
    return { ...m, missing: r.missing };
  }

  /** 加入新的文件 / 文件夹并重新扫描 */
  async import(add: Source[]): Promise<ScanOutcome> {
    addSources(this.saved, add);
    return this.rescan();
  }

  /** 缩略图缓存键要用的文件信息 */
  fileInfo(id: string): { mtime: number; size: number } {
    const w = this.saved.works[id];
    return { mtime: w?.mtime ?? 0, size: w?.size ?? 0 };
  }
}
