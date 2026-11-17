// 本地保存：Tauri 里用 tauri-plugin-store 写到应用数据目录的 library.json
// （改动后 100ms 自动保存，退出时再落盘）；浏览器里调试时退回 localStorage。
import { isTauri } from '@tauri-apps/api/core';
import type { SavedLibrary } from './library';

export const STORE_FILE = 'library.json';
const STORE_KEY = 'library';
const LOCAL_KEY = 'peekit:library';

export interface LibraryStore {
  load(): Promise<unknown>;
  save(data: SavedLibrary): void;
}

class TauriLibraryStore implements LibraryStore {
  private store: Promise<import('@tauri-apps/plugin-store').Store> | null = null;

  private open() {
    if (!this.store) {
      this.store = import('@tauri-apps/plugin-store').then((m) => m.load(STORE_FILE, { autoSave: 100, defaults: {} }));
    }
    return this.store;
  }

  async load(): Promise<unknown> {
    const st = await this.open();
    return st.get(STORE_KEY);
  }

  save(data: SavedLibrary): void {
    void this.open()
      .then((st) => st.set(STORE_KEY, data))
      .catch((err) => console.error('保存作品库失败', err));
  }
}

class LocalLibraryStore implements LibraryStore {
  async load(): Promise<unknown> {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  save(data: SavedLibrary): void {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
    } catch {
      /* 隐私模式等情况下存不了，忽略 */
    }
  }
}

export function createLibraryStore(): LibraryStore {
  return isTauri() ? new TauriLibraryStore() : new LocalLibraryStore();
}
