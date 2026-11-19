// 情绪板照片的缩略图（2026-11-18 新增）：和舞台共用 Rust 端的缩略图缓存（同一个文件只生成一次），
// 舞台上已经有的直接用；其余排队生成，最多同时 3 张，到位后合并成一次回调（换图、重画）。
//
// 2026-11-19 压测后加了两档：照片在屏幕上很小时用长边 384 的小缩略图（mini），
// 几千张同时显示时不用解码几千张 1600px 的图（每张解码后约 7MB）。小缩略图从 1600 的缩略图缩，生成很快。
import type { BoardItem } from '../../data/boards';

const MAX_ACTIVE = 3;

type Size = 'mini' | 'full';

export class BoardThumbs {
  private urls = new Map<string, string>();
  private state = new Map<string, 'loading' | 'failed'>();
  private queue: { it: BoardItem; size: Size }[] = [];
  private active = 0;
  private timer = 0;

  constructor(
    private make: ((it: BoardItem, size: Size) => Promise<{ url: string; color: string | null }>) | null,
    /** 舞台上同一个文件的 1600 缩略图（已经生成好了就不用再请求） */
    private known: (path: string) => string | undefined,
    private ready: () => void,
  ) {}

  /**
   * 这张照片的缩略图地址；还没有就排队生成，好了会调 ready。
   * mini：要小缩略图（没好之前返回 undefined，调用方先留着原来的图或底色）
   */
  url(it: BoardItem, mini = false): string | undefined {
    const p = it.path;
    if (!p) return undefined;
    const size: Size = mini ? 'mini' : 'full';
    const key = mini ? `${p}\u0000mini` : p;
    let u = this.urls.get(key);
    if (!u && !mini) {
      u = this.known(p);
      if (u) this.urls.set(key, u);
    }
    if (u) return u;
    if (this.make && !this.state.has(key)) {
      this.state.set(key, 'loading');
      this.queue.push({ it, size });
      this.pump();
    }
    return undefined;
  }

  private pump(): void {
    while (this.make && this.active < MAX_ACTIVE && this.queue.length) {
      const { it, size } = this.queue.shift()!;
      const p = it.path!;
      const key = size === 'mini' ? `${p}\u0000mini` : p;
      this.active++;
      this.make(it, size)
        .then(
          (r) => {
            this.urls.set(key, r.url);
            this.state.delete(key);
            if (r.color && !it.color) it.color = r.color;
          },
          () => this.state.set(key, 'failed'),
        )
        .finally(() => {
          this.active--;
          this.pump();
          this.notify();
        });
    }
  }

  /** 一批缩略图陆续到位：合并成一次回调 */
  private notify(): void {
    if (this.timer) return;
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      this.ready();
    }, 60);
  }
}
