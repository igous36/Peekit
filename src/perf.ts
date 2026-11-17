// 性能探针：只在环境变量 PEEKIT_PERF=1 启动时运行（见 Rust 端 perf_mode）。
// 在真实窗口里自动模拟拖动、甩动、推拉镜头，记录每帧间隔和 render() 的 JS 耗时，
// 再检查静止时循环是否停下；结果打到终端，然后关闭窗口。不会改动保存的数据。
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { App } from './app';
import type { Work } from './data/types';

const info = (msg: string) => invoke('log_info', { msg }).catch(() => {});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const frame = () => new Promise<number>((r) => requestAnimationFrame(r));

/**
 * 临时加一段 CSS（对照实验用），返回撤掉它的函数。
 * 用可构造样式表而不是 <style>：发行版的 CSP 会拦掉动态插入的 <style>（见 tokens.ts 的 applyTokens）。
 */
function addCss(css: string): () => void {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  return () => {
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet);
  };
}

interface Stats {
  frames: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  fps: number;
  /** 超过 1.5 个刷新周期的帧（掉帧） */
  slow: number;
}

function summarize(xs: number[], refresh: number): Stats {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
  const mean = s.reduce((a, b) => a + b, 0) / Math.max(1, s.length);
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return {
    frames: s.length,
    p50: r1(q(0.5)),
    p95: r1(q(0.95)),
    p99: r1(q(0.99)),
    max: r1(s[s.length - 1] ?? 0),
    fps: r1(1000 / mean),
    slow: s.filter((v) => v > refresh * 1.5).length,
  };
}

async function waitSettled(app: App, maxMs = 4000): Promise<void> {
  const t0 = performance.now();
  while (app.controller.running && performance.now() - t0 < maxMs) await sleep(30);
}

/** 在 duration 毫秒内每帧调用 step(t)，同时记录帧间隔 */
async function animate(duration: number, step: (t: number) => void, intervals: number[]): Promise<void> {
  let last = await frame();
  const t0 = last;
  for (;;) {
    const now = await frame();
    intervals.push(now - last);
    last = now;
    const t = now - t0;
    if (t >= duration) break;
    step(t);
  }
}

/** 一直记录到动画停下 */
async function record(app: App, intervals: number[], maxMs = 3000): Promise<void> {
  let last = await frame();
  const t0 = last;
  while (app.controller.running && last - t0 < maxMs) {
    const now = await frame();
    intervals.push(now - last);
    last = now;
  }
}

export async function runPerfProbe(app: App): Promise<void> {
  app.freezeSaving();

  // 1. 等缩略图都到位（顺便验证图片能不能读）
  for (let i = 0; i < 100; i++) {
    const ws = app.works;
    if (ws.length && ws.every((w) => w.thumb || w.broken)) break;
    await sleep(200);
  }
  const real = app.works;
  info(`PERF 作品 ${real.length} 幅，缩略图到位 ${real.filter((w) => w.thumb).length}，读不了 ${real.filter((w) => w.broken).length}`);
  if (real.length === 0) {
    info('PERF 没有作品，跳过');
    await getCurrentWindow().close();
    return;
  }

  // 2. 作品太少时把真实作品复制到 12 幅，同时最多 5 幅可见，压力和规范设想的一样
  if (real.length < 12) {
    const works: Work[] = [];
    for (let k = 0; works.length < 12; k++) {
      for (const w of real) if (works.length < 12) works.push({ ...w, id: `${w.id}#${k}`, ts: (w.ts ?? 0) + k });
    }
    app.setLibrary({ works, series: app.seriesList }, 6);
  } else {
    app.setLibrary({ works: [...real], series: app.seriesList }, Math.floor(real.length / 2));
  }
  await waitSettled(app);
  await sleep(800); // 让中间那幅的原图也加载进来

  // 刷新周期：空闲时的 rAF 间隔
  const idle: number[] = [];
  await animate(500, () => {}, idle);
  const refresh = summarize(idle, 16.7).p50 || 16.7;

  // 给 render() 计时
  const costs: number[] = [];
  const orig = app.render.bind(app);
  app.render = () => {
    const t = performance.now();
    orig();
    costs.push(performance.now() - t);
  };
  const longTasks: number[] = [];
  try {
    new PerformanceObserver((l) => l.getEntries().forEach((e) => longTasks.push(e.duration))).observe({ entryTypes: ['longtask'] });
  } catch {
    /* 不支持就算了 */
  }

  const stage = document.querySelector<HTMLElement>('.stage')!;
  const P = (type: string, x: number, y: number) =>
    stage.dispatchEvent(new PointerEvent(type, { pointerId: 77, isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y, bubbles: true }));
  const vw = innerWidth, vh = innerHeight, cx = vw / 2, cy = vh / 2;
  const u = Math.min(vh / 100, vw * 0.006);

  // A. 来回拖动 3 秒（振幅 1.6 幅，画作不断沉入 / 浮出玻璃）
  const A = 1.6 * 29 * u;
  const dragOnce = async (): Promise<number[]> => {
    const xs: number[] = [];
    P('pointerdown', cx, cy);
    await animate(3000, (t) => P('pointermove', cx + A * Math.sin((t / 1500) * Math.PI * 2), cy + 2), xs);
    P('pointerup', cx, cy);
    await record(app, xs);
    await waitSettled(app);
    return xs;
  };
  // 对照实验先关掉原图加载（大图解码会让每次结果差很多），每种设置测两遍
  app.hiResEnabled = false;
  await dragOnce(); // 预热：纹理上传等一次性开销不算进结果
  const drag = await dragOnce();

  const NO_GLASS = '.glass-tile{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}';
  const variants: [string, string][] = [
    ['基线', ''],
    ['关玻璃模糊', NO_GLASS],
    ['玻璃模糊 12px', '.glass-tile{backdrop-filter:blur(12px) saturate(140%)!important;-webkit-backdrop-filter:blur(12px) saturate(140%)!important}'],
    ['关画作滤镜', '.art,.thumb{filter:none!important}'],
    ['关画作阴影', '.art-shadow{display:none!important}'],
    ['全关', `${NO_GLASS}.art,.thumb{filter:none!important}.art-shadow{display:none!important}`],
  ];
  const variantResults: string[] = [];
  for (const [name, css] of variants) {
    const removeCss = addCss(css);
    const runs = [summarize(await dragOnce(), refresh), summarize(await dragOnce(), refresh)];
    removeCss();
    variantResults.push(`${name}: ${runs.map((s) => `${s.fps}fps(p95 ${s.p95}, 掉帧 ${s.slow}/${s.frames})`).join('  ')}`);
  }

  // 原图加载打开：在两端停顿时会加载原图，看它带来的影响
  app.hiResEnabled = true;
  const withHiRes = summarize(await dragOnce(), refresh);
  variantResults.push(`开原图加载: ${withHiRes.fps}fps(p95 ${withHiRes.p95}, max ${withHiRes.max}, 掉帧 ${withHiRes.slow}/${withHiRes.frames})`);
  app.hiResEnabled = false;

  // B. 快速甩动（惯性 + 吸附 + 玻璃合拢）
  const fling: number[] = [];
  P('pointerdown', cx + 200, cy);
  await animate(120, (t) => P('pointermove', cx + 200 - t * 4, cy), fling);
  P('pointerup', cx - 280, cy);
  await record(app, fling);

  // C. 向下拖拉远镜头，松手进系列视图，再按 ↑ 推回
  const zoomOnce = async (): Promise<number[]> => {
    const xs: number[] = [];
    P('pointerdown', cx, cy - 100);
    await animate(500, (t) => P('pointermove', cx + 1, cy - 100 + (t / 500) * vh * 0.3), xs);
    P('pointerup', cx, cy - 100 + vh * 0.3);
    await record(app, xs);
    stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    await record(app, xs);
    await waitSettled(app);
    return xs;
  };
  const zoom = await zoomOnce();
  for (const [name, css] of [
    ['推拉 基线', ''],
    ['推拉 关缩略图模糊', '.thumb{filter:none!important}'],
    ['推拉 关缩略图阴影', '.thumb{box-shadow:none!important}'],
  ] as [string, string][]) {
    const removeCss = addCss(css);
    const runs = [summarize(await zoomOnce(), refresh), summarize(await zoomOnce(), refresh)];
    removeCss();
    variantResults.push(`${name}: ${runs.map((s) => `${s.fps}fps(p95 ${s.p95}, 掉帧 ${s.slow}/${s.frames})`).join('  ')}`);
  }

  // D. 静止 2 秒：循环必须停下，render() 不应该再被调用
  await waitSettled(app);
  const before = costs.length;
  await sleep(2000);
  const idleRenders = costs.length - before;

  const c = summarize(costs, refresh);
  info(`PERF 刷新周期 ≈ ${refresh.toFixed(1)}ms（${Math.round(1000 / refresh)}Hz），窗口 ${vw}×${vh}，u=${u.toFixed(2)}`);
  info(`PERF 拖动   ${JSON.stringify(summarize(drag, refresh))}`);
  for (const line of variantResults) info(`PERF 对照 ${line}`);
  info(`PERF 甩动   ${JSON.stringify(summarize(fling, refresh))}`);
  info(`PERF 推拉   ${JSON.stringify(summarize(zoom, refresh))}`);
  info(`PERF render() JS 耗时 ms：p50 ${c.p50}  p95 ${c.p95}  max ${c.max}（共 ${c.frames} 次）`);
  info(`PERF 长任务（>50ms）${longTasks.length} 个${longTasks.length ? '：' + longTasks.map((d) => Math.round(d)).join(', ') : ''}`);
  info(`PERF 静止 2 秒内 render() 调用 ${idleRenders} 次，循环 ${app.controller.running ? '还在跑' : '已停'}`);
  info('PERF 完成');
  await sleep(300);
  await getCurrentWindow().close();
}
