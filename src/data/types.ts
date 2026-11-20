/** 占位图里的一个色块（百分比坐标），只用于示例数据 */
export interface Shape {
  l: number;
  t: number;
  w: number;
  h: number;
  c: string;
  r: string;
  rot: number;
}

export interface Series {
  id: string;
  name: string;
  color: string;
}

export interface Work {
  /** 真实作品是文件的绝对路径；示例数据是 w01 这类 */
  id: string;
  /** 源文件标题（文件名去掉扩展名） */
  title: string;
  /** 用户自定义标题；没有就显示源文件标题 */
  customTitle?: string;
  /** 形如 2025.03.08；日期未知时为空字符串 */
  date: string;
  /** 排序用的时间戳（ms）：元数据日期，没有就用文件修改时间 */
  ts?: number;
  series: string;
  /** 主色：加载中、以及画作比例和卡片不一致时的底色 */
  bg: string;
  /** 示例数据用色块拼占位图；真实作品用图片 */
  shapes?: Shape[];
  /** 原图的文件路径（真实作品） */
  path?: string;
  /** 文件名（含扩展名），展示态在设了自定义标题时显示 */
  fileName?: string;
  /** RAW + JPG 同时拍、合并成一幅时（2026-11-18）：同名 RAW 原片的路径（这幅显示的是 JPG；右键可以把 RAW 另存为） */
  raw?: string;
  /** 原图像素尺寸（已按 EXIF 方向换算），决定卡片比例 */
  width?: number;
  height?: number;
  /** 缩略图 URL（生成好之后才有） */
  thumb?: string;
  /** 读取或生成缩略图失败 */
  broken?: boolean;
  /** 星级 1–5（2026-11-20）；没打星就没有这个字段 */
  rating?: number;
  /** 主色组成（2026-11-20，按颜色筛选用，engine/swatches.ts）；还没分析过就没有 */
  swatches?: { hex: string; share: number }[];
}

export interface Library {
  works: Work[];
  series: Series[];
}
