import { describe, it, expect } from 'vitest';
import {
  rubber, lockAxis, dragPosition, pushSample, releasePosition, sampleVelocityX, stageUnit, dragLevel,
  releaseLevel, levelTargets, cameraLevel, magDragSpan, MAG_DRAG_SPAN, type Sample,
} from './gesture';

const U = 8.64; // 1440 × 900 下的 u

describe('锁轴', () => {
  it('6px 以内不锁', () => {
    expect(lockAxis(3, 4)).toBeNull();
    expect(lockAxis(5.9, 0)).toBeNull();
  });
  it('按主方向锁定，相等时算横向', () => {
    expect(lockAxis(10, 3)).toBe('x');
    expect(lockAxis(-3, 10)).toBe('y');
    expect(lockAxis(6, 6)).toBe('x');
  });
});

describe('横向拖动', () => {
  it('u = min(1vh, 0.6vw)', () => {
    expect(stageUnit(1440, 900)).toBeCloseTo(8.64);
    expect(stageUnit(1920, 800)).toBe(8);
  });

  it('1:1 跟手：向左拖 29u 前进一幅', () => {
    expect(dragPosition(3, -29 * U, U, 0, 12)).toBeCloseTo(4);
    expect(dragPosition(3, 29 * U, U, 0, 12)).toBeCloseTo(2);
  });

  it('镜头拉远时同样的拖动距离走得更多（除以镜头缩放）', () => {
    expect(dragPosition(3, -29 * U, U, 1, 12)).toBeCloseTo(3 + 1 / 0.58);
  });

  it('超出首尾用橡皮筋，最多 0.55 幅', () => {
    expect(rubber(0)).toBe(0);
    expect(rubber(1)).toBeCloseTo(0.55 * (1 - 1 / 1.9));
    expect(rubber(1e9)).toBeLessThan(0.55);
    const before = dragPosition(0, 29 * U, U, 0, 12);
    expect(before).toBeCloseTo(-rubber(1));
    const after = dragPosition(11, -29 * U * 2, U, 0, 12);
    expect(after).toBeCloseTo(11 + rubber(2));
  });

  it('只有 1 幅：两个方向都是橡皮筋', () => {
    expect(dragPosition(0, -29 * U, U, 0, 1)).toBeCloseTo(rubber(1));
    expect(dragPosition(0, 29 * U, U, 0, 1)).toBeCloseTo(-rubber(1));
  });
});

describe('松手惯性', () => {
  const samples = (pairs: [number, number][]): Sample[] => pairs.map(([t, p]) => ({ t, p, z: 0 }));

  it('采样只保留最近 100ms，至少 2 个', () => {
    const s: Sample[] = [];
    for (let t = 0; t <= 300; t += 16) pushSample(s, { t, p: t / 100, z: 0 });
    expect(s[s.length - 1].t - s[0].t).toBeLessThanOrEqual(100);
    const two: Sample[] = [];
    pushSample(two, { t: 0, p: 0, z: 0 });
    pushSample(two, { t: 500, p: 1, z: 0 });
    expect(two.length).toBe(2);
  });

  it('速度 = 首尾差 / 时间，时间至少按 16ms 算', () => {
    expect(sampleVelocityX(samples([[0, 3], [100, 3.5]]))).toBeCloseTo(5);
    expect(sampleVelocityX(samples([[0, 3], [0, 3.1]]))).toBeCloseTo(0.1 / 0.016);
  });

  it('慢慢松手：就近吸附', () => {
    expect(releasePosition(samples([[0, 3.3], [100, 3.3]]), 3.3, 12)).toBe(3);
    expect(releasePosition(samples([[0, 3.6], [100, 3.6]]), 3.6, 12)).toBe(4);
  });

  it('快速甩：往前投射 0.18s', () => {
    // 5 幅/秒 × 0.18 = 0.9 → 3.2 + 0.9 = 4.1 → 4
    expect(releasePosition(samples([[0, 2.7], [100, 3.2]]), 3.2, 12)).toBe(4);
  });

  it('投射最多 ±3 幅，并夹在首尾', () => {
    expect(releasePosition(samples([[0, 3], [100, 8]]), 5, 12)).toBe(8);
    expect(releasePosition(samples([[0, 9], [100, 4]]), 4, 12)).toBe(1);
    expect(releasePosition(samples([[0, 9], [100, 11.2]]), 11.2, 12)).toBe(11);
  });
});

describe('纵向：镜头三级（−1 放大 / 0 单幅 / 1 系列视图）', () => {
  const H = 900;
  const zs = (pairs: [number, number][]): Sample[] => pairs.map(([t, z]) => ({ t, p: 0, z }));

  it('向下拖窗口高度的 35% = 拉远到系列视图；向上拖同样距离 = 放大（2026-11-17 新增）', () => {
    expect(dragLevel(0, H * 0.35, H)).toBeCloseTo(1);
    expect(dragLevel(0, H * 0.175, H)).toBeCloseTo(0.5);
    expect(dragLevel(1, -H * 0.35, H)).toBeCloseTo(0);
    expect(dragLevel(0, -H * 0.35, H)).toBeCloseTo(-1);
    expect(dragLevel(-1, H * 0.175, H)).toBeCloseTo(-0.5);
  });

  it('档位和镜头 / 放大的换算', () => {
    expect(levelTargets(0.4)).toEqual({ zoomT: 0.4, magT: 0 });
    expect(levelTargets(-0.4)).toEqual({ zoomT: 0, magT: 0.4 });
    expect(cameraLevel(0, 1)).toBe(-1);
    expect(cameraLevel(1, 0)).toBe(1);
    expect(cameraLevel(0, 0)).toBe(0);
  });

  it('超出 [−1, 1] 用橡皮筋 × 0.4（最多 0.22）', () => {
    expect(dragLevel(1, H * 0.35 * 2, H)).toBeCloseTo(1 + rubber(2) * 0.4);
    expect(dragLevel(-1, -H * 0.35 * 2, H)).toBeCloseTo(-1 - rubber(2) * 0.4);
    expect(dragLevel(1, H * 100, H)).toBeLessThan(1.22);
    expect(dragLevel(-1, -H * 100, H)).toBeGreaterThan(-1.22);
  });

  it('松手：没速度时吸附到最近一档（±0.5 为界）', () => {
    expect(releaseLevel(zs([[0, 0.6], [100, 0.6]]), 0.6, 0)).toBe(1);
    expect(releaseLevel(zs([[0, 0.4], [100, 0.4]]), 0.4, 0)).toBe(0);
    expect(releaseLevel(zs([[0, -0.6], [100, -0.6]]), -0.6, 0)).toBe(-1);
    expect(releaseLevel(zs([[0, -0.4], [100, -0.4]]), -0.4, 0)).toBe(0);
  });

  it('松手：按速度投射 0.15s', () => {
    // 0.3 + 3/秒 × 0.15 = 0.75 → 1
    expect(releaseLevel(zs([[0, 0], [100, 0.3]]), 0.3, 0)).toBe(1);
    // 0.7 − 3/秒 × 0.15 = 0.25 → 0
    expect(releaseLevel(zs([[0, 1], [100, 0.7]]), 0.7, 1)).toBe(0);
    // 向上甩：−0.3 − 3/秒 × 0.15 = −0.75 → 放大
    expect(releaseLevel(zs([[0, 0], [100, -0.3]]), -0.3, 0)).toBe(-1);
  });

  it('一次最多离开起点一档：从系列视图甩得再快也只回到单幅', () => {
    expect(releaseLevel(zs([[0, 1], [100, -0.8]]), -0.8, 1)).toBe(0);
    expect(releaseLevel(zs([[0, -1], [100, 0.8]]), 0.8, -1)).toBe(0);
  });
});

describe('放大查看 / 全屏时的横向拖动（2026-11-17：之前太灵敏，容易切过头）', () => {
  const pairs = (list: [number, number][]): Sample[] => list.map(([t, p]) => ({ t, p, z: 0 }));

  it('一幅 = 窗口宽度的 60%（不小于平时的 29u）', () => {
    expect(magDragSpan(U, 1440)).toBeCloseTo(1440 * MAG_DRAG_SPAN);
    expect(magDragSpan(10, 200)).toBe(290);
    // 1440 宽的窗口：同样划 250px，平时差不多过一幅，放大时只走 0.29 幅
    expect(dragPosition(3, -250, U, 0, 12)).toBeCloseTo(3 + 250 / (29 * U));
    expect(dragPosition(3, -250, U, 0, 12, magDragSpan(U, 1440))).toBeCloseTo(3 + 250 / 864);
  });

  it('松手时一次最多只切到相邻的一幅，甩得再快也不会过头', () => {
    // 100ms 内划过 2 幅：平时投射到 +3，放大时只到下一幅
    const fast = pairs([[0, 3], [100, 5]]);
    expect(releasePosition(fast, 5, 12)).toBe(8);
    expect(releasePosition(fast, 5, 12, 3)).toBe(4);
    expect(releasePosition(pairs([[0, 3], [100, 1]]), 1, 12, 3)).toBe(2);
    // 首尾照样夹住
    expect(releasePosition(pairs([[0, 11], [100, 12]]), 11.4, 12, 11)).toBe(11);
    // 划得不够一半、速度也慢：留在原地
    expect(releasePosition(pairs([[0, 3.15], [100, 3.2]]), 3.2, 12, 3)).toBe(3);
  });
});
