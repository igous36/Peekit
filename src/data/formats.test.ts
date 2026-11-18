// 2026-11-17：支持 GIF / BMP / TIFF / SVG
import { describe, it, expect } from 'vitest';
import { IMAGE_EXTS, extOf, imageKind, gifMayAnimate, gifCandidates, GIF_ANIM_MAX_BYTES } from './formats';
import { classifyDropped } from './tauri-io';

describe('图片格式', () => {
  it('扩展名：不区分大小写，路径里的点不算', () => {
    expect(extOf('D:\\a.b\\c.TIFF')).toBe('tiff');
    expect(extOf('/x/y/.hidden')).toBe('');
    expect(extOf('noext')).toBe('');
  });

  it('按格式决定怎么显示原图', () => {
    expect(imageKind('a.png')).toBe('web');
    expect(imageKind('a.JPG')).toBe('web');
    expect(imageKind('a.bmp')).toBe('web');
    expect(imageKind('a.gif')).toBe('gif');
    expect(imageKind('a.svg')).toBe('svg');
    expect(imageKind('a.tif')).toBe('convert');
    expect(imageKind('a.tiff')).toBe('convert');
  });

  it('支持的扩展名和 Rust 端一致；拖进来的按扩展名分文件 / 文件夹', () => {
    expect(IMAGE_EXTS).toEqual(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'svg']);
    expect(classifyDropped(['D:\\a.GIF', 'D:\\scans\\b.tiff', 'D:\\art', 'D:\\v1.2']).map((s) => s.kind)).toEqual([
      'file', 'file', 'folder', 'folder',
    ]);
  });
});

describe('GIF 在旁边也动：哪些能动、谁先动（2026-11-17）', () => {
  it('只有不太大的 GIF 能在旁边动；不知道大小时按能动算', () => {
    expect(gifMayAnimate('a.gif', 2_000_000, 800, 600)).toBe(true);
    expect(gifMayAnimate('a.GIF', 0)).toBe(true);
    expect(gifMayAnimate('a.gif', GIF_ANIM_MAX_BYTES + 1, 400, 300)).toBe(false);
    expect(gifMayAnimate('a.gif', 1000, 2000, 2000)).toBe(false);
    expect(gifMayAnimate('a.png', 1000, 400, 300)).toBe(false);
  });

  it('顺序：中间那幅、左右紧挨的、系列视图这一页（拉远时）；再外一圈不动；放大时只有中间那幅', () => {
    expect(gifCandidates(10, [3, 4, 11], 0, 0)).toEqual([10, 9, 11]);
    expect(gifCandidates(10, [3, 4, 11], 1, 0)).toEqual([10, 9, 11, 3, 4]);
    expect(gifCandidates(10, [3, 4], 1, 0.8)).toEqual([10]);
  });
});
