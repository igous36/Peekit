import { describe, expect, it } from 'vitest';
import { WORDMARK_PATHS, WORDMARK_VIEWBOX, wordmarkWidth } from './wordmark';

describe('手写字标', () => {
  it('宽度按 viewBox 比例算', () => {
    expect(wordmarkWidth(WORDMARK_VIEWBOX.h)).toBe(WORDMARK_VIEWBOX.w);
    expect(wordmarkWidth(26)).toBeCloseTo((26 * 440) / 190, 1);
  });

  it('主笔画是一笔（只有一个 M），t 的横另起', () => {
    expect(WORDMARK_PATHS).toHaveLength(2);
    for (const d of WORDMARK_PATHS) {
      expect(d.match(/M/g)).toHaveLength(1);
      // 只用 M / C 两种命令，数字都是有限值
      expect(d.replace(/[MC]/g, '').trim().split(/\s+/).every((n) => Number.isFinite(Number(n)))).toBe(true);
    }
  });

  it('所有点都在 viewBox 里（留出半个笔画）', () => {
    const v = WORDMARK_VIEWBOX;
    for (const d of WORDMARK_PATHS) {
      const nums = d.replace(/[MC]/g, '').trim().split(/\s+/).map(Number);
      for (let i = 0; i < nums.length; i += 2) {
        expect(nums[i]).toBeGreaterThanOrEqual(v.x + 8);
        expect(nums[i]).toBeLessThanOrEqual(v.x + v.w - 8);
        expect(nums[i + 1]).toBeGreaterThanOrEqual(v.y + 8);
        expect(nums[i + 1]).toBeLessThanOrEqual(v.y + v.h - 8);
      }
    }
  });
});
