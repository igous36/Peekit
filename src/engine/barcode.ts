// 时间轴上方的色条（2026-11-20）：每幅作品的主色按时间顺序连成一条，像把一部电影每一秒的主色
// 各画成 1px 宽的竖线再拼起来的“电影条码”。纯函数，只算颜色，画在 view/barcode.ts。
//
// 第 i 幅在色条上的位置和时间轴刻度一样：i / (n − 1)。
// - 作品多（每幅分不到 BAND_MIN_PX）：一列像素一个颜色，这一列覆盖到的作品颜色在线性光里平均，就是电影条码的样子
// - 作品少：每幅一段，段中间留一段纯色（PLATEAU），段和段之间柔和过渡，几幅图时也不会是生硬的色块
import { normalizeHex } from './color';
import { rgbOf } from './swatches';

/** 每幅分到的宽度少于这么多像素，就按列取平均（条码）；多于就按段渐变 */
export const BAND_MIN_PX = 6;
/** 按段画时，每段中间纯色部分占这一段的比例（其余是和两边的过渡） */
export const PLATEAU = 0.55;

const toLin = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const toSrgb = (v: number) => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.round(Math.max(0, Math.min(1, c)) * 255);
};
const hex2 = (v: number) => v.toString(16).padStart(2, '0');

/** 几个颜色在线性光里平均（比直接平均 sRGB 值亮、干净）；全是 null 返回 null */
export function mixColors(colors: readonly (string | null)[]): string | null {
  let r = 0, g = 0, b = 0, n = 0;
  for (const c of colors) {
    if (!c || !normalizeHex(c)) continue;
    const [cr, cg, cb] = rgbOf(c);
    r += toLin(cr);
    g += toLin(cg);
    b += toLin(cb);
    n++;
  }
  if (!n) return null;
  return `#${hex2(toSrgb(r / n))}${hex2(toSrgb(g / n))}${hex2(toSrgb(b / n))}`.toUpperCase();
}

/** 作品多的时候：每列像素的颜色（这一列覆盖到的作品取平均）；不知道颜色的作品不算，整列都不知道就是 null */
export function barcodeColumns(colors: readonly (string | null)[], columns: number): (string | null)[] {
  const n = colors.length, out: (string | null)[] = [];
  if (!n || columns <= 0) return out;
  for (let x = 0; x < columns; x++) {
    // 这一列的中心对应的连续位置，覆盖半列宽度
    const span = n > 1 ? (n - 1) / columns : 0;
    const center = n > 1 ? ((x + 0.5) / columns) * (n - 1) : 0;
    const from = Math.max(0, Math.round(center - span / 2));
    const to = Math.min(n - 1, Math.max(from, Math.round(center + span / 2)));
    out.push(mixColors(colors.slice(from, to + 1)));
  }
  return out;
}

export interface GradientStop {
  /** 0–1 */
  at: number;
  color: string;
}

/**
 * 作品少的时候：渐变的色标。每幅在 i / (n − 1) 处，左右各有 PLATEAU / 2 段宽的纯色，
 * 段与段之间线性过渡；首尾两幅的纯色一直延伸到两端。不知道颜色的作品用 fallback
 */
export function barcodeStops(colors: readonly (string | null)[], fallback: string): GradientStop[] {
  const n = colors.length;
  if (!n) return [];
  const c = (i: number) => colors[i] ?? fallback;
  if (n === 1) return [{ at: 0, color: c(0) }, { at: 1, color: c(0) }];
  const step = 1 / (n - 1);
  const half = (PLATEAU * step) / 2;
  const stops: GradientStop[] = [];
  for (let i = 0; i < n; i++) {
    const x = i * step;
    stops.push({ at: i === 0 ? 0 : Math.max(0, x - half), color: c(i) });
    stops.push({ at: i === n - 1 ? 1 : Math.min(1, x + half), color: c(i) });
  }
  return stops;
}

/** 色条上 x（0–1）处是第几幅 */
export const indexAt = (x: number, n: number): number => (n <= 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(x * (n - 1)))));
