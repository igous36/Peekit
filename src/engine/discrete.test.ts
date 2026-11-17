import { describe, it, expect } from 'vitest';
import { keyAction, WheelAccumulator } from './discrete';

describe('方向键', () => {
  it('← / → 切换一幅，↓ 拉远，↑ / Esc 推回', () => {
    expect(keyAction('ArrowRight')).toEqual({ kind: 'step', delta: 1 });
    expect(keyAction('ArrowLeft')).toEqual({ kind: 'step', delta: -1 });
    expect(keyAction('ArrowDown')).toEqual({ kind: 'zoom', target: 1 });
    expect(keyAction('ArrowUp')).toEqual({ kind: 'zoom', target: 0 });
    expect(keyAction('Escape')).toEqual({ kind: 'zoom', target: 0 });
    expect(keyAction('Enter')).toBeNull();
    expect(keyAction('Tab')).toBeNull();
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

  it('纵向累计 > 60：向下拉远，向上推回', () => {
    const w = new WheelAccumulator();
    expect(w.feed(0, 30, 0)).toBeNull();
    expect(w.feed(0, 31, 10)).toEqual({ kind: 'zoom', target: 1 });
    const up = new WheelAccumulator();
    expect(up.feed(0, -100, 0)).toEqual({ kind: 'zoom', target: 0 });
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
});
