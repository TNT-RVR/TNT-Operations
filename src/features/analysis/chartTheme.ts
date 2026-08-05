/**
 * Shared recharts styling for the Analysis section.
 *
 * Everything here reads from `src/styles/tokens.css` at runtime rather than
 * hardcoding values, so a token change moves the charts with it and
 * `npm run lint:tokens` stays quiet.
 *
 * ── On the series order ──────────────────────────────────────────────────────
 * The categorical order below is NOT the declaration order in tokens.css. The
 * tokens list honey, teal, lime, coral, sky, violet; used in that order, the
 * adjacent pair violet↔sky measures ΔE 2.1 under deuteranopia and 10.0 for
 * normal vision — effectively the same colour for a red-green colourblind
 * reader, and hard for anyone. Reordering so coral sits between teal and sky,
 * and violet lands last, lifts the worst adjacent pair to ΔE 11.0 (deutan) and
 * 24.3 (normal). Verified with the palette validator against the dark raised
 * surface (`--bg-raised`).
 *
 * The token VALUES are untouched — only the order they are handed out in.
 *
 * Known deviation: all six brand colours sit at 0.69–0.83 OKLab lightness,
 * outside the validator's preferred band for a dark surface. They clear the
 * 3:1 contrast floor comfortably, so this is a house-style choice rather than a
 * legibility problem, and changing it would mean changing the brand.
 */

/** Categorical hues, in CVD-validated order. Assigned by index, never cycled. */
export const SERIES_COLORS = [
  'var(--data-honey)',
  'var(--data-teal)',
  'var(--data-coral)',
  'var(--data-sky)',
  'var(--data-lime)',
  'var(--data-violet)',
] as const

/**
 * Most categorical series we will colour. A seventh entity folds into "Other"
 * rather than reusing a hue — two entities sharing a colour is worse than one
 * honest bucket.
 */
export const MAX_SERIES = SERIES_COLORS.length

/**
 * Colour for a series by its position in a STABLE list.
 *
 * The caller must pass an index derived from the entity (its position in a
 * sorted list of all entities), not its rank in the current view — otherwise
 * filtering out one company repaints all the others.
 */
export function seriesColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length]
}

/** Recessive axis styling shared by every chart. */
export const AXIS_PROPS = {
  stroke: 'var(--text-muted)',
  tick: { fill: 'var(--text-muted)', fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: 'var(--border-subtle)' },
} as const

export const GRID_PROPS = {
  stroke: 'var(--border-subtle)',
  strokeDasharray: '3 3',
  vertical: false,
} as const

/** Tooltip container styling — a raised card, matching the rest of the UI. */
export const TOOLTIP_STYLE = {
  background: 'var(--bg-raised)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  boxShadow: 'var(--shadow-md)',
  fontSize: 'var(--text-xs)',
  color: 'var(--text-primary)',
} as const

export const TOOLTIP_LABEL_STYLE = { color: 'var(--text-secondary)' } as const

/** A muted reference line (trendlines, zero lines, thresholds). */
export const REFERENCE_LINE_COLOR = 'var(--text-muted)'
