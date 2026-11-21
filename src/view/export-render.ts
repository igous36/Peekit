// 导出：把排版（engine/export-layout.ts）画到画布上，编码成 JPG / PNG，或拼成 PDF（2026-11-21）。
// 底色只有四种（白、纸、浅灰、墨），文字只有一种无衬线字体两种颜色：标题墨色、其余灰色。
// 作品原样按比例画（不裁、不加圆角和阴影），读不了的画成主色块。
import type { Shape } from '../data/types';
import { lang, langTag } from '../i18n';
import { font, sansByLang } from '../tokens';
import { buildPdf, type PdfImagePage } from '../data/pdf';
import { brandWidth, PDF_POINTS, type ExportPlan, type ExportType, type Page, type PdfPageSize } from '../engine/export-layout';
import { PEEKIT } from './wordmark';

/** Peekit 标识：手写字标（界面左上角同一套笔画），灰色 */
function drawBrand(g: CanvasRenderingContext2D, b: NonNullable<Page['brand']>, color: string): void {
  const v = PEEKIT.viewBox;
  const k = b.h / v.h;
  g.save();
  g.translate(b.x - brandWidth(b.h) - v.x * k, b.y - v.y * k);
  g.scale(k, k);
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = PEEKIT.stroke;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const st of PEEKIT.strokes) g.stroke(new Path2D(st.d));
  if (PEEKIT.dot) {
    g.beginPath();
    g.arc(PEEKIT.dot.cx, PEEKIT.dot.cy, PEEKIT.stroke * PEEKIT.dot.k, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

export type ExportBg = 'white' | 'paper' | 'gray' | 'ink';

export interface ExportTheme {
  bg: string;
  ink: string;
  sub: string;
  rule: string;
}

/** 导出图的四种底色（固定，不跟应用的深浅色走） */
export const EXPORT_THEMES: Record<ExportBg, ExportTheme> = {
  white: { bg: '#FFFFFF', ink: '#161616', sub: '#7A7A77', rule: '#E6E5E1' },
  paper: { bg: '#F6F5F1', ink: '#161616', sub: '#6B6B68', rule: '#E1DFD8' },
  gray: { bg: '#E8E8E6', ink: '#161616', sub: '#62625F', rule: '#D3D3D0' },
  ink: { bg: '#141414', ink: '#F2F2EF', sub: '#8F8F8B', rule: '#2C2C2C' },
};

export interface ExportTexts {
  /** 说明的标题（预览集或系列名） */
  title: string;
  /** 说明的第二行：作者 · 时间范围 · 幅数 */
  meta: string;
  /** 每幅的标题和日期 */
  captions: readonly { title: string; date: string }[];
}

export interface DrawnImage {
  img: CanvasImageSource;
  close(): void;
}

export interface ExportImages {
  /** 第 i 幅画成 w × h（导出像素）用的图；读不了返回 null（画成主色块） */
  load(i: number, w: number, h: number): Promise<DrawnImage | null>;
  /** 主色（加载失败时的色块） */
  bg(i: number): string;
  /** 示例数据的色块（浏览器调试） */
  shapes(i: number): readonly Shape[] | undefined;
}

export function exportFamily(): string {
  return sansByLang[langTag(lang())] ?? font['font-family-sans'];
}

/** 放不下就截短，末尾加省略号 */
function fit(g: CanvasRenderingContext2D, s: string, w: number): string {
  if (g.measureText(s).width <= w) return s;
  const chars = Array.from(s);
  let lo = 0, hi = chars.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (g.measureText(chars.slice(0, mid).join('') + '…').width <= w) lo = mid;
    else hi = mid - 1;
  }
  return lo ? chars.slice(0, lo).join('') + '…' : '';
}

/** 一行字：y 是这一行的顶，按行高垂直居中 */
function line(g: CanvasRenderingContext2D, s: string, x: number, y: number, lh: number, w: number, f: string, c: string): number {
  g.font = f;
  g.fillStyle = c;
  const out = fit(g, s, w);
  g.fillText(out, x, y + lh / 2);
  return g.measureText(out).width;
}

/** CSS 圆角简写（示例数据用的百分比）→ canvas roundRect 的四个角 */
function radii(r: string, w: number, h: number): DOMPointInit[] {
  const v = r.trim().split(/\s+/).filter(Boolean).map((p) => {
    const n = parseFloat(p) || 0;
    return p.endsWith('%') ? { x: (n / 100) * w, y: (n / 100) * h } : { x: n, y: n };
  });
  if (!v.length) return [{ x: 0, y: 0 }];
  const [a, b = a, c = a, d = b] = v;
  return [a, b, c, d];
}

function drawShapes(g: CanvasRenderingContext2D, shapes: readonly Shape[], x: number, y: number, w: number, h: number): void {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  for (const s of shapes) {
    const sw = (s.w / 100) * w, sh = (s.h / 100) * h;
    const sx = x + (s.l / 100) * w, sy = y + (s.t / 100) * h;
    g.save();
    g.translate(sx + sw / 2, sy + sh / 2);
    if (s.rot) g.rotate((s.rot * Math.PI) / 180);
    g.fillStyle = s.c;
    g.beginPath();
    g.roundRect(-sw / 2, -sh / 2, sw, sh, radii(s.r, sw, sh));
    g.fill();
    g.restore();
  }
  g.restore();
}

export interface RenderControl {
  /** 每画完一幅调一次 */
  step?: () => void;
  /** 设成 true 就停下（抛出 'cancelled'） */
  cancelled?: boolean;
}

const LOADS = 3;

/** 画一页 */
export async function renderPage(
  page: Page, plan: ExportPlan, theme: ExportTheme, texts: ExportTexts, images: ExportImages, ctl: RenderControl = {},
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(page.w);
  canvas.height = Math.round(page.h);
  const g = canvas.getContext('2d');
  if (!g) throw new Error('no 2d context');
  g.fillStyle = theme.bg;
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.textBaseline = 'middle';
  g.imageSmoothingQuality = 'high';
  const family = exportFamily();
  const F = (weight: number, px: number) => `${weight} ${px}px ${family}`;
  const t = plan.type;

  // 作品：最多同时读 3 幅，读好一幅画一幅
  let next = 0;
  const worker = async () => {
    while (next < page.cells.length) {
      if (ctl.cancelled) throw new Error('cancelled');
      const c = page.cells[next++];
      const x = Math.round(c.x), y = Math.round(c.y), w = Math.round(c.x + c.w) - x, h = Math.round(c.y + c.h) - y;
      const shapes = images.shapes(c.i);
      if (shapes) {
        g.fillStyle = images.bg(c.i);
        g.fillRect(x, y, w, h);
        drawShapes(g, shapes, x, y, w, h);
      } else {
        const d = await images.load(c.i, w, h).catch(() => null);
        if (ctl.cancelled) {
          d?.close();
          throw new Error('cancelled');
        }
        if (d) {
          g.drawImage(d.img, x, y, w, h);
          d.close();
        } else {
          g.fillStyle = images.bg(c.i);
          g.fillRect(x, y, w, h);
        }
      }
      if (c.cap) {
        const cap = texts.captions[c.i];
        if (cap && plan.capLines === 2) {
          // 窄格子：标题一行、日期在下一行
          if (cap.title) line(g, cap.title, c.cap.x, c.cap.y, t.capLine, c.cap.w, F(500, t.caption), theme.ink);
          if (cap.date) line(g, cap.date, c.cap.x, c.cap.y + t.capLine, t.capLine, c.cap.w, F(400, t.caption), theme.sub);
        } else if (cap) {
          const used = cap.title ? line(g, cap.title, c.cap.x, c.cap.y, t.capLine, c.cap.w, F(500, t.caption), theme.ink) : 0;
          if (cap.date) {
            const gapX = used ? t.caption * 0.7 : 0;
            line(g, cap.date, c.cap.x + used + gapX, c.cap.y, t.capLine, Math.max(0, c.cap.w - used - gapX), F(400, t.caption), theme.sub);
          }
        }
      }
      ctl.step?.();
    }
  };
  await Promise.all(Array.from({ length: Math.min(LOADS, page.cells.length) }, worker));

  if (page.rule) {
    g.fillStyle = theme.rule;
    g.fillRect(Math.round(page.rule.x), Math.round(page.rule.y), Math.round(page.rule.w), Math.max(1, Math.round(t.rule)));
  }
  if (page.summary) {
    const st: ExportType = page.summary.big && plan.cover ? plan.cover : t;
    const { x, y, w } = page.summary;
    if (texts.title) line(g, texts.title, x, y, st.titleLine, w, F(600, st.title), theme.ink);
    if (texts.meta) line(g, texts.meta, x, y + st.titleLine + st.metaGap, st.metaLine, w, F(400, st.meta), theme.sub);
  }
  if (page.brand) drawBrand(g, page.brand, theme.sub);
  return canvas;
}

async function encode(canvas: HTMLCanvasElement, type: 'image/jpeg' | 'image/png', quality = 0.92): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, type, quality));
  if (!blob) throw new Error('canvas.toBlob failed');
  return new Uint8Array(await blob.arrayBuffer());
}

/** 长图 / 网格 / 拼图：一张图 */
export async function renderImage(
  plan: ExportPlan, theme: ExportTheme, texts: ExportTexts, images: ExportImages, format: 'jpg' | 'png', ctl: RenderControl = {},
): Promise<Uint8Array> {
  await loadFonts();
  const canvas = await renderPage(plan.pages[0], plan, theme, texts, images, ctl);
  try {
    return await encode(canvas, format === 'png' ? 'image/png' : 'image/jpeg');
  } finally {
    canvas.width = canvas.height = 0;
  }
}

/** PDF 作品集：一页一页画、压成 JPEG，最后拼起来 */
export async function renderPdf(
  plan: ExportPlan, page: PdfPageSize, theme: ExportTheme, texts: ExportTexts, images: ExportImages, ctl: RenderControl = {},
): Promise<Uint8Array> {
  await loadFonts();
  const [pw, ph] = PDF_POINTS[page];
  const out: PdfImagePage[] = [];
  for (const p of plan.pages) {
    if (ctl.cancelled) throw new Error('cancelled');
    const canvas = await renderPage(p, plan, theme, texts, images, ctl);
    out.push({ jpeg: await encode(canvas, 'image/jpeg', 0.9), px: canvas.width, py: canvas.height, w: pw, h: ph });
    canvas.width = canvas.height = 0;
  }
  return buildPdf(out, texts.title);
}

async function loadFonts(): Promise<void> {
  const family = exportFamily();
  try {
    await Promise.all([document.fonts.load(`600 40px ${family}`), document.fonts.load(`400 20px ${family}`), document.fonts.load(`500 20px ${family}`)]);
  } catch {
    /* 字体加载失败就用系统字体 */
  }
}
