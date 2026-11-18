import { describe, it, expect } from 'vitest';
import {
  keyAction, WheelAccumulator, cameraStep, isWheelNotch, DETENT_HOLD_MS, feedDetent, landDetent, newDetent, levelOf, wheelLanding,
} from './discrete';
import { GESTURE_GAP_MS } from './fszoom';

describe('方向键', () => {
  it('← / → 切换一幅，↑ 拉近，↓ 拉远，Esc 退一级，F11 全屏', () => {
    expect(keyAction('ArrowRight')).toEqual({ kind: 'step', delta: 1 });
    expect(keyAction('ArrowLeft')).toEqual({ kind: 'step', delta: -1 });
    expect(keyAction('ArrowUp')).toEqual({ kind: 'in' });
    expect(keyAction('ArrowDown')).toEqual({ kind: 'out' });
    expect(keyAction('Escape')).toEqual({ kind: 'escape' });
    expect(keyAction('F11')).toEqual({ kind: 'fullscreen' });
    expect(keyAction('Enter')).toBeNull();
    expect(keyAction('Tab')).toBeNull();
  });
});

describe('镜头三级：系列视图 ← 单幅 → 放大（全屏）', () => {
  const single = { zoomT: 0, magT: 0, fsT: 0 };
  const series = { zoomT: 1, magT: 0, fsT: 0 };
  const mag = { zoomT: 0, magT: 1, fsT: 0 };
  const full = { zoomT: 0, magT: 1, fsT: 1 };

  it('拉近：系列视图 → 单幅 → 放大 → 全屏（2026-11-18 起），全屏后不再变', () => {
    expect(cameraStep(series, 'in')).toEqual(single);
    expect(cameraStep(single, 'in')).toEqual(mag);
    expect(cameraStep(mag, 'in')).toEqual(full);
    expect(cameraStep(full, 'in')).toEqual(full);
  });

  it('滚轮落到新的一级之后：单幅、往上落到放大是卡位；进全屏吞掉剩下的；没换级或到底不管', () => {
    expect(levelOf(full)).toBe('fullscreen');
    expect(levelOf(mag)).toBe('magnify');
    expect(wheelLanding(mag, single, 'out')).toBe('detent');
    expect(wheelLanding(series, single, 'in')).toBe('detent');
    expect(wheelLanding(single, mag, 'in')).toBe('detent');
    expect(wheelLanding(mag, full, 'in')).toBe('swallow');
    expect(wheelLanding(single, series, 'out')).toBeNull();
    expect(wheelLanding(full, full, 'in')).toBeNull();
  });

  it('拉远：全屏 / 放大 → 单幅 → 系列视图', () => {
    expect(cameraStep(full, 'out')).toEqual(single);
    expect(cameraStep(mag, 'out')).toEqual(single);
    expect(cameraStep(single, 'out')).toEqual(series);
    expect(cameraStep(series, 'out')).toEqual(series);
  });

  it('Esc 一律回到单幅', () => {
    for (const s of [series, mag, full, single]) expect(cameraStep(s, 'escape')).toEqual(single);
  });
});

describe('触控板 / 滚轮', () => {
  it('横向累计 > 40 才翻一幅，方向跟 deltaX 一致', () => {
    const w = new WheelAccumulator();
    expect(w.feed(20, 0, 0)).toBeNull();
    expect(w.feed(20, 0, 10)).toBeNull(); // 正好 40，还不够
    expect(w.feed(5, 0, 20)).toEqual({ kind: 'step', delta: 1 });
    const back = new WheelAccumulator();
    expect(back.feed(-50, 0, 0)).toEqual({ kind: 'step', delta: -1 });
  });

  it('纵向累计 > 60：向下拉远，向上拉近', () => {
    const w = new WheelAccumulator();
    expect(w.feed(0, 30, 0)).toBeNull();
    expect(w.feed(0, 31, 10)).toEqual({ kind: 'out' });
    const up = new WheelAccumulator();
    expect(up.feed(0, -100, 0)).toEqual({ kind: 'in' });
  });

  it('两次触发至少间隔 380ms，冷却期内的事件直接丢掉', () => {
    const w = new WheelAccumulator();
    expect(w.feed(50, 0, 0)).not.toBeNull();
    expect(w.feed(50, 0, 100)).toBeNull();
    expect(w.feed(50, 0, 379)).toBeNull();
    // 冷却期里的量没有被攒下来：380ms 时重新从 0 累计
    expect(w.feed(30, 0, 380)).toBeNull();
    expect(w.feed(30, 0, 390)).toEqual({ kind: 'step', delta: 1 });
  });

  it('换方向时另一个方向的累计清零', () => {
    const w = new WheelAccumulator();
    expect(w.feed(35, 0, 0)).toBeNull();
    expect(w.feed(0, 10, 10)).toBeNull(); // 纵向为主：横向清零
    expect(w.feed(35, 0, 20)).toBeNull(); // 横向重新从 0 开始，35 不够
  });

  it('鼠标滚轮的一格立刻推拉一级，连滚两格不会被冷却吞掉（系列视图 → 单幅 → 放大）', () => {
    const w = new WheelAccumulator();
    expect(w.feed(0, -100, 0, true)).toEqual({ kind: 'in' });
    expect(w.feed(0, -100, 120, true)).toEqual({ kind: 'in' });
    expect(w.feed(0, 100, 240, true)).toEqual({ kind: 'out' });
    // 触控板照旧：刚触发过，冷却期里的事件丢掉
    expect(w.feed(0, 80, 300)).toBeNull();
    // 鼠标横向（倾斜滚轮）不走这条，按住会自动连发，照旧冷却
    expect(w.feed(100, 0, 320, true)).toBeNull();
  });

  it('单幅卡位：从放大滚回单幅后，这次滚动里多滚的几格只顶一下，不会冲到系列视图', () => {
    const d = newDetent();
    landDetent(d, 1, 0); // 往下滚，从放大回到单幅
    expect(feedDetent(d, 100, 50, true)).toBe(true);
    expect(feedDetent(d, 100, 100, true)).toBe(true);
    expect(feedDetent(d, 100, 200, true)).toBe(true);
  });

  it('单幅卡位：停一下再滚，立刻走一级', () => {
    const d = newDetent();
    landDetent(d, 1, 0);
    expect(feedDetent(d, 100, GESTURE_GAP_MS + 30, true)).toBe(false);
    expect(d.dir).toBe(0);
  });

  it('单幅卡位：鼠标一直不停地滚，顶住最多 DETENT_HOLD_MS，之后下一格过去', () => {
    const d = newDetent();
    landDetent(d, -1, 0); // 往上滚，从系列视图回到单幅
    let t = 0;
    while (t + 100 < DETENT_HOLD_MS) expect(feedDetent(d, -100, (t += 100), true)).toBe(true);
    expect(feedDetent(d, -100, DETENT_HOLD_MS + 20, true)).toBe(false);
  });

  it('单幅卡位：触控板这一划（含惯性）剩下的都顶住，抬手再划才过去', () => {
    const d = newDetent();
    landDetent(d, 1, 0);
    let t = 0;
    for (let i = 0; i < 80; i++) expect(feedDetent(d, 8, (t += 16), false)).toBe(true); // 1.3 秒的惯性
    expect(feedDetent(d, 8, t + 400, false)).toBe(false);
  });

  it('单幅卡位：反方向滚立刻解除；没有卡位时不拦', () => {
    const d = newDetent();
    expect(feedDetent(d, 100, 0, true)).toBe(false);
    landDetent(d, 1, 0);
    expect(feedDetent(d, -100, 50, true)).toBe(false);
    expect(feedDetent(d, 100, 100, true)).toBe(false);
  });

  it('认出鼠标滚轮的一格：wheelDeltaY 是 120 的整数倍，或者按行 / 按页滚动', () => {
    expect(isWheelNotch(0, -120)).toBe(true);
    expect(isWheelNotch(0, 240)).toBe(true);
    expect(isWheelNotch(0, -6)).toBe(false); // 触控板
    expect(isWheelNotch(0, 0)).toBe(false);
    expect(isWheelNotch(0, undefined)).toBe(false);
    expect(isWheelNotch(1, undefined)).toBe(true);
  });
});
