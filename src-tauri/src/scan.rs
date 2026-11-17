//! 扫描导入的文件 / 文件夹：找出 PNG / JPG / WebP，读尺寸、日期。
//! 文件没变（修改时间和大小都一样）就直接用前端传回来的旧结果，启动时不必重新读每张图。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::dates;

pub const IMAGE_EXTS: [&str; 4] = ["png", "jpg", "jpeg", "webp"];

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
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub items: Vec<ScanItem>,
    /// 找不到的来源（被移走或删掉了）
    pub missing: Vec<String>,
}

pub fn is_image(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| IMAGE_EXTS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn is_hidden(name: &str) -> bool {
    name.starts_with('.') || name.eq_ignore_ascii_case("thumbs.db")
}

/// 一个来源里的所有图片：(图片路径, 所在文件夹)。按路径的实际类型判断文件 / 文件夹（拖进来的路径不一定标对）
fn collect(source: &Source) -> Vec<(PathBuf, Option<PathBuf>)> {
    let root = PathBuf::from(&source.path);
    if root.is_dir() {
        walkdir::WalkDir::new(&root)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| e.depth() == 0 || !is_hidden(&e.file_name().to_string_lossy()))
            .filter_map(Result::ok)
            .filter(|e| e.file_type().is_file() && is_image(e.path()))
            .map(|e| {
                let parent = e.path().parent().map(Path::to_path_buf);
                (e.into_path(), parent)
            })
            .collect()
    } else if root.is_file() && is_image(&root) {
        vec![(root, None)]
    } else {
        vec![]
    }
}

fn read_item(path: &Path, folder: Option<&Path>, known: Option<&Known>) -> Option<ScanItem> {
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
    let folder_name = folder.and_then(|f| f.file_name()).map(|n| n.to_string_lossy().into_owned());
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
    };

    if let Some(k) = known {
        if k.mtime == mtime && k.size == size && k.width > 0 {
            return Some(base(k.date.clone(), k.ts, k.width, k.height));
        }
    }

    // 只读文件头拿尺寸，不解码整张图
    let (mut w, mut h) = image::ImageReader::open(path).ok()?.with_guessed_format().ok()?.into_dimensions().ok()?;
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
    let scope = app.asset_protocol_scope();
    for s in &sources {
        let p = Path::new(&s.path);
        let r = if p.is_dir() || s.kind == "folder" { scope.allow_directory(p, true) } else { scope.allow_file(p) };
        if let Err(e) = r {
            eprintln!("asset scope: {e}");
        }
    }

    tauri::async_runtime::spawn_blocking(move || {
        let missing: Vec<String> =
            sources.iter().filter(|s| !Path::new(&s.path).exists()).map(|s| s.path.clone()).collect();
        let mut seen = std::collections::HashSet::new();
        let mut files: Vec<(PathBuf, Option<PathBuf>)> = Vec::new();
        for s in &sources {
            for (p, folder) in collect(s) {
                // 同一张图既在文件夹里又被单独选过：以先出现的为准
                if seen.insert(p.clone()) {
                    files.push((p, folder));
                }
            }
        }
        let items: Vec<ScanItem> = files
            .par_iter()
            .filter_map(|(p, folder)| {
                let key = p.to_string_lossy();
                read_item(p, folder.as_deref(), known.get(key.as_ref()))
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
        let a = files.iter().find(|(p, _)| p.ends_with("a.png")).unwrap();
        let item = read_item(&a.0, a.1.as_deref(), None).unwrap();
        assert_eq!((item.width, item.height), (40, 50));
        assert_eq!(item.title, "a");
        assert_eq!(item.folder_name.as_deref(), Some("夏日"));
        assert!(item.date.is_none());
        assert_eq!(item.ts, item.mtime);
        std::fs::remove_dir_all(&dir).ok();
    }
}
