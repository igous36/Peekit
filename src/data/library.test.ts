import { describe, it, expect, beforeAll } from 'vitest';
import {
  emptySaved, mergeScan, parseSaved, addSources, knownMeta, updateSaved, applyToSample, formatLocalDate,
  UNSORTED_ID, SAVE_VERSION, type ScanItem,
} from './library';
import { sampleLibrary } from './sample';
import { setCustomTitle, assignWork } from './series-ops';
import { setLang } from '../i18n';

beforeAll(() => setLang('zh'));

let k = 0;
const ids = () => `sid${++k}`;

const item = (path: string, over: Partial<ScanItem> = {}): ScanItem => {
  const name = path.split(/[\\/]/).pop()!;
  return {
    path,
    fileName: name,
    title: name.replace(/\.[^.]+$/, ''),
    folder: null,
    folderName: null,
    date: null,
    ts: 1_700_000_000_000,
    mtime: 1_700_000_000_000,
    size: 100,
    width: 800,
    height: 1000,
    ...over,
  };
};

describe('合并扫描结果', () => {
  it('文件夹里的图按文件夹自动建系列，单独选的文件放进“未归类”', () => {
    const saved = emptySaved();
    const { lib, added } = mergeScan(
      saved,
      [
        item('D:\\art\\夏日\\a.png', { folder: 'D:\\art\\夏日', folderName: '夏日' }),
        item('D:\\art\\夏日\\b.png', { folder: 'D:\\art\\夏日', folderName: '夏日' }),
        item('D:\\art\\夜行\\c.png', { folder: 'D:\\art\\夜行', folderName: '夜行' }),
        item('D:\\misc\\d.jpg'),
      ],
      ids,
    );
    expect(added.length).toBe(4);
    const names = lib.series.map((s) => s.name);
    expect(names).toEqual(['夏日', '夜行', '未归类']);
    const byPath = Object.fromEntries(lib.works.map((w) => [w.id, w.series]));
    expect(byPath['D:\\art\\夏日\\a.png']).toBe(byPath['D:\\art\\夏日\\b.png']);
    expect(byPath['D:\\misc\\d.jpg']).toBe(UNSORTED_ID);
    // 系列色按 §3 顺序取
    expect(lib.series[0].color).toBe('#C27F4B');
    expect(lib.series[1].color).toBe('#5FA3C9');
  });

  it('文件夹名超过 16 个字截断', () => {
    const saved = emptySaved();
    const { lib } = mergeScan(saved, [item('x\\a.png', { folder: 'x', folderName: '一二三四五六七八九十一二三四五六七八' })], ids);
    expect(lib.series[0].name.length).toBe(16);
  });

  it('按日期从早到晚排序，日期相同按文件名', () => {
    const saved = emptySaved();
    const { lib } = mergeScan(saved, [
      item('c.png', { ts: 3 }),
      item('b.png', { ts: 1 }),
      item('a.png', { ts: 1 }),
    ]);
    expect(lib.works.map((w) => w.fileName)).toEqual(['a.png', 'b.png', 'c.png']);
  });

  it('元数据里没有日期时显示修改时间（本地日期）', () => {
    const mtime = new Date(2024, 10, 3, 12).getTime();
    const { lib } = mergeScan(emptySaved(), [item('a.png', { mtime, ts: mtime })]);
    expect(lib.works[0].date).toBe('2024.11.03');
    const { lib: lib2 } = mergeScan(emptySaved(), [item('b.png', { date: '2020.01.02' })]);
    expect(lib2.works[0].date).toBe('2020.01.02');
  });

  it('再次扫描：保留用户改过的归属、自定义标题、主色；同一文件夹的新图进同一个系列（哪怕系列改过名）', () => {
    const saved = emptySaved();
    const first = mergeScan(saved, [item('D:\\p\\a.png', { folder: 'D:\\p', folderName: 'p' })], ids);
    const sid = first.lib.works[0].series;
    // 用户改名、改标题、主色到位
    first.lib.series[0].name = '改过的名字';
    setCustomTitle(first.lib, 0, '我的标题');
    first.lib.works[0].bg = '#123456';
    updateSaved(saved, first.lib);

    const again = mergeScan(
      saved,
      [
        item('D:\\p\\a.png', { folder: 'D:\\p', folderName: 'p' }),
        item('D:\\p\\new.png', { folder: 'D:\\p', folderName: 'p' }),
      ],
      ids,
    );
    expect(again.added).toEqual(['D:\\p\\new.png']);
    const a = again.lib.works.find((w) => w.fileName === 'a.png')!;
    const b = again.lib.works.find((w) => w.fileName === 'new.png')!;
    expect(a.customTitle).toBe('我的标题');
    expect(a.bg).toBe('#123456');
    expect(b.series).toBe(sid);
    expect(again.lib.series.find((s) => s.id === sid)!.name).toBe('改过的名字');
  });

  it('用户把作品移到别的系列后，再扫描不会被文件夹规则改回去', () => {
    const saved = emptySaved();
    const first = mergeScan(saved, [item('D:\\p\\a.png', { folder: 'D:\\p', folderName: 'p' }), item('D:\\q.png')], ids);
    const i = first.lib.works.findIndex((w) => w.fileName === 'a.png');
    assignWork(first.lib, i, UNSORTED_ID);
    updateSaved(saved, first.lib);
    const again = mergeScan(saved, [item('D:\\p\\a.png', { folder: 'D:\\p', folderName: 'p' })], ids);
    expect(again.lib.works[0].series).toBe(UNSORTED_ID);
  });

  it('上次扫描的元数据可以复用（文件没变就不用重新读）', () => {
    const saved = emptySaved();
    mergeScan(saved, [item('a.png', { date: '2020.01.01', ts: 5, width: 300, height: 200 })]);
    expect(knownMeta(saved)['a.png']).toEqual({ mtime: 1_700_000_000_000, size: 100, ts: 5, width: 300, height: 200, date: '2020.01.01' });
  });
});

describe('导入来源', () => {
  it('去重，路径大小写和结尾斜杠不敏感', () => {
    const saved = emptySaved();
    expect(addSources(saved, [{ path: 'D:\\Art', kind: 'folder' }]).length).toBe(1);
    expect(addSources(saved, [{ path: 'd:\\art\\', kind: 'folder' }, { path: 'D:\\x.png', kind: 'file' }]).length).toBe(1);
    expect(saved.sources.length).toBe(2);
  });
});

describe('保存格式', () => {
  it('写出去再读回来不变', () => {
    const saved = emptySaved();
    addSources(saved, [{ path: 'D:\\Art', kind: 'folder' }]);
    mergeScan(saved, [item('D:\\Art\\a.png', { folder: 'D:\\Art', folderName: 'Art' })], ids);
    const back = parseSaved(JSON.parse(JSON.stringify(saved)));
    expect(back).toEqual(saved);
  });

  it('格式不对（包括旧版 v1）就整份忽略', () => {
    for (const bad of [
      null, 42, 'x', {}, { version: 1, series: [], assignments: {} },
      { version: SAVE_VERSION, sources: [{ path: 1 }], series: [], folderSeries: {}, works: {} },
      { version: SAVE_VERSION, sources: [], series: [{ id: 1 }], folderSeries: {}, works: {} },
      { version: SAVE_VERSION, sources: [], series: [], folderSeries: null, works: {} },
    ]) {
      expect(parseSaved(bad)).toBeNull();
    }
  });

  it('示例数据（浏览器调试）：保存的归属和自定义标题能套回去', () => {
    const lib = sampleLibrary();
    assignWork(lib, 3, 's2');
    setCustomTitle(lib, 3, '新标题');
    const saved = emptySaved();
    updateSaved(saved, lib);
    const fresh = sampleLibrary();
    applyToSample(fresh, parseSaved(JSON.parse(JSON.stringify(saved)))!);
    expect(fresh.works[3].series).toBe('s2');
    expect(fresh.works[3].customTitle).toBe('新标题');
  });

  it('本地日期格式', () => {
    expect(formatLocalDate(new Date(2025, 0, 5).getTime())).toBe('2025.01.05');
    expect(formatLocalDate(0)).toBe('');
  });
});
