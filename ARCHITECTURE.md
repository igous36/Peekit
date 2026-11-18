# Peekit 架构

这份文档讲代码怎么组织、一帧怎么画出来、数据存在哪里。界面的尺寸、颜色、动画参数和算法公式在 [HANDOFF.md](HANDOFF.md)，原型 `design/prototype.dc.html` 是这些数值的来源。

## 整体

Peekit 是 Tauri 2 应用。Rust 端负责扫描文件夹、读日期和尺寸、生成缩略图、取 RAW 里的预览图，以及几个系统对话框。前端是原生 TypeScript，没有 UI 框架，也没有 3D 引擎，所有效果都靠 DOM 和 CSS 的 transform、opacity、filter、backdrop-filter。

前端只通过 `src/data/tauri-io.ts` 调 Rust。不在 Tauri 里运行时（`npm run dev` 直接开浏览器），作品库换成内置的示例数据，导入、刷新、检查更新这些功能不可用。

启动顺序在 `src/main.ts`：先写入设计变量，再定深浅色（这样第一帧就是对的颜色），然后初始化界面语言，读出保存的预览集，最后建 `App`。Rust 端在窗口出现前按上次的深浅换掉窗口底色，所以深色模式下启动不会先闪一下浅灰。

## 一帧怎么画出来

`src/controller.ts` 处理指针、滚轮和键盘输入，输入只改弹簧的目标值。它还持有唯一的 `requestAnimationFrame` 循环：每帧用 `engine/springs.ts` 推进所有弹簧（位置、镜头、按压、指针、玻璃运动系数），然后调用 `App.render()`。所有弹簧都静止后循环停下，有新的指针、滚轮或键盘输入时再启动。静止时不渲染，CPU 占用是 0。

`App.render()`（`src/app.ts`）把运动状态算成每个元素的样式。计算全在 `src/engine/` 的纯函数里，比如画作映射和玻璃避让在 `engine/mapping.ts`，移植自原型的 `renderVals()`。`src/view/` 负责把结果写进 DOM，写之前经过 `view/dom.ts` 的 `Styled` 缓存，值没变就不写，所以静止的元素不会触发样式失效。

DOM 节点只建一次。舞台（`view/stage.ts`）有 40 个玻璃格、一个画作池和一个缩略图池。画作只渲染 |d| ≤ 2.65 的那几幅（最多 6 幅在范围内，其中最多 5 幅可见），缩略图池按需扩容。每帧只改 transform、opacity、filter 这类不触发重排的属性。

几条和性能直接相关的做法：

- 玻璃格的祖先元素不能有 opacity、filter 或 mask，否则 backdrop-filter 会失效。`backdrop-filter` 和 `-webkit-backdrop-filter` 同时写。
- 只有附近有玻璃后画作的格子才开模糊，其余格子下面只有纯色背景，关掉模糊看起来一样。
- 画作阴影是两层预先渲染好的固定阴影，每帧只改两层的透明度。
- 放大和全屏用一个单独的放大层（`view/magnifier.ts`），按全屏框排版，每帧只改 transform 和 opacity。mag 为 0 时它和舞台中间那张卡片完全重合，所以切换时没有跳变。

## 目录

```
src/
  main.ts          启动
  app.ts           应用外壳：持有作品库，组装视图，render()
  controller.ts    rAF 循环、弹簧推进、指针 / 滚轮 / 键盘输入、导航
  engine/          纯函数，都有单测：弹簧、画作映射、玻璃避让、手势、滚轮档位、全屏缩放、
                   放大框、时间轴刻度、取主题色、月份
  view/            DOM 视图：舞台、信息卡、时间轴、菜单、右键菜单、调色器、关于对话框……
  data/            作品库模型、保存、导入和扫描、缩略图队列、取色队列、Rust 调用
  locales/         除中文和英文以外的 10 种界面语言
  i18n.ts          中文、英文文案和语言切换
  tokens.ts        设计变量（名字和 HANDOFF §3 一致）
  theme.ts         浅色 / 深色 / 跟随系统
  prefs.ts         偏好设置
  updater.ts       自动更新的状态机
  perf.ts          性能探针
src-tauri/src/
  lib.rs           命令注册和插件
  scan.rs          扫描导入的文件和文件夹，读尺寸，RAW 和同名 JPG 配对
  dates.rs         EXIF、XMP 日期
  thumbs.rs        缩略图和显示图
  raw.rs           从相机 RAW 里找内嵌的 JPEG 预览
  svg.rs           读 SVG 的尺寸
  asset_scope.rs   asset 协议的访问范围
  ui.rs            窗口底色、另存为
scripts/release.mjs  发版打包
```

## 作品库和保存

作品库存在应用数据目录（`app.peekit`）的 `library.json` 里，用 tauri-plugin-store 读写，key 是 `sets`。格式是 v3：一组预览集，每个预览集有自己的导入来源、系列、按文件路径记的归属、自定义标题、主色和扫描缓存（`src/data/library.ts`、`src/data/sets.ts`）。旧版的 `library` key 只在启动时读一次，迁移成第一个预览集。

导入过的文件夹每次启动都重新扫描，新加的图会自动出现。修改时间和大小都没变的文件直接复用上次读到的尺寸和日期。日期依次取 EXIF、XMP、文件修改时间，作品按日期从早到晚排，日期相同按文件名。

修改后 800ms 写一次盘。切换预览集前和安装更新前会立刻写盘（`LibraryService.flush()`），因为安装程序会直接关掉应用。

语言、深浅色、偏好设置、计数圆环的显示方式记在 localStorage（`peekit:` 开头的 key）。

## 图片

缩略图由 Rust 生成：解码，按 EXIF 方向转正，缩到长边 1600，编码成质量 82 的有损 WebP，缓存在应用缓存目录的 `thumbs/`。缓存键是路径、修改时间、大小的 FNV-1a 哈希，原图改了会重新生成。生成时顺便算出主色，图片还没加载出来时用它做卡片底色。

前端的缩略图队列（`data/thumb-loader.ts`）先生成离当前作品近的，最多同时 3 张，只预取前后 1500 幅以内的。在某一幅停留 300ms 后，如果屏幕上这张卡片需要的物理像素超过 1600，才加载原图。

不同格式的处理：

- PNG、JPG、WebP、GIF、BMP 直接显示，GIF 会动。
- TIFF 由 Rust 转成显示图（`make_display`）。
- SVG 不生成缩略图，直接显示矢量原图。
- 相机 RAW 取文件里内嵌的 JPEG 预览（`raw.rs`），同一文件夹里同名的 RAW 和 JPG 算一幅。

图片经 Tauri 的 asset 协议加载。这个协议会先把请求路径规范化（解开符号链接、目录联接）再和访问范围比对，所以 `asset_scope.rs` 会同时放行原路径和规范路径。图片显示 403 时，前端的 `diagnoseImage` 会把原因打到终端。

## 界面文字和外观

中文和英文写在 `src/i18n.ts`，其余 10 种语言在 `src/locales/`，每个文件的类型是 `Record<MessageKey, string>`，少一个键编译就会报错。默认跟随系统语言。不打包中文字体，用系统字体（Windows 微软雅黑，macOS 苹方），日语、繁体中文、韩语按 `<html lang>` 换成对应的系统字体。

设计变量只在 `src/tokens.ts` 定义一次，启动时写到 `:root` 上。发行版的 CSP 会拦掉动态插入的 `<style>`，所以运行时加样式只能用 CSSOM（`element.style`、可构造样式表）。深色模式靠 `<html data-theme="dark">` 切换变量。

## 自动更新和发版

`src/updater.ts` 是状态机，Tauri 的调用从外面传进来，方便单测。启动 5 秒后、之后每 12 小时读一次 `https://github.com/igous36/Peekit/releases/latest/download/latest.json`。地址和验签公钥写在 `src-tauri/tauri.conf.json` 里，前端改不了。用户点了“更新”才下载，下载完先写盘，再交给 NSIS 安装程序（passive 模式，装完自动重新打开应用）。更新插件用系统 TLS，不带 rustls，安装包只大了约 0.2 MiB。

更新包用私钥签名，私钥不在仓库里，默认在 `~/.tauri/peekit-updater.key`。私钥丢了，已经装上的版本就再也收不到更新。发版步骤：

1. 改 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 里的版本号。
2. 运行 `npm run release`，它会签名打包，并生成 `src-tauri/target/release/bundle/latest.json`。
3. 把 NSIS 安装包、MSI 和 `latest.json` 传到 GitHub Release，并设为 Latest。

不需要更新签名时，`npm run tauri build` 照常能用。

## 测试和调试

- `npm test`：前端单测（Vitest），覆盖 `engine/`、`data/` 的纯函数，包括 HANDOFF §7.2 的检查：mot = 1 时 pos 从 0 扫到 n − 1，任何玻璃格都不能和可见的玻璃后画作重叠。
- `cargo test --manifest-path src-tauri/Cargo.toml`：Rust 单测。RAW 样张测试默认跳过，设了 `PEEKIT_RAW_SAMPLES` 才跑。
- `PEEKIT_PERF=1`：应用自己做一分钟左右的拖动、甩动、推拉，把帧时间打到终端后退出，不改保存的数据。
- `PEEKIT_UPDATE_PROBE=check`、`download` 或 `install`：应用启动后自己检查更新，把每一步打到终端。`download` 只下载和验签，不安装。
- 发行版启动时会打一行“启动自检：设计变量已生效”。看不到这一行，说明样式被 CSP 拦掉了。

## 改代码时注意

- 动画数值以原型代码为准，不要自己调参数。
- 每帧只改不触发重排的属性，不要每帧重建 innerHTML；新元素放进对象池复用。
- 标识符用英文，注释和界面文案用中文。新加的文案要补齐 12 种语言。
- 设计变量集中在 `tokens.ts`，名字和 HANDOFF §3 一致。
- 系统开启“减少动态效果”时，关掉速度倾斜、镜头俯仰和玻璃避让，弹簧不回弹。
