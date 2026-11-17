// 缩略图队列：离当前作品越近越先生成，最多同时 3 张；全部生成完为止（后台慢慢做）。
import type { Work } from './types';

export interface ThumbResult {
  /** 可直接给 <img> 用的 URL */
  url: string;
  /** 新生成时的主色 */
  color: string | null;
}

export const THUMB_CONCURRENCY = 3;

export class ThumbLoader {
  private works: readonly Work[] = [];
  private cur = 0;
  private inflight = new Set<string>();
  private failed = new Set<string>();

  constructor(
    private request: (w: Work) => Promise<ThumbResult>,
    /** 一张到位（或失败）之后调用，用来重新渲染、保存主色 */
    private onSettled: (w: Work) => void,
    private concurrency = THUMB_CONCURRENCY,
  ) {}

  /** 作品列表或当前位置变了就调用 */
  update(works: readonly Work[], cur: number): void {
    this.works = works;
    this.cur = cur;
    this.pump();
  }

  get busy(): number {
    return this.inflight.size;
  }

  private next(): Work | null {
    let best: Work | null = null;
    let bestD = Infinity;
    this.works.forEach((w, i) => {
      if (!w.path || w.thumb || w.broken || this.inflight.has(w.id) || this.failed.has(w.id)) return;
      const d = Math.abs(i - this.cur);
      if (d < bestD) {
        bestD = d;
        best = w;
      }
    });
    return best;
  }

  private pump(): void {
    while (this.inflight.size < this.concurrency) {
      const w = this.next();
      if (!w) return;
      this.inflight.add(w.id);
      this.request(w)
        .then((r) => {
          w.thumb = r.url;
          if (r.color) w.bg = r.color;
        })
        .catch((err) => {
          console.warn('缩略图生成失败', w.path, err);
          this.failed.add(w.id);
          w.broken = true;
        })
        .finally(() => {
          this.inflight.delete(w.id);
          this.onSettled(w);
          this.pump();
        });
    }
  }
}
