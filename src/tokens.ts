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
  // 全屏的深色底，以及浮在它上面的顶栏图标 / 文字和悬停圆底（2026-11-17 新增）
  'color-fullscreen-bg': '#0F0F0F',
  'color-text-on-dark': 'rgba(255,255,255,0.72)',
  'color-window-btn-hover-dark': 'rgba(255,255,255,0.14)',
  // 全屏深色底上的“纯白”和“墨黑”（悬停、关闭按钮）：浅色、深色模式一样
  'color-on-dark-strong': '#FFFFFF',
  'color-on-dark-ink': '#161616',
  // 全屏缩放时底部的倍率胶囊底色（2026-11-18）：浅色、深色模式一样
  'color-zoom-badge': 'rgba(20,20,20,0.66)',
  // 以下原来直接写在 CSS 里，深色模式要换值，所以提成变量（2026-11-17）
  'color-drop-scrim': 'rgba(213,213,211,0.6)',
  'color-art-edge': 'rgba(255,255,255,0.35)',
  'color-thumb-edge': 'rgba(255,255,255,0.4)',
  'color-scrim': 'rgba(22,22,22,0.28)',
  // 颜色模式拨动开关（2026-11-18，查看菜单）：白天 / 夜晚两种轨道色、太阳旋钮、月牙
  'color-switch-day': '#ECEAE4',
  'color-switch-night': '#2E2F33',
  'color-switch-sun': '#E2B667',
  'color-switch-moon': '#EEEAE0',
  // 左上角计数圆环（2026-11-18）：内圈的蓝色进度环、它下面的灰圈
  'color-counter': '#3D8BFF',
  'color-counter-track': 'rgba(0,0,0,0.13)',
} as const;

export type ColorToken = keyof typeof color;

/**
 * 深色模式（2026-11-17 新增，左上角菜单里切换：浅色 / 深色 / 跟随系统）。
 * 思路和浅色一致：灰底 + 卡片（浅色是灰底白卡，深色是近黑底深灰卡），黄色强调色不变；
 * 文字、刻度、分隔线按同样的层级反过来。全屏时弹出的菜单也用这一套（全屏背景是深色）。
 */
export const colorDark: Record<ColorToken, string> = {
  'color-bg': '#1C1C1D',
  'color-surface': '#2B2B2D',
  'color-text': '#F2F2F0',
  'color-text-secondary': '#A6A6A3',
  'color-text-on-bg': '#C8C8C5',
  'color-divider': '#3A3A3C',
  'color-chip': '#38383A',
  'color-input-bg': '#242426',
  'color-input-border': '#4A4A4D',
  'color-dashed': '#6E6E6B',
  'color-accent': '#F2D000',
  'color-tick-current': '#F2F2F0',
  'color-tick-series': '#9E9E9B',
  'color-tick-other': '#5C5C5A',
  'color-timeline-line': '#3A3A3C',
  'color-meter-track': 'rgba(255,255,255,0.16)',
  'color-window-btn-hover': 'rgba(255,255,255,0.10)',
  'color-fullscreen-bg': '#0F0F0F',
  'color-text-on-dark': 'rgba(255,255,255,0.72)',
  'color-window-btn-hover-dark': 'rgba(255,255,255,0.14)',
  'color-on-dark-strong': '#FFFFFF',
  'color-on-dark-ink': '#161616',
  'color-zoom-badge': 'rgba(20,20,20,0.66)',
  'color-drop-scrim': 'rgba(28,28,29,0.6)',
  'color-art-edge': 'rgba(255,255,255,0.08)',
  'color-thumb-edge': 'rgba(255,255,255,0.10)',
  'color-scrim': 'rgba(0,0,0,0.5)',
  'color-switch-day': '#CFCBC3',
  'color-switch-night': '#1A1A1C',
  'color-switch-sun': '#E2B667',
  'color-switch-moon': '#EEEAE0',
  'color-counter': '#3D8BFF',
  'color-counter-track': 'rgba(255,255,255,0.16)',
};

/** 新建系列时依次取用的系列色（只用于 8px 圆点） */
export const seriesPalette = ['#C27F4B', '#5FA3C9', '#8E6FB0', '#C2577A'] as const;

/**
 * “修改颜色”调色器里的预设色（2026-11-17 新增）：前 4 个就是上面的系列色，
 * 其余是同一个调子的低饱和色（浓淡 ≤ 50%）。名字在 i18n 的 color.<key>。
 */
export const seriesPresets = [
  { key: 'clay', hex: '#C27F4B' },
  { key: 'mist', hex: '#5FA3C9' },
  { key: 'wisteria', hex: '#8E6FB0' },
  { key: 'rose', hex: '#C2577A' },
  { key: 'mustard', hex: '#C4A24F' },
  { key: 'moss', hex: '#7F9A62' },
  { key: 'sage', hex: '#8AA597' },
  { key: 'teal', hex: '#4F8080' },
  { key: 'slate', hex: '#6E8299' },
  { key: 'brick', hex: '#B0614B' },
  { key: 'blush', hex: '#C49A9A' },
  { key: 'stone', hex: '#A0958A' },
] as const;
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

/** 深色模式的玻璃：白色底要淡得多，否则在深色底上是一块块灰板 */
export const glassDark = {
  'glass-fill': (strength = GLASS_STRENGTH) => `rgba(255,255,255,${round3(0.02 + strength * 0.06)})`,
  'glass-border': '1px solid rgba(255,255,255,0.10)',
  'glass-highlight': 'inset 0 1px 0 rgba(255,255,255,0.10), 0 1px 2px rgba(0,0,0,0.25)',
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

/**
 * 超椭圆圆角（2026-11-18 新增）：卡片、面板、菜单、输入框这些块面用 CSS 的 `corner-shape: superellipse(K)`，
 * 直边到圆角的曲率连续过渡（类似苹果的连续圆角），不像普通圆角那样在直边和圆弧的接缝处突然拐弯。
 * K = 1 就是普通圆角，2 是 squircle（偏方、偏“椭圆”）；取 1.5，比普通圆角顺滑又不过分。
 * 玻璃格（性能）、胶囊、圆形不用。不支持 corner-shape 的环境保持原来的普通圆角（styles.css 里用 @supports）
 */
export const CORNER_K = 1.5;

/**
 * 同样的半径下超椭圆的角“更尖”：半径乘这个倍数，让对角线方向上角尖到曲线的距离和原来的普通圆角一样——
 * 角看起来一样大，只是曲线从直边上更早、更缓地弯过去（K = 1.5 时约 1.35 倍）。
 * superellipse(K) 的曲线是 |x|^n + |y|^n = 1，n = 2^K
 */
export function cornerScale(k: number): number {
  const n = 2 ** k;
  return (1 - Math.SQRT1_2) / (1 - 2 ** (-1 / n));
}

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

/** 深色模式的阴影：黑色、更浓；卡片类再加一圈很淡的亮边，深色底上才分得出层次 */
export const shadowDark: Record<keyof typeof shadow, string> = {
  'shadow-art-center': '0 36px 70px -12px rgba(0,0,0,0.6), 0 8px 18px rgba(0,0,0,0.4)',
  'shadow-art-side': '0 22px 46px -12px rgba(0,0,0,0.45), 0 8px 18px rgba(0,0,0,0.3)',
  'shadow-thumb': '0 18px 32px -14px rgba(0,0,0,0.6), 0 4px 10px rgba(0,0,0,0.35)',
  'shadow-thumb-hover': '0 26px 40px -14px rgba(0,0,0,0.7), 0 6px 14px rgba(0,0,0,0.4)',
  'shadow-panel': '0 24px 48px -18px rgba(0,0,0,0.65), 0 2px 6px rgba(0,0,0,0.35), inset 0 0 0 1px rgba(255,255,255,0.06)',
  'shadow-timeline': '0 20px 40px -18px rgba(0,0,0,0.65), 0 2px 6px rgba(0,0,0,0.35), inset 0 0 0 1px rgba(255,255,255,0.06)',
  'shadow-pill': '0 18px 36px -16px rgba(0,0,0,0.65), 0 2px 6px rgba(0,0,0,0.35), inset 0 0 0 1px rgba(255,255,255,0.06)',
  'shadow-indicator': '0 0 0 3px #2B2B2D, 0 2px 8px rgba(0,0,0,0.5)',
};

const SANS = "Inter, 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, Consolas, Menlo, monospace";

/** 字体：值可以直接用在 CSS 的 font 简写里；字距写在 CSS 里 */
export const font = {
  'font-family-sans': SANS,
  'font-family-mono': MONO,
  'font-title': `600 26px/1.2 ${SANS}`,
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
  /** 放大查看 / 全屏（2026-11-17 新增）：临界阻尼，放大时不过冲出窗口 */
  magnify: [260, 32],
  /** 全屏时的滚轮缩放 / 平移（2026-11-18 新增）：临界阻尼，滚一格大约 0.15s 到位（用户觉得慢，[420, 41] → [640, 51]） */
  fsZoom: [640, 51],
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

/**
 * 用深色变量的地方：深色模式下的整个页面；全屏时（背景是深色）弹出的菜单、右键菜单、关于对话框。
 * 变量写在这些元素上，子元素自然继承。
 */
export const DARK_SCOPES = [
  ':root[data-theme="dark"]',
  '.app.is-fullscreen .menu-panel',
  '.app.is-fullscreen .ctx-menu',
  '.app.is-fullscreen .about-dialog',
  '.app.is-fullscreen .popover',
] as const;

/** 一组 CSS 变量声明 */
function declarations(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([k, v]) => `--${k}:${v};`)
    .join('');
}

/** 浅色 / 深色两套变量（浅色带上圆角、字体这些和主题无关的） */
export function tokenCss(): string {
  const light: Record<string, string> = { ...color, ...shadow, ...font };
  light['glass-fill'] = glass['glass-fill']();
  light['glass-blur'] = glass['glass-blur']();
  light['glass-border'] = glass['glass-border'];
  light['glass-highlight'] = glass['glass-highlight'];
  for (const [k, v] of Object.entries(radius)) if (typeof v === 'string') light[k] = v;
  light['corner-shape'] = `superellipse(${CORNER_K})`;
  light['corner-scale'] = cornerScale(CORNER_K).toFixed(4);
  const dark: Record<string, string> = { ...colorDark, ...shadowDark };
  dark['glass-fill'] = glassDark['glass-fill']();
  dark['glass-border'] = glassDark['glass-border'];
  dark['glass-highlight'] = glassDark['glass-highlight'];
  return `:root{${declarations(light)}}\n${DARK_SCOPES.join(',')}{${declarations(dark)}}`;
}

let tokenSheet: CSSStyleSheet | null = null;

/**
 * 把颜色、玻璃、圆角、阴影、字体写成 CSS 变量。
 * 写成一张样式表而不是 :root 的行内样式：行内样式优先级最高，深色模式的规则会盖不过它。
 *
 * ⚠️ 必须用“可构造样式表”（CSSStyleSheet + adoptedStyleSheets），不能插 <style> 标签：
 * 发行版里 Tauri 会往 CSP 的 style-src 加 nonce，有 nonce 时 'unsafe-inline' 失效，
 * 动态插入的 <style> 会被整个拦掉（0.1.1 第一次打包就因此丢了全部颜色和卡片样式）。
 * CSSOM 的样式表不受 CSP 限制。开发版不套 CSP，看不出这个问题。
 */
export function applyTokens(doc: Document = document): void {
  if (typeof CSSStyleSheet === 'function' && 'adoptedStyleSheets' in doc) {
    if (!tokenSheet) {
      tokenSheet = new CSSStyleSheet();
      doc.adoptedStyleSheets = [tokenSheet, ...doc.adoptedStyleSheets];
    }
    tokenSheet.replaceSync(tokenCss());
    return;
  }
  // 老环境兜底（WebView2 / 现代浏览器都走上面）
  let style = doc.getElementById('peekit-tokens');
  if (!style) {
    style = doc.createElement('style');
    style.id = 'peekit-tokens';
    doc.head.prepend(style);
  }
  style.textContent = tokenCss();
}

/** 设计变量是否真的生效了（发行版启动自检用） */
export function tokensApplied(doc: Document = document): boolean {
  return getComputedStyle(doc.documentElement).getPropertyValue('--color-bg').trim() !== '';
}
