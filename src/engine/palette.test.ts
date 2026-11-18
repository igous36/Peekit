// 2026-11-18：左上角计数圆环外圈的主题色
import { describe, it, expect } from 'vitest';
import { derivePalette, MIN_COLOR_DIST, paletteRgb, pickPalette } from './palette';

/** 按比例拼一张“图”的像素：[[颜色, 像素数], …] */
function image(parts: [string, number][], alpha = 255): number[] {
  const px: number[] = [];
  for (const [hex, n] of parts) {
    const [r, g, b] = paletteRgb(hex);
    for (let i = 0; i < n; i++) px.push(r, g, b, alpha);
  }
  return px;
}

const d = (a: string, b: string) => {
  const x = paletteRgb(a), y = paletteRgb(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};

describe('主题色', () => {
  it('挑出画面里的几种主要颜色，彼此有区别', () => {
    const p = pickPalette(image([['#2050C0', 300], ['#E0B040', 150], ['#F2F2F2', 100], ['#2252C2', 30]]));
    expect(p.length).toBe(3);
    expect(d(p[0], '#2050C0')).toBeLessThan(20);
    for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) expect(d(p[i], p[j])).toBeGreaterThanOrEqual(MIN_COLOR_DIST);
  });

  it('鲜明的颜色比同样面积的灰色优先', () => {
    const p = pickPalette(image([['#888888', 200], ['#D04030', 200], ['#3060D0', 120]]));
    expect(d(p[0], '#D04030')).toBeLessThan(20);
  });

  it('颜色单一时用主色转色相补齐；透明像素不算', () => {
    const p = pickPalette(image([['#30A060', 500]]));
    expect(p.length).toBe(3);
    expect(new Set(p).size).toBe(3);
    expect(pickPalette(image([['#FF0000', 50]], 0)).length).toBe(3);
  });

  it('只有一个主色时派生出 k 个不同的颜色，灰色只变明暗', () => {
    expect(new Set(derivePalette('#C27F4B', 3)).size).toBe(3);
    const gray = derivePalette('#808080', 3);
    expect(new Set(gray).size).toBe(3);
    for (const c of gray) {
      const [r, g, b] = paletteRgb(c);
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(2);
    }
  });
});

describe('左上角计数圆环（2026-11-18）', () => {
  it('进度：第 1 幅 0（灰圈），最后一幅满圈，中间按位置连续变化；拖过头不出界；只有一幅时满圈（全蓝），没有作品时 0', async () => {
    const { counterProgress } = await import('../view/counter');
    expect(counterProgress(0, 12)).toBe(0);
    expect(counterProgress(11, 12)).toBe(1);
    expect(counterProgress(5.5, 12)).toBeCloseTo(0.5);
    expect(counterProgress(-0.3, 12)).toBe(0);
    expect(counterProgress(11.4, 12)).toBe(1);
    expect(counterProgress(0, 1)).toBe(1);
    expect(counterProgress(-0.2, 1)).toBe(1); // 拖过头也还是满圈
    expect(counterProgress(0, 0)).toBe(0);
  });

  it('拖过头多少：头尾以内是 0，超出的部分按幅计', async () => {
    const { edgeOvershoot, EDGE_OVER } = await import('../view/counter');
    expect(edgeOvershoot(3, 12)).toBe(0);
    expect(edgeOvershoot(-0.2, 12)).toBeCloseTo(0.2);
    expect(edgeOvershoot(11.3, 12)).toBeCloseTo(0.3);
    expect(edgeOvershoot(0.5, 0)).toBe(0);
    expect(EDGE_OVER).toBeGreaterThan(0);
    expect(EDGE_OVER).toBeLessThan(0.1);
  });
});

describe('泛光强度跟着亮度变（2026-11-18）', () => {
  it('越亮泛光越强；停着时变化小，翻动时范围大（一闪一闪）', async () => {
    const { glowFor, luminance, GLOW_REST, GLOW_MOVING } = await import('./palette');
    expect(luminance('#000000')).toBe(0);
    expect(luminance('#FFFFFF')).toBeCloseTo(1);
    const dark = ['#1A1C24', '#22252E', '#2A2D38'], light = ['#F2E8D0', '#E8D9B0', '#FFF6E0'];
    expect(glowFor(light, false)).toBeGreaterThan(glowFor(dark, false));
    for (const m of [false, true]) {
      const [lo, hi] = m ? GLOW_MOVING : GLOW_REST;
      for (const c of [dark, light, ['#000000'], ['#FFFFFF']]) {
        expect(glowFor(c, m)).toBeGreaterThanOrEqual(lo);
        expect(glowFor(c, m)).toBeLessThanOrEqual(hi + 1e-9);
      }
    }
    const spread = (m: boolean) => glowFor(light, m) - glowFor(dark, m);
    expect(spread(true)).toBeGreaterThan(spread(false) * 2);
    // 停着时平均在 0.4 左右（用户调过的泛光强度）
    expect((GLOW_REST[0] + GLOW_REST[1]) / 2).toBeCloseTo(0.4);
  });
});
