// 作品库服务：持有所有预览集，负责导入、重新扫描、保存，以及预览集的新建 / 改名 / 删除 / 切换。
// 扫描只在 Tauri 里可用；浏览器调试时只做保存（示例数据）。
import type { Library } from './types';
import type { LibraryStore } from './persist';
import {
  addSources, knownMeta, markRemoved, mergeScan, restoreRemoved, updateSaved, type SavedLibrary, type Source,
} from './library';
import {
  createSet, currentSet, deleteSet, duplicateSet, renameSet, setCurrent, type PreviewSet, type SavedSets,
} from './sets';
import { scanSources } from './tauri-io';

export interface ScanOutcome {
  lib: Library;
  /** 这次新出现的作品（路径） */
  added: string[];
  /** 找不到的来源 */
  missing: string[];
}

export class LibraryService {
  private frozen = false;

  constructor(
    readonly data: SavedSets,
    private store: LibraryStore | null,
    /** 是否在 Tauri 里（能扫描、能生成缩略图） */
    readonly desktop: boolean,
  ) {}

  get current(): PreviewSet {
    return currentSet(this.data);
  }

  get sets(): readonly PreviewSet[] {
    return this.data.sets;
  }

  /** 当前预览集的作品库 */
  get saved(): SavedLibrary {
    return this.current.library;
  }

  /** 之后不再保存（性能探针会临时换掉作品列表） */
  freeze(): void {
    this.frozen = true;
  }

  private persist(): void {
    if (!this.frozen) this.store?.save(this.data);
  }

  /** 当前预览集加载好之后记下作品数（切换器里显示；随下一次保存写盘） */
  noteCount(n: number): void {
    this.current.count = n;
  }

  /** 编辑之后保存 */
  save(lib: Library): void {
    if (this.frozen) return;
    updateSaved(this.saved, lib);
    this.current.count = lib.works.length;
    this.persist();
  }

  /** 重新扫描当前预览集导入过的来源 */
  async rescan(): Promise<ScanOutcome> {
    const set = this.current;
    const r = await scanSources(set.library.sources, knownMeta(set.library));
    const m = mergeScan(set.library, r.items);
    set.count = m.lib.works.length;
    this.persist();
    return { ...m, missing: r.missing };
  }

  /**
   * 把文件 / 文件夹导入到指定的预览集（并切换过去），然后重新扫描。
   * 里面之前从预览集移除过的作品会恢复，算作这次新加的。
   */
  async import(add: Source[], targetSetId: string): Promise<ScanOutcome> {
    setCurrent(this.data, targetSetId);
    addSources(this.saved, add);
    const back = restoreRemoved(this.saved, add);
    const r = await this.rescan();
    if (back.length) {
      const have = new Set(r.lib.works.map((w) => w.id));
      r.added = [...r.added, ...back.filter((id) => have.has(id))];
    }
    return r;
  }

  /**
   * 把作品从当前预览集移除（源文件不动），连同编辑后的作品库一起保存。
   * lib 是已经去掉这些作品之后的作品库。
   */
  removeWorks(ids: readonly string[], lib: Library): void {
    if (this.frozen || !ids.length) return;
    markRemoved(this.saved, ids);
    this.save(lib);
  }

  /** 撤销移除：去掉“已移除”标记，连同恢复后的作品库一起保存 */
  restoreWorks(ids: readonly string[], lib: Library): void {
    if (this.frozen) return;
    for (const id of ids) delete this.saved.works[id]?.removed;
    this.save(lib);
  }

  createSet(name?: string): PreviewSet {
    const s = createSet(this.data, name);
    this.persist();
    return s;
  }

  /** 复制预览集（不切换过去）；找不到返回 null */
  duplicateSet(id: string): PreviewSet | null {
    const s = duplicateSet(this.data, id);
    if (s) this.persist();
    return s;
  }

  renameSet(id: string, name: string): boolean {
    const ok = renameSet(this.data, id, name);
    if (ok) this.persist();
    return ok;
  }

  /** 返回删除后当前预览集是否变了（变了要重新加载） */
  deleteSet(id: string): boolean {
    const changed = deleteSet(this.data, id);
    this.persist();
    return changed;
  }

  switchTo(id: string): boolean {
    const changed = setCurrent(this.data, id);
    if (changed) this.persist();
    return changed;
  }

  /** 缩略图缓存键要用的文件信息 */
  fileInfo(id: string): { mtime: number; size: number } {
    const w = this.saved.works[id];
    return { mtime: w?.mtime ?? 0, size: w?.size ?? 0 };
  }
}
