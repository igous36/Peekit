// 作品的主色组成和按颜色筛选（2026-11-20）。纯函数，不碰 DOM。
//
// 主色组成（swatches）：缩略图缩到 32×32，按每个通道 4 位量化分桶，桶按像素数从多到少处理：
// 和已经挑出的某个颜色足够接近就并进去，不接近就另起一个（最多 6 个，满了并进最近的）。
// 每个颜色带上它占画面的比例；占比太小（不到 4%）的丢掉。和计数圆环用的 pickPalette 不同，
// 这里不偏向鲜艳的颜色：要回答的是“画面里有多少这个颜色”。
//
// 按颜色筛选两种：
// - 色系（11 个色块：红橙黄绿青蓝紫粉 + 黑白灰）：作品的主色里有一个落在这个色系、占比够大，就算有
// - 任意颜色（取色器挑的）：在 OKLab 里和某个主色足够接近、占比够大，就算有
import { hexToHsl, normalizeHex } from './color';

export interface Swatch {
  hex: string;
  /** 占画面的比例 0–1 */
  share: number;
}

/** 两个桶的平均色在 RGB 里差不到这么多，就算同一个颜色 */
const MERGE_DIST = 48;
export const MAX_SWATCHES = 6;
export const MIN_SHARE = 0.04;

const hex2 = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
const toHex = (c: readonly number[]) => `#${hex2(c[0])}${hex2(c[1])}${hex2(c[2])}`.toUpperCase();

export function rgbOf(hex: string): [number, number, number] {
  const n = normalizeHex(hex) ?? '#808080';
  return [parseInt(n.slice(1, 3), 16), parseInt(n.slice(3, 5), 16), parseInt(n.slice(5, 7), 16)];
}

/** 从 RGBA 像素里算主色组成；透明像素不算；一个不透明像素都没有返回空数组 */
export function swatchesOf(px: Uint8ClampedArray | readonly number[], max = MAX_SWATCHES): Swatch[] {
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  let total = 0;
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
    total++;
  }
  if (!total) return [];
  const sorted = [...bins.values()].sort((a, b) => b.n - a.n);
  const picked: { c: [number, number, number]; n: number; sr: number; sg: number; sb: number }[] = [];
  for (const x of sorted) {
    const c: [number, number, number] = [x.r / x.n, x.g / x.n, x.b / x.n];
    let best = -1, bestD = Infinity;
    for (let k = 0; k < picked.length; k++) {
      const d = Math.hypot(picked[k].c[0] - c[0], picked[k].c[1] - c[1], picked[k].c[2] - c[2]);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    if (best < 0 || (bestD >= MERGE_DIST && picked.length < max)) {
      picked.push({ c, n: x.n, sr: x.r, sg: x.g, sb: x.b });
    } else {
      // 并进最近的那个：颜色按像素数加权平均
      const p = picked[best];
      p.n += x.n;
      p.sr += x.r;
      p.sg += x.g;
      p.sb += x.b;
      p.c = [p.sr / p.n, p.sg / p.n, p.sb / p.n];
    }
  }
  return picked
    .map((p) => ({ hex: toHex(p.c), share: p.n / total }))
    .filter((s) => s.share >= MIN_SHARE)
    .sort((a, b) => b.share - a.share);
}

// ───────────── 色系 ─────────────

export type ColorFamily = 'red' | 'orange' | 'yellow' | 'green' | 'cyan' | 'blue' | 'purple' | 'pink' | 'black' | 'white' | 'gray';

/** 菜单里色块的顺序和显示的颜色（只用来画色块，判断色系看 familyOf） */
export const COLOR_FAMILIES: readonly { key: ColorFamily; hex: string }[] = [
  { key: 'red', hex: '#D9493F' },
  { key: 'orange', hex: '#EB8A2F' },
  { key: 'yellow', hex: '#EBC53A' },
  { key: 'green', hex: '#5BAA55' },
  { key: 'cyan', hex: '#3FB2B8' },
  { key: 'blue', hex: '#3E7BD6' },
  { key: 'purple', hex: '#8B5FD0' },
  { key: 'pink', hex: '#E275AE' },
  { key: 'black', hex: '#1E1E1E' },
  { key: 'white', hex: '#FAFAFA' },
  { key: 'gray', hex: '#9A9A98' },
];

const NEUTRALS: ReadonlySet<ColorFamily> = new Set(['black', 'white', 'gray']);

/** 一个颜色属于哪个色系：先按明暗、浓淡分出黑白灰，其余按色相 */
export function familyOf(hex: string): ColorFamily {
  const [r, g, b] = rgbOf(hex);
  const chroma = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
  const { h, l } = hexToHsl(hex);
  if (l < 16) return 'black';
  if (l >= 90) return 'white';
  if (chroma < 0.12) return l >= 78 ? 'white' : l < 24 ? 'black' : 'gray';
  if (h >= 345 || h < 15) return l > 72 ? 'pink' : 'red';
  if (h < 40) return 'orange';
  if (h < 70) return 'yellow';
  if (h < 165) return 'green';
  if (h < 195) return 'cyan';
  if (h < 255) return 'blue';
  if (h < 290) return 'purple';
  return 'pink';
}

// ───────────── 任意颜色：OKLab 距离 ─────────────

/** sRGB → OKLab（L 0–1） */
export function oklab(hex: string): [number, number, number] {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgbOf(hex).map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function colorDistance(a: string, b: string): number {
  const p = oklab(a), q = oklab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** 任意颜色：OKLab 距离小于这个就算“相近” */
export const NEAR_COLOR = 0.1;

// ───────────── 筛选 ─────────────

export type ColorFilter = { kind: 'family'; family: ColorFamily } | { kind: 'hex'; hex: string };

/** 主色占比至少这么多才算“有这个颜色”：彩色 8%；黑白灰 25%（很多画是白底，白占一点不算偏白） */
const MIN_CHROMATIC = 0.08;
const MIN_NEUTRAL = 0.25;

export function matchesColor(swatches: readonly Swatch[] | undefined, f: ColorFilter): boolean {
  if (!swatches?.length) return false;
  if (f.kind === 'family') {
    const min = NEUTRALS.has(f.family) ? MIN_NEUTRAL : MIN_CHROMATIC;
    let share = 0;
    for (const s of swatches) if (familyOf(s.hex) === f.family) share += s.share;
    return share >= min;
  }
  const target = normalizeHex(f.hex) ?? '#808080';
  return swatches.some((s) => s.share >= MIN_CHROMATIC && colorDistance(s.hex, target) < NEAR_COLOR);
}

export const sameColorFilter = (a: ColorFilter | null, b: ColorFilter | null): boolean =>
  a === b ||
  (!!a && !!b && a.kind === b.kind && (a.kind === 'family' ? a.family === (b as typeof a).family : a.hex === (b as typeof a).hex));

/** 存档格式：[[#RRGGBB, 占比], …]，占比保留三位小数 */
export function packSwatches(s: readonly Swatch[]): [string, number][] {
  return s.map((x) => [x.hex, Math.round(x.share * 1000) / 1000]);
}

export function unpackSwatches(raw: unknown): Swatch[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: Swatch[] = [];
  for (const x of raw) {
    if (!Array.isArray(x) || typeof x[0] !== 'string' || typeof x[1] !== 'number') continue;
    const hex = normalizeHex(x[0]);
    if (hex && x[1] > 0 && x[1] <= 1) out.push({ hex, share: x[1] });
  }
  return out.length ? out : undefined;
}

/** 示例数据（浏览器调试）：没有图片，按色块的面积算主色组成，剩下的是底色 */
export function swatchesFromShapes(shapes: readonly { w: number; h: number; c: string }[], bg: string): Swatch[] {
  const acc = new Map<string, number>();
  let covered = 0;
  for (const s of shapes) {
    const hex = normalizeHex(s.c);
    if (!hex) continue;
    const a = Math.max(0, Math.min(1, (s.w / 100) * (s.h / 100)));
    acc.set(hex, (acc.get(hex) ?? 0) + a);
    covered += a;
  }
  const bgHex = normalizeHex(bg);
  if (bgHex) acc.set(bgHex, (acc.get(bgHex) ?? 0) + Math.max(0, 1 - Math.min(1, covered)));
  const total = [...acc.values()].reduce((a, b) => a + b, 0) || 1;
  return [...acc.entries()]
    .map(([hex, a]) => ({ hex, share: a / total }))
    .filter((s) => s.share >= MIN_SHARE)
    .sort((a, b) => b.share - a.share)
    .slice(0, MAX_SWATCHES);
}
