// 导出时读作品图片（2026-11-21）：按要画的尺寸挑图——画得不比缩略图（长边 1600）大就用缩略图，
// 更大才读原图（TIFF / RAW 是显示用大图）；解码时直接缩到要画的大小，几十幅大图也不占太多内存。
// SVG 按要画的尺寸重新栅格化，不会糊。
import type { Work } from './types';
import { imageKind } from './formats';
import type { DrawnImage } from '../view/export-render';

/** 缩略图的长边（Rust 端生成时用的值） */
const THUMB_LONG = 1600;

export interface ExportImageDeps {
  /** 缩略图地址（没有就生成） */
  thumbUrl(w: Work): Promise<string | null>;
  /** 原图地址 */
  originalUrl(w: Work): Promise<string | null>;
}

async function bitmap(url: string, w: number, h: number): Promise<DrawnImage> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const bmp = await createImageBitmap(await res.blob(), {
    resizeWidth: Math.max(1, Math.round(w)), resizeHeight: Math.max(1, Math.round(h)), resizeQuality: 'high', imageOrientation: 'from-image',
  });
  return { img: bmp, close: () => bmp.close() };
}

async function svgImage(url: string): Promise<DrawnImage> {
  // 读成同源的 blob 地址再当图片解码（脚本不会运行，画布也不会被“污染”）
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blobUrl = URL.createObjectURL(new Blob([await res.arrayBuffer()], { type: 'image/svg+xml' }));
  const img = new Image();
  img.decoding = 'async';
  img.src = blobUrl;
  try {
    await img.decode();
  } catch (err) {
    URL.revokeObjectURL(blobUrl);
    throw err;
  }
  return { img, close: () => URL.revokeObjectURL(blobUrl) };
}

/** 读一幅要画成 w × h 的图；读不了返回 null */
export async function loadExportImage(work: Work, w: number, h: number, deps: ExportImageDeps): Promise<DrawnImage | null> {
  if (!work.path || work.broken) return null;
  if (imageKind(work.path) === 'svg') {
    const url = await deps.originalUrl(work);
    return url ? svgImage(url).catch(() => null) : null;
  }
  const big = Math.max(w, h) > THUMB_LONG * 1.05;
  const order = big ? [deps.originalUrl, deps.thumbUrl] : [deps.thumbUrl, deps.originalUrl];
  for (const get of order) {
    const url = await get.call(deps, work).catch(() => null);
    if (!url) continue;
    try {
      return await bitmap(url, w, h);
    } catch {
      /* 换下一个来源 */
    }
  }
  return null;
}
