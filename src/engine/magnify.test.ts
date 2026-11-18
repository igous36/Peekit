import { describe, it, expect } from 'vitest';
import { fitRect, magnifyTargets, magnifierRect, magnifierTransform, cardRect, MAG_MARGIN, magFrameRadius } from './magnify';
import { needsOriginalFor } from './mapping';
import { monthJump, timelineLabels, placeLabels, monthKey } from './months';

describe('放大框 / 全屏框', () => {
  it('按比例放进可用区域', () => {
    expect(fitRect(0.8, 1000, 1000, 500, 500)).toEqual({ cx: 500, cy: 500, w: 800, h: 1000 });
    expect(fitRect(2, 1000, 1000, 500, 500)).toEqual({ cx: 500, cy: 500, w: 1000, h: 500 });
    expect(fitRect(undefined, 1000, 1000, 0, 0).w).toBe(800); // 没有尺寸按 4:5
  });

  it('放大框几乎占满窗口，但给顶部菜单栏留出位置；全屏框铺满', () => {
    const { enlarged, full } = magnifyTargets(0.8, 1440, 900);
    expect(enlarged.h).toBe(900 - MAG_MARGIN.top - MAG_MARGIN.bottom);
    expect(enlarged.cy - enlarged.h / 2).toBe(MAG_MARGIN.top);
    expect(full.h).toBe(900);
    expect(full.cy).toBe(450);
    // 横图：宽度碰到两侧边距
    const wide = magnifyTargets(3, 1440, 900).enlarged;
    expect(wide.w).toBe(1440 - MAG_MARGIN.side * 2);
  });

  it('mag 从 0 到 1：放大层从卡片位置平滑长到放大框，fs = 1 时到全屏框', () => {
    const card = cardRect(0, 0, 44.8, 56, 1, 8.64, 1, 1440, 900);
    expect(magnifierRect(card, 0.8, 1440, 900, 0, 0)).toEqual(card);
    const t = magnifyTargets(0.8, 1440, 900);
    expect(magnifierRect(card, 0.8, 1440, 900, 1, 0)).toEqual(t.enlarged);
    expect(magnifierRect(card, 0.8, 1440, 900, 1, 1)).toEqual(t.full);
    const half = magnifierRect(card, 0.8, 1440, 900, 0.5, 0);
    expect(half.h).toBeCloseTo((card.h + t.enlarged.h) / 2);
  });

  it('放大层按全屏框排版，缩放始终不超过 1（不会放大一张小纹理而发糊）', () => {
    const { enlarged, full } = magnifyTargets(0.8, 1440, 900);
    const tr = magnifierTransform(enlarged, full);
    expect(tr.s).toBeLessThanOrEqual(1);
    expect(tr.ty).toBeCloseTo(enlarged.cy - full.cy);
    expect(magnifierTransform(full, full)).toEqual({ tx: 0, ty: 0, s: 1 });
  });

  it('放大时按全屏尺寸判断要不要换原图', () => {
    // A4 300dpi 在 1440×900@1.5 下：单幅不用原图，全屏要 1350 物理像素 < 1600 仍不用
    expect(needsOriginalFor(2480, 3508, 1440, 900, 1.5, false)).toBe(false);
    expect(needsOriginalFor(2480, 3508, 1440, 900, 1.5, true)).toBe(false);
    // 主屏 2240×1400 物理像素全屏（1493×933 @1.5）：1400 < 1600 不换；4K 全屏要换
    expect(needsOriginalFor(2480, 3508, 2560, 1440, 1.5, true)).toBe(true);
  });
});

describe('时间轴月份', () => {
  const dates = ['2025.03.08', '2025.03.20', '2025.04.19', '2025.05.27', '2025.05.30', '2026.02.11', '2026.02.12'];

  it('月份键', () => {
    expect(monthKey('2025.03.08')).toBe('2025.03');
    expect(monthKey('')).toBe('');
  });

  it('右键「下一幅」：到下个月的第一幅；在最后一个月就到最后一幅', () => {
    expect(monthJump(dates, 0, 1)).toBe(2);
    expect(monthJump(dates, 1, 1)).toBe(2);
    expect(monthJump(dates, 3, 1)).toBe(5); // 跨年
    expect(monthJump(dates, 5, 1)).toBe(6);
    expect(monthJump(dates, 6, 1)).toBe(6);
  });

  it('右键「上一幅」：先回到本月第一幅，已经在本月第一幅才到上个月第一幅；在第一个月就到第一幅', () => {
    expect(monthJump(dates, 4, -1)).toBe(3); // 5 月中间 → 5 月第一幅
    expect(monthJump(dates, 3, -1)).toBe(2); // 5 月第一幅 → 4 月第一幅
    expect(monthJump(dates, 2, -1)).toBe(0); // 4 月（只有一幅）→ 3 月第一幅
    expect(monthJump(dates, 6, -1)).toBe(5); // 2026.02 中间 → 2026.02 第一幅
    expect(monthJump(dates, 5, -1)).toBe(3); // 2026.02 第一幅 → 2025.05 第一幅（跨年）
    expect(monthJump(dates, 1, -1)).toBe(0);
    expect(monthJump(dates, 0, -1)).toBe(0);
  });

  it('全部作品在同一个月：按方向到头', () => {
    const same = ['2025.06.01', '2025.06.02', '2025.06.03'];
    expect(monthJump(same, 1, 1)).toBe(2);
    expect(monthJump(same, 1, -1)).toBe(0);
  });

  it('标签：每年第一幅标年份，其余每月第一幅标月份', () => {
    expect(timelineLabels(dates, 'zh').map((l) => `${l.index}:${l.text}`)).toEqual([
      '0:2025', '2:4月', '3:5月', '5:2026',
    ]);
    expect(timelineLabels(dates, 'en').map((l) => l.text)).toEqual(['2025', 'Apr', 'May', '2026']);
  });

  it('太挤时月份先让位；年份之间太近时年份也让位（覆盖作品多的年份优先）', () => {
    const labels = timelineLabels(dates, 'zh'); // 2025@0、4月@2、5月@3、2026@5，共 7 幅
    expect(placeLabels(labels, [0, 20, 60, 100], 34, 7)).toEqual([true, false, true, true]);
    // 两个年份只隔 20px：2025 覆盖 5 幅、2026 覆盖 2 幅，留 2025
    expect(placeLabels(labels, [0, 10, 15, 20], 34, 7)).toEqual([true, false, false, false]);
  });

  it('几万幅、跨几十年：显示出来的标签互不重叠，大部分作品所在的年份一定显示', () => {
    // 1990–2024 每年 10 幅，2025 年 9 万幅；轨道 800px，按下标均匀分布
    const ds: string[] = [];
    for (let y = 1990; y <= 2024; y++) for (let k = 0; k < 10; k++) ds.push(`${y}.01.01`);
    for (let k = 0; k < 90000; k++) ds.push(`2025.${String(1 + Math.floor(k / 7500)).padStart(2, '0')}.01`);
    const labels = timelineLabels(ds, 'zh');
    const xs = labels.map((l) => (l.index / (ds.length - 1)) * 800);
    const show = placeLabels(labels, xs, 34, ds.length);
    const shown = xs.filter((_, i) => show[i]).sort((a, b) => a - b);
    for (let i = 1; i < shown.length; i++) expect(shown[i] - shown[i - 1]).toBeGreaterThanOrEqual(34);
    expect(show[labels.findIndex((l) => l.text === '2025')]).toBe(true);
    expect(labels.filter((l, i) => l.kind === 'year' && show[i]).length).toBeLessThan(5);
  });
});

describe('放大层和卡片交接（2026-11-18）', () => {
  // 卡片圆角 18.87；放大层排版尺寸下 21.56，放大后 scale 0.92（看起来 19.84）；交接时 scale 0.45
  const CARD = 18.87, FRAME = 21.56, S0 = 0.45, S1 = 0.92, MAG_R = FRAME * S1;
  it('mag = 0：屏幕上看起来的圆角和卡片一样（放大层自己的值 × s = 卡片圆角）', () => {
    expect(magFrameRadius(0, 0, S0, CARD, MAG_R) * S0).toBeCloseTo(CARD, 6);
  });
  it('mag = 1：和原来的放大层一样', () => {
    expect(magFrameRadius(1, 0, S1, CARD, MAG_R)).toBeCloseTo(FRAME, 6);
  });
  it('中间直线过渡（看起来的圆角不忽大忽小），全屏归零', () => {
    let prev = -Infinity;
    for (let m = 0; m <= 1.0001; m += 0.1) {
      const s = S0 + (S1 - S0) * m;
      const apparent = magFrameRadius(m, 0, s, CARD, MAG_R) * s;
      expect(apparent).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(apparent).toBeLessThanOrEqual(MAG_R + 1e-9);
      prev = apparent;
    }
    expect(magFrameRadius(1, 1, 1, CARD, MAG_R)).toBe(0);
    expect(magFrameRadius(0, 0, 0, CARD, MAG_R)).toBe(0);
  });
});
