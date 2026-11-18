// 2026-11-18：全屏时的滚轮缩放
import { describe, it, expect } from 'vitest';
import {
  FIT, EXIT_UNDER, GESTURE_GAP_MS, LANDED_CAP, LAND_HOLD_MS, RUBBER_MAX, ZOOM_PER_PX, clampView, feedWheelGate, landWheelGate,
  maxZoom, newWheelGate, panBy, rubberZoom, swallowAfterExit, wheelPx, zoomAt, zoomPercent,
} from './fszoom';
import { magnifierRect } from './magnify';
import { createMotion } from './motion';
import { stepMotion } from './springs';
import { spring } from '../tokens';

// 2560×1440 的屏幕，适应屏幕时画面 2160×1440（3:2）
const VW = 2560, VH = 1440, BW = 2160, BH = 1440;

/** 屏幕上的点 (sx, sy) 落在画面的哪个相对位置（0–1） */
const imagePoint = (v: { z: number; px: number; py: number }, sx: number, sy: number) => ({
  u: (sx - (VW / 2 + v.px - (BW * v.z) / 2)) / (BW * v.z),
  v: (sy - (VH / 2 + v.py - (BH * v.z) / 2)) / (BH * v.z),
});

describe('全屏滚轮缩放', () => {
  it('以光标为中心：缩放前后光标下是画面上的同一点（画面已经比屏幕大、不受边界限制时）', () => {
    const sx = 1800, sy = 400;
    const before = imagePoint(FIT, sx, sy);
    const v = zoomAt(FIT, 2, sx, sy, BW, BH, VW, VH, 8);
    expect(v.z).toBe(2);
    const after = imagePoint(v, sx, sy);
    expect(after.u).toBeCloseTo(before.u, 6);
    expect(after.v).toBeCloseTo(before.v, 6);
    // 鼠标一格（100px）放大约 32%
    expect(zoomAt(FIT, Math.exp(100 * ZOOM_PER_PX), sx, sy, BW, BH, VW, VH, 8).z).toBeCloseTo(1.32, 2);
  });

  it('刚放大一点、画面还没比屏幕大时，那一边保持居中（和 Windows 照片查看器一样）', () => {
    const v = zoomAt(FIT, 1.1, 2400, 700, BW, BH, VW, VH, 8);
    expect(v.px).toBe(0);
  });

  it('最小缩到适应屏幕、最大到 zMax；缩回适应屏幕时回到正中', () => {
    const big = zoomAt(FIT, 100, 100, 100, BW, BH, VW, VH, 6);
    expect(big.z).toBe(6);
    const back = zoomAt(big, 0.001, 2000, 1000, BW, BH, VW, VH, 6);
    expect(back).toEqual({ z: 1, px: 0, py: 0 });
  });

  it('画面比屏幕小的那一边居中，比屏幕大的那一边边缘不进屏幕', () => {
    // z = 1.1：宽 2376 < 2560 → 横向居中；高 1584 > 1440 → 纵向最多偏 72
    const v = clampView({ z: 1.1, px: 300, py: 500 }, BW, BH, VW, VH);
    expect(v.px).toBe(0);
    expect(v.py).toBeCloseTo(72);
    const p = panBy({ z: 3, px: 0, py: 0 }, -5000, 0, BW, BH, VW, VH);
    expect(p.px).toBeCloseTo(-(BW * 3 - VW) / 2);
  });

  it('橡皮筋：先缩一点点，越往后越难缩', () => {
    expect(rubberZoom(0)).toBe(1);
    const one = rubberZoom(100), two = rubberZoom(200);
    expect(one).toBeLessThan(1);
    expect(1 - one).toBeLessThan(0.04); // 第一格只缩 3% 左右
    expect(two).toBeLessThan(one);
    expect(one - two).toBeLessThan(1 - one); // 第二格缩得比第一格少
    expect(rubberZoom(10000)).toBeGreaterThan(1 - RUBBER_MAX);
  });

  it('一开始就在适应屏幕：往下滚第一格缩一点，第二格退出全屏', () => {
    const g = newWheelGate();
    expect(feedWheelGate(g, 100, 1000, 1)).toBe('rubber');
    expect(feedWheelGate(g, 100, 1150, 1)).toBe('exit');
    expect(EXIT_UNDER).toBe(200);
  });

  it('快速往下一划从放大缩回适应屏幕：这一划剩下的只有橡皮筋，吸收掉惯性', () => {
    const g = newWheelGate();
    let t = 0;
    expect(feedWheelGate(g, 100, (t += 30), 2)).toBe('zoom');
    landWheelGate(g, t); // 这一下缩回了适应屏幕
    const landed = t;
    // 这一划剩下的（每 30ms 一个事件，落地后 LAND_HOLD_MS 内）
    while (t + 30 - landed < LAND_HOLD_MS) expect(feedWheelGate(g, 100, (t += 30), 1)).toBe('rubber');
    expect(g.under).toBeLessThanOrEqual(LANDED_CAP);
  });

  it('落地后停一下再往下滚：不用等缓冲，两格退出', () => {
    const g = newWheelGate();
    landWheelGate(g, 0);
    expect(feedWheelGate(g, 100, GESTURE_GAP_MS + 80, 1)).toBe('rubber');
    expect(feedWheelGate(g, 100, GESTURE_GAP_MS + 230, 1)).toBe('exit');
  });

  it('落地后一直不停地转滚轮：缓冲最长 LAND_HOLD_MS，之后从零累计，两格退出', () => {
    const g = newWheelGate();
    landWheelGate(g, 0);
    let t = 0;
    while (t + 100 < LAND_HOLD_MS) expect(feedWheelGate(g, 100, (t += 100), 1)).toBe('rubber');
    expect(feedWheelGate(g, 100, LAND_HOLD_MS + 10, 1)).toBe('rubber'); // 缓冲结束后第一格
    expect(feedWheelGate(g, 100, LAND_HOLD_MS + 110, 1)).toBe('exit'); // 第二格
  });

  it('往上滚放大会清掉橡皮筋的累计', () => {
    const g = newWheelGate();
    feedWheelGate(g, 100, 0, 1);
    feedWheelGate(g, 100, 50, 1);
    expect(feedWheelGate(g, -100, 100, 1)).toBe('zoom');
    expect(g.under).toBe(0);
  });

  it('滚轮退出全屏后，同一次滚动剩下的事件吞掉；停一下后的新滚动照常，之后的快速滚动也不再吞', () => {
    // 按事件顺序模拟 controller：exitedAt 跟着返回值走
    let exitedAt = 1000, last = 1000;
    const feed = (now: number) => {
      const r = swallowAfterExit(exitedAt, last, now);
      exitedAt = r.exitedAt;
      last = now;
      return r.swallow;
    };
    expect(feed(1030)).toBe(true);
    expect(feed(1180)).toBe(true);
    expect(feed(1250)).toBe(true);
    expect(feed(1250 + GESTURE_GAP_MS + 1)).toBe(false); // 停了一下：新的滚动
    expect(exitedAt).toBe(0);
    expect(feed(1500)).toBe(false); // 新滚动里的快速事件照常
    expect(feed(1520)).toBe(false);
    expect(swallowAfterExit(0, 500, 520).swallow).toBe(false);
    expect(swallowAfterExit(1000, 900, 950).swallow).toBe(false); // 退出之前的事件不算
  });

  it('倍率按原图像素算（100% = 一个原图像素对一个屏幕物理像素）', () => {
    // 原图 4320 宽，适应屏幕时显示 2160 CSS px，像素比 1 → 50%；放大 2 倍 → 100%
    expect(zoomPercent(1, 2160, 4320, 1)).toBe(50);
    expect(zoomPercent(2, 2160, 4320, 1)).toBe(100);
    expect(zoomPercent(1, 2160, 4320, 2)).toBe(100);
    expect(zoomPercent(1.5, 2160, undefined, 1)).toBe(150);
  });

  it('最大倍数：至少 4 倍；原图很大时到原图像素的 4 倍', () => {
    expect(maxZoom(2160, 1000, 1)).toBe(4);
    expect(maxZoom(2160, 8640, 1)).toBeCloseTo(16);
  });

  it('按行 / 按页滚动的鼠标换算成 px', () => {
    expect(wheelPx(3, 1, 900)).toBe(48);
    expect(wheelPx(1, 2, 900)).toBe(900);
    expect(wheelPx(-100, 0, 900)).toBe(-100);
  });

  it('放大层按视图缩放、平移；不传视图时和原来一样', () => {
    const card = { cx: 0, cy: 0, w: 1, h: 1 };
    const fit = magnifierRect(card, 1.5, VW, VH, 1, 1);
    expect(fit).toEqual({ cx: VW / 2, cy: VH / 2, w: BW, h: BH });
    const z = magnifierRect(card, 1.5, VW, VH, 1, 1, { z: 2, px: 100, py: -50 });
    expect(z).toEqual({ cx: VW / 2 + 100, cy: VH / 2 - 50, w: BW * 2, h: BH * 2 });
  });

  it('缩放 / 平移弹簧临界阻尼：不过冲，最后精确停住', () => {
    expect(spring.fsZoom[1]).toBeGreaterThanOrEqual(2 * Math.sqrt(spring.fsZoom[0]) - 0.5);
    const m = createMotion(0);
    m.fzT = 2;
    m.fpxT = 300;
    let peak = 0;
    for (let i = 0; i < 300; i++) {
      const r = stepMotion(m, 1 / 60, { axis: null, dragging: false, feel: spring.settleStandard, navMove: false, avoidGlass: true });
      peak = Math.max(peak, m.fz);
      if (r.settled) break;
    }
    expect(peak).toBeLessThanOrEqual(2.0001);
    expect(m.fz).toBe(2);
    expect(m.fpx).toBe(300);
  });
});

describe('放大 / 全屏时左右切换不触发玻璃避让（2026-11-18）', () => {
  it('avoidGlass = false 时，即使在切换（navMove），玻璃运动系数也不涨', () => {
    const m = createMotion(0);
    m.posT = 1;
    for (let i = 0; i < 20; i++) {
      stepMotion(m, 1 / 60, { axis: null, dragging: false, feel: spring.settleStandard, navMove: true, avoidGlass: false });
    }
    expect(m.mot).toBe(0);
  });
});

describe('放大时继续往上拖进全屏（2026-11-18）', () => {
  it('只算拖过放大那一档的部分；越拉越难拉，到进全屏的门槛时预览约 0.25，最多不到 0.5', async () => {
    const { fsPull, fsPreview, FS_PULL_ENTER, FS_PREVIEW_MAX, ZOOM_DRAG_SPAN } = await import('./gesture');
    const vh = 1000;
    expect(fsPull(-1, 0, vh)).toBe(0);
    expect(fsPull(-1, 100, vh)).toBe(0); // 往下拖
    expect(fsPull(-1, -vh * ZOOM_DRAG_SPAN * 0.3, vh)).toBeCloseTo(0.3);
    expect(fsPull(0, -vh * ZOOM_DRAG_SPAN * 0.5, vh)).toBe(0); // 从单幅出发还没到放大
    expect(fsPreview(0)).toBe(0);
    expect(fsPreview(FS_PULL_ENTER)).toBeGreaterThan(0.2);
    expect(fsPreview(FS_PULL_ENTER)).toBeLessThan(0.3);
    expect(fsPreview(100)).toBeLessThan(FS_PREVIEW_MAX);
    expect(FS_PREVIEW_MAX).toBeLessThan(0.5);
  });
});
