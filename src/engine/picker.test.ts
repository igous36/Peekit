import { describe, expect, it } from 'vitest';
import { PICK_PITCH, PICK_TILE, closeDelay, openDelay, pickerLayout, tileAt } from './picker';
import { stage } from '../tokens';

describe('拖起后的情绪板阵列', () => {
  const vw = 1440, vh = 900, u = Math.min(vh / 100, vw * 0.006);

  it('铺满窗口：最外一圈格子的中心到了窗口边', () => {
    const L = pickerLayout(vw, vh, u, 0);
    const xs = L.tiles.map((t) => Math.abs(t.x)), ys = L.tiles.map((t) => Math.abs(t.y));
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(vw / 2);
    expect(Math.max(...ys)).toBeGreaterThanOrEqual(vh / 2);
    expect(L.size).toBeCloseTo(PICK_TILE * u);
    expect(L.pitch).toBeCloseTo(PICK_PITCH * u);
  });

  it('正中间那一行、中线左右两格是“新建”和“加入现有”', () => {
    const L = pickerLayout(vw, vh, u, 3);
    const nw = L.tiles.find((t) => t.role === 'new')!;
    const add = L.tiles.find((t) => t.role === 'add')!;
    expect(nw.y).toBe(0);
    expect(add.y).toBe(0);
    expect(nw.x).toBeCloseTo(-L.pitch / 2);
    expect(add.x).toBeCloseTo(L.pitch / 2);
  });

  it('舞台原有的 40 个玻璃格从原位出发，略微散开、缩小', () => {
    const L = pickerLayout(vw, vh, u, 0);
    const own = L.tiles.filter((t) => t.fromStage);
    expect(own).toHaveLength(stage.gridCols * stage.gridRows);
    for (const t of own) {
      expect(t.size0).toBeCloseTo(stage.tile * u);
      // 散开：离中心更远（中心那一行的 y = 0 不变）
      expect(Math.abs(t.x)).toBeGreaterThan(Math.abs(t.hx));
    }
    expect(L.size).toBeLessThan(stage.tile * u);
  });

  it('情绪板预览按离中心由近到远，只放在完整露出来的格子里', () => {
    const L = pickerLayout(vw, vh, u, 5);
    const boards = L.tiles.filter((t) => t.role === 'board').sort((a, b) => a.board - b.board);
    expect(boards.map((t) => t.board)).toEqual([0, 1, 2, 3, 4]);
    for (let i = 1; i < boards.length; i++) expect(boards[i].dist).toBeGreaterThanOrEqual(boards[i - 1].dist - 1e-9);
    for (const t of boards) expect(t.full).toBe(true);
  });

  it('展开从里往外、收起从外往里', () => {
    const L = pickerLayout(vw, vh, u, 0);
    const outer = L.tiles.filter((t) => !t.fromStage).sort((a, b) => a.dist - b.dist);
    const first = outer[0].dist;
    expect(openDelay(outer[outer.length - 1], first)).toBeGreaterThan(openDelay(outer[0], first));
    expect(closeDelay(outer[outer.length - 1], L.maxDist)).toBeLessThan(closeDelay(outer[0], L.maxDist));
  });

  it('指针在哪个格子上（缝里算最近的那格）', () => {
    const L = pickerLayout(vw, vh, u, 0);
    const i = L.tiles.findIndex((t) => t.role === 'add');
    expect(tileAt(L.tiles, L.size, L.pitch, L.tiles[i].x + 3, L.tiles[i].y - 4)).toBe(i);
  });
});

describe('从系列视图打开', () => {
  it('原有的玻璃格按镜头缩放后的位置、大小出发', () => {
    const vw = 1440, vh = 900, u = Math.min(vh / 100, vw * 0.006);
    const a = pickerLayout(vw, vh, u, 0, 1), b = pickerLayout(vw, vh, u, 0, 0.58);
    const i = a.tiles.findIndex((t) => t.fromStage && t.hx !== 0);
    expect(b.tiles[i].hx).toBeCloseTo(a.tiles[i].hx * 0.58);
    expect(b.tiles[i].size0).toBeCloseTo(a.tiles[i].size0 * 0.58);
    expect(b.tiles[i].x).toBeCloseTo(a.tiles[i].x);
  });
});
