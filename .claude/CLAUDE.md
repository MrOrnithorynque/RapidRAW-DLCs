# RapidRAW

RapidRAW is a **non-destructive, GPU-accelerated RAW photo editor** — a cross-platform desktop app (Windows/macOS/Linux, plus an Android build) by Timon Käch (CyberTimon). Think a fast, lightweight Lightroom/Darktable alternative. License: **AGPL-3.0**. App id: `io.github.CyberTimon.RapidRAW`. Current version: 1.5.7.

It is a **Tauri v2** application:

- **Rust backend** — `src-tauri/src/` (~26k LOC, 34 `.rs` files + 4 WGSL shaders). All image decoding, the GPU image pipeline, AI, file/library management, and export live here.
- **React 19 + TypeScript + Zustand frontend** — `src/` (~45k LOC). All UI, the editor canvas, panels, and state.

The two halves talk over Tauri IPC: **98 `#[tauri::command]`s** plus a stream of backend → frontend **events**.

## Build & run

```bash
npm install              # frontend deps (npm — NOT pnpm/yarn; package-lock.json is committed)
npm run tauri dev        # == `npm start`: Vite serves the UI on :1420 and Tauri opens the native window
npm run tauri build      # production bundle for the current platform
```

Other scripts: `npm run dev` (Vite only, :1420 — `invoke()` calls fail without the Tauri backend), `npm run typecheck` (tsc, strict), `npm run lint` / `lint:fix` (ESLint), `npm run format` (Prettier), `npm run i18n:extract` / `i18n:check`. Rust checks run inside `src-tauri/`: `cargo fmt`, `cargo clippy`. The first build runs [src-tauri/build.rs](src-tauri/build.rs), which **downloads + SHA256-verifies the ONNX Runtime** (needs internet). See the `build` skill for prerequisites and troubleshooting.

## Architecture you must know

**The editing pipeline (non-destructive).** A user's edits are a single JSON object, `Adjustments`, defined on both sides:
- Frontend: [src/utils/adjustments.ts](src/utils/adjustments.ts) — the `Adjustments` interface, `INITIAL_ADJUSTMENTS` defaults, `normalizeLoadedAdjustments()`.
- Backend: `GlobalAdjustments` / `MaskAdjustments` / `AllAdjustments` in [src-tauri/src/image_processing.rs](src-tauri/src/image_processing.rs).
- JSON keys are **camelCase** and form the frontend↔backend contract — a mismatched key silently parses as `0`/default.

Edits are never written into the image; they are persisted to a per-image **`.rrdata` sidecar** file. Rendering: the frontend sends `Adjustments` → the backend preview worker decodes the original (RAW via `rawler`), applies geometry transforms, generates mask bitmaps, then runs the **wgpu + WGSL** pipeline ([src-tauri/src/shaders/](src-tauri/src/shaders/)) to produce the preview. Export reuses the same pipeline at full resolution. See `image-pipeline` and `gpu-shaders`.

**The IPC bridge.** The frontend calls the backend with `invoke(Invokes.X, args)` from `@tauri-apps/api/core`. The `Invokes` enum (the single source of truth for command names) lives in [src/components/ui/AppProperties.tsx](src/components/ui/AppProperties.tsx) and maps 1:1 to the Rust command names registered in the `invoke_handler!` macro in [src-tauri/src/lib.rs](src-tauri/src/lib.rs). Backend → frontend events (progress, thumbnails, histogram/waveform, etc.) are emitted with `app_handle.emit()` and subscribed in [src/hooks/useTauriListeners.ts](src/hooks/useTauriListeners.ts). See `tauri-bridge`.

**Frontend state.** Five Zustand stores in [src/store/](src/store/): `useSettingsStore`, `useUIStore`, `useLibraryStore`, `useEditorStore` (the **single source of truth for the current `Adjustments`** + a 50-entry undo/redo history), `useProcessStore`. Components subscribe with selectors + `useShallow`. Adjustment changes flow through `setAdjustments` (in [src/hooks/useEditorActions.ts](src/hooks/useEditorActions.ts)), which debounces history (500ms) and the `.rrdata` save (300ms). See `state-stores` and `hooks`.

## Hard rules

- **Read the area's skill before editing it.** Before touching `src-tauri/`, read `backend` (plus the specific module skill). Before touching `src/`, read `frontend`. They build the context a change needs.
- **Never call a backend command with a raw string.** A new command must be: defined `#[tauri::command]` → registered in `invoke_handler!` ([lib.rs](src-tauri/src/lib.rs)) → added to the `Invokes` enum → called via `invoke(Invokes.X, …)`. See `tauri-bridge`.
- **All user-facing UI text uses `t('key')`** from `react-i18next` — never a bare string in JSX (ESLint `i18next/no-literal-string` warns). After adding strings, run `npm run i18n:extract`. See `i18n`.
- **GPU struct layout is load-bearing.** Rust adjustment structs sent to WGSL are `#[repr(C)]` + `Pod`/`Zeroable`; never remove or reorder padding without updating the shader. See `gpu-shaders`.
- **An `Adjustments` key is a contract.** Adding an adjustment means touching the TS `Adjustments` type + `INITIAL_ADJUSTMENTS`, the Rust struct + JSON parse + scale, and the WGSL math — all of them. See `image-pipeline`.
- **Respect the non-destructive model.** Edits live in `.rrdata` sidecars; originals are read-only. Deletions go through the OS trash (`trash` crate). See `file-management`.
- **Don't hardcode hex colors in components** — use the theme tokens (`src/utils/themes.ts`). See `ui-primitives`.

## Skill map (read the relevant skill before changing that area)

**Backend (Rust, `src-tauri/src/`)** — `backend` (architecture, commands, `AppState`, workers — start here) · `image-pipeline` (adjustment/RAW pipeline) · `gpu-shaders` (wgpu + WGSL) · `masking` (local masks) · `ai-features` (ONNX masks/depth/generative, tagging, culling) · `file-management` (library, sidecars, thumbnails, albums) · `export` (encoders, LUTs, batch) · `metadata-exif` (EXIF read/write) · `corrections` (denoise + lens correction) · `compositions` (panorama, HDR, collage, negative) · `presets` · `android`.

**Frontend (React, `src/`)** — `frontend` (shell, views, providers — start here) · `state-stores` (Zustand) · `hooks` (UI↔backend mediation) · `editor-canvas` (canvas, Konva overlays, waveform) · `adjustments-ui` (right-panel controls) · `library-ui` (browser, filmstrip, folder tree) · `modals` (feature modals) · `ui-primitives` (component lib + theming).

**Cross-cutting** — `tauri-bridge` (IPC contract) · `build` (build/run/setup) · `i18n` (translations, code style, logging) · `presets` · `security-review` · `create-feature` (orchestrate a multi-module change) · `changelog` · `screenshot` (run & inspect the app) · `heal`.

## After making a change

- TypeScript: `npm run typecheck` and `npm run lint`. Rust: `cargo fmt` + `cargo clippy` in `src-tauri/`.
- Added UI strings? `npm run i18n:extract`.
- Write a changelog entry per the `changelog` skill (a `<release>` item in the AppStream metainfo + GitHub release notes — RapidRAW has **no** `docs/` tree and **no** `CHANGELOG.md`).
