---
name: tauri-bridge
description: Use this skill when adding, changing, or debugging any frontend<->backend command or event in RapidRAW — the Invokes enum in src/components/ui/AppProperties.tsx, invoke() callers, the #[tauri::command] list in src-tauri/src/lib.rs, app_handle.emit() events, the listen() subscriptions in src/hooks/useTauriListeners.ts, and the console log bridge in src/utils/frontendLogBridge.ts. Covers camelCase<->snake_case serde arg mapping, Result<T,String> rejection handling, binary Response returns, and event payload shapes. Trigger whenever the user asks to add/register/rename a Tauri command, wire a backend->frontend event, fix a "command not found"/silent-event bug, debug invoke rejections, or change the IPC contract between src/ and src-tauri/.
---

# Tauri Bridge Skill

The frontend<->backend IPC contract: how React (`src/`) calls Rust (`src-tauri/`) over Tauri v2 commands, and how Rust streams progress back via events. The wiring lives in a handful of central files.

## Key files

| path | responsibility |
| --- | --- |
| `src/components/ui/AppProperties.tsx` | The `Invokes` enum (UPPER_CAMEL variant -> snake_case string) plus shared TS types (`Progress`, `AppSettings`, `SelectedImage`). |
| `src-tauri/src/lib.rs` | `tauri::generate_handler![...]` registers all **97** commands (~line 2222); also defines `frontend_log`, `frontend_ready`, `apply_adjustments`, and most `app_handle.emit(...)` calls. |
| `src/hooks/useTauriListeners.ts` | One hook that `listen()`s to ~30 backend events and batches them into Zustand stores. |
| `src/utils/frontendLogBridge.ts` | Intercepts `console.*` + window errors, forwards to backend via `invoke(Invokes.FrontendLog, ...)`. Installed once. |
| `src/main.tsx` | Calls `installFrontendLogBridge()` at startup (line 7). |
| `src/hooks/useImageProcessing.ts` | Representative caller: `invoke(Invokes.ApplyAdjustments, { jsAdjustments, isInteractive, ... })`. |
| `src/App.tsx` | Hosts an extra `listen('ai-connector-status-update', ...)` (line 439) outside `useTauriListeners`. |

## How it works

- **Request/response:** Frontend calls `invoke(Invokes.X, args)` (import `{ invoke }` from `@tauri-apps/api/core`). Tauri serializes `args` to JSON, deserializes into the matching `#[tauri::command] fn x(...)` params, runs it, and resolves the returned `Result<T, String>` as a `Promise<T>` (Ok) or **rejects with the bare error string** (Err) — not an `Error` object.
- **Arg name mapping:** Tauri v2 auto-converts JS camelCase keys to Rust snake_case params. `{ jsAdjustments }` (TS) maps to `js_adjustments: Value` (Rust). For struct fields inside a payload, serde on the Rust struct governs the names (most use `#[serde(rename_all = "camelCase")]`); JSON keys are the contract.
- **Binary returns:** Image/preview bytes return `tauri::ipc::Response::new(bytes)` (Rust) and arrive as an `ArrayBuffer` on the frontend (e.g. `apply_adjustments`, `generate_uncropped_preview`). These bypass JSON.
- **Events (backend -> frontend):** Long jobs call `app_handle.emit("event-name", payload)`. The frontend subscribes with `listen('event-name', (e) => ...)` in `useTauriListeners.ts`, reading `e.payload`. Event names are **plain string literals on both sides** — no shared enum, no compile check.
- **Threading / async:** commands are `fn` (sync, blocking on the IPC thread) or `async fn` (driven on Tauri's tokio runtime). Heavy work (preview, export, indexing) is dispatched to dedicated workers/threads that own a `tx`/`rx` channel and emit progress as they go; the originating command returns immediately or awaits a `oneshot`. Shared GPU/cache/worker state lives in `tauri::State<'_, AppState>` (Arc<Mutex<...>>), added as the **last** param and not part of the JS args.
- **Log bridge:** `installFrontendLogBridge()` wraps `console.log/info/warn/error`, dedupes within 1500ms, truncates at 12000 chars, and ships each line to the `frontend_log` command, where Rust's `log`/fern writes it with a `[frontend]` prefix.
- Connects to: `backend` (command registration/AppState), `hooks` (most invoke callers live there), `state-stores` (events land in Zustand), `image-pipeline`/`export`/`file-management`/`ai-features` (own the heavy commands).

## Key types & symbols

| symbol | kind | what |
| --- | --- | --- |
| `Invokes` | TS enum | **78** members; variant = command name. Use `Invokes.X`, not a raw string. |
| `invoke` | fn (`@tauri-apps/api/core`) | `invoke<T>(cmd, args?) => Promise<T>`. |
| `listen` | fn (`@tauri-apps/api/event`) | `listen<T>(event, handler) => Promise<UnlistenFn>`. Always capture & call the unlisten. |
| `Progress` | TS interface | `{ completed?: number; current?: number; total: number }`. |
| `frontend_log` | command | `fn frontend_log(level: String, message: String) -> Result<(), String>`. |
| `apply_adjustments` | command | `async ... -> Result<Response, String>`; returns JPEG bytes as `ArrayBuffer`. |
| `installFrontendLogBridge` | fn | Idempotent (`isInstalled` guard); no-op when `window` is undefined. |
| `useTauriListeners` | hook | Subscribes events, batches thumbnails via `requestAnimationFrame`, cleans up on unmount. |

Key event names (backend -> frontend): `thumbnail-generated`, `thumbnail-progress`, `thumbnail-generation-complete`, `indexing-started/-progress/-finished`, `batch-export-progress`, `export-complete/-error/-cancelled`, `import-start/-progress/-complete/-error`, `denoise-progress/-complete/-error`, `panorama-*`, `hdr-*`, `culling-*`, `ai-model-download-start/-finish`, `preview-update-uncropped`, `histogram-update`, `waveform-update`, `wgpu-frame-ready`, `open-with-file`, `ai-connector-status-update`.

## Conventions (follow these when coding here)

- New commands: prefer adding a `Invokes` variant (UPPER_CAMEL = snake_case) and call `invoke(Invokes.X, ...)` for type-safety. Raw-string invokes work but are unchecked.
- Command name in the enum string, the `#[tauri::command] fn` name, and the entry in `generate_handler![...]` must be **byte-identical** snake_case.
- Always handle rejection: `.catch((err) => ...)` or try/catch; treat `err` as a **string**, not an `Error`.
- Every `listen()` must return its unlisten and be cleaned up (the `listeners.forEach((p) => p.then((unlisten) => unlisten()))` pattern in `useTauriListeners`).
- Payloads must be JSON-serializable (`impl Serialize` / `serde_json::Value`); binary -> `Response::new(bytes)`.
- Cross-module/submodule commands register with their module path: `file_management::load_metadata`, `ai_commands::generate_ai_subject_mask`, etc.

## Gotchas

- **97 registered commands vs 78 `Invokes` members** — they are NOT 1:1. Several commands are only ever called by raw string and have no enum entry: e.g. `preview_geometry_transform`, `get_image_dimensions`, `clear_session_caches`, `clear_image_caches`, `frontend_ready`, `update_wgpu_transform` (raw-stringed despite having an enum entry). Grep `src-tauri/src/lib.rs` for the authoritative list; the enum is a convenience layer, not the source of truth.
- **Renaming a command** silently breaks any raw-string caller and the enum string with no compile error until runtime ("command not found"). Grep both `Invokes` and raw `invoke('...')` callers.
- **Renaming/typoing an event name** makes the matching `listen()` go silent — no error, just missing updates. Change the string in `app_handle.emit` AND `useTauriListeners.ts` (and `App.tsx` for `ai-connector-status-update`) together.
- `useTauriListeners` is not the only subscriber — `App.tsx` has its own `listen('ai-connector-status-update', ...)`; don't assume one place owns all events.
- The log bridge `invoke(...).catch(() => {})` swallows failures so logging can never recurse — don't "fix" that empty catch.
- Event payload fields use **snake_case as emitted by Rust** when read in TS, e.g. `thumbnail-generated` destructures `{ path, data, rating, is_edited }`. Match the Rust serialization, not TS camelCase habits.

## How to add a command end-to-end

1. Write the Rust fn in the right module, e.g. `src-tauri/src/file_management.rs`: `#[tauri::command] pub async fn my_command(some_arg: String, state: tauri::State<'_, AppState>) -> Result<MyResult, String> { ... }`. Derive `Serialize` (with `#[serde(rename_all = "camelCase")]`) on `MyResult`.
2. Register it in `src-tauri/src/lib.rs` inside `tauri::generate_handler![ ... ]` (use the module path: `file_management::my_command,`).
3. Add the enum entry in `src/components/ui/AppProperties.tsx`: `MyCommand = 'my_command',` (keep variants alphabetized as in the file).
4. Call it: `const res = await invoke(Invokes.MyCommand, { someArg: value }).catch((err: string) => { /* show toast */ });` — TS camelCase keys map to Rust snake_case params automatically.
5. If it streams progress, emit from Rust: `app_handle.emit("my-progress", payload)?;` and add `listen('my-progress', (e: any) => { useProcessStore.getState().setProcess(...) })` inside the `listeners` array in `useTauriListeners.ts`. Make sure it's appended to that array so cleanup unlistens it.
6. If a UI string is user-facing, wrap it in `t()` and run the i18n step below.

## Related skills

`backend`, `hooks`, `state-stores`, `frontend`, `image-pipeline`, `export`, `file-management`, `ai-features`, `i18n`, `changelog`

## After changes

- TS: `npm run typecheck` and `npm run lint`.
- Rust (run inside `src-tauri/`): `cargo fmt` and `cargo clippy`.
- New UI strings: wrap in `t()`, then `npm run i18n:extract` and `npm run i18n:check`.
- Record user-facing changes per the `changelog` skill.
