# TNT Pollination — Design System

Binding UI guidelines for TNT Operations. **Do not invent colours, type, spacing,
radii, or shadows outside the tokens.** The token layer is `src/styles/tokens.css`;
Tailwind maps to it in `tailwind.config.js`; primitives live in
`src/components/ui.tsx`. `npm run lint:tokens` guards against raw hex.

TNT Pollination is a leafcutter-bee pollination company built on quality,
technology, and data collection. The UI should read like **instrumentation**, not
a folksy honey brand.

## 1. Token layer

Everything references `var(--*)` from `src/styles/tokens.css`. Dark is the default;
`.on-light` on the root element flips the semantic tokens. Theme selection lives in
`src/styles/theme.tsx` (`useTheme()` / `<ThemeProvider>`), persisted per device and
toggled from **Users → Settings** and the header button.

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
Buttons/inputs use `--radius-sm` (10px). The whole radius scale moved up a step
on 2026-08-27 rather than special-casing components: buttons and inputs sat at
6px against a 48px touch target, which reads as a box with its corners filed. Elevation from `--shadow-*`; `--glow-brand`
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
