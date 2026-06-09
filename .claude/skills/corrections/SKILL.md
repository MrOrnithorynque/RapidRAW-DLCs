---
name: corrections
description: Use this skill before modifying RapidRAW's image-correction modules — denoising in src-tauri/src/denoising.rs (BM3D + AI-NIND, the apply_denoising/batch_denoise_images/save_denoised_image commands, denoise-progress/complete/error events, DenoiseModal.tsx) and lens correction in src-tauri/src/lens_correction.rs (Lensfun XML DB lookup, the get_lensfun_makers/get_lensfun_lenses_for_maker/autodetect_lens/get_lens_distortion_params commands, LensCorrectionModal.tsx) whose distortion/TCA/vignetting coefficients are applied in warp_image_geometry in image_processing.rs. Trigger whenever the user asks to add, change, or debug denoising, the BM3D/AI-NIND algorithms, batch denoise, lens distortion/chromatic-aberration/vignetting correction, the Lensfun database, lens auto-detect, or the denoise/lens correction modals.
---

# Image Corrections Skill

Two correction workflows: **denoising** (`src-tauri/src/denoising.rs`, BM3D on CPU + AI-NIND via ONNX) and **lens correction** (`src-tauri/src/lens_correction.rs`, Lensfun XML DB → distortion/TCA/vignetting coefficients). The lens coefficients are *applied* inside the geometry warp in `image_processing.rs`; denoise runs standalone and writes a new `_Denoised` file.

## Key files
| path | responsibility |
| --- | --- |
| `src-tauri/src/denoising.rs` | BM3D algorithm (`run_bm3d`, two-step joint YCbCr); `denoise_image` dispatch; commands `apply_denoising`, `batch_denoise_images`, `save_denoised_image` |
| `src-tauri/src/ai_processing.rs` | AI-NIND: `DENOISE_URL`/`DENOISE_FILENAME`/`DENOISE_SHA256`, `get_or_init_denoise_model`, `run_ai_denoise` → tiled `run_native_denoise`, `select_tile_params` |
| `src-tauri/src/lens_correction.rs` | Lensfun XML parse + lookup; `Distortion`/`Tca`/`Vignetting`/`Lens`/`LensDatabase`/`LensDistortionParams`; commands `get_lensfun_makers`, `get_lensfun_lenses_for_maker`, `autodetect_lens`, `get_lens_distortion_params`; `load_lensfun_db` |
| `src-tauri/src/image_processing.rs` | `GeometryParams` (lens fields); `warp_image_geometry`/`unwarp_image_geometry` apply poly/ptlens distortion + TCA + vignetting per pixel |
| `src-tauri/src/lib.rs` | Registers all commands in `invoke_handler!`; defines `preview_geometry_transform` command; calls `load_lensfun_db` at setup |
| `src-tauri/lensfun_db/*.xml` | Lensfun calibration DB (~60 files), bundled as a Tauri resource (desktop) / `include_dir!` (Android) |
| `src/components/modals/DenoiseModal.tsx` | Denoise UI: method `ai`/`bm3d`, intensity slider, batch toggle, before/after compare |
| `src/components/modals/LensCorrectionModal.tsx` | Lens UI: auto/manual, maker/model dropdowns, per-correction toggles+sliders, live preview |
| `src/hooks/useProductivityActions.ts` | Frontend handlers `handleApplyDenoise`/`handleBatchDenoise`/`handleSaveDenoisedImage` that `invoke` the denoise commands |
| `src/hooks/useTauriListeners.ts` | Listens for `denoise-progress`, `denoise-complete`, `denoise-error` |
| `src/utils/adjustments.ts` | `lensCorrectionMode`, `lensMaker/Model`, `lensDistortionParams`, `lens*Amount`, `lens*Enabled` keys + defaults |

## How it works
- **Denoise.** `apply_denoising(path, intensity, method)` is async: for `method == "ai"` it first calls `get_or_init_denoise_model` (download + SHA256 verify, cached in `AppState.ai_state.denoise_model`), then `spawn_blocking`s `denoise_image`. That loads the image (`load_base_image_from_bytes`, plus `apply_cpu_default_raw_processing` for RAW), converts to `Rgb32FImage`, runs `run_ai_denoise` or `run_bm3d`, builds PNG-base64 previews (downscaled to max 4000px), emits `denoise-complete {original, denoised}`, and stashes the **full-res** result in `AppState.denoise_result: Arc<Mutex<Option<DynamicImage>>>`. `save_denoised_image` `.take()`s that and writes `<stem>_Denoised.tiff` (RAW→16-bit) or `_Denoised.png`, plus an `.rrexif` sidecar. `batch_denoise_images` loops paths, saving each directly (no `denoise_result` stash).
- **Lens.** `load_lensfun_db` runs once at Tauri setup and stores `Arc<LensDatabase>` in `AppState.lens_db: Mutex<Option<Arc<LensDatabase>>>`. The modal queries makers/lenses, resolves coefficients via `get_lens_distortion_params` (which calls `Lens::get_distortion_params(focal, aperture, distance)` → interpolated `LensDistortionParams`), and feeds them into `GeometryParams`. The actual correction is per-pixel inside `warp_image_geometry` — so lens correction rides the existing geometry warp (see `image-pipeline`) and renders through `gpu-shaders`/preview like any other geometry edit. Live preview goes through the `preview_geometry_transform` command (shared with the transform modal).
- **Warp pixel order** (in `warp_image_geometry`, per source pixel): auto-crop scale → lens distortion (poly/ptlens, normalized radius `ru_norm = ru / half_diagonal`) → custom user distortion (`k_distortion`) → TCA channel shift (`interpolate_pixel_with_tca`) → vignetting gain. The lens-vs-custom distortion are separate stages; don't fold them together.
- **Denoise events:** `denoise-progress` (status string), `denoise-complete` (`{original, denoised}` PNG data-URLs), `denoise-error` (message), `denoise-batch-progress` (`{current, total, path}`). The AI model download surfaces progress through the shared `ai-features` download events.

## Key types & symbols
| symbol | kind | what |
| --- | --- | --- |
| `apply_denoising` / `batch_denoise_images` / `save_denoised_image` | tauri command | single / batch / save-to-disk denoise entry points |
| `denoise_image` | fn | dispatch on `method`; `"ai"` → `run_ai_denoise`, else `run_bm3d` |
| `Bm3dParams::from_intensity(i)` | fn | maps clamped `[0.001,1.0]` → `sigma = i*80`, `hard_th_lambda`, `max_dist_hard`, `chroma_sigma_scale=1.8` |
| `run_bm3d` / `bm3d_process_joint` / `run_bm3d_step_joint` / `block_matching_joint` | fn | BM3D core; constants `BLOCK_SIZE=8`, `STRIDE=6`, `SEARCH_WINDOW=19`, `MAX_GROUP_SIZE=16` |
| `select_tile_params(q)` | fn | AI intensity → tile preset (`TILE_FASTER`/`TILE_BALANCED`/`TILE_HIGHER_QUALITY`); NOT a noise level |
| `LensDistortionParams` | struct (`Serialize`) | `k1/k2/k3`, `model` (0=poly, 1=ptlens), `tca_vr/tca_vb`, `vig_k1/k2/k3` |
| `Lens::get_distortion_params(focal, aperture, distance)` | fn | interpolates distortion/TCA/vignetting from calibration; `None` if uncalibrated |
| `find_best_lens_match` | fn | fuzzy EXIF→lens match (`SkimMatcherV2.ignore_case()` + length penalty) used by `autodetect_lens` |
| `GeometryParams` | struct | geometry + lens fields: `lens_distortion_amount/_vignette_amount/_tca_amount`, `lens_*_enabled`, `lens_dist_k1/2/3`, `lens_model`, `tca_vr/vb`, `vig_k1/2/3` |
| `warp_image_geometry` / `unwarp_image_geometry` | fn | applies lens correction per pixel (rayon `par_chunks_exact_mut` per row) |
| `preview_geometry_transform` | tauri command (in `lib.rs`) | renders a JPEG-base64 preview from `GeometryParams`; shared by lens + transform modals |

## Conventions (follow these when coding here)
- Denoise intensity is normalized `[0.001, 1.0]` in Rust; the UI slider is `0–100` and the **frontend** divides by 100 (`intensity / 100`) before invoking. Defaults set in `DenoiseModal`: `50`/`ai` for RAW, `15`/`bm3d` for non-RAW.
- `method` is the literal string `"ai"` or `"bm3d"` — match it exactly in `denoise_image`.
- Lens UI amount sliders are `0–200` (percent); `GeometryParams` divides amounts by 100 in `get_geometry_params_from_json` (so a value of `100` ⇒ `1.0` = full correction). Distortion model field is `0` (poly3/poly5) or `1` (ptlens); branch with `is_ptlens = params.lens_model == 1`.
- `LensDistortionParams` fields serialize as plain snake_case (no `serde(rename)`); the frontend reads `k1`, `model`, `tca_vr`, `tca_vb`, `vig_k1`… verbatim. Keep the names in sync.
- Lensfun XML attributes use `#[serde(rename = "@attr")]` (e.g. `@focal`, `@k1`); elements use kebab-case via `rename_all`. Add new attributes the same way.
- New backend commands must be: `#[tauri::command]` → registered in `invoke_handler!` in `lib.rs` → added to the `Invokes` enum in `AppProperties.tsx` → called via `invoke(Invokes.X, …)` (project hard rule: never invoke by raw string). Today only `apply_denoising`/`save_denoised_image` have `Invokes` entries; `batch_denoise_images` and all four lens commands are still called by raw string — prefer adding the enum entry for anything new. See `tauri-bridge` / `backend`.
- Backend → frontend denoise events are subscribed in `useTauriListeners.ts` (`denoise-progress`/`-complete`/`-error`); `denoise-batch-progress` is subscribed directly inside `DenoiseModal`. Emit any new event from the Rust side with `app_handle.emit(...)` and add the listener in one of those spots.

## Gotchas
- AI intensity does **NOT** control noise strength — the NIND model has a fixed profile; the slider only selects a tile-size/quality preset via `select_tile_params`. BM3D intensity *does* scale noise (`sigma`).
- `save_denoised_image` calls `.take()` on `denoise_result`, so the in-memory result is consumed; saving twice returns "No denoised image found in memory". `batch_denoise_images` never populates `denoise_result`.
- AI denoise downloads ~the NIND ONNX from HuggingFace on first use (`DENOISE_URL`) — no timeout/retry; a slow network blocks the modal. Handle in `ai-features` if changing download logic.
- Lens correction is applied inside `warp_image_geometry`, not via the GPU adjustment uniforms — changing the distortion/TCA/vignetting math means editing CPU per-pixel code there, and you must keep `compute_lens_auto_crop_scale` consistent or you'll see black borders.
- TCA effective scale is `vr + (1-vr)*(1-lens_tca_amount)` (interpolated toward identity by amount); vignetting gain uses `lens_vignette_amount * 0.8`. Respect these or the slider feel changes.
- `lens_db` holds `Option<Arc<LensDatabase>>`; commands lock the `Mutex`, clone the `Arc`, and `Err("Lens database not loaded")` if `None`. Don't hold the lock across heavy interpolation.
- EXIF for auto-detect is often partial: `SubjectDistance` frequently missing → defaults applied; `FNumber`/focal must be parsed leniently in the modal.
- Lensfun DB resolution differs by platform: desktop uses `app_handle.path().resolve("lensfun_db", Resource)`; Android uses `include_dir!`/`LENS_DB_DIR`. New XML files must be picked up by both paths (drop them in `src-tauri/lensfun_db/`).

## How to add a new denoising method
1. Implement `fn run_<name>(rgb_img: &Rgb32FImage, intensity: f32, app_handle: &AppHandle) -> Result<DynamicImage, String>` in `denoising.rs` (or a sibling module), emitting `app_handle.emit("denoise-progress", msg)` for status.
2. Add a branch in `denoise_image`'s `if method == "ai" … else …` dispatch (e.g. `else if method == "<name>" { run_<name>(…) }`). If it needs a model, follow the `get_or_init_*` pattern in `ai_processing.rs` (see `ai-features`) and thread the session through like `ai_session`.
3. Widen the frontend method type from `'ai' | 'bm3d'` to include `'<name>'` in `DenoiseModal.tsx` props and add it to `methodOptions`; set sensible default intensity in the `isOpen` `useEffect`.
4. Add i18n keys (`modals.denoise.method<Name>`, any label) and run `npm run i18n:extract`.
5. No new Tauri command is needed unless you bypass `denoise_image`; if you do add one, register it in `lib.rs` and (optionally) `Invokes` in `AppProperties.tsx`.

## How to add a new lens correction type (e.g. a new coefficient)
1. Add the field(s) to the relevant Lensfun struct in `lens_correction.rs` with `#[serde(rename = "@attr")]`, extend `LensDistortionParams` (snake_case, `Serialize`), and populate it in `Lens::get_distortion_params` (interpolate by focal like TCA/distortion).
2. Add matching fields to `GeometryParams` in `image_processing.rs` (struct, `Default`, and the `get_geometry_params_from_json` reader that pulls from `adjustments[...]`), then implement the per-pixel math in `warp_image_geometry` (and mirror in `unwarp_image_geometry`).
3. Add the keys to `src/utils/adjustments.ts` (enum + `Adjustments` type + `INITIAL_ADJUSTMENTS` + hydration), surface a toggle/slider in `LensCorrectionModal.tsx`, and include the field in the `GeometryParams` object the modal sends to `preview_geometry_transform`.
4. Add i18n keys and run `npm run i18n:extract`.

## Related skills
`image-pipeline`, `ai-features`, `gpu-shaders`, `metadata-exif`, `modals`, `backend`, `tauri-bridge`, `state-stores`, `android`, `i18n`, `changelog`

## After changes
- Rust: run `cargo fmt` and `cargo clippy` inside `src-tauri/`.
- TS: run `npm run typecheck` and `npm run lint`; if you added UI strings, run `npm run i18n:extract` then `npm run i18n:check`.
- Write a changelog entry per the `changelog` skill (a `<release>` block in `data/io.github.CyberTimon.RapidRAW.metainfo.xml` — there is no `docs/changelog`).
