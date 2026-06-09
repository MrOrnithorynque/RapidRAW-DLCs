---
name: state-stores
description: Use this skill before modifying any of the 5 Zustand stores in src/store/ (useSettingsStore, useUIStore, useLibraryStore, useEditorStore, useProcessStore) or the adjustments contract in src/utils/adjustments.ts. Covers store shapes, the setEditor/setUI/setLibrary/setProcess actions, the 50-entry undo/redo history (pushHistory/undo/redo/resetHistory/goToHistoryIndex), the selector + useShallow subscription convention, the debouncedSave(300ms)/debouncedSetHistory(500ms) flow in useEditorActions.ts, and libraryActiveAdjustments vs editor adjustments. Trigger whenever the user asks to add a store field, add an adjustment field through the stores, change undo/redo or history behavior, touch panel/modal/process state, or debug re-renders / state subscriptions.
---

# State Stores (Zustand) Skill

The frontend's reactive state layer: five independent Zustand stores in `src/store/` plus the `Adjustments` data contract they carry. `useEditorStore.adjustments` is the single source of truth for the image being edited; all other stores hold UI, library, settings, and background-process state.

## Key files

| path | responsibility |
| --- | --- |
| `src/store/useEditorStore.ts` | Active edit: `selectedImage`, `adjustments`, undo/redo `history`/`historyIndex` (max 50), previews, histogram/waveform, tool/mask/AI flags, clipboard |
| `src/store/useUIStore.ts` | Layout (panel widths, `uiVisibility`), right-panel nav + slide direction, all modal state objects, `customEscapeHandler` |
| `src/store/useLibraryStore.ts` | Folder/album trees, `imageList`, selection, sort/filter/`searchCriteria`, `libraryActivePath`, `libraryActiveAdjustments` |
| `src/store/useSettingsStore.ts` | `appSettings`, `theme`, `supportedTypes`, `osPlatform`; `handleSettingsChange` persists via `SaveSettings` |
| `src/store/useProcessStore.ts` | `exportState`/`importState` (auto-reset to Idle after 5s), indexing, thumbnails, AI download status, copy/paste flags (auto-reset 1s) |
| `src/utils/adjustments.ts` | `Adjustments` interface, `INITIAL_ADJUSTMENTS`, `MaskContainer`/`AiPatch`, `normalizeLoadedAdjustments`, `ADJUSTMENT_GROUPS`, `COPYABLE_ADJUSTMENT_KEYS`, `ADJUSTMENT_SECTIONS` |
| `src/hooks/useEditorActions.ts` | `setAdjustments` wrapper + module-level `debouncedSetHistory` (500ms) and `debouncedSave` (300ms) |

## How it works

- Each store is a plain `create<State>((set, get) => ({...}))`. There is no persist middleware — persistence is explicit via Tauri commands (`SaveSettings`, `save_metadata_and_update_thumbnail`).
- Components subscribe with a selector and `useShallow` from `zustand/react/shallow`: `useEditorStore(useShallow((s) => ({ adjustments: s.adjustments, ... })))`. Callbacks read current state without subscribing via `useEditorStore.getState()`.
- Edit flow: a slider calls `setAdjustments(partial)` from `useEditorActions.ts`. That does `setEditor((state) => ({ adjustments: { ...prev, ...value } }))` and feeds the new object to `debouncedSetHistory` (500ms -> `pushHistory`). Separately, `useImageProcessing.ts` reacts to the new `adjustments`, repaints the GPU preview (`apply_adjustments`), and on drag-idle calls `debouncedSave(path, adjustments)` (300ms -> `save_metadata_and_update_thumbnail`).
- `useEditorStore` connects to `image-pipeline`/`gpu-shaders` (the `Adjustments` it holds are the JSON contract sent to Rust), to `masking` (`masks`/`activeMaskId`), to `ai-features` (`aiPatches`, `isGeneratingAi`), and to `tauri-bridge` for invoke/listen wiring.

## Key types & symbols

| symbol | kind | what |
| --- | --- | --- |
| `setEditor` / `setUI` / `setLibrary` / `setProcess` | action | Each takes a `Partial<State>` OR an updater fn `(state) => Partial<State>`; merged via `set`. The ONLY way to write store state |
| `pushHistory(newAdj)` | action | Truncates redo branch (`history.slice(0, historyIndex+1)`), pushes, shifts oldest if `length > 50`, sets `historyIndex = length-1` |
| `undo()` / `redo()` | action | Move `historyIndex` and set `adjustments = history[newIndex]` (no-op at bounds) |
| `resetHistory(initial)` / `goToHistoryIndex(i)` | action | Reset to `[initial]`/index 0, or jump to a specific history entry |
| `setRightPanel(panel)` | action | Toggles off if same panel else switches; computes `slideDirection` from `RIGHT_PANEL_ORDER` (Metadata, Adjustments, Crop, Masks, Ai, Presets, Export) |
| `setExportState` / `setImportState` | action | Merge into `exportState`/`importState`; schedule 5s auto-reset to `Status.Idle` on Success/Error/Cancelled |
| `handleSettingsChange(newSettings)` | async action | Strips `searchCriteria`, updates `theme`, invokes `Invokes.SaveSettings` |
| `debouncedSetHistory` / `debouncedSave` | module fn | `lodash.debounce` wrappers (500ms / 300ms) defined at top of `useEditorActions.ts`; `.cancel()` is called on reset |
| `normalizeLoadedAdjustments(loaded)` | fn | Fills missing fields from defaults, deep-clones curves, normalizes mask/aiPatch subMasks — run on every backend-loaded `Adjustments` |
| `libraryActiveAdjustments` | field | `useLibraryStore` copy of the selected library image's adjustments (preview/persistence); distinct from `useEditorStore.adjustments` |

## Conventions (follow these when coding here)

- Read state in components with a selector + `useShallow` for multi-field reads; never call a bare `useStore()` (subscribes to everything).
- Write only through `setEditor`/`setUI`/`setLibrary`/`setProcess` (or the typed `setExportState`/`setImportState`/`setFilterCriteria`/`setSearchCriteria`/`setSortCriteria`). Never call `set()` outside the store definition.
- In callbacks/debounced fns, read current state with `Store.getState()` rather than closing over a subscribed value.
- Mutate `adjustments` only via `setAdjustments` in `useEditorActions.ts` so history + save stay wired; treat `history[]` as immutable (use `pushHistory`/`undo`/`redo`/`resetHistory`/`goToHistoryIndex`).
- Any `Adjustments` coming from the backend must pass through `normalizeLoadedAdjustments` before going into a store.
- Modal state lives as flat objects on `useUIStore` (e.g. `denoiseModalState`); open via `setUI({ denoiseModalState: { ...prev, isOpen: true } })`.

## Gotchas

- `libraryActiveAdjustments` and `useEditorStore.adjustments` are NOT auto-synced — load/save between them explicitly (see `handleResetAdjustments` in `useEditorActions.ts`).
- History caps at 50: `pushHistory` shifts the oldest entry, so long sessions silently lose old undo steps.
- `pushHistory` truncates everything after `historyIndex` — making a new edit after undoing discards the redo branch.
- `debouncedSetHistory`/`debouncedSave` are module-level singletons. After an out-of-band reset call `debouncedSetHistory.cancel()` (already done in reset) or a stale push will land.
- `Set<string>` fields (`expandedFolders`, `expandedAlbumGroups`, `patchesSentToBackend`) are not JSON-serializable and unknown to the backend; convert to arrays if persisting.
- `useShallow` compares each selected field by reference — mutating an array/object in place won't trigger a render; always spread/replace.
- `export`/`import` state auto-resets to `Status.Idle` after 5s; `isCopied`/`isPasted` reset after 1s. Cache anything you need past those windows.
- `aspectRatio` on `Adjustments` is `number | null`; null means free crop. Many crop calcs branch on it.
- `sectionVisibility` must carry all keys (basic, color, curves, details, effects); merge with `INITIAL_ADJUSTMENTS.sectionVisibility` rather than replacing. (`collapsibleSectionsState` on `useUIStore` is unrelated UI collapse state.)

## How to add a new adjustment field through the stores

1. Add the field to the `Adjustments` interface in `src/utils/adjustments.ts` and a default in `INITIAL_ADJUSTMENTS`.
2. Add a `??`-fallback line for it inside `normalizeLoadedAdjustments` so old sidecars get the default.
3. If it should be copy/pasteable, add its key to the right category in `ADJUSTMENT_GROUPS` (it auto-flows into `COPYABLE_ADJUSTMENT_KEYS`).
4. In the UI control, call `setAdjustments({ myField: value })` from `useEditorActions.ts` — history (`debouncedSetHistory`) and auto-save (`debouncedSave`) are wired automatically.
5. Wire the Rust side: add the matching camelCase field to `GlobalAdjustments`/`MaskAdjustments`/`AllAdjustments` in `src-tauri/src/image_processing.rs` and consume it in the WGSL pipeline — see `image-pipeline` and `gpu-shaders`. The whole `Adjustments` object is sent over `apply_adjustments`/`save_metadata_and_update_thumbnail`; no per-field serialization.
6. For a plain store field (non-adjustment), add it to the store's `interface`, set an initial value in `create(...)`, and write it via the store's `set*` action. Add an `export interface` for any new nested shape (mirror `CollapsibleSectionsState`, modal state objects).

## Related skills

`image-pipeline`, `gpu-shaders`, `masking`, `ai-features`, `adjustments-ui`, `library-ui`, `modals`, `hooks`, `tauri-bridge`, `export`, `presets`

## After changes

Run `npm run typecheck` and `npm run lint` (the stores are strict TS). If you added user-facing strings, register them with `npm run i18n:extract`. If you also touched the Rust `Adjustments` structs, run `cargo fmt` + `cargo clippy` inside `src-tauri/`. Record any user-visible behavior change per the `changelog` skill.
