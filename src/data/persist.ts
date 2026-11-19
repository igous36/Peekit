// 本地保存：Tauri 里用 tauri-plugin-store 写到应用数据目录的 library.json
// （改动后 100ms 自动保存，退出时再落盘）；浏览器里调试时退回 localStorage。
//
// 2026-11-17 起保存的是多个预览集（key "sets"，version 3）。
// 旧版的单个作品库（key "library"，version 2）只读不写：启动时用来迁移，原样留着方便回退。
import { isTauri } from '@tauri-apps/api/core';
import type { SavedSets } from './sets';
import type { SavedBoards } from './boards';

export const STORE_FILE = 'library.json';
const SETS_KEY = 'sets';
const LEGACY_KEY = 'library';
/** 情绪板（2026-11-18 新增），格式见 data/boards.ts */
const BOARDS_KEY = 'boards';
const LOCAL_SETS = 'peekit:sets';
const LOCAL_LEGACY = 'peekit:library';
const LOCAL_BOARDS = 'peekit:boards';

export interface StoredData {
  sets: unknown;
  legacy: unknown;
  boards: unknown;
}

export interface LibraryStore {
  load(): Promise<StoredData>;
  save(data: SavedSets): void;
  saveBoards(data: SavedBoards): void;
  /** 马上写盘（自动更新安装前：安装程序会直接关掉应用，等不到自动保存） */
  flush(): Promise<void>;
}

class TauriLibraryStore implements LibraryStore {
  private store: Promise<import('@tauri-apps/plugin-store').Store> | null = null;

  private open() {
    if (!this.store) {
      this.store = import('@tauri-apps/plugin-store').then((m) => m.load(STORE_FILE, { autoSave: 100, defaults: {} }));
    }
    return this.store;
  }

  async load(): Promise<StoredData> {
    const st = await this.open();
    return { sets: await st.get(SETS_KEY), legacy: await st.get(LEGACY_KEY), boards: await st.get(BOARDS_KEY) };
  }

  /** 最近一次 set 的进度：flush 要等它写进 store 再落盘 */
  private pending: Promise<void> = Promise.resolve();

  save(data: SavedSets): void {
    // 预览集和情绪板的写入排成一串：flush 只等最后一个就够了
    const prev = this.pending;
    this.pending = this.open()
      .then(async (st) => {
        await prev;
        await st.set(SETS_KEY, data);
      })
      .catch((err) => console.error('保存预览集失败', err));
  }

  saveBoards(data: SavedBoards): void {
    const prev = this.pending;
    this.pending = this.open()
      .then(async (st) => {
        await prev;
        await st.set(BOARDS_KEY, data);
      })
      .catch((err) => console.error('保存情绪板失败', err));
  }

  async flush(): Promise<void> {
    await this.pending;
    if (this.store) await (await this.store).save();
  }
}

class LocalLibraryStore implements LibraryStore {
  async load(): Promise<StoredData> {
    const read = (k: string) => {
      try {
        const raw = localStorage.getItem(k);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    };
    return { sets: read(LOCAL_SETS), legacy: read(LOCAL_LEGACY), boards: read(LOCAL_BOARDS) };
  }

  save(data: SavedSets): void {
    try {
      localStorage.setItem(LOCAL_SETS, JSON.stringify(data));
    } catch {
      /* 隐私模式等情况下存不了，忽略 */
    }
  }

  saveBoards(data: SavedBoards): void {
    try {
      localStorage.setItem(LOCAL_BOARDS, JSON.stringify(data));
    } catch {
      /* 存不了就算了 */
    }
  }

  async flush(): Promise<void> {
    /* localStorage 是同步写的 */
  }
}

export function createLibraryStore(): LibraryStore {
  return isTauri() ? new TauriLibraryStore() : new LocalLibraryStore();
}
