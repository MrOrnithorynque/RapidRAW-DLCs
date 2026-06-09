---
name: compositions
description: Use this skill before modifying RapidRAW's multi-image composition features — panorama stitching (src-tauri/src/panorama_stitching.rs + panorama_utils/), HDR merge (merge_hdr/save_hdr in lib.rs via the image-hdr crate), the canvas-based collage maker (save_collage + CollageModal), and film negative inversion (src-tauri/src/negative_conversion.rs). Covers the stitch_panorama/save_panorama/merge_hdr/save_hdr/save_collage/preview_negative_conversion/convert_negatives Tauri commands, their progress/complete/error events, the Arc<Mutex<>> result slots in AppState, and the PanoramaModal/HdrModal/CollageModal/NegativeConversionModal UIs. Trigger whenever the user asks to add, change, or debug panorama, HDR, collage, or negative-conversion features, their feature matching/homography/blending/tonemapping/inversion math, multi-image progress events, or to add a new composition tool (backend command + result slot + modal).
---

# Compositions Skill

Features that synthesize one output from multiple input images: panorama, HDR, collage, and film-negative conversion. Backend lives in `src-tauri/src/panorama_stitching.rs`, `panorama_utils/`, `negative_conversion.rs`, and `lib.rs` (HDR + collage); UIs are the four modals in `src/components/modals/`.

## Key files
| path | responsibility |
|------|----------------|
| `src-tauri/src/panorama_stitching.rs` | `stitch_panorama`/`save_panorama` commands; loads images, builds stitch order (MST), calls the blender |
| `src-tauri/src/panorama_utils/processing.rs` | FAST9 corners + BRIEF descriptors, Lowe-ratio matching, RANSAC homography, low-detail mask |
| `src-tauri/src/panorama_utils/stitching.rs` | `progressive_seam_stitcher` — DP seam-finding + detail-aware feathered blending |
| `src-tauri/src/lib.rs` | `merge_hdr`/`save_hdr` (HDR via image-hdr) and `save_collage` (decode+write PNG); command registration |
| `src-tauri/src/negative_conversion.rs` | `preview_negative_conversion`/`convert_negatives`; log-space inversion pipeline |
| `src-tauri/src/app_state.rs` | `panorama_result`, `hdr_result` (`Arc<Mutex<Option<DynamicImage>>>`), `geometry_cache` |
| `src/components/modals/{PanoramaModal,HdrModal,CollageModal,NegativeConversionModal}.tsx` | the four modal UIs |
| `src/components/modals/AppModals.tsx` | renders all four; wires modal state <-> productivity-action callbacks |
| `src/hooks/useProductivityActions.ts` | `handleStart/Save Panorama/Hdr`, `handleSaveCollage` — invoke + UIStore updates |
| `src/hooks/useTauriListeners.ts` | listens to panorama-/hdr- progress/complete/error events |
| `src/store/useUIStore.ts` | `panoramaModalState`, `hdrModalState`, `negativeModalState`, `collageModalState` |
| `src/hooks/useAppContextMenus.ts` | context-menu entries that seed `stitchingSourcePaths` from the current selection |

## How it works
Two architectural patterns coexist — know which one you are touching:

- **Async + AppState result slot (panorama, HDR):** the context menu writes the selected paths into `stitchingSourcePaths` and opens the modal; the modal's Stitch/Merge button calls `handleStartPanorama`/`handleStartHdr` which `invoke(Invokes.StitchPanorama|MergeHdr, { paths })`. The backend runs (panorama on `spawn_blocking` + rayon; HDR on the async runtime), emits `*-progress` strings, stores the full-res `DynamicImage` in `state.panorama_result`/`state.hdr_result`, and emits `*-complete` with a base64 PNG preview. `useTauriListeners` updates the modal state; the preview shows. Save calls `handleSavePanorama`/`handleSaveHdr` -> `invoke(Invokes.SavePanorama|SaveHdr, { firstPathStr })`, which `.take()`s the slot, writes to disk next to the first source, and writes an `.rrexif` sidecar (see `metadata-exif`).

- **Self-contained / client-side (negative, collage):** `NegativeConversionModal` calls raw-string `invoke('preview_negative_conversion', ...)`/`invoke('convert_negatives', ...)` and listens to `negative-batch-progress` itself — it does NOT use the `Invokes` enum or `useTauriListeners`, and keeps progress in local component state. `CollageModal` composites entirely in an offscreen HTML `<canvas>` (`toDataURL('image/png')`); the backend `save_collage` only base64-decodes the PNG and writes it — there is no backend collage compositing.

Panorama/HDR/negative all go through `image-loader` (`load_base_image_from_bytes`) and `image-pipeline` helpers (`downscale_f32_image`, `apply_srgb_to_linear`/`apply_linear_to_srgb`); none of these features touch the wgpu/`gpu-shaders` path — the math is CPU + rayon. Paths arriving from the frontend are virtual and must be unwrapped with `parse_virtual_path`.

## Key types & symbols
- `stitch_panorama` / `save_panorama` — tauri commands (panorama_stitching.rs) — async stitch + save; `Invokes.StitchPanorama` / `Invokes.SavePanorama`.
- `merge_hdr` / `save_hdr` — tauri commands (lib.rs ~1400 / ~1509) — exposure-weighted merge + save; `Invokes.MergeHdr` / `Invokes.SaveHdr`.
- `save_collage` — tauri command (lib.rs ~1555) — decode base64 PNG -> write; `Invokes.SaveCollage`.
- `preview_negative_conversion` / `convert_negatives` — tauri commands (negative_conversion.rs) — invoked by raw string, NOT in the `Invokes` enum.
- `progressive_seam_stitcher` / `find_adaptive_seam` — fns (panorama_utils/stitching.rs) — blender + DP seam (vertical or horizontal by overlap orientation).
- `find_features` / `match_features` / `find_homography_ransac` / `build_stitching_order` — panorama pipeline fns.
- `NegativeConversionParams` — struct — `red_weight`/`green_weight`/`blue_weight`/`exposure`/`contrast` (f32); `run_pipeline` + `analyze_bounds` do log-space inversion.
- `HDRInput` — external (image-hdr crate) — built via `HDRInput::with_image(img, exposure: Duration, gains: f32)`; merged by `hdr_merge_images`.
- AppState: `panorama_result`, `hdr_result` = `Arc<Mutex<Option<DynamicImage>>>`; `geometry_cache: Mutex<HashMap<u64, DynamicImage>>` (negative preview reuses it).
- Events: `panorama-progress|complete|error`, `panorama-warning` (emitted, NOT listened), `hdr-progress|complete|error`, `negative-batch-progress`. `*-complete` payload is `{ base64 }`; progress payloads are plain strings except `negative-batch-progress` = `{ current, total, path }`.
- Modal state: `PanoramaModalState`/`HdrModalState` share fields `{ isOpen, isProcessing, error, finalImageBase64, progressMessage, stitchingSourcePaths }`. `negativeModalState`/`collageModalState` are minimal (`targetPaths` / `sourceImages`).

## Conventions (follow these when coding here)
- Commands return `Result<_, String>`; errors surface to the modal via `*-error` event or a rejected `invoke`.
- `*-progress` payloads are plain strings; `*-complete`/`negative-batch-progress` use `serde_json::json!`.
- Result slots use the take-on-save pattern: `state.X.lock().unwrap().take()`. A save is single-shot — saving twice errors with "It might have already been saved."
- Output is auto-named next to the FIRST source path's parent: `_Pano` / `_Hdr` (`.png` if alpha, `.tiff` if `as_rgb32f().is_some()`, else `.png`), `_Collage.png`, `_Positive.tiff` (RGB16). Existing files are overwritten silently.
- Always `parse_virtual_path` frontend-supplied paths before filesystem access.
- After save, write an `.rrexif` sidecar via `crate::exif_processing::write_rrexif_sidecar` (fire-and-forget; result ignored).
- New panorama/HDR UI strings go through `t()` (react-i18next); the existing negative/collage modals already do.

## Gotchas
- **`panorama-warning` is emitted but never listened.** If you want low-overlap warnings to reach the user, add a listener in `useTauriListeners.ts`.
- **HDR is strict:** every image must have ISO/Sensitivity AND `ExposureTime` EXIF (missing -> hard error) and identical dimensions (mismatch -> detailed error). Panorama has neither requirement.
- Both panorama and HDR require >= 2 images (early `Err` otherwise).
- Panorama feature detection downscales to `MAX_PROCESSING_DIMENSION = 1600`; matches scale back via `ImageInfo.scale_factor`. Connection needs `MIN_INLIERS_FOR_CONNECTION = 15` inliers (RANSAC: 2500 iters, 5.0 px linear / squared-compared threshold) or the pair is dropped — unconnectable images fail the stitch.
- `save_*` consumes the AppState slot; calling save before a successful stitch/merge returns "No panorama/hdr image found". Re-stitch to repopulate.
- Negative conversion's `convert_negatives` is sequential in one `spawn_blocking` loop with NO cancellation — large batches block for minutes. `contrast` is scaled `k = 4.0 * contrast` (nonlinear), `exposure` shifts the sigmoid midpoint `x0 = 0.6 - exposure*0.25`. Highlights `> 0.9` get desaturated toward luma.
- Negative bounds are analyzed once from a 1080px downscale and reused for full-res, so preview and final match. Preview reuses `geometry_cache` keyed by `hash(path + "negative_preview_base")`.
- `CollageModal` resolution is whatever the offscreen canvas renders — full-res source pixels are not used unless the canvas is sized to them; quality is a frontend concern, not backend.

## How to add a new composition feature (backend command + result slot + modal)
1. **Backend command** in a new `src-tauri/src/<feature>.rs` (or `lib.rs` for small ones): take `Vec<String> paths` (+ params struct, `tauri::AppHandle`, `tauri::State<AppState>`), `parse_virtual_path` each, load via `load_base_image_from_bytes`. Emit `<feature>-progress` strings; on success store the `DynamicImage` in a new AppState slot and emit `<feature>-complete` with `{ base64 }` (or, like collage, return the path directly).
2. **AppState slot** (`app_state.rs`): add `pub <feature>_result: Arc<Mutex<Option<DynamicImage>>>` and init it in the constructor (mirror `panorama_result`).
3. **Save command:** `.take()` the slot, auto-name next to the first source's parent, `.save()`, then `write_rrexif_sidecar`.
4. **Register** both commands in the `invoke_handler!` list in `lib.rs` (and `mod <feature>;`). See `backend`.
5. **`Invokes` enum** (`src/components/ui/AppProperties.tsx`): add entries (skip only if you intend raw-string invokes like negative conversion).
6. **Modal state** (`useUIStore.ts`): add `<feature>ModalState` to the interface + initial state.
7. **Productivity actions** (`useProductivityActions.ts`): add `handleStart<Feature>` / `handleSave<Feature>` that `invoke(...)` and update the modal state; export them.
8. **Listeners** (`useTauriListeners.ts`): subscribe to `<feature>-progress|complete|error` and update modal state (or handle in-modal like negative conversion).
9. **Modal component** in `src/components/modals/<Feature>Modal.tsx`; render it in `AppModals.tsx` wired to the state + callbacks; use `t()` for all strings.
10. **Trigger:** add a context-menu entry in `useAppContextMenus.ts` that seeds the source paths and opens the modal.

## Related skills
`backend`, `image-pipeline`, `metadata-exif`, `file-management`, `state-stores`, `hooks`, `modals`, `tauri-bridge`, `i18n`, `create-feature`, `changelog`

## After changes
- TS: `npm run typecheck` and `npm run lint`; if you added UI strings, `npm run i18n:extract` then `npm run i18n:check`.
- Rust: `cargo fmt` and `cargo clippy` (run inside `src-tauri/`).
- Record user-facing changes per the `changelog` skill (AppStream `<release>` in `data/io.github.CyberTimon.RapidRAW.metainfo.xml`).
