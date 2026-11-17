// 2026-11-17 新增：从预览集移除作品、删除系列、再次导入时恢复、文件夹层级系列名的迁移
import { describe, it, expect, beforeAll } from 'vitest';
import {
  emptySaved, mergeScan, markRemoved, restoreRemoved, updateSaved, applyToSample, UNSORTED_ID, type ScanItem,
} from './library';
import { deleteSeries, removeWorks, SERIES_NAME_MAX } from './series-ops';
import { sampleLibrary } from './sample';
import type { Library } from './types';
import { setLang } from '../i18n';

beforeAll(() => setLang('zh'));

let k = 0;
const ids = () => `sid${++k}`;

const item = (path: string, folder: string | null = null, folderName: string | null = null): ScanItem => {
  const name = path.split(/[\\/]/).pop()!;
  return {
    path, fileName: name, title: name.replace(/\.[^.]+$/, ''), folder, folderName, date: null,
    ts: 1_700_000_000_000 + path.length, mtime: 1_700_000_000_000, size: 100, width: 800, height: 1000,
  };
};

const lib3 = (): Library => ({
  series: [
    { id: 'a', name: '夏日', color: '#C27F4B' },
    { id: 'b', name: '夜行', color: '#5FA3C9' },
  ],
  works: [
    { id: '1', title: '一', date: '', series: 'a', bg: '#fff' },
    { id: '2', title: '二', date: '', series: 'b', bg: '#fff' },
    { id: '3', title: '三', date: '', series: 'a', bg: '#fff' },
  ],
});

describe('从预览集移除作品', () => {
  it('removeWorks 换成新数组，只去掉指定的作品', () => {
    const lib = lib3();
    const before = lib.works;
    expect(removeWorks(lib, new Set(['2', 'nope']))).toEqual(['2']);
    expect(lib.works.map((w) => w.id)).toEqual(['1', '3']);
    expect(lib.works).not.toBe(before);
  });

  it('移除过的作品重新扫描时跳过，保存的标题和归属还在', () => {
    const saved = emptySaved();
    const scan = [item('D:\\p\\x.png'), item('D:\\p\\y.png')];
    const first = mergeScan(saved, scan, ids).lib;
    first.works[0].customTitle = '自定义';
    updateSaved(saved, first);
    const removed = removeWorks(first, new Set(['D:\\p\\x.png']));
    markRemoved(saved, removed);
    updateSaved(saved, first);

    const again = mergeScan(saved, scan, ids);
    expect(again.lib.works.map((w) => w.id)).toEqual(['D:\\p\\y.png']);
    expect(again.added).toEqual([]);
    expect(saved.works['D:\\p\\x.png'].customTitle).toBe('自定义');
  });

  it('再次导入这个文件、或它所在的文件夹（大小写不敏感）时恢复；别的来源不影响', () => {
    const saved = emptySaved();
    markRemoved(saved, ['D:\\Art\\夏\\a.png', 'D:\\Art\\b.png', 'E:\\c.png']);
    expect(restoreRemoved(saved, [{ path: 'D:\\Other', kind: 'folder' }])).toEqual([]);
    // D:\Art 不能误伤 D:\Artist
    markRemoved(saved, ['D:\\Artist\\d.png']);
    const back = restoreRemoved(saved, [{ path: 'd:\\art\\', kind: 'folder' }]);
    expect(back.sort()).toEqual(['D:\\Art\\b.png', 'D:\\Art\\夏\\a.png']);
    expect(saved.works['D:\\Artist\\d.png'].removed).toBe(true);
    expect(restoreRemoved(saved, [{ path: 'E:\\C.PNG', kind: 'file' }])).toEqual(['E:\\c.png']);
    // 恢复后重新扫描就又出现了
    expect(mergeScan(saved, [item('E:\\c.png')], ids).lib.works.length).toBe(1);
  });

  it('示例数据（浏览器调试）也去掉移除过的', () => {
    const saved = emptySaved();
    const lib = sampleLibrary();
    const id = lib.works[0].id;
    markRemoved(saved, [id]);
    applyToSample(lib, saved);
    expect(lib.works.some((w) => w.id === id)).toBe(false);
  });
});

describe('删除系列', () => {
  it('只删系列：作品归入“未归类”（没有就建一个），系列从列表里去掉', () => {
    const lib = lib3();
    expect(deleteSeries(lib, 'a', false)).toEqual([]);
    expect(lib.series.map((s) => s.id)).toEqual(['b', UNSORTED_ID]);
    expect(lib.series.find((s) => s.id === UNSORTED_ID)!.name).toBe('未归类');
    expect(lib.works.map((w) => w.series)).toEqual([UNSORTED_ID, 'b', UNSORTED_ID]);
  });

  it('连同作品删除：系列和其中的作品都去掉，返回被移除的作品', () => {
    const lib = lib3();
    expect(deleteSeries(lib, 'a', true)).toEqual(['1', '3']);
    expect(lib.works.map((w) => w.id)).toEqual(['2']);
    expect(lib.series.map((s) => s.id)).toEqual(['b']);
  });

  it('“未归类”不能单独删除，只能连同作品一起删', () => {
    const lib = lib3();
    deleteSeries(lib, 'a', false);
    expect(deleteSeries(lib, UNSORTED_ID, false)).toEqual([]);
    expect(lib.works.filter((w) => w.series === UNSORTED_ID).length).toBe(2);
    expect(deleteSeries(lib, UNSORTED_ID, true)).toEqual(['1', '3']);
    expect(lib.series.map((s) => s.id)).toEqual(['b']);
  });
});

describe('文件夹层级系列名', () => {
  it('新导入：直接用 Rust 给的层级名「文件夹-子文件夹」，长名字不再截到 16 个字', () => {
    const saved = emptySaved();
    const long = '插画合集二〇二四-夏天草稿-第二批精选';
    const { lib } = mergeScan(
      saved,
      [
        item('D:\\插画\\a.png', 'D:\\插画', '插画'),
        item('D:\\插画\\2024\\b.png', 'D:\\插画\\2024', '插画-2024'),
        item('D:\\插画\\2024\\夏\\c.png', 'D:\\插画\\2024\\夏', '插画-2024-夏'),
        item('D:\\x\\d.png', 'D:\\x', long),
      ],
      ids,
    );
    expect(lib.series.map((s) => s.name)).toEqual(['插画', '插画-2024', '插画-2024-夏', long]);
    expect(long.length).toBeGreaterThan(16);
    expect(long.length).toBeLessThanOrEqual(SERIES_NAME_MAX);
  });

  it('旧版按末级文件夹名建的系列：没改过名的换成层级名，改过名的不动', () => {
    const saved = emptySaved();
    // 旧版扫描结果：folderName 是末级文件夹名
    mergeScan(
      saved,
      [
        item('D:\\插画\\a.png', 'D:\\插画', '插画'),
        item('D:\\插画\\2024\\b.png', 'D:\\插画\\2024', '2024'),
        item('D:\\插画\\草稿\\c.png', 'D:\\插画\\草稿', '草稿'),
      ],
      ids,
    );
    saved.series.find((s) => s.name === '草稿')!.name = '我改的名字';
    // 新版重新扫描
    const { lib } = mergeScan(
      saved,
      [
        item('D:\\插画\\a.png', 'D:\\插画', '插画'),
        item('D:\\插画\\2024\\b.png', 'D:\\插画\\2024', '插画-2024'),
        item('D:\\插画\\草稿\\c.png', 'D:\\插画\\草稿', '插画-草稿'),
      ],
      ids,
    );
    expect(lib.series.map((s) => s.name)).toEqual(['插画', '插画-2024', '我改的名字']);
  });
});
