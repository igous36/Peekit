// 发布版在 Windows 上不弹出额外的控制台窗口，不要删
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    peekit_lib::run()
}
