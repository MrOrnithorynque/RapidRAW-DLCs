---
name: modals
description: Use this skill before modifying RapidRAW's modal dialogs in src/components/modals/ — the AppModals.tsx registry, modal open/close state in src/store/useUIStore.ts, and the per-feature modals (Panorama, Hdr, Denoise, NegativeConversion, Culling, Collage, ImageTrack, Confirm, CreateFolder, RenameFolder, RenameFile, ImportSettings, CopyPasteSettings) plus the store-independent Transform/LensCorrection (mounted in CropPanel.tsx) and ConfigurePreset (mounted in PresetsPanel.tsx). Covers the gather-params -> invoke command -> progress events -> apply-result pattern, the prop-handler wiring through useProductivityActions.ts, and which modals listen to their own Tauri events. Trigger whenever the user asks to add/change/debug a modal dialog, a modal's open/close state, a feature popup (panorama/hdr/denoise/negative/culling/collage/image-track/transform/lens/import/copy-paste/preset), or to wire a new modal-driven tool end-to-end.
---

# Modals Skill

The modal-dialog layer of the RapidRAW frontend. Most modals are registered in `src/components/modals/AppModals.tsx`, driven by open/close state in `src/store/useUIStore.ts`. Three modals (Transform, LensCorrection, ConfigurePreset) are mounted by their owning panel with local React state instead.

## Key files
| path | responsibility |
| --- | --- |
| `src/components/modals/AppModals.tsx` | Registry that renders 13 modals, reads `useUIStore`/`useProcessStore`/`useEditorStore`, threads close handlers + `props.*` callbacks down |
| `src/store/useUIStore.ts` | Source of truth for modal state: `isXModalOpen` flags + complex `*ModalState` objects + the `setUI()` action |
| `src/hooks/useProductivityActions.ts` | Hosts the actual `invoke()` calls for panorama/hdr/denoise/collage (passed into `AppModals` as `handleStart*`/`handleSave*` props) |
| `src/hooks/useTauriListeners.ts` | Central listener for `panorama-*`/`hdr-*`/`denoise-*`/`culling-*` events; writes results back into `useUIStore` |
| `src/components/modals/PanoramaModal.tsx` / `HdrModal.tsx` | Result-only modals: trigger backend, show spinner, then preview + Save (mirror shapes) |
| `src/components/modals/DenoiseModal.tsx` / `NegativeConversionModal.tsx` | Preview + single/batch; each owns a `*-batch-progress` listener and a compare UI |
| `src/components/modals/CullingModal.tsx` | Multi-stage (`settings`->`progress`->`results`); invokes `Invokes.CullImages`, renders AI suggestions |
| `src/components/modals/CollageModal.tsx` | Canvas-drawn collage; loads images, exports base64 to `handleSaveCollage` |
| `src/components/modals/ImageTrackModal.tsx` | Canvas-drawn "image track" composite; exports base64 to `props.handleSaveImageTrack` → `Invokes.SaveImageTrack` (synchronous, like Collage) |
| `src/components/modals/TransformModal.tsx` / `LensCorrectionModal.tsx` | Mounted in `CropPanel.tsx` with local `useState`; live `preview_geometry_transform`, return via `onApply(params)` |
| `src/components/modals/ConfigurePresetModal.tsx` | Mounted in `PresetsPanel.tsx`; gathers preset name + include flags, returns via `onSave` |
| `src/components/modals/ConfirmModal.tsx` / `CreateFolderModal.tsx` / `RenameFolderModal.tsx` / `RenameFileModal.tsx` / `ImportSettingsModal.tsx` / `CopyPasteSettingsModal.tsx` | Simple input/confirm dialogs in `AppModals` |

## How it works
- **State.** Each modal's visibility lives in `useUIStore`. Simple dialogs use a boolean (`isImportModalOpen`, `isCreateFolderModalOpen`); feature dialogs use a typed object (`panoramaModalState`, `denoiseModalState`, `cullingModalState`, ...). `setUI(partial | updater)` opens/closes them. A panel triggers a modal by calling `setUI({ panoramaModalState: { isOpen: true, ... } })`.
- **Backend calls.** Modals rarely `invoke()` directly. For panorama/hdr/denoise/collage the `invoke()` calls live in `useProductivityActions.ts` and arrive in `AppModals` as `props.handleStartPanorama`, `handleStartHdr`, `handleApplyDenoise`, `handleBatchDenoise`, `handleSave*`. The modal calls the prop; the hook invokes `Invokes.StitchPanorama` / `Invokes.MergeHdr` / `Invokes.ApplyDenoising` / etc. Modals that DO invoke directly: Culling (`Invokes.CullImages`), Negative (`preview_negative_conversion`, `convert_negatives`, `generate_preview_for_path`), Lens/Transform (`preview_geometry_transform`, `get_lensfun_*`, `autodetect_lens`, `get_lens_distortion_params`, `load_settings`), Collage (`Invokes.LoadMetadata`, `Invokes.GeneratePreviewForPath`).
- **Progress events.** Long-running results stream over Tauri events. `panorama-*`, `hdr-*`, `denoise-*` (single), and `culling-*` are subscribed in `useTauriListeners.ts`, which mutates the matching `useUIStore` slice — the modal just re-renders. Only the two **batch** events — `denoise-batch-progress` and `negative-batch-progress` — are listened to inside the modal components themselves (each cleans up in its `useEffect` return).
- This module connects to `state-stores` (useUIStore), `hooks` (useProductivityActions/useTauriListeners), `compositions` (panorama/hdr/collage/negative backends), `corrections` (denoise/lens backends), `ai-features` (culling), and `presets` (ConfigurePreset).

## Modal -> backend command -> events (the per-feature contract)
| modal | opened via | backend command(s) | progress events |
| --- | --- | --- | --- |
| Panorama | `panoramaModalState` (`props.handleStartPanorama`/`handleSavePanorama`) | `Invokes.StitchPanorama`, `Invokes.SavePanorama` | `panorama-progress/complete/error` (in `useTauriListeners`) |
| Hdr | `hdrModalState` (`props.handleStartHdr`/`handleSaveHdr`) | `Invokes.MergeHdr`, `Invokes.SaveHdr` | `hdr-progress/complete/error` (in `useTauriListeners`) |
| Denoise | `denoiseModalState` (`props.handleApplyDenoise`/`handleBatchDenoise`/`handleSaveDenoisedImage`) | `Invokes.ApplyDenoising`, `batch_denoise_images`, `Invokes.SaveDenoisedImage` | `denoise-*` (single, `useTauriListeners`); `denoise-batch-progress` (in modal) |
| NegativeConversion | `negativeModalState` | `preview_negative_conversion`, `convert_negatives`, `generate_preview_for_path` | `negative-batch-progress` (in modal) |
| Culling | `cullingModalState` | `Invokes.CullImages` | `culling-start/progress/complete/error` (in `useTauriListeners`) |
| Collage | `collageModalState` (`props.handleSaveCollage`) | `Invokes.LoadMetadata`, `Invokes.GeneratePreviewForPath`, `Invokes.SaveCollage` | none (synchronous canvas draw) |
| ImageTrack | `imageTrackModalState` (`props.handleSaveImageTrack`) | `Invokes.SaveImageTrack` (`save_image_track`) | none (synchronous canvas draw) |
| Transform | local state in `CropPanel.tsx`, returns `onApply` | `preview_geometry_transform` | none |
| LensCorrection | local state in `CropPanel.tsx`, returns `onApply` | `get_lensfun_makers`, `get_lensfun_lenses_for_maker`, `autodetect_lens`, `get_lens_distortion_params`, `preview_geometry_transform`, `Invokes.LoadSettings` | none |
| ConfigurePreset | local state in `PresetsPanel.tsx`, returns `onSave` | none (parent persists) | none |
| ImportSettings / CopyPasteSettings / Confirm / CreateFolder / RenameFolder / RenameFile | boolean flag in `useUIStore` | none (return via `onSave`/`onConfirm`) | none |

## Key types & symbols
| symbol | kind | what |
| --- | --- | --- |
| `AppModals` | component | Registry; props are the `handle*` callbacks (see `AppModalsProps`) |
| `setUI` | store action | `(Partial<UIState> \| (s) => Partial<UIState>) => void`; open/close + payload |
| `PanoramaModalState` / `HdrModalState` | type | `{ isOpen, isProcessing, error, finalImageBase64, progressMessage, stitchingSourcePaths }` |
| `DenoiseModalState` | type | `{ isOpen, isProcessing, previewBase64, originalBase64?, error, targetPaths, progressMessage, isRaw }` |
| `NegativeConversionModalState` | type | `{ isOpen, targetPaths }` (store slice is `negativeModalState`) |
| `CullingModalState` | type | `{ isOpen, suggestions, progress: {current,total,stage}, error, pathsToCull }` |
| `CollageModalState` | type | `{ isOpen, sourceImages: ImageFile[] }` |
| `ConfirmModalState` | type | `{ isOpen, title?, message?, confirmText?, confirmVariant?, onConfirm?() }` |
| `Invokes.StitchPanorama` `MergeHdr` `SavePanorama` `SaveHdr` `ApplyDenoising` `SaveDenoisedImage` `SaveCollage` `SaveImageTrack` `CullImages` `LoadMetadata` `GeneratePreviewForPath` | command | enum in `src/components/ui/AppProperties.tsx` (`Invokes`) |

## Conventions (follow these when coding here)
- Visibility flag goes in `useUIStore`; transient UI (mount/show animation, local sliders, isSaving) stays in the modal's own `useState`.
- Animate with the two-state idiom: `isMounted` (`if (!isMounted) return null`) + `show` (toggled `setTimeout(..., 10)` after mount). Drive both from `isOpen` in a `useEffect`.
- Close by resetting the whole slice, not just the flag — e.g. `setUI({ panoramaModalState: { isOpen: false, isProcessing: false, progressMessage: '', finalImageBase64: null, error: null, stitchingSourcePaths: [] } })`. AppModals already does this; match it.
- Backdrop click closes via `onClick={onClose}` on the overlay; children `stopPropagation`.
- Throttle live-preview invokes with `lodash.throttle` (Transform/Lens/Negative use `preview_geometry_transform`/`preview_negative_conversion`).
- Direct event listeners must clean up: `const unlisten = listen(...); return () => { unlisten.then((f) => f()); };`
- Backend commands go through the `Invokes` enum where one exists; raw strings only for commands without an enum entry (lens/transform/negative previews).
- All user-facing strings use `t()` (e.g. `t('modals.culling.starting')`); add keys under `modals.*`.

## Gotchas
- **Don't add an `invoke()` for panorama/hdr/denoise/collage inside the modal.** Those belong in `useProductivityActions.ts`; the modal receives a `props.handle*` callback. Wiring them in the modal duplicates the flow and skips the store updates.
- **Command names are `stitch_panorama` / `merge_hdr`**, not `start_*`. Single-image denoise is `apply_denoising`; batch is `batch_denoise_images` (raw string).
- Result/progress for panorama/hdr/single-denoise/culling arrives via `useTauriListeners.ts`, NOT the modal — a new feature event must be subscribed there to reach the UI. Only `*-batch-progress` is in-modal.
- `negativeModalState` is the store key but the type is `NegativeConversionModalState` — names don't match; grep both.
- Transform/Lens/ConfigurePreset are NOT in `useUIStore`: their `isOpen` is local state in `CropPanel.tsx` / `PresetsPanel.tsx`, and they return data via `onApply(params)` / `onSave(...)`, never through `setUI`. Adding them to `AppModals` would double-mount.
- `onSave`/`handleSave*` are async and can throw; PanoramaModal/HdrModal show their Save button until the promise resolves — handle/await errors or the button appears stuck.
- `ConfirmModalState.onConfirm` is optional; if undefined, confirming just closes silently.
- Modals keyed off `targetPaths[0]` / `stitchingSourcePaths[0]` assume a non-empty array — guard before opening.

## How to add a new modal feature end-to-end
1. **Store slice** — in `src/store/useUIStore.ts` add `export interface MyFeatureModalState { isOpen: boolean; ... }`, add `myFeatureModalState: MyFeatureModalState` to `UIState`, and initialize it in the `create()` default object.
2. **Backend** — add the Rust `#[tauri::command]`, register it in `src-tauri/src/lib.rs` (`invoke_handler!`), and emit `myfeature-progress` / `myfeature-complete` / `myfeature-error` events if long-running (see `backend`/`compositions`).
3. **Invokes enum** — add `MyFeature = 'my_feature'` to the `Invokes` enum in `src/components/ui/AppProperties.tsx`.
4. **Action hook** — put the `invoke(Invokes.MyFeature, ...)` call in `src/hooks/useProductivityActions.ts` (or a sibling hook); it should `setUI` to set `isProcessing` and clear results.
5. **Listener** — if it emits progress/complete events, subscribe to them in `src/hooks/useTauriListeners.ts` and `setUI` the `myFeatureModalState` slice with the payload/result.
6. **Component** — create `src/components/modals/MyFeatureModal.tsx`: props `{ isOpen, onClose, ...payload, onStart, onSave }`; local `isMounted`/`show`; `if (!isMounted) return null`; render controls + spinner + result; use `t()` for strings.
7. **Register** — import and render it in `AppModals.tsx`, wiring `isOpen={myFeatureModalState.isOpen}`, an `onClose` that resets the slice, and the `props.handle*` callbacks; extend `AppModalsProps` and pass the new handlers from where `AppModals` is mounted.
8. **Trigger** — from the panel/context-menu that launches it, call `setUI({ myFeatureModalState: { isOpen: true, ...payload } })`.

## Related skills
`state-stores`, `hooks`, `compositions`, `corrections`, `ai-features`, `presets`, `tauri-bridge`, `frontend`, `i18n`

## After changes
- TS: `npm run typecheck` and `npm run lint` (eslint-plugin-i18next flags literal JSX strings).
- If you added UI strings: `npm run i18n:extract` then `npm run i18n:check`; format with `npm run format`.
- Backend command changes: `cargo fmt` + `cargo clippy` inside `src-tauri/`.
- Record any user-facing modal/feature in the changelog per the `changelog` skill.
