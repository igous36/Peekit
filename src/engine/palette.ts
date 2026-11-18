// 当前作品的“主题色”（2026-11-18 新增，左上角计数圆环的外圈用）。纯函数。
//
// 做法：把缩略图缩到 24×24，按每个通道 4 位量化分桶计数；分数 = 像素数 × (0.35 + 饱和度)，
// 鲜明一点的颜色优先、但大面积的底色也有机会；按分数从高到低挑，和已经挑中的颜色要有足够区别。
// 挑不够（画面颜色很单一）就用主色转一转色相补齐。
import { hexToHsl, hslToHex, normalizeHex } from './color';

/** 两种颜色至少差这么多（RGB 欧氏距离，0–441）才算“不同” */
export const MIN_COLOR_DIST = 56;

const hex2 = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
const toHex = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`.toUpperCase();

function rgbOf(hex: string): [number, number, number] {
  const n = normalizeHex(hex) ?? '#808080';
  return [parseInt(n.slice(1, 3), 16), parseInt(n.slice(3, 5), 16), parseInt(n.slice(5, 7), 16)];
}

const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** 从 RGBA 像素里挑 k 个主题色（#RRGGBB）；透明像素不算 */
export function pickPalette(px: Uint8ClampedArray | readonly number[], k = 3): string[] {
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 3 < px.length; i += 4) {
    if (px[i + 3] < 128) continue;
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bin = bins.get(key);
    if (bin) {
      bin.n++;
      bin.r += r;
      bin.g += g;
      bin.b += b;
    } else {
      bins.set(key, { n: 1, r, g, b });
    }
  }
  const scored = [...bins.values()].map((x) => {
    const c: [number, number, number] = [x.r / x.n, x.g / x.n, x.b / x.n];
    const sat = (Math.max(...c) - Math.min(...c)) / 255;
    return { c, score: x.n * (0.35 + sat) };
  });
  scored.sort((a, b) => b.score - a.score);
  const picked: [number, number, number][] = [];
  for (const s of scored) {
    if (picked.every((p) => dist(p, s.c) >= MIN_COLOR_DIST)) picked.push(s.c);
    if (picked.length >= k) break;
  }
  if (!picked.length) return derivePalette('#808080', k);
  const out = picked.map((c) => toHex(c[0], c[1], c[2]));
  return out.length >= k ? out : [...out, ...derivePalette(out[0], k).slice(1, 1 + k - out.length)];
}

/** 只有一个主色时：色相往两边各转一点、明暗错开，凑成 k 个（灰色就只变明暗） */
export function derivePalette(hex: string, k = 3): string[] {
  const base = hexToHsl(normalizeHex(hex) ?? '#808080');
  const out = [hslToHex(base)];
  const steps = [
    { dh: 28, dl: 10 },
    { dh: -28, dl: -8 },
    { dh: 56, dl: 4 },
  ];
  for (let i = 0; out.length < k; i++) {
    const s = steps[i % steps.length];
    out.push(hslToHex({ h: base.h + (base.s > 4 ? s.dh : 0), s: base.s, l: Math.max(8, Math.min(92, base.l + s.dl)) }));
  }
  return out;
}

export { rgbOf as paletteRgb };

/** 相对亮度（0–1，sRGB 线性化后按人眼权重） */
export function luminance(hex: string): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgbOf(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * 泛光强度的范围（2026-11-18，左上角计数圆环）：颜色越亮泛光越强。
 * 停着时只有些许变化（平均约 0.4）；翻动时范围拉大，经过明暗不同的作品时泛光一闪一闪
 */
export const GLOW_REST: readonly [number, number] = [0.3, 0.5];
export const GLOW_MOVING: readonly [number, number] = [0.16, 0.82];

/** 按主题色的亮度算泛光强度（不透明度）；用亮度的平方根，让中等亮度的颜色也拉得开 */
export function glowFor(colors: readonly string[], moving: boolean): number {
  const [lo, hi] = moving ? GLOW_MOVING : GLOW_REST;
  if (!colors.length) return (lo + hi) / 2;
  const l = colors.reduce((s, c) => s + luminance(c), 0) / colors.length;
  return lo + (hi - lo) * Math.sqrt(Math.max(0, Math.min(1, l)));
}
