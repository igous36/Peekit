//! 界面相关的小命令（2026-11-17 新增）：深色模式的窗口底色、右键菜单里的“将图像另存为”。

use std::path::{Path, PathBuf};

use tauri::window::Color;
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

/// 和前端 tokens.ts 的 color-bg 一致
const BG_LIGHT: Color = Color(0xD5, 0xD5, 0xD3, 0xFF);
const BG_DARK: Color = Color(0x1C, 0x1C, 0x1D, 0xFF);

fn theme_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("theme"))
}

/// 启动时：上次是深色就先把窗口底色换成深色（tauri.conf.json 里写死的是浅色），避免先闪一下浅灰。
/// 第一次启动还没有记录时（2026-11-18 起新安装默认跟随系统）按系统当前的深浅来
pub fn apply_saved_theme(app: &AppHandle) {
    let Some(w) = app.get_webview_window("main") else { return };
    let saved = theme_file(app).and_then(|f| std::fs::read_to_string(f).ok());
    let dark = match saved {
        Some(s) => s.trim() == "dark",
        None => matches!(w.theme(), Ok(tauri::Theme::Dark)),
    };
    if dark {
        let _ = w.set_background_color(Some(BG_DARK));
    }
}

/// 前端切换深浅时调用：换窗口底色（缩放窗口时露出的底色），并记下来给下次启动用
#[tauri::command]
pub fn set_theme_background(app: AppHandle, window: WebviewWindow, dark: bool) -> Result<(), String> {
    window.set_background_color(Some(if dark { BG_DARK } else { BG_LIGHT })).map_err(|e| e.to_string())?;
    if let Some(f) = theme_file(&app) {
        if let Some(dir) = f.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        std::fs::write(f, if dark { "dark" } else { "light" }).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 右键“将图像另存为…”：弹系统保存对话框（默认文件名 = 原文件名，默认位置 = 原文件所在文件夹），
/// 再把原图复制过去。返回保存到的路径；用户取消时返回 None。
#[tauri::command]
pub async fn save_image_as(app: AppHandle, path: String) -> Result<Option<String>, String> {
    let src = PathBuf::from(&path);
    if !src.is_file() {
        return Err(format!("找不到文件 {path}"));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let name = src.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "image".into());
        let ext = src.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
        let mut dialog = app.dialog().file().set_file_name(&name);
        if let Some(dir) = src.parent() {
            dialog = dialog.set_directory(dir);
        }
        if !ext.is_empty() {
            dialog = dialog.add_filter(ext.to_ascii_uppercase(), &[ext.as_str()]);
        }
        let Some(dest) = dialog.blocking_save_file() else { return Ok(None) };
        let dest = dest.into_path().map_err(|e| e.to_string())?;
        if same_file(&src, &dest) {
            return Ok(Some(dest.to_string_lossy().into_owned()));
        }
        std::fs::copy(&src, &dest).map_err(|e| e.to_string())?;
        Ok(Some(dest.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 导出（2026-11-20，年度回顾、长图、PDF 作品集）：前端生成好的文件内容走原始字节（不经过 JSON），
/// 默认文件名放在请求头 x-file-name（URL 编码）。弹系统保存对话框（默认在“图片”文件夹），写到用户选的位置。
/// 返回保存到的路径；用户取消返回 None
#[tauri::command]
pub async fn save_export(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<Option<String>, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("没有收到文件内容".into());
    };
    let bytes = bytes.clone();
    let name = request
        .headers()
        .get("x-file-name")
        .and_then(|v| v.to_str().ok())
        .map(percent_decode)
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "Peekit".into());
    tauri::async_runtime::spawn_blocking(move || {
        let ext = Path::new(&name).extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
        let mut dialog = app.dialog().file().set_file_name(&name);
        if let Ok(dir) = app.path().picture_dir() {
            dialog = dialog.set_directory(dir);
        }
        if !ext.is_empty() {
            dialog = dialog.add_filter(ext.to_ascii_uppercase(), &[ext.as_str()]);
        }
        let Some(dest) = dialog.blocking_save_file() else { return Ok(None) };
        let dest = dest.into_path().map_err(|e| e.to_string())?;
        // 先写临时文件再改名，写到一半失败不会留下坏文件
        let tmp = dest.with_extension("peekit-tmp");
        std::fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &dest).map_err(|e| e.to_string())?;
        Ok(Some(dest.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 置顶参考小窗（2026-11-20）：开一个无边框、钉在所有窗口最上面的小窗，加载同一个前端（index.html?ref=…），
/// 前端看到 ref 参数就只显示一幅画或一个只读的情绪板（src/ref/reference.ts）。query 由前端拼好（已经 URL 编码）。
/// 窗口透明：前端可以调整内容的不透明度，透出后面的绘画软件。可以同时开好几个（label 是 ref-1、ref-2…）
#[tauri::command]
pub async fn open_reference(app: AppHandle, query: String, width: f64, height: f64, title: String) -> Result<(), String> {
    use std::sync::atomic::{AtomicU32, Ordering};
    static N: AtomicU32 = AtomicU32::new(0);
    if query.contains('#') {
        return Err("参数不对".into());
    }
    let label = format!("ref-{}", N.fetch_add(1, Ordering::Relaxed) + 1);
    let url = tauri::WebviewUrl::App(format!("index.html?{query}").into());
    tauri::WebviewWindowBuilder::new(&app, &label, url)
        .title(title)
        .inner_size(width.clamp(200.0, 1600.0), height.clamp(160.0, 1200.0))
        .min_inner_size(160.0, 120.0)
        .decorations(false)
        .always_on_top(true)
        .transparent(true)
        .shadow(true)
        .resizable(true)
        .focused(true)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// %XX 解码（文件名里的中文等，前端用 encodeURIComponent 编码）；不合法的 % 原样保留
fn percent_decode(s: &str) -> String {
    let hex = |c: u8| (c as char).to_digit(16).map(|v| v as u8);
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2])) {
                out.push(h * 16 + l);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::percent_decode;

    #[test]
    fn decodes_file_names() {
        assert_eq!(percent_decode("2025%20%E5%88%9B%E4%BD%9C%E5%B9%B4%E5%8E%86.png"), "2025 创作年历.png");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("a%zzb"), "a%zzb");
        assert_eq!(percent_decode("%4"), "%4");
    }
}

/// 存到原文件自己身上：什么都不用做（copy 到自身会把文件截断成 0 字节）
fn same_file(a: &Path, b: &Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => false,
    }
}
