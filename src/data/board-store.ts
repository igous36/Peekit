// 情绪板的保存（2026-11-18 新增）：持有全部情绪板，改动后 600ms 写一次盘（和预览集同一个 library.json）。
import type { LibraryStore } from './persist';
import type { Board, SavedBoards } from './boards';

const SAVE_DELAY_MS = 600;

export class BoardStore {
  private timer = 0;
  private frozen = false;

  constructor(readonly data: SavedBoards, private store: LibraryStore | null) {}

  get boards(): Board[] {
    return this.data.boards;
  }

  byId(id: string | null | undefined): Board | undefined {
    return id ? this.data.boards.find((b) => b.id === id) : undefined;
  }

  /** 性能探针运行时不保存 */
  freeze(): void {
    this.frozen = true;
    window.clearTimeout(this.timer);
  }

  saveSoon(): void {
    if (this.frozen) return;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.saveNow(), SAVE_DELAY_MS);
  }

  saveNow(): void {
    window.clearTimeout(this.timer);
    this.timer = 0;
    if (!this.frozen) this.store?.saveBoards(this.data);
  }

  /** 马上写盘（自动更新安装前） */
  async flush(): Promise<void> {
    if (this.timer) this.saveNow();
    await this.store?.flush();
  }
}
