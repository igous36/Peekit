mod dates;
mod scan;
mod thumbs;

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
        .setup(|app| {
            thumbs::prepare(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan::scan_sources,
            thumbs::make_thumbnail,
            log_error,
            log_info,
            perf_mode
        ])
        .run(tauri::generate_context!())
        .expect("启动 Peekit 失败");
}
