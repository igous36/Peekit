// 2026-11-17：时间轴刻度分段、系列分页的二分查找（几万幅作品的压力测试后加）
import { describe, it, expect } from 'vitest';
import { bucketOf, bucketStart, tickCount, tickPosition, TICK_FALLBACK } from './ticks';
import { sortedIndexOf, thumbPage } from './mapping';

describe('时间轴刻度分段', () => {
  it('作品少时一幅一根；多了按轨道宽度封顶（约每 5px 一根）', () => {
    expect(tickCount(12, 800)).toBe(12);
    expect(tickCount(100000, 800)).toBe(160);
    expect(tickCount(100000, 0)).toBe(TICK_FALLBACK);
    expect(tickCount(0, 800)).toBe(0);
  });

  it('每一幅正好落在一段里，段和段首尾相接、覆盖全部', () => {
    for (const [n, m] of [[100000, 160], [1001, 7], [12, 12], [5, 3]]) {
      expect(bucketStart(0, n, m)).toBe(0);
      expect(bucketStart(m, n, m)).toBe(n);
      for (let b = 0; b < m; b++) expect(bucketStart(b + 1, n, m)).toBeGreaterThan(bucketStart(b, n, m));
      for (const i of [0, 1, Math.floor(n / 2), n - 2, n - 1]) {
        const b = bucketOf(i, n, m);
        expect(i).toBeGreaterThanOrEqual(bucketStart(b, n, m));
        expect(i).toBeLessThan(bucketStart(b + 1, n, m));
      }
    }
  });

  it('刻度位置：一幅一根时和原来一样；分段时在这一段中间那幅', () => {
    expect(tickPosition(3, 12, 12)).toBeCloseTo(3 / 11);
    expect(tickPosition(0, 1, 1)).toBe(0.5);
    const p0 = tickPosition(0, 100000, 160), pLast = tickPosition(159, 100000, 160);
    expect(p0).toBeGreaterThan(0);
    expect(pLast).toBeLessThan(1);
    expect(tickPosition(80, 100000, 160)).toBeCloseTo(0.5, 2);
  });
});

describe('系列分页不扫整个系列', () => {
  it('二分查找', () => {
    const xs = [2, 5, 9, 14, 30];
    expect(sortedIndexOf(xs, 9)).toBe(2);
    expect(sortedIndexOf(xs, 30)).toBe(4);
    expect(sortedIndexOf(xs, 10)).toBe(-1);
    expect(sortedIndexOf([], 1)).toBe(-1);
  });

  it('9 万幅的系列也只取当前这一页', () => {
    const series = Array.from({ length: 90000 }, (_, i) => i * 2);
    const caps = { top: 6, bottom: 8 };
    const p = thumbPage(series, series[45000], caps);
    expect(p.pages).toBe(Math.ceil(90000 / 14));
    expect(p.page).toBe(Math.floor(45000 / 14));
    expect(p.items.length).toBe(13);
    expect(p.items).not.toContain(series[45000]);
  });
});
