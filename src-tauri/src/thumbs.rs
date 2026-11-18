//! 缩略图：长边约 1600px 的有损 WebP，缓存在应用缓存目录 thumbs/ 里。
//! 缓存键 = 路径 + 修改时间 + 大小（FNV-1a），原图改了会自动重新生成。
//! 生成时顺便算出主色，前端在图片到位之前用它做底色。

use std::path::{Path, PathBuf};

use image::{DynamicImage, GenericImageView, ImageDecoder};
use serde::Serialize;
use tauri::{AppHandle, Manager};

pub const THUMB_EDGE: u32 = 1600;
const WEBP_QUALITY: f32 = 82.0;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Thumb {
    /// 缓存文件的绝对路径（前端用 convertFileSrc 转成 URL）
    pub path: String,
    /// 新生成时附带主色（#rrggbb）；命中缓存时为空，前端用保存过的值
    pub color: Option<String>,
}

/// FNV-1a 64：稳定、跨版本不变
pub fn fnv1a(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

pub fn cache_name(path: &str, mtime: f64, size: u64) -> String {
    let key = format!("{path}\u{0}{}\u{0}{size}", mtime as u64);
    format!("{:016x}.webp", fnv1a(key.as_bytes()))
}

/// 解码并按 EXIF 方向转正（PNG / JPEG / WebP / GIF / BMP / TIFF；动图取第一帧，多页 TIFF 取第一页；
/// 相机 RAW 取内嵌的 JPEG 预览，见 raw.rs）。
/// min_edge 只对 RAW 有用：给了就挑“长边不小于它的最小那张”预览（缩略图用，解码快），否则挑最大的
pub fn decode_for(src: &Path, min_edge: Option<u32>) -> Result<DynamicImage, String> {
    if crate::raw::is_raw(src) {
        return crate::raw::decode(src, min_edge);
    }
    let reader = image::ImageReader::open(src).map_err(|e| e.to_string())?;
    let reader = reader.with_guessed_format().map_err(|e| e.to_string())?;
    let mut decoder = reader.into_decoder().map_err(|e| e.to_string())?;
    let orientation = decoder.orientation().map_err(|e| e.to_string())?;
    let mut img = DynamicImage::from_decoder(decoder).map_err(|e| e.to_string())?;
    img.apply_orientation(orientation);
    Ok(img)
}

/// 编码成有损 WebP 并写到 out：先写临时文件再改名，避免前端读到写了一半的文件
fn write_webp(img: &DynamicImage, out: &Path, quality: f32) -> Result<(), String> {
    let (w, h) = img.dimensions();
    let encoded = if img.color().has_alpha() {
        let rgba = img.to_rgba8();
        webp::Encoder::from_rgba(&rgba, w, h).encode(quality)
    } else {
        let rgb = img.to_rgb8();
        webp::Encoder::from_rgb(&rgb, w, h).encode(quality)
    };
    let tmp = out.with_extension("tmp");
    std::fs::write(&tmp, &*encoded).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, out).map_err(|e| e.to_string())
}

/// 解码（按 EXIF 方向转正）→ 缩到长边 1600 → 有损 WebP；返回主色
pub fn generate(src: &Path, out: &Path) -> Result<String, String> {
    let mut img = decode_for(src, Some(THUMB_EDGE))?;
    let (w, h) = img.dimensions();
    if w.max(h) > THUMB_EDGE {
        img = img.thumbnail(THUMB_EDGE, THUMB_EDGE);
    }
    let color = dominant_color(&img);
    write_webp(&img, out, WEBP_QUALITY)?;
    Ok(color)
}

// ───────────── 显示用大图（2026-11-17 新增） ─────────────
//
// 界面（WebView2）不能直接显示 TIFF 和相机 RAW。放大查看 / 全屏时要比 1600px 缩略图更清楚的图，
// 复制图像时要完整的原图像素，这两种都由这里从原图生成并缓存在缩略图目录里：
// - 看（full = false）：长边不超过 4096 的高质量 WebP（够 4K 屏全屏）
// - 复制（full = true）：原尺寸 PNG（剪贴板只认 PNG）

/// 显示用大图的长边上限（px）
pub const DISPLAY_EDGE: u32 = 4096;
const DISPLAY_QUALITY: f32 = 90.0;

pub fn display_cache_name(path: &str, mtime: f64, size: u64, full: bool) -> String {
    let key = format!("{path}\u{0}{}\u{0}{size}\u{0}{}", mtime as u64, if full { "png" } else { "display" });
    format!("{:016x}.{}", fnv1a(key.as_bytes()), if full { "png" } else { "webp" })
}

pub fn generate_display(src: &Path, out: &Path, full: bool) -> Result<(), String> {
    // RAW：看大图挑够 4096 的最小预览（没有就最大的）；复制挑最大的
    let img = decode_for(src, if full { None } else { Some(DISPLAY_EDGE) })?;
    if full {
        let tmp = out.with_extension("tmp");
        img.save_with_format(&tmp, image::ImageFormat::Png).map_err(|e| e.to_string())?;
        return std::fs::rename(&tmp, out).map_err(|e| e.to_string());
    }
    let (w, h) = img.dimensions();
    let img = if w.max(h) > DISPLAY_EDGE {
        img.resize(DISPLAY_EDGE, DISPLAY_EDGE, image::imageops::FilterType::CatmullRom)
    } else {
        img
    };
    write_webp(&img, out, DISPLAY_QUALITY)
}

/// 前端在放大查看 / 复制 TIFF 时调用：返回显示用大图的路径（有缓存就直接用）
#[tauri::command]
pub async fn make_display(app: AppHandle, path: String, mtime: f64, size: u64, full: bool) -> Result<String, String> {
    let out = thumbs_dir(&app)?.join(display_cache_name(&path, mtime, size, full));
    if !out.exists() {
        let target = out.clone();
        tauri::async_runtime::spawn_blocking(move || generate_display(Path::new(&path), &target, full))
            .await
            .map_err(|e| e.to_string())??;
    }
    crate::asset_scope::allow_real_file(&app, &out);
    Ok(out.to_string_lossy().into_owned())
}

/// 主色：缩到 8×8 后按不透明度加权平均
pub fn dominant_color(img: &DynamicImage) -> String {
    let small = img.thumbnail_exact(8, 8).to_rgba8();
    let (mut r, mut g, mut b, mut wsum) = (0f64, 0f64, 0f64, 0f64);
    for p in small.pixels() {
        let a = p[3] as f64 / 255.0;
        r += p[0] as f64 * a;
        g += p[1] as f64 * a;
        b += p[2] as f64 * a;
        wsum += a;
    }
    if wsum < 1e-6 {
        return "#F2F2F0".into();
    }
    format!("#{:02X}{:02X}{:02X}", (r / wsum) as u8, (g / wsum) as u8, (b / wsum) as u8)
}

/// 启动时调用：先建好缩略图目录，再把它加进 asset 协议的允许范围。
/// 配置里的 `$APPCACHE/thumbs/**` 只认“看上去的路径”；目录被系统重定向时（见 asset_scope.rs）
/// 规范路径对不上，所以这里按真实存在的目录再补两条。
pub fn prepare(app: &AppHandle) {
    match thumbs_dir(app) {
        Ok(dir) => crate::asset_scope::allow(app, &dir, true),
        Err(e) => eprintln!("建缩略图目录失败: {e}"),
    }
}

fn thumbs_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("thumbs");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[tauri::command]
pub async fn make_thumbnail(app: AppHandle, path: String, mtime: f64, size: u64) -> Result<Thumb, String> {
    // SVG 不生成缩略图：矢量原图本身就是最好的缩略图（所在文件夹 / 文件导入时已经放行）
    if crate::scan::is_svg(Path::new(&path)) {
        return Ok(Thumb { path, color: None });
    }
    let out = thumbs_dir(&app)?.join(cache_name(&path, mtime, size));
    if out.exists() {
        // 文件可能被系统重定向到别处（见 asset_scope.rs），按它的真实位置再放行一次
        crate::asset_scope::allow_real_file(&app, &out);
        return Ok(Thumb { path: out.to_string_lossy().into_owned(), color: None });
    }
    let target = out.clone();
    let thumb = tauri::async_runtime::spawn_blocking(move || {
        let color = generate(Path::new(&path), &target)?;
        Ok::<_, String>(Thumb { path: target.to_string_lossy().into_owned(), color: Some(color) })
    })
    .await
    .map_err(|e| e.to_string())??;
    crate::asset_scope::allow_real_file(&app, &out);
    Ok(thumb)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fnv_is_stable() {
        assert_eq!(fnv1a(b""), 0xcbf2_9ce4_8422_2325);
        assert_eq!(fnv1a(b"a"), 0xaf63_dc4c_8601_ec8c);
        assert_ne!(cache_name("a.png", 1.0, 2), cache_name("a.png", 1.0, 3));
    }

    #[test]
    fn makes_webp_thumbnail_and_color() {
        let dir = std::env::temp_dir().join(format!("peekit-thumb-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("big.png");
        // 2000×3200 的纯色竖图：缩略图应该是 1000×1600
        image::RgbImage::from_pixel(2000, 3200, image::Rgb([200, 120, 40])).save(&src).unwrap();
        let out = dir.join("t.webp");
        let color = generate(&src, &out).unwrap();
        assert_eq!(color, "#C87828");
        let t = image::open(&out).unwrap();
        assert_eq!(t.dimensions(), (1000, 1600));

        // 小图不放大
        let small = dir.join("small.png");
        image::RgbaImage::new(300, 200).save(&small).unwrap();
        let out2 = dir.join("s.webp");
        generate(&small, &out2).unwrap();
        assert_eq!(image::open(&out2).unwrap().dimensions(), (300, 200));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn gif_bmp_tiff_make_thumbnails() {
        let dir = std::env::temp_dir().join(format!("peekit-fmt-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let img = image::RgbImage::from_pixel(64, 48, image::Rgb([40, 120, 200]));
        for ext in ["gif", "bmp", "tif"] {
            let src = dir.join(format!("a.{ext}"));
            img.save(&src).unwrap();
            assert!(crate::scan::is_image(&src), "{ext}");
            let out = dir.join(format!("{ext}.webp"));
            let color = generate(&src, &out).unwrap_or_else(|e| panic!("{ext}: {e}"));
            assert_eq!(image::open(&out).unwrap().dimensions(), (64, 48), "{ext}");
            assert!(color.starts_with('#'), "{ext}");
        }
        std::fs::remove_dir_all(&dir).ok();
    }

    /// 手动跑：用一个真实图片文件夹检查每张都能出缩略图（SVG 检查能读出尺寸）。
    /// `PEEKIT_SAMPLES=D:\some\dir cargo test --lib real_samples -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn real_samples() {
        let dir = std::env::var("PEEKIT_SAMPLES").expect("设置 PEEKIT_SAMPLES 为图片文件夹");
        let out_dir = std::env::temp_dir().join(format!("peekit-samples-{}", std::process::id()));
        std::fs::create_dir_all(&out_dir).unwrap();
        for e in std::fs::read_dir(&dir).unwrap() {
            let p = e.unwrap().path();
            if !crate::scan::is_image(&p) {
                continue;
            }
            let name = p.file_name().unwrap().to_string_lossy().into_owned();
            if crate::scan::is_svg(&p) {
                println!("{name}: SVG 尺寸 {:?}", crate::svg::svg_size(&p));
                continue;
            }
            let out = out_dir.join(format!("{name}.webp"));
            let t = std::time::Instant::now();
            match generate(&p, &out) {
                Ok(c) => println!("{name}: 缩略图 {:?} 主色 {c}，{} ms", image::open(&out).unwrap().dimensions(), t.elapsed().as_millis()),
                Err(err) => panic!("{name}: {err}"),
            }
        }
        std::fs::remove_dir_all(&out_dir).ok();
    }

    #[test]
    fn display_images_for_tiff() {
        let dir = std::env::temp_dir().join(format!("peekit-disp-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("big.tiff");
        image::RgbImage::from_pixel(5000, 2500, image::Rgb([10, 20, 30])).save(&src).unwrap();
        // 看：长边缩到 4096 的 WebP
        let view = dir.join("v.webp");
        generate_display(&src, &view, false).unwrap();
        assert_eq!(image::open(&view).unwrap().dimensions(), (4096, 2048));
        // 复制：原尺寸 PNG
        let full = dir.join("f.png");
        generate_display(&src, &full, true).unwrap();
        assert_eq!(image::open(&full).unwrap().dimensions(), (5000, 2500));
        // 缓存名：看 / 复制分开，扩展名不同
        assert_ne!(display_cache_name("a", 1.0, 2, false), display_cache_name("a", 1.0, 2, true));
        assert!(display_cache_name("a", 1.0, 2, true).ends_with(".png"));
        std::fs::remove_dir_all(&dir).ok();
    }
}
