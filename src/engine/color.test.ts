import { describe, it, expect } from 'vitest';
import {
  normalizeHex, hexToHsl, hslToHex, clampMuted, nearestAngle, angleFromPoint, ringGradient, MUTED,
} from './color';
import { seriesPalette, seriesPresets } from '../tokens';

describe('系列颜色换算（2026-11-17 新增）', () => {
  it('色值输入：三位 / 六位、带不带 #、大小写都认，其余不认', () => {
    expect(normalizeHex('#c27f4b')).toBe('#C27F4B');
    expect(normalizeHex('abc')).toBe('#AABBCC');
    expect(normalizeHex(' #5FA3C9 ')).toBe('#5FA3C9');
    expect(normalizeHex('#12345')).toBeNull();
    expect(normalizeHex('red')).toBeNull();
  });

  it('HEX ↔ HSL 来回换不走样', () => {
    for (const { hex } of seriesPresets) expect(hslToHex(hexToHsl(hex))).toBe(hex);
    expect(hexToHsl('#808080')).toEqual({ h: 0, s: 0, l: expect.closeTo(50.2, 1) });
    expect(hslToHex({ h: 0, s: 100, l: 50 })).toBe('#FF0000');
    expect(hslToHex({ h: 360, s: 100, l: 50 })).toBe('#FF0000');
  });

  it('预设色都是低饱和的，前 4 个就是新建系列时轮流用的颜色', () => {
    expect(seriesPresets.slice(0, 4).map((p) => p.hex)).toEqual([...seriesPalette]);
    for (const { hex } of seriesPresets) expect(hexToHsl(hex).s).toBeLessThanOrEqual(50);
    expect(new Set(seriesPresets.map((p) => p.hex)).size).toBe(seriesPresets.length);
  });

  it('调色器只在低饱和范围里取色', () => {
    expect(clampMuted({ h: 120, s: 100, l: 50 })).toEqual({ h: 120, s: MUTED.sMax, l: 50 });
    expect(clampMuted({ h: 10, s: 0, l: 95 })).toEqual({ h: 10, s: MUTED.sMin, l: MUTED.lMax });
  });

  it('色相环旋钮走近的那一边，角度不折回', () => {
    expect(nearestAngle(350, 10)).toBe(370);
    expect(nearestAngle(10, 350)).toBe(-10);
    expect(nearestAngle(720 + 90, 100)).toBe(720 + 100);
    // 正好半圈：往哪边都一样近
    expect(Math.abs(nearestAngle(0, 180))).toBe(180);
  });

  it('指针位置 → 色相：正上方 0°，顺时针', () => {
    expect(angleFromPoint(0, -10)).toBeCloseTo(0);
    expect(angleFromPoint(10, 0)).toBeCloseTo(90);
    expect(angleFromPoint(0, 10)).toBeCloseTo(180);
    expect(angleFromPoint(-10, 0)).toBeCloseTo(270);
  });

  it('色相环渐变首尾同色，形成闭环', () => {
    const g = ringGradient({ s: 40, l: 60 });
    expect(g.startsWith('conic-gradient(from 0deg, hsl(0 40% 60%)')).toBe(true);
    expect(g.endsWith('hsl(360 40% 60%))')).toBe(true);
  });
});
