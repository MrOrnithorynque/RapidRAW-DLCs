---
name: gpu-shaders
description: Use this skill before modifying the wgpu compute/render pipeline in src-tauri/src/gpu_processing.rs or any WGSL shader in src-tauri/src/shaders/ (shader.wgsl, blur.wgsl, flare.wgsl, display.wgsl). Covers bind groups, the repr(C)/bytemuck Pod uniform layout shared with WGSL, tiled compute dispatch, f16 intermediate textures, the D2Array mask texture, and the LUT 3D texture. Trigger whenever the user asks to add/change a GPU-accelerated adjustment, edit a shader, touch the AllAdjustments/GlobalAdjustments/MaskAdjustments structs, debug GPU corruption/alignment, change the blur/flare passes, or work on the display render path.
---

# GPU Shaders Skill

GPU image-processing pipeline: a wgpu device drives WGSL compute shaders that apply every photo adjustment. Lives in `src-tauri/src/gpu_processing.rs` (~2000 lines) plus four WGSL files in `src-tauri/src/shaders/`.

## Key files
| path | responsibility |
| --- | --- |
| `src-tauri/src/gpu_processing.rs` | `GpuProcessor` (pipelines, bind groups, textures), tiled dispatch, CPU readback, display render, `process_and_get_dynamic_image` entry point |
| `src-tauri/src/shaders/shader.wgsl` | Main compute shader (`@workgroup_size(8,8,1)` `main`); all adjustments + per-mask blending + LUT + tonemapper |
| `src-tauri/src/shaders/blur.wgsl` | Separable Gaussian: `horizontal_blur` (256,1,1) + `vertical_blur` (1,256,1), output Rgba16Float |
| `src-tauri/src/shaders/flare.wgsl` | Lens flare: `threshold_main` + `ghosts_main`, both `@workgroup_size(16,16,1)` |
| `src-tauri/src/shaders/display.wgsl` | On-window render: `vs_main`/`fs_main` quad with `DisplayTransform` |
| `src-tauri/src/image_processing.rs` | Defines `GlobalAdjustments`/`MaskAdjustments`/`AllAdjustments`, `MAX_MASKS=32`, `GpuContext`, and `get_global_adjustments_from_json` (JSON→struct) |
| `src-tauri/src/app_state.rs` | `AppState.gpu_context` / `gpu_image_cache` / `gpu_processor` (all `Mutex<Option<...>>`) |

## How it works
- Callers (`file_management.rs`, `export_processing.rs`, `lib.rs`) get a `GpuContext` via `get_or_init_gpu_context(&state, &app_handle)` (lazy singleton: instance/adapter/device/queue, optional display surface). JSON edits become a `GlobalAdjustments`/`AllAdjustments` via `get_global_adjustments_from_json` (see `image-processing` / `adjustments` skills).
- `process_and_get_dynamic_image(base_image, &RenderRequest)` is the public render call. `RenderRequest` = `{ adjustments: AllAdjustments, mask_bitmaps: &[ImageBuffer<Luma<u8>>], lut: Option<Arc<Lut>>, roi: Option<Roi> }`. The input `DynamicImage` is uploaded as an `Rgba16Float` (f16) texture and cached in `gpu_image_cache`.
- `GpuProcessor::run` does: optional flare preprocess (512x512 map, if `flare_amount > 0`) → tiled loop over `TILE_SIZE=2048` with `TILE_OVERLAP=128` → per tile: four blur passes at fixed radii (sharpness 1.0, tonal 3.5, clarity 8.0, structure 40.0) into f16 textures, then the main compute dispatch (`input_width.div_ceil(8)`, `input_height.div_ceil(8)`, 1) → either CPU readback to RGBA8 bytes or a `WgpuDisplay` render pass.
- Masks: all mask bitmaps are uploaded into one `R8Unorm` `D2Array` texture (one layer per mask, layer count clamped to `2..=MAX_MASKS`); the shader reads `textureLoad(mask_textures, coords, mask_index, 0).r`. LUT becomes a 3D `Rgba16Float` texture sampled tetrahedrally.

## Key types & symbols
| symbol — kind — what |
| --- |
| `GpuProcessor` — struct (gpu_processing.rs) — owns `blur_bgl`/`main_bgl`/`flare_bgl_*`, pipelines, `adjustments_buffer`, blur/flare/dummy/working/output textures |
| `GpuContext` — struct (image_processing.rs) — `Arc<Device>`, `Arc<Queue>`, `Limits`, `Arc<Mutex<Option<WgpuDisplay>>> display` |
| `AllAdjustments` — struct — `global: GlobalAdjustments`, `mask_adjustments: [MaskAdjustments; 32]`, `mask_count`, `tile_offset_x/y`, `mask_atlas_cols`. Mirrored 1:1 by the WGSL `AllAdjustments` (storage buffer `@group(0) @binding(2)`) |
| `GlobalAdjustments` / `MaskAdjustments` — struct — `#[repr(C)] Pod Zeroable`; the WGSL/Rust contract |
| `BlurParams` / `FlareParams` / `DisplayTransform` — struct — `#[repr(C)] Pod Zeroable` uniform buffers (each carries explicit `_pad` fields) |
| `process_and_get_dynamic_image` / `..._with_analytics` — fn — render entry points |
| `get_or_init_gpu_context` — fn — lazy GPU init |
| `GpuProcessor::new` / `GpuProcessor::run` — fn — pipeline build / per-image render |
| `WgpuDisplay` — struct — on-window surface, render pipeline, display bind group, transform buffer |
| `MAX_MASKS` — const = 32 (image_processing.rs) |

## Conventions (follow these when coding here)
- Every struct shipped to the GPU is `#[repr(C)]` + `derive(bytemuck::Pod, bytemuck::Zeroable)`. Field ORDER and offsets are the contract — the WGSL struct must match field-for-field. Names need not match (e.g. Rust `centré` maps to WGSL `centre`; offset is what matters).
- Main shader bindings are all `@group(0)`: `0` input `texture_2d`, `1` output `texture_storage_2d<rgba8unorm, write>`, `2` `var<storage, read> adjustments`, `3` `mask_textures` (D2Array), `4`/`5` LUT texture+sampler, `6`-`9` sharpness/tonal/clarity/structure blur textures, `10`/`11` flare texture+sampler. Layout entry order in `main_bgl` must match these numbers (note the `MAX_MASK_BINDINGS = 1` offset constant).
- Intermediate textures (blur, flare, LUT, input) are `Rgba16Float` (f16); only the final output is `Rgba8Unorm` (u8).
- Dispatch with `div_ceil` over the workgroup size; the shader must bounds-check `global_invocation_id` against texture dimensions.
- Sampled-texture `BindGroupLayoutEntry`s set `Float { filterable: ... }` matching the sampler (LUT/flare use samplers; blur textures are `textureLoad`-only, `filterable: false`).
- Unused texture/LUT bindings get bound to `dummy_blur_view` / `dummy_lut_view` — never leave a binding unbound.

## Gotchas
- Bytemuck padding is the #1 trap: `AllAdjustments` is large and must stay 16-byte aligned for `std140`-style WGSL layout. A `vec3`/`mat3`/`array` boundary that loses its `_pad` field silently mis-reads every later field on the GPU with no error. When you add/remove a field, re-check the explicit `_pad*` fields in `GlobalAdjustments`/`MaskAdjustments` AND mirror the exact change in `shader.wgsl`.
- WGSL `mat3x3`/`vec3` align to 16 bytes — Rust uses helper types (`GpuMat3`, `ColorGradeSettings`, padded arrays) to match; do not hand-pack a bare `[f32; 9]`.
- Tile overlap: `TILE_OVERLAP=128` exists so blur passes (largest radius ~40) don't halo at tile seams; if you add a wider spatial filter, the overlap may be too small.
- f16 range: blur output is clamped to F16_MAX to avoid Inf/NaN propagating into the main shader.
- Mask `D2Array` layer count is clamped to `2..=MAX_MASKS` (min 2 avoids a zero/one-layer array); empty mask sets are zero-filled.
- Display render only runs on platforms with a surface (gated by `not(target_os = "android"/"linux")`); on Android/Linux it falls back to compute + CPU readback.
- CPU readback must respect wgpu's 256-byte `bytes_per_row` alignment — rows are unpadded on the CPU side after mapping.

## How to add a new GPU-accelerated adjustment
1. **Add the field to the Rust struct** in `src-tauri/src/image_processing.rs` — `GlobalAdjustments` (and `MaskAdjustments` if it should be per-mask). Place it where alignment stays valid; if it breaks a 16-byte boundary, add/adjust a `_pad*` field. Update the `Default`/literal initializers in the same file so it still compiles.
2. **Mirror it in `src-tauri/src/shaders/shader.wgsl`** — add the field at the SAME position in the WGSL `GlobalAdjustments`/`MaskAdjustments` struct (same name or matching offset, plus matching pad).
3. **Wire JSON → struct** in `get_global_adjustments_from_json`: add `my_field: get_val("<section>", "<camelCaseKey>", SCALES.my_field, None)` (note `get_val` reads `js_adjustments[key]` and uses `section` only for `sectionVisibility`). Add a scale to `AdjustmentScales`/`SCALES` if the slider needs normalizing.
4. **Shader math**: inside `fn main`, read `adjustments.global.my_field` and apply your math at the right point in the pipeline (respect linear vs sRGB; follow the ordering of existing effects). For per-mask, blend using `get_mask_influence(i, coords)` in the mask loop.
5. **Need a blur input?** Reuse one of the four existing blur textures (bindings 6-9). Only add a new blur texture/binding if a new radius is required — that means: new `*_blur_view` field on `GpuProcessor`, allocate in `new()`, add a `did_create_*_blur` pass in `run()` via the `run_blur(radius, &view)` closure, add a `BindGroupLayoutEntry` to `main_bgl` and a matching `BindGroupEntry` in `run()`, and add the binding in `shader.wgsl`.
6. **Frontend**: add the slider/control and JSON key in the adjustments UI; the camelCase key must match step 3 (see `adjustments-ui` / `state-stores`).

## Related skills
`image-pipeline`, `masking`, `ai-features`, `file-management`, `backend`, `frontend`

## After changes
- Rust: `cargo fmt` and `cargo clippy` inside `src-tauri/`. WGSL is validated by wgpu at pipeline creation — run `npm run tauri dev` and exercise the effect; a layout/struct mismatch shows as a validation panic or visibly corrupted output.
- TS (if you touched UI): `npm run typecheck`, `npm run lint`; add i18n keys with `npm run i18n:extract` for any new user-facing strings.
- Record user-facing changes per the `changelog` skill (AppStream `<release>` entry in `data/io.github.CyberTimon.RapidRAW.metainfo.xml`, not a changelog dir).
