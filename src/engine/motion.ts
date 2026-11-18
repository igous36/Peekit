/**
 * 所有弹簧和连续量的状态。单位：pos 以“幅”为单位，zoom 0–1，ox/oy 以 u 为单位（相对窗口中心）。
 * 移植自原型构造函数里的 this.m。
 */
export interface Motion {
  pos: number;
  posT: number;
  posV: number;
  zoom: number;
  zoomT: number;
  zoomV: number;
  press: number;
  pressV: number;
  /** 指针位置（平滑后 / 目标） */
  ox: number;
  oy: number;
  oxT: number;
  oyT: number;
  /** 是否已经收到过指针位置 */
  hp: number;
  /** 玻璃运动系数 0–1 */
  mot: number;
  /** 放大查看 0–1（2026-11-17 新增）：1 = 当前作品放大到几乎占满窗口 */
  mag: number;
  magT: number;
  magV: number;
  /** 全屏程度 0–1：1 = 放大框改为铺满整个屏幕 */
  fs: number;
  fsT: number;
  fsV: number;
  /**
   * 系列缩略图换页后的入场 0–1（2026-11-17 新增）：换页时归零，再弹回 1（目标固定为 1）。
   * 缩略图按 min(镜头, pg) 走原型的入场动画，所以换页时新一页会像拉远镜头时那样依次浮现。
   */
  pg: number;
  pgV: number;
  /**
   * 全屏时的滚轮缩放（2026-11-18 新增，见 engine/fszoom.ts）：fz 缩放（1 = 适应屏幕），
   * fpx / fpy 画面中心相对屏幕中心的偏移（px）。拖动平移时当前值和目标一起改（跟手），其余时候弹簧过去
   */
  fz: number;
  fzT: number;
  fzV: number;
  fpx: number;
  fpxT: number;
  fpxV: number;
  fpy: number;
  fpyT: number;
  fpyV: number;
}

export function createMotion(pos0: number, zoom0 = 0): Motion {
  return {
    pos: pos0, posT: pos0, posV: 0,
    zoom: zoom0, zoomT: zoom0, zoomV: 0,
    press: 0, pressV: 0,
    ox: 0, oy: 0, oxT: 0, oyT: 0, hp: 0,
    mot: 0,
    mag: 0, magT: 0, magV: 0,
    fs: 0, fsT: 0, fsV: 0,
    pg: 1, pgV: 0,
    fz: 1, fzT: 1, fzV: 0,
    fpx: 0, fpxT: 0, fpxV: 0,
    fpy: 0, fpyT: 0, fpyV: 0,
  };
}
