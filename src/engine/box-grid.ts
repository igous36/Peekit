// 网格空间索引（2026-11-19，情绪板压测后加）：把每个框登记到它覆盖的格子里，
// 找重叠、找贴着的、找附近的照片时只和附近格子里的框比较，几千张时不用两两比较。
import type { Box } from './board-layout';

/** 格子大小：框的平均长边的 1.5 倍（夹在 64–4096 之间），一个框通常只落在 1–4 个格子里 */
export function cellFor(boxes: readonly Box[]): number {
  if (!boxes.length) return 512;
  let s = 0;
  for (const b of boxes) s += Math.max(b.w, b.h);
  return Math.min(4096, Math.max(64, (s / boxes.length) * 1.5));
}

export class BoxGrid {
  private cells = new Map<number, number[]>();
  /** 查询去重用：stamp[i] === mark 说明这次已经收过 */
  private stamp: Uint32Array;
  private mark = 0;

  /** capacity：之后最多会登记多少个框（下标 < capacity） */
  constructor(private boxes: readonly Box[], readonly cell: number = cellFor(boxes), capacity = boxes.length, fill = true) {
    this.stamp = new Uint32Array(Math.max(1, capacity));
    if (fill) for (let i = 0; i < boxes.length; i++) this.insert(i);
  }

  private static key(cx: number, cy: number): number {
    return (cx + 0x100000) * 0x200000 + (cy + 0x100000);
  }

  insert(i: number): void {
    const b = this.boxes[i];
    const c = this.cell;
    const x0 = Math.floor(b.x / c), x1 = Math.floor((b.x + b.w) / c);
    const y0 = Math.floor(b.y / c), y1 = Math.floor((b.y + b.h) / c);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = BoxGrid.key(cx, cy);
        const list = this.cells.get(k);
        if (list) list.push(i);
        else this.cells.set(k, [i]);
      }
    }
  }

  /** 和 (x, y, w, h) 四周外扩 pad 之后的范围有交集的格子里登记过的框（去重；只是候选，还要再精确判断） */
  query(x: number, y: number, w: number, h: number, pad: number, out: number[] = []): number[] {
    const c = this.cell;
    if (++this.mark === 0xffffffff) {
      this.stamp.fill(0);
      this.mark = 1;
    }
    const m = this.mark;
    const x0 = Math.floor((x - pad) / c), x1 = Math.floor((x + w + pad) / c);
    const y0 = Math.floor((y - pad) / c), y1 = Math.floor((y + h + pad) / c);
    // 范围比登记过的格子还多时，直接扫一遍所有格子更快
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > this.cells.size) {
      for (const list of this.cells.values()) this.collect(list, m, out);
      return out;
    }
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const list = this.cells.get(BoxGrid.key(cx, cy));
        if (list) this.collect(list, m, out);
      }
    }
    return out;
  }

  private collect(list: number[], m: number, out: number[]): void {
    for (const i of list) {
      if (this.stamp[i] === m) continue;
      this.stamp[i] = m;
      out.push(i);
    }
  }
}
