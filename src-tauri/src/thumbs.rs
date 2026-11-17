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

/// 解码（按 EXIF 方向转正）→ 缩到长边 1600 → 有损 WebP；返回主色
pub fn generate(src: &Path, out: &Path) -> Result<String, String> {
    let reader = image::ImageReader::open(src).map_err(|e| e.to_string())?;
    let reader = reader.with_guessed_format().map_err(|e| e.to_string())?;
    let mut decoder = reader.into_decoder().map_err(|e| e.to_string())?;
    let orientation = decoder.orientation().map_err(|e| e.to_string())?;
    let mut img = DynamicImage::from_decoder(decoder).map_err(|e| e.to_string())?;
    img.apply_orientation(orientation);

    let (w, h) = img.dimensions();
    if w.max(h) > THUMB_EDGE {
        img = img.thumbnail(THUMB_EDGE, THUMB_EDGE);
    }
    let color = dominant_color(&img);

    let (tw, th) = img.dimensions();
    let encoded = if img.color().has_alpha() {
        let rgba = img.to_rgba8();
        webp::Encoder::from_rgba(&rgba, tw, th).encode(WEBP_QUALITY)
    } else {
        let rgb = img.to_rgb8();
        webp::Encoder::from_rgb(&rgb, tw, th).encode(WEBP_QUALITY)
    };
    // 先写临时文件再改名，避免前端读到写了一半的文件
    let tmp = out.with_extension("tmp");
    std::fs::write(&tmp, &*encoded).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, out).map_err(|e| e.to_string())?;
    Ok(color)
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
/// 配置里的 `$APPCACHE/thumbs/**` 是启动那一刻解析的，这里再按真实存在的目录补一条，更稳。
pub fn prepare(app: &AppHandle) {
    match thumbs_dir(app) {
        Ok(dir) => {
            if let Err(e) = app.asset_protocol_scope().allow_directory(&dir, true) {
                eprintln!("缩略图目录加入 asset 范围失败: {e}");
            }
        }
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
    let out = thumbs_dir(&app)?.join(cache_name(&path, mtime, size));
    if out.exists() {
        return Ok(Thumb { path: out.to_string_lossy().into_owned(), color: None });
    }
    tauri::async_runtime::spawn_blocking(move || {
        let color = generate(Path::new(&path), &out)?;
        Ok(Thumb { path: out.to_string_lossy().into_owned(), color: Some(color) })
    })
    .await
    .map_err(|e| e.to_string())?
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
}
