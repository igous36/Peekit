// 情绪板压力测试（2026-11-19）：临时建一个有几百到几千张照片的情绪板（不保存），
// 自动做打开、平移、缩放、拖照片吸附、框选、一键全局优化、拖起阵列，记录每帧间隔、render() 的 JS 耗时和长任务。
//
// - 开发版（npm run dev）：在开发者工具里运行 `await boardStress()`，图片用生成的 1600×1200 测试图
// - 桌面版：PEEKIT_PERF=1 时性能探针最后会跑一遍，图片用作品库里真实作品的缩略图
// 结果用 log 打出来（桌面版打到终端）。跑完删掉临时情绪板，不改动保存的数据。
import type { App } from './app';
import type { Board, BoardItem } from './data/boards';
import { GROUP_COLORS } from './data/boards';
import { GROUP_GAP, justify, bounds } from './engine/board-layout';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const frame = () => new Promise<number>((r) => requestAnimationFrame(r));

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

interface Stats {
  frames: number;
  fps: number;
  p50: number;
  p95: number;
  max: number;
  slow: number;
}

function summarize(xs: number[], refresh: number): Stats {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
  const mean = s.reduce((a, b) => a + b, 0) / Math.max(1, s.length);
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return { frames: s.length, fps: r1(1000 / Math.max(1, mean)), p50: r1(q(0.5)), p95: r1(q(0.95)), max: r1(s[s.length - 1] ?? 0), slow: s.filter((v) => v > refresh * 1.5).length };
}

const fmt = (s: Stats) => `${s.fps}fps p95 ${s.p95}ms max ${s.max}ms 掉帧 ${s.slow}/${s.frames}`;

/** 测试图：1600×1200 的 JPEG（渐变 + 几个色块），模拟缩略图的解码和栅格化开销 */
async function makeTestImages(count: number): Promise<string[]> {
  const urls: string[] = [];
  for (let i = 0; i < count; i++) {
    const c = new OffscreenCanvas(1600, 1200);
    const g = c.getContext('2d')!;
    const h = (i * 47) % 360;
    const grad = g.createLinearGradient(0, 0, 1600, 1200);
    grad.addColorStop(0, `hsl(${h} 55% 70%)`);
    grad.addColorStop(1, `hsl(${(h + 60) % 360} 45% 35%)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 1600, 1200);
    for (let k = 0; k < 14; k++) {
      g.fillStyle = `hsl(${(h + k * 29) % 360} 60% ${30 + ((k * 13) % 50)}%)`;
      g.beginPath();
      g.arc((k * 211 + i * 37) % 1600, (k * 157 + i * 71) % 1200, 60 + ((k * 31) % 180), 0, Math.PI * 2);
      g.fill();
    }
    const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    urls.push(URL.createObjectURL(blob));
  }
  return urls;
}

/** 临时情绪板：n 张照片排成很多个集合（每个 1–12 张，等高行），集合之间隔开，大致铺成一个横向的长方形 */
function makeBoard(n: number, sources: { path: string; pw: number; ph: number; color?: string }[]): Board {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const items: BoardItem[] = [];
  const groups: Board['groups'] = [];
  const rowW = Math.sqrt(n) * 380;
  let gx = 0, gy = 0, rowH = 0, gi = 0;
  while (items.length < n) {
    const k = Math.min(n - items.length, 1 + Math.floor(rnd() * 12));
    const srcs = Array.from({ length: k }, (_, j) => sources[(items.length + j) % sources.length]);
    const boxes = justify(srcs.map((s) => s.pw / s.ph), 1.5);
    const bb = bounds(boxes);
    if (gx > rowW) {
      gx = 0;
      gy += rowH + GROUP_GAP;
      rowH = 0;
    }
    const gid = `perf-g${gi}`;
    groups.push({ id: gid, color: gi % GROUP_COLORS.length });
    gi++;
    boxes.forEach((b, j) => {
      const s = srcs[j];
      items.push({
        id: `perf-${items.length}`, path: s.path, title: `#${items.length}`, pw: s.pw, ph: s.ph, color: s.color,
        x: b.x + gx, y: b.y + gy, w: b.w, h: b.h, group: gid, addedAt: 0,
      });
    });
    gx += bb.w + GROUP_GAP;
    rowH = Math.max(rowH, bb.h);
  }
  return { id: `perf-board-${n}`, name: `压测 ${n}`, createdAt: 0, updatedAt: 0, items, groups };
}

/** counts：依次测这些张数；variantsAt：用这么多张做对照实验（0 = 不做） */
export async function runBoardStress(app: App, log: (msg: string) => void, counts = [200, 1000, 2500], variantsAt = 0): Promise<void> {
  const a = app as Any;
  const view = a.boardView;
  const store = a.boards;
  const thumbs = a.boardThumbs;
  store.freeze();

  // 图片：桌面版用真实作品（缩略图走 Rust 端缓存），浏览器用生成的测试图
  let sources: { path: string; pw: number; ph: number; color?: string }[];
  const origUrl = thumbs.url.bind(thumbs);
  if (a.service.desktop && app.works.some((w) => w.path)) {
    sources = app.works.filter((w) => w.path && !w.broken).map((w) => ({ path: w.path!, pw: w.width ?? 800, ph: w.height ?? 1000, color: w.bg }));
  } else {
    const urls = await makeTestImages(48);
    sources = urls.map((_, i) => ({ path: `perf:${i}`, pw: i % 3 === 0 ? 1200 : 1600, ph: i % 3 === 0 ? 1600 : 1200, color: '#888' }));
    thumbs.url = (it: BoardItem) => (it.path?.startsWith('perf:') ? urls[Number(it.path.slice(5))] : origUrl(it));
  }

  const idle: number[] = [];
  let last = await frame();
  for (let i = 0; i < 30; i++) {
    const now = await frame();
    idle.push(now - last);
    last = now;
  }
  const refresh = summarize(idle, 16.7).p50 || 16.7;

  const costs: number[] = [];
  const origRender = app.render.bind(app);
  app.render = () => {
    const t = performance.now();
    origRender();
    costs.push(performance.now() - t);
  };
  const longTasks: number[] = [];
  // 长帧拆解（Long Animation Frame）：脚本、rAF 回调、样式布局、之后的绘制各花了多久
  const loafs: { dur: number; script: number; raf: number; style: number; paint: number; top: string }[] = [];
  let lo: PerformanceObserver | null = null;
  try {
    lo = new PerformanceObserver((l) => {
      for (const e of l.getEntries() as Any[]) {
        const end = e.startTime + e.duration;
        const script = (e.scripts ?? []).reduce((a: number, x: Any) => a + x.duration, 0);
        const top = [...(e.scripts ?? [])].sort((x: Any, y: Any) => y.duration - x.duration)[0];
        loafs.push({
          dur: e.duration, script,
          raf: e.styleAndLayoutStart && e.renderStart ? e.styleAndLayoutStart - e.renderStart : 0,
          style: e.styleAndLayoutStart ? end - e.styleAndLayoutStart : 0,
          paint: 0,
          top: top ? `${top.invoker ?? ''}@${(top.sourceFunctionName || '').slice(0, 30)} ${Math.round(top.duration)}` : '',
        });
      }
    });
    lo.observe({ type: 'long-animation-frame', buffered: false } as Any);
  } catch {
    /* 不支持就算了 */
  }
  const loafReport = (): string => {
    const xs = loafs.splice(0).sort((a, b) => b.dur - a.dur).slice(0, 3);
    return xs.map((x) => `[帧 ${Math.round(x.dur)} 脚本 ${Math.round(x.script)} rAF ${Math.round(x.raf)} 样式布局及以后 ${Math.round(x.style)} ${x.top}]`).join(' ');
  };
  let po: PerformanceObserver | null = null;
  try {
    po = new PerformanceObserver((l) => l.getEntries().forEach((e) => longTasks.push(e.duration)));
    po.observe({ entryTypes: ['longtask'] });
  } catch {
    /* 不支持就算了 */
  }

  const vw = innerWidth, vh = innerHeight, cx = vw / 2, cy = vh / 2;
  const canvas = () => document.querySelector<HTMLElement>('.board-canvas')!;
  const P = (el: EventTarget, type: string, x: number, y: number, buttons = 1) =>
    el.dispatchEvent(new PointerEvent(type, { pointerId: 91, isPrimary: true, button: 0, buttons, clientX: x, clientY: y, bubbles: true }));
  const W = (x: number, y: number, init: WheelEventInit) => canvas().dispatchEvent(new WheelEvent('wheel', { clientX: x, clientY: y, bubbles: true, cancelable: true, ...init }));

  /** 记录 duration 毫秒的帧间隔，每帧调用 step(t) */
  const run = async (duration: number, step: (t: number) => void): Promise<number[]> => {
    const xs: number[] = [];
    let prev = await frame();
    const t0 = prev;
    for (;;) {
      const now = await frame();
      xs.push(now - prev);
      prev = now;
      if (now - t0 >= duration) break;
      step(now - t0);
    }
    return xs;
  };
  /** 一直记录到动画停下（最多 maxMs） */
  const settle = async (xs: number[] = [], maxMs = 4000): Promise<number[]> => {
    let prev = await frame();
    const t0 = prev;
    while (app.controller.running && prev - t0 < maxMs) {
      const now = await frame();
      xs.push(now - prev);
      prev = now;
    }
    return xs;
  };
  const screenOf = (it: BoardItem) => {
    const c = { x: view.cam.x.v, y: view.cam.y.v, z: view.cam.z.v };
    return { x: (it.x + it.w / 2 - c.x) * c.z + vw / 2, y: (it.y + it.h / 2 - c.y) * c.z + vh / 2 };
  };

  log(`BOARD 窗口 ${vw}×${vh}，刷新周期 ≈ ${refresh.toFixed(1)}ms，图片 ${sources.length} 种`);
  for (const n of counts) {
    const board = makeBoard(n, sources);
    store.data.boards.push(board);
    costs.length = 0;
    longTasks.length = 0;
    const lines: string[] = [];
    const mark = (name: string, xs: number[]) => {
      const c = summarize(costs.splice(0), refresh);
      lines.push(`${name.padEnd(8)} ${fmt(summarize(xs, refresh))}  render p95 ${c.p95}ms  长任务 ${longTasks.splice(0).map(Math.round).join(',') || '无'}`);
    };

    // 1. 打开
    const t0 = performance.now();
    a.openBoard(board.id);
    const openSync = performance.now() - t0;
    mark(`打开(${Math.round(openSync)}ms)`, await settle());
    await sleep(300);
    // 2. 平移：触控板双指滑动 2 秒
    mark('平移', await run(2000, (t) => W(cx, cy, { deltaX: Math.sin(t / 300) * 18, deltaY: Math.cos(t / 400) * 12, deltaMode: 0 })));
    await settle();
    // 3. 缩放：鼠标滚轮一格一格，空白处，放大 4 格再缩小 4 格
    const zoomXs: number[] = [];
    for (let k = 0; k < 8; k++) {
      const empty = { x: 30, y: vh - 30 };
      W(empty.x, empty.y, { deltaY: k < 4 ? -3 : 3, deltaMode: 1 });
      zoomXs.push(...(await run(260, () => {})));
    }
    mark('缩放', await settle(zoomXs));
    // 4. 显示全部 → 聚焦一张 → 退出聚焦
    const fx: number[] = [];
    view.fitAll();
    await settle(fx);
    const target = board.items[Math.floor(n / 2)];
    view.focusOn(view.nodes.get(target.id));
    await settle(fx);
    view.exitFocus();
    mark('聚焦', await settle(fx));
    // 5. 拖一张照片绕圈 2 秒（附近有别的照片，会吸附）
    view.focusOn(view.nodes.get(target.id));
    await settle();
    view.exitFocus(false);
    await settle();
    const p0 = screenOf(target);
    P(canvas(), 'pointerdown', p0.x, p0.y);
    const dragXs = await run(2000, (t) => P(window, 'pointermove', p0.x + Math.sin(t / 250) * 160, p0.y + Math.cos(t / 250) * 90));
    P(window, 'pointerup', p0.x, p0.y, 0);
    mark('拖照片', await settle(dragXs));
    // 6. 框选：从左上拖到右下 1 秒
    view.fitAll();
    await settle();
    P(canvas(), 'pointerdown', 20, 60);
    const mq = await run(1000, (t) => P(window, 'pointermove', 20 + (vw - 40) * (t / 1000), 60 + (vh - 80) * (t / 1000)));
    P(window, 'pointerup', vw - 20, vh - 20, 0);
    mark('框选', mq);
    view.select([]);
    // 7. 一键全局优化
    const t1 = performance.now();
    view.optimizeAll();
    const optSync = performance.now() - t1;
    mark(`优化(${Math.round(optSync)}ms)`, await settle([], 6000));
    // 8. 静止：循环要停下
    await sleep(600);
    const before = costs.length;
    await sleep(1000);
    const idleRenders = costs.length - before;
    // 9. 回到预览
    a.closeBoard();
    await settle();
    log(`BOARD ── ${n} 张 ──`);
    for (const l of lines) log(`BOARD ${l}`);
    log(`BOARD 静止 1 秒 render() ${idleRenders} 次，循环${app.controller.running ? '还在跑' : '已停'}`);
    view.detach();
    store.data.boards = store.data.boards.filter((b: Board) => b !== board);
  }

  // 对照实验：大量照片同时移动、框选、聚焦，分别关掉某一项，看时间花在哪
  if (variantsAt) {
    const board = makeBoard(variantsAt, sources);
    store.data.boards.push(board);
    a.openBoard(board.id);
    await settle();
    const bb = bounds(board.items);
    let seed = 99;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    /** 所有照片打乱到随机位置（和一键优化一样是全部照片一起滑过去） */
    const scatter = async (): Promise<number[]> => {
      for (const it of board.items) {
        it.x = bb.x + rnd() * bb.w * 0.9;
        it.y = bb.y + rnd() * bb.h * 0.9;
      }
      view.animateTo(board.items, []);
      view.changed();
      return settle([], 12000);
    };
    view.fitAll();
    await settle();
    await scatter(); // 预热
    for (const [name, css] of [
      ['基线', ''],
      ['照片各自成层', '.board-item{will-change:transform!important}'],
      ['关四边模糊', '.board-edge{display:none!important}'],
      ['关点阵', '.board-dots{display:none!important}'],
    ] as [string, string][]) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      await sleep(400);
      longTasks.length = 0;
      loafs.length = 0;
      const mv = summarize(await scatter(), refresh);
      const mvLong = longTasks.splice(0).map(Math.round);
      const mvLoaf = loafReport();
      P(canvas(), 'pointerdown', 20, 60);
      const mq = summarize(await run(800, (t) => P(window, 'pointermove', 20 + (vw - 40) * (t / 800), 60 + (vh - 80) * (t / 800))), refresh);
      P(window, 'pointerup', vw - 20, vh - 20, 0);
      view.select([]);
      await settle();
      const target = board.items[Math.floor(board.items.length / 2)];
      view.focusOn(view.nodes.get(target.id));
      const fc = summarize(await settle([], 3000), refresh);
      view.exitFocus();
      await settle();
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet);
      log(`BOARD 对照(${variantsAt}) ${name.padEnd(6)} 一起移动 ${fmt(mv)} 最长任务 ${Math.max(0, ...mvLong)}ms | 框选 ${fmt(mq)} | 聚焦 ${fmt(fc)}`);
      log(`BOARD    一起移动的长帧 ${mvLoaf}`);
    }
    a.closeBoard();
    await settle();
    view.detach();
    store.data.boards = store.data.boards.filter((b: Board) => b !== board);
  }

  // 10. 拖起阵列：情绪板多（60 个，每个 300 张）时，长按打开、拖一圈、Esc
  const many: Board[] = [];
  for (let i = 0; i < 60; i++) {
    const b = makeBoard(300, sources);
    b.id = `perf-many-${i}`;
    b.updatedAt = i;
    many.push(b);
  }
  store.data.boards.push(...many);
  if (app.works.length) {
    const stage = document.querySelector<HTMLElement>('.stage')!;
    const t2 = performance.now();
    P(stage, 'pointerdown', cx, cy);
    await sleep(420);
    const liftMs = performance.now() - t2 - 350;
    const pk = document.querySelector<HTMLElement>('.board-picker')!;
    const xs = await run(2000, (t) => P(pk, 'pointermove', cx + Math.sin(t / 300) * vw * 0.35, cy + Math.cos(t / 300) * vh * 0.3));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle(xs);
    costs.length = 0;
    log(`BOARD 拖起阵列（60 个情绪板）展开约 ${Math.round(liftMs)}ms 后：${fmt(summarize(xs, refresh))}  长任务 ${longTasks.splice(0).map(Math.round).join(',') || '无'}`);
  }
  store.data.boards = store.data.boards.filter((b: Board) => !many.includes(b));

  po?.disconnect();
  lo?.disconnect();
  app.render = origRender;
  thumbs.url = origUrl;
  log('BOARD 完成');
}
