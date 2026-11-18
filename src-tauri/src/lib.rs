mod asset_scope;
mod dates;
mod raw;
mod scan;
mod svg;
mod thumbs;
mod ui;

/// 前端的错误打到终端里（webview 的控制台在开发时不方便看）
#[tauri::command]
fn log_error(msg: String) {
    eprintln!("[peekit 前端] {msg}");
}

/// 性能探针的结果打到终端里
#[tauri::command]
fn log_info(msg: String) {
    println!("[peekit] {msg}");
}

/// 图片 403 时的诊断：按 asset 协议的两道检查（访问范围、打开文件）各跑一遍
#[tauri::command]
fn asset_check(app: tauri::AppHandle, path: String) -> String {
    use tauri::Manager;
    let allowed = app.asset_protocol_scope().is_allowed(&path);
    let canon = std::fs::canonicalize(&path).map(|p| p.display().to_string()).unwrap_or_else(|e| format!("canonicalize 出错: {e}"));
    let open = match std::fs::File::open(&path) {
        Ok(_) => "可以打开".to_string(),
        Err(e) => format!("打开失败 {:?}: {e}", e.kind()),
    };
    format!("范围允许={allowed}；规范路径={canon}；{open}")
}

/// 设置了环境变量 PEEKIT_PERF=1 时，前端启动后自动跑一遍性能探针
#[tauri::command]
fn perf_mode() -> bool {
    std::env::var("PEEKIT_PERF").map(|v| v == "1").unwrap_or(false)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 系列、归属、自定义标题存在应用数据目录的 library.json；改动后 100ms 自动保存，退出时再落盘一次
        .plugin(tauri_plugin_store::Builder::new().build())
        // 选择文件 / 文件夹的系统对话框
        .plugin(tauri_plugin_dialog::init())
        // 关于对话框里打开 GitHub 仓库、右键“在资源管理器中显示”
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            ui::apply_saved_theme(app.handle());
            thumbs::prepare(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan::scan_sources,
            thumbs::make_thumbnail,
            thumbs::make_display,
            ui::set_theme_background,
            ui::save_image_as,
            log_error,
            log_info,
            asset_check,
            perf_mode
        ])
        .run(tauri::generate_context!())
        .expect("启动 Peekit 失败");
}
