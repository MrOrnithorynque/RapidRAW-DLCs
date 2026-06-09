---
name: export
description: Use this skill before modifying the export pipeline in src-tauri/src/export_processing.rs (encoders, resize, watermark, filename templates, batch/cancel, size estimation, mask/LUT export) or LUT parsing in src-tauri/src/lut_processing.rs, plus the frontend ExportPanel.tsx. Covers the export_images/cancel_export/estimate_export_sizes Tauri commands, batch-export-progress events, ExportSettings/ResizeOptions/WatermarkSettings, supported formats (jpg, png, tiff, webp, jxl, avif, cube), and .cube/.3dl/HALD LUT load/apply. Trigger whenever the user asks to add or change an export format, resize mode, watermark option, filename variable, LUT export, or batch-export behavior.
---

# Export Pipeline Skill

Full-resolution render-and-encode pipeline that reuses the GPU image pipeline to write edited images to disk, plus `.cube`/`.3dl`/HALD LUT load and `.cube` export. Lives in `src-tauri/src/export_processing.rs` and `src-tauri/src/lut_processing.rs`; the frontend UI is `src/components/panel/right/ExportPanel.tsx`.

## Key files
| path | responsibility |
|------|----------------|
| `src-tauri/src/export_processing.rs` | All three export Tauri commands, encoders, resize/watermark, filename wiring, batch orchestration, mask export, LUT export |
| `src-tauri/src/lut_processing.rs` | `Lut` struct, `parse_lut_file` (.cube/.3dl/HALD), `generate_identity_lut_image`, `convert_image_to_cube_lut` |
| `src-tauri/src/lib.rs` | Registers commands (the `invoke_handler!` macro opens ~line 2222; the export commands are at ~2262), `get_or_load_lut` + `lut_cache`, `load_and_parse_lut` command |
| `src/components/panel/right/ExportPanel.tsx` | Export UI; calls `Invokes.ExportImages` / `EstimateExportSizes` / `CancelExport` |
| `src/components/ui/ExportImportProperties.tsx` | `FileFormats` enum, `FILE_FORMATS` list, `FILENAME_VARIABLES`, `ExportSettings`/`WatermarkSettings`/`ExportPreset` TS types |
| `src/components/ui/ExportPresetsList.tsx` | Save/apply named export presets (stored in app settings `exportPresets`) |
| `src/hooks/useTauriListeners.ts` | Subscribes to `batch-export-progress`, `export-complete`, `export-error`, `export-cancelled` (lines ~138-153) |
| `src/hooks/useEditorActions.ts` | Calls `load_and_parse_lut` to apply a LUT in the editor (line ~89) |

## How it works
- `export_images` (async command) guards against a concurrent export via `state.export_task_handle`, sizes a thread pool (`available_cores.min(ram_based_limit).clamp(1,16)`; `ram_based_limit = available_ram_gb / 2.5`; forced to 1 for a single image), then `tokio::spawn`s one task.
- Inside the task, each image runs in `spawn_blocking` gated by a `tokio::sync::Semaphore`. Each worker: parses the virtual path, loads `.rrdata` sidecar adjustments (or `current_edit_adjustments` for the open image), hydrates them, builds the output filename, then for non-`cube` formats loads the base image, calls `process_image_for_export` -> `process_and_get_dynamic_image` (the GPU render, see `image-pipeline`/`gpu-shaders`) -> `apply_export_resize_and_watermark` -> `save_image_with_metadata`.
- `save_image_with_metadata` calls `encode_image_to_bytes`, then `exif_processing::write_image_with_metadata` (see `metadata-exif`), then writes to disk (or Android gallery on `target_os = "android"`).
- Progress: each worker `fetch_add`s an `AtomicUsize` (SeqCst) and emits `batch-export-progress {current,total,path}`. On finish the task emits `export-complete` or `export-complete-with-errors`, then clears `export_task_handle`.
- Cancel: `cancel_export` `.take()`s the `JoinHandle` and `.abort()`s it. The blocking workers also re-check `export_task_handle.is_none()` at the top to bail early.
- LUT export (`output_format == "cube"`): renders a 33³ identity LUT through the GPU with spatial effects zeroed, then `convert_image_to_cube_lut`.
- Base image loading: the open ("current edit") image uses `get_full_image_for_processing` + `composite_patches_on_image`, falling back to a fresh disk load on error; all other images load via `read_file_mapped` (mmap) with a `fs::read` fallback, both through `load_and_composite`.

## Key types & symbols
| symbol | kind | what |
|--------|------|------|
| `export_images` | `#[tauri::command]` | Batch export orchestrator (`Invokes.ExportImages`) |
| `cancel_export` | `#[tauri::command]` | Aborts the running export task (`Invokes.CancelExport`) |
| `estimate_export_sizes` | `#[tauri::command]` | Renders one image at reduced res and extrapolates total bytes (`Invokes.EstimateExportSizes`) |
| `load_and_parse_lut` | `#[tauri::command]` | Parses a LUT file and caches it; returns `LutParseResult { size }` (invoked as string `'load_and_parse_lut'`) |
| `ExportSettings` | struct | `jpeg_quality: u8`, `resize: Option<ResizeOptions>`, `keep_metadata`, `preserve_timestamps`, `strip_gps`, `filename_template: Option<String>`, `watermark`, `export_masks`, `preserve_folders` |
| `ResizeMode` / `ResizeOptions` | enum/struct | `LongEdge`/`ShortEdge`/`Width`/`Height`; `{ mode, value, dont_enlarge }` |
| `WatermarkAnchor` / `WatermarkSettings` | enum/struct | 9 anchors; `{ path, anchor, scale, spacing, opacity }` (scale/spacing as % of base min-dim, opacity 0-100) |
| `encode_image_to_bytes` | fn | Format match: `jxl`, `webp`, `jpg`/`jpeg`, `png`, `tiff`, `avif` |
| `process_image_for_export_pipeline` | fn | Transforms + masks + GPU render; sets `show_clipping = 0` |
| `export_adjustments_as_lut` | fn | 33³ identity render -> `.cube` bytes |
| `export_masks_for_image` | fn | Per-mask isolated render + alpha PNG |
| `Lut`, `parse_lut_file`, `convert_image_to_cube_lut`, `generate_identity_lut_image` | struct/fn | LUT data + IO in `lut_processing.rs` |
| `get_or_load_lut` (`lib.rs`) | fn | Looks up `state.lut_cache` (Arc<Lut> per path), else `parse_lut_file` |

## Conventions (follow these when coding here)
- All structs use `#[serde(rename_all = "camelCase")]`; JSON keys are camelCase and form the frontend contract (`jpegQuality`, `dontEnlarge`, etc.).
- Format dispatch is by lowercased extension string in `encode_image_to_bytes` (and `output_format == "cube"` is handled separately in the worker, not in `encode_image_to_bytes`).
- JPEG export uses the `image` crate's `JpegEncoder::new_with_quality` (NOT mozjpeg-rs; mozjpeg-rs is only used by the preview/encode command in `lib.rs`). `jpeg_quality` is `u8` 0-255 but practically 0-100 from the UI.
- JXL: `quality == 100` -> `LosslessConfig`; otherwise `LossyConfig` with `distance = max((100 - quality)/10, 0.01)`. WebP passes `jpeg_quality as f32` straight to `webp::Encoder::encode`.
- Add new TS `FileFormats` entries to `FILE_FORMATS` in `ExportImportProperties.tsx`; `extensions[0]` is sent as `outputFormat`.
- Filename template variables (exact, replaced in `file_management::generate_filename_from_template`): `{original_filename}`, `{sequence}`, `{YYYY}`, `{MM}`, `{DD}`, `{hh}`, `{mm}`. Default template when none given is `"{original_filename}_edited"`.
- `show_clipping` is always forced to `0` for export and size-estimate renders.

## Gotchas
- PNG: if the image is `Rgb32F`, it is converted to `Rgb16` (not `Rgb8`). TIFF is ALWAYS re-encoded as `Rgb16` and drops alpha. JPEG always goes through `to_rgb8()`.
- `jxl` and `webp` arms `return Ok(...)` early; the shared `Cursor`/`Vec` path is only for jpg/png/tiff/avif. New formats that build their own byte buffer must also `return Ok(...)`.
- LUT export size is hardcoded to `33` (non-configurable) and writes `.cube` text, not binary. It zeroes spatial/detail effects (vignette, grain, sharpness, clarity, dehaze, structure, `centré`, glow, halation, flare, luma/color NR, both CA axes) but keeps color/tone.
- Concurrency: a second `export_images` call returns `"An export is already in progress."`. Workers bail with `"Export cancelled"` if `export_task_handle` is `None`.
- The backend emits `export-complete-with-errors` but `useTauriListeners.ts` does NOT subscribe to it; it also does NOT emit `export-cancelled` even though the frontend listens for it. Wire both ends if you rely on those.
- `export_masks`: the main image is rendered with `masks` cleared to `[]`; masks are exported separately by `export_masks_for_image` as `{stem}_mask_{i}_image.{ext}` + `{stem}_mask_{i}_alpha.png`. No-op if `export_masks` is false or there are no masks.
- `preserve_folders` only keeps relative subdirs whose components are all `Normal`/`CurDir` (path-traversal guard); otherwise it flattens to the output root.
- Virtual-path variant IDs (`?vc=ID` or `_vcNN`) append `_VC{:02}` to the stem so multiple appearances of one source don't collide.
- `estimate_export_sizes` renders at reduced resolution (cached 1920px preview for the current edit, else 1280px `ESTIMATE_DIM`) and extrapolates by pixel-area ratio; `cube` is hardcoded to `1_050_000` bytes/image.
- LUT parsers: `.cube` requires `LUT_3D_SIZE` and exact `size³·3` floats; `.3dl` infers size via `cbrt` and rejects non-perfect-cubes; HALD requires a square image. Loaded LUTs are cached in `state.lut_cache` by path string and never auto-evicted, so changing a LUT file's contents in place won't be picked up until restart.
- Watermark geometry: scale and spacing are both `base_image.min(width,height)` percentages; opacity is a per-pixel alpha multiply (not premultiplied). `image::imageops::overlay` takes `i64` x/y and silently clips if the watermark + spacing pushes it off-canvas.
- On `target_os = "android"`, images go to the gallery via `save_image_bytes_to_android_gallery` and `.cube` LUTs to downloads via `save_file_bytes_to_android_downloads`; the non-Android path is a plain `fs::write`. Both branches require a valid file name from `output_path`.

## How to add a new export format or option
1. Backend encoder: add a lowercase-extension arm to the `match` in `encode_image_to_bytes` (`src-tauri/src/export_processing.rs`). Use an `image::ImageFormat` write (shared cursor path) or an external encoder; if you build your own `Vec`, `return Ok(bytes)`. Convert quality from `jpeg_quality: u8` to your codec's scale, and decide alpha handling (most fall back to `to_rgb8()`).
2. New crate (if needed): add it to `src-tauri/Cargo.toml` and import at the top of `export_processing.rs`.
3. Android MIME: add the extension to `mime_type_for_extension` (only compiled on `target_os = "android"`).
4. Estimation: if the new format needs special handling, branch it in `estimate_export_sizes` (mirroring the `cube` shortcut).
5. Frontend: add a variant to `FileFormats` and a row in `FILE_FORMATS` (id + display name + `extensions`) in `src/components/ui/ExportImportProperties.tsx`. The first extension is sent as `outputFormat`.
6. For a new *option* (e.g. a watermark or resize field): add the field to the Rust struct (camelCase via serde) AND the matching TS interface in `ExportImportProperties.tsx` and `ExportPreset`, then read it in `apply_watermark` / `calculate_resize_target` / the worker. Wire the control + state in `ExportPanel.tsx`.
7. New resize mode: add a `ResizeMode` variant and handle it in both branches of `calculate_resize_target` (the `dont_enlarge` check and the `fix_width` selection), keeping aspect ratio.
8. Build `src-tauri` to confirm serde + the new arm compile, and round-trip an export from the UI.

## Related skills
`image-pipeline`, `gpu-shaders`, `masking`, `metadata-exif`, `file-management`, `presets`, `tauri-bridge`, `state-stores`, `hooks`, `android`

## After changes
- Rust: `cargo fmt` and `cargo clippy` inside `src-tauri/`.
- TS: `npm run typecheck` and `npm run lint`.
- If you added UI strings, wrap them in `t()` and run `npm run i18n:extract` / `npm run i18n:check`.
- Write a changelog entry per the `changelog` skill.
