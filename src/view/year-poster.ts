// 年度回顾导出成一张图（2026-11-20，创作年历右上角“导出图片”）。
// 画在 canvas 上，固定浅色（导出的图不跟应用的深浅色走），宽 1600px，现代、简约：
//
//   PEEKIT · 创作年历
//   2025                                  ← 大号年份
//   我的作品 · 这一年画了 128 幅
//   ───────────────────────────────────
//   128        96          12 天        6月
//   幅作品      天在画画     最长连续      最多产的月份
//   ───────────────────────────────────
//   热力图（和应用里一样，一列一周）
//   每个月（柱状）          这一年的颜色（色条 + 色值）
//   ───────────────────────────────────
//   Made with Peekit                         2025.11.20
import type { Work } from '../data/types';
import { lang, langTag, t } from '../i18n';
import { monthLabel } from '../engine/months';
import { firstDayOfWeek, heatLevel, yearGrid, type YearStats } from '../engine/calendar';
import { color, font, sansByLang } from '../tokens';
import { mixColors } from '../engine/barcode';

const W = 1600;
const P = 104;
const BG = '#F6F5F1';
const INK = '#161616';
const SUB = '#6B6B68';
const FAINT = '#A3A29E';
const LINE = '#E3E1DB';
const EMPTY = '#E7E5DF';

/** 热力图四级：强调色按比例混进底色 */
function heatColors(): string[] {
  const a = color['color-accent'];
  const mix = (k: number) => mixColors([...Array(Math.round(k * 10)).fill(a), ...Array(10 - Math.round(k * 10)).fill(BG)]) ?? a;
  return [EMPTY, mix(0.3), mix(0.55), mix(0.8), a];
}

export interface PosterInput {
  stats: YearStats;
  works: readonly Work[];
  setName: string;
}

/** 画出年度回顾，返回 PNG 的字节 */
export async function drawYearPoster({ stats, setName }: PosterInput): Promise<Uint8Array> {
  const L = lang();
  const family = sansByLang[langTag(L)] ?? font['font-family-sans'];
  const F = (weight: number, px: number) => `${weight} ${px}px ${family}`;
  try {
    await Promise.all([document.fonts.load(F(600, 64)), document.fonts.load(F(400, 24))]);
  } catch {
    /* 字体加载失败就用系统字体 */
  }
  const fmt = new Intl.NumberFormat(langTag(L));
  const first = firstDayOfWeek(langTag(L));
  const grid = yearGrid(stats.year, first);
  const inner = W - 2 * P;
  const labelW = 64;
  const gap = 5;
  const cell = Math.floor((inner - labelW) / grid.cols) - gap;
  const step = cell + gap;

  // 先排版，算出总高度
  const yTop = P;
  const yYear = yTop + 44;
  const ySub = yYear + 170;
  const yRule1 = ySub + 60;
  const yStats = yRule1 + 56;
  const yRule2 = yStats + 150;
  const yHeatTitle = yRule2 + 64;
  const yHeat = yHeatTitle + 64;
  const heatH = 7 * step - gap;
  const yLower = yHeat + heatH + 96;
  const lowerH = 300;
  const yRule3 = yLower + lowerH + 64;
  const H = yRule3 + 112;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('no 2d context');
  g.fillStyle = BG;
  g.fillRect(0, 0, W, H);
  g.textBaseline = 'alphabetic';

  const text = (s: string, x: number, y: number, f: string, c: string, align: CanvasTextAlign = 'left') => {
    g.font = f;
    g.fillStyle = c;
    g.textAlign = align;
    g.fillText(s, x, y);
  };
  const rule = (y: number) => {
    g.fillStyle = LINE;
    g.fillRect(P, y, inner, 2);
  };

  // 抬头
  text(`PEEKIT · ${t('calendar.title')}`.toUpperCase(), P, yTop + 24, F(600, 22), FAINT);
  text(String(stats.year), P - 6, yYear + 140, F(600, 168), INK);
  text(t('calendar.subtitle', { set: setName, n: fmt.format(stats.total) }), P, ySub + 8, F(400, 32), SUB);
  rule(yRule1);

  // 四个数字
  const tiles: [string, string, string][] = [
    [fmt.format(stats.total), t('calendar.statWorks'), ''],
    [fmt.format(stats.activeDays), t('calendar.statDays'), ''],
    [t('calendar.days', { n: stats.streak?.days ?? 0 }), t('calendar.statStreak'), ''],
    [stats.busiestMonth >= 0 ? monthLabel(stats.busiestMonth + 1, L) : '–', t('calendar.statMonth'),
      stats.busiestMonth >= 0 ? t('pill.count', { n: stats.months[stats.busiestMonth] }) : ''],
  ];
  const colW = inner / 4;
  tiles.forEach(([v, label, sub], i) => {
    const x = P + i * colW;
    text(v, x, yStats + 56, F(600, 64), INK);
    text(label, x, yStats + 100, F(400, 24), SUB);
    if (sub) text(sub, x, yStats + 132, F(400, 22), FAINT);
    if (i > 0) {
      g.fillStyle = LINE;
      g.fillRect(x - 28, yStats - 6, 2, 132);
    }
  });
  rule(yRule2);

  // 热力图
  text(t('calendar.heatTitle'), P, yHeatTitle, F(600, 28), INK);
  const levels = heatColors();
  const max = stats.busiestDay?.count ?? 0;
  const x0 = P + labelW;
  let lastCol = -9;
  grid.monthCols.forEach((col, m) => {
    if (col - lastCol < 3) return;
    lastCol = col;
    text(monthLabel(m + 1, L), x0 + col * step, yHeat - 18, F(400, 20), FAINT);
  });
  const wd = new Intl.DateTimeFormat(langTag(L), { weekday: 'short', timeZone: 'UTC' });
  for (const row of [0, 2, 4]) {
    const iso = ((first - 1 + row) % 7) + 1;
    text(wd.format(new Date(Date.UTC(2024, 0, iso))), P, yHeat + row * step + cell * 0.75, F(400, 18), FAINT);
  }
  const r = Math.max(3, cell * 0.22);
  for (const c of grid.cells) {
    const n = stats.days.get(c.key)?.length ?? 0;
    g.fillStyle = levels[heatLevel(n, max)];
    g.beginPath();
    g.roundRect(x0 + c.col * step, yHeat + c.row * step, cell, cell, r);
    g.fill();
  }

  // 每个月
  const half = (inner - 96) / 2;
  text(t('calendar.monthsTitle'), P, yLower, F(600, 28), INK);
  const mMax = Math.max(1, ...stats.months);
  const barTop = yLower + 56, barBottom = yLower + lowerH - 36;
  const mStep = half / 12;
  const bw = Math.min(28, mStep * 0.56);
  stats.months.forEach((n, m) => {
    const cx = P + mStep * (m + 0.5);
    const h = Math.max(n ? 6 : 2, ((barBottom - barTop - 28) * n) / mMax);
    g.fillStyle = n ? (m === stats.busiestMonth ? color['color-accent'] : levels[2]) : EMPTY;
    g.beginPath();
    g.roundRect(cx - bw / 2, barBottom - h, bw, h, Math.min(6, bw / 2));
    g.fill();
    if (n) text(String(n), cx, barBottom - h - 10, F(500, 18), SUB, 'center');
    text(monthLabel(m + 1, L), cx, barBottom + 30, F(400, 17), FAINT, 'center');
  });

  // 这一年的颜色
  const cx0 = P + half + 96;
  text(t('calendar.colorsTitle'), cx0, yLower, F(600, 28), INK);
  if (stats.colors.length) {
    const by = yLower + 56, bh = 64;
    g.save();
    g.beginPath();
    g.roundRect(cx0, by, half, bh, 14);
    g.clip();
    let x = cx0;
    const total = stats.colors.reduce((a, c) => a + c.share, 0) || 1;
    for (const c of stats.colors) {
      const w = (c.share / total) * half;
      g.fillStyle = c.hex;
      g.fillRect(x, by, w + 1, bh);
      x += w;
    }
    g.restore();
    // 一圈细描边：白、浅色的色块在浅底上也看得清
    g.strokeStyle = 'rgba(0,0,0,0.08)';
    g.lineWidth = 2;
    g.beginPath();
    g.roundRect(cx0 + 1, by + 1, half - 2, bh - 2, 13);
    g.stroke();
    stats.colors.slice(0, 8).forEach((c, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const x = cx0 + col * (half / 2), y = by + bh + 44 + row * 38;
      g.fillStyle = c.hex;
      g.beginPath();
      g.arc(x + 9, y - 7, 9, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.12)';
      g.lineWidth = 1.5;
      g.stroke();
      text(c.hex, x + 28, y, F(500, 20), SUB);
      text(`${Math.round(c.share * 100)}%`, x + 140, y, F(400, 20), FAINT);
    });
  } else {
    text(t('calendar.colorsNone'), cx0, yLower + 80, F(400, 22), FAINT);
  }

  // 落款
  rule(yRule3);
  text('Made with Peekit', P, yRule3 + 60, F(500, 22), FAINT);
  const today = new Date();
  const p2 = (n: number) => String(n).padStart(2, '0');
  text(`${today.getFullYear()}.${p2(today.getMonth() + 1)}.${p2(today.getDate())}`, W - P, yRule3 + 60, F(400, 22), FAINT, 'right');

  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('canvas.toBlob failed');
  return new Uint8Array(await blob.arrayBuffer());
}
