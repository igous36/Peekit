// 左上角的手写字标「Peekit」（2026-11-18，替换原来的 15px 文字字标）。
// 一笔连写的单线：从 P 的圈起笔，绕回竖画、连写 e e k i t；i 的点和 t 的横另起。
// 路径由设计稿的落笔点经 Catmull-Rom 转成三次贝塞尔得到（设计稿：claude.ai Design 画布「Peekit Logo」）。
// 描边 / 填充都用 currentColor，浅色、深色、全屏跟着 .wordmark 的文字色走。

export const WORDMARK_VIEWBOX = { x: 44, y: 22, w: 440, h: 190 } as const;

/** 笔画粗细（viewBox 单位）。设计稿常规是 14；标题栏里只有 26px 高，加粗到 16 才不发虚 */
export const WORDMARK_STROKE = 16;

/** i 的点：圆心（viewBox 单位），半径 = 笔画 × 0.62 */
export const WORDMARK_DOT = { cx: 380, cy: 94, k: 0.62 } as const;

/** 主笔画（P → t 一笔）和 t 的横 */
export const WORDMARK_PATHS = [
  'M54 110 C59.3 109.7 75.7 109.7 86 108 C96.3 106.3 107.7 104.3 116 100 C124.3 95.7 132 88.7 136 82 C140 75.3 141.7 67 140 60 C138.3 53 132.3 44.7 126 40 C119.7 35.3 109.3 32.7 102 32 C94.7 31.3 87.3 32.7 82 36 C76.7 39.3 72.7 41.3 70 52 C67.3 62.7 67.3 83.7 66 100 C64.7 116.3 62.8 136 62 150 C61.2 164 59.7 175.7 61 184 C62.3 192.3 59.2 200.3 70 200 C80.8 199.7 112.7 186.7 126 182 C139.3 177.3 144 176.7 150 172 C156 167.3 160.7 160.7 162 154 C163.3 147.3 161.3 137.8 158 132 C154.7 126.2 147.7 120.3 142 119 C136.3 117.7 128.7 119.5 124 124 C119.3 128.5 115.5 137.7 114 146 C112.5 154.3 112.7 165.8 115 174 C117.3 182.2 122.2 190.5 128 195 C133.8 199.5 142.7 200.7 150 201 C157.3 201.3 162 200.2 172 197 C182 193.8 199.7 186.2 210 182 C220.3 177.8 228 176.7 234 172 C240 167.3 244.7 160.7 246 154 C247.3 147.3 245.3 137.8 242 132 C238.7 126.2 231.7 120.3 226 119 C220.3 117.7 212.7 119.5 208 124 C203.3 128.5 199.5 137.7 198 146 C196.5 154.3 196.7 165.8 199 174 C201.3 182.2 206.2 190.5 212 195 C217.8 199.5 226.7 200.7 234 201 C241.3 201.3 248.3 202.2 256 197 C263.7 191.8 273.7 181.5 280 170 C286.3 158.5 290 143 294 128 C298 113 302 92.7 304 80 C306 67.3 307.3 59 306 52 C304.7 45 300 39 296 38 C292 37 285 37.3 282 46 C279 54.7 279 72.7 278 90 C277 107.3 276.7 131.7 276 150 C275.3 168.3 274.3 191.7 274 200 C274.7 195.3 275 180.7 278 172 C281 163.3 286.3 154 292 148 C297.7 142 306 137 312 136 C318 135 325.7 138 328 142 C330.3 146 329.3 155.3 326 160 C322.7 164.7 314 168.7 308 170 C302 171.3 293 168.3 290 168 C293 169.3 303.3 172 308 176 C312.7 180 313.7 188 318 192 C322.3 196 328 199.7 334 200 C340 200.3 348.3 199 354 194 C359.7 189 364 181.3 368 170 C372 158.7 376.3 133.3 378 126 C377.7 134.3 375.3 164.3 376 176 C376.7 187.7 378 192.3 382 196 C386 199.7 394.3 202.3 400 198 C405.7 193.7 411.3 184.3 416 170 C420.7 155.7 425.3 128.7 428 112 C430.7 95.3 431.3 77 432 70 C431.2 80 428 111.7 427 130 C426 148.3 424.8 168.7 426 180 C427.2 191.3 429.3 195 434 198 C438.7 201 447.7 200.3 454 198 C460.3 195.7 469 186.3 472 184',
  'M404 110 C413 108.7 449 103.3 458 102',
] as const;

/** 给定高度（px）时字标的宽度，保持 viewBox 比例 */
export function wordmarkWidth(height: number): number {
  return Math.round(((height * WORDMARK_VIEWBOX.w) / WORDMARK_VIEWBOX.h) * 10) / 10;
}

/** 建字标的 SVG 节点（只建一次）；读屏读 aria-label（由 data-i18n-aria 填成应用名） */
export function wordmarkSvg(height: number, className = ''): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const v = WORDMARK_VIEWBOX;
  const svg = document.createElementNS(NS, 'svg');
  if (className) svg.setAttribute('class', className);
  svg.setAttribute('role', 'img');
  svg.setAttribute('data-i18n-aria', 'app.name');
  svg.setAttribute('width', String(wordmarkWidth(height)));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', String(WORDMARK_STROKE));
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  for (const d of WORDMARK_PATHS) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  const dot = document.createElementNS(NS, 'circle');
  dot.setAttribute('cx', String(WORDMARK_DOT.cx));
  dot.setAttribute('cy', String(WORDMARK_DOT.cy));
  dot.setAttribute('r', String(Math.round(WORDMARK_STROKE * WORDMARK_DOT.k * 10) / 10));
  dot.setAttribute('fill', 'currentColor');
  dot.setAttribute('stroke', 'none');
  svg.append(dot);
  return svg;
}
