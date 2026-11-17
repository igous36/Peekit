// 系列颜色的换算（2026-11-17 新增，给“修改颜色”的调色器用）。纯函数。
//
// 调色器只在低饱和的范围里取色（浓淡 12–60%、明暗 36–72%），和现有的系列色一个调子；
// 直接输入色值不受这个限制。

export interface Hsl {
  /** 0–360 */
  h: number;
  /** 0–100 */
  s: number;
  /** 0–100 */
  l: number;
}

/** 调色器的取值范围：维持现在的低饱和风格 */
export const MUTED = { sMin: 12, sMax: 60, lMin: 36, lMax: 72 } as const;
/** 色相环本身的浓淡 / 明暗（环上每个色相都按这个画） */
export const RING_TONE = { s: 40, l: 60 } as const;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** "#abc" / "abc" / "#AABBCC" → "#AABBCC"；不合法返回 null */
export function normalizeHex(input: string): string | null {
  const m = input.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(m)) return `#${m.split('').map((c) => c + c).join('')}`.toUpperCase();
  if (/^[0-9a-f]{6}$/i.test(m)) return `#${m}`.toUpperCase();
  return null;
}

export function hexToHsl(hex: string): Hsl {
  const n = normalizeHex(hex) ?? '#808080';
  const r = parseInt(n.slice(1, 3), 16) / 255;
  const g = parseInt(n.slice(3, 5), 16) / 255;
  const b = parseInt(n.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0, s = 0;
  if (d > 1e-9) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: s * 100, l: l * 100 };
}

export function hslToHex({ h, s, l }: Hsl): string {
  const S = clamp(s, 0, 100) / 100, L = clamp(l, 0, 100) / 100;
  const H = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const x = c * (1 - Math.abs(((H / 60) % 2) - 1));
  const m = L - c / 2;
  const [r, g, b] =
    H < 60 ? [c, x, 0] : H < 120 ? [x, c, 0] : H < 180 ? [0, c, x] : H < 240 ? [0, x, c] : H < 300 ? [x, 0, c] : [c, 0, x];
  const hex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`.toUpperCase();
}

/** 把浓淡 / 明暗夹进调色器的范围（色相不动） */
export function clampMuted(c: Hsl): Hsl {
  return { h: c.h, s: clamp(c.s, MUTED.sMin, MUTED.sMax), l: clamp(c.l, MUTED.lMin, MUTED.lMax) };
}

/**
 * 色相环上旋钮的角度：从 from（不折回 0–360 的累计角度）转到色相 to，走近的那一边。
 * 例：从 350° 转到 10° 是 +20°，不是 −340°。
 */
export function nearestAngle(from: number, to: number): number {
  const d = ((((to - from) % 360) + 540) % 360) - 180;
  return from + d;
}

/** 指针相对色相环圆心的位置 → 色相（正上方 0°，顺时针，和 conic-gradient 一致） */
export function angleFromPoint(dx: number, dy: number): number {
  const a = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return a < 0 ? a + 360 : a;
}

/** 色相环的 conic-gradient：每 30° 一个色标，浓淡 / 明暗固定 */
export function ringGradient(tone: { s: number; l: number } = RING_TONE): string {
  const stops: string[] = [];
  for (let h = 0; h <= 360; h += 30) stops.push(`hsl(${h} ${tone.s}% ${tone.l}%)`);
  return `conic-gradient(from 0deg, ${stops.join(', ')})`;
}
