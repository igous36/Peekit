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
}

export function createMotion(pos0: number, zoom0 = 0): Motion {
  return {
    pos: pos0, posT: pos0, posV: 0,
    zoom: zoom0, zoomT: zoom0, zoomV: 0,
    press: 0, pressV: 0,
    ox: 0, oy: 0, oxT: 0, oyT: 0, hp: 0,
    mot: 0,
  };
}
