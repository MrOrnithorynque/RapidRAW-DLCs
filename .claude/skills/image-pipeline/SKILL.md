---
name: image-pipeline
description: Use this skill before modifying the non-destructive adjustment pipeline — the Adjustments JSON contract, RAW develop, geometry transforms, preview/analytics workers, and histogram/waveform. Covers src-tauri/src/image_processing.rs (GlobalAdjustments/MaskAdjustments/AllAdjustments + JSON parse + SCALES), raw_processing.rs, image_loader.rs, adjustment_utils.rs, gpu_processing.rs, lib.rs (process_preview_job / apply_adjustments), and the matching src/utils/adjustments.ts. Trigger whenever the user asks to add/change a global or mask adjustment parameter, alter RAW develop or highlight compression, change the geometry transform order (warp/rotate/flip/crop), tweak preview generation, caching, histogram, or waveform.
---

# Image Pipeline Skill

The non-destructive adjustment pipeline: it turns the per-image Adjustments JSON (stored in a `.rrdata` sidecar, camelCase keys = the frontend<->backend contract) into a processed image. Core lives in `src-tauri/src/image_processing.rs` plus `raw_processing.rs`, `image_loader.rs`, `adjustment_utils.rs`, `gpu_processing.rs`, and the worker glue in `lib.rs`.

## Key files
| path | responsibility |
| --- | --- |
| `src-tauri/src/image_processing.rs` | `GlobalAdjustments` / `MaskAdjustments` / `AllAdjustments` structs, `SCALES`, JSON->struct parsing (`get_*_adjustments_from_json`), CPU geometry warp, AGX matrices, histogram/waveform, `is_image_edited` |
| `src-tauri/src/raw_processing.rs` | RAW develop via rawler `RawDevelop` (`develop_raw_image`), demosaic-algorithm selection, highlight compression |
| `src-tauri/src/image_loader.rs` | `load_base_image_from_bytes` (RAW vs standard branch), `load_and_composite`, `composite_patches_on_image` |
| `src-tauri/src/adjustment_utils.rs` | `apply_all_transformations` — fixed geometry transform order |
| `src-tauri/src/gpu_processing.rs` | `GpuProcessor`, `RenderRequest`, `process_and_get_dynamic_image[_with_analytics]` |
| `src-tauri/src/shaders/shader.wgsl` | GPU math; its `GlobalAdjustments` struct must byte-match the Rust one |
| `src-tauri/src/lib.rs` | `apply_adjustments` command, `start_preview_worker` -> `process_preview_job`, histogram/waveform emit |
| `src-tauri/src/app_state.rs` | `PreviewJob`, `CachedPreview`, `LoadedImage`, the cache fields on `AppState` |
| `src/utils/adjustments.ts` | TS `Adjustments` interface + `INITIAL_ADJUSTMENTS` (frontend default contract) |

## How it works
- Frontend mutates the `Adjustments` object (Zustand `useEditorStore`) and calls `invoke(Invokes.ApplyAdjustments, ...)` -> the async `apply_adjustments` command builds a `PreviewJob` and sends it to the preview worker over a oneshot/mpsc channel; the worker supersedes older jobs and only the latest response (JPEG bytes) is returned.
- `process_preview_job` (`lib.rs`): `hydrate_adjustments` (fills `aiPatches`/mask data from caches) -> load cached `original_image` -> `apply_all_transformations` (geometry) -> composite AI patches -> downscale to preview dim -> generate mask bitmaps -> `get_all_adjustments_from_json` -> `process_and_get_dynamic_image` on GPU -> emit `histogram-update` / `waveform-update` events -> JPEG encode.
- All intermediate image math is linear f32 (RGBA32F/RGB32F); sRGB conversion only at load and final encode.
- Interactive edits (sliders being dragged) pass `is_interactive` + an optional `roi` bounding box and downscale further via an `interactive_divisor` keyed on `live_preview_quality` ("full"/"performance"/default). Non-interactive (release) renders at full preview dim. The crop overlay uses the separate `generate_uncropped_preview` command, which emits `preview-update-uncropped`.
- GPU rendering is wgpu + WGSL (`shader.wgsl`); see `gpu-shaders`. Mask bitmaps come from `masking` (the per-pixel blend is `get_mask_influence` in the shader). RAW develop lives here. Settings (`raw_highlight_compression`, `editor_preview_resolution`, `live_preview_quality`, `use_wgpu_renderer`) come from backend settings / `state-stores`.

## Key types & symbols
| symbol | kind | what |
| --- | --- | --- |
| `GlobalAdjustments` | struct (`#[repr(C)]`, Pod) | every non-masked param; field order + padding must match `shader.wgsl` |
| `MaskAdjustments` | struct | per-mask params; excludes vignette/grain/effects-only fields |
| `AllAdjustments` | struct | `global` + `[MaskAdjustments; MAX_MASKS]` (MAX_MASKS = 32) + mask atlas layout, passed to GPU |
| `SCALES` / `AdjustmentScales` | const/struct | per-key divisor mapping UI range -> internal value |
| `get_all_adjustments_from_json` | fn | top-level JSON -> `AllAdjustments` |
| `get_global_adjustments_from_json` | fn | uses `get_val(section, key, scale, default)` closure + `is_visible(section)` |
| `apply_all_transformations` | fn | warp -> coarse rot -> flip -> fine rot -> crop |
| `develop_raw_image` | fn | rawler develop; args incl. `fast_demosaic`, `highlight_compression` |
| `process_preview_job` / `apply_adjustments` | fn / `#[tauri::command]` | preview worker entry / frontend bridge |
| `RenderRequest` | struct | `adjustments`, `mask_bitmaps`, `lut`, `roi` |
| `calculate_histogram_from_image` / `calculate_waveform_from_image` | fn | 256-bin histogram / 256x256 waveform |

## Conventions (follow these when coding here)
- JSON keys are camelCase and are the contract. A typo silently parses to 0/default — there is no error. Match the key in `get_val`, in `src/utils/adjustments.ts`, and in `INITIAL_ADJUSTMENTS`.
- Three struct definitions must stay in lockstep for any GPU-bound field: Rust `GlobalAdjustments` (and `MaskAdjustments` if mask-applicable), the WGSL `GlobalAdjustments` in `shader.wgsl`, and the TS `Adjustments` interface. Padding fields exist for std140/Pod alignment — never delete one without updating the shader struct identically.
- New scalar params go through `SCALES` (divisor) and `get_val(section, key, scale, default)`. The `section` gates `sectionVisibility[section]`; when a section is toggled off the value is forced to its default.
- Geometry order is fixed in `apply_all_transformations`; do not reorder.
- Use `Arc<DynamicImage>` / `Cow<DynamicImage>` to avoid clones (transform fns borrow from cache on no-op).

## Gotchas
- The Rust field is literally spelled `centré` (with accent) in `GlobalAdjustments`, `AdjustmentScales`, and `SCALES`; the WGSL field is `centre` (no accent). Match each side's existing spelling — they align by struct position, not by name.
- `get_val` reads `js_adjustments[key]` at the top level — the `section` argument only controls visibility, the key is NOT nested under the section in JSON.
- Curves are fixed `[Point; 16]` arrays with a separate `*_curve_count`; points beyond 16 are dropped, fewer are zero-padded. Default curve is `[(0,0),(255,255)]`.
- Highlight compression (`raw_highlight_compression`, default 2.5, floored to 1.01) rescales channels independently and can shift hue; this is intentional.
- `fast_demosaic` (DemosaicAlgorithm::Speed) is preview-only and visibly lower quality; full-res RAW develop uses the quality path. RAW post-processing (color NR + sharpening) runs only on full-res develop, not the fast preview path.
- AI patches are composited before GPU render, so they receive base-image geometry but NOT the live GPU adjustments.
- Preview vs full-res export use the SAME GPU pipeline and order — only input resolution differs (preview clamped to `editor_preview_resolution`, default 1920).
- Cache invalidation is hash-based (`calculate_transform_hash`, `calculate_full_job_hash`); a hash collision serves a stale image. Make sure any new field that affects output feeds the hash.
- `process_preview_job` caches the geometry/crop result (`CachedPreview` keyed on `transform_hash` + `preview_dim` + `interactive_divisor`). A change that only affects GPU color math (not geometry) reuses the cached base image and only re-runs the GPU pass — correct, but means a geometry-only field MUST change `transform_hash` or the base won't regenerate.
- Histogram samples every 2nd pixel (`step_by(2)`) over Rayon chunks; waveform is a fixed 256x256 with log scaling. Both run async and emit events — they do not block the JPEG response, so the preview image can land before the scopes update.
- `is_image_edited` byte-compares current vs default `AllAdjustments` plus checks patches/masks/crop/orientation/geometry; if you add a field whose default is non-zero, confirm a no-edit image still reports unedited.

## How to add a new global adjustment parameter
Example: a `saturationBoost` slider in the `color` section.
1. TS contract: add `saturationBoost: number;` to the `Adjustments` interface and `saturationBoost: 0` to `INITIAL_ADJUSTMENTS` in `src/utils/adjustments.ts`.
2. Rust struct: add `pub saturation_boost: f32,` to `GlobalAdjustments` in `image_processing.rs`. If you grow the struct, keep alignment with the existing `_pad_*` fields (16-byte boundaries) — append before/within an existing padding group rather than at a random spot.
3. WGSL struct: add the identical field at the identical position in `GlobalAdjustments` inside `src-tauri/src/shaders/shader.wgsl` (use the no-accent ASCII name if the value has special chars). Read it as `adjustments.global.saturation_boost` in the color pass.
4. Scale: add `saturation_boost: f32,` to `AdjustmentScales` and a divisor in the `SCALES` const (e.g. `100.0` for a 0-100 slider).
5. Parse: in the `GlobalAdjustments { .. }` literal in `get_global_adjustments_from_json`, add `saturation_boost: get_val("color", "saturationBoost", SCALES.saturation_boost, None),`.
6. Mask variant (only if it should be mask-applicable): mirror steps 2-5 in `MaskAdjustments`, the WGSL `MaskAdjustments`, and `get_mask_adjustments_from_json`. Otherwise leave masks alone.
7. Frontend UI: wire a slider in `adjustments-ui` that writes `saturationBoost` onto the editor adjustments; persistence + `apply_adjustments` invocation are already handled by the editor.
8. Verify the field reaches the hash so the cache invalidates (it will if it is in the JSON `calculate_transform_hash` reads).

## Related skills
`gpu-shaders`, `masking`, `export`, `file-management`, `metadata-exif`, `ai-features`, `state-stores`

## After changes
- TS: `npm run typecheck` and `npm run lint`; if you added UI strings run `npm run i18n:extract`.
- Rust: `cd src-tauri && cargo fmt && cargo clippy`.
- Sanity-check the three struct definitions (Rust `GlobalAdjustments`, WGSL `GlobalAdjustments`, TS `Adjustments`) are still in lockstep.
- Record a user-facing change as an AppStream `<release>` entry per the `changelog` skill (there is no docs/changelog dir).
