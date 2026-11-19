import { describe, expect, it } from 'vitest';
import { BoxGrid, cellFor } from './box-grid';
import type { Box } from './board-layout';

describe('BoxGrid', () => {
  const boxes: Box[] = [
    { x: 0, y: 0, w: 100, h: 100 },
    { x: 120, y: 0, w: 100, h: 100 },
    { x: 5000, y: 5000, w: 100, h: 100 },
    { x: -800, y: 300, w: 300, h: 200 },
  ];

  it('格子大小按平均长边算', () => {
    expect(cellFor(boxes)).toBeCloseTo(((100 + 100 + 100 + 300) / 4) * 1.5);
    expect(cellFor([])).toBe(512);
  });

  it('只查出附近的框（不重复），远处的不会出现', () => {
    const g = new BoxGrid(boxes, 200);
    const near = g.query(90, 10, 20, 20, 30);
    expect(near.sort()).toEqual([0, 1]);
    expect(g.query(4990, 4990, 10, 10, 0)).toEqual([2]);
  });

  it('和两两比较的结果一致（随机框）', () => {
    let seed = 3;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const many: Box[] = Array.from({ length: 400 }, () => ({ x: rnd() * 5000 - 2500, y: rnd() * 5000 - 2500, w: 50 + rnd() * 300, h: 50 + rnd() * 300 }));
    const g = new BoxGrid(many);
    for (let k = 0; k < 50; k++) {
      const q = { x: rnd() * 5000 - 2500, y: rnd() * 5000 - 2500, w: rnd() * 400, h: rnd() * 400 };
      const pad = rnd() * 60;
      const hit = (b: Box) => b.x < q.x + q.w + pad && q.x - pad < b.x + b.w && b.y < q.y + q.h + pad && q.y - pad < b.y + b.h;
      const brute = many.map((b, i) => (hit(b) ? i : -1)).filter((i) => i >= 0).sort((a, b) => a - b);
      const got = g.query(q.x, q.y, q.w, q.h, pad).filter((i) => hit(many[i])).sort((a, b) => a - b);
      expect(got).toEqual(brute);
    }
  });

  it('后来登记的框（合成集合时一张张放）也能查到', () => {
    const placed: Box[] = [];
    const g = new BoxGrid(placed, 100, 10, false);
    placed.push({ x: 0, y: 0, w: 50, h: 50 });
    g.insert(0);
    expect(g.query(40, 40, 5, 5, 0)).toEqual([0]);
  });
});
