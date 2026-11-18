// 缩略图队列：离当前作品越近越先生成，最多同时 3 张。
//
// 2026-11-17 针对几万幅的作品库：
// - 只预先生成当前位置前后 PREFETCH_RADIUS 幅以内的（作品少的库就是全部）；走到哪儿再生成哪儿，
//   不会在后台把几万张图全部解码一遍（那要好几个小时，CPU 一直被占着）
// - 找“下一张”时从上次找到的距离接着往外找（已经生成过的不会再变回没生成），不再每次扫一遍全部作品
// - 可以指定优先的作品（系列视图当前这一页的缩略图），它们排在最前面
import type { Work } from './types';

export interface ThumbResult {
  /** 可直接给 <img> 用的 URL */
  url: string;
  /** 新生成时的主色 */
  color: string | null;
}

export const THUMB_CONCURRENCY = 3;
/** 预先生成的范围：当前位置前后各这么多幅 */
export const PREFETCH_RADIUS = 1500;

export class ThumbLoader {
  private works: readonly Work[] = [];
  private cur = 0;
  private priority: readonly number[] = [];
  /** 距离当前位置小于 reach 的都已经不用管了（生成过、在生成、或读不了） */
  private reach = 0;
  private inflight = new Set<string>();
  private failed = new Set<string>();

  constructor(
    private request: (w: Work) => Promise<ThumbResult>,
    /** 一张到位（或失败）之后调用，用来重新渲染、保存主色 */
    private onSettled: (w: Work) => void,
    private concurrency = THUMB_CONCURRENCY,
    private radius = PREFETCH_RADIUS,
  ) {}

  /** 作品列表或当前位置变了就调用；priority 是要优先生成的作品下标（系列视图当前页） */
  update(works: readonly Work[], cur: number, priority: readonly number[] = []): void {
    if (works !== this.works || cur !== this.cur) this.reach = 0;
    this.works = works;
    this.cur = cur;
    this.priority = priority;
    this.pump();
  }

  get busy(): number {
    return this.inflight.size;
  }

  private wanted(w: Work | undefined): w is Work {
    return !!w && !!w.path && !w.thumb && !w.broken && !this.inflight.has(w.id) && !this.failed.has(w.id);
  }

  private next(): Work | null {
    for (const i of this.priority) {
      const w = this.works[i];
      if (this.wanted(w)) return w;
    }
    const n = this.works.length;
    const limit = Math.min(this.radius, n);
    for (let d = this.reach; d <= limit; d++) {
      const a = this.works[this.cur - d];
      if (this.wanted(a)) {
        this.reach = d;
        return a;
      }
      const b = d > 0 ? this.works[this.cur + d] : undefined;
      if (this.wanted(b)) {
        this.reach = d;
        return b;
      }
    }
    this.reach = limit + 1;
    return null;
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
