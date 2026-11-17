// 设计变量：名字和 HANDOFF §3 一一对应。
// CSS 里用 var(--color-bg) 这类变量，启动时由 applyTokens() 写到 :root 上；
// JS 里需要直接拼样式字符串时（阴影、刻度颜色等）也从这里取，保证只有一个来源。

export const color = {
  'color-bg': '#D5D5D3',
  'color-surface': '#FFFFFF',
  'color-text': '#161616',
  'color-text-secondary': '#5C5C5C',
  'color-text-on-bg': '#3D3D3D',
  'color-divider': '#EDEDEB',
  'color-chip': '#F2F2F0',
  'color-input-bg': '#FAFAF9',
  'color-input-border': '#D4D4D2',
  'color-dashed': '#A8A8A6',
  'color-accent': '#F2D000',
  'color-tick-current': '#161616',
  'color-tick-series': '#6B6B69',
  'color-tick-other': '#BDBDBB',
  // 以下两个不在 §3 表里，取自原型代码
  'color-timeline-line': '#E4E4E2',
  'color-meter-track': 'rgba(22,22,22,0.12)',
  // 窗口按钮悬停时的白色圆底（2026-11-17 新增，§2 窗口按钮）
  'color-window-btn-hover': 'rgba(255,255,255,0.7)',
} as const;

/** 新建系列时依次取用的系列色（只用于 8px 圆点） */
export const seriesPalette = ['#C27F4B', '#5FA3C9', '#8E6FB0', '#C2577A'] as const;
/** “未归类”系列的颜色（名字随界面语言，见 i18n 的 series.unassigned） */
export const UNASSIGNED_COLOR = '#A3A3A3';

/** “玻璃强度” 0–1，原型默认 0.5 */
export const GLASS_STRENGTH = 0.5;

export const glass = {
  // 底色在 0.08–0.20 之间，模糊在 12–32px 之间
  'glass-fill': (strength = GLASS_STRENGTH) => `rgba(255,255,255,${round3(0.08 + strength * 0.12)})`,
  'glass-blur': (strength = GLASS_STRENGTH) => `blur(${Math.round(12 + strength * 20)}px) saturate(140%)`,
  'glass-border': '1px solid rgba(255,255,255,0.5)',
  'glass-highlight': 'inset 0 1px 0 rgba(255,255,255,0.55), 0 1px 2px rgba(0,0,0,0.03)',
} as const;

export const radius = {
  /** 玻璃格的静止圆角是 1.16u（1440×900 下约 10px），缩略图固定 10px */
  'radius-tile': '10px',
  'radius-tile-u': 1.16,
  'radius-input': '12px',
  'radius-art': '14px',
  'radius-panel': '24px',
  'radius-pill': '999px',
  /** 左上角下拉菜单（2026-11-17 新增） */
  'radius-menu': '16px',
} as const;

export const shadow = {
  'shadow-art-center': '0 36px 70px -12px rgba(38,30,12,0.30), 0 8px 18px rgba(0,0,0,0.13)',
  'shadow-art-side': '0 22px 46px -12px rgba(38,30,12,0.16), 0 8px 18px rgba(0,0,0,0.07)',
  'shadow-thumb': '0 18px 32px -14px rgba(38,30,12,0.3), 0 4px 10px rgba(0,0,0,0.08)',
  'shadow-thumb-hover': '0 26px 40px -14px rgba(38,30,12,0.38), 0 6px 14px rgba(0,0,0,0.12)',
  'shadow-panel': '0 24px 48px -18px rgba(38,30,12,0.28), 0 2px 6px rgba(0,0,0,0.06)',
  'shadow-timeline': '0 20px 40px -18px rgba(38,30,12,0.3), 0 2px 6px rgba(0,0,0,0.06)',
  'shadow-pill': '0 18px 36px -16px rgba(38,30,12,0.3), 0 2px 6px rgba(0,0,0,0.06)',
  'shadow-indicator': '0 0 0 3px #FFFFFF, 0 2px 8px rgba(120,90,0,0.35)',
} as const;

const SANS = "Inter, 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, Consolas, Menlo, monospace";

/** 字体：值可以直接用在 CSS 的 font 简写里；字距写在 CSS 里 */
export const font = {
  'font-family-sans': SANS,
  'font-family-mono': MONO,
  'font-title': `600 26px/1.2 ${SANS}`,
  'font-wordmark': `600 15px/1.2 ${SANS}`,
  'font-series': `600 14px/1.2 ${SANS}`,
  'font-label': `500 13px/1.2 ${SANS}`,
  'font-body': `400 14px/1.7 ${SANS}`,
  'font-input': `400 15px/1.2 ${SANS}`,
  'font-caption': `400 12px/1.4 ${SANS}`,
  'font-mono': `400 13px/1.4 ${MONO}`,
  'font-mono-year': `400 10px/1 ${MONO}`,
} as const;

/** 弹簧参数 [k, c]（质量 1），HANDOFF §6 */
export const spring = {
  follow: [900, 60],
  settleStandard: [170, 22],
  settleSoft: [120, 22],
  settleSnappy: [300, 28],
  press: [320, 32],
  /** 系统开启“减少动态效果”时 */
  reducedMotion: [300, 35],
} as const;

/** 舞台尺寸，单位 u = min(1vh, 0.6vw)，HANDOFF §2 */
export const stage = {
  /** 4:5 画作的卡片尺寸；其他比例保持同样面积，再限制在 artMaxW × artMaxH 之内（2026-11-17 决定卡片跟随画作比例） */
  artW: 44.8,
  artH: 56,
  artMaxW: 64,
  artMaxH: 56,
  gridCols: 8,
  gridRows: 5,
  tile: 15,
  tileGap: 0.8,
  thumbW: 21,
  thumbH: 26,
  /** 系列标题胶囊的底边在 50% − 38.5u */
  headerBottom: 38.5,
} as const;

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** 把颜色、玻璃、圆角、阴影、字体写成 :root 上的 CSS 变量 */
export function applyTokens(root: HTMLElement = document.documentElement): void {
  const set = (k: string, v: string) => root.style.setProperty(`--${k}`, v);
  for (const [k, v] of Object.entries(color)) set(k, v);
  set('glass-fill', glass['glass-fill']());
  set('glass-blur', glass['glass-blur']());
  set('glass-border', glass['glass-border']);
  set('glass-highlight', glass['glass-highlight']);
  for (const [k, v] of Object.entries(radius)) if (typeof v === 'string') set(k, v);
  for (const [k, v] of Object.entries(shadow)) set(k, v);
  for (const [k, v] of Object.entries(font)) set(k, v);
}
