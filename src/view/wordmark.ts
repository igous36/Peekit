// 左上角的手写字标：预览里是「Peekit」，情绪板里换成两行的「Mood / boards」。
// 都是圆头单线连笔，路径由设计稿的落笔点经 Catmull-Rom 转成三次贝塞尔得到（设计稿：claude.ai Design 画布「Peekit Logo」）。
// 两个字标的框一样大（440 × 190 viewBox 单位），在标题栏里互换时位置、大小不跳。
// 描边 / 填充都用 currentColor，浅色、深色、全屏跟着所在行的文字色走。
//
// 进出情绪板时新字标按笔顺写出来（writeMark）：路径设 pathLength = 1，用 Web Animations 把 stroke-dashoffset 从 1 推到 0。
// 时间在 tokens.ts 的 wordmarkWrite。

import { wordmarkWrite } from '../tokens';

/** 标题栏里字标的高度（px）：和原来 15px 文字字标的视觉分量相当 */
export const WORDMARK_HEIGHT = 26;

export interface MarkStroke {
  d: string;
  /** 书写：[开始, 时长]（ms，从 delay 之后算） */
  write: readonly [number, number];
  /** 缓动，默认 wordmarkWrite.ease */
  ease?: string;
}

export interface Mark {
  viewBox: { x: number; y: number; w: number; h: number };
  /** 笔画粗细（viewBox 单位，标题栏用的值） */
  stroke: number;
  strokes: readonly MarkStroke[];
  /** 圆点（i 的点）：圆心，半径 = 笔画 × k；书写时最后弹出来 */
  dot?: { cx: number; cy: number; k: number; write: readonly [number, number] };
  /** 读屏名字的 i18n 键 */
  aria: string;
}

const W = wordmarkWrite;

/**
 * 「Peekit」：一笔从 P 的圈起笔，绕回竖画、连写 e e k i t；i 的点和 t 的横另起。
 * 笔画：设计稿常规 14，标题栏里只有 26px 高，加粗到 16 才不发虚。
 */
export const PEEKIT: Mark = {
  viewBox: { x: 44, y: 22, w: 440, h: 190 },
  stroke: 16,
  strokes: [
    {
      d: 'M54 110 C59.3 109.7 75.7 109.7 86 108 C96.3 106.3 107.7 104.3 116 100 C124.3 95.7 132 88.7 136 82 C140 75.3 141.7 67 140 60 C138.3 53 132.3 44.7 126 40 C119.7 35.3 109.3 32.7 102 32 C94.7 31.3 87.3 32.7 82 36 C76.7 39.3 72.7 41.3 70 52 C67.3 62.7 67.3 83.7 66 100 C64.7 116.3 62.8 136 62 150 C61.2 164 59.7 175.7 61 184 C62.3 192.3 59.2 200.3 70 200 C80.8 199.7 112.7 186.7 126 182 C139.3 177.3 144 176.7 150 172 C156 167.3 160.7 160.7 162 154 C163.3 147.3 161.3 137.8 158 132 C154.7 126.2 147.7 120.3 142 119 C136.3 117.7 128.7 119.5 124 124 C119.3 128.5 115.5 137.7 114 146 C112.5 154.3 112.7 165.8 115 174 C117.3 182.2 122.2 190.5 128 195 C133.8 199.5 142.7 200.7 150 201 C157.3 201.3 162 200.2 172 197 C182 193.8 199.7 186.2 210 182 C220.3 177.8 228 176.7 234 172 C240 167.3 244.7 160.7 246 154 C247.3 147.3 245.3 137.8 242 132 C238.7 126.2 231.7 120.3 226 119 C220.3 117.7 212.7 119.5 208 124 C203.3 128.5 199.5 137.7 198 146 C196.5 154.3 196.7 165.8 199 174 C201.3 182.2 206.2 190.5 212 195 C217.8 199.5 226.7 200.7 234 201 C241.3 201.3 248.3 202.2 256 197 C263.7 191.8 273.7 181.5 280 170 C286.3 158.5 290 143 294 128 C298 113 302 92.7 304 80 C306 67.3 307.3 59 306 52 C304.7 45 300 39 296 38 C292 37 285 37.3 282 46 C279 54.7 279 72.7 278 90 C277 107.3 276.7 131.7 276 150 C275.3 168.3 274.3 191.7 274 200 C274.7 195.3 275 180.7 278 172 C281 163.3 286.3 154 292 148 C297.7 142 306 137 312 136 C318 135 325.7 138 328 142 C330.3 146 329.3 155.3 326 160 C322.7 164.7 314 168.7 308 170 C302 171.3 293 168.3 290 168 C293 169.3 303.3 172 308 176 C312.7 180 313.7 188 318 192 C322.3 196 328 199.7 334 200 C340 200.3 348.3 199 354 194 C359.7 189 364 181.3 368 170 C372 158.7 376.3 133.3 378 126 C377.7 134.3 375.3 164.3 376 176 C376.7 187.7 378 192.3 382 196 C386 199.7 394.3 202.3 400 198 C405.7 193.7 411.3 184.3 416 170 C420.7 155.7 425.3 128.7 428 112 C430.7 95.3 431.3 77 432 70 C431.2 80 428 111.7 427 130 C426 148.3 424.8 168.7 426 180 C427.2 191.3 429.3 195 434 198 C438.7 201 447.7 200.3 454 198 C460.3 195.7 469 186.3 472 184',
      write: W.peekit.main,
    },
    { d: 'M404 110 C413 108.7 449 103.3 458 102', write: W.peekit.cross, ease: W.crossEase },
  ],
  dot: { cx: 380, cy: 94, k: 0.62, write: W.peekit.dot },
  aria: 'app.name',
};

/**
 * 情绪板里的「Mood / boards」：两行错开，boards 往右缩进，b 的上圈卡在上一行 o 和 d 之间；Mood、boards 各一笔。
 * 笔画按「笔画 ÷ 小写字高」对齐 Peekit（约 0.2）：设计稿 9，标题栏里同样加粗 2，用 11。
 */
export const MOOD_BOARDS: Mark = {
  viewBox: { x: 0, y: 0, w: 440, h: 190 },
  stroke: 11,
  strokes: [
    { d: 'M16 92 C16.8 87.7 18.8 75.3 21 66 C23.2 56.7 25.8 44.2 29 36 C32.2 27.8 36.5 19.5 40 17 C43.5 14.5 47.7 16.5 50 21 C52.3 25.5 53.2 35.8 54 44 C54.8 52.2 54.7 62 55 70 C55.3 78 55.8 88.3 56 92 C56.7 87 58 71.7 60 62 C62 52.3 64.8 41.2 68 34 C71.2 26.8 75.5 20.8 79 19 C82.5 17.2 86.8 18.5 89 23 C91.2 27.5 91.3 37.8 92 46 C92.7 54.2 92.3 65 93 72 C93.7 79 94.2 84.5 96 88 C97.8 91.5 101.3 95.7 104 93 C106.7 90.3 109.7 78.2 112 72 C114.3 65.8 115.5 59.7 118 56 C120.5 52.3 123.7 50.5 127 50 C130.3 49.5 135.2 50.3 138 53 C140.8 55.7 143.2 61.2 144 66 C144.8 70.8 144.7 77.7 143 82 C141.3 86.3 137.5 90.2 134 92 C130.5 93.8 125.5 94.2 122 93 C118.5 91.8 114.8 88.8 113 85 C111.2 81.2 110.7 74.7 111 70 C111.3 65.3 112.8 60.2 115 57 C117.2 53.8 120.5 52.2 124 51 C127.5 49.8 132 49.8 136 50 C140 50.2 144.7 51.3 148 52 C151.3 52.7 153.7 54.2 156 54 C158.3 53.8 159.7 51.7 162 51 C164.3 50.3 167 48.8 170 50 C173 51.2 178 54 180 58 C182 62 182.7 69 182 74 C181.3 79 178.7 84.8 176 88 C173.3 91.2 169.3 93 166 93 C162.7 93 158.5 91.2 156 88 C153.5 84.8 151.3 79 151 74 C150.7 69 152.2 61.8 154 58 C155.8 54.2 158.7 52.3 162 51 C165.3 49.7 170 49.7 174 50 C178 50.3 182.3 52.8 186 53 C189.7 53.2 192.7 51.5 196 51 C199.3 50.5 202.7 49.2 206 50 C209.3 50.8 213.8 52.3 216 56 C218.2 59.7 219.3 66.7 219 72 C218.7 77.3 216.5 84.5 214 88 C211.5 91.5 207.5 93 204 93 C200.5 93 195.5 91.3 193 88 C190.5 84.7 189.2 78 189 73 C188.8 68 190.2 61.7 192 58 C193.8 54.3 196.7 52.3 200 51 C203.3 49.7 209.3 52.2 212 50 C214.7 47.8 214.3 42.7 216 38 C217.7 33.3 220 26 222 22 C224 18 226.2 14.8 228 14 C229.8 13.2 232.7 13.7 233 17 C233.3 20.3 231.2 27.5 230 34 C228.8 40.5 227.2 49 226 56 C224.8 63 223.2 70.3 223 76 C222.8 81.7 223.3 87 225 90 C226.7 93 229.5 94.3 233 94 C236.5 93.7 243.8 89 246 88', write: W.moodBoards.mood },
    { d: 'M158 172 C159.7 170 164.7 166 168 160 C171.3 154 175 143.7 178 136 C181 128.3 184.3 119.3 186 114 C187.7 108.7 188.7 106.5 188 104 C187.3 101.5 184 99 182 99 C180 99 177.3 99.2 176 104 C174.7 108.8 174.5 119.3 174 128 C173.5 136.7 173.3 147.7 173 156 C172.7 164.3 172.2 174.3 172 178 C173.3 178.3 176.3 180.3 180 180 C183.7 179.7 190 179 194 176 C198 173 202.5 167 204 162 C205.5 157 204.7 150.2 203 146 C201.3 141.8 197.5 138.3 194 137 C190.5 135.7 184.8 137.2 182 138 C179.2 138.8 177.3 140.3 177 142 C176.7 143.7 178.2 147.3 180 148 C181.8 148.7 185 147.3 188 146 C191 144.7 194.7 141.2 198 140 C201.3 138.8 205 139.5 208 139 C211 138.5 213 137.5 216 137 C219 136.5 222.3 135.2 226 136 C229.7 136.8 235.5 138.5 238 142 C240.5 145.5 241.5 151.8 241 157 C240.5 162.2 237.8 169.3 235 173 C232.2 176.7 227.7 178.8 224 179 C220.3 179.2 215.7 177.3 213 174 C210.3 170.7 208.3 164 208 159 C207.7 154 209.2 147.7 211 144 C212.8 140.3 215.5 138.3 219 137 C222.5 135.7 227.8 136 232 136 C236.2 136 240 137.2 244 137 C248 136.8 251.7 135.5 256 135 C260.3 134.5 267.7 134.2 270 134 C268 134.5 261.3 134.7 258 137 C254.7 139.3 251.5 143.5 250 148 C248.5 152.5 248 159.2 249 164 C250 168.8 253.2 174.7 256 177 C258.8 179.3 263 179.5 266 178 C269 176.5 272.3 172.7 274 168 C275.7 163.3 275.7 155.2 276 150 C276.3 144.8 276 139.2 276 137 C275.8 140.8 274.8 153.7 275 160 C275.2 166.3 275.2 171.8 277 175 C278.8 178.2 282.8 179.2 286 179 C289.2 178.8 293.3 178.2 296 174 C298.7 169.8 300.5 161 302 154 C303.5 147 304.5 135.7 305 132 C306.2 132.2 309.7 132.2 312 133 C314.3 133.8 317.8 136.3 319 137 C318.7 140.5 317.2 151.5 317 158 C316.8 164.5 316.2 172.7 318 176 C319.8 179.3 324.7 178.7 328 178 C331.3 177.3 335.3 176 338 172 C340.7 168 342 159.3 344 154 C346 148.7 347.7 143 350 140 C352.3 137 355 136 358 136 C361 136 365.8 136.7 368 140 C370.2 143.3 371.3 150.5 371 156 C370.7 161.5 368.5 169.2 366 173 C363.5 176.8 359.3 178.8 356 179 C352.7 179.2 348.3 177.2 346 174 C343.7 170.8 342.2 165 342 160 C341.8 155 343 147.8 345 144 C347 140.2 350.8 138.3 354 137 C357.2 135.7 361.3 138.2 364 136 C366.7 133.8 368 128.7 370 124 C372 119.3 374 112 376 108 C378 104 380 100.7 382 100 C384 99.3 387.3 100.3 388 104 C388.7 107.7 387.3 115 386 122 C384.7 129 381.5 138.7 380 146 C378.5 153.3 377 160.7 377 166 C377 171.3 377.8 176 380 178 C382.2 180 386.7 179 390 178 C393.3 177 397.7 176.3 400 172 C402.3 167.7 402.5 158.3 404 152 C405.5 145.7 408.2 137 409 134 C410.2 136 414.2 141.7 416 146 C417.8 150.3 420 155.3 420 160 C420 164.7 418.3 170.8 416 174 C413.7 177.2 409.3 179 406 179 C402.7 179 398 176.2 396 174 C394 171.8 394.3 167.3 394 166', write: W.moodBoards.boards },
  ],
  aria: 'board.menu',
};

/** 给定高度（px）时字标的宽度，保持 viewBox 比例 */
export function markWidth(mark: Mark, height: number): number {
  return Math.round(((height * mark.viewBox.w) / mark.viewBox.h) * 10) / 10;
}

const NS = 'http://www.w3.org/2000/svg';

/** 建字标的 SVG 节点（只建一次）；读屏读 aria-label（由 data-i18n-aria 填） */
export function markSvg(mark: Mark, height: number, className = ''): SVGSVGElement {
  const v = mark.viewBox;
  const svg = document.createElementNS(NS, 'svg');
  if (className) svg.setAttribute('class', className);
  svg.setAttribute('role', 'img');
  svg.setAttribute('data-i18n-aria', mark.aria);
  svg.setAttribute('width', String(markWidth(mark, height)));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', String(mark.stroke));
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  mark.strokes.forEach((s, i) => {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', s.d);
    // 书写动画按路径长度的比例画虚线：整条路径记成 1
    p.setAttribute('pathLength', '1');
    p.dataset.stroke = String(i);
    svg.append(p);
  });
  if (mark.dot) {
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', String(mark.dot.cx));
    dot.setAttribute('cy', String(mark.dot.cy));
    dot.setAttribute('r', String(Math.round(mark.stroke * mark.dot.k * 10) / 10));
    dot.setAttribute('fill', 'currentColor');
    dot.setAttribute('stroke', 'none');
    dot.style.transformBox = 'fill-box';
    dot.style.transformOrigin = 'center';
    dot.dataset.dot = '';
    svg.append(dot);
  }
  return svg;
}

const reducedMotion = typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

/**
 * 把字标按笔顺写出来：每一笔在 delay + 开始时刻起笔，写之前看不见（fill: backwards）。
 * 再次调用会从头重写；系统开了“减少动态效果”时直接显示整个字标。
 */
export function writeMark(svg: SVGSVGElement, mark: Mark, delay: number = wordmarkWrite.delay): void {
  for (const a of svg.getAnimations({ subtree: true })) a.cancel();
  if (reducedMotion?.matches) return;
  svg.querySelectorAll<SVGPathElement>('path[data-stroke]').forEach((p) => {
    const s = mark.strokes[Number(p.dataset.stroke)];
    if (!s) return;
    p.animate(
      [
        { strokeDasharray: '1 2', strokeDashoffset: '1' },
        { strokeDasharray: '1 2', strokeDashoffset: '0' },
      ],
      { delay: delay + s.write[0], duration: s.write[1], easing: s.ease ?? wordmarkWrite.ease, fill: 'backwards' },
    );
  });
  const dot = svg.querySelector<SVGCircleElement>('circle[data-dot]');
  if (dot && mark.dot) {
    dot.animate(
      [
        { opacity: 0, transform: 'scale(0.2)' },
        { opacity: 1, transform: 'scale(1)' },
      ],
      { delay: delay + mark.dot.write[0], duration: mark.dot.write[1], easing: wordmarkWrite.dotEase, fill: 'backwards' },
    );
  }
}
