import { describe, it, expect } from 'vitest';
import { createMotion, type Motion } from './motion';
import { stepMotion, clampDt, type StepOptions, type Spring } from './springs';
import { spring } from '../tokens';

const FRAME = 1 / 60;

const rest = (feel: Spring = spring.settleStandard): StepOptions => ({
  axis: null, dragging: false, feel, navMove: false, avoidGlass: true,
});

/** 跑到静止或超时，返回帧数和过程中 pos 的最大值 */
function run(m: Motion, o: StepOptions, maxFrames = 600): { frames: number; peak: number; settled: boolean } {
  let peak = m.pos;
  for (let i = 1; i <= maxFrames; i++) {
    const r = stepMotion(m, FRAME, o);
    o.navMove = r.navMove;
    peak = Math.max(peak, m.pos);
    if (r.settled) return { frames: i, peak, settled: true };
  }
  return { frames: maxFrames, peak, settled: false };
}

describe('§6 弹簧', () => {
  it('dt 夹在 [0.001, 1/30]', () => {
    expect(clampDt(0)).toBe(0.001);
    expect(clampDt(0.5)).toBeCloseTo(1 / 30);
    expect(clampDt(0.01)).toBe(0.01);
  });

  it('落位 · 标准（170/22）带一点回弹，最后精确停在目标', () => {
    const m = createMotion(0);
    m.posT = 1;
    const r = run(m, rest());
    expect(r.settled).toBe(true);
    expect(r.peak).toBeGreaterThan(1.001);
    expect(r.peak).toBeLessThan(1.05);
    expect(m.pos).toBe(1);
    expect(m.posV).toBe(0);
  });

  it('落位 · 柔和（120/22）和减少动态效果（300/35）不回弹', () => {
    for (const feel of [spring.settleSoft, spring.reducedMotion]) {
      const m = createMotion(0);
      m.posT = 1;
      const r = run(m, rest(feel));
      expect(r.settled).toBe(true);
      expect(r.peak).toBeLessThanOrEqual(1.0001);
    }
  });

  it('落位 · 灵敏（300/28）比标准更快到位', () => {
    const time = (feel: Spring) => {
      const m = createMotion(0);
      m.posT = 1;
      let i = 0;
      while (Math.abs(m.pos - 1) > 0.02 && i < 600) {
        stepMotion(m, FRAME, rest(feel));
        i++;
      }
      return i;
    };
    expect(time(spring.settleSnappy)).toBeLessThan(time(spring.settleStandard));
  });

  it('镜头推拉比横向略慢（k × 0.85）', () => {
    const m = createMotion(0);
    m.posT = 1;
    m.zoomT = 1;
    for (let i = 0; i < 12; i++) stepMotion(m, FRAME, rest());
    expect(m.zoom).toBeLessThan(m.pos);
  });

  it('跟手弹簧（900/60，临界阻尼）在拖动时只抹掉抖动：不回弹，0.25s 内贴上目标', () => {
    const m = createMotion(0);
    m.posT = 1;
    const o: StepOptions = { ...rest(), axis: 'x', dragging: true };
    let peak = 0;
    for (let i = 0; i < 15; i++) {
      stepMotion(m, FRAME, o);
      peak = Math.max(peak, m.pos);
    }
    expect(peak).toBeLessThanOrEqual(1);
    expect(Math.abs(m.pos - 1)).toBeLessThan(0.01);
  });

  it('按压：锁轴后缩向 1（画作缩小 3.5%），松手弹回 0', () => {
    const m = createMotion(0);
    const drag: StepOptions = { ...rest(), axis: 'x', dragging: true };
    for (let i = 0; i < 60; i++) stepMotion(m, FRAME, drag);
    expect(m.press).toBeCloseTo(1, 2);
    const r = run(m, rest());
    expect(r.settled).toBe(true);
    expect(m.press).toBe(0);
  });

  it('按着不动（还没锁轴）时循环不停', () => {
    const m = createMotion(0);
    const r = stepMotion(m, FRAME, { ...rest(), dragging: true });
    expect(r.settled).toBe(false);
  });

  it('全部静止后报告 settled', () => {
    const m = createMotion(3);
    expect(stepMotion(m, FRAME, rest()).settled).toBe(true);
  });

  it('指针位置每帧插值 14%', () => {
    const m = createMotion(0);
    m.oxT = 10;
    stepMotion(m, FRAME, rest());
    expect(m.ox).toBeCloseTo(1.4, 5);
  });
});

describe('放大查看 / 全屏的弹簧（2026-11-17 新增）', () => {
  it('临界阻尼：放大到 1 不过冲（图片不会冲出窗口再弹回），约 0.4s 基本到位，最后精确停住', () => {
    const m = createMotion(0);
    m.magT = 1;
    m.fsT = 1;
    let peak = 0;
    let at = -1;
    for (let i = 1; i <= 300; i++) {
      const r = stepMotion(m, FRAME, rest());
      peak = Math.max(peak, m.mag, m.fs);
      if (at < 0 && m.mag > 0.98) at = i;
      if (r.settled) break;
    }
    expect(peak).toBeLessThanOrEqual(1);
    expect(at).toBeGreaterThan(0);
    expect(at / 60).toBeLessThan(0.45);
    expect(m.mag).toBe(1);
    expect(m.fs).toBe(1);
  });

  it('放大没停稳时循环不停', () => {
    const m = createMotion(0);
    m.magT = 1;
    expect(stepMotion(m, FRAME, rest()).settled).toBe(false);
  });
});

describe('§7.2 玻璃运动系数 mot', () => {
  it('横向拖动时升到接近 1', () => {
    const m = createMotion(0);
    const o: StepOptions = { ...rest(), axis: 'x', dragging: true };
    for (let i = 0; i < 30; i++) stepMotion(m, FRAME, o);
    expect(m.mot).toBeGreaterThan(0.99);
  });

  it('一松手立刻开始合拢，约 0.25s 基本复原', () => {
    const m = createMotion(0);
    m.mot = 1;
    for (let i = 0; i < 15; i++) stepMotion(m, FRAME, rest()); // 0.25s
    expect(m.mot).toBeLessThan(0.07);
  });

  it('点击切换（navMove）时也让开，离目标 ≤ 0.15 时结束', () => {
    const m = createMotion(0);
    m.posT = 3;
    const o: StepOptions = { ...rest(), navMove: true };
    let maxMot = 0;
    let ended = -1;
    for (let i = 0; i < 120; i++) {
      const r = stepMotion(m, FRAME, o);
      maxMot = Math.max(maxMot, m.mot);
      if (o.navMove && !r.navMove) ended = i;
      o.navMove = r.navMove;
    }
    expect(maxMot).toBeGreaterThan(0.9);
    expect(ended).toBeGreaterThan(0);
  });

  it('减少动态效果：玻璃不避让', () => {
    const m = createMotion(0);
    const o: StepOptions = { ...rest(), axis: 'x', dragging: true, avoidGlass: false };
    for (let i = 0; i < 30; i++) stepMotion(m, FRAME, o);
    expect(m.mot).toBe(0);
  });
});

describe('缩略图换页入场（2026-11-17 新增）', () => {
  it('换页时归零，弹回 1 后精确停住；没回到 1 时循环不停', () => {
    const m = createMotion(0, 1);
    m.pg = 0;
    expect(stepMotion(m, FRAME, rest()).settled).toBe(false);
    const r = run(m, rest());
    expect(r.settled).toBe(true);
    expect(m.pg).toBe(1);
    expect(m.pgV).toBe(0);
  });
});
