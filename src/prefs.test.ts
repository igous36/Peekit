// 2026-11-18：偏好设置（滚轮）
import { describe, it, expect } from 'vitest';
import { DEFAULT_PREFS, parsePrefs, wheelCanToggleFullscreen } from './prefs';
import { resolveReduced } from './transparency';

describe('偏好设置', () => {
  it('默认：滚轮推拉镜头（不切换照片），能进入 / 退出全屏——和原来一样', () => {
    expect(DEFAULT_PREFS).toEqual({ wheelFlip: false, wheelFullscreen: true, autoUpdate: true, reduceTransparency: null });
    expect(wheelCanToggleFullscreen(DEFAULT_PREFS)).toBe(true);
  });

  it('读存过的：缺的项用默认值，类型不对的忽略', () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs({ wheelFlip: true })).toEqual({ ...DEFAULT_PREFS, wheelFlip: true });
    expect(parsePrefs({ wheelFlip: 'yes', wheelFullscreen: false, autoUpdate: 0 })).toEqual({ ...DEFAULT_PREFS, wheelFullscreen: false });
  });

  it('降低透明度（2026-11-20）：没拨过是 null（跟随系统），拨过记成 true / false', () => {
    expect(parsePrefs({ reduceTransparency: true }).reduceTransparency).toBe(true);
    expect(parsePrefs({ reduceTransparency: false }).reduceTransparency).toBe(false);
    expect(parsePrefs({ reduceTransparency: 'on' }).reduceTransparency).toBeNull();
    expect(resolveReduced(null, true)).toBe(true);
    expect(resolveReduced(null, false)).toBe(false);
    // 拨过就不再跟随系统
    expect(resolveReduced(false, true)).toBe(false);
    expect(resolveReduced(true, false)).toBe(true);
  });

  it('滚轮切换照片时不能进出全屏；关掉切换照片后恢复成原来设的值', () => {
    expect(wheelCanToggleFullscreen({ wheelFlip: true, wheelFullscreen: true })).toBe(false);
    expect(wheelCanToggleFullscreen({ wheelFlip: true, wheelFullscreen: false })).toBe(false);
    // 下面这一项单独存着，切换照片关掉以后按它来
    expect(wheelCanToggleFullscreen({ wheelFlip: false, wheelFullscreen: true })).toBe(true);
    expect(wheelCanToggleFullscreen({ wheelFlip: false, wheelFullscreen: false })).toBe(false);
  });
});
