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

/// 环境变量 PEEKIT_PERF：1 = 前端启动后自动跑一遍舞台的性能探针；board = 只跑情绪板压测（2026-11-19）。
/// 没设返回空字符串
#[tauri::command]
fn perf_mode() -> String {
    std::env::var("PEEKIT_PERF").unwrap_or_default()
}

/// 更新自测（发版前用）：PEEKIT_UPDATE_PROBE=check 只检查；=download 检查并下载、验签，不安装；
/// =install 下载后直接安装。结果打到终端，见前端 app.ts 的 runUpdateProbe
#[tauri::command]
fn update_probe() -> String {
    std::env::var("PEEKIT_UPDATE_PROBE").unwrap_or_default()
}

/// 装完更新后重启。Windows 上用不到（安装程序会先关掉应用、装完自己重新打开），留给以后的 macOS 版
#[tauri::command]
fn restart_app(app: tauri::AppHandle) {
    app.restart();
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
        // 自动更新（2026-11-18）：读 GitHub Release 上的 latest.json，安装包用 tauri.conf.json 里的公钥验签
        .plugin(tauri_plugin_updater::Builder::new().build())
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
            perf_mode,
            update_probe,
            restart_app
        ])
        .run(tauri::generate_context!())
        .expect("启动 Peekit 失败");
}
