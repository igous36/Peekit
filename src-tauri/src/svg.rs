//! SVG 的尺寸（2026-11-17 新增）：只读 <svg> 根标签的 width / height / viewBox，不解析整个文件。
//! SVG 不生成缩略图：界面直接显示矢量原图（多大都清晰，<img> 里也不会执行脚本）。

use std::io::Read;
use std::path::Path;

/// 根标签一般在文件开头；只读前 256KB（有的文件前面有很长的注释或内嵌样式）
const HEAD_BYTES: u64 = 256 * 1024;

/// 从文件读出 SVG 的尺寸（px）。读不到时返回 None，前端按默认比例摆卡片
pub fn svg_size(path: &Path) -> Option<(u32, u32)> {
    let mut head = Vec::new();
    std::fs::File::open(path).ok()?.take(HEAD_BYTES).read_to_end(&mut head).ok()?;
    size_from_text(&String::from_utf8_lossy(&head))
}

/// 从 SVG 文本里找根标签的尺寸：width / height 都是绝对长度就用它们，否则用 viewBox 的宽高
pub fn size_from_text(text: &str) -> Option<(u32, u32)> {
    let start = find_root(text)?;
    let end = text[start..].find('>')? + start;
    let tag = &text[start..end];
    let w = attr(tag, "width").and_then(length_px);
    let h = attr(tag, "height").and_then(length_px);
    let vb = attr(tag, "viewBox").and_then(view_box);
    let (w, h) = match (w, h, vb) {
        (Some(w), Some(h), _) => (w, h),
        // 只写了一边：按 viewBox 的比例补另一边
        (Some(w), None, Some((vw, vh))) => (w, w * vh / vw),
        (None, Some(h), Some((vw, vh))) => (h * vw / vh, h),
        (_, _, Some(v)) => v,
        _ => return None,
    };
    if !(w.is_finite() && h.is_finite()) || w <= 0.0 || h <= 0.0 {
        return None;
    }
    Some((w.round().max(1.0) as u32, h.round().max(1.0) as u32))
}

/// `<svg` 标签的开头（跳过 `<svg:...` 之类不相干的）
fn find_root(text: &str) -> Option<usize> {
    let mut from = 0;
    while let Some(i) = text[from..].find("<svg") {
        let at = from + i;
        match text[at + 4..].chars().next() {
            Some(c) if c.is_whitespace() || c == '>' || c == '/' => return Some(at),
            _ => from = at + 4,
        }
    }
    None
}

/// 标签里某个属性的值；属性名前面必须是空白（避免把 stroke-width 当成 width）
fn attr<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
    let mut from = 0;
    while let Some(i) = tag[from..].find(name) {
        let at = from + i;
        from = at + name.len();
        let before_ok = tag[..at].chars().last().is_some_and(char::is_whitespace);
        let rest = tag[from..].trim_start();
        if !before_ok || !rest.starts_with('=') {
            continue;
        }
        let rest = rest[1..].trim_start();
        let quote = rest.chars().next()?;
        if quote != '"' && quote != '\'' {
            continue;
        }
        let body = &rest[1..];
        return body.find(quote).map(|e| &body[..e]);
    }
    None
}

/// 长度 → px：没有单位或 px 原样，pt / pc / mm / cm / in 按 96dpi 换算；百分比、em 等相对单位不算
fn length_px(v: &str) -> Option<f64> {
    let v = v.trim();
    let split = v.find(|c: char| !(c.is_ascii_digit() || c == '.' || c == '-' || c == '+' || c == 'e' || c == 'E'));
    let (num, unit) = match split {
        Some(i) => (&v[..i], v[i..].trim()),
        None => (v, ""),
    };
    let n: f64 = num.parse().ok()?;
    let k = match unit {
        "" | "px" => 1.0,
        "pt" => 96.0 / 72.0,
        "pc" => 16.0,
        "mm" => 96.0 / 25.4,
        "cm" => 96.0 / 2.54,
        "in" => 96.0,
        _ => return None,
    };
    Some(n * k)
}

/// viewBox="minX minY width height"（空格或逗号分隔）→ (width, height)
fn view_box(v: &str) -> Option<(f64, f64)> {
    let nums: Vec<f64> = v
        .split(|c: char| c.is_whitespace() || c == ',')
        .filter(|s| !s.is_empty())
        .map(|s| s.parse().ok())
        .collect::<Option<_>>()?;
    match nums.as_slice() {
        [_, _, w, h] if *w > 0.0 && *h > 0.0 => Some((*w, *h)),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn width_height_and_units() {
        assert_eq!(size_from_text(r#"<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">"#), Some((800, 600)));
        assert_eq!(size_from_text(r#"<svg width='4in' height="72pt" >"#), Some((384, 96)));
        assert_eq!(size_from_text(r#"<svg width="100mm" height="50mm">"#), Some((378, 189)));
    }

    #[test]
    fn falls_back_to_view_box() {
        assert_eq!(size_from_text(r#"<?xml version="1.0"?><svg viewBox="0 0 1200 900">"#), Some((1200, 900)));
        assert_eq!(size_from_text(r#"<svg width="100%" height="100%" viewBox="0,0,300,400">"#), Some((300, 400)));
        // 只写了宽度：按 viewBox 的比例算高度
        assert_eq!(size_from_text(r#"<svg width="600" viewBox="0 0 300 400">"#), Some((600, 800)));
    }

    #[test]
    fn ignores_look_alikes() {
        // stroke-width 不是 width；<svgx> 不是根标签
        let t = r#"<!-- <svgx width="1"> --><svg stroke-width="3" viewBox="0 0 10 20" width="40" height="80">"#;
        assert_eq!(size_from_text(t), Some((40, 80)));
        assert_eq!(size_from_text("<html></html>"), None);
        assert_eq!(size_from_text(r#"<svg width="auto">"#), None);
    }
}
