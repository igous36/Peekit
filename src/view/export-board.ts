// 情绪板导出（2026-11-21）：按画布上的样子画到 canvas 上——网点底、照片、标注，下面可选说明和 Peekit 标识。
//
// 照片和画布上一样：圆角 6、一圈 1.5u 的集合色描边、同色泛光和被染一点的阴影（这些都在画布坐标里，跟着缩放；
// 描边在导出图上粗细固定）。标注（便签、色卡、直线和箭头、手绘）照 board-marks.ts 的样式重画一遍。
// 注意 canvas 的阴影不受变换影响，模糊和偏移要自己乘上缩放。
import { groupColor, type Board } from '../data/boards';
import { MARK_COLORS, arrowHead, inkPath, type BoardMark } from '../engine/marks';
import type { BoardPlan } from '../engine/export-layout';
import { font } from '../tokens';
import {
  drawChrome, drawShapes, encode, exportFamily, loadFonts,
  type DrawnImage, type ExportBg, type ExportImages, type ExportTexts, type ExportTheme, type RenderControl,
} from './export-render';

const RADIUS = 6;
const LOADS = 3;

/** 网点颜色：浅底用深色点，墨黑底用浅色点（和画布上的点阵一样） */
function dotColors(bg: ExportBg): [string, string] {
  return bg === 'ink' ? ['rgba(255,255,255,0.12)', 'rgba(255,255,255,0.22)'] : ['rgba(22,22,22,0.17)', 'rgba(22,22,22,0.28)'];
}

function rgba(hex: string, a: number): string {
  const n = hex.replace('#', '');
  const v = (i: number) => parseInt(n.slice(i, i + 2), 16) || 0;
  return `rgba(${v(0)},${v(2)},${v(4)},${a})`;
}

/** 网点：细点和粗点两层，网格原点和画布原点对齐（粗点的位置不再画细点） */
function drawDots(g: CanvasRenderingContext2D, plan: BoardPlan, bg: ExportBg, u: number): void {
  const [fine, major] = dotColors(bg);
  const { w, h } = plan.page;
  const layer = (step: number, r: number, color: string, skip: number) => {
    g.fillStyle = color;
    g.beginPath();
    const x0 = plan.ox - Math.ceil(plan.ox / step) * step;
    const y0 = plan.oy - Math.ceil(plan.oy / step) * step;
    for (let y = y0; y <= h; y += step) {
      for (let x = x0; x <= w; x += step) {
        if (skip) {
          const mx = (x - plan.ox) / skip, my = (y - plan.oy) / skip;
          if (Math.abs(mx - Math.round(mx)) < 1e-6 && Math.abs(my - Math.round(my)) < 1e-6) continue;
        }
        g.moveTo(x + r, y);
        g.arc(x, y, r, 0, Math.PI * 2);
      }
    }
    g.fill();
  };
  layer(plan.dot, 1.1 * u, fine, plan.dotMajor);
  layer(plan.dotMajor, 1.4 * u, major, 0);
}

/** 便签里的字按宽度折行（中日文逐字，英文尽量在空格处断） */
function wrapLines(g: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const ch of Array.from(para)) {
      const next = line + ch;
      if (line && g.measureText(next).width > maxW) {
        const sp = line.lastIndexOf(' ');
        if (sp > 0 && ch !== ' ') {
          out.push(line.slice(0, sp));
          line = line.slice(sp + 1) + ch;
        } else {
          out.push(line);
          line = ch === ' ' ? '' : ch;
        }
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

/** 标注：坐标是画布坐标（调用前已经变换好），k 只用来换算阴影 */
function drawMark(g: CanvasRenderingContext2D, m: BoardMark, k: number): void {
  const family = exportFamily();
  const cardShadow = () => {
    g.shadowColor = 'rgba(38,30,12,0.22)';
    g.shadowBlur = 22 * k;
    g.shadowOffsetY = 6 * k;
  };
  if (m.kind === 'note') {
    g.save();
    cardShadow();
    g.fillStyle = MARK_COLORS[m.color].note;
    g.beginPath();
    g.roundRect(m.x, m.y, m.w, m.h, 6);
    g.fill();
    g.restore();
    g.save();
    g.beginPath();
    g.rect(m.x, m.y, m.w, m.h);
    g.clip();
    g.fillStyle = '#2a2a2a';
    g.font = `400 ${m.size}px ${family}`;
    g.textBaseline = 'middle';
    const padX = m.size * 0.85, padY = m.size * 0.75, lh = m.size * 1.45;
    const lines = wrapLines(g, m.text, m.w - padX * 2);
    lines.forEach((ln, i) => g.fillText(ln, m.x + padX, m.y + padY + lh * i + lh / 2));
    g.restore();
    return;
  }
  if (m.kind === 'swatch') {
    const w = m.w, pad = w * 0.03, gap = w * 0.02, inner = w * 0.022, fs = w * 0.036;
    g.save();
    cardShadow();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.roundRect(m.x, m.y, m.w, m.h, w * 0.035);
    g.fill();
    g.restore();
    const n = Math.max(1, m.colors.length);
    const cw = (w - pad * 2 - gap * (n - 1)) / n;
    const fillH = Math.max(0, m.h - pad * 2 - inner - fs);
    g.save();
    g.font = `500 ${fs}px ${font['font-family-mono']}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    m.colors.forEach((hex, i) => {
      const x = m.x + pad + i * (cw + gap), y = m.y + pad;
      g.fillStyle = hex;
      g.beginPath();
      g.roundRect(x, y, cw, fillH, w * 0.02);
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.08)';
      g.lineWidth = 1 / k;
      g.stroke();
      g.fillStyle = '#5c5c5c';
      g.fillText(hex, x + cw / 2, y + fillH + inner + fs / 2, cw);
    });
    g.restore();
    return;
  }
  g.save();
  g.strokeStyle = MARK_COLORS[m.color].ink;
  g.lineWidth = m.width;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  if (m.kind === 'line') {
    g.stroke(new Path2D(`M${m.x1} ${m.y1}L${m.x2} ${m.y2}`));
    if (m.arrow) {
      const [ax, ay, tx, ty, bx, by] = arrowHead(m);
      g.stroke(new Path2D(`M${ax} ${ay}L${tx} ${ty}L${bx} ${by}`));
    }
  } else g.stroke(new Path2D(inkPath(m.pts)));
  g.restore();
}

/** 画一个情绪板，返回 JPG / PNG 的字节 */
export async function renderBoard(
  board: Board, plan: BoardPlan, bg: ExportBg, theme: ExportTheme, texts: ExportTexts, images: ExportImages,
  format: 'jpg' | 'png', ctl: RenderControl = {},
): Promise<Uint8Array> {
  await loadFonts();
  const { page, k } = plan;
  const u = plan.type.caption / 20;
  const canvas = document.createElement('canvas');
  canvas.width = page.w;
  canvas.height = page.h;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('no 2d context');
  g.imageSmoothingQuality = 'high';
  g.fillStyle = theme.bg;
  g.fillRect(0, 0, page.w, page.h);
  drawDots(g, plan, bg, u);

  // 照片按画的先后顺序（后面的盖在前面的上面）：先往后多读几张，读好一张画一张
  const items = board.items;
  const loads: (Promise<DrawnImage | null> | undefined)[] = [];
  const start = (i: number) => {
    if (i >= items.length || loads[i]) return;
    loads[i] = items[i].path ? images.load(i, items[i].w * k, items[i].h * k).catch(() => null) : Promise.resolve(null);
  };
  try {
    for (let i = 0; i < items.length; i++) {
      for (let j = i; j < i + LOADS; j++) start(j);
      const img = await loads[i];
      loads[i] = undefined;
      if (ctl.cancelled) {
        img?.close();
        throw new Error('cancelled');
      }
      const it = items[i];
      const x = plan.ox + it.x * k, y = plan.oy + it.y * k, w = it.w * k, h = it.h * k, r = RADIUS * k;
      const gc = groupColor(board, it.group);
      // 泛光 + 阴影（画在照片底下，照片再盖上去）
      g.save();
      g.fillStyle = it.color ?? images.bg(i);
      g.shadowColor = rgba(gc, 0.3);
      g.shadowBlur = 28 * k;
      g.beginPath();
      g.roundRect(x, y, w, h, r);
      g.fill();
      g.shadowColor = 'rgba(38,30,12,0.26)';
      g.shadowBlur = 34 * k;
      g.shadowOffsetY = 18 * k;
      g.beginPath();
      g.roundRect(x + 10 * k, y + 10 * k, Math.max(0, w - 20 * k), Math.max(0, h - 20 * k), r);
      g.fill();
      g.restore();
      // 照片（圆角裁切）
      g.save();
      g.beginPath();
      g.roundRect(x, y, w, h, r);
      g.clip();
      const shapes = images.shapes(i);
      if (shapes) {
        g.fillStyle = images.bg(i);
        g.fillRect(x, y, w, h);
        drawShapes(g, shapes, x, y, w, h);
      } else if (img) g.drawImage(img.img, x, y, w, h);
      else {
        g.fillStyle = images.bg(i);
        g.fillRect(x, y, w, h);
      }
      g.restore();
      img?.close();
      // 集合色描边：在照片外面一圈，导出图上 1.5u
      const lw = 1.5 * u;
      g.strokeStyle = rgba(gc, 0.88);
      g.lineWidth = lw;
      g.beginPath();
      g.roundRect(x - lw / 2, y - lw / 2, w + lw, h + lw, r + lw / 2);
      g.stroke();
      ctl.step?.();
    }
  } finally {
    for (const p of loads) void p?.then((d) => d?.close());
  }

  // 标注盖在照片上面
  if (board.marks?.length) {
    g.save();
    g.translate(plan.ox, plan.oy);
    g.scale(k, k);
    for (const m of board.marks) drawMark(g, m, k);
    g.restore();
  }
  drawChrome(g, page, plan.type, undefined, theme, texts);
  try {
    return await encode(canvas, format === 'png' ? 'image/png' : 'image/jpeg');
  } finally {
    canvas.width = canvas.height = 0;
  }
}
