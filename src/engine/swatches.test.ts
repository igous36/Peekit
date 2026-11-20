// 2026-11-20：主色组成、按颜色筛选、时间轴色条
import { describe, it, expect } from 'vitest';
import {
  colorDistance, familyOf, matchesColor, packSwatches, sameColorFilter, swatchesFromShapes, swatchesOf, unpackSwatches,
} from './swatches';
import { barcodeColumns, barcodeStops, indexAt, mixColors } from './barcode';

/** n 个像素，颜色 c */
const pixels = (parts: [number, [number, number, number]][]): number[] => {
  const out: number[] = [];
  for (const [n, c] of parts) for (let i = 0; i < n; i++) out.push(c[0], c[1], c[2], 255);
  return out;
};

describe('主色组成', () => {
  it('按占比从大到小，接近的颜色并成一个，太少的丢掉', () => {
    const px = pixels([
      [600, [240, 240, 238]], // 白底
      [20, [236, 236, 236]], // 和白底很接近：并进去
      [300, [40, 90, 200]], // 蓝
      [80, [210, 60, 50]], // 红
      [10, [20, 200, 30]], // 绿，只占 1%：丢掉
    ]);
    const s = swatchesOf(px);
    expect(s.map((x) => familyOf(x.hex))).toEqual(['white', 'blue', 'red']);
    expect(s[0].share).toBeCloseTo(620 / 1010, 2);
    expect(s.reduce((a, x) => a + x.share, 0)).toBeLessThanOrEqual(1);
  });

  it('透明像素不算；全透明返回空', () => {
    expect(swatchesOf([10, 10, 10, 0, 20, 20, 20, 0])).toEqual([]);
  });

  it('存档来回不变，坏数据丢掉', () => {
    const s = [{ hex: '#112233', share: 0.5 }, { hex: '#445566', share: 0.25 }];
    expect(unpackSwatches(JSON.parse(JSON.stringify(packSwatches(s))))).toEqual(s);
    expect(unpackSwatches([['zz', 1], ['#123456', 2], 'x'])).toBeUndefined();
    expect(unpackSwatches(null)).toBeUndefined();
  });

  it('示例数据按色块面积算', () => {
    const s = swatchesFromShapes([{ w: 50, h: 100, c: '#3E7BD6' }], '#FAFAFA');
    expect(s.map((x) => x.hex)).toEqual(['#3E7BD6', '#FAFAFA']);
    expect(s[0].share).toBeCloseTo(0.5, 5);
  });
});

describe('色系', () => {
  it('黑白灰先按明暗、浓淡分，其余按色相', () => {
    expect(familyOf('#0A0A0A')).toBe('black');
    expect(familyOf('#FFFFFF')).toBe('white');
    expect(familyOf('#F3EFE6')).toBe('white');
    expect(familyOf('#7F7F7F')).toBe('gray');
    expect(familyOf('#D9493F')).toBe('red');
    expect(familyOf('#F4B6B0')).toBe('pink'); // 浅红算粉
    expect(familyOf('#8A4B20')).toBe('orange'); // 棕色算橙
    expect(familyOf('#EBC53A')).toBe('yellow');
    expect(familyOf('#5BAA55')).toBe('green');
    expect(familyOf('#3FB2B8')).toBe('cyan');
    expect(familyOf('#1F3F8F')).toBe('blue');
    expect(familyOf('#8B5FD0')).toBe('purple');
    expect(familyOf('#E275AE')).toBe('pink');
  });

  it('彩色占 8% 就算有，黑白灰要 25%', () => {
    const s = [{ hex: '#FFFFFF', share: 0.2 }, { hex: '#3E7BD6', share: 0.09 }, { hex: '#7F7F7F', share: 0.3 }];
    expect(matchesColor(s, { kind: 'family', family: 'blue' })).toBe(true);
    expect(matchesColor(s, { kind: 'family', family: 'white' })).toBe(false);
    expect(matchesColor(s, { kind: 'family', family: 'gray' })).toBe(true);
    expect(matchesColor(s, { kind: 'family', family: 'red' })).toBe(false);
    expect(matchesColor(undefined, { kind: 'family', family: 'red' })).toBe(false);
  });

  it('任意颜色：OKLab 里相近才算', () => {
    const s = [{ hex: '#3E7BD6', share: 0.4 }];
    expect(colorDistance('#3E7BD6', '#3E7BD6')).toBeCloseTo(0, 6);
    expect(matchesColor(s, { kind: 'hex', hex: '#4580DA' })).toBe(true);
    expect(matchesColor(s, { kind: 'hex', hex: '#D9493F' })).toBe(false);
    expect(sameColorFilter({ kind: 'hex', hex: '#AABBCC' }, { kind: 'hex', hex: '#AABBCC' })).toBe(true);
    expect(sameColorFilter({ kind: 'family', family: 'red' }, { kind: 'hex', hex: '#AABBCC' })).toBe(false);
  });
});

describe('时间轴色条', () => {
  it('线性光里平均：黑白平均比 sRGB 平均亮', () => {
    expect(mixColors(['#000000', '#FFFFFF'])).toBe('#BCBCBC');
    expect(mixColors([null, '#123456'])).toBe('#123456');
    expect(mixColors([null])).toBeNull();
  });

  it('作品多：每列取覆盖到的作品平均', () => {
    const cols = barcodeColumns(['#FF0000', '#FF0000', '#0000FF', '#0000FF', '#0000FF'], 2);
    expect(cols).toHaveLength(2);
    expect(cols[1]).toBe('#0000FF');
  });

  it('作品少：每幅中间一段纯色，首尾延伸到两端', () => {
    const stops = barcodeStops(['#FF0000', null, '#0000FF'], '#888888');
    expect(stops[0]).toEqual({ at: 0, color: '#FF0000' });
    expect(stops[stops.length - 1]).toEqual({ at: 1, color: '#0000FF' });
    expect(stops[2].color).toBe('#888888');
    expect(stops.map((s) => s.at)).toEqual([...stops.map((s) => s.at)].sort((a, b) => a - b));
    expect(barcodeStops(['#123456'], '#000000')).toEqual([{ at: 0, color: '#123456' }, { at: 1, color: '#123456' }]);
  });

  it('色条上的位置换成第几幅（和刻度一样均匀）', () => {
    expect(indexAt(0, 5)).toBe(0);
    expect(indexAt(0.5, 5)).toBe(2);
    expect(indexAt(1, 5)).toBe(4);
    expect(indexAt(0.3, 1)).toBe(0);
  });
});
