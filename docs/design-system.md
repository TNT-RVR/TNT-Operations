# TNT Pollination — Design System

Binding UI guidelines for TNT Operations. **Do not invent colours, type, spacing,
radii, or shadows outside the tokens.** The token layer is `src/styles/tokens.css`;
Tailwind maps to it in `tailwind.config.js`; primitives live in
`src/components/ui.tsx`. `npm run lint:tokens` guards against raw hex.

TNT Pollination is a leafcutter-bee pollination company built on quality,
technology, and data collection. The UI should read like **instrumentation**, not
a folksy honey brand.

## 1. Token layer

Everything references `var(--*)` from `src/styles/tokens.css`. **LIGHT is the
default as of 2026-08-27** — the tokens are still authored dark-first and
`.on-light` on the root element flips them, which is an implementation detail,
not a statement about which theme people see. Dark remains complete and is one
toggle away. Theme selection lives in `src/styles/theme.tsx` (`useTheme()` /
`<ThemeProvider>`), persisted per device on an actual choice and toggled from
**Users → Settings** and the header button.

Because the base sheet is dark, an inline script in `index.html` applies the
theme BEFORE paint; deciding it in React showed black on every cold load and
then snapped to white. That script repeats the storage key and the default by
hand — nothing from the bundle has loaded yet — and `themeBoot.test.ts` fails if
the two drift.

Never hardcode a hex in a component. Map new needs to a token first. The single
allowlisted exception is `src/features/maps/**`, where MapLibre paint requires
literal hex — keep those values aligned to token hex.

## 2. Colour

- **Dark by default.** `--bg-base` page, `--bg-surface` sticky headers/sidebars,
  `--bg-raised` cards, `--bg-inset`/`--bg-overlay` insets.
- **Honey is the only accent** (`--brand` = `#FEB836`). One primary honey element
  per view; everything else neutral ink. Field green is retired.
- **Borders** are always the white-alpha hairline tokens (`--border-subtle/default/
  strong`) — never solid grey.
- **Honey has TWO values, one per theme.** `--honey-500` (#FEB836) was picked
  against near-black and blazes there. On the light theme it sits at **1.66:1**
  against the page — under the 3:1 a control needs to read as a control — so
  the primary button became a pale shape people looked straight past. It was
  reported as "I can't find the add user button", which is the failure mode:
  no error, no crash, an invisible control. `.on-light` therefore maps `--brand`
  / `--text-brand` / `--border-brand` to `--honey-deep` (#9A6400, 4.8:1 on the
  page) and flips `--on-brand` to white. `brandContrast.test.ts` enforces
  3:1 for the button and 4.5:1 for label and brand text, in BOTH themes.
- **Status** greens/reds/blues are muted (`--ok/warn/danger/info-*`), never neon.
- The six-colour **data palette** (`--data-*`) is for charts only.

## 3. Type

**The system font stack — no downloaded webfonts.** Montserrat + IBM Plex were
tried and reverted (2026-08-04): they made the app feel unlike the rest of the
desktop, and the round trip to Google Fonts bought nothing.

- `font-display` and `font-sans` both resolve to `system-ui` (the tokens are kept
  separate so headings can diverge later without touching components).
- `font-mono` / `.tabular` — the system monospace. Reserve it for genuine
  telemetry readouts (a live sensor value, a coordinate dump), scanned
  identifiers echoed back (a tray label), coordinate inputs, and credentials.
  **Not for chrome.** Labels, eyebrows, table headers, badges and stat values
  were all mono until 2026-08-19, which put the furniture of every screen in
  Consolas while its content was Segoe UI — two typefaces per page, and the
  reason this app read as a different family from the other TNT/GFC apps. They
  moved to the SANS then, keeping UPPERCASE and wide tracking.
  **The caps went on 2026-08-27.** Wide-tracked capitals on every label, table
  header, badge and eyebrow made the app read as instrumentation — shouty, and
  technical in a way that suits a control panel more than a place someone works
  all day. Small and grey is enough hierarchy; it does not also need to shout.
- **Headings use NORMAL tracking.** They set `--ls-tight` (-0.015em) on every
  h1-h6 until 2026-08-27. Negative letter-spacing reads as "designed" on a
  marketing page and as cramped on a working screen; Segoe UI is already fairly
  tight, and pulling it in further is what made this app's type feel wrong next
  to the other TNT/GFC apps, which leave it alone. Line-height went 1.05 -> 1.2
  at the same time: 1.05 is a poster value and any heading that wrapped collided.
  **The typeface was never the difference** — RVR loads no webfont and resolves
  to the same physical face this does (verified 2026-08-27).
- **Buttons and inputs are `--text-sm` (14px), not body size.** Controls at 16px
  read heavy and dated; the rest of the family sets them a step down.
- **Numbers in a table column: use `tabular-nums`, not `font-mono`.**
  `tabular-nums` aligns the digits while keeping the body typeface;
  `font-mono`/`.tabular` also swap the *face*, which makes that column the only
  text on the page in a different font. This was a real bug in the Grants table.
- Eyebrows/labels/badges are SENTENCE CASE at `--text-xs` with `--ls-normal` —
  one size step up from the `--text-2xs` the caps sat at, because lowercase at
  11px is small. Headlines and UI copy are sentence case too. Nothing in the
  chrome is uppercase.

## 4. Layout & spacing

4px grid, tokens only (`--space-*`). Section padding `--space-16/20/24`. Content
maxes at `--container-max` (1200px), wide layouts `--container-wide`. Use flex/grid
with `gap`, not margins between siblings.

## 5. Cards & elevation

`background: var(--bg-raised)`, 1px `--border-subtle`, `--radius-lg` (18px).
Buttons/inputs use `--radius-sm` (6px). The scale was rounded up on 2026-08-27
and brought back down the same day: measuring the RVR app settled it, since its
controls are 6px and its cards 12px — TIGHTER than this app has ever been. What
read as hard-edged was the dark theme, the wide-tracked capitals and the
squeezed headings, not the radius. Elevation from `--shadow-*`; `--glow-brand`
reserved for the single most important element. Featured panels may carry a 2px
honey top edge (`<Card featured>`). Interactive cards lift `translateY(-2px)` and
brighten the border on hover (`<Card interactive>`).

## 6. Backgrounds

Flat near-black. The one signature texture is the **field wash** (`.field-wash`):
faint ~2% white horizontal lines evoking crop rows, behind heroes/section breaks.
**No honeycomb or hexagon motifs** (leafcutter bees don't build comb). No aggressive
gradients, no glassmorphism, no bluish-purple.

## 7. Interaction

- Hover: primary buttons → `--brand-hover`; ghost gains `--hover-wash`; cards lift.
- Press: `translateY(1px)`, `--brand-press`.
- Focus: 2px `--focus-ring`; inputs add a 3px `--brand-ring`.
- Transitions `--dur-fast` hover/press, `--dur-normal` toggles, `--dur-slow` bars;
  easing `--ease-standard` (or `--ease-out` for entrances). No bounce/springs.

## 8. Icons & imagery

- **Lucide** only, 2px stroke, no fill, `currentColor`; 16–20px inline, 24px
  standalone. Muted by default, honey when active. No emoji/unicode glyphs.
- The **bee mark** (`/bee.svg`, `<Logo>`) is the one brand glyph — logo, loading,
  empty states only; never a generic UI icon.
- Imagery: warm, high-contrast field/hive/hardware photography, duotoned toward ink
  + honey. No cool/blue casts, stock-corporate, or hand-drawn illustration.

## 9. Copy

Confident, technical, plain-spoken — operations + engineering, not a honey brand.
Active voice, verbs lead (deploy, monitor, harvest, measure, verify). The grower is
"you"; the company is "we/TNT". Numbers are the story — concrete figures with units
in mono (`94.2% fruit set`, `1,280 active hives`, `+3.1% vs. target`). Short
declarative sentences, one idea per line. Vocabulary: leafcutter bees, hives/nesting
blocks, fields, deployment, fruit set, pollination window, telemetry, coverage,
yield. No bee puns, no hype adjectives, no emoji — status is colour + dot + label.

## 10. Component primitives (`src/components/ui.tsx`)

`Button`, `IconButton`, `Input`, `Select`, `Checkbox`, `Switch`, `Stat`, `Badge`,
`Tag`, `ProgressBar`, `Card`, `Logo`, `Modal`, `PageHeader`, `SearchBar`,
`EmptyState`, `NoAccess`. `Gauge`/`StatTile` are kept as thin back-compat aliases
over `ProgressBar`/`Stat`. **`Stat` and `ProgressBar` matter most** — TNT is a
data-collection company, so metric readouts are the workhorse components.
