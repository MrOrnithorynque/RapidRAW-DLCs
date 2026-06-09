---
name: i18n
description: Use this skill when adding or changing user-facing UI text, working with translations/locales, or following RapidRAW code style/logging conventions — covers react-i18next t() and the 10 locale JSONs in src/i18n/ (en/de/pl/zh-CN/es/fr/it/pt/ja/ru), i18next-cli extract/check/lint config in i18next.config.ts, the eslint-plugin-i18next no-literal-string rule + Prettier/TS-strict rules in eslint.config.js/.prettierrc/tsconfig.json, and dual logging (Rust log+fern in src-tauri/src/lib.rs via RUST_LOG, frontend console.* forwarded through src/utils/frontendLogBridge.ts). Trigger whenever the user asks to add/translate a UI string, add or edit a locale, fix an i18n/lint/format/typecheck warning, follow code style, or add backend/frontend logging.
---

# i18n, Conventions & Logging Skill

Cross-cutting rules for translatable UI text, code style (ESLint + Prettier + TS strict), and dual frontend/backend logging. Config lives at the repo root and in `src/i18n/`, `src/utils/frontendLogBridge.ts`, and `src-tauri/src/lib.rs`.

## Key files
| `path` | Responsibility |
| --- | --- |
| `src/i18n/index.ts` | i18next init; imports all 10 locale JSONs, `lng: 'en'`, `fallbackLng: 'en'`, `escapeValue: false`. Imported once via `import './i18n'` in `src/App.tsx`. |
| `src/i18n/locales/*.json` | 10 translation files (en, de, pl, zh-CN, es, fr, it, pt, ja, ru); nested dot-notation keys (~1500+ each). |
| `i18next.config.ts` | i18next-cli extract config — **only** `['en','de','pl','zh-CN']`, `sort: true`, `removeUnusedKeys: false`, `defaultValue: ''`. |
| `eslint.config.js` | Flat config: `@typescript-eslint/no-unused-vars` (warn, `^_` ignore) + `i18next/no-literal-string` (warn, `markupOnly: true`). |
| `.prettierrc` | `semi: true`, `trailingComma: all`, `singleQuote: true`, `printWidth: 120`. |
| `tsconfig.json` | `strict: true`, `target: es2025`, `jsx: react-jsx`, `module/moduleResolution: nodenext`, `forceConsistentCasingInFileNames`. |
| `src/utils/frontendLogBridge.ts` | Intercepts `console.*` + window error/unhandledrejection + Vite errors, forwards to backend. |
| `src-tauri/src/lib.rs` | `setup_logging()` (fern, ~L1692), `frontend_log` command (~L1771), `get_log_file_path` command (~L1763). |

## How it works
- **i18n:** Components call `const { t } = useTranslation();` (from `react-i18next`) and render `t('some.nested.key')`. Outside React (helpers, enums), import the singleton `i18n` from `i18next` and call `i18n.t('key')` (see `src/components/panel/right/Masks.tsx`). Language is switched at runtime by `i18n.changeLanguage(settings.language)` in `src/hooks/useAppInitialization.ts`. Keys missing from a locale fall back to `en`.
- **Extraction:** `npm run i18n:extract` runs i18next-cli, which scans `src/**/*.{ts,tsx}`, sorts keys, and writes new keys (empty values) — but **only to en/de/pl/zh-CN** because of `i18next.config.ts`. The other 6 locales are maintained by hand. `npm run i18n:check` = `extract --ci --dry-run` (fails CI if keys drift); `npm run i18n:lint` = `i18next-cli lint`.
- **Logging (frontend -> backend):** `installFrontendLogBridge()` is called once in `src/main.tsx`. It wraps `console.debug/info/warn/error/log`, calls the original, then `invoke(Invokes.FrontendLog, { level, message })`. Messages are serialized (depth 5, `[Circular]`/`[Function]`/bigint handling), Vite errors are parsed, identical `(level, message)` pairs are dropped within 1.5s, and messages over 12000 chars are truncated. The backend `frontend_log` command splits on newlines and logs each line with a `[frontend]` prefix via `log::{error,warn,debug,trace,info}!`.
- **Logging (backend):** `setup_logging()` configures fern: format `YYYY-MM-DD HH:MM:SS [LEVEL] message`, level from `RUST_LOG` (default `info`, invalid -> `info`), chained to stderr + `app_log_dir/app.log`. A panic hook logs `PANIC! <location> - <message>`. The log file is **truncated on every app start**.

## Key types & symbols
| Symbol | Kind | What |
| --- | --- | --- |
| `useTranslation` / `t` | hook (react-i18next) | Provides `t(key)`; the standard way to translate in components. |
| `i18n` (default export of `i18next`) | singleton | `i18n.t(key)` / `i18n.changeLanguage(lng)` for non-component code. |
| `Invokes.FrontendLog = 'frontend_log'` | enum variant | In `src/components/ui/AppProperties.tsx`; the command the bridge invokes. |
| `installFrontendLogBridge()` | fn | Idempotent console/error interceptor installer; called in `src/main.tsx`. |
| `frontend_log(level, message)` | `#[tauri::command]` | Backend receiver; registered in the `invoke_handler!` list in `lib.rs`. |
| `get_log_file_path()` | `#[tauri::command]` | Returns the `app.log` path for the UI. |
| `setup_logging(app_handle)` | fn | fern init; called in the Tauri `setup` closure (`lib.rs` ~L2015). |
| `i18next/no-literal-string` | ESLint rule | `markupOnly: true` — flags untranslated JSX text only. |

## Conventions (follow these when coding here)
- **Every user-facing JSX string uses `t('...')`.** Bare text in markup triggers the `i18next/no-literal-string` warning. String literals in JS/TS logic (variable values, object keys) are fine — the rule is `markupOnly`.
- **Translation keys are nested dot-notation**, namespaced by area (e.g. `masks.types.depth`, `presets.title`). Reuse an existing namespace before inventing one.
- **Unused vars must be prefixed `_`** (`_unused`, `catch (_e)`) — the rule ignores `^_` for args, vars, and caught errors.
- **Prettier is law:** 120-col width, single quotes, semicolons, trailing commas everywhere. Run `npm run format`; don't hand-format.
- **TS is strict** (`strict: true`, `forceConsistentCasingInFileNames`). No `any` escape hatches; fix the type. Casing must match imports exactly (bites on case-insensitive macOS, fails on Linux CI).
- **Logging:** in TS, just use `console.log/warn/error/debug` — the bridge forwards them. In Rust, use `log::info!/warn!/error!/debug!/trace!`. Don't add a second logging mechanism.
- **`ignoreAttribute` list** in `eslint.config.js` (className, style, id, name, type, value, label, placeholder, stroke, fill, viewBox, data-tooltip, variant, size, color, weight, fillOrigin) — technical attributes are exempt; do not wrap them in `t()`.

## Gotchas
- **Extraction only touches 4 locales.** After `i18n:extract`, en/de/pl/zh-CN get the new key; you must manually add it to es/fr/it/pt/ja/ru or they fall back to `en`. This is a known automation gap.
- **i18n warnings are `warn`, not `error`** — a literal string won't fail `npm run lint`'s exit code. Don't rely on lint to catch a missed `t()`; check visually.
- **`console.log` maps to `info`**, not `debug`. Use `console.debug()` for debug-level frontend logs.
- **Frontend logging is async + fire-and-forget.** The `invoke` is `.catch(() => {})`'d to avoid recursion; never depend on a backend log line appearing for control flow.
- **`app.log` is truncated on each start** (`truncate(true)`). Copy it before relisting if you need prior-session logs.
- **Dedup key is `level:message`.** Same text at a different level logs again; 12000-char messages are silently truncated with `… [truncated]`.
- **Don't import `useTranslation` from `src/i18n/index.ts`** — it comes from `react-i18next`. `src/i18n/index.ts` only initializes i18next; it's pulled in by `import './i18n'` in `App.tsx`.

## How to add a new user-facing UI string
1. In the component, add `import { useTranslation } from 'react-i18next';` and `const { t } = useTranslation();` (or, outside a component, `import i18n from 'i18next';` and use `i18n.t(...)`).
2. Replace the literal with `t('area.subarea.descriptiveKey')`. Pick an existing namespace from the locale JSONs when possible. Use interpolation for dynamic values: `t('export.progress', { count })` with `"progress": "{{count}} exported"` in the JSON.
3. Run `npm run i18n:extract` — adds the key (empty value) to `en/de/pl/zh-CN` and re-sorts. Fill in at least `en.json`.
4. **Manually add the same key to the other 6 locales** (`es, fr, it, pt, ja, ru`); copy the English value as a placeholder if you can't translate.
5. Run `npm run i18n:check` (must pass — no drift) and `npm run i18n:lint`.
6. Run `npm run lint` and `npm run typecheck`; confirm no new `no-literal-string` warning remains for that line.
7. For purely technical attributes already in `ignoreAttribute`, no `t()` is needed.

## Related skills
`frontend`, `state-stores`, `tauri-bridge`, `backend`, `changelog`

## After changes
- TS/UI: `npm run typecheck`, `npm run lint`, `npm run format`.
- New UI strings: `npm run i18n:extract` then update the 6 manual locales; verify with `npm run i18n:check` and `npm run i18n:lint`.
- Rust (logging/`lib.rs`): `cargo fmt` + `cargo clippy` inside `src-tauri/`.
- Record any user-visible change per the `changelog` skill.
