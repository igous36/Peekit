import { describe, it, expect } from 'vitest';
import {
  paintingAt, collectSinker, tileAvoid, tileCenter, tileEdgeFade, TILE_HALF, GRID_W, GRID_H,
  thumbAt, indicator, currentOf, infoSlide, artSize, thumbSize, shadowWeights, tileNeedsBackdrop, needsOriginalFor,
  thumbCaps, thumbPage, cameraScale, THUMB_EDGE_PX, THUMB_INFO_GAP_PX,
  type Sinker, type PaintingInput, type ArtSize,
} from './mapping';
import { stage } from '../tokens';

const still: PaintingInput = { press: 0, pxN: 0, pyN: 0, vel: 0 };

describe('§7.1 画作映射', () => {
  it('中间一幅：原位、原大、不透明、无模糊、最上层', () => {
    const p = paintingAt(0, still)!;
    expect(p.x).toBe(0);
    expect(p.y).toBe(0);
    expect(p.s).toBe(1);
    expect(p.opacity).toBe(1);
    expect(p.blur).toBe(0);
    expect(p.brightness).toBe(1);
    expect(p.z).toBe(60);
    expect(p.sh).toBeCloseTo(0.3);
    expect(p.front).toBe(true);
  });

  it('左右各一幅：x = ±29，缩到 0.74，朝中间转 10°', () => {
    const r = paintingAt(1, still)!;
    const l = paintingAt(-1, still)!;
    expect(r.x).toBe(29);
    expect(l.x).toBe(-29);
    expect(r.s).toBeCloseTo(0.74);
    expect(r.ry).toBeCloseTo(-10);
    expect(l.ry).toBeCloseTo(10);
    expect(r.z).toBe(40);
  });

  it('|d| = 1.5 刚好进玻璃后：透明度 0.8、模糊 6px、z 降到 3', () => {
    const front = paintingAt(1.4999, still)!;
    const back = paintingAt(1.5, still)!;
    expect(front.front).toBe(true);
    expect(front.opacity).toBeCloseTo(0.8, 3);
    expect(front.blur).toBeCloseTo(6, 2);
    expect(back.front).toBe(false);
    expect(back.opacity).toBeCloseTo(0.8);
    expect(back.blur).toBe(6);
    expect(back.z).toBe(3);
    expect(back.behind).toBe(1);
  });

  it('|d| = 2.45 时完全透明，> 2.65 不渲染', () => {
    expect(paintingAt(2.45, still)!.opacity).toBeCloseTo(0, 6);
    expect(paintingAt(2.65, still)).not.toBeNull();
    expect(paintingAt(2.651, still)).toBeNull();
    expect(paintingAt(-2.651, still)).toBeNull();
  });

  it('按压只缩最终尺寸，不改玻璃避让用的外框', () => {
    const a = paintingAt(0, still)!;
    const b = paintingAt(0, { ...still, press: 1 })!;
    expect(b.s).toBeCloseTo(0.965);
    expect(b.hw).toBe(a.hw);
    expect(b.hh).toBe(a.hh);
  });

  it('两层阴影的权重叠加后正好等于 §7.1 的阴影强度 sh', () => {
    for (let a = 0; a <= 2.6; a += 0.01) {
      const w = shadowWeights(a);
      const p = paintingAt(a, still)!;
      expect(0.3 * w.center + 0.16 * w.side).toBeCloseTo(p.sh, 9);
    }
  });

  it('速度倾斜夹在 ±12°', () => {
    expect(paintingAt(0, { ...still, vel: 100 })!.ry).toBe(-12);
    expect(paintingAt(0, { ...still, vel: -100 })!.ry).toBe(12);
  });

  it('前景最多 3 幅', () => {
    for (let pos = 0; pos <= 11; pos += 0.01) {
      let front = 0;
      for (let i = 0; i < 12; i++) if (paintingAt(i - pos, still)?.front) front++;
      expect(front).toBeLessThanOrEqual(3);
    }
  });
});

describe('卡片跟随画作比例', () => {
  const area = (a: ArtSize) => a.w * a.h;

  it('4:5 正好是规范的 44.8 × 56；没有尺寸时也按 4:5', () => {
    expect(artSize(0.8).w).toBeCloseTo(44.8);
    expect(artSize(0.8).h).toBeCloseTo(56);
    expect(artSize(undefined)).toEqual(artSize(0.8));
    expect(artSize(NaN)).toEqual(artSize(0.8));
    expect(artSize(0)).toEqual(artSize(0.8));
  });

  it('其他比例：保持比例，面积不超过 4:5，限制在 64 × 56 以内', () => {
    for (const r of [0.2, 0.5, 2 / 3, 1, 4 / 3, 1.5, 16 / 9, 3, 10]) {
      const a = artSize(r);
      expect(a.w / a.h).toBeCloseTo(r);
      expect(a.w).toBeLessThanOrEqual(64 + 1e-9);
      expect(a.h).toBeLessThanOrEqual(56 + 1e-9);
      expect(area(a)).toBeLessThanOrEqual(area(artSize(0.8)) + 1e-6);
    }
    // 方图和 3:2 横图面积和 4:5 一样（没碰到上限）
    expect(area(artSize(1))).toBeCloseTo(area(artSize(0.8)));
    expect(area(artSize(1.5))).toBeCloseTo(area(artSize(0.8)));
    // 16:9 碰到宽度上限
    expect(artSize(16 / 9).w).toBeCloseTo(64);
  });

  it('原图只在需要时加载：小图总是换；大图只在屏幕需要的像素超过缩略图时换', () => {
    // 1440×900、150% 缩放：4:5 卡片高 56u ≈ 726 物理像素
    expect(needsOriginalFor(1200, 1500, 1440, 900, 1.5)).toBe(true); // 原图 ≤ 1600
    expect(needsOriginalFor(2480, 3508, 1440, 900, 1.5)).toBe(false); // A4 300dpi：缩略图足够
    expect(needsOriginalFor(9504, 5344, 1440, 900, 1.5)).toBe(false); // 50MP 照片
    // 4K 屏最大化（3840×2160 逻辑像素 @150%）：卡片约 1814 物理像素 > 1600，要换原图
    expect(needsOriginalFor(2480, 3508, 3840, 2160, 1.5)).toBe(true);
    expect(needsOriginalFor(undefined, undefined, 1440, 900, 1)).toBe(true);
  });

  it('缩略图按比例完整放进 21 × 26', () => {
    expect(thumbSize(0.8)).toEqual({ w: 26 * 0.8, h: 26 });
    expect(thumbSize(2)).toEqual({ w: 21, h: 10.5 });
    expect(thumbSize(0.5)).toEqual({ w: 13, h: 26 });
  });

  it('外框跟着卡片尺寸走（玻璃避让用）', () => {
    const wide = paintingAt(1.5, still, artSize(16 / 9))!;
    const tall = paintingAt(1.5, still, artSize(0.5))!;
    expect(wide.hw).toBeGreaterThan(tall.hw);
    expect(wide.hh).toBeLessThan(tall.hh);
  });
});

describe('§3 玻璃网格', () => {
  it('总尺寸 125.6 × 78.2，中心对称', () => {
    expect(GRID_W).toBeCloseTo(125.6);
    expect(GRID_H).toBeCloseTo(78.2);
    expect(tileCenter(0, 0).tx).toBeCloseTo(-tileCenter(7, 4).tx);
    expect(tileCenter(0, 0).ty).toBeCloseTo(-tileCenter(7, 4).ty);
  });

  it('边缘淡出：中间不透明，四角 50%', () => {
    expect(tileEdgeFade(3, 2)).toBe(1);
    expect(tileEdgeFade(0, 0)).toBe(0.5);
    expect(tileEdgeFade(7, 4)).toBe(0.5);
  });

  it('mot = 0 时玻璃不动', () => {
    const sk: Sinker[] = [{ x: 0, y: 0, hw: 22.4, hh: 28, k: 1 }];
    expect(tileAvoid(0, 0, sk, 0).f).toBe(0);
  });
});

/**
 * HANDOFF §7.2 的检查：mot = 1 时 pos 从 0 扫到 n−1（步长 0.01），
 * 任何玻璃格（按 scale(1 − f) 绕 transform-origin 缩小之后）都不能和可见的玻璃后画作重叠。
 * “可见”取透明度 ≥ 0.05：|d| 在 2.4–2.45 之间画作透明度不到 0.05，玻璃此时已经开始合拢。
 */
describe('§7.2 玻璃避让', () => {
  const n = 12;
  const VISIBLE = 0.05;
  const EPS = 1e-6;

  it('mot = 1 扫一遍：没有玻璃格盖在可见的玻璃后画作上', () => {
    expect(sweep(1)).toEqual([]);
  });

  it('反证：mot = 0（玻璃不让）时同样的检查会报重叠，说明检查本身有效', () => {
    expect(sweep(0).length).toBeGreaterThan(0);
  });

  it('卡片跟随画作比例时同样成立（竖长、方、横、超宽混排）', () => {
    const aspects = [0.5, 1, 16 / 9, 0.8, 3, 2 / 3, 1.5, 0.3, 1, 4 / 3, 0.75, 2.4];
    expect(sweep(1, aspects.map((r) => artSize(r)))).toEqual([]);
  });

  function sweep(mot: number, arts?: ArtSize[]): string[] {
    const failures: string[] = [];
    for (let step = 0; step <= (n - 1) * 100; step++) {
      const pos = step / 100;
      const sinkers: Sinker[] = [];
      const behind: { x: number; y: number; hw: number; hh: number; i: number }[] = [];
      for (let i = 0; i < n; i++) {
        const p = paintingAt(i - pos, still, arts?.[i]);
        if (!p) continue;
        collectSinker(p, sinkers);
        if (!p.front && p.opacity >= VISIBLE) behind.push({ x: p.x, y: p.y, hw: p.hw, hh: p.hh, i });
      }
      for (let r = 0; r < stage.gridRows; r++) {
        for (let c = 0; c < stage.gridCols; c++) {
          const { tx, ty } = tileCenter(c, r);
          const a = tileAvoid(tx, ty, sinkers, mot);
          const k = 1 - a.f;
          // 缩放原点（u）
          const px = tx - TILE_HALF + (a.ox / 100) * stage.tile;
          const py = ty - TILE_HALF + (a.oy / 100) * stage.tile;
          const x0 = px + (tx - TILE_HALF - px) * k, x1 = px + (tx + TILE_HALF - px) * k;
          const y0 = py + (ty - TILE_HALF - py) * k, y1 = py + (ty + TILE_HALF - py) * k;
          for (const b of behind) {
            const ox = Math.min(x1, b.x + b.hw) - Math.max(x0, b.x - b.hw);
            const oy = Math.min(y1, b.y + b.hh) - Math.max(y0, b.y - b.hh);
            if (ox > EPS && oy > EPS) failures.push(`pos=${pos} 格(${c},${r}) 盖住第 ${b.i} 幅`);
          }
        }
      }
    }
    return failures.slice(0, 5);
  }

  it('背景模糊只开在玻璃后画作附近的格子上（其余格子背后只有纯色背景）', () => {
    // 默认布局 pos = 3：玻璃后的两幅在 x = ±49
    const behindRects = [-2, 2].map((d) => {
      const p = paintingAt(d, still)!;
      return { x: p.x, y: p.y, hw: p.hw, hh: p.hh };
    });
    const margin = (22 + 6) / 8.64 + 1;
    let on = 0;
    for (let r = 0; r < stage.gridRows; r++) {
      for (let c = 0; c < stage.gridCols; c++) {
        const { tx, ty } = tileCenter(c, r);
        if (tileNeedsBackdrop(tx, ty, behindRects, margin)) on++;
      }
    }
    expect(on).toBeGreaterThan(0);
    expect(on).toBeLessThan(40);
    // 中间两列背后没有玻璃后的画作
    expect(tileNeedsBackdrop(tileCenter(3, 2).tx, tileCenter(3, 2).ty, behindRects, margin)).toBe(false);
    // 没有玻璃后画作时（比如空状态）一格都不用模糊
    expect(tileNeedsBackdrop(0, 0, [], margin)).toBe(false);
  });

  it('缩放原点放在背离画作的一侧', () => {
    const sk: Sinker[] = [{ x: 0, y: 0, hw: 10, hh: 10, k: 1 }];
    const right = tileAvoid(15, 0, sk, 1);
    const left = tileAvoid(-15, 0, sk, 1);
    expect(right.ox).toBeGreaterThan(50);
    expect(left.ox).toBeLessThan(50);
  });
});

describe('其他映射', () => {
  it('当前序号和偏离量', () => {
    expect(currentOf(3, 12)).toEqual({ cur: 3, frac: 0 });
    expect(currentOf(3.4, 12).cur).toBe(3);
    expect(currentOf(3.4, 12).frac).toBeCloseTo(0.4);
    expect(currentOf(-0.3, 12)).toEqual({ cur: 0, frac: 0 });
    expect(currentOf(11.3, 12)).toEqual({ cur: 11, frac: 0 });
  });

  it('信息卡内容跟着拖动滑走', () => {
    const s = infoSlide(0.5);
    expect(s.tx).toBe(-14);
    expect(s.opacity).toBeCloseTo(0.15);
  });

  it('时间轴指示条：位置按 pos/(n−1)，宽度 22–48px', () => {
    expect(indicator(0, 12, 0)).toEqual({ left: 0, width: 22 });
    expect(indicator(11, 12, 0).left).toBe(1);
    expect(indicator(5, 12, 100).width).toBe(48);
    expect(indicator(0, 1, 0).left).toBe(0.5);
  });

  it('缩略图：zoom = 0 不可见，zoom = 1 到位（y = ±47，scale 1，无模糊）', () => {
    expect(thumbAt(0, 4, 0, 1, false).opacity).toBe(0);
    const top = thumbAt(0, 4, 1, 1, false);
    const bottom = thumbAt(3, 4, 1, 1, false);
    expect(top.y).toBeCloseTo(-47);
    expect(bottom.y).toBeCloseTo(47);
    expect(top.s).toBeCloseTo(1);
    expect(top.blur).toBeCloseTo(0);
    // 每排居中，中心距 25
    expect(thumbAt(0, 4, 1, 1, false).x).toBe(-12.5);
    expect(thumbAt(1, 4, 1, 1, false).x).toBe(12.5);
  });
});

describe('系列缩略图分页（2026-11-17：系列作品多时缩略图显示不出来）', () => {
  // 1440 × 900，信息卡左边在 1116（right 24 + 宽 300）
  const caps = thumbCaps(1440, 900, 1116);

  it('每排容量：上排躲开信息卡，下排最多比上排多 2 张，都不出窗口', () => {
    expect(caps).toEqual({ top: 6, bottom: 8 });
    const u = 8.64, cs = cameraScale(1);
    const spacing = 25 * u * cs, half = (stage.thumbW / 2) * 1.05 * u * cs;
    expect(720 + ((caps.top - 1) / 2) * spacing + half).toBeLessThanOrEqual(1116 - THUMB_INFO_GAP_PX);
    expect(720 + ((caps.bottom - 1) / 2) * spacing + half).toBeLessThanOrEqual(1440 - THUMB_EDGE_PX);
    // 窄窗口也至少各放 1 张
    const tiny = thumbCaps(400, 600, 100);
    expect(tiny.top).toBeGreaterThanOrEqual(1);
    expect(tiny.bottom).toBeGreaterThanOrEqual(1);
  });

  it('放得下：一页全显示，上排一半（和原型一致）', () => {
    const p = thumbPage([0, 3, 5, 9, 12], 5, caps);
    expect(p).toEqual({ items: [0, 3, 9, 12], top: 2, page: 0, pages: 1 });
  });

  it('放不下：按 上排 + 下排 一页切开，默认显示当前那幅所在的页（当前那幅不占位置）', () => {
    const series = Array.from({ length: 40 }, (_, i) => i * 2);
    const per = caps.top + caps.bottom; // 14
    const p0 = thumbPage(series, series[3], caps);
    expect(p0.pages).toBe(Math.ceil(40 / per));
    expect(p0.page).toBe(0);
    expect(p0.items.length).toBe(per - 1);
    expect(p0.items).not.toContain(series[3]);
    const p2 = thumbPage(series, series[30], caps);
    expect(p2.page).toBe(2);
    expect(p2.items[0]).toBe(series[28]);
    // 手动翻页：不含当前那幅的页显示满 per 张，上排不超过容量
    const manual = thumbPage(series, series[3], caps, 1);
    expect(manual.page).toBe(1);
    expect(manual.items).toEqual(series.slice(per, per * 2));
    expect(manual.top).toBeLessThanOrEqual(caps.top);
    expect(manual.items.length - manual.top).toBeLessThanOrEqual(caps.bottom);
    expect(thumbPage(series, series[3], caps, 99).page).toBe(p0.pages - 1);
  });

  it('上排张数可以指定；一排很多时依次出现的间隔压缩，镜头拉到底每张都完全出现', () => {
    expect(thumbAt(2, 8, 1, 1, false, 3).y).toBeCloseTo(-47);
    expect(thumbAt(3, 8, 1, 1, false, 3).y).toBeCloseTo(47);
    for (let k = 0; k < 16; k++) expect(thumbAt(k, 16, 1, 1, false, 8).e).toBeGreaterThan(0.99);
    // 少的时候还是原型的每张 0.08
    expect(thumbAt(1, 4, 0.5, 1, false).e).toBeCloseTo(1 - Math.pow(1 - (0.5 - 0.12 - 0.08) / 0.55, 3));
  });
});
