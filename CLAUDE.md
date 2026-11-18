# 插画预览应用：给 Claude Code 的项目说明

这是一个用 Tauri 做的桌面插画浏览器（Peekit）。设计规范在 `HANDOFF.md`，代码结构、数据保存和发版流程在 `ARCHITECTURE.md`，可交互原型的源码在 `design/prototype.dc.html`。动画数值以原型代码为准，不要自己“优化”参数。

## 技术选型

- Tauri 2 + Vite + 原生 TypeScript（不用 React / Vue 之类的框架）。目标是安装包小、启动快、动画不掉帧。
- 不引入 3D 引擎（three.js、Spline runtime 都不要）。全部效果用 DOM + CSS transform / opacity / filter / backdrop-filter 实现。
- 不打包中文字体，用系统字体（macOS 苹方、Windows 微软雅黑）。

## 渲染架构

- 所有 DOM 节点只创建一次：画作、玻璃格、缩略图都放在对象池里复用。每帧只改 `style.transform`、`opacity`、`filter` 这类不触发重排的属性，不要每帧重建 innerHTML。
- 一个 `requestAnimationFrame` 循环推进所有弹簧（位置、镜头、按压、指针、玻璃运动系数）。全部静止后停掉循环，有新输入再启动。
- 每帧的样式计算移植自原型的 `renderVals()`；弹簧积分移植自 `step()`；输入处理移植自 `onDown` / `onMove` / `onUp` / `onWheel` / `onKey`。
- 每帧只渲染 |d| ≤ 2.65 的画作（最多 5 幅），其余隐藏或移出 DOM。
- 玻璃格的祖先元素不能有 opacity / filter / mask，否则 backdrop-filter 会失效（见 HANDOFF §2）。
- 同时写 `backdrop-filter` 和 `-webkit-backdrop-filter`。

## 窗口

- `decorations: false`，自己画标题区；顶部 40px 加 `data-tauri-drag-region`。
- 默认 1440 × 900，最小 960 × 600。
- 背景色 `#D5D5D3`，启动时窗口先用这个底色，避免白闪。

## 数据

- 作品来源：用户导入的文件和文件夹，支持 PNG、JPG、WebP、GIF、BMP、TIFF、SVG 和相机 RAW。
- 日期：优先读图片元数据，没有就用文件修改时间。
- 预览集、系列、作品归属、作品标题保存在应用数据目录的 `library.json`（tauri-plugin-store），格式见 ARCHITECTURE.md。
- 缩略图：在 Rust 端生成长边约 1600px 的 WebP 并缓存；前端先显示缩略图，在某一幅停留超过 300ms 再加载原图。

## 测试

- 移植 HANDOFF §7.2 的检查：在 mot = 1 时让 pos 从 0 扫到 n−1（步长 0.01），断言没有任何玻璃格和可见的玻璃后画作重叠。
- 弹簧和画作映射写成纯函数，单独做单元测试。

## 代码风格

- 标识符用英文，注释和界面文案用中文。
- 设计变量集中放在一个 `tokens.ts`（或 CSS 变量文件）里，名字和 HANDOFF §3 一致。
- 界面文案要补齐 12 种语言（`src/i18n.ts` 和 `src/locales/`）。

## 文档

- `ARCHITECTURE.md` 写代码结构、数据保存、发版流程。这些变了就同步改。
- `HANDOFF.md` 只放设计规范（布局、设计变量、组件、动效、算法），界面规格变了才改。
- 不写修改日志。每次改了什么写在提交信息和 Release 说明里。
