---
name: ai-features
description: Use this skill before modifying any ONNX/AI feature in src-tauri/src/ai_processing.rs, ai_commands.rs, ai_connector.rs, tagging.rs, culling.rs, or tagging_utils/. Covers SAM subject masks, U2Net foreground, sky segmentation, Depth Anything, NIND denoise, LaMa inpainting, CLIP auto-tagging, perceptual-hash culling, model download + SHA256 verification, geometry-hash caching, and the cloud/ai-connector generative-replace backends. Trigger whenever the user asks to add/change/debug an ONNX model, AI mask, auto-tagging, culling, generative replace/inpaint, model download events, or the ai-connector/ComfyUI integration.
---

# AI Features Skill

All local + remote AI under the `ort`/ONNX umbrella plus CLIP tagging and perceptual-hash culling. Lives in `src-tauri/src/`: `ai_processing.rs` (model lifecycle + inference), `ai_commands.rs` (Tauri IPC), `ai_connector.rs` (remote inpaint), `tagging.rs`, `culling.rs`, and `tagging_utils/`.

## Key files
| path | responsibility |
| --- | --- |
| `src-tauri/src/ai_processing.rs` | Model URLs/SHA256 constants, `download_and_verify_model`, all `get_or_init_*` session loaders, and every inference fn (SAM, U2Net, sky, depth, denoise, LaMa). |
| `src-tauri/src/ai_commands.rs` | The 8 AI Tauri commands: subject/foreground/sky/depth masks, precompute, connector status/test, generative replace. |
| `src-tauri/src/ai_connector.rs` | HTTP client for remote inpaint: `check_status`, `process_inpainting`; `InpaintRequest`/`MiddlewareResponse`. |
| `src-tauri/src/tagging.rs` | CLIP inference (`generate_tags_with_clip`), color/hierarchy tags, background indexing, batch tag commands. |
| `src-tauri/src/tagging_utils/candidates.rs` | `TAG_CANDIDATES` static label array (default CLIP prompt set). |
| `src-tauri/src/tagging_utils/hierarchy.rs` | `TAG_HIERARCHY` lazy map: leaf tag -> parent tags. |
| `src-tauri/src/culling.rs` | `cull_images` + `analyze_image`: Laplacian sharpness, exposure, DoubleGradient perceptual hash, duplicate grouping. |
| `src-tauri/build.rs` | Downloads + SHA256-verifies the ONNX **runtime** per-platform (`ort` is load-dynamic). Separate from the model downloads above. |
| `src/hooks/useAiMasking.ts` | Frontend hook that invokes the mask commands and stores results. |
| `src/hooks/useTauriListeners.ts` | Subscribes to all AI events (`ai-model-download-*`, `indexing-*`, `culling-*`). |

## How it works
- Models are downloaded lazily from the `CyberTimon/RapidRAW-Models` HuggingFace repo on first use, SHA256-verified, then held as `Arc<Mutex<Session>>` in `AppState.ai_state` (a `Mutex<Option<AiState>>`). Lazy init is serialized by `AppState.ai_init_lock` (a `TokioMutex`) with double-checked locking. Sessions are created once and never recreated; the per-model `std::sync::Mutex` is locked only during `Session::run()`.
- `AiModels` bundles the five "core" sessions (sam_encoder, sam_decoder, u2netp, sky_seg, depth_anything) loaded together by `get_or_init_ai_models`. `denoise_model`, `clip_models`, and `lama_model` each have their own `get_or_init_*` and live as separate `AiState` fields.
- Mask commands receive `adjustments` JSON (camelCase, the `adjustments-ui` contract), un-rotate/un-flip the click coords to image space, run inference, and return a **base64 PNG** mask. SAM embeddings (`ImageEmbeddings`) and depth maps (`CachedDepthMap`) are cached in `AiState` keyed by a path+geometry hash, so re-prompting the same image/crop skips the encoder.
- Generative replace (`invoke_generative_replace_with_mask_def`) is a 3-tier router on `settings.ai_provider`: `local` -> `run_lama_inpainting`; `cloud` -> `ai_connector::process_inpainting` against `https://getrapidraw.com/api`; `ai-connector` -> the same HTTP path against a self-hosted ComfyUI address.
- Tagging: `start_background_indexing` spawns a concurrent Tokio stream over the folder, runs CLIP per thumbnail, merges AI tags with `color:`/`user:` tags, writes `.rrdata` sidecars (the `metadata-exif` contract). Culling: `cull_images` runs `analyze_image` in parallel (Rayon), groups by Hamming distance, filters blurry shots.

## Key types & symbols
| symbol | kind | what |
| --- | --- | --- |
| `generate_ai_subject_mask` / `precompute_ai_subject_mask` | command | SAM encode+decode; precompute warms the embedding cache for snappy drawing. |
| `generate_ai_foreground_mask` / `generate_ai_sky_mask` / `generate_ai_depth_mask` | command | U2Net / sky-seg / Depth Anything masks. Depth returns range params for thresholding. |
| `invoke_generative_replace_with_mask_def` | command | 3-tier inpaint router (local LaMa / cloud / ai-connector). |
| `check_ai_connector_status` / `test_ai_connector_connection` | command | Poll/test the ai-connector; status emits `ai-connector-status-update`. |
| `start_background_indexing` / `add_tag_for_paths` / `remove_tag_for_paths` / `clear_ai_tags` / `clear_all_tags` | command | Auto-tagging + batch tag management. |
| `cull_images` | command | Duplicate/blur culling, returns `CullingSuggestions`. |
| `AiModels` / `AiState` / `ClipModels` | struct | Session containers held in `AppState.ai_state`. |
| `ImageEmbeddings` / `CachedDepthMap` | struct | Per-image geometry-keyed inference caches. |
| `download_and_verify_model` | fn | Downloads to app data dir, verifies SHA256, re-downloads on mismatch; emits `ai-model-download-start/finish`. |
| `TAG_CANDIDATES` / `TAG_HIERARCHY` / `COLOR_TAG_PREFIX` (`color:`) / `USER_TAG_PREFIX` (`user:`) | const | Tag vocabulary, hierarchy, and reserved prefixes. |

## Conventions (follow these when coding here)
- Each new model needs three constants in `ai_processing.rs`: `*_URL`, `*_FILENAME`, `*_SHA256`. Always route the download through `download_and_verify_model` so verification + events stay consistent.
- Load sessions via `Session::builder()?.commit_from_file(...)`, wrap in `Arc<Mutex<Session>>`, store in `AiState`, and gate init behind `ai_init_lock` with a double-check of the cache field.
- Masks/depth maps are `GrayImage` (u8 0-255) encoded to base64 PNG. Inpaint results are base64 (JPEG color + mask).
- Tag arrays in sidecars are sorted (`sort_unstable`) and deduped before write; set `tags` to `None` when empty. Never drop `color:`/`user:` tags except where the command explicitly says so (`clear_all_tags` keeps only `color:`; `clear_ai_tags` keeps both prefixes).
- Tagging commands return `Result<(), String>`; mask/inpaint commands return serde structs with `String` errors. Long-running work emits progress events instead of blocking the UI return.
- ImageNet normalization (`[0.485,0.456,0.406]/[0.229,0.224,0.225]`) for U2Net/sky/depth; CLIP uses its own mean/std in `preprocess_clip_image`.

## Gotchas
- The `Mutex<Session>` is held for the whole `Session::run()`; concurrent mask requests on the same model serialize. Don't hold it across `.await`.
- `ai_init_lock` is held during download, so a slow first download blocks other AI init. There is no timeout — a missing model on a slow network stalls indexing/masking.
- Embedding/depth caches key on path **and** geometry. Any crop/rotation/flip change invalidates the cache; coordinate scaling depends on `embeddings.original_size`, so a size mismatch yields offset masks.
- `generate_ai_depth_mask` and `precompute_ai_subject_mask` are invoked by **raw string literals** in `useAiMasking.ts`, not via the `Invokes` enum in `AppProperties.tsx`. Most other AI commands have enum entries — match the existing call site's style.
- `custom_ai_tags` (AppSettings) fully **replaces** `TAG_CANDIDATES`, it is not merged. Confidence threshold (`0.005`) and color-tag count are hardcoded in `tagging.rs`.
- New entries in `TAG_CANDIDATES` get no parents unless you also add them to `TAG_HIERARCHY`. Keep `candidates.rs` array length in sync with its declared size.
- `build.rs` verifies the ORT **runtime** binary, distinct from the model SHA256s; updating one does not touch the other.
- CLIP/LaMa/denoise are loaded on demand; the core-five load together. Don't assume a session exists — always go through its `get_or_init_*`.

## How to add a new ONNX model + command
1. In `ai_processing.rs` add `const MY_URL`, `const MY_FILENAME`, `const MY_SHA256` (HuggingFace `resolve/main/...?download=true`).
2. Add the session field — either to `AiModels` (if it loads with the core set) or as a new `Option<Arc<Mutex<Session>>>` field on `AiState`.
3. Write `get_or_init_my_model`: double-check the `AiState` field, acquire `ai_init_lock`, call `download_and_verify_model`, build the session with `Session::builder()?.commit_from_file`, store it.
4. Write `run_my_model(image, session)`: preprocess to an ndarray tensor (resize + normalize), `session.lock().unwrap().run(ort::inputs![...])`, extract output, post-process to a `GrayImage`, return.
5. Add `#[tauri::command] pub async fn my_command(...)` in `ai_commands.rs`: hydrate adjustments/geometry, call `get_or_init_my_model` then `run_my_model`, encode to base64 PNG, return a serde struct (or `Result<_, String>`).
6. Register it in `src-tauri/src/lib.rs` inside the `generate_handler!` macro (the AI block near line ~2247).
7. Frontend: add an entry to the `Invokes` enum in `src/components/ui/AppProperties.tsx`, call it from `src/hooks/useAiMasking.ts` (or a sibling hook) via `invoke(...)`, and if it emits new events, subscribe in `src/hooks/useTauriListeners.ts`.

## Related skills
`backend`, `masking`, `corrections`, `heal`, `tauri-bridge`, `metadata-exif`, `library-ui`, `state-stores`, `hooks`, `adjustments-ui`

## After changes
- Rust: `cargo fmt` + `cargo clippy` inside `src-tauri/`.
- Frontend wiring: `npm run typecheck` and `npm run lint`; add i18n keys via `npm run i18n:extract` for any new user-facing strings.
- Write a changelog entry per the `changelog` skill.
