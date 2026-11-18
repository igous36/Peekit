// 2026-11-18：偏好设置（滚轮）
import { describe, it, expect } from 'vitest';
import { DEFAULT_PREFS, parsePrefs, wheelCanToggleFullscreen } from './prefs';

describe('偏好设置', () => {
  it('默认：滚轮推拉镜头（不切换照片），能进入 / 退出全屏——和原来一样', () => {
    expect(DEFAULT_PREFS).toEqual({ wheelFlip: false, wheelFullscreen: true, autoUpdate: true });
    expect(wheelCanToggleFullscreen(DEFAULT_PREFS)).toBe(true);
  });

  it('读存过的：缺的项用默认值，类型不对的忽略', () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs({ wheelFlip: true })).toEqual({ wheelFlip: true, wheelFullscreen: true, autoUpdate: true });
    expect(parsePrefs({ wheelFlip: 'yes', wheelFullscreen: false, autoUpdate: 0 })).toEqual({ wheelFlip: false, wheelFullscreen: false, autoUpdate: true });
  });

  it('滚轮切换照片时不能进出全屏；关掉切换照片后恢复成原来设的值', () => {
    expect(wheelCanToggleFullscreen({ wheelFlip: true, wheelFullscreen: true })).toBe(false);
    expect(wheelCanToggleFullscreen({ wheelFlip: true, wheelFullscreen: false })).toBe(false);
    // 下面这一项单独存着，切换照片关掉以后按它来
    expect(wheelCanToggleFullscreen({ wheelFlip: false, wheelFullscreen: true })).toBe(true);
    expect(wheelCanToggleFullscreen({ wheelFlip: false, wheelFullscreen: false })).toBe(false);
  });
});
