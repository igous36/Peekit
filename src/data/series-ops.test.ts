import { describe, it, expect, beforeAll } from 'vitest';
import { sampleLibrary } from './sample';
import {
  renameSeries, assignWork, createSeries, finalizeNames, visibleSeries, displayName, displayTitle, setCustomTitle,
  SERIES_NAME_MAX, TITLE_MAX,
} from './series-ops';
import { setLang } from '../i18n';

let n = 0;
const ids = () => `new${++n}`;

beforeAll(() => setLang('zh'));

describe('系列改名', () => {
  it('实时改名，所有同系列作品跟着变（它们引用同一个系列）', () => {
    const lib = sampleLibrary();
    renameSeries(lib, 's1', '盛夏');
    expect(lib.series.find((s) => s.id === 's1')!.name).toBe('盛夏');
    expect(lib.works.filter((w) => w.series === 's1').length).toBe(5);
  });

  it(`最多 ${SERIES_NAME_MAX} 个字符`, () => {
    const lib = sampleLibrary();
    renameSeries(lib, 's1', '一二三四五六七八九十一二三四五六七八');
    expect(lib.series[0].name.length).toBe(SERIES_NAME_MAX);
  });

  it('输入中允许为空；显示时用“未命名系列”；完成时补全空名字（含全空白）', () => {
    const lib = sampleLibrary();
    renameSeries(lib, 's1', '');
    renameSeries(lib, 's2', '   ');
    expect(lib.series[0].name).toBe('');
    expect(displayName(lib.series[0])).toBe('未命名系列');
    finalizeNames(lib);
    expect(lib.series[0].name).toBe('未命名系列');
    expect(lib.series[1].name).toBe('未命名系列');
    expect(lib.series[2].name).toBe('植物志');
  });
});

describe('自定义标题', () => {
  it('有自定义标题就显示它，清空后恢复源文件标题', () => {
    const lib = sampleLibrary();
    expect(displayTitle(lib.works[3])).toBe('午后的窗');
    setCustomTitle(lib, 3, '六月的光');
    expect(displayTitle(lib.works[3])).toBe('六月的光');
    expect(lib.works[3].title).toBe('午后的窗');
    setCustomTitle(lib, 3, '   ');
    expect(lib.works[3].customTitle).toBeUndefined();
    expect(displayTitle(lib.works[3])).toBe('午后的窗');
  });

  it(`最多 ${TITLE_MAX} 个字符`, () => {
    const lib = sampleLibrary();
    setCustomTitle(lib, 0, 'x'.repeat(100));
    expect(lib.works[0].customTitle!.length).toBe(TITLE_MAX);
  });
});

describe('归入系列 / 新建系列', () => {
  it('点芯片：把当前作品移过去', () => {
    const lib = sampleLibrary();
    assignWork(lib, 3, 's2');
    expect(lib.works[3].series).toBe('s2');
  });

  it('新建系列：和原型一样依次叫「新系列 1」「新系列 2」，颜色依次取 #C27F4B #5FA3C9', () => {
    const lib = sampleLibrary();
    const a = createSeries(lib, 3, ids);
    expect(a.name).toBe('新系列 1');
    expect(a.color).toBe('#C27F4B');
    expect(lib.works[3].series).toBe(a.id);
    const b = createSeries(lib, 4, ids);
    expect(b.name).toBe('新系列 2');
    expect(b.color).toBe('#5FA3C9');
  });

  it('新建系列：名字跳过已经存在的编号，颜色全用完后轮换', () => {
    const lib = sampleLibrary();
    lib.series.push({ id: 'x', name: '新系列 1', color: '#C27F4B' });
    expect(createSeries(lib, 0, ids).name).toBe('新系列 2');
    for (let i = 0; i < 4; i++) createSeries(lib, i, ids);
    const last = lib.series[lib.series.length - 1];
    expect(last.color).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it('空系列从芯片列表里隐藏，但数据保留', () => {
    const lib = sampleLibrary();
    const s = createSeries(lib, 3, ids);
    expect(visibleSeries(lib).map((x) => x.id)).toContain(s.id);
    assignWork(lib, 3, 's1');
    expect(visibleSeries(lib).map((x) => x.id)).not.toContain(s.id);
    expect(lib.series.map((x) => x.id)).toContain(s.id);
  });
});
