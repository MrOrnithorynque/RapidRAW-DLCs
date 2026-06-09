// Micrographics overlays: decorative vector (SVG) graphics the user can place on a
// photo, then move / scale / rotate / recolor non-destructively. The placement is stored
// as a list of `Overlay` entries inside the per-image `Adjustments` JSON (camelCase keys,
// matching `Overlay` in `src/utils/adjustments.ts`). The live preview is drawn on the
// frontend Konva canvas; this module bakes the overlays into the final export via resvg.
//
// The SVG catalog is embedded at compile time (no runtime path resolution, works on every
// platform), mirroring how `lens_correction.rs` embeds the Lensfun DB.

use image::{DynamicImage, Rgba, RgbaImage};
use include_dir::{Dir, DirEntry, include_dir};
use once_cell::sync::Lazy;
use regex::Regex;
use resvg::{tiny_skia, usvg};
use serde::{Deserialize, Serialize};
use serde_json::Value;

static MICROGRAPHICS_DIR: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../assets/Micrographics");

/// One placed micrographic. Mirrors the `Overlay` interface in `src/utils/adjustments.ts`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Overlay {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    /// Catalog-relative path of the SVG, e.g. "Symbols/DOTS.svg".
    #[serde(default)]
    pub source: String,
    #[serde(default = "default_true")]
    pub visible: bool,
    /// Normalized center position in image space (0..1).
    #[serde(default = "default_half")]
    pub x: f32,
    #[serde(default = "default_half")]
    pub y: f32,
    /// Overlay width as a fraction of the image's smaller dimension.
    #[serde(default = "default_scale")]
    pub scale: f32,
    /// Clockwise rotation in degrees.
    #[serde(default)]
    pub rotation: f32,
    /// Hex fill override (e.g. "#ffffff"); `None` keeps the SVG's original colors.
    #[serde(default)]
    pub color: Option<String>,
    /// 0..100.
    #[serde(default = "default_opacity")]
    pub opacity: f32,
    /// Tight content bounding box `[x, y, w, h]` normalized to the SVG viewBox, used to trim the
    /// empty margins so the graphic frames to its actual content. `None` renders the whole SVG.
    #[serde(default)]
    pub content_box: Option<[f32; 4]>,
}

fn default_true() -> bool {
    true
}
fn default_half() -> f32 {
    0.5
}
fn default_scale() -> f32 {
    0.3
}
fn default_opacity() -> f32 {
    100.0
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayAsset {
    /// Catalog-relative path, used as the `source` of a placed overlay.
    pub source: String,
    /// Display name (file stem).
    pub name: String,
    /// Top-level folder the asset lives in (e.g. "Symbols").
    pub category: String,
    /// Tight content bounding box `[x, y, w, h]` normalized to the SVG viewBox (margins removed).
    pub content_box: Option<[f32; 4]>,
}

/// Computes the tight content bounding box of an SVG (after background removal), normalized to the
/// viewBox. Used to trim the empty margins around a graphic so it frames to its real content.
fn content_box_normalized(svg: &str) -> Option<[f32; 4]> {
    let opt = usvg::Options::default();
    let tree = usvg::Tree::from_data(svg.as_bytes(), &opt).ok()?;
    let size = tree.size();
    let (sw, sh) = (size.width(), size.height());
    if sw <= 0.0 || sh <= 0.0 {
        return None;
    }
    let bbox = tree.root().abs_bounding_box();
    let nx = (bbox.left() / sw).clamp(0.0, 1.0);
    let ny = (bbox.top() / sh).clamp(0.0, 1.0);
    let nw = (bbox.width() / sw).clamp(0.0, 1.0);
    let nh = (bbox.height() / sh).clamp(0.0, 1.0);
    if nw <= 0.001 || nh <= 0.001 {
        return None;
    }
    Some([nx, ny, nw, nh])
}

fn collect_overlay_assets(dir: &Dir, out: &mut Vec<OverlayAsset>) {
    for entry in dir.entries() {
        match entry {
            DirEntry::Dir(sub) => collect_overlay_assets(sub, out),
            DirEntry::File(file) => {
                let path = file.path();
                let is_svg = path
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|e| e.eq_ignore_ascii_case("svg"))
                    .unwrap_or(false);
                if !is_svg {
                    continue;
                }
                let source = path.to_string_lossy().replace('\\', "/");
                let name = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_string();
                let category = path
                    .parent()
                    .and_then(|p| p.components().next())
                    .and_then(|c| c.as_os_str().to_str())
                    .filter(|s| !s.is_empty())
                    .unwrap_or("Other")
                    .to_string();
                let content_box = file
                    .contents_utf8()
                    .and_then(|svg| content_box_normalized(&clean_and_recolor_svg(svg, None)));
                out.push(OverlayAsset {
                    source,
                    name,
                    category,
                    content_box,
                });
            }
        }
    }
}

static CATALOG: Lazy<Vec<OverlayAsset>> = Lazy::new(|| {
    let mut assets = Vec::new();
    collect_overlay_assets(&MICROGRAPHICS_DIR, &mut assets);
    assets.sort_by(|a, b| {
        a.category
            .cmp(&b.category)
            .then_with(|| a.name.cmp(&b.name))
    });
    assets
});

/// Returns the catalog of bundled micrographics, sorted by category then name.
#[tauri::command]
pub fn list_overlay_assets() -> Result<Vec<OverlayAsset>, String> {
    Ok(CATALOG.clone())
}

fn load_overlay_svg(source: &str) -> Option<&'static str> {
    // `source` is untrusted frontend input, but this is a pure in-memory lookup against the
    // embedded catalog — it never touches the filesystem, so traversal is impossible.
    MICROGRAPHICS_DIR
        .get_file(source)
        .and_then(|f| f.contents_utf8())
}

/// Returns the raw SVG text for a catalog asset so the frontend can render the live preview.
#[tauri::command]
pub fn get_overlay_asset(source: String) -> Result<String, String> {
    load_overlay_svg(&source)
        .map(|s| s.to_string())
        .ok_or_else(|| format!("Overlay asset not found: {source}"))
}

static SVG_ROOT_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?is)<svg\b[^>]*?\bwidth="([0-9.]+)"[^>]*?\bheight="([0-9.]+)""#).unwrap()
});
static SVG_VIEWBOX_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?is)<svg\b[^>]*?\bviewBox="[0-9.\-]+\s+[0-9.\-]+\s+([0-9.]+)\s+([0-9.]+)""#)
        .unwrap()
});
static RECT_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?is)<rect\b[^>]*?/>"#).unwrap());
static RECT_W_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?is)\bwidth="([0-9.]+)""#).unwrap());
static RECT_H_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?is)\bheight="([0-9.]+)""#).unwrap());
static RECT_X_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?is)\bx="([0-9.\-]+)""#).unwrap());
static RECT_Y_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?is)\by="([0-9.\-]+)""#).unwrap());
static FILL_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r##"(?i)(fill|stroke)="#[0-9a-f]{3,8}""##).unwrap());

fn svg_root_dimensions(svg: &str) -> Option<(f32, f32)> {
    if let Some(c) = SVG_ROOT_RE.captures(svg)
        && let (Ok(w), Ok(h)) = (c[1].parse::<f32>(), c[2].parse::<f32>())
    {
        return Some((w, h));
    }
    if let Some(c) = SVG_VIEWBOX_RE.captures(svg)
        && let (Ok(w), Ok(h)) = (c[1].parse::<f32>(), c[2].parse::<f32>())
    {
        return Some((w, h));
    }
    None
}

/// Removes a single full-canvas opaque background `<rect>` (present on the "Design Layouts"
/// assets) so they act as transparent overlays, and optionally recolors every fill/stroke
/// to `color`. This MUST stay in lockstep with `cleanAndRecolorSvg` in `src/utils/overlays.ts`
/// so the live preview and the baked export match.
pub fn clean_and_recolor_svg(svg: &str, color: Option<&str>) -> String {
    let mut out = svg.to_string();

    if let Some((root_w, root_h)) = svg_root_dimensions(&out) {
        let approx = |a: f32, b: f32| (a - b).abs() <= 0.5;
        if let Some(m) = RECT_RE.find(&out) {
            let tag = m.as_str();
            let rect_w = RECT_W_RE
                .captures(tag)
                .and_then(|c| c[1].parse::<f32>().ok());
            let rect_h = RECT_H_RE
                .captures(tag)
                .and_then(|c| c[1].parse::<f32>().ok());
            let x_zero = RECT_X_RE
                .captures(tag)
                .and_then(|c| c[1].parse::<f32>().ok())
                .map(|v| v.abs() <= 0.5)
                .unwrap_or(true);
            let y_zero = RECT_Y_RE
                .captures(tag)
                .and_then(|c| c[1].parse::<f32>().ok())
                .map(|v| v.abs() <= 0.5)
                .unwrap_or(true);
            if let (Some(rw), Some(rh)) = (rect_w, rect_h)
                && approx(rw, root_w)
                && approx(rh, root_h)
                && x_zero
                && y_zero
            {
                let (start, end) = (m.start(), m.end());
                out.replace_range(start..end, "");
            }
        }
    }

    if let Some(c) = color {
        let replacement = format!("$1=\"{c}\"");
        out = FILL_RE.replace_all(&out, replacement.as_str()).into_owned();
    }

    out
}

/// Rasterizes an (already cleaned/recolored) SVG so its CONTENT (the `content_box` region, with
/// empty margins trimmed) is `target_w` px wide, rotated clockwise by `rotation_deg`. The returned
/// image is sized to the rotated bounding box, so nothing is clipped.
fn rasterize_overlay(
    svg: &str,
    target_w: f32,
    rotation_deg: f32,
    content_box: Option<[f32; 4]>,
) -> Option<RgbaImage> {
    let opt = usvg::Options::default();
    let tree = usvg::Tree::from_data(svg.as_bytes(), &opt).ok()?;
    let size = tree.size();
    let (sw, sh) = (size.width(), size.height());
    if sw <= 0.0 || sh <= 0.0 || target_w < 1.0 {
        return None;
    }

    // Content region in SVG user units (defaults to the full viewBox).
    let (cx, cy, cw, ch) = match content_box {
        Some([x, y, w, h]) if w > 0.0 && h > 0.0 => (x * sw, y * sh, w * sw, h * sh),
        _ => (0.0, 0.0, sw, sh),
    };

    let target_h = (target_w * (ch / cw)).max(1.0);
    let scale = target_w / cw;

    let rad = rotation_deg.to_radians();
    let (c, s) = (rad.cos().abs(), rad.sin().abs());
    let bbox_w = (target_w * c + target_h * s).ceil().max(1.0);
    let bbox_h = (target_w * s + target_h * c).ceil().max(1.0);

    let mut pixmap = tiny_skia::Pixmap::new(bbox_w as u32, bbox_h as u32)?;
    let transform = tiny_skia::Transform::from_translate(bbox_w / 2.0, bbox_h / 2.0)
        .pre_concat(tiny_skia::Transform::from_rotate(rotation_deg))
        .pre_translate(-target_w / 2.0, -target_h / 2.0)
        .pre_scale(scale, scale)
        .pre_translate(-cx, -cy);
    resvg::render(&tree, transform, &mut pixmap.as_mut());

    let (w, h) = (bbox_w as u32, bbox_h as u32);
    let mut img = RgbaImage::new(w, h);
    for (i, px) in pixmap.pixels().iter().enumerate() {
        let x = (i as u32) % w;
        let y = (i as u32) / w;
        let d = px.demultiply();
        img.put_pixel(x, y, Rgba([d.red(), d.green(), d.blue(), d.alpha()]));
    }
    Some(img)
}

fn alpha_composite(
    base: &mut RgbaImage,
    overlay: &RgbaImage,
    top_left_x: i64,
    top_left_y: i64,
    opacity: f32,
) {
    let (bw, bh) = base.dimensions();
    let op = opacity.clamp(0.0, 1.0);
    for oy in 0..overlay.height() {
        let ty = top_left_y + oy as i64;
        if ty < 0 || ty >= bh as i64 {
            continue;
        }
        for ox in 0..overlay.width() {
            let tx = top_left_x + ox as i64;
            if tx < 0 || tx >= bw as i64 {
                continue;
            }
            let src = overlay.get_pixel(ox, oy);
            let a = (src[3] as f32 / 255.0) * op;
            if a <= 0.0 {
                continue;
            }
            let dst = base.get_pixel_mut(tx as u32, ty as u32);
            for ch in 0..3 {
                dst[ch] = (src[ch] as f32 * a + dst[ch] as f32 * (1.0 - a)).round() as u8;
            }
        }
    }
}

/// Returns the visible overlays parsed from the per-image adjustments JSON.
pub fn overlays_from_json(js_adjustments: &Value) -> Vec<Overlay> {
    js_adjustments
        .get("overlays")
        .and_then(|v| serde_json::from_value::<Vec<Overlay>>(v.clone()).ok())
        .unwrap_or_default()
}

/// Bakes every visible overlay into the (already adjusted, resized) export image, at its final
/// output resolution for crisp results.
pub fn composite_overlays_for_export(image: DynamicImage, js_adjustments: &Value) -> DynamicImage {
    let overlays = overlays_from_json(js_adjustments);
    if overlays.is_empty() {
        return image;
    }

    let mut base = image.to_rgba8();
    let (img_w, img_h) = base.dimensions();
    let min_dim = img_w.min(img_h) as f32;

    for ov in overlays
        .iter()
        .filter(|o| o.visible && o.opacity > 0.0 && !o.source.is_empty())
    {
        let raw = match load_overlay_svg(&ov.source) {
            Some(s) => s,
            None => {
                log::warn!("[overlays] missing asset for export: {}", ov.source);
                continue;
            }
        };
        let processed = clean_and_recolor_svg(raw, ov.color.as_deref());
        let target_w = (ov.scale * min_dim).max(1.0);
        let rendered = match rasterize_overlay(&processed, target_w, ov.rotation, ov.content_box) {
            Some(r) => r,
            None => continue,
        };

        let center_x = ov.x * img_w as f32;
        let center_y = ov.y * img_h as f32;
        let top_left_x = (center_x - rendered.width() as f32 / 2.0).round() as i64;
        let top_left_y = (center_y - rendered.height() as f32 / 2.0).round() as i64;
        alpha_composite(
            &mut base,
            &rendered,
            top_left_x,
            top_left_y,
            ov.opacity / 100.0,
        );
    }

    DynamicImage::ImageRgba8(base)
}
