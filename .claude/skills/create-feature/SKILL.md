---
name: create-feature
description: Use this skill to plan and build a new RapidRAW capability that spans more than one module — e.g. a new adjustment, a new mask/AI feature, a new export option, a new modal-driven tool, or any feature that needs both a Rust backend command and React UI. Orchestrates the cross-module implementation order. Trigger when the user asks to "add a feature", "build X", "implement X", or any new capability touching both `src-tauri/` and `src/`.
---

# Create Feature Workflow

RapidRAW features almost always cross the Rust↔React boundary. Get the order right and wire the contract correctly.

## Step 1 — Scope: which modules are impacted?

Check each. Each box maps to a skill — read it before touching that module.

- [ ] **`Adjustments` data model** — a new editable value? → `image-pipeline` (Rust struct + JSON parse) + `state-stores`/`adjustments-ui` (TS type + control). The single most common feature type.
- [ ] **GPU math** — does the new value change pixels? → `gpu-shaders` (uniform + WGSL).
- [ ] **Masks** — a new mask type or mask behavior? → `masking`.
- [ ] **AI** — a new ONNX model / generative behavior / tagging / culling? → `ai-features`.
- [ ] **Files / library** — new file op, sidecar field, thumbnail/album behavior? → `file-management`.
- [ ] **Export** — new format/option? → `export`.
- [ ] **Metadata** — new EXIF field surfaced or written? → `metadata-exif`.
- [ ] **Corrections / Compositions** — denoise, lens, panorama, HDR, collage, negative? → `corrections` / `compositions`.
- [ ] **A new backend command or event** — always → `tauri-bridge`.
- [ ] **UI** — new panel, control, modal, library view? → `adjustments-ui` / `modals` / `library-ui` / `editor-canvas` / `ui-primitives`.

## Step 2 — Read the relevant skills

Load context for every impacted module via its skill (above) plus `backend` and `frontend` for the architecture. Don't start coding until you understand how the data flows through the affected modules.

## Step 3 — Plan

Write a short plan first: the files you'll touch, the new command/event names, the new `Adjustments` keys (if any), and the implementation order below. Note whether it touches the GPU struct layout (alignment risk — see `gpu-shaders`) or the `.rrdata` sidecar shape (migration — `normalizeLoadedAdjustments` must default new fields).

## Step 4 — Implement (dependency order)

Build back-to-front so each layer has something to call:

1. **Backend logic** — implement the Rust in the right module (`src-tauri/src/<module>.rs`). If it's a new command, add `#[tauri::command]` and register it in the `invoke_handler!` macro in [src-tauri/src/lib.rs](src-tauri/src/lib.rs). If it needs shared state, add a field to `AppState` ([app_state.rs](src-tauri/src/app_state.rs)). See `backend`.
2. **Data model** — if the feature is an adjustment: add the field to `GlobalAdjustments`/`MaskAdjustments` + JSON parse + scale (Rust), then the `Adjustments` interface + `INITIAL_ADJUSTMENTS` + `normalizeLoadedAdjustments` + `ADJUSTMENT_SECTIONS` (TS, [src/utils/adjustments.ts](src/utils/adjustments.ts)), then the WGSL math. See `image-pipeline` + `gpu-shaders`.
3. **IPC contract** — add the command name to the `Invokes` enum in [src/components/ui/AppProperties.tsx](src/components/ui/AppProperties.tsx); if the command emits events, add a `listen()` in [src/hooks/useTauriListeners.ts](src/hooks/useTauriListeners.ts). See `tauri-bridge`.
4. **Hook** — add/extend a hook in `src/hooks/` that calls `invoke(Invokes.X, …)`, updates the right Zustand store, and handles errors. See `hooks` + `state-stores`.
5. **UI** — add the control/panel/modal. Use existing primitives (`ui-primitives`) and `t()` for every label (`i18n`).

## Step 5 — Verify

- `npm run typecheck` + `npm run lint`; `cargo fmt` + `cargo clippy` in `src-tauri/`.
- Run the real app and exercise the feature (`screenshot` skill / `npm run tauri dev`). Tests are minimal in this repo; manual verification in the running app is the norm.

## Step 6 — Document & review

- Add UI strings via `npm run i18n:extract` (and translate, or leave for the 6 manual locales — see `i18n`).
- Run the `security-review` checklist if the feature reads untrusted files, fetches a URL, runs an external/cloud AI backend, or handles paths.
- Record a user-facing entry per the `changelog` skill.

## Rules

- Keep the `Adjustments` JSON contract consistent across all three layers (TS, Rust, WGSL). A key that exists in only two of three silently does nothing.
- Reuse: shared Rust helpers belong in their module (e.g. `cache_utils.rs`, `adjustment_utils.rs`); shared TS in `src/utils/` or `src/hooks/`. Don't duplicate.
- One component per file on the frontend; keep new modals in `src/components/modals/` and register them in `AppModals`.
