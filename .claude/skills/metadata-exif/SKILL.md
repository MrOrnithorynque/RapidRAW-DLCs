---
name: metadata-exif
description: Use this skill before modifying EXIF/metadata reading, caching, display, editing, or export-preservation in RapidRAW — covers src-tauri/src/exif_processing.rs (kamadak-exif + rawler reads, little_exif writes, .rrdata sidecar caching, GPS, strip-gps), the load_metadata/update_exif_fields Tauri commands in file_management.rs, XMP sync, and the frontend MetadataPanel.tsx. Trigger whenever the user asks to read, show, cache, edit, write, preserve, or strip EXIF/metadata, add an editable metadata field (Author/Copyright/Title/Comments), handle GPS coordinates, or sync rating/tags to XMP sidecars.
---

# Metadata / EXIF Skill

This module reads, caches, displays, edits, and writes EXIF metadata for both RAW and standard image formats. Core logic lives in `src-tauri/src/exif_processing.rs`; the editable UI is `src/components/panel/right/MetadataPanel.tsx`.

## Key files

| path | responsibility |
| --- | --- |
| `src-tauri/src/exif_processing.rs` | All EXIF read/write/format logic: `read_exif_data`, `extract_metadata` (RAW), `read_exif` (standard), `write_image_with_metadata` (export), sidecar load/save, date/GPS formatting, truncation |
| `src-tauri/src/file_management.rs` | Tauri commands `update_exif_fields`, `load_metadata`; XMP sync `sync_metadata_from_xmp` / `sync_metadata_to_xmp` |
| `src-tauri/src/image_loader.rs` | Calls `persist_exif_if_missing` + `read_exif_data` during load; returns `exif: HashMap<String,String>` in `LoadImageResult` |
| `src-tauri/src/image_processing.rs` | `ImageMetadata` struct (version, rating, adjustments, tags, `exif: Option<HashMap<String,String>>`) persisted in `.rrdata` |
| `src-tauri/src/cache_utils.rs` | `DecodedImageCache`: LRU `Vec<(String, Arc<DynamicImage>, HashMap<String,String>)>` caching image + EXIF together |
| `src-tauri/src/export_processing.rs` | Calls `write_image_with_metadata(..., keep_metadata, strip_gps)` from `ExportSettings` |
| `src-tauri/src/formats.rs` | `is_raw_file(path)` — selects RAW vs standard read path |
| `src/components/panel/right/MetadataPanel.tsx` | Displays `selectedImage.exif`; editable Author/Copyright/Title/Comments; GPS map; camera-settings grid |
| `src/hooks/useLibraryActions.ts` | `handleUpdateExif` -> `invoke(Invokes.UpdateExifFields, { paths, updates })` |
| `src/components/ui/AppProperties.tsx` | `Invokes.LoadMetadata`/`Invokes.UpdateExifFields` enum + `SelectedImage` type |

## How it works

- Read path (load): `image_loader` calls `persist_exif_if_missing` then `read_exif_data(path, bytes)`. `read_exif_data` returns the `.rrdata` sidecar's `exif` map if present (`read_rrexif_sidecar`); otherwise it reads from bytes via `read_exif_data_from_bytes` — RAW files go through `extract_metadata` (rawler `RawMetadata`), standard formats through `read_exif` (kamadak-exif, iterating `exif.fields()`) — and persists the result back into `.rrdata`. The map plus decoded `Arc<DynamicImage>` are cached in `DecodedImageCache`, then returned as `LoadImageResult.exif` and surfaced as `SelectedImage.exif` in the frontend.
- Edit path: `MetadataPanel` editable fields call `handleUpdateExif` (in `useLibraryActions`) -> `invoke(Invokes.UpdateExifFields)` -> `update_exif_fields` (async, `spawn_blocking`, `par_iter` over paths) loads each `.rrdata`, mutates the `exif` map (empty/trimmed value = remove key), rewrites the sidecar. No file pixels are touched.
- Write path (export, see `export`): `write_image_with_metadata` reads from a cascade (sidecar -> file bytes -> RAW decoder, first success wins), maps keys to `little_exif` `ExifTag`s, optionally strips GPS, stamps `Software="RapidRAW"`, `Orientation=1`, `ColorSpace=1`, and writes into the output bytes.
- XMP sync (optional, `enable_xmp_sync` setting): `sync_metadata_from_xmp` reads `xmp:Rating`/`xmp:Label`/`dc:subject` from a `.xmp`/`.XMP` sidecar into `ImageMetadata`; `sync_metadata_to_xmp` writes rating + tags back. Syncs ONLY rating and tags — never the EXIF map.

Connects to `image-pipeline`/`file-management` (load), `export` (preservation/strip), `state-stores` (`selectedImage`), `tauri-bridge` (commands).

## Key types & symbols

| symbol | kind | what |
| --- | --- | --- |
| `read_exif_data(path, bytes)` | fn | Sidecar-first read; caches result into `.rrdata`; returns `HashMap<String,String>` |
| `read_exif_data_from_bytes` | fn | RAW -> `extract_metadata`; standard -> `read_exif`; no caching |
| `extract_metadata(bytes)` | fn | RAW EXIF via rawler into the map (camera, lens, exposure, dates, GPS) |
| `write_image_with_metadata(bytes, path, format, keep_metadata, strip_gps)` | fn | Embeds EXIF into export output via `little_exif` |
| `read_rrexif_sidecar` / `load_sidecar` / `load_primary_metadata` | fn | Load `.rrdata`; legacy `.rrexif` auto-migrates |
| `get_primary_sidecar_path(path)` | fn | `<image>.rrdata` path |
| `persist_exif_if_missing` | fn | Caches EXIF into `.rrdata` on first load |
| `truncate_large_exif(value)` | fn | Truncates values > 500 chars (UTF-8 safe) |
| `update_exif_fields` | `#[tauri::command]` | `Vec<String> paths`, `HashMap<String,String> updates`; mutates sidecars in parallel |
| `load_metadata` | `#[tauri::command]` | Returns `ImageMetadata`; runs XMP sync if enabled |
| `Invokes.UpdateExifFields` / `Invokes.LoadMetadata` | TS enum | `'update_exif_fields'` / `'load_metadata'` |
| `EDITABLE_FIELDS` | TS const | `ImageDescription`(title), `Artist`(author), `Copyright`, `UserComment`(comments) |
| `KEY_CAMERA_SETTINGS_MAP` | TS const | Display formatting for FNumber/ExposureTime/PhotographicSensitivity/FocalLengthIn35mmFilm/LensModel |

## Conventions (follow these when coding here)

- EXIF map keys are PascalCase TIFF/EXIF tag names (`Make`, `Model`, `FNumber`, `ExposureTime`, `LensModel`, `DateTimeOriginal`, `GPSLatitude`, ...). Values are display-formatted strings (e.g. `f/2.8`, `1/100 s`, `50 mm`).
- In `extract_metadata`, only add via the local `insert_if_present(key, val)` closure (it trims + truncates). Use the local `fmt_rat`/`fmt_srat`/`fmt_gps_coord` closures for rational values.
- Always go through `get_primary_sidecar_path` for sidecar paths; never hand-build `.rrdata` strings.
- Long values must pass through `truncate_large_exif` (>500 chars -> first 200 + `...` + last 200).
- On export, rational fields live in two representations: formatted string in the map (display) and `uR64`/`iR64` in `little_exif` (write). Keep both in sync when adding a rational field.
- New user-facing JSX strings must use `t()` (under `editor.metadata.*`); add keys via `npm run i18n:extract`.

## Gotchas

- `read_exif_data` ALWAYS caches into `.rrdata`. If a file's EXIF is changed by an external tool, the stale sidecar wins until it is cleared — clearing `DecodedImageCache` does NOT clear sidecars.
- `write_image_with_metadata` early-returns `Ok(())` (no-op) when `keep_metadata=false`, when `output_format=="tiff"`, or when the SOURCE is `.tif`/`.tiff` (TIFF write is stubbed, FIXME). Don't assume metadata was written.
- `strip_gps` is only honored on the file-bytes and RAW read branches. The sidecar (`.rrdata`) read branch writes NO GPS tags at all, so exporting from a sidecar source already omits GPS regardless of the flag.
- The export source cascade is silent: if sidecar/file/RAW all fail, the output simply has no EXIF — no error is returned.
- RAW GPS coords are formatted as `"<deg> deg <min> min <sec> sec"`; kamadak (standard formats) uses its own `display_value().with_unit()` string. Frontend `parseDms` regex-extracts the three numbers either way.
- rawler `RawMetadata` field names differ from EXIF tag names (e.g. `date_time_original` vs `DateTimeOriginal`); map them explicitly in `extract_metadata`.
- `update_exif_fields` treats an empty/whitespace value as "remove this key", not "set to blank".
- Virtual copies (`path?vc=...`) share the original's `.rrdata` sidecar (panel strips `?vc=`), so editing one VC's metadata edits all of them.
- XMP sync touches ONLY `rating` and `tags`, never the EXIF map — don't try to round-trip EXIF through XMP.

## How to expose a new metadata field end-to-end (e.g. `FirmwareVersion`)

1. RAW read — in `extract_metadata` (`src-tauri/src/exif_processing.rs`), pull the value from `RawMetadata` (if available) and add `insert_if_present("FirmwareVersion", value)`.
2. Standard read — in `read_exif_data_from_bytes` the generic `exif.fields()` loop already captures any kamadak tag by name; only add a dedicated `match` arm if you need custom formatting (mirror the `ExposureTime`/`FNumber` arms in `extract_metadata`).
3. Export write — in `write_image_with_metadata`, in the sidecar branch (and the file/RAW branches if relevant) add `if let Some(v) = map.get("FirmwareVersion") { metadata.set_tag(ExifTag::FirmwareVersion(clean_s(v))); }`. For a rational field, parse with the existing `parse_ur64`/`to_ur64` helpers.
4. Display — in `MetadataPanel.tsx`, if camera-related add the key to `cameraGridKeys` + `KEY_CAMERA_SETTINGS_MAP`; otherwise it auto-renders in the extended-EXIF grid (anything not in `handledKeys`).
5. Editable — if user-editable, add `{ key: 'FirmwareVersion', label: '<i18nLabel>' }` to `EDITABLE_FIELDS`; the existing Author section wires `onSave -> handleUpdateExif(targetPaths, { [key]: newVal })` -> `update_exif_fields`. Add the i18n label under `editor.metadata.*`.
6. Verify: load an image with the field, confirm it shows; edit it and reload; export with `keep_metadata=true` and re-read the output to confirm preservation.

## Related skills

`image-pipeline`, `file-management`, `export`, `state-stores`, `library-ui`, `tauri-bridge`, `i18n`, `changelog`

## After changes

- Rust: `cargo fmt` + `cargo clippy` (inside `src-tauri/`).
- TS: `npm run typecheck` + `npm run lint`; if you added UI strings run `npm run i18n:extract` and `npm run i18n:check`.
- Write a changelog entry per the `changelog` skill.
