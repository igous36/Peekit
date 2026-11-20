// 2026-11-20：画师自检（翻转 / 灰度 / 模糊）
import { describe, it, expect } from 'vitest';
import { NO_CHECKS, anyCheck, checkFromKey, toggleCheck } from './checks';

describe('画师自检', () => {
  it('H 翻转、G 灰度、B 模糊，大小写都行；别的键不管', () => {
    expect(checkFromKey('h')).toBe('flip');
    expect(checkFromKey('H')).toBe('flip');
    expect(checkFromKey('g')).toBe('gray');
    expect(checkFromKey('b')).toBe('blur');
    for (const k of ['x', '1', 'Home', 'Backspace', '']) expect(checkFromKey(k)).toBeNull();
  });

  it('切换一项不影响别的，也不改原来的状态', () => {
    const a = toggleCheck(NO_CHECKS, 'gray');
    expect(a).toEqual({ flip: false, gray: true, blur: false });
    expect(NO_CHECKS.gray).toBe(false);
    expect(anyCheck(a)).toBe(true);
    expect(anyCheck(toggleCheck(a, 'gray'))).toBe(false);
  });
});
