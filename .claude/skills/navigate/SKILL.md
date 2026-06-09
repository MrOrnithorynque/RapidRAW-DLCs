---
name: navigate
description: Use this skill to programmatically drive/navigate the RUNNING RapidRAW window on macOS — bring it frontmost, send keyboard shortcuts, click buttons by coordinate, switch between Library/Editor and the right-hand panels, open images, and screenshot to observe (a computer-use act→observe loop). RapidRAW is a native Tauri (WKWebView) window, NOT a browser on a port, so there is no WebDriver — navigation is OS-level input synthesis + screen capture. Trigger whenever you need to actually operate the app (click through a flow, reach a panel/modal, reproduce a UI bug interactively), not merely capture one screenshot (use `screenshot` for that) or assert behavior (`verify`).
---

# Navigate Skill — drive the running RapidRAW window (macOS)

RapidRAW renders in a **native Tauri window** with `decorations: false` (WKWebView). To navigate it you run an **act → observe loop** with built-in macOS tools: bring the window frontmost, synthesize keystrokes/clicks, then `screencapture` and Read the PNG to see the result. There is **no element-by-name automation** here (see *Why no WebDriver*), so prefer keyboard shortcuts and fall back to absolute-coordinate clicks.

Helper scripts live in [scripts/](scripts/): `rr.sh` (the driver) and `rr-bounds.swift` (window geometry). Start by making them executable: `chmod +x .claude/skills/navigate/scripts/rr.sh`.

## Prerequisite: the app must be running

Navigation drives an existing window. Launch it first (see the `build` / `screenshot` skills): `npm run tauri dev`. Confirm it is up: `osascript -e 'tell application "System Events" to get name of every process whose name contains "Rapid"'` should print `RapidRAW`.

## One-time permission setup (REQUIRED — read this first)

Two **separate** macOS permissions are involved, and they attach to the **GUI app that owns this agent's shell** — here that is **Visual Studio Code** (`Code.app`), because the process chain is `zsh → claude → Code Helper → Visual Studio Code`. Not "osascript", not "Terminal".

| Permission | Needed for | Symptom when missing |
|---|---|---|
| **Accessibility** | input synthesis (`keystroke`, `click at`, cliclick) | `osascript ... (-25211) "not allowed assistive access"` |
| **Screen & System Audio Recording** | pixel capture (`screencapture`) | `screencapture: could not create image from display` |

Grant in **System Settings → Privacy & Security**: enable **Visual Studio Code** under both *Accessibility* and *Screen & System Audio Recording*, then **fully quit and reopen VS Code** (Screen Recording changes only take effect after restart). macOS may reset Screen Recording on app updates — re-check if captures suddenly fail. Window *metadata* (bounds/id) does **not** need Screen Recording, so `rr.sh bounds` works even before you grant it; only `shot` needs it.

> Verified state at authoring time on this machine: **Accessibility = granted** (keystrokes work), **Screen Recording = NOT granted** (every `screencapture` mode failed). If `shot` errors, this is almost always why.

## The loop

```bash
S=.claude/skills/navigate/scripts/rr.sh
"$S" activate            # bring RapidRAW frontmost (needed before input)
"$S" shot                # screenshot the window -> /tmp/rapidraw.png (+ caches origin & Retina scale)
# -> Read /tmp/rapidraw.png to SEE the current screen
"$S" key m               # act: press M (Masks panel)  [prefer keys over clicks]
"$S" shot                # observe the result
```

`rr.sh` commands (full list via `rr.sh` with no args):

- `activate` — frontmost the window (uses `set frontmost of process`; activate-*by-name* errors `-1728` on the dev binary).
- `bounds` — print `X Y W H WINDOWID` in points.
- `shot [out.png]` — capture the window by id to `/tmp/rapidraw.png` and cache origin + scale to `/tmp/rr_nav_state`.
- `key <char> [mods]` — keystroke; mods = `cmd shift opt ctrl` (e.g. `key s cmd`, `key e cmd shift`).
- `keycode <n> [mods]` — non-printing keys: `53`=Esc `36`=Return `48`=Tab `49`=Space `51`=Delete `123/124/125/126`=Left/Right/Down/Up.
- `clickpx <px> <py>` — **preferred click**: pass coordinates read directly off the screenshot PNG; it divides by the Retina scale and adds the window origin.
- `click <wx> <wy>` — click at in-window **point** coords (when you already have points, not pixels).

If you ever drive it by hand instead of the wrapper, the verified raw primitives are in [scripts/rr.sh](scripts/rr.sh) and [scripts/rr-bounds.swift](scripts/rr-bounds.swift).

## Keyboard first (it's more reliable than clicking)

The WKWebView exposes **no clickable Accessibility elements**, so coordinate clicks are pixel-fragile. RapidRAW has a rich keymap dispatched from a single global listener in [src/hooks/useKeyboardShortcuts.ts](src/hooks/useKeyboardShortcuts.ts) (defaults in [src/utils/keyboardUtils.ts](src/utils/keyboardUtils.ts)). **Use a shortcut wherever one exists.**

Important gating (or your keypress will silently do nothing):
- **Most modals swallow all shortcuts** — while the create/rename/import/copy-paste/confirm or Panorama/Culling/Collage/Denoise/Negative modals are open, only that modal's own keys/Escape work (the HDR modal is the exception — it doesn't suppress them). If a keypress does nothing while a dialog is up, this is usually why.
- **Focus in an `<input>`/`<textarea>`** disables shortcuts (click empty canvas first if needed).
- **Most editor shortcuts require an image open** (`selectedImage` truthy). Panel-switch letters, zoom, rotate, etc. do nothing in the library.
- **Same key, different context**: arrow keys move the grid selection in the **library** but step prev/next-image and zoom in the **editor**. Also `Ctrl+A` = select-all (works in both views) while bare `A` = waveform toggle (editor only).
- `Ctrl` in the table means **Ctrl or ⌘** (use `cmd` with `rr.sh key`). Defaults are user-rebindable except `Escape`, mask/patch `Delete`, and the library arrows.

| Key | Action | Context |
|---|---|---|
| `Enter` | open the active image into the editor | library |
| `Escape` | back out: cancel overlay → deselect mask/patch → Crop→Adjustments → exit fullscreen → **return to library** | global |
| `←` / `→` | previous / next image | editor |
| `↑` / `↓` `←` `→` | move grid selection | library |
| `D` `R` `M` `K` `P` `I` `E` | switch right panel: Adjustments / Crop / Masks / AI / Presets / Metadata / Export | editor |
| `A` | toggle waveform/histogram overlay | editor |
| `S` | open Crop + straighten | editor |
| `B` | show original (before/after) | editor |
| `F` | toggle fullscreen | editor |
| `Space` / `Ctrl+0` / `Ctrl+1` | cycle zoom / fit / 100% | editor |
| `[` / `]` | rotate 90° left / right | editor |
| `Ctrl+Z` / `Ctrl+Y` | undo / redo | editor |
| `Ctrl+C` / `Ctrl+V` | copy / paste adjustments | editor |
| `0`–`5` / `Shift+0`–`5` | set rating / color label | library + editor |

Examples: `rr.sh key m` (Masks), `rr.sh keycode 53` (Escape → back to library), `rr.sh keycode 124` (next image), `rr.sh key z cmd` (undo), `rr.sh key 0 shift` (clear color label).

## Reachability map (keyboard vs click)

How to reach each destination. "click" means there is no shortcut — `shot`, find it in the PNG, then `clickpx`.

| Destination | Keyboard | Otherwise |
|---|---|---|
| Open image → Editor | `Enter` (after selecting) | double-click a thumbnail |
| Back to Library | `Escape` | back-arrow in the editor toolbar |
| Right panels (Adjustments/Crop/Masks/AI/Presets/Metadata/Export) | `D R M K P I E` | tabs in the right-panel switcher |
| Fullscreen | `F` (Esc exits) | maximize in editor toolbar |
| Prev/next image | `←`/`→` (editor), arrows (library) | filmstrip / grid thumbnail |
| Library Export panel (multi-select) | — | Export button in the library bottom bar |
| Community presets page | — | Users button in the library header |
| Settings panel | — | gear on the welcome/splash screen only |
| Open/add a folder | — | splash "Open Folder" or folder-tree "Add folder" |
| Folder tree / albums / view mode (Flat/Recursive) | — | click in the left folder tree / view-options dropdown |
| Folder-tree show/hide, filmstrip show/hide | — | collapse chevrons |
| Panorama / HDR / Collage / Culling / Negative / Denoise | — | **right-click** an image or multi-selection → context menu |
| Create/Rename Folder · Rename File · Album modals | — | right-click in tree / on thumbnail → context menu |
| Copy/Paste-settings modal · Import modal | — | gear in bottom bar / import flow |

Context menus need a right-click: `osascript -e 'tell application "System Events" to set frontmost of (first process whose name is "RapidRAW") to true' -e 'delay 0.3' -e 'tell application "System Events" to perform action "AXShowMenu" of ...'` is unavailable (no AX tree), so right-click by coordinate instead — e.g. `cliclick rc:GX,GY` if installed, or a `control`-click. Plain `rr.sh click` is a left-click only.

## Coordinate math (clicks only)

You only need this for `click`/`clickpx`; `rr.sh` does it for you, but know the rules:
- **Points vs pixels**: window bounds are in **points**; a Retina `screencapture` PNG is **2× pixels**. `clickpx` divides screenshot coords by `scale = pngPixelWidth / windowPointWidth` (cached by `shot`). Always `shot` before `clickpx`.
- **Global vs in-window**: `click at {x,y}` is **global screen** coords, so the window **origin** (often `0,33` — the title bar) is added to your in-window coords.
- Re-run `shot` after anything that moves/resizes the window (fullscreen, panel resize) so the cached origin/scale stays correct.

## Pitfalls

- **Nothing happened after a keypress** → a modal is open, focus is in a text field, or you're in the wrong view (panel keys need an image open). `shot` and check; press `Escape` to clear overlays.
- **`screencapture` fails** → Screen Recording not granted to VS Code (see setup); window id stale — re-run `bounds`.
- **`-25211` on keystroke/click** → Accessibility not granted to VS Code.
- **Click lands in the wrong place** → forgot to `shot` after a resize, or used raw pixel coords with `click` (use `clickpx`), or the window moved displays (scale differs per display).
- **No foreground `sleep`** in this harness — all settle delays are `delay` *inside* the osascript blocks (already handled by `rr.sh`).
- Don't fight the dev binary: `tell application "RapidRAW" to activate` errors `-1728`; use the `set frontmost of process` form (what `rr.sh activate` does).

## Why no WebDriver (don't retry this)

`tauri-driver`/WebDriver is **unsupported on macOS** — the [Tauri v2 docs](https://v2.tauri.app/develop/tests/webdriver/) state desktop WebDriver covers only Windows and Linux because macOS ships no WKWebView driver ([issue #7068](https://github.com/tauri-apps/tauri/issues/7068)). Third-party plugins exist but require **embedding a plugin and rebuilding RapidRAW** (debug only) — out of scope for driving the already-running app. OS-level input + capture (this skill) is the path on macOS. (On Windows/Linux, real WebDriver would be the better route.)

## Related skills

`screenshot` (one-shot capture & what you're looking at), `verify` (run the app and assert behavior), `frontend` / `ui-primitives` (what the UI is), `build` (launch/troubleshoot the app).
