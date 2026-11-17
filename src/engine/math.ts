export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export const clamp01 = (v: number): number => clamp(v, 0, 1);

/** 原型里的 ss(e0, e1, v) */
export const smoothstep = (e0: number, e1: number, v: number): number => {
  const t = clamp01((v - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** 保留 3 位小数，减少样式字符串抖动（原型的 r3） */
export const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** 舞台单位：calc(v * var(--u))，--u = min(1vh, 0.6vw) */
export const U = (v: number): string => `calc(${r3(v)} * var(--u))`;
