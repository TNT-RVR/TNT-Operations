/**
 * Shelter-position grid engine — the port target for `maketentgrid.py`
 * (`get_tent_positions()`) from the old beetent-maps app.
 *
 * ── PORT PLAN (Phase 2) ──────────────────────────────────────────────────────
 * `maketentgrid.py` is the ~single most valuable piece of the old app: given a
 * field boundary (pivot circle or polygon) + bay presets, it computes shelter
 * pin positions. Port it here as pure functions, then LOCK IT with tests:
 *   1. Take 5–10 real fields from `beetent-maps/fields/*.json`.
 *   2. Run them through the OLD Python to capture expected pin coordinates.
 *   3. Assert this TypeScript reproduces those coordinates (within ~1 m).
 * That golden-file test is the safety net for the whole map feature.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { LngLat } from './geo'

export interface PivotField {
  center: LngLat
  radiusMeters: number
}

/** Placeholder — real implementation ported in Phase 2 (see header). */
export function getTentPositions(_field: PivotField): LngLat[] {
  throw new Error('getTentPositions: not ported yet — see PORT PLAN in tentGrid.ts (Phase 2)')
}
