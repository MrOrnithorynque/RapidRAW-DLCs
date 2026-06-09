---
name: adjustments-ui
description: Use this skill before modifying the right-hand adjustment controls in src/components/panel/right/ (ControlsPanel, RightPanelSwitcher, MasksPanel, AIPanel, PresetsPanel, ExportPanel, MetadataPanel, CropPanel) and src/components/adjustments/ (Basic/Curves/Color/Details/Effects), plus the Adjustments contract in src/utils/adjustments.ts and the setAdjustments flow in src/hooks/useEditorActions.ts. Covers ADJUSTMENT_SECTIONS, sectionVisibility, isForMask, the Slider/ColorWheel/CollapsibleSection primitives, copy/paste/reset by section, and wiring a new slider to a backend uniform. Trigger whenever the user asks to add/change/debug an adjustment slider, curve, color wheel, the panel tab switcher, a per-mask or per-AI-patch adjustment section, section visibility, or copy/paste/reset of adjustments.
---

# Adjustments UI Skill

The right-side panel that lets a user configure non-destructive edits: tab switcher, the five adjustment sections (Basic/Curves/Color/Details/Effects), plus the Masks/AI/Presets/Export/Metadata/Crop tabs. Lives in `src/components/panel/right/` and `src/components/adjustments/`; the data contract is `src/utils/adjustments.ts`. This layer only handles user input + state; GPU rendering and persistence live in other modules.

## Key files
| path | responsibility |
| --- | --- |
| `src/utils/adjustments.ts` | `Adjustments` interface, `INITIAL_ADJUSTMENTS`, `INITIAL_MASK_ADJUSTMENTS`, enums, `ADJUSTMENT_SECTIONS`, `ADJUSTMENT_GROUPS`, `COPYABLE_ADJUSTMENT_KEYS`, `normalizeLoadedAdjustments` |
| `src/hooks/useEditorActions.ts` | `setAdjustments`, `debouncedSetHistory(500ms)`, `debouncedSave(300ms)`, `handleLutSelect`, `handleAutoAdjustments`, reset/copy/paste handlers |
| `src/components/panel/right/ControlsPanel.tsx` | Adjustments tab: renders `ADJUSTMENT_SECTIONS` into `CollapsibleSection`s, waveform, section copy/paste/reset context menu |
| `src/components/panel/right/RightPanelSwitcher.tsx` | Icon tab switcher driven by the `Panel` enum (`AppProperties.tsx`) |
| `src/components/adjustments/Basic.tsx` | Tone-mapper switch + EV shift, Exposure/Contrast/Highlights/Shadows/Whites/Blacks sliders |
| `src/components/adjustments/Curves.tsx` | `CurveGraph` point + parametric curve editor (luma/red/green/blue) |
| `src/components/adjustments/Color.tsx` | Temp/Tint, Sat/Vibrance, color grading wheels, HSL mixer, color calibration, WB picker toggle |
| `src/components/adjustments/Details.tsx` | Sharpening, presence (Clarity/Dehaze/Structure/Centré), noise reduction, chromatic aberration |
| `src/components/adjustments/Effects.tsx` | Glow/Halation/Flare, Grain, Vignette, LUT select/intensity |
| `src/components/panel/right/MasksPanel.tsx` | Mask containers + sub-masks; per-mask adjustment sections reuse Basic/Curves/Color/Details/Effects with `isForMask` |
| `src/components/ui/Slider.tsx` | Base slider: `{ target: { value } }` onChange, double-click reset, fine drag, `onDragStateChange` |
| `src/components/ui/AppProperties.tsx` | `Invokes` enum (Tauri command names), `Panel` enum |

## How it works
- Every control reads `adjustments` (prop) and writes via `setAdjustments(Partial<Adjustments> | (prev) => Adjustments)` from `useEditorActions`. `setAdjustments` merges into `useEditorStore.adjustments` via `setEditor` and fires `debouncedSetHistory` (pushes to the 50-entry undo/redo history). It does **not** save or render directly.
- The render + persist loop lives in `hooks` (`src/hooks/useImageProcessing.ts`): an effect watching `adjustments` calls `applyAdjustments(...)` (GPU preview via `image-pipeline`/`gpu-shaders`) and, once the user stops dragging, `debouncedSave(path, adjustments)` which invokes `Invokes.SaveMetadataAndUpdateThumbnail` (`save_metadata_and_update_thumbnail`) to write the `.rrdata` sidecar. `debouncedSave.flush()` is called on navigation in `useAppNavigation.ts`.
- `ControlsPanel` maps `Object.keys(ADJUSTMENT_SECTIONS)` to a fixed `{ basic, curves, color, details, effects }` component map; the same map is reused in `MasksPanel` for per-mask sections. JSON keys are camelCase and are the contract with the Rust `GlobalAdjustments`/`MaskAdjustments` structs (snake_case fields, `#[serde(rename_all = "camelCase")]`) — see `image-pipeline`/`gpu-shaders`.
- The active right panel comes from the `Panel` enum; `RightPanelSwitcher` only emits `onPanelSelect`. Store/history details live in `state-stores`; the render pipeline in `hooks`.

## Key types & symbols
- `Adjustments` (type) — full per-image edit state; has `[index: string]: any` so missing fields don't error.
- `INITIAL_ADJUSTMENTS` / `INITIAL_MASK_ADJUSTMENTS` (const) — defaults; note non-zero defaults (`grainSize:25`, `grainRoughness:50`, `lutIntensity:100`, `sharpnessThreshold:15`, `vignetteFeather:50`, `vignetteMidpoint:50`, `transformScale:100`, `toneMapper:'basic'`, `lensCorrectionMode:'manual'`).
- `ADJUSTMENT_SECTIONS` (const) — `{ basic, curves, color, details, effects }` -> key lists; drives section rendering + per-section copy/paste/reset.
- `ADJUSTMENT_GROUPS` / `COPYABLE_ADJUSTMENT_KEYS` (const) — used by the copy/paste modal and `handleCopy/PasteAdjustments` (geometry/lens/masks groups included).
- `setAdjustments` (fn) — the only correct write path for adjustments.
- `BasicAdjustment` / `ColorAdjustment` / `DetailsAdjustment` / `Effect` / `CreativeAdjustment` (enums) — string-valued, equal the camelCase `Adjustments` field names.
- `Invokes` (enum, `AppProperties.tsx`) — Tauri command names; e.g. `SaveMetadataAndUpdateThumbnail`, `CalculateAutoAdjustments`, `ApplyAdjustmentsToPaths`, `ResetAdjustmentsForPaths`. (`handleLutSelect` uses the raw string `'load_and_parse_lut'`.)
- `Slider` / `ColorWheel` / `CollapsibleSection` (components, `src/components/ui/`).

## Conventions (follow these when coding here)
- Read from the `adjustments` prop; write only through `setAdjustments`. Prefer the updater form `setAdjustments((prev) => ({ ...prev, [key]: value }))`.
- Slider `onChange` gives `{ target: { value: string } }` — coerce with `parseFloat`/`parseInt` in the component's handler (e.g. `handleAdjustmentChange`); don't assume a number arrives.
- Pass `onDragStateChange={onDragStateChange}` to every slider so `isSliderDragging` toggles live preview vs. full render; omitting it breaks drag responsiveness.
- New field requires three edits in `adjustments.ts`: add to `Adjustments`, `INITIAL_ADJUSTMENTS`, the matching `ADJUSTMENT_SECTIONS` list (and `INITIAL_MASK_ADJUSTMENTS` + the enum if mask-applicable). Copy/paste then works automatically only if the key is also in an `ADJUSTMENT_GROUPS` entry.
- Section components must accept and honor `isForMask` (hide tone-mapper, Flare, Centré, etc.) — masks use the same components.
- All user-facing strings go through `t(...)` (react-i18next); never hardcode JSX text (eslint-plugin-i18next warns).
- Use the `Invokes` enum for Tauri calls rather than raw strings where one exists.

## Gotchas
- `setAdjustments` does NOT call `debouncedSave` — the save + GPU render are triggered separately by the effect in `src/hooks/useImageProcessing.ts`. Wiring a control purely through `setAdjustments` is sufficient; don't add a manual save.
- In `Basic.tsx` the on-screen "Exposure" slider writes `BasicAdjustment.Brightness`, while the tone-mapper / EV-shift slider writes `BasicAdjustment.Exposure`. The label and the field name are intentionally different.
- The tone-mapper switch is hidden when `isForMask || appSettings?.tonemapperOverrideEnabled`; in that case a plain EV-shift (exposure) slider is shown instead.
- Per-mask sections do NOT call the global `setAdjustments`. `MasksPanel` passes a local `setMaskContainerAdjustments` wrapper that routes through `updateContainer(id, { adjustments })` so writes land in `adjustments.masks[i].adjustments`. AI patches behave similarly via `adjustments.aiPatches[i]`.
- `MaskAdjustments` is a strict subset of `Adjustments` (no crop/rotation/lens/transform/grain/vignette/LUT geometry fields). Setting an excluded key on a mask is silently dropped.
- `normalizeLoadedAdjustments` deep-clones curves/parametric curves and merges defaults; never mutate `INITIAL_ADJUSTMENTS`/`INITIAL_MASK_ADJUSTMENTS` in place (shared object refs).
- `curves`/`pointCurves` and `parametricCurve` can both be stored; `curveMode` ('point'|'parametric') selects which the backend uses.
- `sectionVisibility` (eye icon) is per-image state inside `Adjustments`; toggling it never resets slider values, and section reset re-opens the section.
- Per-section copy/paste (`ControlsPanel`) only moves keys in `ADJUSTMENT_SECTIONS[section]`, stored in `copiedSectionAdjustments`; paste is gated to the same section name.

## How to add a new adjustment slider wired to the backend
Example: a "Bloom" slider in the Effects section (mask-applicable).
1. `src/utils/adjustments.ts`: add `bloom: number;` to `Adjustments` (and `MaskAdjustments`); add `bloom: 0,` to `INITIAL_ADJUSTMENTS` (and `INITIAL_MASK_ADJUSTMENTS`); add `Bloom = 'bloom'` to the relevant enum (`Effect`/`CreativeAdjustment`); push `Effect.Bloom` into `ADJUSTMENT_SECTIONS.effects`; add to an `ADJUSTMENT_GROUPS.effects` group so copy/paste includes it.
2. `src/components/adjustments/Effects.tsx`: add a `<Slider label={t('adjustments.effects.bloom')} min={0} max={100} step={1} value={adjustments.bloom} onChange={(e: any) => handleAdjustmentChange('bloom', e.target.value)} onDragStateChange={onDragStateChange} />`, honoring `isForMask` if it should be hidden on masks.
3. Backend (see `gpu-shaders` + `image-pipeline`): add `pub bloom: f32` to `GlobalAdjustments` (and `MaskAdjustments`) in `src-tauri/src/image_processing.rs`, keeping the `repr(C)`/bytemuck padding alignment intact; default it; add a SCALE/normalization if used; consume it in `src-tauri/src/shaders/shader.wgsl`. Verify the camelCase JSON key matches via `#[serde(rename_all = "camelCase")]`.
4. i18n: add `adjustments.effects.bloom` to `src/i18n/locales/en/*` then run `npm run i18n:extract`.
5. Verify the slider updates the GPU preview (drag) and persists to `.rrdata` (save fires after drag ends, via `useImageProcessing.ts`).

## Related skills
`state-stores`, `hooks`, `image-pipeline`, `gpu-shaders`, `masking`, `presets`, `export`, `metadata-exif`, `corrections`, `editor-canvas`, `frontend`, `i18n`, `changelog`

## After changes
- TS: `npm run typecheck` and `npm run lint`.
- Rust (in `src-tauri/`): `cargo fmt` and `cargo clippy`.
- New UI strings: add keys then `npm run i18n:extract` (check with `npm run i18n:check`).
- Record user-facing changes per the `changelog` skill (AppStream `<release>` in `data/io.github.CyberTimon.RapidRAW.metainfo.xml`).
