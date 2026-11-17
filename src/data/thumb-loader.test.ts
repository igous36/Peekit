import { describe, it, expect } from 'vitest';
import { ThumbLoader } from './thumb-loader';
import type { Work } from './types';

const work = (i: number): Work => ({ id: `p${i}`, path: `p${i}`, title: `t${i}`, date: '', series: 's', bg: '#000' });

describe('缩略图队列', () => {
  it('离当前作品越近越先生成，最多同时 3 张，最后全部生成完', async () => {
    const works = Array.from({ length: 10 }, (_, i) => work(i));
    const order: string[] = [];
    let maxInflight = 0;
    let inflight = 0;
    const loader = new ThumbLoader(
      async (w) => {
        order.push(w.id);
        inflight++;
        maxInflight = Math.max(maxInflight, inflight);
        await new Promise((r) => setTimeout(r, 1));
        inflight--;
        return { url: `url:${w.id}`, color: '#123456' };
      },
      () => {},
    );
    loader.update(works, 5);
    expect(order.slice(0, 3).sort()).toEqual(['p4', 'p5', 'p6']);
    await new Promise((r) => setTimeout(r, 50));
    expect(maxInflight).toBeLessThanOrEqual(3);
    expect(works.every((w) => w.thumb === `url:${w.id}` && w.bg === '#123456')).toBe(true);
    expect(order.length).toBe(10);
  });

  it('生成失败的标成读不了，不再重试；示例数据（没有路径）跳过', async () => {
    const works = [work(0), { ...work(1), path: undefined }];
    let calls = 0;
    const settled: string[] = [];
    const loader = new ThumbLoader(
      async () => {
        calls++;
        throw new Error('坏图');
      },
      (w) => settled.push(w.id),
    );
    loader.update(works, 0);
    await new Promise((r) => setTimeout(r, 10));
    loader.update(works, 0);
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toBe(1);
    expect(works[0].broken).toBe(true);
    expect(settled).toEqual(['p0']);
  });
});
