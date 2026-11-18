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

/// 存到原文件自己身上：什么都不用做（copy 到自身会把文件截断成 0 字节）
fn same_file(a: &Path, b: &Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => false,
    }
}
