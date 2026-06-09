---
name: masking
description: Use this skill before modifying local adjustment masks in RapidRAW — mask rasterization in src-tauri/src/mask_generation.rs, the GPU mask texture array in src-tauri/src/gpu_processing.rs + get_mask_influence in shader.wgsl, frontend Mask/SubMask types in src/components/panel/right/Masks.tsx, and createSubMask defaults in src/utils/maskUtils.ts. Covers mask types (radial, linear, brush, flow, color, luminance, ai-subject/foreground/sky/depth, quick-eraser, all), SubMaskMode (Additive/Subtractive/Intersect), grow/feather, caching, and per-pixel mask influence. Trigger whenever the user asks to add, edit, debug, or refactor masks, sub-masks, mask blending, mask feathering/grow, or a new mask type.
---

# Masking Skill

Local (per-region) non-destructive adjustments. Each mask rasterizes to an 8-bit `GrayImage` on the CPU, then becomes one layer of a GPU texture array; the shader multiplies that per-pixel influence into the mask's adjustment values. Core logic lives in `src-tauri/src/mask_generation.rs`.

## Key files

| path | responsibility |
| --- | --- |
| `src-tauri/src/mask_generation.rs` | All mask types, `SubMask`/`MaskDefinition`, rasterizers, sub-mask combination, invert/opacity, grow/feather, caching, `generate_mask_overlay` command |
| `src-tauri/src/image_processing.rs` | `MaskAdjustments` struct, `MAX_MASKS = 32`, `AllAdjustments`, `get_all_adjustments_from_json` (packs per-mask adjustments) |
| `src-tauri/src/gpu_processing.rs` | `RenderRequest.mask_bitmaps`, builds R8Unorm `D2Array` mask texture (binding 3) |
| `src-tauri/src/shaders/shader.wgsl` | `get_mask_influence()` (binding 3 `mask_textures`), loops `0..mask_count` blending `mask_adjustments[i]` |
| `src-tauri/src/ai_processing.rs` | `AiSubjectMaskParameters`, `AiSkyMaskParameters`, `AiForegroundMaskParameters`, `AiDepthMaskParameters` (each carries `mask_data_base64`) |
| `src-tauri/src/adjustment_utils.rs` | `hydrate_sub_masks` / `hydrate_adjustments` — restore cached AI base64 into params |
| `src/components/panel/right/Masks.tsx` | `Mask` enum, `SubMaskMode` enum, `SubMask` interface, `MASK_ICON_MAP`, creation-type lists |
| `src/utils/maskUtils.ts` | `createSubMask(type, dims, mode)` — default parameters per mask type |

## How it works

- Frontend stores masks in `adjustments.masks` (array of mask definitions, camelCase JSON) in `useEditorStore`. `createSubMask` seeds default `parameters` per type.
- On render the backend calls `get_all_adjustments_from_json` (image-pipeline), which reads `masks`, packs each visible mask's `adjustments` into `mask_adjustments[i]` and sets `mask_count` (capped at `MAX_MASKS`).
- Bitmaps are produced by `get_cached_or_generate_mask` (50-entry hash cache in `AppState.mask_cache`) -> `generate_mask_bitmap` -> per-type `generate_*_bitmap`. Combination, invert, and opacity happen in `generate_mask_bitmap`.
- `color`/`luminance` masks need the post-geometry warped image; `resolve_warped_image_for_masks` fetches it only when `MaskDefinition::requires_warped_image()` is true.
- AI masks (`ai-*`, `quick-eraser`) carry a base64 image (`mask_data_base64`) produced by `ai-features` ONNX inference; rasterizers decode + transform it via `TransformParams`.
- `RenderRequest.mask_bitmaps` is uploaded as an R8Unorm `texture_2d_array` (binding 3). `shader.wgsl` calls `get_mask_influence(i, coords) = textureLoad(mask_textures, coords, i).r` and blends per pixel (see `gpu-shaders`).
- `generate_mask_overlay` (Tauri command, frontend `Invokes.GenerateMaskOverlay = 'generate_mask_overlay'`) returns a red semi-transparent PNG data URL for the editor overlay.

## Key types & symbols

| symbol | kind | what |
| --- | --- | --- |
| `MaskDefinition` | struct (Rust) | `id,name,visible,invert,opacity,adjustments,sub_masks`; `requires_warped_image()` |
| `SubMask` | struct (Rust) | `id, type (string), visible, invert, opacity, mode, parameters: Value` |
| `SubMaskMode` | enum (Rust+TS) | `Additive` (max), `Subtractive` (saturating_sub), `Intersect` (min) |
| `Mask` | enum (TS) | string values: `radial,linear,brush,flow,color,luminance,ai-subject,ai-foreground,ai-sky,ai-depth,quick-eraser,all` |
| `generate_mask_bitmap` | fn | combines sub-masks -> final `GrayImage` |
| `generate_sub_mask_bitmap` | fn | the `match sub_mask.mask_type.as_str()` dispatch — add new arms here |
| `apply_grow_and_feather` | fn | dilate/erode + gaussian blur; used by color/luminance/ai masks |
| `render_stroke_layer_parallel` | fn | rayon brush/flow stroke rasterizer (per bounding box) |
| `MaskAdjustments` | struct | per-mask params (exposure…hsl[8], curves); array of `MAX_MASKS` |
| `get_mask_influence` | wgsl fn | `textureLoad(mask_textures, coords, mask_index).r` |
| `MASK_ICON_MAP`, `MASK_PANEL_CREATION_TYPES`, `AI_PANEL_CREATION_TYPES`, `OTHERS_MASK_TYPES` | TS consts | which types appear in which picker |

## Conventions (follow these when coding here)

- Mask `type` is a lowercase string; the TS `Mask` enum value and the Rust `match` arm string MUST be identical.
- Parameter structs deserialize with `serde(rename_all = "camelCase")` and `unwrap_or_default()` — JSON keys are camelCase; missing fields silently default, never error.
- Brush/flow/radial/linear `feather` is normalized `0.0..1.0`; grow/feather on grow-feather params is a percentage (see formulas below). AI `feather` may be a raw blur sigma.
- Coordinates in `parameters` are in original-image space; rasterizers apply `point * scale - crop_offset` themselves. Do not pre-scale.
- Grow pixels = `(grow/100) * min(w,h) * 0.01`; feather sigma = `(feather/100) * min(w,h) * 0.005`.
- New geometric/parametric rasterizers take `(params_value: &Value, width, height, scale, crop_offset)`; warped-image rasterizers add `warped_image: Option<&DynamicImage>`.
- Combination order per sub-mask: invert -> opacity -> `mode` blend into accumulator. Then mask-level invert -> mask-level opacity.

## Gotchas

- `color`/`luminance` return `None` (contribute nothing) if `warped_image` is `None`. If a new type needs the warped image, add its string to `requires_warped_image()`.
- Masks past index 31 are silently dropped (`.take(MAX_MASKS)` in both `get_all_adjustments_from_json` and the GPU upload). No warning is raised.
- `quick-eraser` reuses `generate_ai_subject_bitmap` (it is an AI subject mask under the hood).
- Cache key hashes the whole `MaskDefinition` with `adjustments` blanked to `Null` (adjustments don't change the bitmap) plus width/height/scale/crop. Changing only `adjustments` correctly hits cache; any other param change misses. The cache `clear()`s when it exceeds 50 entries — it is not a true LRU.
- AI `mask_data_base64` can be `null` in stored sidecars; `hydrate_sub_masks`/`hydrate_adjustments` (keyed by sub-mask `id`, checking both `mask_data_base64` and `maskDataBase64` keys) restore it from `AppState.patch_cache` before rasterization. Commands that take raw mask JSON must hydrate first.
- `Additive` = `max` (union, OR), `Subtractive` = `saturating_sub`, `Intersect` = `min` (AND). The accumulator starts at 0 (black), so the first sub-mask should normally be `Additive`.
- Brush blends per-stroke with screen/eraser math, NOT plain max; flow accumulates by `flow` percent per stroke. Both clamp to `[0,255]`.
- `mask_atlas_cols` exists in the uniform but is `1` in the main mask path — masks use a real `texture_2d_array` layer index, not an atlas.

## How to add a new mask type

Example: a new `"mytype"` mask.

1. `src/components/panel/right/Masks.tsx`: add `MyType = 'mytype'` to the `Mask` enum, an entry in `MASK_ICON_MAP`, a `formatMaskTypeName` case (with an i18n key like `masks.types.myType`), and add a `MaskType` row to the relevant picker list (`MASK_PANEL_CREATION_TYPES`, `AI_PANEL_CREATION_TYPES`, or `OTHERS_MASK_TYPES`).
2. `src/utils/maskUtils.ts`: add a `case Mask.MyType:` in `createSubMask` returning the default `parameters` (camelCase keys).
3. `src-tauri/src/mask_generation.rs`: add a `#[derive(Serialize, Deserialize, Default)] #[serde(rename_all="camelCase")] struct MyTypeMaskParameters { ... }`.
4. Implement `fn generate_mytype_bitmap(params_value: &Value, width, height, scale, crop_offset) -> Option<GrayImage>` (or return `GrayImage` if it always succeeds; add `warped_image` if it samples pixels). Call `apply_grow_and_feather` at the end if it exposes grow/feather.
5. Add the arm to `generate_sub_mask_bitmap`'s `match`: `"mytype" => Some(generate_mytype_bitmap(...))`.
6. If it samples the warped image, add `|| sm.mask_type == "mytype"` to `MaskDefinition::requires_warped_image()`.
7. No GPU/shader change is needed — the new mask flows through the existing `mask_textures`/`get_mask_influence` path automatically (it just contributes another layer).
8. Verify in the editor: create the mask, confirm the red overlay (`generate_mask_overlay`) and the live render respond to its parameters.

## Related skills

`gpu-shaders`, `ai-features`, `image-pipeline`, `adjustments-ui`, `editor-canvas`, `tauri-bridge`, `heal`

## After changes

- TS: `npm run typecheck` and `npm run lint`; if you added UI strings run `npm run i18n:extract` then `npm run i18n:check`.
- Rust: run `cargo fmt` and `cargo clippy` inside `src-tauri/`.
- Write a changelog entry per the `changelog` skill (append a `<li>` to the top `<release>` block in `data/io.github.CyberTimon.RapidRAW.metainfo.xml` — there is no `docs/changelog/`).
