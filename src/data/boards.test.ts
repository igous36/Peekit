import { describe, expect, it } from 'vitest';
import {
  addPhotos, createBoard, deleteBoard, duplicateBoard, emptyBoards, hasPhoto, mergeGroups, parseBoards, pickGroupColor,
  removeItems, renameBoard, splitGroups, uniqueBoardName, type PhotoSource,
} from './boards';
import { BOARD_GAP, components, overlap } from '../engine/board-layout';

const photo = (i: number, pw = 800, ph = 1000): PhotoSource => ({ path: `C:/img/${i}.png`, title: `${i}`, pw, ph });

describe('情绪板：新建、改名、复制、删除', () => {
  it('默认名字重名时加序号', () => {
    const d = emptyBoards();
    const a = createBoard(d);
    const b = createBoard(d);
    expect(a.name).not.toBe(b.name);
    expect(uniqueBoardName(d, a.name)).not.toBe(a.name);
  });

  it('改名去掉空白，空名字不改', () => {
    const d = emptyBoards();
    const b = createBoard(d, '灵感');
    expect(renameBoard(d, b.id, '  夜色 ')).toBe(true);
    expect(b.name).toBe('夜色');
    expect(renameBoard(d, b.id, '   ')).toBe(false);
  });

  it('复制：照片 id 换新的，放在原来的后面；删除返回被删的', () => {
    const d = emptyBoards();
    const b = createBoard(d, 'A');
    addPhotos(b, [photo(1), photo(2)]);
    const c = duplicateBoard(d, b.id)!;
    expect(d.boards[1]).toBe(c);
    expect(c.items).toHaveLength(2);
    expect(c.items[0].id).not.toBe(b.items[0].id);
    expect(deleteBoard(d, b.id)).toBe(b);
    expect(d.boards).toEqual([c]);
  });
});

describe('加照片', () => {
  it('一张：自己成一个集合；同一张图不重复加', () => {
    const d = emptyBoards();
    const b = createBoard(d);
    addPhotos(b, [photo(1)]);
    addPhotos(b, [photo(2)]);
    expect(addPhotos(b, [photo(1)])).toHaveLength(0);
    expect(b.items).toHaveLength(2);
    expect(b.groups).toHaveLength(2);
    expect(b.items[0].group).not.toBe(b.items[1].group);
    // 两个集合颜色不同，彼此不重叠
    expect(b.groups[0].color).not.toBe(b.groups[1].color);
    expect(overlap(b.items[0], b.items[1])).toBe(false);
    expect(hasPhoto(b, { path: 'C:/img/1.png' })).toBe(true);
  });

  it('多张：按最密结构排成一块（一个集合，互相贴着），不压到原有的照片', () => {
    const d = emptyBoards();
    const b = createBoard(d);
    addPhotos(b, [photo(0)]);
    const added = addPhotos(b, [photo(1), photo(2, 1600, 900), photo(3, 900, 1600), photo(4), photo(5, 1000, 1000)]);
    expect(new Set(added.map((it) => it.group)).size).toBe(1);
    expect(components(added, BOARD_GAP)).toHaveLength(1);
    for (const it of added) expect(overlap(it, b.items[0], BOARD_GAP)).toBe(false);
  });
});

describe('集合拆分 / 合并', () => {
  it('移除中间那张：断开的两边拆成两个集合，大的保留原来的颜色', () => {
    const d = emptyBoards();
    const b = createBoard(d);
    const items = addPhotos(b, [photo(1), photo(2), photo(3), photo(4)]);
    const gid = items[0].group;
    const color = b.groups[0].color;
    // 手动摆成一排：0 1 2 3（等高、隔一条缝）
    items.forEach((it, i) => Object.assign(it, { x: i * (100 + BOARD_GAP), y: 0, w: 100, h: 125 }));
    removeItems(b, new Set([items[1].id]));
    const groups = new Set(b.items.map((it) => it.group));
    expect(groups.size).toBe(2);
    const big = b.items.filter((it) => it.group === gid);
    expect(big).toHaveLength(2);
    expect(b.groups.find((g) => g.id === gid)!.color).toBe(color);
  });

  it('splitGroups 只拆真的断开了的集合；mergeGroups 合并后空集合被去掉', () => {
    const d = emptyBoards();
    const b = createBoard(d);
    const [x] = addPhotos(b, [photo(1)]);
    const [y] = addPhotos(b, [photo(2)]);
    Object.assign(x, { x: 0, y: 0, w: 100, h: 100 });
    Object.assign(y, { x: 100 + BOARD_GAP, y: 0, w: 100, h: 100 });
    mergeGroups(b, x.group, [y.group]);
    expect(y.group).toBe(x.group);
    expect(b.groups).toHaveLength(1);
    expect(splitGroups(b, [x.group])).toEqual([]);
    y.x = 900;
    expect(splitGroups(b, [x.group])).toHaveLength(1);
    expect(b.groups).toHaveLength(2);
  });

  it('新集合取用得最少的颜色', () => {
    const d = emptyBoards();
    const b = createBoard(d);
    addPhotos(b, [photo(1)]);
    addPhotos(b, [photo(2)]);
    const used = b.groups.map((g) => g.color);
    expect(used).not.toContain(pickGroupColor(b));
  });
});

describe('读回来的数据', () => {
  it('格式不对整个当空；坏掉的照片丢掉、缺的集合补上', () => {
    expect(parseBoards(null).boards).toEqual([]);
    expect(parseBoards({ version: 99, boards: [] }).boards).toEqual([]);
    const raw = {
      version: 1,
      boards: [{
        id: 'b1', name: '灵感', createdAt: 1, updatedAt: 2, groups: [],
        items: [
          { id: 'i1', path: 'C:/a.png', title: 'a', pw: 800, ph: 1000, x: 0, y: 0, w: 288, h: 360, group: 'g1', addedAt: 1 },
          { id: 'i2', title: '没有路径', x: 0, y: 0, w: 10, h: 10, group: 'g1' },
          { id: 'i3', path: 'C:/c.png', x: 0, y: 0, w: 0, h: 10, group: 'g1' },
        ],
      }, { name: '缺 id' }],
    };
    const d = parseBoards(raw);
    expect(d.boards).toHaveLength(1);
    expect(d.boards[0].items.map((it) => it.id)).toEqual(['i1']);
    expect(d.boards[0].groups.map((g) => g.id)).toEqual(['g1']);
  });
});
