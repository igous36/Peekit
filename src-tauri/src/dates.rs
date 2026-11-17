//! 图片日期：先读 EXIF（拍摄 / 创建时间），再找 XMP（Photoshop 等导出的 PNG 常见），
//! 都没有就由调用方退回文件修改时间。

use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;

/// 读到的日期：显示用的字符串 + 排序用的时间戳（按 UTC 解释的“墙上时间”，毫秒）
#[derive(Debug, Clone, PartialEq)]
pub struct FoundDate {
    pub display: String,
    pub ts: f64,
}

/// EXIF 里读到的东西：日期（可能没有）和方向（1–8，没有就是 1）
pub struct ExifInfo {
    pub date: Option<FoundDate>,
    pub orientation: u32,
}

pub fn read_exif(path: &Path) -> ExifInfo {
    let mut info = ExifInfo { date: None, orientation: 1 };
    let Ok(file) = File::open(path) else { return info };
    let mut reader = BufReader::new(file);
    let Ok(ex) = exif::Reader::new().read_from_container(&mut reader) else { return info };
    for tag in [exif::Tag::DateTimeOriginal, exif::Tag::DateTimeDigitized, exif::Tag::DateTime] {
        if let Some(f) = ex.get_field(tag, exif::In::PRIMARY) {
            if let exif::Value::Ascii(ref v) = f.value {
                if let Some(d) = v.first().and_then(|s| parse_exif_ascii(s)) {
                    info.date = Some(d);
                    break;
                }
            }
        }
    }
    if let Some(o) = ex
        .get_field(exif::Tag::Orientation, exif::In::PRIMARY)
        .and_then(|f| f.value.get_uint(0))
    {
        if (1..=8).contains(&o) {
            info.orientation = o;
        }
    }
    info
}

/// EXIF 的 “YYYY:MM:DD HH:MM:SS”
pub fn parse_exif_ascii(s: &[u8]) -> Option<FoundDate> {
    let dt = exif::DateTime::from_ascii(s).ok()?;
    make(dt.year as i64, dt.month as i64, dt.day as i64, dt.hour as i64, dt.minute as i64, dt.second as i64)
}

/// 只读文件开头这么多字节找 XMP（PNG 的 iTXt、JPEG 的 APP1 一般都在前面）
const XMP_SCAN_BYTES: usize = 256 * 1024;

pub fn read_xmp_date(path: &Path) -> Option<FoundDate> {
    let file = File::open(path).ok()?;
    let mut buf = Vec::with_capacity(64 * 1024);
    file.take(XMP_SCAN_BYTES as u64).read_to_end(&mut buf).ok()?;
    find_xmp_date(&buf)
}

/// 在 XMP 文本里按优先级找 CreateDate / DateCreated / DateTimeOriginal（属性和元素两种写法都认）
pub fn find_xmp_date(buf: &[u8]) -> Option<FoundDate> {
    for key in [&b"exif:DateTimeOriginal"[..], b"photoshop:DateCreated", b"xmp:CreateDate"] {
        let mut from = 0;
        while let Some(p) = find(&buf[from..], key) {
            let start = from + p + key.len();
            let end = (start + 48).min(buf.len());
            if let Some(d) = parse_iso_in(&buf[start..end]) {
                return Some(d);
            }
            from = start;
        }
    }
    None
}

fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

/// 在一小段字节里找第一个 “YYYY-MM-DD[THH:MM[:SS]]”
fn parse_iso_in(s: &[u8]) -> Option<FoundDate> {
    let i = s.iter().position(|b| b.is_ascii_digit())?;
    let s = &s[i..];
    let num = |a: usize, b: usize| -> Option<i64> {
        let part = s.get(a..b)?;
        if !part.iter().all(|c| c.is_ascii_digit()) {
            return None;
        }
        std::str::from_utf8(part).ok()?.parse().ok()
    };
    if s.get(4) != Some(&b'-') || s.get(7) != Some(&b'-') {
        return None;
    }
    let (y, mo, d) = (num(0, 4)?, num(5, 7)?, num(8, 10)?);
    let (mut h, mut mi, mut sec) = (0, 0, 0);
    if s.get(10) == Some(&b'T') {
        h = num(11, 13).unwrap_or(0);
        mi = num(14, 16).unwrap_or(0);
        sec = num(17, 19).unwrap_or(0);
    }
    make(y, mo, d, h, mi, sec)
}

fn make(y: i64, mo: i64, d: i64, h: i64, mi: i64, s: i64) -> Option<FoundDate> {
    // EXIF 里常见 “0000:00:00 00:00:00” 这种占位值
    if !(1900..=2200).contains(&y) || !(1..=12).contains(&mo) || !(1..=31).contains(&d) {
        return None;
    }
    let days = days_from_civil(y, mo, d);
    let ts = ((days * 86_400 + h * 3_600 + mi * 60 + s) * 1_000) as f64;
    Some(FoundDate { display: format!("{y:04}.{mo:02}.{d:02}"), ts })
}

/// 公历日期 → 1970-01-01 起的天数（Howard Hinnant 的算法）
pub fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn civil_days() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(days_from_civil(2000, 3, 1), 11_017);
        assert_eq!(days_from_civil(2025, 6, 14), 20_253);
    }

    #[test]
    fn exif_ascii() {
        let d = parse_exif_ascii(b"2025:06:14 10:11:12").unwrap();
        assert_eq!(d.display, "2025.06.14");
        assert_eq!(d.ts, ((20_253_i64 * 86_400 + 10 * 3_600 + 11 * 60 + 12) * 1_000) as f64);
        assert!(parse_exif_ascii(b"0000:00:00 00:00:00").is_none());
    }

    #[test]
    fn xmp_attribute_and_element() {
        let attr = br#"<rdf:Description xmp:CreateDate="2024-11-03T21:05:44+08:00" xmp:ModifyDate="2025-01-01"/>"#;
        assert_eq!(find_xmp_date(attr).unwrap().display, "2024.11.03");
        let elem = b"<photoshop:DateCreated>2023-02-09</photoshop:DateCreated>";
        assert_eq!(find_xmp_date(elem).unwrap().display, "2023.02.09");
        // 优先 DateTimeOriginal
        let both = br#"xmp:CreateDate="2024-01-01" exif:DateTimeOriginal="2020-05-06T01:02:03""#;
        assert_eq!(find_xmp_date(both).unwrap().display, "2020.05.06");
        assert!(find_xmp_date(b"xmp:CreateDate=\"not a date\"").is_none());
    }
}
