# Peekit

A modern image & illustration viewer.

Peekit is a desktop viewer for artists to browse their own work. You push the paintings along a timeline by hand: drag sideways and the artworks slide past, the ones you drag away sink behind a pane of frosted glass. Drag down and the camera pulls back to reveal the rest of the series.

> Peekit 是给画师自己看作品用的桌面插画浏览器。左右拖动沿时间轴浏览，被拖走的画作沉到磨砂玻璃后面；向下拖动拉远镜头，同系列的作品从上下浮现。界面支持中文、英语、阿拉伯语、法语、俄语、西班牙语、德语、意大利语、韩语、葡萄牙语 10 种语言。

## Features

- **Timeline browsing**: 1:1 drag with spring physics, inertia snapping and rubber-banding at both ends. Up to three paintings sit in front of the glass; the rest sink behind it while the glass tiles part around them and close again when you stop.
- **Series view**: drag down (or press ↓) to zoom out and see every work in the same series.
- **Enlarge and fullscreen**: hold, drag up or scroll up to enlarge a painting; keep going (or double-click / F11) for fullscreen on a dark background, where the mouse wheel zooms around the cursor and you can drag to pan.
- **Your own library**: import image files or whole folders (menu or drag & drop). Folders are remembered and rescanned on launch or with View → Refresh (F5). Supports PNG, JPG, WebP, GIF (animated), BMP, TIFF and SVG.
- **Collections**: keep separate preview collections and switch between them; create, rename, duplicate and delete them from the menu.
- **Dates from metadata**: EXIF, then XMP, then the file's modified time. Works are ordered from oldest to newest.
- **Series and titles**: rename series, move works between series, create new ones; give any work a custom title while keeping the original file name. Works imported from a folder are grouped into a series named after that folder.
- **Cards follow the artwork's aspect ratio**, with the same visual weight for portrait, square and landscape pieces.
- **Fast**: native TypeScript and plain DOM + CSS transforms, one `requestAnimationFrame` loop that stops when everything is at rest. 1600 px WebP thumbnails are generated and cached by the Rust side.
- **Keyboard, mouse and trackpad**: ← → to switch; ↑ ↓ to move between series, single, enlarged and fullscreen views; Esc to go back; F11 for fullscreen; F5 to refresh. Each mouse-wheel notch moves one level; two-finger swipes work on a trackpad.
- **10 interface languages**: Chinese, English, Arabic, French, Russian, Spanish, German, Italian, Korean and Portuguese, following the system language by default.
- **Light, dark or system** appearance.
- Respects the system's *reduce motion* setting.

## Tech stack

- [Tauri 2](https://tauri.app/) (Rust) + [Vite](https://vite.dev/) + native TypeScript — no UI framework, no 3D engine
- Rust: `image` + `webp` for thumbnails, `kamadak-exif` for dates, `tauri-plugin-store` for saving, `tauri-plugin-dialog` for file pickers

## Development

Prerequisites:

- Node.js 18+
- Rust (stable) and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your platform (on Windows: Microsoft C++ Build Tools and WebView2)

```bash
npm install
npm run tauri dev        # run the app with hot reload
npm test                 # front-end unit tests (Vitest)
cargo test --manifest-path src-tauri/Cargo.toml   # Rust unit tests
npm run tauri build      # release build + installers (MSI / NSIS on Windows)
```

`npm run dev` alone serves the UI in a browser with built-in sample data, which is handy for layout work (importing only works in the desktop app).

Performance check: start the app with `PEEKIT_PERF=1` set and it will drive itself through drags, flings and zooms for about a minute, print frame-time statistics to the terminal, then close. It never touches your saved library.

## Project layout

```
src/                 front end (TypeScript)
  engine/            pure functions: springs, gestures, layout mapping, glass avoidance
  view/              DOM views, each node created once and reused
  data/              library model, saving, import, thumbnail queue
  locales/           interface translations (Chinese and English live in i18n.ts)
  app.ts, controller.ts, i18n.ts, tokens.ts
src-tauri/src/       Rust: folder scanning, dates, thumbnails
design/              original interactive prototype and spec boards
HANDOFF.md           full design & development spec (layout, tokens, motion, algorithms)
CLAUDE.md            architecture notes
docs/                the original design hand-off notes
```

Your library is stored in `library.json` in the app data directory (`app.peekit`); thumbnails are cached in the app cache directory.

## License

[GPL-3.0](LICENSE)
