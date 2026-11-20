// 2026-11-20：新旧对比
import { describe, it, expect } from 'vitest';
import type { Work } from '../data/types';
import { clampView, gapBetween, olderFirst, pairWorks, partnerOf, unpair, zoomView } from './compare';

const work = (id: string, date = ''): Work => ({ id, title: id, date, series: 's', bg: '#000000' });

describe('新旧对比', () => {
  it('配对两边互相指着；和新的一幅配对时原来那一对拆开', () => {
    const a = work('a'), b = work('b'), c = work('c');
    const byId = new Map([a, b, c].map((w) => [w.id, w]));
    pairWorks(byId, a, b);
    expect(partnerOf(byId, a)).toBe(b);
    expect(partnerOf(byId, b)).toBe(a);
    pairWorks(byId, a, c);
    expect(partnerOf(byId, a)).toBe(c);
    expect(b.pair).toBeUndefined();
    unpair(byId, c);
    expect(a.pair).toBeUndefined();
    expect(c.pair).toBeUndefined();
  });

  it('对方不在了、或者对方指着别人，都算没有搭档', () => {
    const a = work('a'), b = work('b');
    a.pair = 'gone';
    expect(partnerOf(new Map([['a', a]]), a)).toBeNull();
    a.pair = 'b';
    b.pair = 'x';
    expect(partnerOf(new Map([['a', a], ['b', b]]), a)).toBeNull();
  });

  it('按日期先后排，相隔几年几个月；不到一个月按天', () => {
    const old = work('old', '2023.05.20'), neu = work('new', '2024.09.19');
    expect(olderFirst(neu, old)).toEqual([old, neu]);
    expect(gapBetween(neu, old)).toEqual({ years: 1, months: 3, days: 0 });
    expect(gapBetween(work('x', '2025.01.01'), work('y', '2025.01.20'))).toEqual({ years: 0, months: 0, days: 19 });
    expect(gapBetween(work('x', '2025.01.31'), work('y', '2025.02.28'))).toEqual({ years: 0, months: 0, days: 28 });
    expect(gapBetween(work('x', '2025.01.01'), work('y'))).toBeNull();
  });

  it('同步缩放：以光标为中心，缩回 1 回到正中，平移有边界', () => {
    const v = zoomView({ z: 1, px: 0, py: 0 }, 2, 0.25, 0);
    expect(v.z).toBe(2);
    expect(v.px).toBeCloseTo(-0.25, 6); // 光标下的那一点不动
    expect(zoomView(v, 0.4, 0, 0)).toEqual({ z: 1, px: 0, py: 0 });
    const far = clampView({ z: 2, px: 5, py: -5 });
    expect(far.px).toBeLessThan(1);
    expect(far.py).toBeGreaterThan(-1);
  });
});
