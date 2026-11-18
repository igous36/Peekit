// 支持的图片格式（2026-11-17 起加 GIF / BMP / TIFF / SVG）。和 Rust 端 scan.rs 的 IMAGE_EXTS 一致。
//
// 不同格式在界面里的显示方式不一样：
// - web：PNG / JPG / WebP / BMP，界面（WebView2）能直接显示原图，放大查看时停 300ms 换原图
// - gif：同上，而且停在它上面时总是换原图，让动图动起来（缩略图是第一帧）
// - svg：矢量原图本身就当缩略图用，多大都清晰，不需要再换“原图”
// - convert：TIFF，界面不能直接显示；放大查看 / 复制图像时由 Rust 端生成显示用大图（make_display）

export const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'svg'];

export type ImageKind = 'web' | 'gif' | 'svg' | 'convert';

export function extOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function imageKind(path: string): ImageKind {
  const ext = extOf(path);
  if (ext === 'gif') return 'gif';
  if (ext === 'svg') return 'svg';
  if (ext === 'tif' || ext === 'tiff') return 'convert';
  return 'web';
}

// ───────────── 不是主预览图的 GIF 也动起来（2026-11-17） ─────────────
//
// 舞台两侧的画作、系列视图的缩略图里的 GIF 也播放动画，但要控制开销：
// - 同时最多 GIF_ANIM_BUDGET 个在动，按“中间那幅 → 左右紧挨的 → 系列视图这一页 → 再外一圈”的顺序分配；
// - 太大的 GIF（文件 > 8MB 或画面 > 1600×1600 的像素数）不在旁边动，只在停到它上面时作为主预览图动；
// - 系统开了“减少动态效果”时，旁边的都不动；
// - 放大查看 / 全屏时旁边的画作看不见，只有中间那幅动；
// - 动图要先解码好第一帧再换上（换之前显示静态缩略图），不会闪。
// 动画本身由浏览器播放，不占用我们的 rAF 循环；窗口最小化 / 看不见的元素浏览器会自己暂停。

export const GIF_ANIM_BUDGET = 8;
export const GIF_ANIM_MAX_BYTES = 8 * 1024 * 1024;
export const GIF_ANIM_MAX_PIXELS = 1600 * 1600;

/** 这幅 GIF 能不能在“不是主预览图”的位置动（bytes / 宽高不知道时按能动算） */
export function gifMayAnimate(path: string, bytes: number, width?: number, height?: number): boolean {
  if (imageKind(path) !== 'gif') return false;
  if (bytes > GIF_ANIM_MAX_BYTES) return false;
  if (width && height && width * height > GIF_ANIM_MAX_PIXELS) return false;
  return true;
}

/**
 * 这一帧里哪些位置的 GIF 可以动，按优先级排好（下标，可能越界，调用方跳过）：
 * 中间那幅；放大查看时只有它。否则依次是左右紧挨的两幅、系列视图这一页的缩略图（拉远时）。
 * 再往外的画作大半沉在玻璃后面、几乎看不清，动起来只是白白重算玻璃的背景模糊，不动（2026-11-17 掉帧后收紧）
 */
export function gifCandidates(cur: number, pageItems: readonly number[], zoom: number, mag: number): number[] {
  if (mag >= 0.5) return [cur];
  const out = [cur, cur - 1, cur + 1];
  if (zoom > 0.01) out.push(...pageItems);
  return [...new Set(out)];
}
