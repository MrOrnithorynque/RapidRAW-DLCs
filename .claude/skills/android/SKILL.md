---
name: android
description: Use this skill before modifying Android-specific Rust in src-tauri/src/android_integration.rs (JNI bridge, SAF/content:// URI access, MediaStore writes, external-media library/LUT cache) or any `#[cfg(target_os = "android")]`-gated code in lib.rs, file_management.rs, export_processing.rs, lut_processing.rs, lens_correction.rs, gpu_processing.rs, app_settings.rs, and the Tauri-generated src-tauri/gen/android scaffolding (MainActivity.kt, AndroidManifest.xml). Trigger whenever the user asks to add/change/debug an Android JNI call, content-URI import/export, MediaStore save, SAF file picking, mobile platform gating, what is no-op on mobile (window decorations/maximize, GPU surface), or the NDK/Gradle build path.
---

# Android Integration Skill

Android-specific platform glue: JNI bindings to the JVM, Storage Access Framework (SAF) `content://` URI access, and MediaStore writes. Lives almost entirely in `src-tauri/src/android_integration.rs`, gated by `#[cfg(target_os = "android")]`. The matching native shell is Tauri-generated under `src-tauri/gen/android/`.

## Key files
| path | responsibility |
| --- | --- |
| `src-tauri/src/android_integration.rs` | The whole JNI bridge: ndk-context init, content-URI read/name-resolve, MediaStore save, external-media library/LUT cache. ~593 lines, nearly all `#[cfg(target_os = "android")]`. |
| `src-tauri/src/lib.rs` | `run()` calls `initialize_android(&window)` on Android (~line 2059) and registers `resolve_android_content_uri_name` in `invoke_handler!` (~line 2242); many `cfg(not(android))` no-ops live here. |
| `src-tauri/src/file_management.rs` | Branches on `is_android_content_uri()` for import (~line 3048); uses `get_android_internal_library_root()` for the persistent library root (~line 2526). |
| `src-tauri/src/export_processing.rs` | Calls `save_image_bytes_to_android_gallery` / `save_file_bytes_to_android_downloads` instead of `fs::write` on Android. |
| `src-tauri/src/lut_processing.rs` | Reads LUTs from `content://` URIs and caches them via `get_android_cached_lut_path()`. |
| `src-tauri/src/lens_correction.rs` | Loads the Lensfun DB from an embedded `include_dir!` bundle on Android instead of resolved resource files. |
| `src-tauri/src/gpu_processing.rs` | On Android the wgpu display `surface` is `None`; compute still runs but there is no display render path. |
| `src-tauri/gen/android/app/.../MainActivity.kt` | `TauriActivity` subclass: edge-to-edge, system-bar/IME inset padding, WebView background. Generated; touch only deliberately. |
| `src-tauri/gen/android/app/src/main/AndroidManifest.xml` | Manifest. Declares only `INTERNET` — storage is via SAF/MediaStore, not file permissions. |

## How it works
- **Init.** On Android startup `lib.rs` builds the webview window, then `initialize_android(&window)` uses Tauri's `webview.jni_handle().exec(...)` to pull the `JavaVM` + `Context` pointers and calls `ndk_context::initialize_android_context(...)` exactly once behind `INIT_NDK_CONTEXT: std::sync::Once`. Everything else fetches the JVM via `unsafe { JavaVM::from_raw(android_context().vm().cast()) }` and `attach_current_thread()` per call.
- **Import in.** SAF gives the frontend a `content://` URI. `file_management.rs` / `lut_processing.rs` check `is_android_content_uri(path)` (the only non-`cfg`-gated fn, always compiled), then call `resolve_android_content_uri_name` (the one `#[tauri::command]`) for the display name and `read_android_content_uri` for bytes (8 KB chunks via `ContentResolver.openInputStream`).
- **Export out.** `export_processing.rs` calls `save_image_bytes_to_android_gallery` (`Pictures/RapidRaw`, `MediaStore$Images$Media`) or `save_file_bytes_to_android_downloads` (`Download/RapidRaw`, `MediaStore$Downloads`); both delegate to `save_bytes_to_android_media_store`.
- **Persistent dirs.** `get_android_internal_library_root()` returns `<getExternalMediaDirs()[0]>/.library`; `get_android_cached_lut_path()` returns `<...>/.lut_cache/<blake3-16hex>.<ext>`.
- **Frontend side.** No `Invokes` enum entry — `resolve_android_content_uri_name` is called by raw string: `invoke<string>('resolve_android_content_uri_name', { uriStr })` in `LUTControl.tsx`. The UI branches on `osPlatform === 'android'` (from `useSettingsStore`, set via `platform()` of `@tauri-apps/plugin-os`). See `tauri-bridge`, `file-management`, `export`.

## Key types & symbols
| symbol | kind | what |
| --- | --- | --- |
| `initialize_android(window)` | fn | One-time ndk-context bootstrap from the webview JNI handle; called from `lib.rs` setup. |
| `is_android_content_uri(path)` | fn | `path.starts_with("content://")`. The ONLY fn not behind `#[cfg]` — safe to call on every platform. |
| `resolve_android_content_uri_name` | `#[tauri::command]` | Queries `OpenableColumns.DISPLAY_NAME`; on non-Android returns the URI unchanged. Registered in `invoke_handler!`. |
| `read_android_content_uri(uri)` | fn | Reads a `content://` URI to `Vec<u8>` via `openInputStream`. |
| `save_image_bytes_to_android_gallery` / `save_file_bytes_to_android_downloads` | fn | High-level MediaStore writes (Pictures vs Download). |
| `save_bytes_to_android_media_store` | fn | Core two-phase MediaStore write (`is_pending` 1 → write → 0; delete on error). |
| `get_android_internal_library_root` / `get_android_cached_lut_path` | fn | External-media `.library` root / `.lut_cache` path (blake3-keyed). |
| `get_android_content_resolver` / `parse_android_uri` | fn | JNI helpers for `ContentResolver` and `Uri.parse`. |
| `map_android_jni_error` / `clear_pending_android_exception` / `close_android_closeable` | fn | Error mapping, pending-exception clearing, `Closeable.close()`. |
| `INIT_NDK_CONTEXT` | static `Once` | Guards ndk-context init against double/concurrent calls. |

## Conventions (follow these when coding here)
- Gate every JNI fn with `#[cfg(target_os = "android")]`. For Tauri commands, keep the `#[tauri::command]` fn always-compiled and put `#[cfg(target_os = "android")]` / `#[cfg(not(target_os = "android"))]` blocks *inside* (see `resolve_android_content_uri_name`) so the command stays registered everywhere.
- Errors are `Result<_, String>` (Tauri convention); exception: `get_android_cached_lut_path` returns `anyhow::Result`. Route every JNI error through `map_android_jni_error(&mut env, e)`.
- Null-check every object result: `.and_then(|v| v.l())` then `if x.is_null() { return Err(...) }`. `ContentResolver.query`, `Uri.parse`, and streams can all return null.
- Always `close_android_closeable(&mut env, &x)` on cursors/streams before returning (success or error).
- Keep content `content://` URIs as `String`; return real filesystem locations as `PathBuf`.
- New platform divergence elsewhere: pair a `#[cfg(target_os = "android")]` block with `#[cfg(not(target_os = "android"))]`, and silence unused vars with `let _ = (..);` (see `lib.rs` `let _ = decorations;`).

## Gotchas
- **Thread affinity.** Every JNI op must run on a thread attached to the JVM. Export workers spawn threads, so each android fn re-does `JavaVM::from_raw(...).attach_current_thread()` itself — never pass a `JNIEnv`/`JObject` across threads or async boundaries.
- **Exception state is sticky.** A failed JNI call leaves a pending Java exception in thread-local state; `map_android_jni_error` clears it. Skipping cleanup poisons later calls.
- **MediaStore ordering.** `is_pending` must go 1 (insert) → write → 0 (update). A crash mid-write leaves an orphan pending item; `save_bytes_to_android_media_store` rolls back via `delete_android_media_store_item` on any error.
- **No file storage permissions.** The manifest grants only `INTERNET`. There is no broad read/write storage access — every file in/out goes through SAF (`content://`) or MediaStore. URI grants are per-file and revoked on uninstall/data-clear.
- **External-media dirs.** `getExternalMediaDirs()[0]` is assumed primary; the `.library`/`.lut_cache` dirs sit on user-clearable external storage, so caches are best-effort (re-read the URI as fallback).
- **No-ops on mobile.** Window decorations/maximize/fullscreen, `single_instance` plugin, `window_state.json` restore, and GPU pre-init are all `#[cfg(not(target_os = "android"))]`. On Android the wgpu display surface is `None` (`gpu_processing.rs`) and `use_wgpu_renderer` defaults to `false` (`app_settings.rs`).
- **`gen/android/` is generated.** Treat `MainActivity.kt`, manifest, and Gradle files as Tauri output; hand-edits can be clobbered by `tauri android init`. Build via `npm run tauri android build` (NDK + Gradle toolchain required).

## How to add an Android-gated capability (e.g. a new content-URI read)
1. Add a `#[cfg(target_os = "android")]` fn in `android_integration.rs`. Get the JVM: `let vm = unsafe { JavaVM::from_raw(android_context().vm().cast()) }.map_err(...)?;` then `let mut env = vm.attach_current_thread().map_err(...)?;`.
2. Use `get_android_content_resolver(&mut env)?` and `parse_android_uri(&mut env, uri_str)?` for SAF; make JNI calls with `env.call_method(...)` / `env.call_static_method(...)`, ending in `.and_then(|v| v.l())` (object) / `.z()` (bool) / `.i()` (int), each `.map_err(|e| map_android_jni_error(&mut env, e))?`.
3. Null-check every object result; `close_android_closeable(&mut env, &x)` on any `Closeable` before returning.
4. If frontend-callable, make it a `#[tauri::command]` with the body split into `#[cfg(target_os = "android")]` (real work) and `#[cfg(not(target_os = "android"))]` (fallback/error), then add it to `invoke_handler![...]` in `lib.rs` (near `resolve_android_content_uri_name`, ~line 2242). Call it from the frontend by string (`invoke('your_command', { ... })`) and gate the call site on `osPlatform === 'android'`.
5. For an internal helper called only from android paths, no command registration is needed; reference it from the `#[cfg(target_os = "android")]` branch in the consuming module (e.g. `file_management.rs`).
6. Build/run on device with `npm run tauri android dev` / `npm run tauri android build`.

## Related skills
`tauri-bridge`, `file-management`, `export`, `gpu-shaders`, `backend`, `build`

## After changes
- Rust: run `cargo fmt` and `cargo clippy` inside `src-tauri/`. Most android code only compiles for `--target <android-abi>`, so a desktop `cargo check` will NOT catch it — verify with an Android build (`npm run tauri android build`) or a targeted check.
- TS (if you touched a call site): `npm run typecheck` and `npm run lint`; add i18n keys with `npm run i18n:extract` if you added UI strings.
- Record any user-facing change per the `changelog` skill.
