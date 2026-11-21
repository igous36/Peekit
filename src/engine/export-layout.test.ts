// 2026-11-21：导出排版
import { describe, it, expect } from 'vitest';
import { brandWidth, dateRange, fillBox, pageSize, pickCover, planExport, MAX_SIDE, type Cell, type ExportSettings, type Page } from './export-layout';

const base: ExportSettings = {
  layout: 'long', columns: 3, ratio: '16:9', page: 'a4-landscape', margin: 1, gap: 1, captions: false, summary: true, brand: false, size: 1,
};

/** 两个框有没有重叠（留 0.5px 浮点余量） */
const overlap = (a: Cell, b: Cell) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

function noOverlap(cells: readonly Cell[]) {
  for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) expect(overlap(cells[i], cells[j])).toBe(false);
}

const aspects = [1.5, 0.7, 1, 0.8, 2, 0.75, 1.33, 1, 0.6];

describe('导出排版', () => {
  it('长图：一列占满内容宽，竖幅最高 1.25 倍宽，说明在最下面', () => {
    const p = planExport([2, 0.5], base).pages[0];
    expect(p.w).toBe(1600);
    const [a, b] = p.cells;
    expect(a.w).toBeCloseTo(1600 - 2 * 112);
    expect(a.h).toBeCloseTo(a.w / 2);
    expect(b.h).toBeCloseTo(a.w * 1.25);
    expect(b.x + b.w / 2).toBeCloseTo(800);
    expect(b.y).toBeGreaterThan(a.y + a.h);
    expect(p.summary!.y).toBeGreaterThan(b.y + b.h);
    expect(p.h).toBeGreaterThan(p.summary!.y);
  });

  it('标题行在图片下面的留白里，不压在下一幅上', () => {
    const p = planExport(aspects, { ...base, captions: true }).pages[0];
    for (let k = 0; k + 1 < p.cells.length; k++) {
      const c = p.cells[k];
      expect(c.cap!.y).toBeGreaterThan(c.y + c.h);
      expect(p.cells[k + 1].y).toBeGreaterThan(c.cap!.y);
    }
  });

  it('网格：列宽相等，互不重叠，都在页面里', () => {
    for (const columns of [2, 3, 4]) {
      const p = planExport(aspects, { ...base, layout: 'grid', columns, captions: true }).pages[0];
      noOverlap(p.cells);
      expect(new Set(p.cells.map((c) => Math.round(c.w))).size).toBe(1);
      expect(new Set(p.cells.map((c) => Math.round(c.x))).size).toBe(columns);
      for (const c of p.cells) expect(c.y + c.h).toBeLessThan(p.h);
    }
  });

  it('拼图：页面比例对，作品在边距里、互不重叠、按顺序', () => {
    for (const ratio of ['16:9', '4:3', '1:1', '3:4', '9:16'] as const) {
      const s = { ...base, layout: 'collage' as const, ratio };
      const p = planExport(aspects, s).pages[0];
      const { w, h } = pageSize(s);
      expect([p.w, p.h]).toEqual([w, h]);
      expect(Math.max(w, h)).toBe(1920);
      expect(p.cells.map((c) => c.i)).toEqual(aspects.map((_, i) => i));
      noOverlap(p.cells);
      for (const c of p.cells) {
        expect(c.x).toBeGreaterThanOrEqual(100);
        expect(c.x + c.w).toBeLessThanOrEqual(w - 100);
        expect(c.y + c.h).toBeLessThan(p.rule!.y);
        expect(c.w / c.h).toBeCloseTo(aspects[c.i], 1);
      }
    }
  });

  it('拼图把框填得比较满', () => {
    const box = { x: 0, y: 0, w: 1600, h: 900 };
    const cells = fillBox(aspects, box, 20, 0, 0);
    const area = cells.reduce((s, c) => s + c.w * c.h, 0);
    expect(area / (box.w * box.h)).toBeGreaterThan(0.6);
  });

  it('PDF：封面 + 一页一幅，作品在页面里居中', () => {
    const plan = planExport(aspects, { ...base, layout: 'pdf', captions: true }, pickCover(aspects.map(() => undefined)));
    expect(plan.pages.length).toBe(aspects.length + 1);
    expect(plan.pages[0].summary!.big).toBe(true);
    expect(plan.pages[0].cells.length).toBe(6);
    for (const p of plan.pages.slice(1)) {
      const c = p.cells[0];
      expect(c.x + c.w / 2).toBeCloseTo(p.w / 2);
      expect(c.cap!.y + plan.type.capLine).toBeLessThan(p.h);
    }
    expect(planExport(aspects, { ...base, layout: 'pdf', summary: false }).pages.length).toBe(aspects.length);
  });

  it('太长的长图自动缩小到画布放得下', () => {
    const many = Array(200).fill(0.7);
    const plan = planExport(many, base);
    const p = plan.pages[0];
    expect(plan.shrunk).toBe(true);
    expect(p.h).toBeLessThanOrEqual(MAX_SIDE + 1);
    expect(p.w).toBeLessThan(1600);
  });

  it('没有作品也能排（只有说明）', () => {
    const p = planExport([], base).pages[0];
    expect(p.cells).toEqual([]);
    expect(p.summary).toBeTruthy();
  });

  it('时间范围', () => {
    expect(dateRange(['2025.03.08', '', '2023.04.01', '2025.11.20'])).toBe('2023.04 – 2025.11');
    expect(dateRange(['2025.03.08', '2025.03.20'])).toBe('2025.03');
    expect(dateRange(['', ''])).toBe('');
  });

  it('封面挑打星最高的，不够从其余里均匀挑，按原顺序', () => {
    expect(pickCover([undefined, 5, undefined])).toEqual([0, 1, 2]);
    const r = [undefined, 3, undefined, 5, undefined, undefined, undefined, undefined, 4, undefined];
    const c = pickCover(r, 4);
    expect(c).toHaveLength(4);
    expect(c).toEqual([...c].sort((a, b) => a - b));
    expect(c).toEqual(expect.arrayContaining([1, 3, 8]));
  });
});

describe('导出的 Peekit 标识', () => {
  /** 标识整块在页面的留白里，不压作品、不压说明的文字 */
  function brandOk(p: Page) {
    const b = p.brand!;
    const left = b.x - brandWidth(b.h);
    expect(left).toBeGreaterThan(0);
    expect(b.x).toBeLessThan(p.w);
    expect(b.y + b.h).toBeLessThan(p.h);
    for (const c of p.cells) {
      const below = b.y >= c.y + c.h, beside = left >= c.x + c.w || b.x <= c.x;
      expect(below || beside).toBe(true);
    }
    if (p.summary) expect(p.summary.x + p.summary.w).toBeLessThan(left);
  }

  it('长图、网格、拼图：和说明同一行靠右；没有说明时单独一行', () => {
    for (const layout of ['long', 'grid', 'collage'] as const) {
      for (const summary of [true, false]) {
        const p = planExport(aspects, { ...base, layout, summary, brand: true }).pages[0];
        brandOk(p);
        if (summary) expect(p.brand!.y).toBeGreaterThanOrEqual(p.summary!.y);
      }
    }
  });

  it('关掉就没有，长图也不多占高度', () => {
    const off = planExport(aspects, { ...base, summary: false }).pages[0];
    const on = planExport(aspects, { ...base, summary: false, brand: true }).pages[0];
    expect(off.brand).toBeUndefined();
    expect(on.h).toBeGreaterThan(off.h);
    const withSummary = planExport(aspects, { ...base, brand: true }).pages[0];
    expect(withSummary.h).toBe(planExport(aspects, base).pages[0].h);
  });

  it('PDF：有封面只放封面，没封面每页右下角一个', () => {
    const withCover = planExport(aspects, { ...base, layout: 'pdf', brand: true }, pickCover(aspects.map(() => undefined))).pages;
    brandOk(withCover[0]);
    expect(withCover.slice(1).every((p) => !p.brand)).toBe(true);
    const noCover = planExport(aspects, { ...base, layout: 'pdf', summary: false, brand: true }).pages;
    expect(noCover.every((p) => p.brand)).toBe(true);
    noCover.forEach(brandOk);
  });
});
