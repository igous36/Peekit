// 和 Rust 端打交道：扫描、缩略图、选择文件 / 文件夹、拖放。只在 Tauri 里用。
import { invoke, convertFileSrc, isTauri } from '@tauri-apps/api/core';
import type { ScanItem, Source } from './library';
import { t } from '../i18n';
import { IMAGE_EXTS, extOf } from './formats';

export { IMAGE_EXTS };

export interface ScanResult {
  items: ScanItem[];
  missing: string[];
}

export function scanSources(sources: Source[], known: Record<string, unknown>): Promise<ScanResult> {
  return invoke<ScanResult>('scan_sources', { sources, known });
}

export function makeThumbnail(path: string, mtime: number, size: number): Promise<{ path: string; color: string | null }> {
  return invoke('make_thumbnail', { path, mtime, size });
}

/** 本地文件 → asset 协议 URL */
export const assetUrl = (path: string): string => convertFileSrc(path);

/** 系统全屏：不管窗口是否最大化，都统一进入全屏；退出后恢复原来的窗口状态 */
export async function setWindowFullscreen(on: boolean): Promise<void> {
  if (isTauri()) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().setFullscreen(on);
    return;
  }
  // 浏览器调试：用 Fullscreen API
  if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen?.();
  if (!on && document.fullscreenElement) await document.exitFullscreen();
}

/** 把前端错误打到运行 tauri dev 的终端里 */
export function logError(msg: string): void {
  void invoke('log_error', { msg }).catch(() => {});
}

/** 图片加载失败时诊断：再请求一次，记下状态码和返回内容 */
export async function diagnoseImage(url: string): Promise<void> {
  try {
    const r = await fetch(url);
    const body = r.ok ? `${(await r.blob()).size} bytes` : (await r.text()).slice(0, 200);
    let extra = '';
    if (r.status === 403) {
      // asset 协议的 403 有两种来源：不在访问范围里 / 系统不让打开。Rust 端各查一遍
      const path = decodeURIComponent(new URL(url).pathname.slice(1));
      const { invoke } = await import('@tauri-apps/api/core');
      extra = ` · ${await invoke<string>('asset_check', { path }).catch((e) => `asset_check 出错 ${String(e)}`)}`;
    }
    logError(`图片加载失败 ${url} → HTTP ${r.status} ${r.headers.get('content-type') ?? ''} ${body}${extra}`);
  } catch (err) {
    logError(`图片加载失败 ${url} → fetch 出错 ${String(err)}`);
  }
}

export async function pickFiles(): Promise<Source[]> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const r = await open({ multiple: true, directory: false, filters: [{ name: t('dialog.images'), extensions: IMAGE_EXTS }] });
  const list = r ? (Array.isArray(r) ? r : [r]) : [];
  return list.map((path) => ({ path, kind: 'file' as const }));
}

export async function pickFolders(): Promise<Source[]> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const r = await open({ multiple: true, directory: true });
  const list = r ? (Array.isArray(r) ? r : [r]) : [];
  return list.map((path) => ({ path, kind: 'folder' as const }));
}

/** 拖进来的路径：带图片扩展名的当文件，其余当文件夹（Rust 端会再按实际类型处理） */
export function classifyDropped(paths: string[]): Source[] {
  return paths.map((path) => ({ path, kind: IMAGE_EXTS.includes(extOf(path)) ? 'file' : 'folder' }));
}

export type DropPhase = 'over' | 'drop' | 'leave';

export async function onFileDrop(cb: (phase: DropPhase, paths: string[]) => void): Promise<void> {
  const { getCurrentWebview } = await import('@tauri-apps/api/webview');
  await getCurrentWebview().onDragDropEvent((ev) => {
    const p = ev.payload;
    if (p.type === 'enter' || p.type === 'over') cb('over', p.type === 'enter' ? p.paths : []);
    else if (p.type === 'drop') cb('drop', p.paths);
    else cb('leave', []);
  });
}

// ───────────── 2026-11-17 新增：深色模式窗口底色、右键菜单、关于 ─────────────

/** 桌面版：窗口底色跟着深浅换，并记下来给下次启动用（避免启动时先闪一下另一种底色） */
export function setThemeBackground(dark: boolean): void {
  if (!isTauri()) return;
  void invoke('set_theme_background', { dark }).catch((err) => logError(`设置窗口底色失败: ${String(err)}`));
}

/**
 * 界面不能直接显示的格式（TIFF）用的显示图：full = false 是长边 ≤ 4096 的 WebP（放大查看），
 * full = true 是原尺寸 PNG（复制图像）。返回缓存文件的路径
 */
export function makeDisplay(path: string, mtime: number, size: number, full: boolean): Promise<string> {
  return invoke<string>('make_display', { path, mtime, size, full });
}

/** 原图另存为：Rust 端弹系统的保存对话框再复制文件。返回保存到的路径，取消时为 null */
export function saveImageAs(path: string): Promise<string | null> {
  return invoke<string | null>('save_image_as', { path });
}

/** 在资源管理器里显示并选中这个文件 */
export async function revealInFolder(path: string): Promise<void> {
  const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
  await revealItemInDir(path);
}

/** 用系统默认浏览器打开链接（关于对话框里的 GitHub 仓库） */
export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } else {
    window.open(url, '_blank', 'noopener');
  }
}

/** 应用版本号（桌面版读 Tauri 配置；浏览器调试读 package.json） */
export async function appVersion(): Promise<string> {
  if (isTauri()) {
    const { getVersion } = await import('@tauri-apps/api/app');
    return getVersion();
  }
  return __APP_VERSION__;
}

/**
 * 复制图像到剪贴板：读原图，转成 PNG（剪贴板只认 PNG）再写入。
 * PNG 原图直接写，不重新编码。
 */
export async function copyImage(url: string, size?: { w: number; h: number }): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  let blob = await res.blob();
  const isSvg = blob.type.includes('svg') || decodeURIComponent(url.split('?')[0]).toLowerCase().endsWith('.svg');
  if (isSvg) {
    blob = await rasterizeSvg(blob, size);
  } else if (blob.type !== 'image/png') {
    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    canvas.getContext('2d')!.drawImage(bmp, 0, 0);
    bmp.close();
    blob = await canvasToPng(canvas);
  }
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

/** 复制 SVG 时画成位图：矢量按原比例放大到长边至少 2048px，粘贴出去比较清楚 */
const SVG_COPY_EDGE = 2048;

async function rasterizeSvg(blob: Blob, size?: { w: number; h: number }): Promise<Blob> {
  const src = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    const w0 = size?.w || img.naturalWidth || 1024;
    const h0 = size?.h || img.naturalHeight || 1024;
    const k = Math.max(1, SVG_COPY_EDGE / Math.max(w0, h0));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w0 * k);
    canvas.height = Math.round(h0 * k);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await canvasToPng(canvas);
  } finally {
    URL.revokeObjectURL(src);
  }
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG 编码失败'))), 'image/png'),
  );
}
