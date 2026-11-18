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

describe('刻度随滑块起伏（2026-11-18）', () => {
  it('强度跟着翻动速度：停着 0，到 WAVE_FULL_SPEED 满，方向不影响', async () => {
    const { waveStrength, WAVE_FULL_SPEED } = await import('./ticks');
    expect(waveStrength(0)).toBe(0);
    expect(waveStrength(WAVE_FULL_SPEED)).toBe(1);
    expect(waveStrength(-WAVE_FULL_SPEED * 3)).toBe(1);
    expect(waveStrength(WAVE_FULL_SPEED / 2)).toBeCloseTo(0.5);
  });

  it('山包宽度跟着刻度间距：几万幅时窄、几幅时宽，夹在上下限之间', async () => {
    const { waveSigma, WAVE_SIGMA_MIN, WAVE_SIGMA_MAX } = await import('./ticks');
    expect(waveSigma(5)).toBe(WAVE_SIGMA_MIN);
    expect(waveSigma(100)).toBe(60);
    expect(waveSigma(700)).toBe(WAVE_SIGMA_MAX);
  });

  it('滑块正下方最高，越远越低；身后比前面宽；停着时不起伏', async () => {
    const { waveLift, WAVE_MAX_PX } = await import('./ticks');
    expect(waveLift(0, 40, 1, 1)).toBeCloseTo(WAVE_MAX_PX);
    expect(waveLift(40, 40, 1, 1)).toBeLessThan(waveLift(10, 40, 1, 1));
    expect(waveLift(200, 40, 1, 1)).toBeLessThan(0.01);
    // 往后翻（dir = +1）：身后是左边（dx < 0），比前面同样距离的高
    expect(waveLift(-60, 40, 1, 1)).toBeGreaterThan(waveLift(60, 40, 1, 1));
    expect(waveLift(0, 40, 0, 1)).toBe(0);
  });

  it('只有几幅时，滑块在两根刻度正中间，两边都明显起来', async () => {
    const { waveLift, waveSigma, waveStrength, WAVE_MAX_PX } = await import('./ticks');
    const spacing = 300; // 3 幅、600px 的轨道
    const lift = waveLift(spacing / 2, waveSigma(spacing), waveStrength(8), 0);
    expect(lift).toBeGreaterThan(WAVE_MAX_PX * 0.5);
  });

  it('起伏后最高 WAVE_CAP_PX（不碰上面的年份文字），基础高度本来就够高的不变矮', async () => {
    const { waveHeight, WAVE_CAP_PX } = await import('./ticks');
    expect(waveHeight(8, 10)).toBe(18);
    expect(waveHeight(18, 10)).toBe(WAVE_CAP_PX);
    expect(waveHeight(8, 0)).toBe(8);
    expect(waveHeight(30, 5)).toBe(30);
  });
});

describe('潮头：推进方向窄、陡，身后宽、缓（2026-11-18）', () => {
  it('同样距离，推进方向那一侧比对称时低（窄），身后比对称时高（宽）；翻得越快越明显', async () => {
    const { waveLift } = await import('./ticks');
    const sym = waveLift(30, 40, 1, 0);
    expect(waveLift(30, 40, 1, 1)).toBeLessThan(sym * 0.7); // 往后翻（+1），右边是前方
    expect(waveLift(-30, 40, 1, 1)).toBeGreaterThan(sym);
    expect(waveLift(-30, 40, 1, -1)).toBeLessThan(sym * 0.7); // 往前翻，左边是前方
    // 慢的时候不对称没那么明显（前方 / 对称 的比值更接近 1）
    const ratio = (s: number) => waveLift(30, 40, s, 1) / waveLift(30, 40, s, 0);
    expect(ratio(0.3)).toBeGreaterThan(ratio(1));
    // 正下方不受影响
    expect(waveLift(0, 40, 1, 1)).toBeCloseTo(waveLift(0, 40, 1, 0));
  });
});
