import { describe, expect, it } from 'vitest';
import {
  BOARD_GAP, PHOTO_AREA, PHOTO_MAX_SIDE, adjacent, bounds, components, fitCam, fitSize, focusCam, gather, justify, linearPartition,
  neighborIn, nearestBox, overlap, readingOrder, repack, separate, shelfPack, snapPosition, toScreen, toWorld, zoomAround,
  type Box,
} from './board-layout';

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('fitSize', () => {
  it('按面积归一：横竖图面积相同', () => {
    const p = fitSize(0.8), l = fitSize(1.25);
    close(p.w * p.h, PHOTO_AREA, 1e-3);
    close(l.w * l.h, PHOTO_AREA, 1e-3);
    close(p.w / p.h, 0.8);
  });

  it('很长的全景图：长边不超过上限，比例不变', () => {
    const s = fitSize(6);
    close(s.w, PHOTO_MAX_SIDE);
    close(s.w / s.h, 6);
  });
});

describe('overlap / adjacent / components', () => {
  const a: Box = { x: 0, y: 0, w: 100, h: 100 };
  it('正好隔一条缝：不算重叠，算贴着', () => {
    const b: Box = { x: 100 + BOARD_GAP, y: 20, w: 100, h: 100 };
    expect(overlap(a, b, BOARD_GAP)).toBe(false);
    expect(adjacent(a, b)).toBe(true);
  });

  it('上下贴着但左右错开、没有重合：不算贴着', () => {
    const b: Box = { x: 150, y: 100 + BOARD_GAP, w: 100, h: 100 };
    expect(adjacent(a, b)).toBe(false);
  });

  it('连通分量：链式贴着的是一组，远的单独一组', () => {
    const b: Box = { x: 112, y: 0, w: 100, h: 100 };
    const c: Box = { x: 112, y: 112, w: 100, h: 100 };
    const d: Box = { x: 900, y: 900, w: 100, h: 100 };
    const comps = components([a, b, c, d]).map((g) => g.sort()).sort((p, q) => q.length - p.length);
    expect(comps).toEqual([[0, 1, 2], [3]]);
  });
});

describe('snapPosition', () => {
  const others: Box[] = [{ x: 0, y: 0, w: 200, h: 250 }];

  it('拖到右边附近：贴到右边，隔一条缝，上边对齐（有一条边在同一直线上）', () => {
    const s = snapPosition(150, 180, 200 + BOARD_GAP + 9, 6, others, 30)!;
    expect(s).not.toBeNull();
    close(s.x, 200 + BOARD_GAP);
    close(s.y, 0);
    expect(s.target).toBe(0);
    expect(s.guides.length).toBeGreaterThan(0);
  });

  it('靠近下边对齐的位置：下边对齐', () => {
    const s = snapPosition(150, 180, 200 + BOARD_GAP + 4, 250 - 180 + 5, others, 30)!;
    close(s.y, 250 - 180);
  });

  it('离得太远：不吸附', () => {
    expect(snapPosition(150, 180, 600, 600, others, 30)).toBeNull();
  });

  it('吸附的位置被别的照片占了：换一个不重叠的位置', () => {
    const crowded: Box[] = [...others, { x: 200 + BOARD_GAP, y: 0, w: 150, h: 180 }];
    const s = snapPosition(150, 180, 200 + BOARD_GAP + 5, 5, crowded, 60);
    if (s) for (const o of crowded) expect(overlap({ x: s.x, y: s.y, w: 150, h: 180 }, o, BOARD_GAP)).toBe(false);
  });

  it('threshold = Infinity：压在照片上时找最近的合法位置', () => {
    const s = snapPosition(150, 180, 40, 40, others, Infinity)!;
    expect(s).not.toBeNull();
    expect(overlap({ x: s.x, y: s.y, w: 150, h: 180 }, others[0])).toBe(false);
  });
});

describe('linearPartition / justify', () => {
  it('切成 k 段，按顺序、不丢不重', () => {
    const rows = linearPartition([1, 1, 1, 1, 1, 1], 3);
    expect(rows).toEqual([[0, 1], [2, 3], [4, 5]]);
  });

  it('等高行：同一行上下边对齐、左右两端对齐，不重叠，平均面积不变', () => {
    const aspects = [0.8, 1.5, 0.66, 1, 1.78, 0.75, 1.33, 0.8, 2.2];
    const boxes = justify(aspects, 1.5);
    expect(boxes).toHaveLength(aspects.length);
    boxes.forEach((b, i) => close(b.w / b.h, aspects[i], 1e-6 + (i === boxes.length - 1 ? 1e-3 : 0) + 0.02));
    const bb = bounds(boxes);
    // 每一行的最后一张右边都在 W 上
    const rows = new Map<number, Box[]>();
    for (const b of boxes) {
      const k = Math.round(b.y);
      rows.set(k, [...(rows.get(k) ?? []), b]);
    }
    for (const row of rows.values()) {
      const r = Math.max(...row.map((b) => b.x + b.w));
      close(r, bb.x + bb.w, 1e-6);
      const h = row[0].h;
      for (const b of row) close(b.h, h, 1e-6);
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i], boxes[j])).toBe(false);
    }
    const mean = boxes.reduce((s, b) => s + b.w * b.h, 0) / boxes.length;
    close(mean, PHOTO_AREA, PHOTO_AREA * 1e-6);
    // 排好的照片全部连成一个集合
    expect(components(boxes)).toHaveLength(1);
  });

  it('一张：就是默认大小', () => {
    const [b] = justify([0.8]);
    close(b.w * b.h, PHOTO_AREA, 1e-3);
  });
});

describe('readingOrder / repack', () => {
  it('先按行、行内从左到右', () => {
    const boxes: Box[] = [
      { x: 300, y: 0, w: 100, h: 100 },
      { x: 0, y: 300, w: 100, h: 100 },
      { x: 0, y: 10, w: 100, h: 100 },
    ];
    expect(readingOrder(boxes)).toEqual([2, 0, 1]);
  });

  it('重新排密后中心不变、连成一片', () => {
    const boxes: Box[] = [
      { x: 0, y: 0, w: 100, h: 125 },
      { x: 400, y: 30, w: 200, h: 100 },
      { x: 50, y: 500, w: 120, h: 120 },
    ];
    const out = repack(boxes, boxes.map((b) => b.w / b.h));
    const a = bounds(boxes), b = bounds(out);
    close(a.x + a.w / 2, b.x + b.w / 2, 1e-6);
    close(a.y + a.h / 2, b.y + b.h / 2, 1e-6);
    expect(components(out)).toHaveLength(1);
  });
});

describe('shelfPack / separate', () => {
  it('整块按行摆：互不重叠，整体中心在原点', () => {
    const blocks = [{ w: 300, h: 200 }, { w: 120, h: 400 }, { w: 500, h: 260 }, { w: 200, h: 200 }];
    const pos = shelfPack(blocks, 96);
    const boxes = blocks.map((b, i) => ({ ...pos[i], ...b }));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i], boxes[j], 96)).toBe(false);
    }
    const bb = bounds(boxes);
    close(bb.x + bb.w / 2, 0, 1e-6);
    close(bb.y + bb.h / 2, 0, 1e-6);
  });

  it('推开重叠：固定的不动，其余推到至少隔 gap', () => {
    const boxes: Box[] = [
      { x: 0, y: 0, w: 200, h: 200 },
      { x: 150, y: 20, w: 100, h: 100 },
      { x: 240, y: 30, w: 100, h: 100 },
    ];
    const off = separate(boxes, [true, false, false], 12);
    expect(off[0]).toEqual({ dx: 0, dy: 0 });
    const moved = boxes.map((b, i) => ({ ...b, x: b.x + off[i].dx, y: b.y + off[i].dy }));
    for (let i = 0; i < moved.length; i++) {
      for (let j = i + 1; j < moved.length; j++) expect(overlap(moved[i], moved[j], 12)).toBe(false);
    }
  });
});

describe('neighborIn / nearestBox', () => {
  const boxes: Box[] = [
    { x: 0, y: 0, w: 100, h: 100 },
    { x: 112, y: 0, w: 100, h: 100 },
    { x: 0, y: 112, w: 100, h: 100 },
    { x: -300, y: 0, w: 100, h: 100 },
  ];
  it('按方向找下一张', () => {
    expect(neighborIn(boxes, 0, 1, 0)).toBe(1);
    expect(neighborIn(boxes, 0, 0, 1)).toBe(2);
    expect(neighborIn(boxes, 0, -1, 0)).toBe(3);
    expect(neighborIn(boxes, 0, 0, -1)).toBe(-1);
  });

  it('离一点最近的照片：点在框里优先', () => {
    expect(nearestBox(boxes, 150, 50)).toBe(1);
    expect(nearestBox(boxes, 50, 160)).toBe(2);
  });
});

describe('镜头', () => {
  it('屏幕 ↔ 画布互逆', () => {
    const c = { x: 120, y: -40, z: 0.7 };
    const s = toScreen(c, 300, 200, 1440, 900);
    const w = toWorld(c, s.x, s.y, 1440, 900);
    close(w.x, 300);
    close(w.y, 200);
  });

  it('以光标为中心缩放：光标下的那一点不动', () => {
    const c = { x: 0, y: 0, z: 1 };
    const before = toWorld(c, 1000, 300, 1440, 900);
    const n = zoomAround(c, 2.5, 1000, 300, 1440, 900);
    const after = toWorld(n, 1000, 300, 1440, 900);
    close(before.x, after.x);
    close(before.y, after.y);
    expect(n.z).toBe(2.5);
  });

  it('显示全部：外框放进窗口；聚焦：照片占窗口高度 72%', () => {
    const b: Box = { x: -500, y: -200, w: 1000, h: 400 };
    const f = fitCam(b, 1440, 900, 72, 56);
    expect(b.w * f.z).toBeLessThanOrEqual(1440 - 144 + 1e-6);
    const one: Box = { x: 0, y: 0, w: 288, h: 360 };
    const fc = focusCam(one, 1440, 900, 0.72, 56);
    close(one.h * fc.z, (900 - 56) * 0.72, 1e-6);
  });
});

describe('gather（合成一个集合）', () => {
  it('大小不变，连成一片，互不重叠，每张贴着的都有一条边对齐', () => {
    const boxes: Box[] = [
      { x: 0, y: 0, w: 200, h: 250 },
      { x: 600, y: 40, w: 160, h: 120 },
      { x: -500, y: 300, w: 120, h: 180 },
      { x: 220, y: 700, w: 300, h: 200 },
    ];
    const pos = gather(boxes);
    const out = boxes.map((b, i) => ({ ...b, ...pos[i] }));
    out.forEach((b, i) => {
      expect(b.w).toBe(boxes[i].w);
      expect(b.h).toBe(boxes[i].h);
    });
    expect(components(out)).toHaveLength(1);
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) expect(overlap(out[i], out[j], BOARD_GAP)).toBe(false);
    }
  });

  it('已经贴在一起的不动', () => {
    const boxes: Box[] = [{ x: 0, y: 0, w: 100, h: 100 }, { x: 112, y: 0, w: 100, h: 100 }];
    expect(gather(boxes)).toEqual([{ x: 0, y: 0 }, { x: 112, y: 0 }]);
  });
});
