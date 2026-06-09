---
name: presets
description: Use this skill before modifying the preset system in RapidRAW — backend persistence/import/export in src-tauri/src/file_management.rs (load_presets/save_presets/handle_import*/handle_export_presets_to_file/save_community_preset), Lightroom XMP/.lrtemplate conversion in src-tauri/src/preset_converter.rs, preview rendering in src-tauri/src/lib.rs (generate_preset_preview, fetch_community_presets), and the frontend src/hooks/usePresets.ts + src/components/panel/right/PresetsPanel.tsx + src/components/modals/ConfigurePresetModal.tsx + src/components/panel/CommunityPage.tsx. Covers the Preset/PresetFolder/PresetItem types, presets.json storage, style-vs-tool preset types, includeMasks/includeCropTransform, COPYABLE_ADJUSTMENT_KEYS filtering, and Community presets. Trigger whenever the user asks to add/change/debug a preset import format, a preset-able adjustment, preset previews, preset folders, tool/style presets, Lightroom import, or community presets.
---

# Presets Skill

The preset system saves a (subset of) `Adjustments` JSON as a reusable bundle, imports Lightroom presets, and renders on-the-fly thumbnails. It spans the Rust backend (`src-tauri/src/file_management.rs`, `preset_converter.rs`, `lib.rs`) and the React frontend (`src/hooks/usePresets.ts`, `src/components/panel/right/PresetsPanel.tsx`, `src/components/modals/ConfigurePresetModal.tsx`, `src/components/panel/CommunityPage.tsx`).

## Key files
| path | responsibility |
|---|---|
| `src-tauri/src/file_management.rs` | `Preset`/`PresetFolder`/`PresetItem`/`PresetFile` types; `load_presets`/`save_presets` (presets.json), `handle_import_presets_from_file`, `handle_import_legacy_presets_from_file`, `handle_export_presets_to_file`, `save_community_preset`; `get_presets_path` |
| `src-tauri/src/preset_converter.rs` | `convert_xmp_to_preset` — regex-parses `crs:*` XMP attrs, maps Lightroom keys to RapidRAW keys, tone curves, HSL, color grading, MIRED temperature |
| `src-tauri/src/lib.rs` | `generate_preset_preview` (400px JPEG via GPU), `fetch_community_presets` (GitHub manifest), `CommunityPreset` struct, invoke_handler registration |
| `src/hooks/usePresets.ts` | frontend preset state hook: load/add/delete/rename/duplicate/move/reorder/configure/overwrite/import/export, debounced save (500ms), style/tool conversion |
| `src/components/panel/right/PresetsPanel.tsx` | main UI: drag-drop tree (@dnd-kit), preview queue, apply-on-click, context menu, import/export dialogs |
| `src/components/modals/ConfigurePresetModal.tsx` | create/configure modal: name, `includeMasks`, `includeCropTransform`, `presetType` style↔tool switch |
| `src/components/panel/CommunityPage.tsx` | browse/install community presets from the GitHub repo |
| `src/utils/adjustments.ts` | `ADJUSTMENT_GROUPS`, `COPYABLE_ADJUSTMENT_KEYS`, `INITIAL_ADJUSTMENTS` — the filter/merge contract |
| `src/components/ui/AppProperties.tsx` | `Invokes` enum + `Preset`/`Folder` TS interfaces |

## How it works
- **Persistence**: presets live in `<app_data_dir>/presets/presets.json` as a `Vec<PresetItem>` (each item is `Preset` or `Folder`). `usePresets` holds them in React state, mutates locally, then calls a 500ms-debounced `savePresetsToBackend` → `invoke(SavePresets, { presets })` → `save_presets` writes pretty JSON. `load_presets` returns `[]` if the file is missing.
- **Creating a preset**: `addPreset`/`configurePreset` build `adjustments` by iterating `COPYABLE_ADJUSTMENT_KEYS`, skipping mask keys unless `includeMasks` and geometry keys unless `includeCropTransform`. `style` stores a full snapshot; `tool` stores only keys whose value differs from `INITIAL_ADJUSTMENTS`.
- **Applying**: `handleApplyPreset` does `setAdjustments(prev => ({ ...prev, ...preset.adjustments }))` — a shallow merge (see `editor-canvas`/`state-stores`).
- **Previews**: `PresetsPanel` queues uncached presets (on panel show / folder expand / image load), sends `{ ...INITIAL_ADJUSTMENTS, ...preset.adjustments }` to `invoke(GeneratePresetPreview, { jsAdjustments })`; backend renders 400px JPEG quality 80 through the GPU pipeline (`image-pipeline`, `gpu-shaders`, `masking`) and returns bytes wrapped in a blob URL.
- **Lightroom import**: `.xmp`/`.lrtemplate` → `handle_import_legacy_presets_from_file` (extracts the embedded XMP from `.lrtemplate` Lua via regex) → `preset_converter::convert_xmp_to_preset`. `.rrpreset` → `handle_import_presets_from_file` (re-UUIDs + dedupes names).

## Key types & symbols
| symbol | kind | what |
|---|---|---|
| `Preset` | Rust struct (file_management.rs) | `{ id, name, adjustments: serde_json::Value, includeMasks?, includeCropTransform?, presetType? }`; serde-renamed camelCase, `skip_serializing_if=Option::is_none` |
| `PresetFolder` | Rust struct | `{ id, name, children: Vec<Preset> }` — one level of nesting only |
| `PresetItem` | Rust enum | `Preset(Preset)` \| `Folder(PresetFolder)`, `#[serde(rename_all="camelCase")]` |
| `PresetFile` | Rust struct | import wire format: `{ presets: Vec<PresetItem> }` (NO creator field) |
| `ExportPresetFile` | Rust struct | export wire format: `{ creator: &str, presets }` — `creator` hardcoded `"Anonymous"` |
| `convert_xmp_to_preset` | Rust fn | XMP → `Preset` (style, includeMasks=false, includeCropTransform=false) |
| `load_presets` / `save_presets` | tauri cmd | `Invokes.LoadPresets` / `SavePresets` |
| `handle_import_presets_from_file` / `_legacy_` | tauri cmd | `Invokes.HandleImportPresetsFromFile` / `HandleImportLegacyPresetsFromFile`, arg `filePath`, return full `Vec<PresetItem>` |
| `handle_export_presets_to_file` | tauri cmd | `Invokes.HandleExportPresetsToFile`, args `presetsToExport`, `filePath` |
| `save_community_preset` / `fetch_community_presets` | tauri cmd | `Invokes.SaveCommunityPreset` / `FetchCommunityPresets` |
| `generate_preset_preview` | tauri cmd | `Invokes.GeneratePresetPreview`, arg `jsAdjustments`, returns JPEG `Uint8Array` |
| `usePresets` | hook | returns presets + all mutation fns; merges `INITIAL_ADJUSTMENTS` for style |
| `COPYABLE_ADJUSTMENT_KEYS` / `ADJUSTMENT_GROUPS` | TS const | flatten of all `ADJUSTMENT_GROUPS[*][].keys`; groups are `basic/color/details/effects/geometry/masks` |

## Conventions (follow these when coding here)
- JSON keys are camelCase and are the frontend↔backend contract. Rust uses `#[serde(rename = "...")]` per field (the `Preset` struct is NOT blanket `rename_all`); match the exact TS key.
- IDs: backend generates `Uuid::new_v4().to_string()`; frontend uses `crypto.randomUUID()`. Imports always re-generate IDs.
- Names must be unique at their level; imports dedupe by appending ` (N)`.
- A preset's `adjustments` is `Partial<Adjustments>` — always merge over `INITIAL_ADJUSTMENTS` (preview) or `prev` (apply); never treat it as complete.
- Preset-able keys come only from `ADJUSTMENT_GROUPS`. Add a key there and it is auto-included in `COPYABLE_ADJUSTMENT_KEYS` and the include/exclude logic — no other wiring needed for filtering.
- Folders nest exactly one level (folders hold presets; presets hold no folders).

## Gotchas
- `PresetFile` (import) has only `presets`; only `ExportPresetFile` (export) has `creator`, hardcoded `"Anonymous"`. Don't conflate them.
- `Folder.children` is typed `any` in `AppProperties.tsx`, not `Preset[]` — no TS safety; handle defensively.
- Style↔tool toggle in `configurePreset` (usePresets ~lines 205-227) rebuilds `adjustments`: tool strips keys equal to defaults; style fills missing keys from `INITIAL_ADJUSTMENTS` (still honoring include flags). Use `JSON.stringify` deep-equality there, not `===`.
- Old presets may lack `includeMasks`/`includeCropTransform`; `ConfigurePresetModal` falls back to `?? hasMasks/hasGeometry` derived from `adjustments`.
- Preview queue aborts when `currentImagePathRef.current` changes mid-flight; stale blob URLs are revoked in effects, not atomically — don't rely on `previews` being empty right after an image switch.
- `convert_xmp_to_preset` mapping is lossy and uses heuristics: `Shadows2012 * 1.5` (cap 100), `Temperature` via MIRED delta vs `AsShotTemperature` (default 5500K), `Tint`/`Sharpness` scaled /150, HSL hue ×0.75, and a tone-curve shadow-dampening factor (`SHADOW_DAMPEN_START = 0.8`) in `extract_tone_curve_points`. Tiny float differences change the preview cache hash (`calculate_full_job_hash`).
- `save_presets` is a direct overwrite with no locking/rollback; the debounce means the last in-flight save wins and unsaved edits can be lost on a fast close.
- `save_community_preset` auto-creates a `"Community"` folder at index 0 if absent and dedupes within it by name; renaming that folder spawns a fresh one next call.
- Adding an adjustment that the GPU pipeline doesn't read yet will persist in the preset but won't affect the preview — wire the shader too (`gpu-shaders`, `image-pipeline`).

## How to add a new preset-able adjustment / import format

**New preset-able adjustment** (most common):
1. Add the field to `interface Adjustments` and a default in `INITIAL_ADJUSTMENTS` (`src/utils/adjustments.ts`) — see `adjustments-ui`/`image-pipeline`.
2. Add its key to the right group in `ADJUSTMENT_GROUPS` (`basic/color/details/effects/geometry/masks`). It now flows automatically into `COPYABLE_ADJUSTMENT_KEYS` and the include/exclude filters — no `usePresets`/modal changes needed.
3. Make sure the GPU pipeline reads it (Rust `GlobalAdjustments`/`MaskAdjustments` + WGSL) so previews and apply reflect it (`gpu-shaders`, `image-pipeline`).
4. (Optional) For Lightroom import, add a `(xmpKey, rrKey)` pair to the `mappings` vec in `preset_converter.rs::convert_xmp_to_preset`, or a custom-scaled block after the loop.
5. Test: create a style + tool preset, export `.rrpreset`, re-import, confirm the key round-trips and the include-mask/geometry toggles behave.

**New import format** (e.g. Capture One / Darktable):
1. Add `convert_<fmt>_to_preset(content: &str) -> Result<Preset, String>` in `preset_converter.rs` (parse → map keys → return `Preset` with new UUID, `presetType: Some("style")`).
2. Add `#[tauri::command] pub fn handle_import_<fmt>_presets_from_file(file_path, app_handle) -> Result<Vec<PresetItem>, String>` in `file_management.rs` (read file, convert, dedupe name, push, `save_presets`, return list) — mirror `handle_import_legacy_presets_from_file`.
3. Register it in the `invoke_handler!` list in `src-tauri/src/lib.rs` (`tauri-bridge`).
4. Add the enum entry in `Invokes` (`src/components/ui/AppProperties.tsx`) and a call in `usePresets.importLegacyPresetsFromFile`-style wrapper.
5. Add the extension to the `openDialog` filters in `PresetsPanel.tsx` and route to the new invoke by extension in `handleImportPresets`.

## Related skills
`image-pipeline`, `gpu-shaders`, `masking`, `file-management`, `adjustments-ui`, `state-stores`, `tauri-bridge`, `modals`, `editor-canvas`, `export`

## After changes
- TS: `npm run typecheck` and `npm run lint`. New UI strings must use `t()` and be registered via `npm run i18n:extract` (then `npm run i18n:check`).
- Rust: `cargo fmt` and `cargo clippy` inside `src-tauri/`. Any new command must be in the `invoke_handler!` list.
- Record user-facing changes per the `changelog` skill.
