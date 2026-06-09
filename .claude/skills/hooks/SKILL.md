---
name: hooks
description: Use this skill before modifying any custom React hook in src/hooks/ — the UI<->backend mediation layer (useImageProcessing, useEditorActions, useAiMasking, usePresets, useKeyboardShortcuts, useTauriListeners, useAppNavigation, useAppInitialization, useImageLoader, useThumbnails, useSortedLibrary, useFileOperations, useLibraryActions). Covers the apply_adjustments/ROI/interactive-patch render pipeline, debounced save/history, Tauri event subscriptions, the keybind dispatcher, and image/folder loading. Trigger whenever the user asks to add or change a hook that invokes a backend command, subscribes to a backend event, debounces edits/history, drives the preview render loop, handles keyboard shortcuts, multi-select, presets, or library/file navigation.
---

# Hooks (UI<->Backend Mediation) Skill

The hooks layer in `src/hooks/` holds all the domain logic that sits between React components and the 5 Zustand stores. Hooks invoke Tauri commands (`invoke(Invokes.X, args)`), subscribe to backend events (`listen(...)`), debounce edits, and orchestrate the preview render pipeline. There is no `index.ts` barrel — import each hook by its file path.

## Key files
| path | responsibility |
| --- | --- |
| `src/hooks/useImageProcessing.ts` | Core render loop: ROI calc from zoom/pan, `apply_adjustments` invoke, JPEG/`WGPU_RENDER`/interactive-patch decode, 3-job pipeline, hi-fi zoom debounce, multi-select delta apply |
| `src/hooks/useEditorActions.ts` | `setAdjustments` + module-level `debouncedSave` (300ms) / `debouncedSetHistory` (500ms); rotate, auto, LUT, reset, copy/paste, zoom |
| `src/hooks/useAiMasking.ts` | Generative replace, quick erase, AI mask (subject/depth/foreground/sky) generation; Clerk token via `useAuth()` |
| `src/hooks/useTauriListeners.ts` | Subscribes ~35 backend events; RAF-batches thumbnail/rating/edit-status updates |
| `src/hooks/useKeyboardShortcuts.ts` | Builds `comboMap` from keybinds, window `keydown` dispatch to actions + builtin shortcuts |
| `src/hooks/useAppNavigation.ts` | `handleImageSelect`, `handleSelectSubfolder`, home/back, album/folder switching, session restore |
| `src/hooks/useAppInitialization.ts` | One-shot bootstrap: `load_settings`, supported types, theme/i18n, folder state; settings-persist watchers |
| `src/hooks/useImageLoader.ts` | Two-phase load (early metadata, then `load_image`); sets `isReady`; caches edit state into a ref |
| `src/hooks/usePresets.ts` | Preset CRUD + `savePresetsToBackend` (debounced 500ms); returns `UserPreset[]` |
| `src/hooks/useLibraryActions.ts` | Rating/color/tags/exif, multi-select (`handleMultiSelectClick`), folder pin, album CRUD |
| `src/hooks/useThumbnails.ts` | Dedup + debounced (150ms / maxWait 300ms) `update_thumbnail_queue`; `markGenerated` |
| `src/hooks/useSortedLibrary.ts` | Memoized filter+sort; exports pure `computeSortedLibrary(libraryState, settingsState)` |
| `src/hooks/useFileOperations.ts` | delete/rename/import/paste files + confirmation modal flow |
| `src/hooks/useImageRenderSize.ts` | `RenderSize` (w/h/scale/offset) from container via `ResizeObserver` |

Other hooks present: `useExportSettings`, `useProductivityActions`, `useWaveformControls`, `useOsPlatform`, `useAppContextMenus`.

## How it works
- **Render pipeline** (`useImageProcessing`): an effect watches `adjustments`/`isSliderDragging` and calls `applyAdjustments`. While dragging it queues into `pendingApplyRef` and `flushPipeline` caps in-flight `apply_adjustments` jobs at 3 (flushed on `requestAnimationFrame`). The returned `ArrayBuffer` is sniffed: first 11 bytes `WGPU_RENDER` clears the interactive patch (GPU display path renders directly); dragging decodes a 24-byte header (patchX/Y/W/H + fullW/H, little-endian) + JPEG into an `interactivePatch`; otherwise the whole buffer is a JPEG `finalPreviewUrl`. Job ordering is guarded by `previewJobIdRef`/`latestRenderedJobIdRef` and `selectedImagePathRef`.
- **Edits & persistence** (`useEditorActions`): `setAdjustments` writes the editor store and feeds `debouncedSetHistory`. On drag-idle, `useImageProcessing` calls `debouncedSave(path, adjustments)` -> `save_metadata_and_update_thumbnail`, and applies a delta to other `multiSelectedPaths` via `apply_adjustments_to_paths`.
- **Events** (`useTauriListeners`): one effect registers all `listen(...)` calls and returns a cleanup that unlistens. Thumbnail/rating/edit-status events buffer in refs and flush together via RAF (`scheduleFlush`) to avoid store thrashing. Updates the process/editor/ui/library stores by store name.
- Connects to: `state-stores` (the 5 Zustand stores), `tauri-bridge` (Invokes enum + event names), `image-pipeline`/`gpu-shaders` (apply_adjustments backend), `masking`/`ai-features` (mask/AI commands), `presets`, `file-management`, `library-ui`.

## Key types & symbols
- `Invokes` — enum (`src/components/ui/AppProperties.tsx`) — string command names; e.g. `ApplyAdjustments='apply_adjustments'`, `SaveMetadataAndUpdateThumbnail`, `InvokeGenerativeReplaseWithMaskDef='invoke_generative_replace_with_mask_def'`, `ApplyAdjustmentsToPaths`. Some hooks also call raw strings (`generate_ai_depth_mask`, `generate_original_transformed_preview`, `is_image_cached`, `update_thumbnail_queue`, `frontend_ready`, `clear_session_caches`, `load_and_parse_lut`, `precompute_ai_subject_mask`).
- `applyAdjustments` / `executeApplyAdjustments` — fn (useImageProcessing) — queue vs. run a render job.
- `setAdjustments` — fn (useEditorActions) — accepts a `Partial<Adjustments>` OR `(prev) => Adjustments`.
- `debouncedSave` / `debouncedSetHistory` — module-level debounced singletons exported from useEditorActions (imported by other hooks).
- `computeSortedLibrary(libraryState, settingsState)` — pure fn used by both `useSortedLibrary` and multi-select range logic.
- `Coord`, `Adjustments`, `COPYABLE_ADJUSTMENT_KEYS`, `INITIAL_ADJUSTMENTS`, `normalizeLoadedAdjustments` — from `src/utils/adjustments.ts`. `InteractivePatch` — from `src/store/useEditorStore.ts`. `UserPreset` — preset tree type.

## Conventions (follow these when coding here)
- Read non-reactive state via `useEditorStore.getState()` etc. inside callbacks; subscribe with selectors `(s) => s.field` only for values that should re-render.
- Wrap every `invoke()` in try/catch; log with `console.error` and surface user errors via `toast.error(...)`. Never throw — early-return or return null.
- For long async ops, set a store loading flag at start and clear it in `finally` (e.g. `isGeneratingAi`, `isGeneratingAiMask`).
- Make debounced functions stable: `useMemo(() => debounce(...), deps)` (or module-level singletons like `debouncedSave`). Always `.cancel()` in effect cleanup and `.flush()` before navigation transitions.
- Guard async completions with an `isEffectActive` flag (set false in cleanup) and/or compare `selectedImagePathRef.current` before writing to the store.
- Strip a path's virtual-copy suffix with `split('?vc=')[0]`; detect albums with `path.startsWith('Album: ')`.

## Gotchas
- **Patch dedup**: `patchesSentToBackend` (a `Set` in the editor store) tracks AI patch/sub-mask IDs whose base64 was already sent; `executeApplyAdjustments` nulls those fields. If you mutate a patch client-side without re-invoke, call `patchesSentToBackend.delete(id)` or the backend keeps stale data (AI hooks already do this).
- **Slider drag blocks hi-fi**: while `isSliderDragging`, only interactive patches render and `requestHiFiZoom.cancel()` runs in cleanup. A 50ms `dragIdleTimer` fires the final full-res render + save. Forget to set `isSliderDragging=false` and the preview freezes.
- **`currentResRef` only grows**: `requestHiFiZoom` skips if `targetRes <= currentResRef.current`. It is reset to 0 on image/geometry change — do not forget when adding a new path that needs re-render.
- **ROI is null unless zoomed**: `calculateROI` returns null when `baseRenderSize` is unset, `scale <= 1.01`, or the clamped region covers ~the whole frame. ROI is derived from `baseRenderSize`, not `originalSize`. Transform state (zoom/pan) lives in `transformWrapperRef.current.instance.transformState`, NOT Zustand.
- **Module-level debounce is shared**: `debouncedSave`/`debouncedSetHistory` are singletons; a `.flush()`/`.cancel()` in one hook affects all callers. `useAppNavigation` flushes save and cancels history on every transition — preserve that ordering.
- **Copy/paste whitelist**: copy/paste/preset code iterates `COPYABLE_ADJUSTMENT_KEYS` and uses `INITIAL_ADJUSTMENTS` for merge/tool delta detection. A new `Adjustments` field is silently ignored until added to that list (see `adjustments-ui` / `presets` skills).
- **Listeners cleanup**: every `listen(...)` returns a promise resolving to an unlisten fn; `useTauriListeners` must `then((unlisten) => unlisten())` for each on cleanup. Add new listeners to the same array.

## How to add a hook that calls a new backend command + listens for its events
1. Register the command in the backend `invoke_handler!` (`src-tauri/src/lib.rs`) — see the `backend` skill.
2. Add the command to the `Invokes` enum in `src/components/ui/AppProperties.tsx` (e.g. `MyNewCommand = 'my_new_command'`), keeping alphabetical order.
3. Create `src/hooks/useMyFeature.ts` exporting a hook that returns action fns. Inside each: read state with `useStore.getState()`, set a loading flag, `await invoke(Invokes.MyNewCommand, { ...camelCaseArgs })` in try/catch with `toast.error`, then write results via `setEditor(...)`/`setLibrary(...)`, clearing the flag in `finally`. Use the loading flag to ignore re-entrant calls.
4. If the command emits backend events, add a `listen('my-event', (e) => { if (isEffectActive) useXStore.getState().setX(...); })` to the array in `src/hooks/useTauriListeners.ts` (buffer + RAF-flush if high-frequency).
5. If the command needs the Clerk auth token (cloud/AI), inject it like `useAiMasking` (`const { getToken } = useAuth()` from `@clerk/react`; pass `token: token || null`) — see `ai-features` / `security-review`.
6. Consume the hook in the component (or a manager under `src/components/managers/`, e.g. `ImageProcessingManager.tsx`) and wire callbacks.

## Related skills
`state-stores`, `tauri-bridge`, `image-pipeline`, `gpu-shaders`, `masking`, `ai-features`, `presets`, `file-management`, `library-ui`, `adjustments-ui`

## After changes
- `npm run typecheck` and `npm run lint` (strict TS + eslint; eslint-plugin-i18next flags literal UI strings).
- `npm run format` (prettier; 120 cols, single quotes, semicolons).
- If you added user-facing strings, wrap them in `t()` and run `npm run i18n:extract` / `npm run i18n:check`.
- If you registered a backend command, run `cargo fmt` + `cargo clippy` inside `src-tauri/`.
- Record any user-visible change per the `changelog` skill.
