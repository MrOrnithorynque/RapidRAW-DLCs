---
name: build
description: Use this skill when you need to build, run, set up, or troubleshoot starting RapidRAW — covers package.json npm scripts, vite.config.js (port 1420 strictPort), src-tauri/tauri.conf.json (devUrl/beforeDevCommand/bundle resources), src-tauri/build.rs (ONNX runtime download + SHA256), src-tauri/Cargo.toml (Rust 1.95 MSRV, wgpu/ort), the .github/workflows CI (ci/build/lint/pr-ci/release), and packaging/ Flatpak. Trigger whenever the user asks to install deps, run `npm run tauri dev`/`npm start`, run a production `tauri build`, add an npm script or CI step, change bundled resources, or debug startup failures (port 1420 in use, ONNX download fail, missing lensfun_db, missing Linux libwebkit2gtk).
---

# Build & Run Skill

How to install, run, build, and package RapidRAW — a Tauri v2 desktop app (React 19 frontend + Rust backend, also builds for Android). Config lives at the repo root (`package.json`, `vite.config.js`, `tsconfig.json`), in `src-tauri/`, and in `.github/workflows/` + `packaging/`.

## Quick start
```bash
npm install            # frontend deps (npm — package-lock.json is committed)
npm run tauri dev      # == `npm start`: Vite serves UI on :1420, Tauri opens the native window
npm run tauri build    # production bundle for the current platform
```
Prereqs: Rust >= 1.95 (MSRV) + Node. Linux also needs `libwebkit2gtk-4.1-dev` (+ `build-essential`, `libssl-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `patchelf`). First build needs internet (ONNX download, below).

## Key files
| path | responsibility |
| --- | --- |
| `package.json` | npm scripts (`dev`, `build`, `start`, `tauri`, `typecheck`, `lint`, `format`, `i18n:*`) + all Node deps (React 19, Zustand, Tauri API). |
| `vite.config.js` | Vite dev server: port `1420` `strictPort: true`, React + Tailwind plugins, ignores `src-tauri/**`, minify off + sourcemaps when `TAURI_ENV_DEBUG` set. |
| `tsconfig.json` | `tsc --noEmit` strict, target `es2025`, `jsx: react-jsx`, `moduleResolution: nodenext`. |
| `index.html` | HTML entry; loads `/src/main.jsx` (Vite resolves it to `src/main.tsx`). |
| `src-tauri/tauri.conf.json` | App config: `devUrl http://localhost:1420`, `beforeDevCommand npm run dev`, `beforeBuildCommand npm run build`, `frontendDist ../dist`, `bundle.resources ["resources","lensfun_db"]`, file associations, version `1.5.7`. |
| `src-tauri/tauri.linux.conf.json` / `tauri.macos.conf.json` | Platform overlays merged into base (RPM webkit2gtk recommends; macOS min `13.0`). |
| `src-tauri/build.rs` | Downloads + SHA256-verifies `libonnxruntime` from HuggingFace into `src-tauri/resources/` (or `libs/arm64-v8a` on Android); panics on failure. |
| `src-tauri/Cargo.toml` | Rust deps; `edition 2024`, `rust-version 1.95`, `wgpu 29.0`, `ort =2.0.0-rc.10` (`load-dynamic`); release profile `lto + strip + codegen-units=1`. |
| `eslint.config.js` / `.prettierrc` | ESLint (React + i18next plugins) / Prettier (120 cols, single quotes, semicolons, trailing commas). |
| `i18next.config.ts` | `i18next-cli` extract → `src/i18n/locales/{{language}}.json` for `[en, de, pl, zh-CN]`. |
| `.github/workflows/{ci,build,lint,pr-ci,release}.yml` | CI: `build.yml` is the reusable builder; `ci`/`pr-ci`/`release` fan it out across platforms; `lint.yml` runs format/eslint/i18n + cargo fmt/clippy. |
| `packaging/io.github.CyberTimon.RapidRAW.yml` | Flatpak manifest (GNOME runtime 49, offline build, `ORT_STRATEGY: system`); `cargo-sources.json` / `node-sources.json` are its offline vendor manifests. |

## How it works
- **Dev (`npm start` = `tauri dev`):** the Tauri CLI runs `beforeDevCommand` (`npm run dev` → Vite on `localhost:1420`), then opens the native window pointed at `devUrl`. Frontend HMR is live; Rust is compiled by cargo. `npm run dev` alone serves the UI but `invoke()` calls fail with no Tauri backend.
- **Production (`npm run tauri build`):** Tauri runs `beforeBuildCommand` (`npm run build` → Vite to `dist/`), compiles the Rust release binary, and bundles `dist/` + `resources/` + `lensfun_db/` into platform installers (NSIS, dmg, deb/rpm/AppImage, APK/AAB). Plain `npm run build` only emits the frontend — it does NOT build the app.
- **ONNX runtime:** `build.rs` runs on every cargo build; it picks the lib for the target OS/arch, downloads from `huggingface.co/CyberTimon/RapidRAW-Models/.../onnxruntimes-v1.22.0/`, SHA256-verifies, and caches it in `src-tauri/resources/`. A valid cached file is reused (download skipped). The `ort` crate (`load-dynamic`) loads it at runtime. See `ai-features`.
- **Bundled resources** (`resources/`, `lensfun_db/`) are read at runtime via the Tauri resource dir; lens correction (`corrections`) and AI models depend on them being present under `src-tauri/`.

## Key types & symbols
| symbol | kind | what |
| --- | --- | --- |
| `npm start` / `npm run tauri dev` | npm script | Full dev: Vite + native Tauri window. |
| `npm run dev` | npm script | Vite-only dev server on `:1420` (no backend). |
| `npm run build` | npm script | Vite production build to `dist/` (frontend only). |
| `npm run tauri build` | npm script | Full app bundle (calls `beforeBuildCommand` itself). |
| `npm run typecheck` / `lint` / `format` | npm script | `tsc --noEmit` / `eslint .` / `prettier --write .`. |
| `npm run i18n:extract` / `i18n:check` | npm script | Extract keys / CI dry-run check (`--ci --dry-run`). |
| `download_and_verify` | Rust fn (`build.rs`) | Fetch + SHA256-verify ONNX lib; panics on mismatch/failure. |
| `ORT_STRATEGY` / `ORT_LIB_LOCATION` / `ORT_SKIP_DOWNLOAD` | env vars | Set by `build.rs` (Android: `manual`) and CI to control `ort`; Flatpak uses `ORT_STRATEGY: system`. |
| `TAURI_ENV_DEBUG` | env var | When set, Vite skips minify and emits sourcemaps. |
| `tauri-apps/tauri-action@cf3eb9b…` | GH action | Pinned dev-branch commit (for `assetNamePattern`), `retryAttempts: 3`. |

## Conventions (follow these when coding here)
- Port `1420` is hardcoded in `vite.config.js` (`strictPort: true`) and must match `devUrl` in `tauri.conf.json` — change both together.
- New bundled assets go under `src-tauri/resources/` (or a new dir) and must be added to `bundle.resources` in `tauri.conf.json`.
- Platform configs `tauri.linux.conf.json` / `tauri.macos.conf.json` MERGE into `tauri.conf.json`; they are overlays, not replacements.
- Rust MSRV is `1.95`, edition `2024`; bump `rust-version` in `Cargo.toml` if you adopt newer syntax.
- Run cargo commands from inside `src-tauri/` (that is the crate; package name is `RapidRAW`).
- CI runs `cargo fmt`/`clippy` and frontend lint on Linux only — replicate locally before pushing.

## Gotchas
- **Port 1420 in use:** `strictPort: true` makes Vite refuse to start (no auto-increment). Kill the stale `vite`/`tauri dev` process; do not just change the port without updating `devUrl`.
- **ONNX download failure** (no internet, HuggingFace down, or SHA256 mismatch) makes `build.rs` panic and the whole cargo build fails — there is no fallback. The hashes live in `build.rs`; a valid cached `resources/libonnxruntime.*` is reused so the first build is the costly one.
- **Linux deps:** missing `libwebkit2gtk-4.1-dev` (+ the deps above) = build failure (see `build.yml`). A Wayland/NVIDIA WebKit crash at runtime is worked around with `WEBKIT_DISABLE_DMABUF_RENDERER=1` (per README).
- **`lensfun_db` / `resources` must exist** under `src-tauri/` at build time (both are in-repo); `lens_correction` fails at runtime if `lensfun_db` is absent from the bundle.
- **`npm run build` ≠ build the app** — it only emits the frontend. Use `npm run tauri build`.
- **Entry mismatch:** `index.html` references `/src/main.jsx` but the file is `src/main.tsx`; Vite resolves it. Keep that filename or update `index.html`.
- **i18n extract covers only 4 locales** (`en, de, pl, zh-CN` per `i18next.config.ts`) even though 10 locale JSONs exist; the rest are maintained outside extraction. See `i18n`.
- **Node version drift:** `build.yml` uses Node 22, `lint.yml` uses Node 20 — local Node 20+ is fine.
- **CI `--bundles nsis`** is set under the matrix key `builds-args` (a typo) which is NOT the `build-args` input `build.yml` reads, so it is not actually forwarded. Don't trust that matrix value when changing bundle flags.
- **Flatpak is fully offline** (`npm ci --offline --legacy-peer-deps`, `cargo --offline fetch`, `npm run --offline tauri build -- --no-bundle`) and uses `ORT_STRATEGY: system` with its OWN ONNX URL (`onnxruntimes/…`, different SHA256 than `build.rs`). Update `cargo-sources.json` / `node-sources.json` when deps change.

## How to add a bundled resource
1. Place the file(s) under `src-tauri/resources/` (or create a new top-level dir under `src-tauri/`).
2. If it is a new dir, add it to `bundle.resources` in `src-tauri/tauri.conf.json` (e.g. `["resources", "lensfun_db", "my_dir"]`).
3. In Rust, resolve it at runtime via the Tauri resource path (`BaseDirectory::Resource`); follow existing `lensfun_db`/`resources` usage (`backend`, `corrections`).
4. If the asset is fetched/verified (like ONNX), extend `src-tauri/build.rs` with a download + SHA256 entry instead of committing a large binary.
5. Run `npm run tauri build` locally to confirm it lands in the bundle, and add it to the Flatpak manifest (`packaging/…yml`) if Linux/Flatpak must ship it.

## Related skills
`backend`, `ai-features`, `corrections`, `android`, `frontend`, `i18n`, `changelog`

## After changes
- TS/config: `npm run typecheck` and `npm run lint` (CI also runs `npm run format:check`).
- Rust/`build.rs`/`Cargo.toml`: `cargo fmt` + `cargo clippy --all-targets --all-features -- -D warnings` from inside `src-tauri/`.
- If you changed CI, validate the matching `.github/workflows/*.yml` by triggering `pr-ci.yml` on a branch.
- Added UI strings? Run `npm run i18n:extract` and commit locale changes (`i18n`).
- Record user-visible build/setup changes per the `changelog` skill.
