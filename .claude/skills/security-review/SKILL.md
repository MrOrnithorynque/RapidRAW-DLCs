---
name: security-review
description: Use this skill BEFORE shipping any RapidRAW change that takes a filesystem path from the frontend, parses an untrusted file (image/RAW/LUT/preset/sidecar/EXIF), fetches or uploads to a remote URL (ai-connector, cloud, community presets, model/ONNX downloads), runs an external AI backend, deletes/overwrites files, or touches the Clerk auth token. The standing security checklist for this Tauri desktop app.
---

# Security Review Skill

RapidRAW is a local Tauri desktop app, so the threat model is "a malicious file, preset, or remote endpoint corrupts/crashes the app or exfiltrates the user's data/credentials," not a multi-tenant server. Run the relevant checks before any non-trivial change in those areas.

## Check 1 — Path safety in Tauri commands

Commands receive paths from the frontend (and from OS file-open / Android content URIs). Treat them as input.
- Resolve every path through `file_management::parse_virtual_path` before filesystem use — some paths are virtual library/album/virtual-copy (`?vc=ID`) paths, not real FS paths. Don't assume a raw `PathBuf`. See `file-management`.
- A preset/community-preset/sidecar that supplies a destination path (e.g. the auto-created "Community" preset folder) must not escape the intended directory — reject `..` traversal and absolute paths where a relative one is expected.
- Operate only within folders the user opened/imported; don't widen scope implicitly.

## Check 2 — Untrusted file parsing (the big one)

Every image/RAW/LUT/preset/`.rrdata`/EXIF the app opens is attacker-influenceable. A crafted file must fail gracefully, never crash the process or hang the GPU.
- RAW decode (`rawler`), image decode (`image`, `jxl-oxide`, `webp`, `mozjpeg`), LUT (`.cube`) parse, EXIF (`kamadak-exif`), and preset/sidecar JSON must return `Result` and degrade — **no `.unwrap()`/`.expect()`/`panic!` on file-derived data** (clippy flags these; they are crash/DoS vectors). Bound allocations driven by file-declared sizes (dimensions, LUT size, tile counts).
- `normalizeLoadedAdjustments` (TS) must default any missing/garbage field so a malformed `.rrdata` can't poison the editor state. See `image-pipeline`.

## Check 3 — Egress / SSRF (remote fetches)

Outbound HTTP exists in: `ai_connector.rs` (ComfyUI/cloud generative replace), `fetch_community_presets` (GitHub raw manifest), build-time + runtime model/ONNX downloads.
- Keep TLS verification on — `reqwest` with `rustls`, never `danger_accept_invalid_certs`.
- The **ai-connector address is user-configured** and may be a LAN/internal host by design (self-hosted ComfyUI). That's intended, but: bound response sizes, set timeouts, and don't follow surprising redirects to other origins. Never log the full request/response bodies (they can contain image data or tokens).
- Community/model fetches go to fixed GitHub/HuggingFace URLs over HTTPS — keep them fixed; don't make the base URL attacker-controllable.

## Check 4 — Download & runtime integrity

`build.rs` and the AI model loader **download the ONNX Runtime and models and SHA256-verify them** before use (mismatch → re-download / fail). Never weaken or skip this verification, and never load a model from an unverified/arbitrary path. See `ai-features` and `build`.

## Check 5 — Secrets & credentials

- The Clerk publishable key in [src/App.tsx](src/App.tsx) is a **dev** key (`pk_test_…`); publishable keys are public by design, but don't commit a *secret* Clerk key, and a production build needs the real publishable key injected, not the dev one.
- Cloud/generative features send a Clerk auth token (`getToken()`) to the backend command, which forwards it as a bearer to the cloud endpoint. Never log the token, never persist it to `.rrdata`/settings, and only send it to the configured cloud endpoint.
- No API keys, tokens, or passwords inline in code, in logs (`log::`/`frontendLogBridge`), or in committed files.

## Check 6 — Privacy of cloud/AI uploads

Generative replace / cloud inpaint **upload the user's source image** to the configured cloud or ai-connector server (and the server may cache it). Make sure this only happens for the cloud/ComfyUI tiers the user explicitly chose — never silently send a local-tier edit off-device. Local ONNX masking/tagging/culling must stay fully on-device.

## Check 7 — Destructive & irreversible operations

- Prefer the OS trash (`trash` crate) over permanent deletion. `delete_files_from_disk`, `delete_files_with_associated`, `clear_all_sidecars`, `clear_thumbnail_cache`, and overwriting originals are destructive — keep them gated behind an explicit user confirmation in the UI, and never auto-trigger them as a side effect of another command.
- Originals are read-only in the non-destructive model; edits belong in `.rrdata` sidecars. A change that writes pixels back into the source file is a red flag — confirm it's intended.

## Error hygiene

Tauri commands return `Result<T, String>`; return a concise, user-meaningful message and `log::error!` the detail server-side. Don't surface raw internal errors or full absolute paths into toast UI when a short message suffices.

## License note

RapidRAW is AGPL-3.0. If a change turns part of it into a network service (e.g. a hosted cloud editor), the AGPL §13 network-use source-availability clause applies — flag it.
