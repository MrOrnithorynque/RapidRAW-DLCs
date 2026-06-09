---
name: screenshot
description: Use this skill to run RapidRAW and capture its window for visual inspection — verifying a UI/layout/theme change, checking the editor or library, or debugging a visual issue. RapidRAW is a native Tauri desktop window (NOT a browser app on a localhost port), so capture the OS window, not a web page. Trigger whenever you need to see what the RapidRAW UI currently looks like.
---

# Screenshot Skill

RapidRAW renders in a **native Tauri window** with custom chrome (`decorations: false`). There is no fully-functional browser URL to screenshot — capture the OS window of the running app.

## Run the app

```bash
npm install        # first time only
npm run tauri dev  # builds the Rust backend (slow first time) + opens the native window
```

Wait for the window to appear. On the very first launch the Rust build can take minutes (it also downloads the ONNX Runtime — see `build`). The frontend has a 4-second failsafe that shows the window even if the frontend hasn't reported ready.

## Capture the window (macOS)

The dev machine is macOS. Capture the whole screen (most reliable for automation) or a region, then read the PNG:

```bash
screencapture -x /tmp/rapidraw.png        # full screen, no shutter sound
# or interactively select the window:      screencapture -w /tmp/rapidraw.png
```

Then view it with the Read tool on `/tmp/rapidraw.png`. (Linux: `grim`/`gnome-screenshot`; Windows: `nircmd`/PowerShell `Get-Screenshot`.)

## Quick layout/theme-only check (no backend)

To inspect **static UI, layout, theming, or i18n** without building the Rust side, you can run the Vite frontend alone and view it in a browser:

```bash
npm run dev   # Vite on http://localhost:1420
```

Caveat: `invoke()` calls have no backend, so anything that loads images, the library, presets, or settings will be empty or error. Use this only for chrome/layout/theme/translation checks, never to verify editing behavior. For real behavior, use `npm run tauri dev` + the `verify` skill.

## What to check

- Does the window render with the custom title bar (no native OS frame) and the active theme?
- Library view: folder tree (left), thumbnail grid, filmstrip/bottom bar.
- Editor view: the image canvas with the processed preview, the right-panel switcher (Adjustments / Crop / Masks / AI / Presets / Export / Metadata), and the waveform/histogram.
- Mask & crop overlays draw on the canvas correctly.
- No untranslated raw `t('…')` keys leaking into the UI (means a missing locale string — see `i18n`).
- Panels resize and animate without layout breakage.

## Related skills

`build` (running/troubleshooting), `verify` (confirm behavior in the real app), `frontend` / `ui-primitives` (what you're looking at).
