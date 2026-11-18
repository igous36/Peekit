//! 扫描导入的文件 / 文件夹：找出图片（PNG / JPG / WebP，2026-11-17 起加 GIF / BMP / TIFF / SVG），读尺寸、日期。
//! 文件没变（修改时间和大小都一样）就直接用前端传回来的旧结果，启动时不必重新读每张图。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::dates;

/// 和前端 data/formats.ts 的 IMAGE_EXTS 一致（2026-11-18 起另外支持相机 RAW，见 raw.rs 的 RAW_EXTS）
pub const IMAGE_EXTS: [&str; 9] = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff", "svg"];

/// RAW + JPG 同时拍时，和 RAW 配对的那张（同一文件夹、同名）可以是这些格式
const PAIR_EXTS: [&str; 2] = ["jpg", "jpeg"];

#[derive(Deserialize)]
pub struct Source {
    pub path: String,
    /// "file" | "folder"
    pub kind: String,
}

/// 上次扫描的结果，文件没变就复用
#[derive(Deserialize)]
pub struct Known {
    pub mtime: f64,
    pub size: u64,
    pub date: Option<String>,
    pub ts: f64,
    pub width: u32,
    pub height: u32,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScanItem {
    pub path: String,
    pub file_name: String,
    /// 文件名去掉扩展名
    pub title: String,
    /// 从文件夹导入时，图片所在的文件夹（按它自动建系列）；单独选的文件为空
    pub folder: Option<String>,
    /// 自动建系列用的名字：导入的文件夹名 + 往下各级子文件夹名，用“-”连接（见 folder_series_name）
    pub folder_name: Option<String>,
    /// 元数据里的日期（YYYY.MM.DD）；没有时为空，前端用 mtime 显示
    pub date: Option<String>,
    /// 排序用：元数据日期，没有就是修改时间（ms）
    pub ts: f64,
    pub mtime: f64,
    pub size: u64,
    /// 已按 EXIF 方向换算过的宽高
    pub width: u32,
    pub height: u32,
    /// RAW + JPG 同时拍、合并成一幅时（2026-11-18）：这幅显示的是 JPG，这里是同名 RAW 原片的路径（另存为时可以选）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub items: Vec<ScanItem>,
    /// 找不到的来源（被移走或删掉了）
    pub missing: Vec<String>,
}

fn ext_of(p: &Path) -> Option<String> {
    p.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase)
}

pub fn is_image(p: &Path) -> bool {
    ext_of(p).is_some_and(|e| IMAGE_EXTS.contains(&e.as_str())) || crate::raw::is_raw(p)
}

/// SVG：不经过 image 解码，界面直接显示矢量原图
pub fn is_svg(p: &Path) -> bool {
    ext_of(p).is_some_and(|e| e == "svg")
}

fn is_hidden(name: &str) -> bool {
    name.starts_with('.') || name.eq_ignore_ascii_case("thumbs.db")
}

/// 扫描找到的一张图
struct Found {
    path: PathBuf,
    /// 所在文件夹（从文件夹导入时才有）
    folder: Option<PathBuf>,
    /// 自动建系列用的名字
    series: Option<String>,
    /// 和它同名的 RAW 原片（RAW + JPG 合并成一幅时，挂在 JPG 上）
    raw: Option<PathBuf>,
}

/// RAW + JPG 同时拍（2026-11-18 用户选的合并）：同一文件夹里同名（不分大小写）的 RAW 和 JPG 合并成一幅，
/// 显示 JPG（相机直出、不用再解码 RAW），RAW 原片的路径挂在 JPG 上，另存为时可以选。
/// 返回合并后的列表：被合并的 RAW 去掉；没有配对的 RAW 照常保留
fn pair_raw_with_jpeg(files: Vec<Found>) -> Vec<Found> {
    let key = |p: &Path| {
        let dir = p.parent().map(|d| d.to_string_lossy().to_lowercase()).unwrap_or_default();
        let stem = p.file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
        (dir, stem)
    };
    let mut jpegs: HashMap<(String, String), usize> = HashMap::new();
    for (i, f) in files.iter().enumerate() {
        if ext_of(&f.path).is_some_and(|e| PAIR_EXTS.contains(&e.as_str())) {
            jpegs.entry(key(&f.path)).or_insert(i);
        }
    }
    if jpegs.is_empty() {
        return files;
    }
    let mut raw_of: HashMap<usize, PathBuf> = HashMap::new();
    let mut paired = vec![false; files.len()];
    for (i, f) in files.iter().enumerate() {
        if crate::raw::is_raw(&f.path) {
            if let Some(&j) = jpegs.get(&key(&f.path)) {
                if !raw_of.contains_key(&j) {
                    raw_of.insert(j, f.path.clone());
                    paired[i] = true;
                }
            }
        }
    }
    files
        .into_iter()
        .enumerate()
        .filter(|(i, _)| !paired[*i])
        .map(|(i, mut f)| {
            if let Some(r) = raw_of.remove(&i) {
                f.raw = Some(r);
            }
            f
        })
        .collect()
}

/// 文件夹导入时自动建系列的名字（2026-11-17 用户定的规则）：
/// 直接放在导入文件夹里的图归入「文件夹名」，子文件夹里的归入「文件夹名-子文件夹名」，再往下依此类推。
/// 例：导入 D:\画\插画 → 插画\a.png 归「插画」，插画\2024\b.png 归「插画-2024」，插画\2024\夏\c.png 归「插画-2024-夏」。
pub fn folder_series_name(root: &Path, folder: &Path) -> String {
    // 导入的是盘符根目录（D:\）时没有文件夹名，用“D:”
    let root_name = root
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| root.to_string_lossy().trim_end_matches(['\\', '/']).to_string());
    let mut parts = vec![root_name];
    if let Ok(rel) = folder.strip_prefix(root) {
        parts.extend(rel.components().filter_map(|c| match c {
            std::path::Component::Normal(s) => Some(s.to_string_lossy().into_owned()),
            _ => None,
        }));
    }
    parts.join("-")
}

/// 一个来源里的所有图片。按路径的实际类型判断文件 / 文件夹（拖进来的路径不一定标对）
fn collect(source: &Source) -> Vec<Found> {
    let root = PathBuf::from(&source.path);
    if root.is_dir() {
        walkdir::WalkDir::new(&root)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| e.depth() == 0 || !is_hidden(&e.file_name().to_string_lossy()))
            .filter_map(Result::ok)
            .filter(|e| e.file_type().is_file() && is_image(e.path()))
            .map(|e| {
                let folder = e.path().parent().map(Path::to_path_buf);
                let series = folder.as_deref().map(|f| folder_series_name(&root, f));
                Found { path: e.into_path(), folder, series, raw: None }
            })
            .collect()
    } else if root.is_file() && is_image(&root) {
        vec![Found { path: root, folder: None, series: None, raw: None }]
    } else {
        vec![]
    }
}

fn read_item(found: &Found, known: Option<&Known>) -> Option<ScanItem> {
    let path = found.path.as_path();
    let folder = found.folder.as_deref();
    let meta = std::fs::metadata(path).ok()?;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0);
    let size = meta.len();
    let file_name = path.file_name()?.to_string_lossy().into_owned();
    let title = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| file_name.clone());
    let folder_name = found.series.clone();
    let base = |date: Option<String>, ts: f64, width: u32, height: u32| ScanItem {
        path: path.to_string_lossy().into_owned(),
        file_name: file_name.clone(),
        title: title.clone(),
        folder: folder.map(|f| f.to_string_lossy().into_owned()),
        folder_name: folder_name.clone(),
        date,
        ts,
        mtime,
        size,
        width,
        height,
        raw: found.raw.as_ref().map(|r| r.to_string_lossy().into_owned()),
    };

    if let Some(k) = known {
        if k.mtime == mtime && k.size == size && k.width > 0 {
            return Some(base(k.date.clone(), k.ts, k.width, k.height));
        }
    }

    // SVG：从根标签读尺寸（读不到给 0，前端按默认比例摆）；没有 EXIF，日期只可能来自 XMP 元数据
    if is_svg(path) {
        let (w, h) = crate::svg::svg_size(path).unwrap_or((0, 0));
        let (date, ts) = match dates::read_xmp_date(path) {
            Some(d) => (Some(d.display), d.ts),
            None => (None, mtime),
        };
        return Some(base(date, ts, w, h));
    }

    // 相机 RAW（2026-11-18）：只读文件结构（几 KB），尺寸用内嵌预览的（已按方向换算），日期读 EXIF。
    // 读不出结构也照样收进来（宽高 0，前端按默认比例摆；生成缩略图失败时卡片显示“无法打开这张图”）
    if crate::raw::is_raw(path) {
        let info = crate::raw::probe(path, false).unwrap_or_default();
        let (w, h) = info.display_size();
        let (date, ts) = match info.date {
            Some(d) => (Some(d.display), d.ts),
            None => (None, mtime),
        };
        return Some(base(date, ts, w, h));
    }

    // 只读文件头拿尺寸，不解码整张图（GIF / BMP / TIFF 也一样）
    let (mut w, mut h) = image::ImageReader::open(path).ok()?.with_guessed_format().ok()?.into_dimensions().ok()?;
    // EXIF：JPEG / PNG / WebP / TIFF 有；GIF / BMP 没有，读不到就用 XMP 或修改时间
    let exif = dates::read_exif(path);
    if (5..=8).contains(&exif.orientation) {
        std::mem::swap(&mut w, &mut h);
    }
    let found = exif.date.or_else(|| dates::read_xmp_date(path));
    let (date, ts) = match found {
        Some(d) => (Some(d.display), d.ts),
        None => (None, mtime),
    };
    Some(base(date, ts, w, h))
}

#[tauri::command]
pub async fn scan_sources(
    app: AppHandle,
    sources: Vec<Source>,
    known: HashMap<String, Known>,
) -> Result<ScanResult, String> {
    // 让前端能用 asset 协议读这些位置的原图
    for s in &sources {
        let p = Path::new(&s.path);
        crate::asset_scope::allow(&app, p, p.is_dir() || s.kind == "folder");
    }

    tauri::async_runtime::spawn_blocking(move || {
        let missing: Vec<String> =
            sources.iter().filter(|s| !Path::new(&s.path).exists()).map(|s| s.path.clone()).collect();
        let mut seen = std::collections::HashSet::new();
        let mut files: Vec<Found> = Vec::new();
        for s in &sources {
            for f in collect(s) {
                // 同一张图既在文件夹里又被单独选过：以先出现的为准
                if seen.insert(f.path.clone()) {
                    files.push(f);
                }
            }
        }
        // RAW + JPG 同名：合并成一幅（显示 JPG，RAW 挂在上面）
        let files = pair_raw_with_jpeg(files);
        let items: Vec<ScanItem> = files
            .par_iter()
            .filter_map(|f| {
                let key = f.path.to_string_lossy();
                read_item(f, known.get(key.as_ref()))
            })
            .collect();
        ScanResult { items, missing }
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_extensions() {
        assert!(is_image(Path::new("a/b/C.PNG")));
        assert!(is_image(Path::new("x.jpeg")));
        assert!(is_image(Path::new("x.webp")));
        for e in ["a.gif", "a.BMP", "a.tif", "a.TIFF", "a.svg"] {
            assert!(is_image(Path::new(e)), "{e}");
        }
        assert!(is_svg(Path::new("x.SVG")) && !is_svg(Path::new("x.png")));
        assert!(!is_image(Path::new("x.psd")));
        assert!(!is_image(Path::new("noext")));
    }

    #[test]
    fn scans_folder_with_dimensions_and_parent() {
        let dir = std::env::temp_dir().join(format!("peekit-scan-{}", std::process::id()));
        let sub = dir.join("夏日");
        std::fs::create_dir_all(&sub).unwrap();
        image::RgbImage::new(40, 50).save(sub.join("a.png")).unwrap();
        image::RgbImage::new(30, 20).save(dir.join("b.jpg")).unwrap();
        std::fs::write(dir.join("notes.txt"), "x").unwrap();
        std::fs::create_dir_all(dir.join(".hidden")).unwrap();
        image::RgbImage::new(10, 10).save(dir.join(".hidden").join("c.png")).unwrap();

        let files = collect(&Source { path: dir.to_string_lossy().into(), kind: "folder".into() });
        assert_eq!(files.len(), 2);
        let root_name = dir.file_name().unwrap().to_string_lossy().into_owned();
        let a = files.iter().find(|f| f.path.ends_with("a.png")).unwrap();
        let item = read_item(a, None).unwrap();
        assert_eq!((item.width, item.height), (40, 50));
        assert_eq!(item.title, "a");
        // 子文件夹里的图：「导入的文件夹名-子文件夹名」
        assert_eq!(item.folder_name, Some(format!("{root_name}-夏日")));
        assert!(item.date.is_none());
        assert_eq!(item.ts, item.mtime);
        // 直接放在导入文件夹里的图：「导入的文件夹名」
        let b = files.iter().find(|f| f.path.ends_with("b.jpg")).unwrap();
        assert_eq!(read_item(b, None).unwrap().folder_name, Some(root_name));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn pairs_raw_with_same_name_jpeg() {
        // 同一文件夹、同名（不分大小写）的 RAW + JPG 合并成一幅：留 JPG、RAW 挂在上面；
        // 没配对的 RAW 照常保留；别的文件夹里的同名 RAW 不算
        let f = |p: &str| Found { path: PathBuf::from(p), folder: None, series: None, raw: None };
        let out = pair_raw_with_jpeg(vec![
            f(r"D:\a\IMG_1.CR3"),
            f(r"D:\a\img_1.JPG"),
            f(r"D:\a\IMG_2.CR3"),
            f(r"D:\b\IMG_1.NEF"),
            f(r"D:\a\IMG_3.jpg"),
        ]);
        let names: Vec<_> = out.iter().map(|x| x.path.to_string_lossy().into_owned()).collect();
        assert_eq!(names, vec![r"D:\a\img_1.JPG", r"D:\a\IMG_2.CR3", r"D:\b\IMG_1.NEF", r"D:\a\IMG_3.jpg"]);
        assert_eq!(out[0].raw.as_deref(), Some(Path::new(r"D:\a\IMG_1.CR3")));
        assert!(out[1].raw.is_none() && out[2].raw.is_none() && out[3].raw.is_none());
        assert!(is_image(Path::new("x.CR3")) && is_image(Path::new("x.nef")));
    }

    #[test]
    fn folder_series_names_follow_the_tree() {
        let root = Path::new(r"D:\画\插画");
        assert_eq!(folder_series_name(root, root), "插画");
        assert_eq!(folder_series_name(root, &root.join("2024")), "插画-2024");
        assert_eq!(folder_series_name(root, &root.join("2024").join("夏")), "插画-2024-夏");
        // 盘符根目录没有文件夹名
        assert_eq!(folder_series_name(Path::new(r"D:\"), Path::new(r"D:\草稿")), "D:-草稿");
    }
}
