// 2026-11-20：星级和按星筛选
import { describe, it, expect } from 'vitest';
import { clampRating, countAtLeast, filterByRating, passes, ratingFromKey, toggleRating, viewIndexOf } from './rating';

const w = (rating?: number) => ({ rating });

describe('星级', () => {
  it('读回来的值：只认 1–5 的整数（小数四舍五入），其余当没打星', () => {
    expect(clampRating(3)).toBe(3);
    expect(clampRating(4.4)).toBe(4);
    for (const bad of [0, 6, -1, Number.NaN, Infinity, '3', null, undefined, {}]) expect(clampRating(bad)).toBe(0);
  });

  it('点星星：点第 n 颗设成 n 星，点到已经是的那颗就清除', () => {
    expect(toggleRating(0, 3)).toBe(3);
    expect(toggleRating(3, 5)).toBe(5);
    expect(toggleRating(3, 1)).toBe(1);
    expect(toggleRating(3, 3)).toBe(0);
  });

  it('数字键：1–5 打星，0 清除，别的键不管', () => {
    expect(['0', '1', '2', '3', '4', '5'].map(ratingFromKey)).toEqual([0, 1, 2, 3, 4, 5]);
    for (const k of ['6', '9', 'a', 'Enter', '', '10']) expect(ratingFromKey(k)).toBeNull();
  });
});

describe('按星筛选', () => {
  const works = [w(), w(3), w(5), w(1), w(4), w()];

  it('只看 n 星以上，顺序不变；0 = 不筛选，原样返回同一个数组', () => {
    expect(filterByRating(works, 3)).toEqual([w(3), w(5), w(4)]);
    expect(filterByRating(works, 5)).toEqual([w(5)]);
    expect(filterByRating(works, 0)).toBe(works);
    expect(passes(w(), 0)).toBe(true);
    expect(passes(w(), 1)).toBe(false);
  });

  it('数一数够格的有几幅（一幅都没有时不切换筛选）', () => {
    expect(countAtLeast(works, 1)).toBe(4);
    expect(countAtLeast(works, 4)).toBe(2);
    expect(countAtLeast([w(), w(2)], 3)).toBe(0);
  });

  it('全部作品里的第 i 幅在筛选后是第几幅：留下来的就是它，被筛掉的找后面最近的，后面没有找前面的', () => {
    const view = filterByRating(works, 3); // 原来的下标 1、2、4
    expect(viewIndexOf(works, view, 1)).toBe(0);
    expect(viewIndexOf(works, view, 2)).toBe(1);
    expect(viewIndexOf(works, view, 3)).toBe(2); // 被筛掉 → 后面的 4
    expect(viewIndexOf(works, view, 0)).toBe(0); // 被筛掉 → 后面的 1
    expect(viewIndexOf(works, view, 5)).toBe(2); // 后面没有 → 前面的 4
    expect(viewIndexOf(works, view, 99)).toBe(2);
    expect(viewIndexOf(works, [], 2)).toBe(0);
    // 没有筛选：下标原样（夹在范围里）
    expect(viewIndexOf(works, works, 4)).toBe(4);
    expect(viewIndexOf(works, works, -3)).toBe(0);
  });
});
