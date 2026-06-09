---
name: frontend
description: Use this skill before modifying the React app shell in src/App.tsx, src/components/views/ (EditorView/LibraryView), src/window/TitleBar.tsx, or src/context/ContextMenuContext.tsx. This is the INDEX skill for the whole frontend — it maps the Zustand stores, hooks, editor canvas, right panels, modals, ui primitives, the Tauri bridge, and i18n. Covers the LibraryView<->EditorView switch on selectedImage, the invisible ImageProcessingManager/ImageLoaderManager, panel resizers, the provider tree, the Invokes/Panel enums, and useShallow selector conventions. Trigger whenever the user asks to add/wire a new right-side panel or view, change the top-level layout/resizers/window chrome/title bar, touch the global context menu or provider tree, or find where a frontend concern lives.
---

# Frontend Shell Skill

The top-level React shell and its routing/layout. Entry is `src/main.tsx` -> `src/App.tsx` (`AppWrapper` -> `App`). The shell switches between `src/components/views/LibraryView.tsx` and `src/components/views/EditorView.tsx` based on `selectedImage`, hosts the global providers, panel resizers, and two invisible manager components.

## Key files
| path | responsibility |
|------|----------------|
| `src/App.tsx` | Root component (771 lines). `AppWrapper` (providers) + `App` (subscribes 5 stores, wires ~9 action hooks + `useTauriListeners` + `useKeyboardShortcuts`, renders TitleBar/FolderTree/View/ExportPanel/AppModals/ToastContainer, owns `createResizeHandler`). |
| `src/components/views/EditorView.tsx` | Editor layout when `selectedImage` is set: `Editor` canvas + `BottomBar` filmstrip + `RightPanelSwitcher` + the 7-panel `motion.div` switch. Compact-portrait (flex-col) vs desktop (flex-row). |
| `src/components/views/LibraryView.tsx` | Library layout when `selectedImage` is null: grid/list + `BottomBar` batch controls. |
| `src/window/TitleBar.tsx` | Custom OS window chrome (decorations off). Returns `null` on Android. macOS draws traffic-light buttons; Win/Linux draw min/max/close calling `getCurrentWindow().minimize()/toggleMaximize()/close()`. |
| `src/context/ContextMenuContext.tsx` | `ContextMenuProvider` + `useContextMenu` hook; portal-rendered global context menu with nested submenus. |
| `src/components/ui/AppProperties.tsx` | Shared enums/types: `Invokes` (Tauri command names), `Panel`, `Theme`, `LibraryViewMode`, `Orientation`, `ImageFile`, etc. |
| `src/components/managers/ImageProcessingManager.tsx` | Invisible (`return null`) wrapper around `useImageProcessing`; GPU preview/render pipeline driven by refs from App. |
| `src/components/managers/ImageLoaderManager.tsx` | Invisible wrapper around `useImageLoader`; decodes/loads images, takes `cachedEditStateRef`. |
| `src/store/` | The 5 Zustand stores — see `state-stores`. |
| `src/hooks/` | Action/listener hooks (`useAppNavigation`, `useEditorActions`, etc.) — see `hooks`. |

## Frontend module map (sibling skills)
| concern | where | skill |
|---------|-------|-------|
| Zustand stores | `src/store/use*Store.ts` | `state-stores` |
| action/listener hooks | `src/hooks/` | `hooks` |
| editor canvas / zoom-pan | `src/components/panel/Editor.tsx` | `editor-canvas` |
| right adjustment panels | `src/components/panel/right/ControlsPanel.tsx` etc. | `adjustments-ui` |
| library grid / folder tree | `src/components/panel/MainLibrary`, `FolderTree.tsx` | `library-ui` |
| modals | `src/components/modals/` (`AppModals.tsx`) | `modals` |
| reusable widgets | `src/components/ui/` (`Resizer`, `GlobalTooltip`) | `ui-primitives` |
| invoke()/listen() contract | `@tauri-apps/api`, `Invokes` enum | `tauri-bridge` |
| translations | `src/i18n/`, `t()` | `i18n` |
| masks panel | `src/components/panel/right/MasksPanel.tsx` | `masking` |
| AI panel | `src/components/panel/right/AIPanel.tsx` | `ai-features` |
| export panel | `src/components/panel/right/ExportPanel.tsx` | `export` |

## How it works
- `main.tsx` mounts `AppWrapper`: `ClerkProvider` (dev key `CLERK_PUBLISHABLE_KEY`) -> `ContextMenuProvider` -> `<App/>` + `<GlobalTooltip/>`.
- `App` subscribes to all 5 stores via `useShallow` selectors, then calls action hooks (`useAppNavigation`, `useLibraryActions`, `useEditorActions`, `useFileOperations`, `useProductivityActions`, `useAppContextMenus`), plus `useTauriListeners`, `useKeyboardShortcuts`, `useAppInitialization`.
- Render branch: `selectedImage ? <EditorView/> : <LibraryView/>` (App.tsx ~line 641). Heavy refs (`transformWrapperRef`, `previewJobIdRef`, `currentResRef`, `cachedEditStateRef`, `prevAdjustmentsRef`) are created in App and threaded into the two manager components and `useAppNavigation`.
- Backend->frontend flow: `useTauriListeners` registers `listen()` for ~30 events (e.g. `histogram-update`, `waveform-update`, `preview-update-uncropped`, `thumbnail-generated`, `batch-export-progress`, `indexing-progress`, `import-progress`) and writes to stores; thumbnail events are batched via `requestAnimationFrame`. App.tsx also directly listens to `ai-connector-status-update`. See `tauri-bridge` / `backend`.
- Right panel: `RightPanelSwitcher` (the icon tab strip) calls `handleRightPanelSelect` -> `setRightPanel`, setting `activeRightPanel`; `EditorView` renders the matching panel keyed on `renderedRightPanel` inside an `AnimatePresence`.

## Key types & symbols
| symbol | kind | what |
|--------|------|------|
| `Invokes` | enum (`AppProperties.tsx`) | All Tauri command name strings. Call `invoke(Invokes.X, args)` from `@tauri-apps/api/core`. |
| `Panel` | enum (`AppProperties.tsx`) | Right-panel ids: `Adjustments, Ai, Crop, Export, Masks, Metadata, Presets`. |
| `setUI` / `setRightPanel` | actions (`useUIStore`) | `setUI` accepts a partial object or updater fn. `setRightPanel(panel)` toggles off if re-selected, else sets `activeRightPanel`+`renderedRightPanel` and derives `slideDirection` from `RIGHT_PANEL_ORDER`. |
| `createResizeHandler(stateKey, startSize)` | fn (`App.tsx:450`) | Returns a pointer handler for `'left'\|'right'\|'bottom'\|'compact'`. Clamps: left 200-500, right 280-600, bottom 100-400, compact min(220)/max. |
| `handleRightPanelSelect` | fn (`App.tsx:525`) | Passed to views; calls `setRightPanel` then resets `{ activeMaskId, activeAiSubMaskId, isWbPickerActive }`. |
| `handleToggleFolder` | fn (`App.tsx:533`) | Async; on expand `invoke(Invokes.GetFolderChildren)` then merges via `insertChildrenIntoTree`. |
| `handleToggleFullScreen` | fn (`App.tsx:365`) | Toggles `isFullScreen`; sets `isInstantTransition` when zoomed (`zoom > 1.01`). |
| `useContextMenu` | hook (`ContextMenuContext.tsx`) | `{ showContextMenu, hideContextMenu, ... }`; build option arrays in `useAppContextMenus`. |
| `ImageProcessingManager` / `ImageLoaderManager` | components | Invisible (`return null`); wrap the GPU/load hooks. |

## Conventions (follow these when coding here)
- Subscribe to stores with `useStore(useShallow((s) => ({ ... })))` — never select the whole store object.
- Call commands as `invoke(Invokes.CommandName, args)`; add new commands to the `Invokes` enum first (`tauri-bridge`). Never pass a raw command string.
- All user-facing JSX text goes through `t()` from `react-i18next` — eslint-plugin-i18next warns on literals. Add keys then run `npm run i18n:extract`.
- Right-panel ids are the `Panel` enum, never raw strings. Tab labels in `RightPanelSwitcher` are i18n keys (`editor.switcher.tooltips.*`).
- `Resizer` takes an `onMouseDown` prop but internally binds `onPointerDown` — always feed it `createResizeHandler(...)`, not a real mouse handler.
- Use refs (not state) for per-frame/async values that must not re-render (`previewJobIdRef`, `selectedImagePathRef`, `prevAdjustmentsRef`).
- Layout transitions are Tailwind `transition-all duration-300`; suppress them during drags/instant moves via `isResizing` / `isInstantTransition`.

## Gotchas
- View switch is purely `selectedImage` truthiness. `handleBackToLibrary` clears it; editor `adjustments`/history are NOT auto-cleared on switch.
- `RIGHT_PANEL_ORDER` in `useUIStore.ts` (line 4) only sets slide direction. The actual visible tabs + their order live in `RightPanelSwitcher.tsx`'s grouped arrays — adding a `Panel` value alone shows no tab.
- `renderedRightPanel` (not `activeRightPanel`) keys the panel content in `EditorView`, so the panel stays mounted through its exit animation while `activeRightPanel` can already be null.
- TitleBar visibility is gated by `appSettings.decorations` / `isWindowFullScreen` (App.tsx ~line 629) and returns `null` on Android — don't put always-on chrome there. TitleBar is icon-only (no `t()` strings).
- `isCompactPortrait` (viewport <= 900px wide && portrait) flips EditorView to a vertical stack with a separate `'compact'` Resizer and a dynamic height from `getDynamicCompactPanelHeight` (App.tsx:216).
- Event names from older notes (`image-metadata-updated`, `album-updated`, `folder-tree-changed`, `image-moved`) do NOT exist — verify against `useTauriListeners.ts` before relying on any event.
- `useAppInitialization` runs once on mount; structural settings (e.g. language) may need a reload to fully apply.

## How to add a new right-side panel
1. Add the id to the `Panel` enum in `src/components/ui/AppProperties.tsx` (e.g. `History = 'history'`).
2. Build the panel component under `src/components/panel/right/` (use `t()` for all strings, `useShallow` selectors).
3. In `src/components/views/EditorView.tsx`: import it and add `{renderedRightPanel === Panel.History && <HistoryPanel />}` inside `editorRightPanelContent`'s `motion.div`.
4. In `src/components/panel/right/RightPanelSwitcher.tsx`: add `{ id: Panel.History, icon: SomeLucideIcon, title: 'editor.switcher.tooltips.history' }` to the appropriate group array — this is what makes the tab button appear.
5. Add `editor.switcher.tooltips.history` (and any panel strings) to `src/i18n/locales/en.json`; run `npm run i18n:extract`.
6. Add `Panel.History` to `RIGHT_PANEL_ORDER` in `src/store/useUIStore.ts` so slide direction is correct.
7. If activating the panel needs side effects, extend `handleRightPanelSelect` in `App.tsx`. If it needs backend data, add the command to `Invokes` and `invoke(Invokes.X)` (see `tauri-bridge`); if it needs a modal, add state to `useUIStore` + render it in `AppModals.tsx` (see `modals`).
8. For a brand-new full *view* (not a right panel), branch in `App.tsx` near line 641 alongside the `EditorView`/`LibraryView` switch, gated on the relevant store flag (e.g. `activeView`).

## Related skills
`state-stores`, `hooks`, `editor-canvas`, `adjustments-ui`, `library-ui`, `modals`, `ui-primitives`, `tauri-bridge`, `i18n`, `backend`, `create-feature`

## After changes
- `npm run typecheck` (tsc --noEmit, strict) and `npm run lint` (eslint).
- `npm run format` (prettier: 120 cols, single quotes, semicolons).
- If you added/changed UI strings: `npm run i18n:extract` then `npm run i18n:check`.
- For a user-visible change, add a release note per the `changelog` skill.
