//! 相机 RAW（2026-11-18 新增）：不解码 RAW 本身（去马赛克、白平衡这些又慢又要大库），
//! 只取相机写在 RAW 文件里的 JPEG 预览图——相机回放、Windows 照片、各种“快速看片”软件显示的都是它。
//! 不加依赖：自己读文件结构找到预览的位置，再用 image 现有的 JPEG 解码。
//!
//! - TIFF 系（DNG、CR2、NEF、ARW、PEF、ORF、RW2、SRW…）：走 IFD 链和子 IFD，
//!   找 JPEGInterchangeFormat、压缩方式是 JPEG 的单条带，以及松下 RW2 的 JpgFromRaw（0x2E）
//! - CR3（ISO BMFF）：第一条轨道的第一帧是全尺寸 JPEG；顶层 uuid 里的 PRVW 是 1620px 的中图；CMT1 / CMT2 是 EXIF
//! - RAF：文件头第 84 / 88 字节记着内嵌 JPEG 的位置和长度
//! - 兜底（奥林巴斯 ORF 等把预览藏在厂商私有标签里）：在文件里找 JPEG 开头标记、逐个校验。
//!   只在生成缩略图 / 大图时做（一张图只做一次，有缓存）；扫描导入时只读结构，不通读文件
//!
//! 每个候选都要校验：真的是 JPEG、是基线 / 渐进式（无损 JPEG 是 RAW 数据本身，排除），并读出宽高。
//! 缩略图挑“长边不小于 1600 的最小那张”，看大图挑最大的。

use std::collections::HashSet;
use std::fs::File;
use std::io::{Cursor, Read, Seek, SeekFrom};
use std::path::Path;

use image::metadata::Orientation;
use image::{DynamicImage, ImageDecoder};

use crate::dates::{self, FoundDate};

/// 支持的 RAW 扩展名（小写），和前端 data/formats.ts 的 RAW_EXTS 一致
pub const RAW_EXTS: [&str; 12] = ["dng", "cr2", "cr3", "nef", "nrw", "arw", "sr2", "raf", "orf", "rw2", "pef", "srw"];

/// 兜底扫描最多看文件开头这么多字节
const SCAN_LIMIT: u64 = 64 * 1024 * 1024;
/// 兜底扫描时，小于这个尺寸的 JPEG（160px 的缩略图之类）不要
const SCAN_MIN_EDGE: u32 = 320;
/// 单张预览最大字节数（防止读坏文件时一次读进几百 MB）
const PREVIEW_MAX: u64 = 64 * 1024 * 1024;

pub fn is_raw(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| RAW_EXTS.contains(&e.to_ascii_lowercase().as_str()))
}

/// 一张内嵌的 JPEG 预览：在文件里的位置、长度、宽高（没转方向）
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Preview {
    pub offset: u64,
    pub len: u64,
    pub width: u32,
    pub height: u32,
}

impl Preview {
    fn edge(&self) -> u32 {
        self.width.max(self.height)
    }
}

#[derive(Debug, Default)]
pub struct RawInfo {
    pub previews: Vec<Preview>,
    /// RAW 里写的方向 1–8；0 = 没写（用预览 JPEG 自己 EXIF 里的方向）
    pub orientation: u32,
    pub date: Option<FoundDate>,
    /// 传感器 / 主图像的尺寸（找不到预览时，扫描阶段用它定卡片比例）
    pub sensor: Option<(u32, u32)>,
}

impl RawInfo {
    /// 显示用的尺寸（已按方向换算）：最大的预览；没有就用传感器尺寸
    pub fn display_size(&self) -> (u32, u32) {
        let (w, h) = self
            .previews
            .iter()
            .max_by_key(|p| p.width as u64 * p.height as u64)
            .map(|p| (p.width, p.height))
            .or(self.sensor)
            .unwrap_or((0, 0));
        if (5..=8).contains(&self.orientation) {
            (h, w)
        } else {
            (w, h)
        }
    }
}

// ───────────── 读文件的小工具 ─────────────

fn read_at<R: Read + Seek>(r: &mut R, off: u64, buf: &mut [u8]) -> Option<()> {
    r.seek(SeekFrom::Start(off)).ok()?;
    r.read_exact(buf).ok()
}

fn read_vec<R: Read + Seek>(r: &mut R, off: u64, len: u64) -> Option<Vec<u8>> {
    if len > PREVIEW_MAX {
        return None;
    }
    let mut v = vec![0u8; len as usize];
    read_at(r, off, &mut v)?;
    Some(v)
}

fn u16_of(b: &[u8], le: bool) -> u16 {
    if le {
        u16::from_le_bytes([b[0], b[1]])
    } else {
        u16::from_be_bytes([b[0], b[1]])
    }
}

fn u32_of(b: &[u8], le: bool) -> u32 {
    if le {
        u32::from_le_bytes([b[0], b[1], b[2], b[3]])
    } else {
        u32::from_be_bytes([b[0], b[1], b[2], b[3]])
    }
}

// ───────────── JPEG 校验 ─────────────

/// off 处是不是一张能看的 JPEG：读标记段直到 SOF，返回宽高。
/// 无损 JPEG（SOF3，CR2 / DNG 的 RAW 数据本身就是这种）、分层 / 算术编码、不是 JPEG，都返回 None
pub fn jpeg_size<R: Read + Seek>(r: &mut R, off: u64, limit: u64) -> Option<(u32, u32)> {
    let mut soi = [0u8; 2];
    read_at(r, off, &mut soi)?;
    if soi != [0xFF, 0xD8] {
        return None;
    }
    let end = off.saturating_add(limit);
    let mut pos = off + 2;
    for _ in 0..256 {
        if pos + 4 > end {
            return None;
        }
        let mut h = [0u8; 4];
        read_at(r, pos, &mut h)?;
        if h[0] != 0xFF {
            return None;
        }
        let m = h[1];
        if m == 0xFF {
            pos += 1; // 填充字节
            continue;
        }
        if m == 0x01 || (0xD0..=0xD7).contains(&m) {
            pos += 2;
            continue;
        }
        match m {
            0xC0..=0xC2 => {
                let mut s = [0u8; 5];
                read_at(r, pos + 4, &mut s)?;
                let height = u16::from_be_bytes([s[1], s[2]]) as u32;
                let width = u16::from_be_bytes([s[3], s[4]]) as u32;
                return (width >= 16 && height >= 16).then_some((width, height));
            }
            0xC3 | 0xC5..=0xC7 | 0xC9..=0xCB | 0xCD..=0xCF | 0xD8 | 0xD9 | 0xDA => return None,
            _ => {
                let seg = u16::from_be_bytes([h[2], h[3]]) as u64;
                if seg < 2 {
                    return None;
                }
                pos += 2 + seg;
            }
        }
    }
    None
}

/// 按需往后读的缓冲：兜底扫描时找 JPEG 的结尾用
struct Window<'a, R> {
    r: &'a mut R,
    off: u64,
    buf: Vec<u8>,
    max: u64,
    done: bool,
}

impl<R: Read + Seek> Window<'_, R> {
    fn get(&mut self, i: usize) -> Option<u8> {
        while i >= self.buf.len() {
            if self.done || self.buf.len() as u64 >= self.max {
                return None;
            }
            let want = (1024 * 1024).min(self.max - self.buf.len() as u64) as usize;
            let start = self.buf.len();
            self.buf.resize(start + want, 0);
            self.r.seek(SeekFrom::Start(self.off + start as u64)).ok()?;
            let mut got = 0;
            while got < want {
                match self.r.read(&mut self.buf[start + got..]) {
                    Ok(0) => break,
                    Ok(n) => got += n,
                    Err(_) => break,
                }
            }
            self.buf.truncate(start + got);
            if got < want {
                self.done = true;
            }
        }
        Some(self.buf[i])
    }

    fn u16be(&mut self, i: usize) -> Option<usize> {
        Some(((self.get(i)? as usize) << 8) | self.get(i + 1)? as usize)
    }
}

/// 从 off 开始的 JPEG 有多长（读到 EOI）；渐进式 JPEG 有多段扫描也能跟过去
pub fn jpeg_extent<R: Read + Seek>(r: &mut R, off: u64, max: u64) -> Option<u64> {
    let mut w = Window { r, off, buf: Vec::new(), max, done: false };
    if w.get(0)? != 0xFF || w.get(1)? != 0xD8 {
        return None;
    }
    let mut i = 2usize;
    loop {
        if w.get(i)? != 0xFF {
            return None;
        }
        let m = w.get(i + 1)?;
        match m {
            0xFF => i += 1,
            0xD9 => return Some(i as u64 + 2),
            0x01 | 0xD0..=0xD7 => i += 2,
            0xDA => {
                // 扫描段头，然后是压缩数据：直到遇到真正的标记（FF 后面不是 00 / RSTn / FF）
                i += 2 + w.u16be(i + 2)?;
                loop {
                    if w.get(i)? != 0xFF {
                        i += 1;
                        continue;
                    }
                    let n = w.get(i + 1)?;
                    if n == 0x00 || (0xD0..=0xD7).contains(&n) {
                        i += 2;
                    } else if n == 0xFF {
                        i += 1;
                    } else {
                        break;
                    }
                }
            }
            _ => {
                let seg = w.u16be(i + 2)?;
                if seg < 2 {
                    return None;
                }
                i += 2 + seg;
            }
        }
    }
}

// ───────────── TIFF 系 ─────────────

/// TIFF 里找到的东西
#[derive(Default)]
struct TiffFound {
    /// 候选预览（文件里的绝对位置、长度）
    cands: Vec<(u64, u64)>,
    orientation: u32,
    date_original: Option<FoundDate>,
    date_any: Option<FoundDate>,
    sensor: Option<(u32, u32)>,
}

/// 解析 base 处的 TIFF（含 ORF 的 “RO” / “RS”、RW2 的 “U” 变体）。
/// take_orientation：第一个 IFD 的方向算不算数（CR3 的 CMT2 里没有方向）
fn parse_tiff<R: Read + Seek>(r: &mut R, base: u64, file_len: u64, take_orientation: bool, out: &mut TiffFound) -> Option<()> {
    let mut head = [0u8; 8];
    read_at(r, base, &mut head)?;
    let le = match &head[0..2] {
        b"II" => true,
        b"MM" => false,
        _ => return None,
    };
    let magic = u16_of(&head[2..4], le);
    if !matches!(magic, 42 | 0x4F52 | 0x5352 | 0x55) {
        return None;
    }
    let mut queue: Vec<(u64, u32, bool)> = vec![(u32_of(&head[4..8], le) as u64, 0, true)];
    let mut seen = HashSet::new();
    let mut first = true;
    while let Some((rel, depth, chain)) = queue.pop() {
        if rel == 0 || depth > 4 || seen.len() > 64 || !seen.insert(rel) {
            continue;
        }
        let at = base + rel;
        let mut cnt = [0u8; 2];
        if read_at(r, at, &mut cnt).is_none() {
            continue;
        }
        let count = u16_of(&cnt, le) as usize;
        if count == 0 || count > 1024 {
            continue;
        }
        let mut entries = vec![0u8; count * 12 + 4];
        if read_at(r, at + 2, &mut entries).is_none() {
            continue;
        }
        let (mut comp, mut strip_off, mut strip_len, mut jif_off, mut jif_len) = (0u32, None, None, 0u64, 0u64);
        let (mut width, mut height) = (0u32, 0u32);
        for e in entries[..count * 12].chunks_exact(12) {
            let tag = u16_of(&e[0..2], le);
            let typ = u16_of(&e[2..4], le);
            let n = u32_of(&e[4..8], le);
            let raw = &e[8..12];
            // 只有一个值时直接在这 4 个字节里
            let one = || match typ {
                3 | 8 => u16_of(raw, le) as u32,
                _ => u32_of(raw, le),
            };
            let offv = u32_of(raw, le) as u64;
            match tag {
                0x0100 => width = one(),
                0x0101 => height = one(),
                0x0103 => comp = one(),
                0x0111 if n == 1 => strip_off = Some(one() as u64),
                0x0117 if n == 1 => strip_len = Some(one() as u64),
                0x0201 => jif_off = one() as u64,
                0x0202 => jif_len = one() as u64,
                0x0112 if first && take_orientation => {
                    let o = one();
                    if (1..=8).contains(&o) {
                        out.orientation = o;
                    }
                }
                // 松下 RW2：JpgFromRaw，整张 JPEG 就是这个标签的值
                0x002E if typ == 7 && n > 1024 => out.cands.push((base + offv, n as u64)),
                0x014A => {
                    if n == 1 {
                        queue.push((offv, depth + 1, false));
                    } else if n <= 16 {
                        let mut subs = vec![0u8; n as usize * 4];
                        if read_at(r, base + offv, &mut subs).is_some() {
                            for s in subs.chunks_exact(4) {
                                queue.push((u32_of(s, le) as u64, depth + 1, false));
                            }
                        }
                    }
                }
                0x8769 => queue.push((offv, depth + 1, false)),
                0x9003 | 0x0132 if typ == 2 && n >= 19 => {
                    let mut s = vec![0u8; n.min(32) as usize];
                    if read_at(r, base + offv, &mut s).is_some() {
                        if let Some(d) = dates::parse_exif_ascii(s.split(|b| *b == 0).next().unwrap_or(&[])) {
                            if tag == 0x9003 {
                                out.date_original.get_or_insert(d);
                            } else {
                                out.date_any.get_or_insert(d);
                            }
                        }
                    }
                }
                _ => {}
            }
        }
        if jif_off > 0 && jif_len > 0 {
            out.cands.push((base + jif_off, jif_len));
        }
        if matches!(comp, 6 | 7) {
            if let (Some(o), Some(l)) = (strip_off, strip_len) {
                out.cands.push((base + o, l));
            }
        }
        // 最大的那个图像（一般是 RAW 主图）的尺寸：找不到预览时定卡片比例
        if width > 0 && height > 0 && out.sensor.map_or(true, |(w, h)| (w as u64 * h as u64) < width as u64 * height as u64) {
            out.sensor = Some((width, height));
        }
        if chain {
            let next = u32_of(&entries[count * 12..count * 12 + 4], le) as u64;
            if next > 0 && base + next < file_len {
                queue.push((next, depth, true));
            }
        }
        first = false;
    }
    Some(())
}

// ───────────── CR3（ISO BMFF） ─────────────

const CANON_UUID: [u8; 16] = [0x85, 0xc0, 0xb6, 0x87, 0x82, 0x0f, 0x11, 0xe0, 0x81, 0x11, 0xf4, 0xce, 0x46, 0x2b, 0x6a, 0x48];
const PREVIEW_UUID: [u8; 16] = [0xea, 0xf4, 0x2b, 0x5e, 0x1c, 0x98, 0x4b, 0x88, 0xb9, 0xfb, 0xb7, 0xdc, 0x40, 0x6e, 0x4d, 0x16];

/// [start, end) 里的盒子：(类型, 内容开始, 结束)
fn boxes<R: Read + Seek>(r: &mut R, start: u64, end: u64) -> Vec<([u8; 4], u64, u64)> {
    let mut out = Vec::new();
    let mut pos = start;
    while pos + 8 <= end && out.len() < 512 {
        let mut h = [0u8; 8];
        if read_at(r, pos, &mut h).is_none() {
            break;
        }
        let mut size = u32::from_be_bytes([h[0], h[1], h[2], h[3]]) as u64;
        let typ = [h[4], h[5], h[6], h[7]];
        let mut head = 8;
        if size == 1 {
            let mut l = [0u8; 8];
            if read_at(r, pos + 8, &mut l).is_none() {
                break;
            }
            size = u64::from_be_bytes(l);
            head = 16;
        } else if size == 0 {
            size = end - pos;
        }
        if size < head || pos + size > end {
            break;
        }
        out.push((typ, pos + head, pos + size));
        pos += size;
    }
    out
}

fn child<R: Read + Seek>(r: &mut R, start: u64, end: u64, name: &[u8; 4]) -> Option<(u64, u64)> {
    boxes(r, start, end).into_iter().find(|b| &b.0 == name).map(|b| (b.1, b.2))
}

fn parse_cr3<R: Read + Seek>(r: &mut R, file_len: u64, info: &mut RawInfo, cands: &mut Vec<(u64, u64)>) {
    let mut found = TiffFound::default();
    for (typ, s, e) in boxes(r, 0, file_len) {
        match &typ {
            b"moov" => {
                for (t2, s2, e2) in boxes(r, s, e) {
                    if &t2 == b"uuid" {
                        let mut id = [0u8; 16];
                        if read_at(r, s2, &mut id).is_none() || id != CANON_UUID {
                            continue;
                        }
                        // CMT1 = IFD0（方向、日期），CMT2 = EXIF（拍摄日期）：都是完整的小 TIFF
                        for (t3, s3, e3) in boxes(r, s2 + 16, e2) {
                            if (&t3 == b"CMT1" || &t3 == b"CMT2") && e3 - s3 < 1024 * 1024 {
                                if let Some(buf) = read_vec(r, s3, e3 - s3) {
                                    let mut c = Cursor::new(buf);
                                    let len = e3 - s3;
                                    parse_tiff(&mut c, 0, len, &t3 == b"CMT1", &mut found);
                                }
                            }
                        }
                    } else if &t2 == b"trak" {
                        // 每条轨道的第一帧：第一条是全尺寸 JPEG，其余是 CRX（校验时会被排除）
                        let Some((ms, me)) = child(r, s2, e2, b"mdia") else { continue };
                        let Some((ns, ne)) = child(r, ms, me, b"minf") else { continue };
                        let Some((bs, be)) = child(r, ns, ne, b"stbl") else { continue };
                        let size = child(r, bs, be, b"stsz").and_then(|(zs, _)| {
                            let mut v = [0u8; 16];
                            read_at(r, zs, &mut v)?;
                            let fixed = u32::from_be_bytes([v[4], v[5], v[6], v[7]]) as u64;
                            Some(if fixed > 0 { fixed } else { u32::from_be_bytes([v[12], v[13], v[14], v[15]]) as u64 })
                        });
                        let offset = child(r, bs, be, b"co64")
                            .and_then(|(cs, _)| {
                                let mut v = [0u8; 16];
                                read_at(r, cs, &mut v)?;
                                Some(u64::from_be_bytes([v[8], v[9], v[10], v[11], v[12], v[13], v[14], v[15]]))
                            })
                            .or_else(|| {
                                child(r, bs, be, b"stco").and_then(|(cs, _)| {
                                    let mut v = [0u8; 12];
                                    read_at(r, cs, &mut v)?;
                                    Some(u32::from_be_bytes([v[8], v[9], v[10], v[11]]) as u64)
                                })
                            });
                        if let (Some(o), Some(l)) = (offset, size) {
                            cands.push((o, l));
                        }
                    }
                }
            }
            b"uuid" => {
                let mut id = [0u8; 16];
                if read_at(r, s, &mut id).is_none() || id != PREVIEW_UUID {
                    continue;
                }
                // PRVW 盒子：开头几个字段之后就是 JPEG，找 FF D8 FF
                for (t2, s2, e2) in boxes(r, s + 16 + 8, e) {
                    if &t2 == b"PRVW" {
                        let mut head = [0u8; 64];
                        if read_at(r, s2, &mut head).is_some() {
                            if let Some(i) = head.windows(3).position(|w| w == [0xFF, 0xD8, 0xFF]) {
                                cands.push((s2 + i as u64, e2 - s2 - i as u64));
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }
    info.orientation = found.orientation;
    info.date = found.date_original.or(found.date_any);
}

// ───────────── RAF ─────────────

fn parse_raf<R: Read + Seek>(r: &mut R, info: &mut RawInfo, cands: &mut Vec<(u64, u64)>) {
    let mut h = [0u8; 92];
    if read_at(r, 0, &mut h).is_none() {
        return;
    }
    let off = u32::from_be_bytes([h[84], h[85], h[86], h[87]]) as u64;
    let len = u32::from_be_bytes([h[88], h[89], h[90], h[91]]) as u64;
    if off == 0 || len == 0 {
        return;
    }
    cands.push((off, len));
    // 方向、日期在内嵌 JPEG 自己的 EXIF 里（APP1 在 JPEG 开头）
    if let Some(head) = read_vec(r, off, len.min(256 * 1024)) {
        if let Ok(ex) = exif::Reader::new().read_from_container(&mut Cursor::new(head)) {
            if let Some(o) = ex.get_field(exif::Tag::Orientation, exif::In::PRIMARY).and_then(|f| f.value.get_uint(0)) {
                if (1..=8).contains(&o) {
                    info.orientation = o;
                }
            }
            for tag in [exif::Tag::DateTimeOriginal, exif::Tag::DateTime] {
                if let Some(exif::Value::Ascii(v)) = ex.get_field(tag, exif::In::PRIMARY).map(|f| &f.value) {
                    if let Some(d) = v.first().and_then(|s| dates::parse_exif_ascii(s)) {
                        info.date = Some(d);
                        break;
                    }
                }
            }
        }
    }
}

// ───────────── 兜底：在文件里找 JPEG ─────────────

fn scan_jpegs<R: Read + Seek>(r: &mut R, file_len: u64) -> Vec<Preview> {
    let mut out = Vec::new();
    let limit = file_len.min(SCAN_LIMIT);
    let chunk = 4 * 1024 * 1024u64;
    let mut pos = 0u64;
    let mut checked = 0;
    while pos < limit && checked < 400 {
        let len = chunk.min(limit - pos) + 2;
        let Some(buf) = read_vec(r, pos, len.min(file_len - pos)) else { break };
        let mut skip_to = 0u64;
        let mut i = 0usize;
        while i + 3 <= buf.len() {
            let at = pos + i as u64;
            if at >= skip_to && buf[i] == 0xFF && buf[i + 1] == 0xD8 && buf[i + 2] == 0xFF {
                checked += 1;
                if let Some((w, h)) = jpeg_size(r, at, file_len - at) {
                    if w.max(h) >= SCAN_MIN_EDGE {
                        if let Some(l) = jpeg_extent(r, at, (file_len - at).min(PREVIEW_MAX)) {
                            out.push(Preview { offset: at, len: l, width: w, height: h });
                            // 跳过这张 JPEG 内部（它 EXIF 里的小缩略图不要）
                            skip_to = at + l;
                        }
                    }
                }
            }
            i += 1;
        }
        if skip_to > pos + buf.len() as u64 {
            pos = skip_to;
        } else {
            pos += chunk;
        }
    }
    out
}

// ───────────── 对外 ─────────────

/// 读 RAW 的结构：预览（已校验）、方向、日期、传感器尺寸。
/// deep：结构里找不到够大的预览时，在文件里逐个找 JPEG（读得多，只在生成缩略图 / 大图时用）
pub fn probe(path: &Path, deep: bool) -> Result<RawInfo, String> {
    let mut f = File::open(path).map_err(|e| e.to_string())?;
    let file_len = f.metadata().map_err(|e| e.to_string())?.len();
    let mut head = [0u8; 16];
    read_at(&mut f, 0, &mut head).ok_or("文件太短，不是 RAW")?;
    let mut info = RawInfo::default();
    let mut cands: Vec<(u64, u64)> = Vec::new();
    if head.starts_with(b"FUJIFILMCCD-RAW") {
        parse_raf(&mut f, &mut info, &mut cands);
    } else if &head[4..8] == b"ftyp" {
        parse_cr3(&mut f, file_len, &mut info, &mut cands);
    } else {
        let mut found = TiffFound::default();
        parse_tiff(&mut f, 0, file_len, true, &mut found).ok_or("不认识的 RAW 格式")?;
        info.orientation = found.orientation;
        info.date = found.date_original.or(found.date_any);
        info.sensor = found.sensor;
        cands = found.cands;
    }
    let mut seen = HashSet::new();
    for (off, len) in cands {
        if len < 1024 || off.saturating_add(len) > file_len || !seen.insert(off) {
            continue;
        }
        if let Some((w, h)) = jpeg_size(&mut f, off, len) {
            info.previews.push(Preview { offset: off, len, width: w, height: h });
        }
    }
    let best = info.previews.iter().map(Preview::edge).max().unwrap_or(0);
    if deep && best < 1024 {
        for p in scan_jpegs(&mut f, file_len) {
            if seen.insert(p.offset) {
                info.previews.push(p);
            }
        }
    }
    Ok(info)
}

/// 挑一张预览：min_edge 给了就挑“长边不小于它的最小那张”（缩略图用，解码快），没有这么大的就挑最大的
pub fn pick(previews: &[Preview], min_edge: Option<u32>) -> Vec<Preview> {
    let mut v = previews.to_vec();
    v.sort_by_key(|p| std::cmp::Reverse(p.width as u64 * p.height as u64));
    if let Some(m) = min_edge {
        // 够大的从小到大排在前面，不够大的按从大到小跟在后面
        let (mut big, small): (Vec<_>, Vec<_>) = v.into_iter().partition(|p| p.edge() >= m);
        big.reverse();
        big.extend(small);
        v = big;
    }
    v
}

/// 解码 RAW 的内嵌预览并转正。min_edge 见 pick；挑中的那张坏了就换下一张
pub fn decode(path: &Path, min_edge: Option<u32>) -> Result<DynamicImage, String> {
    let info = probe(path, true)?;
    let order = pick(&info.previews, min_edge);
    if order.is_empty() {
        return Err("这个 RAW 文件里没有可用的预览图".into());
    }
    let mut f = File::open(path).map_err(|e| e.to_string())?;
    let mut last = String::new();
    for p in order {
        let Some(bytes) = read_vec(&mut f, p.offset, p.len) else { continue };
        let attempt = (|| -> Result<DynamicImage, String> {
            let mut dec = image::codecs::jpeg::JpegDecoder::new(Cursor::new(bytes)).map_err(|e| e.to_string())?;
            let own = dec.orientation().unwrap_or(Orientation::NoTransforms);
            let mut img = DynamicImage::from_decoder(dec).map_err(|e| e.to_string())?;
            // RAW 里写了方向就按它（预览像素本身没转过）；没写就按预览 JPEG 自己的 EXIF
            let o = Orientation::from_exif(info.orientation as u8).unwrap_or(own);
            img.apply_orientation(o);
            Ok(img)
        })();
        match attempt {
            Ok(img) => return Ok(img),
            Err(e) => last = e,
        }
    }
    Err(format!("RAW 预览解码失败：{last}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::GenericImageView;

    /// 一张 w×h 的纯色 JPEG（基线）
    fn jpeg(w: u32, h: u32) -> Vec<u8> {
        let img = image::RgbImage::from_pixel(w, h, image::Rgb([180, 90, 40]));
        let mut out = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 80).encode_image(&img).unwrap();
        out
    }

    /// 拼一个最小的 TIFF 式 RAW（小端）：IFD0 有方向 + JPEGInterchangeFormat 指向一张大 JPEG，
    /// 子 IFD 里是一张 JPEG 条带（压缩方式 6），EXIF IFD 里有拍摄日期
    fn fake_tiff_raw(big: &[u8], small: &[u8], orientation: u16) -> Vec<u8> {
        let mut f = vec![0u8; 8];
        f[0..2].copy_from_slice(b"II");
        f[2..4].copy_from_slice(&42u16.to_le_bytes());
        f[4..8].copy_from_slice(&8u32.to_le_bytes());
        let entry = |tag: u16, typ: u16, n: u32, v: u32| {
            let mut e = Vec::new();
            e.extend(tag.to_le_bytes());
            e.extend(typ.to_le_bytes());
            e.extend(n.to_le_bytes());
            e.extend(v.to_le_bytes());
            e
        };
        // 位置规划：IFD0 在 8；子 IFD 在 200；EXIF IFD 在 300；日期字符串在 400；大 JPEG 在 512；小 JPEG 跟在后面
        let big_at = 512u32;
        let small_at = big_at + big.len() as u32;
        let mut ifd0 = Vec::new();
        ifd0.extend(5u16.to_le_bytes());
        ifd0.extend(entry(0x0112, 3, 1, orientation as u32));
        ifd0.extend(entry(0x014A, 4, 1, 200));
        ifd0.extend(entry(0x0201, 4, 1, big_at));
        ifd0.extend(entry(0x0202, 4, 1, big.len() as u32));
        ifd0.extend(entry(0x8769, 4, 1, 300));
        ifd0.extend(0u32.to_le_bytes());
        f.extend(&ifd0);
        f.resize(200, 0);
        let mut sub = Vec::new();
        sub.extend(3u16.to_le_bytes());
        sub.extend(entry(0x0103, 3, 1, 6));
        sub.extend(entry(0x0111, 4, 1, small_at));
        sub.extend(entry(0x0117, 4, 1, small.len() as u32));
        sub.extend(0u32.to_le_bytes());
        f.extend(&sub);
        f.resize(300, 0);
        let mut ex = Vec::new();
        ex.extend(1u16.to_le_bytes());
        ex.extend(entry(0x9003, 2, 20, 400));
        ex.extend(0u32.to_le_bytes());
        f.extend(&ex);
        f.resize(400, 0);
        f.extend(b"2024:05:06 07:08:09\0");
        f.resize(512, 0);
        f.extend(big);
        f.extend(small);
        f
    }

    fn temp(name: &str, bytes: &[u8]) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("peekit-raw-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join(name);
        std::fs::write(&p, bytes).unwrap();
        p
    }

    #[test]
    fn extensions() {
        for e in ["a.CR3", "a.nef", "a.ARW", "a.dng", "a.RAF", "a.orf", "a.rw2", "a.pef", "a.CR2"] {
            assert!(is_raw(Path::new(e)), "{e}");
        }
        assert!(!is_raw(Path::new("a.jpg")) && !is_raw(Path::new("a")));
    }

    #[test]
    fn jpeg_checks_size_and_extent() {
        let j = jpeg(300, 200);
        let mut c = Cursor::new(j.clone());
        assert_eq!(jpeg_size(&mut c, 0, j.len() as u64), Some((300, 200)));
        assert_eq!(jpeg_extent(&mut c, 0, u64::MAX), Some(j.len() as u64));
        // 后面跟着垃圾也能找到结尾
        let mut more = j.clone();
        more.extend([1u8, 2, 3, 0xFF, 0xD8]);
        let mut c = Cursor::new(more);
        assert_eq!(jpeg_extent(&mut c, 0, u64::MAX), Some(j.len() as u64));
        // 不是 JPEG
        let mut c = Cursor::new(vec![0u8; 64]);
        assert_eq!(jpeg_size(&mut c, 0, 64), None);
    }

    #[test]
    fn rejects_lossless_jpeg() {
        // SOF3（无损）= RAW 数据本身，不能当预览
        let mut j = vec![0xFF, 0xD8, 0xFF, 0xC3, 0x00, 0x0B, 8, 0x01, 0x00, 0x02, 0x00, 1, 1, 0x11, 0];
        j.extend([0u8; 32]);
        let mut c = Cursor::new(j);
        assert_eq!(jpeg_size(&mut c, 0, 64), None);
    }

    #[test]
    fn tiff_raw_previews_orientation_date() {
        let big = jpeg(2400, 1600);
        let small = jpeg(1600, 1067);
        let p = temp("fake.nef", &fake_tiff_raw(&big, &small, 6));
        let info = probe(&p, false).unwrap();
        assert_eq!(info.previews.len(), 2);
        assert_eq!(info.orientation, 6);
        assert_eq!(info.date.as_ref().unwrap().display, "2024.05.06");
        // 方向 6（转 90°）：显示尺寸宽高对调
        assert_eq!(info.display_size(), (1600, 2400));
        // 缩略图挑够 1600 的最小那张，看大图挑最大的
        assert_eq!(pick(&info.previews, Some(1600))[0].width, 1600);
        assert_eq!(pick(&info.previews, None)[0].width, 2400);
        let img = decode(&p, Some(1600)).unwrap();
        assert_eq!(img.dimensions(), (1067, 1600));
        let img = decode(&p, None).unwrap();
        assert_eq!(img.dimensions(), (1600, 2400));
    }

    #[test]
    fn raf_header() {
        let j = jpeg(800, 600);
        let mut f = b"FUJIFILMCCD-RAW 0201FF383501".to_vec();
        f.resize(160, 0);
        f[84..88].copy_from_slice(&160u32.to_be_bytes());
        f[88..92].copy_from_slice(&(j.len() as u32).to_be_bytes());
        f.extend(&j);
        f.extend([0u8; 100]);
        let p = temp("fake.raf", &f);
        let info = probe(&p, false).unwrap();
        assert_eq!(info.previews, vec![Preview { offset: 160, len: j.len() as u64, width: 800, height: 600 }]);
        assert_eq!(decode(&p, None).unwrap().dimensions(), (800, 600));
    }

    #[test]
    fn deep_scan_finds_hidden_preview() {
        // 结构里没有预览（像 ORF 把预览藏在厂商私有标签里）：IFD 只有尺寸，JPEG 埋在后面
        let j = jpeg(1200, 900);
        let mut f = vec![0u8; 8];
        f[0..2].copy_from_slice(b"II");
        f[2..4].copy_from_slice(&0x4F52u16.to_le_bytes()); // ORF 的 “RO”
        f[4..8].copy_from_slice(&8u32.to_le_bytes());
        f.extend(2u16.to_le_bytes());
        for (tag, v) in [(0x0100u16, 4000u32), (0x0101, 3000)] {
            f.extend(tag.to_le_bytes());
            f.extend(4u16.to_le_bytes());
            f.extend(1u32.to_le_bytes());
            f.extend(v.to_le_bytes());
        }
        f.extend(0u32.to_le_bytes());
        f.extend(vec![0x55u8; 3000]);
        let at = f.len() as u64;
        f.extend(&j);
        f.extend(vec![0xAAu8; 5000]);
        let p = temp("fake.orf", &f);
        let shallow = probe(&p, false).unwrap();
        assert!(shallow.previews.is_empty());
        assert_eq!(shallow.display_size(), (4000, 3000)); // 扫描阶段先用传感器尺寸定比例
        let deep = probe(&p, true).unwrap();
        assert_eq!(deep.previews, vec![Preview { offset: at, len: j.len() as u64, width: 1200, height: 900 }]);
    }

    /// 用真实样张检查（需要设 PEEKIT_RAW_SAMPLES 指向放样张的文件夹）：cargo test raw_samples -- --ignored --nocapture
    #[test]
    #[ignore]
    fn raw_samples() {
        let dir = std::env::var("PEEKIT_RAW_SAMPLES").expect("设 PEEKIT_RAW_SAMPLES");
        let mut paths: Vec<_> = std::fs::read_dir(dir).unwrap().filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| is_raw(p)).collect();
        paths.sort();
        assert!(!paths.is_empty());
        for p in paths {
            let t0 = std::time::Instant::now();
            let shallow = probe(&p, false).unwrap();
            let t1 = t0.elapsed();
            let deep = probe(&p, true).unwrap();
            let sizes: Vec<_> = deep.previews.iter().map(|q| format!("{}x{}", q.width, q.height)).collect();
            let t2 = std::time::Instant::now();
            let thumb = decode(&p, Some(1600));
            let t3 = t2.elapsed();
            println!(
                "{:<24} 结构 {:>5.1}ms 预览 [{}] 方向 {} 日期 {:?} 扫描尺寸 {:?} 缩略图 {} {:>6.1}ms",
                p.file_name().unwrap().to_string_lossy(),
                t1.as_secs_f64() * 1000.0,
                sizes.join(", "),
                deep.orientation,
                deep.date.as_ref().map(|d| d.display.clone()),
                shallow.display_size(),
                match &thumb {
                    Ok(i) => format!("{}x{}", i.width(), i.height()),
                    Err(e) => format!("失败：{e}"),
                },
                t3.as_secs_f64() * 1000.0
            );
            assert!(thumb.is_ok(), "{}", p.display());
        }
    }
}
