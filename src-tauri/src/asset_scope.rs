//! 把目录 / 文件加进 asset 协议的访问范围。
//!
//! Tauri 判断时会先把请求路径规范化（解开符号链接、目录联接，Windows 上还带 `\\?\` 前缀），
//! 再和范围里的模式比对。所以只加“看上去的路径”不够：
//! - 图片文件夹在目录联接 / 符号链接后面时，规范路径指向真实位置；
//! - 从 MSIX 打包的程序里启动时（比如在 Claude 桌面版里跑 tauri dev），
//!   写进 %LOCALAPPDATA% 的缩略图会被系统重定向到 `…\Packages\<包名>\LocalCache\Local\…`。
//!   这时缩略图目录是“合并视图”：有的文件在原位置，有的在重定向的位置，
//!   目录本身规范化出来的位置覆盖不了所有文件，所以缩略图要逐个文件再补一条（见 allow_real_file）。
//!
//! 这些情况下“看上去的路径”和规范路径对不上，图片会拿到 403。

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

/// 加入访问范围：原路径一条；规范路径和它不一样时再加一条
pub fn allow(app: &AppHandle, path: &Path, directory: bool) {
    add(app, path, directory);
    if let Some(real) = real_path_if_different(path) {
        add(app, &real, directory);
    }
}

/// 单个文件（缩略图）：只在它的规范路径和原路径不一样时补一条（正常安装时什么都不加，范围不会越积越多）
pub fn allow_real_file(app: &AppHandle, path: &Path) {
    if let Some(real) = real_path_if_different(path) {
        add(app, &real, false);
    }
}

fn add(app: &AppHandle, p: &Path, directory: bool) {
    let scope = app.asset_protocol_scope();
    let r = if directory { scope.allow_directory(p, true) } else { scope.allow_file(p) };
    if let Err(e) = r {
        eprintln!("asset 访问范围加入 {} 失败: {e}", p.display());
    }
}

/// 规范路径（去掉 `\\?\` 前缀后）和原路径不一样（不分大小写）才返回；路径不存在时返回 None
fn real_path_if_different(path: &Path) -> Option<PathBuf> {
    let real = std::fs::canonicalize(path).ok()?;
    let plain = strip_verbatim(&real);
    let same = plain.to_string_lossy().eq_ignore_ascii_case(path.to_string_lossy().trim_end_matches(['\\', '/']));
    if same { None } else { Some(real) }
}

/// `\\?\C:\a\b` → `C:\a\b`（只处理盘符路径；其他形式原样返回）
fn strip_verbatim(p: &Path) -> PathBuf {
    let s = p.to_string_lossy();
    match s.strip_prefix(r"\\?\") {
        Some(rest) if rest.as_bytes().get(1) == Some(&b':') => PathBuf::from(rest),
        _ => p.to_path_buf(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_verbatim_disk_prefix_only() {
        assert_eq!(strip_verbatim(Path::new(r"\\?\C:\a\b.webp")), PathBuf::from(r"C:\a\b.webp"));
        assert_eq!(strip_verbatim(Path::new(r"\\?\UNC\srv\share")), PathBuf::from(r"\\?\UNC\srv\share"));
        assert_eq!(strip_verbatim(Path::new(r"D:\x")), PathBuf::from(r"D:\x"));
    }

    #[test]
    fn same_path_is_not_reported() {
        let dir = std::env::temp_dir().join(format!("peekit-scope-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        // 临时目录本身可能在联接后面：用它的规范路径做“原路径”，结果应当是“没有不一样”
        let plain = strip_verbatim(&std::fs::canonicalize(&dir).unwrap());
        assert!(real_path_if_different(&plain).is_none());
        assert!(real_path_if_different(&dir.join("不存在.webp")).is_none());
        std::fs::remove_dir_all(&dir).ok();
    }
}
