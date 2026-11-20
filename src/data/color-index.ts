// 补算主色组成（2026-11-20，按颜色筛选用）。
//
// 平时不专门算：浏览时计数圆环取主题色抓到了像素，App 顺手算掉当前这幅（palette-loader.ts 的 onPixels）。
// 第一次按颜色筛选、还有作品没算过时，用这里一口气补齐：最多同时 3 幅，没有缩略图的先生成缩略图。
// 算好的存进作品库（SavedWork.swatches），以后不用再算；文件改过才作废重算（library.ts）。
import type { Work } from './types';
import type { Swatch } from '../engine/swatches';

const CONCURRENCY = 3;

export class ColorIndex {
  private run = 0;
  private failed = new Set<string>();

  /** analyze：算一幅的主色组成，读不了返回 null（之后不再重试） */
  constructor(private analyze: (w: Work) => Promise<Swatch[] | null>) {}

  /** 还没算过（也没失败过）的作品 */
  missing(works: readonly Work[]): Work[] {
    return works.filter((w) => !w.swatches && !this.failed.has(w.id));
  }

  /** 打断正在进行的补算（换了作品库、换了筛选） */
  cancel(): void {
    this.run++;
  }

  /**
   * 把 works 里没算过的补齐。progress(已完成, 总数) 每算完一幅调一次。
   * 中途被 cancel 或新的 fill 打断返回 false；全部算完（包括读不了的）返回 true
   */
  async fill(works: readonly Work[], progress: (done: number, total: number) => void): Promise<boolean> {
    const id = ++this.run;
    const todo = this.missing(works);
    const total = todo.length;
    let next = 0, done = 0;
    progress(0, total);
    const worker = async (): Promise<void> => {
      while (id === this.run && next < todo.length) {
        const w = todo[next++];
        let s: Swatch[] | null = null;
        try {
          s = await this.analyze(w);
        } catch {
          s = null;
        }
        if (id !== this.run) return;
        if (s && s.length) w.swatches = s;
        else this.failed.add(w.id);
        done++;
        progress(done, total);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, worker));
    return id === this.run;
  }
}
