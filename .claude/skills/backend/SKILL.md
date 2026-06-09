---
name: backend
description: Use this skill before modifying the Rust/Tauri app skeleton in src-tauri/ — lib.rs (run(), the invoke_handler! list of all 97 commands, preview/analytics workers), app_state.rs (AppState Mutex caches + GPU/AI + mpsc channels), app_settings.rs (settings.json), formats.rs, adjustment_utils.rs, window_customizer.rs, and build.rs (ONNX download). This is the INDEX skill for the whole Rust backend and the map to the other backend skills. Trigger whenever the user asks to add/register/remove a Tauri command, touch AppState/global caches/workers, change app settings persistence, wire a backend->frontend event, edit the app builder/plugins/window lifecycle, or generally "modify the backend / Rust / src-tauri".
---

# Backend (Tauri App Skeleton) Skill

The Rust backend is a Tauri v2 app in `src-tauri/src/` (~26k lines, 27 `.rs` modules + 4 WGSL shaders). This skill covers the app skeleton: the builder/`run()`, the global `AppState`, settings persistence, format detection, and the build-time ONNX download. Per-feature logic lives in the sibling skills below.

## Backend module map

| Skill | Covers (src-tauri/src/) |
|---|---|
| `image-pipeline` | `image_processing.rs`, `image_loader.rs`, `raw_processing.rs`, `cache_utils.rs`, `adjustment_utils.rs` |
| `gpu-shaders` | `gpu_processing.rs`, `shaders/*.wgsl` |
| `masking` | `mask_generation.rs` |
| `ai-features` | `ai_commands.rs`, `ai_processing.rs`, `ai_connector.rs`, `tagging.rs`, `tagging_utils.rs`, `culling.rs` |
| `file-management` | `file_management.rs`, `image_loader.rs`, `cache_utils.rs` |
| `export` | `export_processing.rs`, `lut_processing.rs` |
| `metadata-exif` | `exif_processing.rs` |
| `corrections` | `lens_correction.rs`, `denoising.rs` |
| `compositions` | `panorama_stitching.rs`, `panorama_utils.rs`, HDR (`merge_hdr`/`save_hdr`), collage (`save_collage`), `negative_conversion.rs` |
| `presets` | `preset_converter.rs` |
| `android` | `android_integration.rs`, mobile build |
| `tauri-bridge` | frontend `invoke()` / `Invokes` enum / `listen()` wiring |

## Key files

| path | responsibility |
|---|---|
| `src-tauri/src/lib.rs` | `run()` entry (line 1890): builds Tauri app, plugins, `.manage(AppState{...})` (line 2190), `invoke_handler!` (lines 2222–2320, 97 cmds), window lifecycle, workers, logging |
| `src-tauri/src/main.rs` | thin binary that calls `rapidraw_lib::run()` |
| `src-tauri/src/app_state.rs` | `AppState` struct (30 fields) + `LoadedImage`, `CachedPreview`, `PreviewJob`, `AnalyticsJob`, `ThumbnailManager`, `WindowState` |
| `src-tauri/src/app_settings.rs` | `AppSettings` + `load_settings`/`save_settings` commands; reads/writes `settings.json` in `app_data_dir()` |
| `src-tauri/src/formats.rs` | `RAW_EXTENSIONS`, `NON_RAW_EXTENSIONS`, `is_raw_file()`, `is_supported_image_file()` |
| `src-tauri/src/adjustment_utils.rs` | `hydrate_adjustments()` (restores cached AI patch/mask data), `apply_all_transformations()` (geometry chain) |
| `src-tauri/src/window_customizer.rs` | `PinchZoomDisablePlugin`: macOS window rounding (14pt), Linux pinch-zoom removal |
| `src-tauri/build.rs` | downloads + SHA256-verifies ONNX Runtime v1.22.0 into `resources/`, loaded at runtime via `ORT_DYLIB_PATH` |
| `src-tauri/tauri.conf.json` | window config (transparent, no decorations, 1280x720), file associations, version 1.5.7 |

## How it works

- Frontend calls `invoke(Invokes.X, args)`; Tauri routes to the matching `#[tauri::command]` fn. Commands take `state: tauri::State<AppState>` (shared, `.manage`d) and/or `app_handle: tauri::AppHandle`.
- The hot path (live editing) is decoupled from IPC by two mpsc workers spawned in `setup()`: `start_preview_worker()` (line 650) and `start_analytics_worker()` (line 616). `apply_adjustments` builds a `PreviewJob` (with a oneshot `responder`), sends it on `preview_worker_tx`, and awaits the result. The worker drains the channel and processes **only the latest** job, so stale requests are dropped silently. The analytics worker emits `histogram-update` / `waveform-update` events.
- Heavy work (image transforms, encoding, GPU) runs on these dedicated threads or `spawn_blocking`, never inline on the async IPC thread.
- GPU context is lazily created via `get_or_init_gpu_context()` and cached in `state.gpu_context` (see `gpu-shaders`). Image decode/process lives in `image-pipeline`.
- Settings persist as `settings.json` in `app_data_dir()`. Window geometry persists as `window_state.json` and the GPU crash flag (`.gpu_init_crash_flag`) live in `app_config_dir()`.

## Key types & symbols

| symbol | kind | what |
|---|---|---|
| `run()` | fn (lib.rs:1890) | builds the app: plugins, `setup()`, `on_window_event`, `.manage(AppState)`, `invoke_handler!`, `RunEvent` loop |
| `AppState` | struct (app_state.rs:109) | 30 fields, all `Mutex<...>`/`Arc<...>` except `ai_init_lock: TokioMutex<()>`. Holds `original_image`, `cached_preview`, `gpu_context`, caches (`mask_cache`, `patch_cache`, `geometry_cache`, `lut_cache`, `decoded_image_cache`), the worker senders, etc. |
| `PreviewJob` / `AnalyticsJob` | struct | unit of work for the preview/analytics workers; `PreviewJob.responder` is a `oneshot::Sender<Vec<u8>>` |
| `apply_adjustments` | command (lib.rs:686) | queues a `PreviewJob`, awaits oneshot, returns `tauri::ipc::Response` (raw JPEG or WGPU-signal bytes) |
| `frontend_ready` | command (lib.rs:1805) | called once when UI mounts; restores window size/pos/maximize/fullscreen, shows window, emits `open-with-file` |
| `load_settings`/`save_settings` | command (app_settings.rs:518/575) | load migrates `copy_paste_settings`; save also resizes `decoded_image_cache` capacity |
| `AppSettings` | struct (app_settings.rs) | persisted prefs; new fields must use `Option<T>`/`#[serde(default)]` for back-compat |
| `is_raw_file` / `is_supported_image_file` | fn (formats.rs) | case-insensitive extension checks against the format tables |
| `PinchZoomDisablePlugin` | struct (window_customizer.rs) | custom Tauri `Plugin` registered in the builder |

## Conventions (follow these when coding here)

- Every command takes `state: tauri::State<'_, AppState>` to reach shared state; never stash globals elsewhere.
- Lock narrowly: take a `Mutex` guard in a small `{ ... }` block and drop it before doing heavy/awaiting work. Hold at most one cache lock at a time.
- `std::sync::Mutex` for sync code; `TokioMutex` only for the async AI-init path (`ai_init_lock`). Do not `.await` while holding a `std::sync::Mutex`.
- Commands return `Result<T, String>`; map errors with `.map_err(|e| e.to_string())`.
- Caches are hash-keyed (`transform_hash`, geometry hash, etc.); compute the key, check, recompute on miss, store. See `cache_utils` in `image-pipeline`.
- Background/cancellable work checks an `Arc<AtomicBool>` token (e.g. `thumbnail_cancellation_token`) and emits progress events.
- Module-namespaced commands in `invoke_handler!` (e.g. `app_settings::load_settings`) are still invoked from the frontend by the **bare** fn name (`'load_settings'`) — Tauri strips the module path.

## Gotchas

- The preview/analytics workers **supersede**: `while let Ok(latest) = rx.try_recv() { job = latest; }` discards all but the newest job. Spamming previews renders only the last — by design.
- Window stays hidden until `frontend_ready`. A 4s failsafe task (lib.rs ~2101) force-shows it if the frontend never reports ready.
- GPU crash recovery: if `.gpu_init_crash_flag` exists at startup, `processing_backend` is forced to `"gl"` and the flag deleted (lib.rs ~1966).
- `apply_adjustments` returns raw bytes wrapped in `tauri::ipc::Response`: either mozjpeg JPEG or a WGPU render signal — the frontend must handle both.
- Adding an `AppSettings` field without `Option`/`#[serde(default)]` breaks loading old `settings.json`. If it is a copy-paste setting, also add it to `all_available_adjustments()` (and `default_included_adjustments()` if copied by default), or `load_settings`'s migration won't pick it up.
- `invoke_handler!` typos are **not** caught at compile time for the frontend side — a missing/mistyped entry surfaces as a runtime "command not found".
- ONNX: `build.rs` downloads the runtime at build time; it needs internet and a matching SHA256, else the build fails.
- macOS quits via `libc::_exit(0)` in the `RunEvent` loop — Rust destructors do not run on exit; do cleanup explicitly.

## How to add a new Tauri command end-to-end

1. **Define** the command in the right module (or a new `src-tauri/src/my_feature.rs` declared with `mod my_feature;` near the top of `lib.rs`):
   ```rust
   #[tauri::command]
   pub fn my_command(arg: String, state: tauri::State<AppState>) -> Result<MyOut, String> { ... }
   ```
   Make it `async` + use `spawn_blocking` for CPU-heavy work, or queue a `Job` to a worker if it competes with previews.
2. If it needs new shared state, add a field to `AppState` (`app_state.rs`) and initialize it in the `.manage(AppState { ... })` block in `lib.rs` (line 2190).
3. **Register** it in `invoke_handler!` (lib.rs:2222–2320) as `my_feature::my_command` (or the bare name if defined in `lib.rs`).
4. **Add the Invokes entry** in `src/components/ui/AppProperties.tsx`: `MyCommand = 'my_command'` (the **bare** fn name).
5. **Call from the frontend**: `import { invoke } from '@tauri-apps/api/core'` then `await invoke(Invokes.MyCommand, { arg })`. Argument keys are camelCase per the JSON contract.
6. To push results to the UI, `app_handle.emit("my-event", payload)` in Rust and subscribe in `src/hooks/useTauriListeners.ts` via `listen('my-event', ...)` — see `tauri-bridge`.

## Related skills

`image-pipeline`, `gpu-shaders`, `masking`, `ai-features`, `file-management`, `export`, `metadata-exif`, `corrections`, `compositions`, `presets`, `android`, `tauri-bridge`, `state-stores`, `build`, `changelog`

## After changes

- Rust: run `cargo fmt` and `cargo clippy` inside `src-tauri/`.
- If you touched the frontend wiring (`Invokes`, listeners, store calls): `npm run typecheck` and `npm run lint`.
- If you added user-facing UI strings, register keys with `npm run i18n:extract` (verify with `npm run i18n:check`).
- Record user-facing changes per the `changelog` skill — a `<release>` item in `data/io.github.CyberTimon.RapidRAW.metainfo.xml` (there is **no** `docs/changelog/` or `CHANGELOG.md`).
