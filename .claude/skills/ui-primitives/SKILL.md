---
name: ui-primitives
description: Use this skill before modifying the reusable UI/design system in src/components/ui/ (Slider, ColorWheel, Dropdown, GlobalTooltip, Switch, Input, Button, Text, Resizer, CollapsibleSection, AppProperties), the typography tokens in src/types/typography.ts, the theme definitions in src/utils/themes.ts, and the Tailwind v4 entry src/styles.css. Covers semantic theme tokens, the Text/TextVariants system, framer-motion animation patterns, data-tooltip, lucide-react icons, and the no-native-select rule. Trigger whenever the user asks to add/change/debug a shared UI control, the design-system primitives, theming/themes, typography variants, tooltips, sliders, dropdowns, the color wheel, or wants to build a new reusable UI primitive.
---

# UI Primitives Skill

The reusable design system for RapidRAW's React frontend: shared presentational controls in `src/components/ui/`, plus the typography tokens (`src/types/typography.ts`), theme palettes (`src/utils/themes.ts`), and the Tailwind v4 entrypoint (`src/styles.css`). These are pure, store-agnostic components driven entirely by props + theme CSS variables.

## Key files
| path | responsibility |
|------|----------------|
| `src/components/ui/Slider.tsx` | Range control: click-to-edit value, double-click reset, mouse+touch drag, Shift/Alt fine-drag, Shift-wheel step, snap-to-step, dual-origin fill |
| `src/components/ui/ColorWheel.tsx` | HSL picker (`@uiw/react-color-wheel`) + Hue/Sat/Lum `Slider`s; Ctrl=hue-only, Shift=sat-only on wheel; sets `--cg-hue-*`/`--cg-sat-*` CSS vars |
| `src/components/ui/Dropdown.tsx` | Generic typed `<select>` replacement with type-to-filter, framer-motion menu, outside-click/Escape close |
| `src/components/ui/GlobalTooltip.tsx` | Singleton portal tooltip; watches any `[data-tooltip]` element; 500ms delay; mounted once at app root |
| `src/components/ui/Text.tsx` | Polymorphic text component composing `TextVariants` + weight + color tokens |
| `src/components/ui/Switch.tsx` `Input.tsx` `Button.tsx` `Resizer.tsx` | Toggle, text input (forwardRef), button, drag separator |
| `src/components/ui/CollapsibleSection.tsx` | Expandable card with `ResizeObserver`-driven max-height animation + eye visibility toggle |
| `src/components/ui/AppProperties.tsx` | Shared enums/types: `Invokes`, `Panel`, `Theme`, `Orientation`, `GLOBAL_KEYS`, `AppSettings`, etc. |
| `src/types/typography.ts` | `TextVariant`/`TextWeight`/`TextColor` types + `TextVariants`/`TEXT_WEIGHT_KEYS`/`TEXT_COLOR_KEYS` token→class maps |
| `src/utils/themes.ts` | `THEMES` array + `DEFAULT_THEME_ID`; each theme's `--app-*` RGB CSS variables |
| `src/styles.css` | Tailwind v4 entry (`@import 'tailwindcss'`); `@theme` maps `--app-*`→`--color-*`; slider/gradient `@utility`/`@layer` |
| `src/hooks/useAppInitialization.ts` | Applies the active theme's CSS vars + font stack to `document.documentElement` |

## How it works
- These components are **pure props in / callbacks out** — they hold local interaction state (drag, edit, open) but never touch Zustand directly. Parents (panels, modals) wire `value`/`onChange` to the stores. See `state-stores` and `adjustments-ui`.
- **Theming is CSS-variable based.** `useAppInitialization` finds the active theme in `THEMES`, sets each `--app-*` var on `:root`, plus `--font-family`. `styles.css` `@theme` aliases those to Tailwind `--color-*`, so utility classes like `bg-surface`, `text-text-primary`, `border-border-color`, `bg-accent`, `bg-card-active`, `bg-bg-primary` resolve per-theme. No component hardcodes a hex color.
- **Tooltips are global.** `GlobalTooltip` is rendered once (at app root) and listens on `document` for `[data-tooltip]`. Any element gets a tooltip just by adding `data-tooltip={t('...')}` — there is no `<Tooltip>` wrapper.
- **Animation** uses `framer-motion` (`AnimatePresence` + `motion.div`); `Slider`'s value-settle uses a manual `requestAnimationFrame` ease (300ms), `Switch` uses a spring (stiffness 700, damping 30).
- **Class composition is `clsx`-only** — no CSS modules, no styled-components. The single global stylesheet is `styles.css`; per-component CSS that can't be a Tailwind utility (e.g. slider thumb pseudo-elements, gradient tracks) is declared there as a named class and applied via `className`/`trackClassName`.

## Key types & symbols
| symbol | kind | what |
|--------|------|------|
| `TextVariants` | const map | `displayLarge, display, headline, title, heading, body, label, small` → `VariantConfig` (size/weight/color/element/extraClasses) |
| `TEXT_COLOR_KEYS` | const map | `primary→text-text-primary`, `secondary→text-text-secondary`, `accent→text-accent`, `button→text-button-text`, `info→text-blue-400`, `success→text-green-400`, `error→text-red-400`, `white→text-white` |
| `TextColors` / `TextWeights` | const enums | pass these (not raw strings) to `<Text color=… weight=…>` |
| `THEMES` / `DEFAULT_THEME_ID` | const | 3 defined themes: `Dark` (default), `Light`, `Grey`, each with 10 `--app-*` vars |
| `Theme` | enum | 8 values (`Arctic, Blue, Dark, Grey, Light, MutedGreen, Sepia, Snow`) — but only Dark/Light/Grey have entries in `THEMES` |
| `Orientation` | enum | `Vertical`/`Horizontal` — drives `Resizer` cursor |
| `Invokes` / `Panel` / `GLOBAL_KEYS` | const/enum | the Tauri command-name enum, right-panel ids, and keys a focused range input blurs on |

## Conventions (follow these when coding here)
- **No native `<select>`** — use `Dropdown`. **No raw `<p>`/`<span>` for copy** — use `Text` with a `TextVariants.*` + `TextColors.*`.
- **Only theme tokens for color/surface**: `bg-surface`, `bg-bg-primary`, `bg-card-active`, `text-text-primary`, `text-text-secondary`, `text-accent`, `bg-accent`, `border-border-color`. Never raw `#hex` or `bg-gray-*` for chrome.
- **All user-facing strings go through `t()`** (react-i18next). `eslint-plugin-i18next`'s `no-literal-string` rule will flag literals. UI-primitive strings live under the `ui.*` namespace in `src/i18n/locales/*.json` (`ui.slider`, `ui.colorWheel`, `ui.collapsibleSection`).
- **Icons from `lucide-react`** (`size` + `className` props); brand icons from `simple-icons`.
- **Conditional classes via `clsx`**; disabled = `opacity-50 cursor-not-allowed`.
- **forwardRef + `displayName`** when a parent may need the DOM node (`Text`, `Input`).
- **Help text via `data-tooltip`**, not a wrapper component.
- **Interactive controls handle mouse AND touch**, and toggle `touchAction` during drags (see `Slider`).
- Prettier: 120 cols, single quotes, semicolons.

## Gotchas
- `Theme` enum has 8 members but `THEMES` only defines 3 (Dark/Light/Grey). Adding a new theme means adding **both** the enum value AND a full `THEMES` entry — otherwise `useAppInitialization` silently falls back to `DEFAULT_THEME_ID`.
- `styles.css` (not `vite.config.js`) is the Tailwind v4 source of truth: `@import 'tailwindcss'` + `@source not "../src-tauri"` (path is relative to `styles.css`) to skip scanning Rust. Slider thumb styling lives in `@utility slider-input` / `@layer components`; new utilities go here, not in a `tailwind.config`.
- `Slider.onChange` receives a **synthetic** `{ target: { value: number } }`, not a real DOM event — read `e.target.value` and coerce. The `value` prop animates to a settled `displayValue`; don't assume instant equality.
- `Slider` track color: pass `trackClassName` (e.g. `temperature-gradient-track`, `cg-hue-gradient`) to override the default `bg-card-active`.
- `ColorWheel` writes per-instance CSS vars `--cg-hue-${id}` / `--cg-sat-${id}` (id from `useId()` with colons stripped); only those two are set — the lum gradient derives from them. Wheel pointer is transparent below 5% saturation.
- `GlobalTooltip` must be mounted exactly **once** at app root. It dismisses on Escape, `scroll` (capture), and `mousedown`; it `requestAnimationFrame`-polls the target and hides if it leaves the DOM.
- `Dropdown` is generic over `<T extends React.Key>`; `options` are `{ label, value }`. Search resets on close; Enter selects only when exactly one option remains.
- `CollapsibleSection` animates inline `maxHeight` via a `ResizeObserver` on the content (not a Tailwind class) — content that resizes after mount stays correct.

## How to add a new UI primitive
1. Create `src/components/ui/<Name>.tsx`. Define a typed `Props` interface (no `any`); export default.
2. Style with Tailwind theme tokens only (`bg-surface`, `text-text-primary`, `border-border-color`, `bg-accent`). Use `clsx` for conditional/disabled classes.
3. For any text, import `Text` + `TextVariants`/`TextColors`/`TextWeights` from `../../types/typography` instead of raw elements.
4. Icons: import from `lucide-react` with `size`. Help text: add `data-tooltip={t('ui.<name>.<key>')}`.
5. Wrap every visible string in `t()` and add the key under `ui.<name>` in `src/i18n/locales/en.json` (run `npm run i18n:extract` to propagate keys to all 10 locales).
6. Animations: `framer-motion` `AnimatePresence` + `motion.div` with an explicit `transition` (`duration`/`ease` or a spring).
7. Interactive? Handle both pointer and touch; manage `touchAction`/`user-select` during drags; support Escape-to-close / Enter-to-confirm where relevant.
8. If you need a new shared enum/type (e.g. a `Panel` value or an `Invokes` command), add it to `src/components/ui/AppProperties.tsx`. For a new Tauri command also register it backend-side (see `backend`/`tauri-bridge`).
9. Compose existing primitives (e.g. `ColorWheel` reuses `Slider`; `Dropdown` reuses `Input`) rather than reimplementing behavior.

## Related skills
`frontend`, `state-stores`, `adjustments-ui`, `modals`, `editor-canvas`, `i18n`, `tauri-bridge`, `changelog`

## After changes
- `npm run typecheck` (tsc strict) and `npm run lint` (eslint, incl. `i18next/no-literal-string`) must pass.
- `npm run format` (prettier) before committing.
- If you added UI strings: `npm run i18n:extract`, then `npm run i18n:check`.
- If the change is user-visible, add a release-notes entry per the `changelog` skill.
