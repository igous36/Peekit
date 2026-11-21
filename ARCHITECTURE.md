# Peekit 架构

这份文档讲代码怎么组织、一帧怎么画出来、数据存在哪里。界面的尺寸、颜色、动画参数和算法公式在 [HANDOFF.md](HANDOFF.md)，原型 `design/prototype.dc.html` 是这些数值的来源。

## 整体

Peekit 是 Tauri 2 应用。Rust 端负责扫描文件夹、读日期和尺寸、生成缩略图、取 RAW 里的预览图，以及几个系统对话框。前端是原生 TypeScript，没有 UI 框架，也没有 3D 引擎，所有效果都靠 DOM 和 CSS 的 transform、opacity、filter、backdrop-filter。

前端只通过 `src/data/tauri-io.ts` 调 Rust。不在 Tauri 里运行时（`npm run dev` 直接开浏览器），作品库换成内置的示例数据，导入、刷新、检查更新这些功能不可用。

启动顺序在 `src/main.ts`：先写入设计变量，再定深浅色（这样第一帧就是对的颜色），然后初始化界面语言，读出保存的预览集，最后建 `App`。Rust 端在窗口出现前按上次的深浅换掉窗口底色，所以深色模式下启动不会先闪一下浅灰。

## 一帧怎么画出来

`src/controller.ts` 处理指针、滚轮和键盘输入，输入只改弹簧的目标值。它还持有唯一的 `requestAnimationFrame` 循环：每帧用 `engine/springs.ts` 推进所有弹簧（位置、镜头、按压、指针、玻璃运动系数），然后调用 `App.render()`。所有弹簧都静止后循环停下，有新的指针、滚轮或键盘输入时再启动。静止时不渲染，CPU 占用是 0。情绪板和拖起阵列的弹簧也在这个循环里推进（`App.stepExtra`），全部静止才停。

`App.render()`（`src/app.ts`）把运动状态算成每个元素的样式。计算全在 `src/engine/` 的纯函数里，比如画作映射和玻璃避让在 `engine/mapping.ts`，移植自原型的 `renderVals()`。`src/view/` 负责把结果写进 DOM，写之前经过 `view/dom.ts` 的 `Styled` 缓存，值没变就不写，所以静止的元素不会触发样式失效。

DOM 节点只建一次。舞台（`view/stage.ts`）有 40 个玻璃格、一个画作池和一个缩略图池。画作只渲染 |d| ≤ 2.65 的那几幅（最多 6 幅在范围内，其中最多 5 幅可见），缩略图池按需扩容。每帧只改 transform、opacity、filter 这类不触发重排的属性。

几条和性能直接相关的做法：

- 玻璃格的祖先元素不能有 opacity、filter 或 mask，否则 backdrop-filter 会失效。`backdrop-filter` 和 `-webkit-backdrop-filter` 同时写。
- 只有附近有玻璃后画作的格子才开模糊，其余格子下面只有纯色背景，关掉模糊看起来一样。
- 画作阴影是两层预先渲染好的固定阴影，每帧只改两层的透明度。
- 放大和全屏用一个单独的放大层（`view/magnifier.ts`），按全屏框排版，每帧只改 transform 和 opacity。mag 为 0 时它和舞台中间那张卡片完全重合，所以切换时没有跳变。
- 长按拖起时同样用一个替身接替中间那张卡片（`view/board-picker.ts`）。阵列的一百多个格子不各自做背景模糊，只有底下一层整窗磨砂。
- 情绪板画布（`view/board/board-view.ts`）按几千张照片设计，见下一节。

## 情绪板画布

所有照片放在一个容器里，镜头是这个容器的一个 transform。几千张照片时要注意的地方都是压测出来的（`PEEKIT_PERF=board`，见“测试和调试”）：

- 容器常驻 `will-change: transform`，平移、缩放只是合成器改矩阵，不重绘照片。镜头停下 160ms 后，倍率比上次栅格化时放大超过 8% 或缩小到不到 1/1.8，才去掉 will-change 一帧再加回来，让浏览器按新倍率重画一次（不然放大后会糊）。远景档也只在这时切换。
- 描边粗细（CSS 变量 `--bz`）在缩放过程中跟着连续更新，屏幕上一直是 1.5px：照片总数不超过 800 张时每帧更新，更多时每变 22% 更新一次。只在停下时更新的话，缩放中描边会跟着画布一起变粗变细，停下时再跳回来。
- 每帧只给弹簧在动、刚停下或状态变了的照片写样式。
- 视野裁剪：当前镜头和目标镜头的视野四周各外扩半屏，范围外的照片 `visibility: hidden`，也不加载图片。
- 图片分两档：照片多于 150 张的情绪板，照片在屏幕上的长边小于 320 物理像素时换成 384 的小缩略图，大于 380 时换回 1600 的（中间不动，来回缩放不会反复换）。几千张 1600px 的图同时解码太占内存；照片少时一直用 1600 的。只在镜头停下后换档，换图时先在后台解码好新图再换上，直接改 `src` 的话新图出来之前照片会空一下（缩放时一闪一闪）。
- 一张照片只有一个 div 和一张 img，描边、泛光、阴影都写在它自己的 box-shadow 里。不用伪元素，也不包一层 span：几千张时每个带层级的伪元素都是一个绘制层。
- 不要在照片和它的子元素、伪元素上写 `border-radius: inherit`。父元素每次改 transform，这一层继承都会让样式重算慢得出奇：1500 张一起移动时，一帧要 1–2 秒，而且越改越慢。换成直接写数值，就降到几十毫秒。
- 不给照片加 transition：缩放后更新 `--bz`，几千张会同时开始过渡动画。
- 视野里超过 600 张时进远景档，去掉泛光、阴影和圆角，只留描边（这时每张在屏幕上都很小）。照片不多的情绪板缩放时不切，泛光不会忽有忽无。
- 视野里超过 600 张时，四边的背景模糊换成底色渐隐。背景模糊在下面的内容大面积变化时很贵。
- 一次要移动超过 600 张时（一键优化等），画布整体淡出，换好位置再淡入，不逐张滑动。
- 聚焦时用一整块底色遮罩盖住其余照片，不逐张淡出。
- 标注是容器里最上面的一层（`.board-marks`）：便签和色卡各一个 div，直线、箭头和手绘画在同一个 SVG 里，每条线再叠一条透明的粗线专门接点击。标注只在增删改时动 DOM，镜头移动时不碰它们。
- 几何算法（吸附、找空地、连通分量、推开重叠、合成集合）都用网格空间索引（`engine/box-grid.ts`），只和附近的照片比较。等高行的线性划分只在合理的行宽范围里找断点。

## 目录

```
src/
  main.ts          启动
  app.ts           应用外壳：持有作品库，组装视图，render()
  controller.ts    rAF 循环、弹簧推进、指针 / 滚轮 / 键盘输入、导航
  engine/          纯函数，都有单测：弹簧、画作映射、玻璃避让、手势、滚轮档位、全屏缩放、
                   放大框、时间轴刻度、取主题色、月份、情绪板几何（board-layout）、网格空间索引（box-grid）、
                   拖起阵列（picker）、星级和按星筛选（rating）、主色组成和按颜色筛选（swatches）、
                   时间轴色条（barcode）、画师自检（checks）、命令面板搜索（search）、创作年历统计（calendar）、
                   新旧对比的配对和同步缩放（compare）、情绪板标注的数据和几何（marks）、
                   导出排版（export-layout）
  view/            DOM 视图：舞台、信息卡、时间轴、菜单、右键菜单、调色器（系列色；按颜色筛选的“任意颜色”用它的全范围模式）、关于对话框、
                   拖起阵列（board-picker.ts）、情绪板画布（board/，标注层在 board-marks.ts）、星星（stars.ts）、
                   自检工具条（check-bar.ts）、命令面板（palette.ts）、创作年历（calendar.ts）和
                   它导出的年度回顾图（year-poster.ts）、新旧对比（compare.ts）、
                   导出页（export-view.ts）、把排版画到画布上（export-render.ts）、
                   情绪板导出（export-board.ts）……
  data/            作品库模型、保存、导入和扫描、缩略图队列、取色队列、Rust 调用、
                   情绪板（boards.ts 数据和增删改，board-store.ts 保存）、
                   导出读图（export-images.ts）、PDF 写入（pdf.ts）
  locales/         除中文和英文以外的 10 种界面语言
  i18n.ts          中文、英文文案和语言切换
  tokens.ts        设计变量（名字和 HANDOFF §3 一致）
  theme.ts         浅色 / 深色 / 跟随系统
  transparency.ts  降低透明度（跟随系统或偏好设置，挂 <html data-transparency>）
  prefs.ts         偏好设置
  updater.ts       自动更新的状态机
  perf.ts          性能探针（还有置顶小窗、导出的自检）
  perf-board.ts    情绪板压测
  ref/             置顶参考小窗（另一个窗口里只跑这里）
src-tauri/src/
  lib.rs           命令注册和插件
  scan.rs          扫描导入的文件和文件夹，读尺寸，RAW 和同名 JPG 配对
  dates.rs         EXIF、XMP 日期
  thumbs.rs        缩略图和显示图
  color.rs         按图片里嵌的 ICC 配置文件把像素转成 sRGB
  raw.rs           从相机 RAW 里找内嵌的 JPEG 预览
  svg.rs           读 SVG 的尺寸
  asset_scope.rs   asset 协议的访问范围
  ui.rs            窗口底色、另存为、保存导出的文件（save_export）、置顶参考小窗（open_reference）
scripts/release.mjs  发版打包
scripts/bench-board.ts  情绪板几何算法的压测
```

## 作品库和保存

作品库存在应用数据目录（`app.peekit`）的 `library.json` 里，用 tauri-plugin-store 读写，key 是 `sets`。格式是 v3：一组预览集，每个预览集有自己的导入来源、系列、按文件路径记的归属、自定义标题、星级（`rating`，1–5，没打星就没有这个字段）、主色和扫描缓存（`src/data/library.ts`、`src/data/sets.ts`）。旧版的 `library` key 只在启动时读一次，迁移成第一个预览集。

新旧对比的配对也存在作品上（`pair`，另一幅的路径，两边互相指着）；对方被移除或指着别人时当作没有配对。

每幅作品还可以带主色组成（`swatches`，[[#RRGGBB, 占比], …]，按颜色筛选用）。平时浏览时计数圆环取主题色抓到像素，顺手算掉当前这幅；第一次按颜色筛选时由 `data/color-index.ts` 把没算过的补齐（最多同时 3 幅，没有缩略图的先生成）。文件改过（修改时间或大小变了）重新扫描时作废。

按星 / 按颜色筛选时，`App` 同时持有全部作品（`full`）和屏幕上显示的作品（`lib`）。不筛选时两者是同一个对象；筛选时 `lib.works` 是 `full.works` 的子集（同一批作品对象），`lib.series` 是转到 `full.series` 的存取器。按下标操作的地方（编辑、跳转、渲染）都用 `lib`；会换掉作品数组的操作（移除、删除系列、撤销）和保存都对着 `full` 做，然后从 `full` 重新得出 `lib`。筛选线只在内存里，不存盘。

导入过的文件夹每次启动都重新扫描，新加的图会自动出现。修改时间和大小都没变的文件直接复用上次读到的尺寸和日期。日期依次取 EXIF、XMP、文件修改时间，作品按日期从早到晚排，日期相同按文件名。

情绪板存在同一个文件的 `boards` key 里（`src/data/boards.ts`，version 1），和预览集互相独立：每个情绪板有名字、照片列表、集合列表和上次的镜头。照片按文件路径记（同一张图在一个情绪板里只放一次），带原图尺寸、缩略图缓存键要用的修改时间和大小、主色，以及在画布上的位置、大小和所属集合。标注（便签、色卡、直线和箭头、手绘）存在情绪板的 `marks` 里，坐标也是画布坐标，颜色是 `MARK_COLORS` 的下标；读回来时 `parseMarks` 丢掉格式不对的，空列表不写。集合只记 id 和颜色下标；哪些照片算一个集合由照片上的 group 决定，拖动、移除后按“互相贴着”重新拆分。从预览集移除作品、删掉预览集都不影响情绪板。

预览集修改后 800ms 写一次盘，情绪板 600ms。切换预览集前和安装更新前会立刻写盘（`LibraryService.flush()`、`BoardStore.flush()`），因为安装程序会直接关掉应用。

语言、深浅色、偏好设置（包括降低透明度，没拨过开关时是 null，表示跟随系统）、计数圆环的显示方式记在 localStorage（`peekit:` 开头的 key）。画师自检的开关只在内存里。

## 置顶参考小窗

Rust 的 `open_reference`（`ui.rs`）开一个无边框、透明、钉在最上面的新窗口，label 是 `ref-1`、`ref-2`…，加载同一个前端，地址带 `?ref=work&src=…` 或 `?ref=board&id=…`。`main.ts` 看到 `ref` 参数就只跑 `src/ref/reference.ts`，不建整个应用。小窗的权限在 `capabilities/reference.json`（窗口名 `ref-*`）：拖动、改大小、关闭、钉在最上面、读 library.json。

一幅画直接用原图地址（TIFF / RAW 是显示用大图，由主窗口算好传过去）。情绪板从 library.json 读，照片的缩略图在小窗里自己请求；主窗口每次把情绪板写进 store 后发一个 `peekit:boards-saved` 事件，小窗收到就重新读。主窗口关掉时（`lib.rs` 的 `on_window_event`）把所有 `ref-*` 窗口一起关掉。

`PEEKIT_PERF=ref`：启动后给当前作品和第一个有照片的情绪板各开一个小窗，小窗加载好会往终端打一行，6 秒后关掉主窗口（顺便检验小窗跟着关）。

## 导出

导出的文件（年度回顾图、长图、网格、拼图、PDF 作品集）都在前端用 canvas 画好，生成字节后交给 `saveExport`（`data/tauri-io.ts`）。桌面版调 Rust 的 `save_export`：文件内容走原始字节（不经过 JSON），默认文件名放在请求头 `x-file-name`（URL 编码），Rust 弹系统保存对话框（默认在“图片”文件夹）后先写临时文件再改名。浏览器调试时直接下载。画图用的图片从 asset 协议 fetch 成 blob 再 `createImageBitmap`，canvas 不会被“污染”，能导出。

作品导出（导出页）分三层：`engine/export-layout.ts` 只算坐标（纯函数，有单测）；`view/export-view.ts` 用同一份坐标摆 DOM 做预览（缩略图 + `loading=lazy`，不画画布）；点“导出”时 `view/export-render.ts` 才按导出尺寸读图、画到 canvas 上。读图（`data/export-images.ts`）按要画的大小挑来源：不比缩略图（长边 1600）大就用缩略图，更大才读原图（TIFF / RAW 是显示用大图）；`createImageBitmap` 解码时直接缩到要画的大小，最多同时读 3 幅，读一幅画一幅、马上释放。SVG 按要画的尺寸重新栅格化。

PDF 不引入库（`data/pdf.ts`）：每页先画成一张 canvas、压成 JPEG（质量 0.9），原样放进 PDF（DCTDecode）铺满整页，文字已经画在图里；标题写进文档信息（UTF-16BE）。长图受画布上限约束（单边 30000、面积 1.6 亿像素），超了整张等比缩小。

情绪板导出（`view/export-board.ts`）：`planBoardExport` 把照片和标注合起来的范围等比放进一张图，算出画布坐标到导出像素的缩放和偏移、网点间距；画的时候按情绪板里的先后顺序（后面的盖在前面上面）一张张读图画上去，最多先往后多读 3 张，再把标注按画布坐标重画一遍。canvas 的阴影不受变换影响，模糊和偏移要自己乘缩放。预览直接用画布上同一套 `.board-item` 样式和 `paintMarksStatic`。

导出设置记在 localStorage（`peekit:export`），作者名也在里面，情绪板模式的底色、留白这些另记在它的 `board` 里。导出里的 Peekit 标识是 `view/wordmark.ts` 里字标的笔画（canvas 上用 Path2D 描，预览里直接用 `markSvg`）。

`PEEKIT_PERF=export`：取前 8 幅读得了的作品，各导出一次长图（2 倍尺寸，会读原图）、3 列网格（PNG）、4:3 拼图、A4 横版 PDF，打出尺寸、大小、耗时，图片版抽查第一幅中间一块的色阶，然后关掉主窗口。不保存文件。

## 图片

缩略图由 Rust 生成：解码，按 EXIF 方向转正，缩到长边 1600，按图片里嵌的 ICC 配置文件转成 sRGB，编码成质量 82 的有损 WebP，缓存在应用缓存目录的 `thumbs/c1/`。缓存键是路径、修改时间、大小的 FNV-1a 哈希，原图改了会重新生成。生成时顺便算出主色，图片还没加载出来时用它做卡片底色。

色彩管理（`color.rs`，用 image 本来就依赖的 moxcms）：缩略图和 TIFF / RAW 的显示图是不带配置文件的 WebP，界面按 sRGB 显示；PNG、JPG、WebP 原图由 WebView2 直接显示，它会按原图里的配置文件做色彩管理。所以 Display P3、Adobe RGB 这些图要先转成 sRGB，停留 300ms 换成原图时颜色才不会跳。只处理 RGB 和灰度配置文件，解析不了的和 CMYK 照原样。HDR 编码（PQ、HLG）的配置文件也照原样：按相对色度转会把 PQ 的 1 万尼特当成白，缩略图几乎全黑，要转得先做色调映射。认 HDR 看配置文件的 CICP 标签，没有标签的用中灰试转（转出来太暗就当 HDR）。HDR 还有两处没处理：带增益图的 JPEG（Ultra HDR）缩略图只有基础的 SDR 图；32 位浮点 TIFF 按 0–1 截断，会偏暗。转换在缩小之后做，像素少，开销很小。复制图像用的原尺寸 PNG 不转（保留 16 位）。相机 JPEG 只用 EXIF 标记 Adobe RGB、没有嵌入配置文件的，两边都不认。

缩略图的生成方式变了（比如这次加色彩转换），就把 `thumbs.rs` 的 `CACHE_VERSION` 加一：新缩略图放进新的子目录，全部按需重新生成；启动时后台删掉上一级 `thumbs/` 里直接放着的旧文件。子目录还在 `tauri.conf.json` 的 `$APPCACHE/thumbs/**` 范围里。

情绪板缩得很小时用长边 384 的小缩略图（`make_thumbnail` 的 `edge` 参数，文件名后面加 `-384`）。有 1600 的缩略图时直接从它缩，比从原图快得多。

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

`src/updater.ts` 是状态机，Tauri 的调用从外面传进来，方便单测。启动 5 秒后、之后每 12 小时读一次更新清单：正式版读 `https://github.com/igous36/Peekit/releases/latest/download/latest.json`（标成 Latest 的 Release），测试版先读测试版通道 `releases/download/beta/latest.json`，读不到再读正式版的。地址和验签公钥写在 `src-tauri/tauri.conf.json` 里，前端改不了。用户点了“更新”才下载，下载完先写盘，再交给 NSIS 安装程序（passive 模式，装完自动重新打开应用）。更新插件用系统 TLS，不带 rustls，安装包只大了约 0.2 MiB。

更新包用私钥签名，私钥不在仓库里，默认在 `~/.tauri/peekit-updater.key`。私钥丢了，已经装上的版本就再也收不到更新。发版步骤：

1. 改 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 里的版本号。
2. 运行 `npm run release`，它会签名打包，并生成 `src-tauri/target/release/bundle/latest.json`。
3. 把 NSIS 安装包、MSI 和 `latest.json` 传到 GitHub Release，并设为 Latest。
4. 把同一个 `latest.json` 也传到测试版通道：`gh release upload beta <latest.json> --clobber`，装了测试版的人才会升到正式版。

测试版（版本号像 `0.2.0-beta.1`）：MSI 的版本号只能是数字，`npm run release` 会另给 MSI 一个 `0.2.0.1` 这样的版本号（取预发布号末尾的数字）。测试版的 Release 标成预发布，不设 Latest，所以装了正式版的人不会被自动更新到测试版。测试版的更新地址由 `npm run release` 换成测试版通道（tag 叫 `beta` 的预发布 Release，里面只有一个 `latest.json`，每次发测试版、正式版都用 `--clobber` 覆盖）。

0.2.0-beta.1 打包时还没有测试版通道，只会读 Latest。为了让它能升到 beta2，beta2 的 `latest.json` 也挂在了当时的 Latest（v0.1.3）上；v0.1.3 正式版本身没有自动更新，不会被推测试版。等 0.2.0 正式版设成 Latest，这份就用不上了。
不需要更新签名时，`npm run tauri build` 照常能用。

## 测试和调试

- `npm test`：前端单测（Vitest），覆盖 `engine/`、`data/` 的纯函数，包括 HANDOFF §7.2 的检查：mot = 1 时 pos 从 0 扫到 n − 1，任何玻璃格都不能和可见的玻璃后画作重叠；情绪板的吸附、等高行排布、集合拆分也在里面。
- `npm run dev` 打开的浏览器版里，情绪板存在 localStorage（`peekit:boards`），示例作品用色块画。
- `cargo test --manifest-path src-tauri/Cargo.toml`：Rust 单测。RAW 样张测试默认跳过，设了 `PEEKIT_RAW_SAMPLES` 才跑。
- `PEEKIT_PERF=1`：应用自己做一分钟左右的拖动、甩动、推拉，把帧时间打到终端后退出，不改保存的数据。
- `PEEKIT_PERF=board`：情绪板压测（`src/perf-board.ts`）。临时建 200、1000、2500 张照片的情绪板，用作品库里的真实图片，自动做打开、平移、缩放、聚焦、拖照片、框选、一键优化，再用 60 个情绪板测一次拖起阵列。每项打出帧率、render() 耗时和长任务，跑完关掉窗口，不保存。开发版里也可以在开发者工具里运行 `await boardStress()`，图片换成生成的测试图；不过浏览器面板不在屏幕上时 rAF 不跑，测不出帧率。
- `npx vite-node scripts/bench-board.ts`：情绪板几何算法在 200、1000、3000 张时各要多久。
- `PEEKIT_UPDATE_PROBE=check`、`download` 或 `install`：应用启动后自己检查更新，把每一步打到终端。`download` 只下载和验签，不安装。
- 发行版启动时会打一行“启动自检：设计变量已生效”。看不到这一行，说明样式被 CSP 拦掉了。

## 改代码时注意

- 动画数值以原型代码为准，不要自己调参数。情绪板不在原型里，数值以 HANDOFF §11 为准。
- 改情绪板照片的样式或结构之后，跑一遍 `PEEKIT_PERF=board`。几千张时，一个看着无害的写法（比如 `border-radius: inherit`）就能让帧率掉到个位数。
- 每帧只改不触发重排的属性，不要每帧重建 innerHTML；新元素放进对象池复用。
- 标识符用英文，注释和界面文案用中文。新加的文案要补齐 12 种语言。
- 设计变量集中在 `tokens.ts`，名字和 HANDOFF §3 一致。
- 系统开启“减少动态效果”时，关掉速度倾斜、镜头俯仰和玻璃避让，弹簧不回弹。
