// 和 Rust 端打交道：扫描、缩略图、选择文件 / 文件夹、拖放。只在 Tauri 里用。
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import type { ScanItem, Source } from './library';
import { t } from '../i18n';

export const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp'];

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

/** 把前端错误打到运行 tauri dev 的终端里 */
export function logError(msg: string): void {
  void invoke('log_error', { msg }).catch(() => {});
}

/** 图片加载失败时诊断：再请求一次，记下状态码和返回内容 */
export async function diagnoseImage(url: string): Promise<void> {
  try {
    const r = await fetch(url);
    const body = r.ok ? `${(await r.blob()).size} bytes` : (await r.text()).slice(0, 200);
    logError(`图片加载失败 ${url} → HTTP ${r.status} ${r.headers.get('content-type') ?? ''} ${body}`);
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
  return paths.map((path) => {
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    return { path, kind: IMAGE_EXTS.includes(ext) ? 'file' : 'folder' };
  });
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
