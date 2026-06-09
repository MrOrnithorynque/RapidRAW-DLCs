---
name: library-ui
description: Use this skill before modifying the library browsing UI in src/components/panel/ (MainLibrary, FolderTree, Filmstrip, BottomBar, CommunityPage, library/LibraryGrid+LibraryItems+LibraryHeader) and the src/hooks/useSortedLibrary.ts + useThumbnails.ts hooks. Covers the virtualized grid/list/filmstrip (react-window), folder tree, multi-select, rating/flag/color-label filters, sort criteria, advanced search queries, EXIF overlays, VC badges, and lazy thumbnail requests. Trigger whenever the user asks to add/change/debug a library sort option, filter, search query field, thumbnail badge/overlay, view mode, folder tree behavior, filmstrip, or thumbnail queueing.
---

# Library Browsing UI Skill

The library is RapidRAW's photo-browsing surface: a left folder tree, a virtualized grid/list/filmstrip of thumbnails, and the search/filter/sort controls. It lives in `src/components/panel/` (+ `panel/library/`) with logic in `src/hooks/` and state in `useLibraryStore`.

## Key files
| path | responsibility |
| --- | --- |
| `src/components/panel/MainLibrary.tsx` | Root container; splash, header, builds `translatedSortOptions`/filter option arrays, renders `LibraryGrid` |
| `src/components/panel/library/LibraryGrid.tsx` | Virtualized `react-window` `List`; flat vs recursive layout, `groupImagesByFolder`, column count, scroll persistence, local 50ms thumbnail batch |
| `src/components/panel/library/LibraryItems.tsx` | `Row`, `Thumbnail`, `ListItem` (memoized); EXIF overlay, edit icon, color dot, rating, `VC` badge, fade-in |
| `src/components/panel/library/LibraryHeader.tsx` | `SearchInput` (advanced query tags, AND/OR) + `ViewOptionsDropdown` (sizes, aspect, view mode, overlay, filters, sort) |
| `src/components/panel/FolderTree.tsx` | Left sidebar tree: pinned / albums / current sections, search auto-expand, image counts, custom icons |
| `src/components/panel/Filmstrip.tsx` | Horizontal 1-row `react-window` Grid (editor mode); `onCellsRendered` queues thumbs, scroll-centers active image |
| `src/components/panel/BottomBar.tsx` | `StarRating`, copy/paste, multi-select count, zoom, filmstrip toggle; embeds `Filmstrip` |
| `src/components/panel/CommunityPage.tsx` | Community presets grid (uses `fetch_community_presets`/`generate_all_community_previews`) |
| `src/hooks/useSortedLibrary.ts` | `computeSortedLibrary` (pure) + `useSortedLibrary` hook: filter → search → sort |
| `src/hooks/useThumbnails.ts` | `requestThumbnails`/`markGenerated`/`clearThumbnailQueue`; debounces + shuffles + invokes `update_thumbnail_queue` |
| `src/store/useLibraryStore.ts` | `imageList`, `imageRatings`, `filterCriteria`, `searchCriteria`, `sortCriteria`, selection, folder/album trees, `listColumnWidths` |
| `src/components/ui/AppProperties.tsx` | `ImageFile`, `FilterCriteria`, `SortCriteria`, enums `RawStatus`/`EditedStatus`/`SortDirection`/`ThumbnailSize`/`LibraryViewMode`/`ExifOverlay`/`ThumbnailAspectRatio` |

## How it works
- **Data in**: `useThumbnails()` is instantiated once in `src/App.tsx`; its `requestThumbnails`/`clearThumbnailQueue`/`markGenerated` flow down as props (`onRequestThumbnails`) through `LibraryView`/`EditorView` → `MainLibrary` → `LibraryGrid`. The store's `imageList`/`imageRatings`/`filterCriteria`/`searchCriteria`/`sortCriteria` come from `file-management` backend loads.
- **Filter/sort**: `useSortedLibrary()` reads the store + `useSettingsStore` (`supportedTypes`, `appSettings`) and calls the pure `computeSortedLibrary(libraryState, settingsState)`. Pipeline: optional `RawStatus.RawOverNonRaw` dedup pass → `filter()` (rating / rawStatus / editedStatus / colors) → search (`parsedTags` + free text, AND/OR) → stable `sort()` by one of 9 keys.
- **Render**: `LibraryGrid` virtualizes the sorted list into rows via `react-window` `List`; the `Row`/`Thumbnail`/`ListItem` components read `useProcessStore.thumbnails[path]` (base64 data URL) and fade in.
- **Two-stage thumbnail queue**: `LibraryGrid.queueThumbnailRequest` batches paths in a local 50ms `setTimeout`, then calls `onRequestThumbnails`; `useThumbnails` re-debounces (150ms, `maxWait` 300ms), Fisher-Yates shuffles, and `invoke('update_thumbnail_queue', { paths })`. Backend (`file-management`) generates and pushes thumbnails to `useProcessStore`.
- Connects to: `state-stores` (`useLibraryStore`/`useProcessStore`/`useSettingsStore`), `hooks` (`useThumbnails`/`useSortedLibrary`), `file-management` (backend listing/thumbnails/ratings), `metadata-exif` (`image.exif` overlays), `presets` (CommunityPage), `editor-canvas` (Filmstrip in editor).

## Key types & symbols
- `computeSortedLibrary(libraryState, settingsState): ImageFile[]` — pure filter+search+sort fn (keep it hook-free).
- `useSortedLibrary()` — memoized hook wrapping the above.
- `ADVANCED_QUERY_REGEX` — `/^(iso|aperture|f|shutter|s|focal|mm|rating|color|camera|make|model|lens)\s*(?::)?\s*(>=|<=|>|<|=)?\s*(.+)$/i`; `evaluateQuery` parses field/operator/value.
- `useThumbnails()` → `{ requestThumbnails, clearThumbnailQueue, markGenerated }`; only the raw string `'update_thumbnail_queue'` is invoked (NOT via the `Invokes` enum).
- `FilterCriteria` = `{ colors: string[]; rating: number; rawStatus: RawStatus; editedStatus?: EditedStatus }`.
- `SortCriteria` = `{ key: string; order: string }`; sort keys: `name`, `date`, `rating`, `date_taken`, `focal_length`, `iso`, `shutter_speed`, `aperture`, `edited`.
- `ImageFile` = `{ is_edited, modified, path, rating, tags: string[]|null, exif: Record<string,string>|null, is_virtual_copy }`.
- Enums: `RawStatus` (All/RawOnly/NonRawOnly/RawOverNonRaw), `EditedStatus` (const obj: All/EditedOnly/UneditedOnly), `SortDirection` (`asc`/`desc`), `ThumbnailSize` (Small/Medium/Large/List), `LibraryViewMode` (Flat/Recursive), `ExifOverlay` (Off/Hover/Always), `ThumbnailAspectRatio` (Cover/Contain).
- Store actions: `setLibrary`, `setFilterCriteria`, `setSortCriteria`, `setSearchCriteria` — each accepts a partial OR an updater fn.
- Relevant `Invokes`: `ListImagesInDir`, `GetFolderTree`, `GetAlbums`, `ReadExifForPaths`, `SetRatingForPaths`, `SetColorLabelForPaths`, `GenerateThumbnailsProgressive`.

## Conventions (follow these when coding here)
- Keep `computeSortedLibrary` **pure** — no hooks, no store reads inside it; it takes `libraryState`/`settingsState` so it can be reused/tested.
- All `react-window` cell components (`Row`, `Thumbnail`, `ListItem`) are memoized — pass updated `imageList`/`activePath`/`multiSelectedPaths` through `rowProps`/`memoizedRowProps`, never mutate.
- Never block render on thumbnail load: queue via `queueThumbnailRequest(path)` and fade in from `useProcessStore.thumbnails`.
- Color labels are stored as a tag string `color:<name>`; read via `tags.find(t => t.startsWith('color:'))?.substring(6)`. The filter value `'none'` matches images with no color tag.
- Virtual-copy paths carry a `?vc=N` suffix — strip with `path.split('?vc=')[0]` before extension/filename logic; always show the `VC` badge.
- New user-facing strings use `t()` (react-i18next); sort/filter labels live in `translatedSortOptions`/option arrays in `MainLibrary.tsx`.
- EXIF overlay visibility is driven by `appSettings.exifOverlay` (`Off`/`Hover`/`Always`), read inside `LibraryItems`.

## Gotchas
- **Rating filter semantics**: `0` = no filter, `-1` = unrated only, `5` = exactly 5 stars, `1–4` = that-or-higher. Clicking a selected star toggles back to `0`.
- **Two debounce layers** for thumbnails: `LibraryGrid`'s 50ms `setTimeout` AND `useThumbnails`'s 150ms/300ms lodash debounce. Changing one won't fix a perceived lag in the other.
- `RawStatus.RawOverNonRaw` runs an O(n) preprocessing pass building a `rawBaseNames` Set keyed by `parentDir/baseName`; large folders can stall it.
- ISO reads `exif.PhotographicSensitivity` then falls back to `exif.ISOSpeedRatings`; aperture/focal/shutter use the `parseAperture`/`parseFocalLength`/`parseShutter` helpers — reuse them, don't reparse inline.
- Search `tags` and free `text` are separate (`searchCriteria.tags[]` vs `.text`); typing text does NOT auto-create a tag (Enter/comma does in `SearchInput`). Default search `mode` is `'OR'`.
- `SortDirection` is the string enum `'asc'`/`'desc'` — compare against `SortDirection.Ascending`, never a boolean.
- Recursive view uses `groupImagesByFolder(imageList, currentFolderPath)` and a separate `collapsedRecursiveFolders` Set (distinct from the folder tree's expand state).
- Sort is stable: ties (when `key !== 'name'`) break by filename `localeCompare`, so adding a key without a tie-break path can reorder unexpectedly.

## How to add a library sort / filter / badge
1. **New sort key**: add a `case` to the `switch (key)` in `computeSortedLibrary` (`useSortedLibrary.ts`), extracting the value (reuse `parseAperture`/`parseFocalLength`/`parseShutter` or `image.exif?.X`) and setting `comparison`. Then add `{ key, label: t('library.sort.<x>') }` to `translatedSortOptions` in `MainLibrary.tsx`; it's passed to `ViewOptionsDropdown` `sortOptions`. Add the i18n key.
2. **New filter**: add the field to `FilterCriteria` in `AppProperties.tsx` and its default in `useLibraryStore` `filterCriteria`. Add the predicate to the `processedList.filter(...)` block in `computeSortedLibrary`. Add the UI control in `ViewOptionsDropdown` (`LibraryHeader.tsx`) calling `setFilterCriteria(prev => ({ ...prev, <field>: ... }))`. Pass any option array down from `MainLibrary.tsx`.
3. **New advanced query field**: extend the alternation in `ADVANCED_QUERY_REGEX`, then add a branch in `evaluateQuery` (numeric → push to the numeric `includes([...])` list + operator switch; string → an `imgStr` branch). Test both AND and OR modes.
4. **New thumbnail badge/overlay**: in `LibraryItems.tsx`, add the property check, include it in `hasAnyOverlay`, and render the badge near the existing edit/color/rating/`VC` markers with the same opacity/scale transition classes. Mirror in `ListItem` if it should show in list view.
5. **New view mode**: add the enum value to `LibraryViewMode`, branch in `LibraryGrid`'s `gridData` build (after the `Recursive` check) to construct `rows`, and add a radio in the `ViewOptionsDropdown` display-mode section.

## Related skills
`state-stores`, `hooks`, `file-management`, `metadata-exif`, `presets`, `editor-canvas`, `frontend`

## After changes
- Run `npm run typecheck` and `npm run lint`; format with `npm run format`.
- If you added UI strings, run `npm run i18n:extract` and `npm run i18n:check` so all 10 locales stay in sync.
- No Rust changes here unless you added a new backend command (then see `file-management`/`backend`).
- If the change is user-visible (new sort/filter/badge/view mode), add a changelog entry per the `changelog` skill (AppStream `<release>` in `data/io.github.CyberTimon.RapidRAW.metainfo.xml`).
