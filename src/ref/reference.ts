// 置顶参考小窗（2026-11-20）：Rust 的 open_reference 开一个无边框、钉在所有窗口最上面的小窗，
// 加载同一个前端，地址带 ?ref=…；main.ts 看到 ref 参数就只跑这里，不建整个应用。
//
//   ref=work&src=<原图地址>&title=…&w=…&h=…   一幅画：深色底，按比例铺满
//   ref=board&id=<情绪板 id>&title=…            一个情绪板（只读）：照片按画布上的位置摆，主窗口改了跟着刷新
//
// 小窗里：滚轮以光标为中心缩放、拖动平移、双击回到适应窗口；H 水平翻转、G 灰度（和主窗口的画师自检一样）。
// 鼠标移进来时顶部浮出一条细工具栏：标题（按住拖动窗口）、不透明度滑条（窗口是透明的，调低能透出后面的绘画软件）、
// 钉在最上面的开关、关闭。窗口边缘拖动改大小（无边框窗口，靠 start_resize_dragging）。
import { isTauri } from '@tauri-apps/api/core';
import { t } from '../i18n';
import { el, svgIcon, ICON_CLOSE, ICON_FLIP, ICON_PIN } from '../view/dom';
import { fillArt } from '../view/art';
import { createLibraryStore } from '../data/persist';
import { groupColor, parseBoards, type Board } from '../data/boards';
import { bounds, fitCam, zoomAround, type Cam } from '../engine/board-layout';
import { assetUrl, logInfo, makeThumbnail, onBoardsSaved } from '../data/tauri-io';
import { r3 } from '../engine/math';
import type { Work } from '../data/types';

/** 工具栏停这么久没动静就收起（ms） */
const BAR_IDLE = 1600;
/** 窗口边缘这么宽的一圈可以拖动改大小（px） */
const EDGE = 6;

type ResizeDir = 'North' | 'South' | 'East' | 'West' | 'NorthEast' | 'NorthWest' | 'SouthEast' | 'SouthWest';

async function win() {
  const m = await import('@tauri-apps/api/window');
  return m.getCurrentWindow();
}

export async function bootReference(params: URLSearchParams, mount: HTMLElement): Promise<void> {
  document.documentElement.classList.add('is-ref');
  const kind = params.get('ref') === 'board' ? 'board' : 'work';
  const title = params.get('title') ?? '';
  document.title = `Peekit · ${title}`;

  const view = el('div', { class: 'ref-view' });
  const world = el('div', { class: 'ref-world' });
  view.append(world);

  // ── 工具栏 ──
  const name = el('span', { class: 'ref-title', 'data-tauri-drag-region': '' }, [title]);
  const opacity = el('input', { type: 'range', min: 25, max: 100, value: 100, class: 'ref-opacity', 'aria-label': t('ref.opacity'), title: t('ref.opacity') });
  const pin = el('button', { type: 'button', class: 'ref-btn is-on', 'aria-pressed': 'true', 'aria-label': t('ref.pin'), title: t('ref.pin') }, [svgIcon(ICON_PIN, 15)]);
  const flip = el('button', { type: 'button', class: 'ref-btn', 'aria-pressed': 'false', 'aria-label': t('check.withKey', { name: t('check.flip'), key: 'H' }), title: t('check.withKey', { name: t('check.flip'), key: 'H' }) }, [svgIcon(ICON_FLIP, 15)]);
  const close = el('button', { type: 'button', class: 'ref-btn', 'aria-label': t('ref.close'), title: t('ref.close') }, [svgIcon(ICON_CLOSE, 15)]);
  const bar = el('div', { class: 'ref-bar', 'data-tauri-drag-region': '' }, [name, opacity, flip, pin, close]);
  const root = el('div', { class: `ref ref--${kind}` }, [view, bar]);
  mount.replaceChildren(root);

  opacity.addEventListener('input', () => {
    root.style.opacity = String(Number(opacity.value) / 100);
  });
  pin.addEventListener('click', async () => {
    const on = pin.getAttribute('aria-pressed') !== 'true';
    pin.setAttribute('aria-pressed', String(on));
    pin.classList.toggle('is-on', on);
    if (isTauri()) await (await win()).setAlwaysOnTop(on);
  });
  close.addEventListener('click', async () => {
    if (isTauri()) await (await win()).close();
    else window.close();
  });
  const toggleFlip = () => {
    const on = !root.classList.contains('is-flipped');
    root.classList.toggle('is-flipped', on);
    flip.setAttribute('aria-pressed', String(on));
    flip.classList.toggle('is-on', on);
  };
  flip.addEventListener('click', toggleFlip);

  // 鼠标移进来、动一动：浮出工具栏；停一会儿收起（指针在工具栏上时不收）
  let idle = 0;
  const wake = () => {
    root.classList.add('show-bar');
    window.clearTimeout(idle);
    idle = window.setTimeout(() => {
      if (!bar.matches(':hover')) root.classList.remove('show-bar');
    }, BAR_IDLE);
  };
  root.addEventListener('pointermove', wake);
  root.addEventListener('pointerleave', () => root.classList.remove('show-bar'));

  // 窗口边缘拖动改大小
  root.addEventListener('pointerdown', async (e) => {
    const dir = edgeAt(e.clientX, e.clientY);
    if (!dir || e.button !== 0 || !isTauri()) return;
    e.preventDefault();
    e.stopPropagation();
    await (await win()).startResizeDragging(dir as never);
  }, true);
  root.addEventListener('pointermove', (e) => {
    const dir = edgeAt(e.clientX, e.clientY);
    root.style.cursor = dir ? CURSOR[dir] : '';
  });

  // ── 镜头：滚轮缩放、拖动平移、双击适应 ──
  let cam: Cam = { x: 0, y: 0, z: 1 };
  let content = { x: 0, y: 0, w: 1, h: 1 };
  const paint = () => {
    const vw = view.clientWidth, vh = view.clientHeight;
    world.style.transform = `translate(${r3(vw / 2 - cam.x * cam.z)}px, ${r3(vh / 2 - cam.y * cam.z)}px) scale(${r3(cam.z)})`;
  };
  const fit = () => {
    const vw = view.clientWidth, vh = view.clientHeight;
    cam = kind === 'board' ? fitCam(content, vw, vh, 28, 8, 4) : fitCam(content, vw, vh, 0, 0, 64);
    paint();
  };
  view.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = view.getBoundingClientRect();
    const k = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0018));
    cam = zoomAround(cam, cam.z * k, e.clientX - r.left, e.clientY - r.top, r.width, r.height);
    paint();
  }, { passive: false });
  let drag: { id: number; x: number; y: number; cam: Cam } | null = null;
  view.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, cam };
    view.setPointerCapture(e.pointerId);
    root.classList.add('is-panning');
  });
  view.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    cam = { x: drag.cam.x - (e.clientX - drag.x) / cam.z, y: drag.cam.y - (e.clientY - drag.y) / cam.z, z: cam.z };
    paint();
  });
  const end = (e: PointerEvent) => {
    if (drag && e.pointerId === drag.id) drag = null;
    root.classList.remove('is-panning');
  };
  view.addEventListener('pointerup', end);
  view.addEventListener('pointercancel', end);
  view.addEventListener('dblclick', fit);
  new ResizeObserver(() => fit()).observe(view);
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'h' || e.key === 'H') toggleFlip();
    else if (e.key === 'g' || e.key === 'G') root.classList.toggle('is-gray');
    else if (e.key === '0') fit();
  });

  if (kind === 'work') {
    // 一幅画：世界坐标就是图片的像素尺寸（按传进来的宽高，没有就等图片加载后取）
    const src = params.get('src') ?? '';
    let w = Number(params.get('w')) || 0, h = Number(params.get('h')) || 0;
    const img = el('img', { class: 'ref-img', alt: '', draggable: 'false', decoding: 'async' });
    world.append(img);
    const place = () => {
      Object.assign(img.style, { width: `${w}px`, height: `${h}px` });
      content = { x: 0, y: 0, w, h };
      fit();
    };
    img.addEventListener('load', () => {
      if (!w || !h) {
        w = img.naturalWidth;
        h = img.naturalHeight;
      }
      place();
      logInfo(`[参考小窗] 一幅画已显示 ${img.naturalWidth}×${img.naturalHeight}`);
    });
    img.addEventListener('error', () => {
      root.classList.add('is-broken');
      logInfo(`[参考小窗] 图片读不了 ${src}`);
    });
    if (w && h) place();
    if (src) img.src = src;
    else root.classList.add('is-broken');
    return;
  }

  // 一个情绪板（只读）：读 library.json 里的情绪板，按画布上的位置摆照片；主窗口保存后重新读
  const id = params.get('id') ?? '';
  const store = createLibraryStore();
  let first = true;
  const load = async () => {
    const data = parseBoards((await store.load()).boards);
    const b = data.boards.find((x) => x.id === id);
    if (!b) {
      root.classList.add('is-broken');
      logInfo(`[参考小窗] 找不到情绪板 ${id}`);
      return;
    }
    renderBoard(world, b);
    content = bounds(b.items);
    if (first) {
      first = false;
      fit();
      logInfo(`[参考小窗] 情绪板「${b.name}」${b.items.length} 张`);
    }
  };
  onBoardsSaved(() => void load());
  await load();
}

/** 指针在窗口边缘哪一边（改大小用） */
function edgeAt(x: number, y: number): ResizeDir | null {
  const w = window.innerWidth, h = window.innerHeight;
  const n = y < EDGE, s = y > h - EDGE, wv = x < EDGE, e = x > w - EDGE;
  if (n && wv) return 'NorthWest';
  if (n && e) return 'NorthEast';
  if (s && wv) return 'SouthWest';
  if (s && e) return 'SouthEast';
  if (n) return 'North';
  if (s) return 'South';
  if (wv) return 'West';
  if (e) return 'East';
  return null;
}

const CURSOR: Record<ResizeDir, string> = {
  North: 'ns-resize', South: 'ns-resize', East: 'ew-resize', West: 'ew-resize',
  NorthEast: 'nesw-resize', SouthWest: 'nesw-resize', NorthWest: 'nwse-resize', SouthEast: 'nwse-resize',
};

/** 摆照片：一张一个 div，位置大小用画布坐标；描边是所在集合的颜色 */
function renderBoard(world: HTMLElement, b: Board): void {
  const nodes: HTMLElement[] = [];
  for (const it of b.items) {
    const canvas = el('span', { class: 'art-canvas' });
    const node = el('div', { class: 'ref-photo' }, [canvas]);
    Object.assign(node.style, { left: `${it.x}px`, top: `${it.y}px`, width: `${it.w}px`, height: `${it.h}px` });
    node.style.setProperty('--ring', groupColor(b, it.group));
    const pseudo: Work = { id: it.id, title: it.title, date: '', series: '', bg: it.color ?? '#808080', shapes: it.shapes };
    fillArt(canvas, pseudo, undefined);
    nodes.push(node);
    if (it.path && isTauri()) {
      void makeThumbnail(it.path, it.mtime ?? 0, it.size ?? 0)
        .then((r) => fillArt(canvas, pseudo, assetUrl(r.path)))
        .catch(() => {});
    }
  }
  world.replaceChildren(...nodes);
}
