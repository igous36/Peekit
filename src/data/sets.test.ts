import { describe, it, expect, beforeAll } from 'vitest';
import {
  loadSets, parseSets, currentSet, createSet, renameSet, deleteSet, duplicateSet, setCurrent, uniqueSetName, nameFromSources,
  SET_NAME_MAX, SETS_VERSION,
} from './sets';
import { emptySaved, addSources } from './library';
import { setLang } from '../i18n';

beforeAll(() => setLang('zh'));

let k = 0;
const ids = () => `s${++k}`;

describe('预览集：启动和迁移', () => {
  it('什么都没有：建一个空的「我的作品」', () => {
    const s = loadSets(null, null, ids);
    expect(s.version).toBe(SETS_VERSION);
    expect(s.sets.length).toBe(1);
    expect(s.sets[0].name).toBe('我的作品');
    expect(s.current).toBe(s.sets[0].id);
  });

  it('旧版 v2 作品库迁移成第一个预览集，导入来源和归属都保留', () => {
    const legacy = emptySaved();
    addSources(legacy, [{ path: 'D:\\Art', kind: 'folder' }]);
    legacy.works['D:\\Art\\a.png'] = { series: 'x', customTitle: '标题' };
    const s = loadSets(null, JSON.parse(JSON.stringify(legacy)), ids);
    expect(s.sets.length).toBe(1);
    expect(currentSet(s).library.sources[0].path).toBe('D:\\Art');
    expect(currentSet(s).library.works['D:\\Art\\a.png'].customTitle).toBe('标题');
    expect(currentSet(s).count).toBe(1);
  });

  it('有 v3 就直接用，写出去再读回来不变', () => {
    const s = loadSets(null, null, ids);
    createSet(s, '旅行速写', ids);
    const back = loadSets(JSON.parse(JSON.stringify(s)), null, ids);
    expect(back).toEqual(s);
  });

  it('v3 格式不对就退回迁移 / 新建；current 指向不存在的集时改成第一个', () => {
    expect(parseSets({ version: 3, current: 'x', sets: [] })).toBeNull();
    expect(parseSets({ version: 3, current: 'x', sets: [{ id: 1 }] })).toBeNull();
    const s = loadSets(null, null, ids);
    const raw = JSON.parse(JSON.stringify(s));
    raw.current = 'nope';
    expect(parseSets(raw)!.current).toBe(s.sets[0].id);
  });
});

describe('预览集：新建、改名、切换、删除', () => {
  it('新建：名字重复时自动加编号，太长截断', () => {
    const s = loadSets(null, null, ids);
    expect(createSet(s, undefined, ids).name).toBe('新预览集');
    expect(createSet(s, undefined, ids).name).toBe('新预览集 2');
    expect(createSet(s, '我的作品', ids).name).toBe('我的作品 2');
    expect(createSet(s, 'x'.repeat(40), ids).name.length).toBe(SET_NAME_MAX);
    expect(uniqueSetName(s, '   ')).toBe('新预览集 3');
  });

  it('新建的预览集是空的，不会自动切换', () => {
    const s = loadSets(null, null, ids);
    const before = s.current;
    const n = createSet(s, '商稿', ids);
    expect(n.library.sources).toEqual([]);
    expect(n.count).toBe(0);
    expect(s.current).toBe(before);
  });

  it('改名：去掉首尾空白，空名字不改', () => {
    const s = loadSets(null, null, ids);
    const id = s.sets[0].id;
    expect(renameSet(s, id, '  插画  ')).toBe(true);
    expect(s.sets[0].name).toBe('插画');
    expect(renameSet(s, id, '   ')).toBe(false);
    expect(s.sets[0].name).toBe('插画');
  });

  it('切换', () => {
    const s = loadSets(null, null, ids);
    const b = createSet(s, 'B', ids);
    expect(setCurrent(s, b.id)).toBe(true);
    expect(currentSet(s).id).toBe(b.id);
    expect(setCurrent(s, 'nope')).toBe(false);
  });

  it('删除当前预览集：切到相邻的一个；删别的不影响当前', () => {
    const s = loadSets(null, null, ids);
    const a = s.sets[0];
    const b = createSet(s, 'B', ids);
    const c = createSet(s, 'C', ids);
    setCurrent(s, b.id);
    expect(deleteSet(s, a.id)).toBe(false);
    expect(s.current).toBe(b.id);
    expect(deleteSet(s, b.id)).toBe(true);
    expect(s.current).toBe(c.id);
  });

  it('删光了自动建一个空的「我的作品」', () => {
    const s = loadSets(null, null, ids);
    expect(deleteSet(s, s.sets[0].id, ids)).toBe(true);
    expect(s.sets.length).toBe(1);
    expect(s.sets[0].name).toBe('我的作品');
    expect(s.current).toBe(s.sets[0].id);
  });

  it('导入到新建预览集时的名字：单个文件夹用文件夹名', () => {
    expect(nameFromSources(['D:\\Pictures\\旅行速写\\'], 'folder')).toBe('旅行速写');
    expect(nameFromSources(['D:\\a', 'D:\\b'], 'folder')).toBeUndefined();
    expect(nameFromSources(['D:\\x.png'], 'file')).toBeUndefined();
  });
});

describe('复制预览集（2026-11-18）', () => {
  it('作品、来源原样复制一份（深拷贝），名字加「副本」，放在原来那个后面，不切换', () => {
    const s = loadSets(null, null, ids);
    addSources(s.sets[0].library, [{ path: 'D:\Art', kind: 'folder' }]);
    s.sets[0].count = 12;
    createSet(s, '别的', ids);
    const copy = duplicateSet(s, s.sets[0].id, ids)!;
    expect(s.sets.map((x) => x.name)).toEqual(['我的作品', '我的作品 副本', '别的']);
    expect(copy.count).toBe(12);
    expect(copy.library.sources).toEqual(s.sets[0].library.sources);
    expect(copy.library).not.toBe(s.sets[0].library);
    copy.library.sources.push({ path: 'E:\X', kind: 'folder' });
    expect(s.sets[0].library.sources.length).toBe(1);
    expect(s.current).toBe(s.sets[0].id);
    // 再复制一次：重名加序号
    expect(duplicateSet(s, s.sets[0].id, ids)!.name).toBe('我的作品 副本 2');
    expect(duplicateSet(s, 'nope', ids)).toBeNull();
  });
});
