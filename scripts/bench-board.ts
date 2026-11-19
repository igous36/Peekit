// 情绪板几何的压力测试（2026-11-19）：几百到几千张照片时，各个算法要多久。
// 运行：npx vite-node scripts/bench-board.ts
// 只测纯函数（engine/board-layout.ts、data/boards.ts），不碰界面。
import {
  BOARD_GAP, GROUP_GAP, bounds, components, gather, justify, repack, separate, snapPosition, type Box,
} from '../src/engine/board-layout';
import { addPhotos, createBoard, emptyBoards, removeItems, splitGroups, type PhotoSource } from '../src/data/boards';

/** 固定种子的伪随机数，结果可复现 */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const aspects = (n: number, r = rng(1)) => Array.from({ length: n }, () => [0.66, 0.75, 0.8, 1, 1.33, 1.5, 1.78, 2.4][Math.floor(r() * 8)]);

/** 摆成很多个集合（每个 1–12 张、等高行），集合之间隔开：模拟一个用了很久的大情绪板 */
function scattered(n: number): Box[] {
  const r = rng(7);
  const out: Box[] = [];
  let gx = 0, gy = 0, rowH = 0;
  while (out.length < n) {
    const k = Math.min(n - out.length, 1 + Math.floor(r() * 12));
    const boxes = justify(aspects(k, r), 1.5);
    const bb = bounds(boxes);
    if (gx > 9000) {
      gx = 0;
      gy += rowH + GROUP_GAP;
      rowH = 0;
    }
    for (const b of boxes) out.push({ x: b.x + gx, y: b.y + gy, w: b.w, h: b.h });
    gx += bb.w + GROUP_GAP;
    rowH = Math.max(rowH, bb.h);
  }
  return out;
}

function time(label: string, fn: () => void, reps = 1): number {
  fn(); // 预热
  const t0 = performance.now();
  for (let i = 0; i < reps; i++) fn();
  const ms = (performance.now() - t0) / reps;
  console.log(`${label.padEnd(44)} ${ms.toFixed(2).padStart(9)} ms`);
  return ms;
}

for (const n of [200, 1000, 3000]) {
  console.log(`\n── ${n} 张 ──`);
  const boxes = scattered(n);
  const mid = boxes[Math.floor(n / 2)];
  // 拖动中每次指针移动：在照片附近找吸附位置
  time('拖动一张：吸附（26px 内）', () => {
    snapPosition(mid.w, mid.h, mid.x + 30, mid.y + 20, boxes, 26);
  }, 20);
  // 松手时压在别的照片上：找最近的合法位置
  time('松手压在照片上：最近合法位置', () => {
    snapPosition(300, 300, mid.x + 10, mid.y + 10, boxes, Infinity);
  });
  time('连通分量（拆分集合）', () => {
    components(boxes);
  });
  time('推开重叠（一张放大后）', () => {
    const b = boxes.map((x) => ({ ...x }));
    b[0] = { ...b[0], w: b[0].w * 3, h: b[0].h * 3 };
    separate(b, b.map((_, i) => i === 0), BOARD_GAP);
  });
  time('整块推开（集合当作整块）', () => {
    const blocks = boxes.filter((_, i) => i % 6 === 0).map((b) => ({ ...b, w: b.w * 2, h: b.h * 2 }));
    separate(blocks, blocks.map((_, i) => i === 0), GROUP_GAP / 2);
  });
  time('最密排布（全部排成一块）', () => {
    justify(aspects(n), 1.5);
  });
  time('优化所选（全部重排）', () => {
    repack(boxes, boxes.map((b) => b.w / b.h));
  });
  time('合成一个集合（gather）', () => {
    gather(boxes.slice(0, Math.min(n, 400)));
  });
  const photos: PhotoSource[] = Array.from({ length: n }, (_, i) => ({ path: `C:/p/${i}.jpg`, title: `${i}`, pw: 1600, ph: 1200 }));
  time('往空情绪板一张张加（找空地）', () => {
    const b = createBoard(emptyBoards());
    for (let i = 0; i < Math.min(n, 300); i++) addPhotos(b, [photos[i]]);
  });
  time('一次加一批（最密排成一块）', () => {
    const b = createBoard(emptyBoards());
    addPhotos(b, photos);
  });
  time('移除一张后拆分集合', () => {
    const b = createBoard(emptyBoards());
    addPhotos(b, photos);
    removeItems(b, new Set([b.items[Math.floor(n / 2)].id]));
    splitGroups(b, b.groups.map((g) => g.id));
  });
}
