// 2026-11-20：命令面板的搜索
import { describe, it, expect } from 'vitest';
import { isSubsequence, normalize, prepare, score, search, type SearchItem } from './search';

const item = (label: string, o: Partial<SearchItem> = {}): SearchItem => ({ kind: 'work', label, run: () => {}, ...o });

describe('命令面板搜索', () => {
  it('统一大小写和全角半角', () => {
    expect(normalize('  ＡＢＣ Def ')).toBe('abc def');
  });

  it('跳着字也算（按顺序出现）', () => {
    expect(isSubsequence('午窗', '午后的窗')).toBe(true);
    expect(isSubsequence('窗午', '午后的窗')).toBe(false);
  });

  it('打分：名字开头 > 某个词的开头 > 名字里任意位置 > 副标题 / 关键词 > 跳字', () => {
    const [p] = prepare([item('Summer Window', { sub: '2025.06.14 · 夏日', keywords: 'IMG_0042.png' })]);
    expect(score('sum', p)).toBe(100);
    expect(score('win', p)).toBe(70);
    expect(score('ndow', p)).toBe(50);
    expect(score('夏日', p)).toBe(25);
    expect(score('img_0042', p)).toBe(25);
    expect(score('smw', p)).toBe(10);
    expect(score('xyz', p)).toBe(0);
    // 名字完全一样再加分
    expect(score('summer window', p)).toBe(100 + 70 + 60);
  });

  it('多个词都要命中', () => {
    const items = prepare([item('午后的窗', { sub: '夏日' }), item('午夜', { sub: '冬日' })]);
    expect(search('午 夏日', items).map((i) => i.label)).toEqual(['午后的窗']);
  });

  it('按分数排，同分时名字短的在前，再按原来的顺序', () => {
    const items = prepare([
      item('海边速写 2', { kind: 'work' }),
      item('速写', { kind: 'series' }),
      item('海边', { kind: 'set' }),
      item('海边速写', { kind: 'work' }),
    ]);
    expect(search('海边', items).map((i) => i.label)).toEqual(['海边', '海边速写', '海边速写 2']);
    expect(search('速写', items).map((i) => i.label)).toEqual(['速写', '海边速写', '海边速写 2']);
  });

  it('空查询不返回（面板里显示默认列表）；结果有上限', () => {
    const many = prepare(Array.from({ length: 120 }, (_, i) => item(`作品 ${i}`)));
    expect(search('   ', many)).toEqual([]);
    expect(search('作品', many)).toHaveLength(50);
    expect(search('作品', many, 10)).toHaveLength(10);
  });
});
