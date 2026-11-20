//! 色彩管理（2026-11-20）：图片里带了 ICC 配置文件（Display P3、Adobe RGB 这些）时，
//! 生成缩略图和显示图之前先把像素转成 sRGB。
//!
//! 为什么要转：缩略图是不带配置文件的 WebP，界面按 sRGB 显示它；原图（PNG / JPG / WebP）由 WebView2 直接显示，
//! 它会读原图里的配置文件做色彩管理。不转的话，iPad 上用 Display P3 画布导出的图、Photoshop 里存成 Adobe RGB 的图，
//! 缩略图会比原图灰、淡，停留 300ms 换成原图时颜色会“跳”一下。转过之后两者一致，主色、主题色也按转过的算。
//!
//! 用 moxcms（纯 Rust，image crate 本来就依赖它，不增加下载）。只处理 RGB 和灰度配置文件；
//! 解析不了的配置文件、CMYK 这些照原样不转（和原来一样）。缩略图、显示图都是 8 位，转换在缩放之后做，开销很小。
//! 已知不管的情况：相机 JPEG 用 EXIF 标记 Adobe RGB 但没有嵌入配置文件的（WebView2 显示原图时也不认）。
//!
//! HDR 编码的配置文件（PQ、HLG）不转，照原样（和加色彩管理之前一样）：按相对色度换到 sRGB 会把 PQ 的 1 万尼特当成白，
//! 日常亮度（203 尼特，代码值约 148）被压到 39 左右，缩略图几乎全黑。要做得好得先做色调映射，这里不做。
//! 认 HDR 先看配置文件里的 CICP 标签（PQ / HLG）；没有这个标签的老式 PQ 配置文件，用一个中灰试转：
//! 普通的 SDR 配置文件（gamma 1.8–2.6、sRGB、线性）中灰 128 转出来在 110–190 之间，转出来不到 64 就当 HDR

use image::{DynamicImage, GrayAlphaImage, GrayImage, RgbImage, RgbaImage};
use moxcms::{ColorProfile, DataColorSpace, Layout, TransferCharacteristics, TransformOptions};

/// 中灰试转低于这个值，当作 HDR 编码的配置文件（见文件开头）
const HDR_PROBE_MIN: u8 = 64;

/// 配置文件的 CICP 标签写明是 PQ 或 HLG
fn tagged_hdr(p: &ColorProfile) -> bool {
    p.cicp.as_ref().is_some_and(|c| {
        matches!(c.transfer_characteristics, TransferCharacteristics::Smpte2084 | TransferCharacteristics::Hlg)
    })
}

/// 按 src 配置文件把 input（src_layout 排列）转成 sRGB（dst_layout 排列，每像素 dst_channels 个字节）。
/// 中灰试转太暗（HDR 编码）或者转换失败返回 None
fn convert(src: &ColorProfile, src_layout: Layout, dst_layout: Layout, input: &[u8], pixels: usize) -> Option<Vec<u8>> {
    let dst = ColorProfile::new_srgb();
    let tr = src.create_transform_8bit(src_layout, &dst, dst_layout, TransformOptions::default()).ok()?;
    let (src_ch, dst_ch) = (src_layout.channels(), dst_layout.channels());
    // 中灰（有透明度的那一位填不透明）
    let probe: Vec<u8> = (0..src_ch).map(|i| if src_layout.has_alpha() && i == src_ch - 1 { 255 } else { 128 }).collect();
    let mut probe_out = vec![0u8; dst_ch];
    tr.transform(&probe, &mut probe_out).ok()?;
    if probe_out[0] < HDR_PROBE_MIN {
        return None;
    }
    let mut out = vec![0u8; pixels * dst_ch];
    tr.transform(input, &mut out).ok()?;
    Some(out)
}

/// 按图片自带的 ICC 配置文件把像素转成 sRGB；没有配置文件、解析不了、不是 RGB / 灰度、或者是 HDR 编码的，原样返回
pub fn to_srgb(img: DynamicImage, icc: Option<&[u8]>) -> DynamicImage {
    let Some(icc) = icc.filter(|b| !b.is_empty()) else { return img };
    let Ok(src) = ColorProfile::new_from_slice(icc) else { return img };
    if tagged_hdr(&src) {
        return img;
    }
    let (w, h) = (img.width(), img.height());
    let n = (w as usize) * (h as usize);
    let alpha = img.color().has_alpha();
    let converted = match (src.color_space, alpha) {
        (DataColorSpace::Rgb, true) => convert(&src, Layout::Rgba, Layout::Rgba, img.to_rgba8().as_raw(), n)
            .and_then(|v| RgbaImage::from_raw(w, h, v).map(DynamicImage::ImageRgba8)),
        (DataColorSpace::Rgb, false) => convert(&src, Layout::Rgb, Layout::Rgb, img.to_rgb8().as_raw(), n)
            .and_then(|v| RgbImage::from_raw(w, h, v).map(DynamicImage::ImageRgb8)),
        // 灰度配置文件（比如 Gray Gamma 2.2、Dot Gain）：转成 sRGB 的灰
        (DataColorSpace::Gray, true) => {
            let la: GrayAlphaImage = img.to_luma_alpha8();
            convert(&src, Layout::GrayAlpha, Layout::Rgba, la.as_raw(), n)
                .and_then(|v| RgbaImage::from_raw(w, h, v).map(DynamicImage::ImageRgba8))
        }
        (DataColorSpace::Gray, false) => {
            let l: GrayImage = img.to_luma8();
            convert(&src, Layout::Gray, Layout::Rgb, l.as_raw(), n)
                .and_then(|v| RgbImage::from_raw(w, h, v).map(DynamicImage::ImageRgb8))
        }
        _ => None,
    };
    converted.unwrap_or(img)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::GenericImageView;

    fn rgb_at(img: &DynamicImage) -> [u8; 3] {
        let p = img.get_pixel(0, 0);
        [p[0], p[1], p[2]]
    }

    #[test]
    fn no_profile_or_bad_profile_is_untouched() {
        let img = DynamicImage::ImageRgb8(RgbImage::from_pixel(4, 4, image::Rgb([200, 100, 50])));
        assert_eq!(rgb_at(&to_srgb(img.clone(), None)), [200, 100, 50]);
        assert_eq!(rgb_at(&to_srgb(img.clone(), Some(b""))), [200, 100, 50]);
        assert_eq!(rgb_at(&to_srgb(img, Some(b"not an icc profile"))), [200, 100, 50]);
    }

    #[test]
    fn srgb_profile_is_identity() {
        let icc = ColorProfile::new_srgb().encode().unwrap();
        let img = DynamicImage::ImageRgb8(RgbImage::from_pixel(4, 4, image::Rgb([200, 100, 50])));
        let out = rgb_at(&to_srgb(img, Some(&icc)));
        for (a, b) in out.iter().zip([200u8, 100, 50]) {
            assert!(a.abs_diff(b) <= 1, "{out:?}");
        }
    }

    #[test]
    fn display_p3_becomes_more_saturated_in_srgb() {
        // Display P3 里不太饱和的橙色，换到 sRGB 要更饱和（红更高、蓝更低）才是同一个颜色
        let icc = ColorProfile::new_display_p3().encode().unwrap();
        let img = DynamicImage::ImageRgb8(RgbImage::from_pixel(4, 4, image::Rgb([200, 100, 50])));
        let [r, g, b] = rgb_at(&to_srgb(img, Some(&icc)));
        assert!(r > 205 && b < 45, "{r} {g} {b}");
        // 带透明度的也转，透明度不变
        let rgba = DynamicImage::ImageRgba8(RgbaImage::from_pixel(2, 2, image::Rgba([200, 100, 50, 77])));
        let out = to_srgb(rgba, Some(&icc));
        assert_eq!(out.get_pixel(1, 1)[3], 77);
        assert!(out.get_pixel(1, 1)[0] > 205);
    }

    /// HDR 编码（PQ、HLG）的配置文件不转：按相对色度转会把 PQ 的日常亮度压得几乎全黑（148 → 39）
    #[test]
    fn hdr_profiles_are_left_alone() {
        let img = || DynamicImage::ImageRgb8(RgbImage::from_pixel(2, 2, image::Rgb([148, 148, 148])));
        for p in [ColorProfile::new_display_p3_pq(), ColorProfile::new_bt2020_pq(), ColorProfile::new_bt2020_hlg()] {
            assert!(tagged_hdr(&p));
            let icc = p.encode().unwrap();
            assert_eq!(rgb_at(&to_srgb(img(), Some(&icc))), [148, 148, 148]);
        }
        // 没有 CICP 标签的老式 PQ 配置文件：中灰试转太暗，也不转
        let mut bare = ColorProfile::new_display_p3_pq();
        bare.cicp = None;
        let icc = bare.encode().unwrap();
        let parsed = ColorProfile::new_from_slice(&icc).unwrap();
        assert!(!tagged_hdr(&parsed));
        assert_eq!(rgb_at(&to_srgb(img(), Some(&icc))), [148, 148, 148]);
    }

    /// 普通的 SDR 配置文件中灰试转都在门槛以上（不会被误当成 HDR）
    #[test]
    fn sdr_profiles_pass_the_probe() {
        let gray = DynamicImage::ImageRgb8(RgbImage::from_pixel(1, 1, image::Rgb([128, 128, 128])));
        for p in [
            ColorProfile::new_srgb(),
            ColorProfile::new_display_p3(),
            ColorProfile::new_adobe_rgb(),
            ColorProfile::new_gray_with_gamma(1.8),
        ] {
            let icc = p.encode().unwrap();
            let [r, ..] = rgb_at(&to_srgb(gray.clone(), Some(&icc)));
            assert!(r >= HDR_PROBE_MIN && (100..=200).contains(&r), "{r}");
        }
    }

    #[test]
    fn gray_profile_turns_into_rgb_gray() {
        let icc = ColorProfile::new_gray_with_gamma(2.2).encode().unwrap();
        let img = DynamicImage::ImageLuma8(GrayImage::from_pixel(3, 3, image::Luma([128])));
        let out = to_srgb(img, Some(&icc));
        let [r, g, b] = rgb_at(&out);
        assert_eq!((r, g), (g, b), "灰还是灰");
        assert_eq!(out.dimensions(), (3, 3));
    }
}
