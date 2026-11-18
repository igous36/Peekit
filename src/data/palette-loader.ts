// 当前作品的主题色（2026-11-18 新增，左上角计数圆环的外圈用）：
// 抓缩略图 → 缩到 24×24 → pickPalette（engine/palette.ts）挑 3 个；按作品缓存。
// 翻动中不抓图，每换一幅立刻用它的主色派生（或缓存），外圈颜色跟着快速流动；停下停留 140ms 再抓完整的。
// 没有缩略图（示例数据、SVG、读不了）时用色块 / 主色派生。
import type { Work } from './types';
import { derivePalette, pickPalette } from '../engine/palette';
import { imageKind } from './formats';

const SIZE = 24;
const DWELL_MS = 140;
const CACHE_MAX = 400;

/** 不抓图时的主题色：示例数据用它的色块颜色，其余用主色派生 */
export function fallbackPalette(w: Work): string[] {
  const shapeColors = [...new Set((w.shapes ?? []).map((s) => s.c).filter((c) => /^#[0-9a-f]{6}$/i.test(c)))];
  if (shapeColors.length >= 3) return shapeColors.slice(0, 3);
  return derivePalette(shapeColors[0] ?? w.bg, 3);
}

async function sample(url: string): Promise<Uint8ClampedArray> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const bmp = await createImageBitmap(await res.blob(), { resizeWidth: SIZE, resizeHeight: SIZE, resizeQuality: 'low' });
  try {
    const canvas = new OffscreenCanvas(SIZE, SIZE);
    const g = canvas.getContext('2d');
    if (!g) throw new Error('no 2d context');
    g.drawImage(bmp, 0, 0);
    return g.getImageData(0, 0, SIZE, SIZE).data;
  } finally {
    bmp.close();
  }
}

export class PaletteLoader {
  private cache = new Map<string, string[]>();
  private want: string | null = null;
  /** 当前这幅已经有（或正在抓）完整的主题色 */
  private settled = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** fast：正在翻动，颜色过渡要短（跟着快速流动） */
  constructor(private onPalette: (colors: string[], fast: boolean) => void) {}

  /**
   * 每帧调用（同一幅、状态没变直接返回）。moving = 正在左右翻动（2026-11-18 起）：
   * - 翻动中每换一幅，立刻用它缓存的完整主题色，没有就用主色派生（主色导入时就算好了，零开销），不去抓图；
   * - 停下后，还没有完整主题色就停留 DWELL_MS 再抓缩略图。
   */
  request(w: Work | undefined, moving = false): void {
    if (!w) return;
    const same = this.want === w.id;
    if (same && (moving || this.settled)) return;
    if (!same) {
      this.want = w.id;
      this.settled = false;
      clearTimeout(this.timer);
      const hit = this.cache.get(w.id);
      this.onPalette(hit ?? fallbackPalette(w), moving);
      if (hit) {
        this.settled = true;
        return;
      }
    }
    if (moving) return;
    // 停在这一幅了：抓完整的主题色
    this.settled = true;
    const url = w.thumb && w.path && imageKind(w.path) !== 'svg' && !w.broken ? w.thumb : null;
    if (!url) {
      const colors = fallbackPalette(w);
      this.store(w.id, colors);
      if (same) this.onPalette(colors, false);
      return;
    }
    this.timer = setTimeout(() => {
      void sample(url)
        .then((px) => pickPalette(px, 3))
        .catch(() => fallbackPalette(w))
        .then((colors) => {
          this.store(w.id, colors);
          if (this.want === w.id) this.onPalette(colors, false);
        });
    }, DWELL_MS);
  }

  private store(id: string, colors: string[]): void {
    this.cache.delete(id);
    this.cache.set(id, colors);
    if (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
  }
}
