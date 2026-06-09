---
name: editor-canvas
description: Use this skill before modifying the editing canvas in src/components/panel/Editor.tsx and src/components/panel/editor/ (ImageCanvas pan/zoom, Konva mask & crop overlays, brush drawing, white-balance picker, EditorToolbar, Waveform/histogram, CompositionOverlays). Covers how the processed preview reaches the canvas, the WGPU transform sync loop, live mask-overlay generation, and feeding interactions back to the editor store. Trigger whenever the user asks to add/change a canvas tool, mask/crop overlay, composition guide, waveform/histogram mode, the WB picker, pan/zoom/straighten behavior, or how the preview is displayed.
---

# Editor Canvas Skill

The interactive editing surface: it displays the backend-processed preview, handles pan/zoom, and renders Konva overlays for masks, crop, brush, and the WB picker. Lives in `src/components/panel/Editor.tsx` (container) and `src/components/panel/editor/`.

## Key files
| path | responsibility |
| --- | --- |
| `src/components/panel/Editor.tsx` | Container: pan/zoom physics + bounds, WGPU transform sync loop, live mask-overlay queue, history wiring, passes everything to `ImageCanvas`. |
| `src/components/panel/editor/ImageCanvas.tsx` | Konva `Stage` wrapper: `MaskOverlay` shapes, brush drawing, crop UI (`react-image-crop`), straighten tool, WB picker, pointer handling. |
| `src/components/panel/editor/EditorToolbar.tsx` | Top toolbar: undo/redo, show-original toggle, fullscreen, filename/resolution, EXIF readout, history dropdown. |
| `src/components/panel/editor/Waveform.tsx` | Waveform/histogram display; modes from `DisplayMode` (Luma/Rgb/Parade/Vectorscope/Histogram). |
| `src/components/panel/editor/overlays/CompositionOverlays.tsx` | SVG crop guides: `thirds`, `diagonal`, `phiGrid`, `goldenTriangle`, `goldenSpiral`, `armature`. |
| `src/hooks/useImageRenderSize.ts` | `useImageRenderSize` + `RenderSize` — fits image to container, returns `{width,height,scale,offsetX,offsetY}` via a `ResizeObserver`. |
| `src/store/useEditorStore.ts` | Source of `finalPreviewUrl`, `uncroppedAdjustedPreviewUrl`, `transformedOriginalUrl`, `waveform`, `histogram`, `brushSettings`, `zoom`, `showOriginal`, `hasRenderedFirstFrame`. |

## How it works
- **Preview in:** the backend emits Tauri events handled in `src/hooks/useTauriListeners.ts` — `preview-update-uncropped` -> `uncroppedAdjustedPreviewUrl`, `waveform-update` -> `waveform`, `histogram-update` -> `histogram`, `wgpu-frame-ready` -> `hasRenderedFirstFrame`. `finalPreviewUrl` lives in `useEditorStore` and is set by the preview-generation flow. `Editor` reads these with selectors and passes `finalPreviewUrl`/`transformedOriginalUrl`/`uncroppedAdjustedPreviewUrl` into `ImageCanvas`.
- **Two render paths:** when `isWgpuActive` (`appSettings.useWgpuRenderer !== false && selectedImage.isReady && hasRenderedFirstFrame`), the native wgpu renderer paints the image *behind* the webview and `ImageCanvas` skips its SVG `<image>` (guarded by `!isWgpuActive`). `Editor`'s `syncWgpu` RAF loop calls `invoke('update_wgpu_transform', { payload })` every frame, deduplicating via `lastWgpuTransformRef` so the native surface tracks pan/zoom/clip. Otherwise the SVG image element is shown.
- **Interactions out:** pointer events on the Konva stage update `subMask.parameters` (image-space coords) via `onUpdate`/`updateSubMask`, set crop, or sample the WB picker, which call `setAdjustments`. Adjustment edits route through the store's history (see `state-stores`). Mask edits also fire `onLiveMaskPreview` -> `requestMaskOverlay`, which queues `invoke(Invokes.GenerateMaskOverlay, ...)` and shows the returned base64 PNG as an overlay.
- Connects to `masking` (mask types/params), `image-pipeline` (preview/waveform generation), `gpu-shaders`/`backend` (the wgpu display path + `update_wgpu_transform` command), `state-stores` (editor store + history).

## Key types & symbols
- `Editor` — component (`Editor.tsx`) — container; owns `transformState`/`transformStateRef`, the physics loop, and `syncWgpu`.
- `ImageCanvas` — memoized component — the Konva stage; exposes `handleStart`/`handleMove`/`handleUp` pointer flow.
- `MaskOverlay` — memoized component (in `ImageCanvas.tsx`) — renders one sub-mask's Konva shape + handles; requires the `stageScale` prop.
- `getCanvasPointer` / `getPointer` — helpers — convert stage pixel coords to image space (`pos.x / scale - groupOffset`).
- `maxSafeScale` — `Math.max(1, Math.min(settledScale, 4092 / maxDimension))` — clamps Konva texture size.
- `Invokes.GenerateMaskOverlay` (`generate_mask_overlay`) — Tauri command — live mask overlay PNG.
- `update_wgpu_transform` — Tauri command (called as a string literal, not via the `Invokes` enum) — syncs the native surface.
- `Mask` / `SubMask` / `SubMaskMode` / `ToolType` — enums/interface in `src/components/panel/right/Masks.tsx`.
- `DisplayMode`, `Adjustments`, `MaskContainer` — in `src/utils/adjustments.ts`. `TransformState`, `BrushSettings`, `WaveformData`, `Invokes` — in `src/components/ui/AppProperties.tsx`.

## Conventions (follow these when coding here)
- Konva overlays are wrapped in `memo` (`MaskOverlay`, `OptimizedBrushLine`); keep their props minimal and stable to avoid re-renders.
- All brush/mask geometry is in **image space**; rendering applies `scale` + crop offset (`cropX`/`cropY`). Convert pointer coords with `getCanvasPointer`/`getPointer` — never use raw stage coords.
- In RAF loops (physics, `syncWgpu`) read from refs (`transformStateRef`, `imageRenderSizeRef`, `maxScaleRef`), never from React state — closures go stale.
- Handle sizes in Konva are divided by `stageScale`/`maxSafeScale` (e.g. `radius={8 / stageScale}`) so they stay constant on screen.
- Alt toggles Brush<->Eraser in place; the current state is stashed on `(window as any).altKeyDown` for access inside non-React move handlers.
- Adjustment writes go through `setAdjustments`; debounced history (500ms) is handled upstream in the store actions — do not add your own history pushes here.

## Gotchas
- `!isWgpuActive` gates SVG image rendering. If WGPU is on, the canvas shows no `<image>` — debug via `hasRenderedFirstFrame` / `wgpu-frame-ready`, not the SVG tree.
- `syncWgpu` dedupes by serializing the transform to a string in `lastWgpuTransformRef`; if you add a field to the `update_wgpu_transform` payload, also add it to that string or updates won't fire.
- During crop view (`isCropping && uncroppedAdjustedPreviewUrl`) the WGPU surface is pushed off-screen (`x/y = -999999`); the crop preview is a separate SVG/Konva path.
- Crop coords: when `crop.unit === '%'` values are 0-100; pixel coords are `(crop.x/100) * imageWidth`. Easy to forget.
- `maxSafeScale` caps at `4092 / maxDimension` (WebGL texture limit) — deep zoom makes brush previews pixelated; this is expected.
- The mask-overlay queue (`requestMaskOverlay` -> `processOverlayQueue`) serializes one request at a time via `isGeneratingOverlayRef` + `pendingOverlayRequestRef`; firing many during a drag coalesces, not parallelizes.
- `isInitialDraw` lives in `subMask.parameters` only during creation and is `delete`d on release — don't persist it.
- Composition overlays react to `liveRotation` (temporary, from straighten) when present, else `adjustments.rotation`.
- `Waveform` receives `waveform`/`histogram` as props from the store; it does not invoke the backend itself.

## How to add a canvas tool / overlay
1. Add the type to the `Mask` enum in `src/components/panel/right/Masks.tsx` and extend `SubMask.parameters` shape (and `createSubMask` defaults in `src/utils/maskUtils.ts` — see `masking`).
2. In `MaskOverlay` (`ImageCanvas.tsx`) add an `if (subMask.type === Mask.MyTool)` branch returning a Konva `Group`/`Shape`; scale handle sizes by `stageScale`, position with `cropX`/`cropY` + `scale`, and convert drag positions with `getPointer`.
3. Wire drag/transform callbacks to `onUpdate(subMask.id, { parameters })`; emit `onPreviewUpdate`/`onLiveMaskPreview` during drag for the live overlay.
4. In `ImageCanvas` `handleStart`, detect your tool active state and set `isDrawing.current` + `dragStartPointer.current` (via `getCanvasPointer`); in `handleMove` update the in-progress geometry; in `handleUp` finalize with `updateSubMask`.
5. Ensure pan/zoom still works: include your tool in the panning-disabled / `isToolActive` logic so the stage doesn't pan while drawing.
6. Backend rasterization for the new mask type lives in Rust — coordinate with `masking` so `generate_mask_overlay` and `mask_generation.rs` understand the new params.
7. Add any new UI strings via `t()` and run `npm run i18n:extract`.

## Related skills
`masking`, `image-pipeline`, `gpu-shaders`, `state-stores`, `hooks`, `adjustments-ui`, `tauri-bridge`, `backend`

## After changes
- `npm run typecheck` and `npm run lint` (this is TS/TSX). `npm run format` for prettier (120 cols, single quotes).
- If you touched the `update_wgpu_transform` payload or `generate_mask_overlay`, also update the Rust side and run `cargo fmt` + `cargo clippy` inside `src-tauri/`.
- New user-facing strings: `t()` + `npm run i18n:extract` (then `npm run i18n:check`).
- Record user-visible changes per the `changelog` skill.
