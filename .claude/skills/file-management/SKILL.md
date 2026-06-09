---
name: file-management
description: Use this skill before modifying the library/file backbone in src-tauri/src/file_management.rs, image_loader.rs, or cache_utils.rs — folder indexing (walkdir), thumbnail generation + on-disk cache (blake3 keys), .rrdata/.rrexif sidecars, copy/move/rename/duplicate/trash, virtual copies (?vc=ID), ratings/color labels/tags, albums, import, and the thumbnail/import event streams. Trigger whenever the user asks to add, fix, or change a file or library operation, thumbnails, the folder tree, image listing/indexing, sidecar persistence, virtual copies, albums, or import.
---

# File & Library Management Skill

The Rust backbone for everything that touches disk: folder tree indexing, thumbnail generation + caching, `.rrdata` sidecar I/O, file ops (copy/move/rename/duplicate/trash/import), virtual copies, and albums. Lives in `src-tauri/src/`.

## Key files
| path | responsibility |
| --- | --- |
| `src-tauri/src/file_management.rs` | ~3.6k lines: folder tree, thumbnails + cache, sidecar I/O, copy/move/rename/duplicate/delete/import, albums, presets, XMP sync, virtual copies |
| `src-tauri/src/image_loader.rs` | Image decode/load: `load_image`, `load_base_image_from_bytes`, orientation, `composite_patches_on_image`, decoded-image caching |
| `src-tauri/src/cache_utils.rs` | In-memory caches + geometry/visual/transform hashes; `DecodedImageCache` LRU |
| `src-tauri/src/app_state.rs` | `AppState`, `ThumbnailManager` (queue/cvar/processing set), `ThumbnailProgressTracker` |
| `src-tauri/src/image_processing.rs` | `ImageMetadata` struct (the `.rrdata` payload), `Adjustments` types |
| `src-tauri/src/lib.rs` | Registers all `#[tauri::command]`s; holds `AppState` fields |
| `src/components/ui/AppProperties.tsx` | `Invokes` enum — frontend name for each command |
| `src/hooks/useTauriListeners.ts` | Subscribes to `thumbnail-*`, `import-*`, `indexing-*` events |

## How it works
- **Folder tree:** `get_folder_tree` / `get_folder_children` → `scan_dir_lazy` builds a `FolderNode` tree (`name, path, children, is_dir, image_count, has_subdirs`). Children load lazily based on the `expanded_folders` set; `show_image_counts=true` walks the full subtree (expensive).
- **Listing:** `list_images_in_dir` (single-level, `fs::read_dir`) and `list_images_recursive` (`WalkDir`) emit `ImageFile` rows. They match `.rrdata` sidecars to source images, parse virtual-copy IDs, and load metadata in parallel via rayon. Optional XMP merge when the `enable_xmp_sync` setting is on.
- **Thumbnails:** frontend calls `update_thumbnail_queue(paths)` → pushes onto `ThumbnailManager.queue` (`VecDeque`, capped at 500, LIFO via `pop_back`). `start_thumbnail_workers` spawns `thumbnail_worker_threads` (default 4, clamped 1..16) threads that wait on the `Condvar`, generate, and emit `thumbnail-generated` per image plus `thumbnail-progress` / `thumbnail-generation-complete`. Cache file is `{blake3(path, mtime, adjustments)}.jpg` in `app_cache_dir/thumbnails/`.
- **Image load:** `load_image` → `read_file_mapped` (memmap2, falls back to `fs::read`) → `load_base_image_from_bytes` (`develop_raw_image` for RAW, `image` crate otherwise) → `composite_patches_on_image` → caches into `decoded_image_cache` + `original_image`.
- **Sidecars:** `ImageMetadata` (`version, rating, adjustments, tags, exif, ...`) is JSON in `image.ext.rrdata`. `save_metadata_and_update_thumbnail` writes it, optionally syncs XMP, and regenerates the thumbnail with `force_regenerate=true`. Embedded EXIF lives in `image.ext.rrexif` (owned by `metadata-exif`).
- Connects to `gpu-shaders` (thumbnails use the GPU when adjustments exist), `image-pipeline` (decode/develop), `metadata-exif` (`.rrexif`, EXIF reads), and `presets`. Background indexing (`start_background_indexing`, `indexing-*` events) lives in `tagging.rs`, not here.

## Key types & symbols
| symbol | kind | what |
| --- | --- | --- |
| `parse_virtual_path` | fn | `&str → (PathBuf source, PathBuf sidecar)`. Splits on `?vc=`; sidecar is `name.ext.rrdata` or `name.ext.{id}.rrdata` |
| `FolderNode` | struct | folder-tree node returned to the frontend |
| `ImageFile` | struct | per-image listing row (path, modified, is_edited, rating, tags, exif, is_virtual_copy) |
| `ThumbnailManager` | struct (`app_state.rs`) | `queue: Mutex<VecDeque<String>>`, `cvar`, `processing_now: Mutex<HashSet<String>>` |
| `compute_thumbnail_cache_hash` | fn | blake3 of (path_str, source mtime secs, adjustments bytes) → hex; `None` if mtime missing → cache skipped |
| `generate_single_thumbnail_and_cache` | fn | returns `(data:image/jpeg;base64, rating, is_edited)` |
| `find_all_associated_files` | fn | source image + `.rrexif` + all `name.ext*.rrdata` (incl. virtual copies) |
| `DecodedImageCache` | struct (`cache_utils.rs`) | LRU `Vec<(path, Arc<DynamicImage>, exif)>`; `get` promotes, `insert` evicts front |
| `get_folder_tree` / `get_folder_children` | command | lazy folder tree |
| `list_images_in_dir` / `list_images_recursive` | command | image listing |
| `update_thumbnail_queue` | command | replace/extend thumbnail queue |
| `save_metadata_and_update_thumbnail` / `load_metadata` | command | sidecar write / read |
| `copy_files` / `move_files` / `rename_files` / `duplicate_file` | command | file ops (preserve sidecars) |
| `delete_files_from_disk` / `delete_files_with_associated` | command | trash via `trash` crate, `fs::remove_file` fallback |
| `create_virtual_copy` | command | `Uuid::new_v4()[..6]` ID, copies `.rrdata`, returns `path?vc=ID` |
| `import_files` | command | bulk import with date-folder / filename-template / delete-after options |
| `get_albums` / `save_albums` / `add_to_album` / `get_album_images` | command | albums (JSON file of virtual paths) |

## Conventions (follow these when coding here)
- Always resolve a path through `parse_virtual_path` first; never assume a path is a plain file — it may carry `?vc=ID`.
- Sidecar naming is load-bearing: `image.ext.rrdata` (original), `image.ext.{6-hex-id}.rrdata` (virtual copy), `image.ext.rrexif` (EXIF). Do not invent other suffixes.
- Commands return `Result<T, String>` (not `anyhow`); convert with `.map_err(|e| e.to_string())`.
- Paths cross the JSON boundary as `to_string_lossy()` strings; `PathBuf` internally. JSON keys are camelCase (the `ImageMetadata`/`Adjustments` contract).
- File ops must carry associated sidecars: use `find_all_associated_files` (delete) or the per-op `.rrdata`/`.rrexif` copy logic (copy/move).
- Adding a command means three edits: the `fn` here, a variant in the `Invokes` enum (`AppProperties.tsx`), and registration in the `invoke_handler!` list in `lib.rs`.

## Gotchas
- The recent infinite-index-loop fix was in the **frontend** (`src/hooks/useAppNavigation.ts`) — `StartBackgroundIndexing` is now guarded by `!preserveEditor`. It was not a backend change; don't "fix" it again in Rust.
- Thumbnail cache key includes source-file **mtime**: touching a file (without changing adjustments) regenerates its thumbnail. If mtime is unavailable, `compute_thumbnail_cache_hash` returns `None` and caching is skipped entirely.
- Workers pull with `pop_back` (LIFO) and skip paths already in `processing_now`. `start_thumbnail_workers` spawns threads with no idempotence guard — calling it twice accumulates worker threads.
- `update_thumbnail_queue([])` (empty) clears the queue and resets the progress tracker — it is the cancel path, not a no-op.
- `create_virtual_copy` uses only the first 6 hex chars of a UUID; collisions are unlikely but possible. Virtual copies share the source image; only the `.rrdata` differs.
- `delete_files_from_disk`: a `?vc=` path deletes only that sidecar; a plain path takes all associated files. It trashes via the `trash` crate and falls back to permanent `fs::remove_file`.
- `WalkDir` follows symlinks and does not guard cycles; deep trees with `show_image_counts=true` are slow (single-threaded scan).
- `move_files` calls `sync_album_path_changes`; if you add an op that moves/renames files, update album references too or you orphan album entries.
- Thumbnails fall back to a fast (low-quality) CPU demosaic when the GPU context is `None`.

## How to add a new file/library operation command
1. Write `#[tauri::command] pub fn my_op(paths: Vec<String>, app_handle: AppHandle) -> Result<T, String>` in `file_management.rs`.
2. Resolve each input with `let (source, sidecar) = parse_virtual_path(&p);` and branch on virtual copies (operate on the sidecar only when `?vc=` is present).
3. Carry associated metadata: reuse `find_all_associated_files` (or the copy/move sidecar logic) so `.rrdata` and `.rrexif` follow the image.
4. If you move/rename/delete real files, call `sync_album_path_changes(&app_handle, ...)` to keep albums consistent.
5. If the operation changes pixels or adjustments, refresh thumbnails: call `add_to_thumbnail_queue` or spawn a thread running `generate_single_thumbnail_and_cache(..., force_regenerate=true)`, then `emit("thumbnail-generated", ...)`.
6. Emit a completion/progress event (e.g. `app_handle.emit("my-op-complete", ...)`) and subscribe to it in `src/hooks/useTauriListeners.ts`.
7. Register it: add `my_op` to the `invoke_handler!` list in `lib.rs`, add a variant to the `Invokes` enum in `src/components/ui/AppProperties.tsx`, and call it with `invoke(Invokes.MyOp, { ... })`.
8. Test with a virtual-copy path (`...?vc=abc123`) to confirm the sidecar-only branch behaves.

## Related skills
`image-pipeline`, `gpu-shaders`, `metadata-exif`, `presets`, `state-stores`, `hooks`, `tauri-bridge`, `library-ui`

## After changes
- Rust: `cargo fmt` and `cargo clippy` (run inside `src-tauri/`).
- TS wiring: `npm run typecheck` and `npm run lint`.
- New user-facing strings: `npm run i18n:extract` then `npm run i18n:check` (use `t()`, no literals).
- Write a changelog entry per the `changelog` skill.
