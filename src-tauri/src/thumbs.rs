//! 缩略图：长边约 1600px 的有损 WebP，缓存在应用缓存目录 thumbs/ 里。
//! 缓存键 = 路径 + 修改时间 + 大小（FNV-1a），原图改了会自动重新生成。
//! 生成时顺便算出主色，前端在图片到位之前用它做底色。

use std::path::{Path, PathBuf};

use image::{DynamicImage, GenericImageView, ImageDecoder};
use serde::Serialize;
use tauri::{AppHandle, Manager};

pub const THUMB_EDGE: u32 = 1600;
const WEBP_QUALITY: f32 = 82.0;
/// 小缩略图（2026-11-19，情绪板压测后加）：情绪板缩得很小时，每张照片在屏幕上只有一两百像素，
/// 几千张 1600px 的缩略图同时解码太占内存、太慢，改用长边 384 的
pub const MINI_EDGE: u32 = 384;
const MINI_QUALITY: f32 = 78.0;

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

/// 小缩略图的文件名：和 1600 的同一个键，后面加 -384
pub fn mini_cache_name(path: &str, mtime: f64, size: u64) -> String {
    cache_name(path, mtime, size).replace(".webp", "-384.webp")
}

/// 解码并按 EXIF 方向转正（PNG / JPEG / WebP / GIF / BMP / TIFF；动图取第一帧，多页 TIFF 取第一页；
/// 相机 RAW 取内嵌的 JPEG 预览，见 raw.rs），连同图片里嵌的 ICC 配置文件（2026-11-20，色彩管理用，见 color.rs）。
/// min_edge 只对 RAW 有用：给了就挑“长边不小于它的最小那张”预览（缩略图用，解码快），否则挑最大的
pub fn decode_with_icc(src: &Path, min_edge: Option<u32>) -> Result<(DynamicImage, Option<Vec<u8>>), String> {
    if crate::raw::is_raw(src) {
        return crate::raw::decode_with_icc(src, min_edge);
    }
    let reader = image::ImageReader::open(src).map_err(|e| e.to_string())?;
    let reader = reader.with_guessed_format().map_err(|e| e.to_string())?;
    let mut decoder = reader.into_decoder().map_err(|e| e.to_string())?;
    let orientation = decoder.orientation().map_err(|e| e.to_string())?;
    // 读不出配置文件不算错（当作没有）
    let icc = decoder.icc_profile().ok().flatten();
    let mut img = DynamicImage::from_decoder(decoder).map_err(|e| e.to_string())?;
    img.apply_orientation(orientation);
    Ok((img, icc))
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

/// 解码（按 EXIF 方向转正）→ 缩到长边 1600 → 按 ICC 配置文件转成 sRGB → 有损 WebP；返回主色
pub fn generate(src: &Path, out: &Path) -> Result<String, String> {
    let (mut img, icc) = decode_with_icc(src, Some(THUMB_EDGE))?;
    let (w, h) = img.dimensions();
    if w.max(h) > THUMB_EDGE {
        img = img.thumbnail(THUMB_EDGE, THUMB_EDGE);
    }
    // 转换放在缩小之后：像素少，几毫秒的事
    let img = crate::color::to_srgb(img, icc.as_deref());
    let color = dominant_color(&img);
    write_webp(&img, out, WEBP_QUALITY)?;
    Ok(color)
}

/// 小缩略图：有 1600 的缩略图就从它缩（解码一张 WebP 比解码原图快得多），没有就从原图（RAW 挑小的内嵌预览）；返回主色
pub fn generate_mini(src: &Path, thumb: Option<&Path>, out: &Path) -> Result<String, String> {
    // 1600 的缩略图已经是 sRGB 了，从它缩不用再转；从原图缩要按配置文件转
    let (mut img, icc) = match thumb.filter(|t| t.exists()) {
        Some(t) => (image::open(t).map_err(|e| e.to_string())?, None),
        None => decode_with_icc(src, Some(MINI_EDGE))?,
    };
    let (w, h) = img.dimensions();
    if w.max(h) > MINI_EDGE {
        img = img.thumbnail(MINI_EDGE, MINI_EDGE);
    }
    let img = crate::color::to_srgb(img, icc.as_deref());
    let color = dominant_color(&img);
    write_webp(&img, out, MINI_QUALITY)?;
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
    let (img, icc) = decode_with_icc(src, if full { None } else { Some(DISPLAY_EDGE) })?;
    if full {
        // 复制用的原尺寸 PNG 保留原来的像素（16 位不降成 8 位），不做色彩转换
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
    // 看的大图是不带配置文件的 WebP：和缩略图一样先转成 sRGB
    let img = crate::color::to_srgb(img, icc.as_deref());
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
        Ok(dir) => {
            crate::asset_scope::allow(app, &dir, true);
            // 换了缓存版本：旧版本留在上一级 thumbs/ 里的文件后台删掉（只删文件，不碰子目录）
            if let Some(old) = dir.parent().map(Path::to_path_buf) {
                std::thread::spawn(move || remove_old_cache(&old));
            }
        }
        Err(e) => eprintln!("建缩略图目录失败: {e}"),
    }
}

/// 缓存版本（2026-11-20）：缩略图开始按 ICC 配置文件转 sRGB（color.rs），以前生成的颜色可能不对，
/// 换一个子目录，所有缩略图按需重新生成一次。以后缩略图的生成方式再变，就把这里加一。
/// 子目录还在 tauri.conf.json 的 $APPCACHE/thumbs/** 范围里
const CACHE_VERSION: &str = "c1";

fn thumbs_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("thumbs").join(CACHE_VERSION);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// 删掉 dir 里直接放着的旧缓存文件（webp / png / tmp），子目录（新版本的缓存）不动
fn remove_old_cache(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut n = 0;
    for e in entries.flatten() {
        let p = e.path();
        let old = p.is_file()
            && p.extension().and_then(|x| x.to_str()).is_some_and(|x| matches!(x, "webp" | "png" | "tmp"));
        if old && std::fs::remove_file(&p).is_ok() {
            n += 1;
        }
    }
    if n > 0 {
        println!("[peekit] 清掉旧版缩略图缓存 {n} 个");
    }
}

/// edge：不传是 1600 的缩略图；传 384（MINI_EDGE）是情绪板用的小缩略图
#[tauri::command]
pub async fn make_thumbnail(app: AppHandle, path: String, mtime: f64, size: u64, edge: Option<u32>) -> Result<Thumb, String> {
    // SVG 不生成缩略图：矢量原图本身就是最好的缩略图（所在文件夹 / 文件导入时已经放行）
    if crate::scan::is_svg(Path::new(&path)) {
        return Ok(Thumb { path, color: None });
    }
    let dir = thumbs_dir(&app)?;
    let mini = edge.is_some_and(|e| e <= MINI_EDGE);
    let out = dir.join(if mini { mini_cache_name(&path, mtime, size) } else { cache_name(&path, mtime, size) });
    if out.exists() {
        // 文件可能被系统重定向到别处（见 asset_scope.rs），按它的真实位置再放行一次
        crate::asset_scope::allow_real_file(&app, &out);
        return Ok(Thumb { path: out.to_string_lossy().into_owned(), color: None });
    }
    let target = out.clone();
    let big = dir.join(cache_name(&path, mtime, size));
    let thumb = tauri::async_runtime::spawn_blocking(move || {
        let color = if mini { generate_mini(Path::new(&path), Some(&big), &target)? } else { generate(Path::new(&path), &target)? };
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
    fn makes_mini_from_thumbnail() {
        let dir = std::env::temp_dir().join(format!("peekit-mini-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("big.png");
        image::RgbImage::from_pixel(2000, 3200, image::Rgb([40, 120, 200])).save(&src).unwrap();
        let thumb = dir.join("t.webp");
        generate(&src, &thumb).unwrap();
        let mini = dir.join("m.webp");
        generate_mini(&src, Some(&thumb), &mini).unwrap();
        assert_eq!(image::open(&mini).unwrap().dimensions(), (240, 384));
        // 没有 1600 的缩略图：直接从原图缩
        let mini2 = dir.join("m2.webp");
        generate_mini(&src, None, &mini2).unwrap();
        assert_eq!(image::open(&mini2).unwrap().dimensions(), (240, 384));
        assert_ne!(mini_cache_name("a.png", 1.0, 2), cache_name("a.png", 1.0, 2));
        std::fs::remove_dir_all(&dir).ok();
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

    /// 2026-11-20 色彩管理：带 Display P3 配置文件的 PNG，缩略图（不带配置文件的 WebP）要先转成 sRGB，
    /// 和 WebView2 按配置文件显示原图时的颜色一致；同样的像素不带配置文件就原样
    #[test]
    fn thumbnails_convert_icc_to_srgb() {
        use image::ImageEncoder;
        let dir = std::env::temp_dir().join(format!("peekit-icc-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let px = image::RgbImage::from_pixel(64, 64, image::Rgb([200, 100, 50]));
        let p3 = moxcms::ColorProfile::new_display_p3().encode().unwrap();
        let tagged = dir.join("p3.png");
        {
            let f = std::fs::File::create(&tagged).unwrap();
            let mut enc = image::codecs::png::PngEncoder::new(f);
            enc.set_icc_profile(p3).unwrap();
            enc.write_image(px.as_raw(), 64, 64, image::ExtendedColorType::Rgb8).unwrap();
        }
        let plain = dir.join("plain.png");
        px.save(&plain).unwrap();

        let (t1, t2) = (dir.join("p3.webp"), dir.join("plain.webp"));
        let c1 = generate(&tagged, &t1).unwrap();
        let c2 = generate(&plain, &t2).unwrap();
        let a = image::open(&t1).unwrap().get_pixel(32, 32);
        let b = image::open(&t2).unwrap().get_pixel(32, 32);
        // P3 的这个橙色在 sRGB 里更红、更少蓝（WebP 有损，留一点余量）
        assert!(a[0] > 205 && a[2] < 45, "转换后 {a:?}");
        assert!(b[0].abs_diff(200) <= 3 && b[2].abs_diff(50) <= 3, "没有配置文件 {b:?}");
        assert_ne!(c1, c2, "主色也按转过的算");
        std::fs::remove_dir_all(&dir).ok();
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
