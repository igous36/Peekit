import { describe, expect, it } from 'vitest';
import { markWidth, MOOD_BOARDS, PEEKIT, type Mark } from './wordmark';

const MARKS: [string, Mark][] = [['Peekit', PEEKIT], ['Mood boards', MOOD_BOARDS]];

describe('手写字标', () => {
  it('宽度按 viewBox 比例算', () => {
    expect(markWidth(PEEKIT, PEEKIT.viewBox.h)).toBe(PEEKIT.viewBox.w);
    expect(markWidth(PEEKIT, 26)).toBeCloseTo((26 * 440) / 190, 1);
  });

  it('两个字标的框一样大，标题栏里互换时不跳', () => {
    expect(MOOD_BOARDS.viewBox.w).toBe(PEEKIT.viewBox.w);
    expect(MOOD_BOARDS.viewBox.h).toBe(PEEKIT.viewBox.h);
    expect(markWidth(MOOD_BOARDS, 26)).toBe(markWidth(PEEKIT, 26));
  });

  it('Peekit 主笔画一笔写完、t 的横另起；Mood、boards 各一笔', () => {
    expect(PEEKIT.strokes).toHaveLength(2);
    expect(MOOD_BOARDS.strokes).toHaveLength(2);
  });

  it.each(MARKS)('%s：每笔只有一个 M，只用 M / C', (_, mark) => {
    for (const { d } of mark.strokes) {
      expect(d.match(/M/g)).toHaveLength(1);
      expect(d.replace(/[MC]/g, '').trim().split(/\s+/).every((n) => Number.isFinite(Number(n)))).toBe(true);
    }
  });

  it.each(MARKS)('%s：所有点都在 viewBox 里（留出半个笔画）', (_, mark) => {
    const v = mark.viewBox;
    for (const { d } of mark.strokes) {
      const nums = d.replace(/[MC]/g, '').trim().split(/\s+/).map(Number);
      for (let i = 0; i < nums.length; i += 2) {
        expect(nums[i]).toBeGreaterThanOrEqual(v.x + 8);
        expect(nums[i]).toBeLessThanOrEqual(v.x + v.w - 8);
        expect(nums[i + 1]).toBeGreaterThanOrEqual(v.y + 8);
        expect(nums[i + 1]).toBeLessThanOrEqual(v.y + v.h - 8);
      }
    }
  });

  it.each(MARKS)('%s：一笔写完才起下一笔（点 i 可以和 t 的横叠一点），1.5s 内写完', (_, mark) => {
    const lines = mark.strokes.map((s) => s.write);
    for (let i = 1; i < lines.length; i++) expect(lines[i][0]).toBeGreaterThanOrEqual(lines[i - 1][0] + lines[i - 1][1]);
    const all = [...lines, ...(mark.dot ? [mark.dot.write] : [])];
    expect(Math.max(...all.map(([a, d]) => a + d))).toBeLessThanOrEqual(1500);
  });
});
