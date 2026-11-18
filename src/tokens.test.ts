// 2026-11-18：超椭圆圆角的半径补偿
import { describe, it, expect } from 'vitest';
import { CORNER_K, cornerScale, tokenCss } from './tokens';

/** superellipse(K) 的角，在对角线方向上角尖到曲线的距离（半径 r） */
const depth = (k: number, r: number) => {
  const n = 2 ** k;
  return Math.SQRT2 * r * (1 - 2 ** (-1 / n));
};

describe('超椭圆圆角', () => {
  it('K = 1（普通圆角）不放大；K 越大越“方”，要放大得越多', () => {
    expect(cornerScale(1)).toBeCloseTo(1, 10);
    expect(cornerScale(1.5)).toBeGreaterThan(1.3);
    expect(cornerScale(1.5)).toBeLessThan(1.4);
    expect(cornerScale(2)).toBeGreaterThan(cornerScale(1.5));
  });

  it('放大后角看起来一样大：对角线方向的深度和原来的普通圆角相同', () => {
    const r = 14;
    expect(depth(CORNER_K, r * cornerScale(CORNER_K))).toBeCloseTo(depth(1, r), 6);
  });

  it('不过分椭圆：K 在 1 和 squircle（2）之间', () => {
    expect(CORNER_K).toBeGreaterThan(1);
    expect(CORNER_K).toBeLessThan(2);
  });

  it('设计变量里有 --corner-shape 和 --corner-scale', () => {
    const css = tokenCss();
    expect(css).toContain(`--corner-shape:superellipse(${CORNER_K})`);
    expect(css).toMatch(/--corner-scale:1\.3\d{3}/);
  });
});
