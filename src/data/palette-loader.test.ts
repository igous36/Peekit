// 2026-11-18：计数圆环外圈的主题色——翻动中用主色快速跟，停下再抓完整的
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PaletteLoader, fallbackPalette } from './palette-loader';
import { orbitStep, ORBIT_DEG, ORBIT_MAX_STEP } from '../view/counter';
import type { Work } from './types';

const work = (id: string, bg: string, thumb?: string): Work =>
  ({ id, title: id, date: '', series: 's', bg, path: thumb ? `${id}.png` : undefined, thumb }) as Work;

describe('主题色加载', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('翻动中每换一幅立刻给主色派生的颜色（快速过渡），不去抓图', () => {
    const calls: [string[], boolean][] = [];
    const p = new PaletteLoader((c, fast) => calls.push([c, fast]));
    const a = work('a', '#C27F4B', 'data:,'), b = work('b', '#4B7FC2', 'data:,');
    p.request(a, true);
    p.request(a, true); // 同一幅、还在动：不重复
    p.request(b, true);
    expect(calls.length).toBe(2);
    expect(calls[0]).toEqual([fallbackPalette(a), true]);
    expect(calls[1]).toEqual([fallbackPalette(b), true]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('停下后停留一会儿再抓完整的主题色（慢过渡），之后翻回来直接用缓存、不再抓', async () => {
    const calls: [string[], boolean][] = [];
    const p = new PaletteLoader((c, fast) => calls.push([c, fast]));
    const a = work('a', '#C27F4B', 'data:,'), b = work('b', '#4B7FC2', 'data:,');
    p.request(a, true);
    p.request(a, false); // 停在 a
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(200);
    await vi.waitFor(() => expect(calls.length).toBe(2));
    expect(calls[1][1]).toBe(false); // 慢过渡
    p.request(b, true);
    p.request(a, true); // 翻回 a：缓存
    expect(calls[calls.length - 1][0]).toEqual(calls[1][0]);
    p.request(a, false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('没有缩略图（示例数据、SVG）：停下也不抓', () => {
    const calls: [string[], boolean][] = [];
    const p = new PaletteLoader((c, fast) => calls.push([c, fast]));
    p.request(work('x', '#30A060'), false);
    expect(calls.length).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('外圈跟着翻动转', () => {
  it('每翻一幅转 ORBIT_DEG 度，方向跟着翻动方向；一帧最多转 ORBIT_MAX_STEP 度；第一帧不转', () => {
    expect(orbitStep(NaN, 3)).toBe(0);
    expect(orbitStep(3, 3.5)).toBeCloseTo(ORBIT_DEG / 2);
    expect(orbitStep(3.5, 3)).toBeCloseTo(-ORBIT_DEG / 2);
    expect(orbitStep(0, 5000)).toBe(ORBIT_MAX_STEP);
    expect(orbitStep(5000, 0)).toBe(-ORBIT_MAX_STEP);
  });
});
