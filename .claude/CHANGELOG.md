# Agent Harness Changelog

Changes to the Claude Code agent harness under `.claude/` (skills, agents, settings).
This is **not** the RapidRAW product changelog — user-facing app changes go in the
AppStream `<release>` notes in `data/io.github.CyberTimon.RapidRAW.metainfo.xml`
(see the `changelog` skill).

## 2026-06-09 — Retarget the whole harness from an unrelated project to RapidRAW

The `.claude/` harness was inherited from a different codebase (a Python/FastAPI +
LangGraph + Next.js "Stäubli" competitive-intelligence app) and described nothing about
this project. It was rebuilt from scratch to reflect RapidRAW (the Tauri v2 / Rust + React
RAW photo editor), after a deep multi-agent exploration of every module.

### Added — one skill per module (24 new skills)

Backend (Rust, `src-tauri/src/`):
- `image-pipeline` — the non-destructive Adjustments pipeline, RAW develop, geometry transforms, preview/analytics workers, histogram/waveform.
- `gpu-shaders` — the wgpu compute/render pipeline and WGSL shaders; the `repr(C)`/Pod uniform layout shared with the shaders.
- `masking` — local adjustment masks (radial/linear/brush/flow/color/luminance/AI) and per-pixel mask influence.
- `ai-features` — ONNX (`ort`) masks/depth/denoise/inpaint, CLIP auto-tagging, perceptual-hash culling, the cloud/ai-connector generative backends.
- `file-management` — library indexing, thumbnails + cache, `.rrdata` sidecars, copy/move/trash, virtual copies, albums, import.
- `export` — encoders (JPEG/WebP/JXL/PNG/TIFF), resize/watermark/filename templates, batch export, LUT load/apply.
- `metadata-exif` — EXIF read/write/cache, editable fields, GPS/strip-gps.
- `corrections` — denoising (BM3D + AI-NIND) and Lensfun lens correction.
- `compositions` — panorama stitching, HDR merge, the collage maker, and film-negative conversion.
- `presets` — preset persistence/import (incl. Lightroom), previews, community presets.
- `android` — the JNI/SAF Android integration and mobile build path.

Frontend (React, `src/`):
- `state-stores` — the 5 Zustand stores and the `Adjustments` contract.
- `hooks` — the UI↔backend mediation layer (`useImageProcessing`, `useEditorActions`, listeners, etc.).
- `editor-canvas` — the editing canvas, Konva mask/crop overlays, waveform/histogram.
- `adjustments-ui` — the right-hand adjustment controls and panel tabs.
- `library-ui` — the virtualized library grid/filmstrip/folder tree.
- `modals` — the feature-modal system and its open/close state.
- `ui-primitives` — the reusable UI/design system, theming, typography.

Cross-cutting:
- `tauri-bridge` — the `invoke`/`Invokes`/`listen`/event IPC contract.
- `i18n` — translations, code style, and dual logging conventions.
- `backend` and `frontend` were rewritten as **index** skills that map their sub-skills.

### Changed

- `CLAUDE.md` — rewritten to describe the real architecture: the `Adjustments` JSON contract, `.rrdata` sidecars, the `invoke`/`Invokes` IPC bridge, the wgpu/WGSL pipeline, the 97 Tauri commands, the 5 Zustand stores, hard rules, and a skill map.
- `build`, `changelog`, `create-feature`, `security-review`, `screenshot` — rewritten for RapidRAW (npm/cargo/tauri build; AppStream release notes; Rust↔React feature order; Tauri-desktop threat model; native-window screenshots).
- `agents/code-reviewer.md` — retargeted to Rust + React/TS + WGSL (GPU struct alignment, untrusted-file parsing, the `Adjustments` 3-layer contract); dropped the Python/SQL/Go and "integration with other agents" cruft.
- `agents/inquisitor.md` — kept the inspection structure; replaced every Stäubli example with RapidRAW ones (commands, structs, events, hard rules).
- `settings.json` — replaced docker/python/pnpm permissions with npm/cargo/tauri; repointed the post-edit ESLint hook from the nonexistent `frontend/` directory to `src/`.
- `launch.json` — points at the Vite dev server on port 1420 (was `pnpm -C frontend dev`).

### Removed

- `skills/documentation-frontend/` and `agents/docs-updater.md` — both assumed a `docs/architecture/*.md` tree and a JSDoc-on-every-file convention. RapidRAW has neither (only 2 of 104 frontend files use header doc blocks, and there is no `docs/` tree), so both were deleted rather than rewritten.

### Verified

- Each module skill was written against the real source and independently re-checked by an `inquisitor` pass. Confirmed corrections were applied — e.g. `adjustments-ui` (the Rust adjustment structs are `#[repr(C)]` GPU buffers mapped manually in `get_global_adjustments_from_json`, not serde-deserialized), `ai-features` (generative replace routes on the `use_fast_inpaint` flag first, then `ai_provider`), `backend` (34 `.rs` files; `window_setup_complete` is a bare `AtomicBool`), `corrections` (the reader is `get_geometry_params_from_json`), and `compositions` (the sRGB↔linear helpers are HDR-only).

### Note

- `skills/navigate/` (drive the running RapidRAW window on macOS via `osascript`/`screencapture`) was added outside this rewrite. It is RapidRAW-accurate and kept; confirm whether you want it retained.
