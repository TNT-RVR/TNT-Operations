import type { FieldDict } from './tentGrid'

/**
 * Pure, parameter-only sanity checks on a field dict → list of human-readable
 * warning strings (empty = looks fine). Faithful port of the old app's
 * `field_warnings` (maketentgrid.py) — catches the class of data-entry bug
 * where a stray value silently produces a broken grid (a bay_gap collapsing a
 * bay, a total_rows that can't fit one bay unit) BEFORE saving. The UI adds
 * compute-based checks (zero shelters placed) on top of this.
 */
export function fieldWarnings(field: FieldDict): string[] {
  const w: string[] = []

  const num = (key: string, dflt = 0): number | null => {
    const raw = field[key]
    const v = raw === undefined || raw === null || raw === '' ? dflt : Number(raw)
    return Number.isFinite(v) ? v : null
  }

  const bp = (field['boundary_polygon'] as unknown[] | null) || []
  if (bp.length > 0 && bp.length < 3) {
    w.push("Boundary has fewer than 3 points — a grid can't be generated.")
  }

  let useBays: unknown = field['use_bays'] ?? true
  if (typeof useBays === 'string') {
    useBays = !['false', '0', 'no', ''].includes(useBays.trim().toLowerCase())
  }
  if (!useBays) return w // blanket-planted: no bay params to check

  const nfRaw = num('num_female_rows')
  const nmRaw = num('num_male_rows')
  const rs = num('row_spacing_in')
  const gap = num('bay_gap_in')
  if (nmRaw === null || nfRaw === null || rs === null) {
    w.push("Bay rows / row spacing aren't numeric.")
    return w
  }
  const nf = Math.trunc(nfRaw)
  const nm = Math.trunc(nmRaw)
  const trRaw = num('total_rows', nf + nm)
  const tr = trRaw ? Math.trunc(trRaw) : nf + nm

  if (rs <= 0) w.push('Row spacing is 0.')
  if (nm <= 0) w.push('No male rows set — there are no male bays to place shelters against.')
  if (nf < 0) w.push('Female rows is negative.')
  if (nf + nm > 0 && tr < nf + nm) {
    w.push(`Total rows (${tr}) is smaller than one bay unit (${nf}F+${nm}M = ${nf + nm} rows).`)
  }
  const cm = String(field['custom_row_mask'] ?? '')
    .toUpperCase()
    .split('')
    .filter((c) => c === 'M' || c === 'F')
    .join('')
  if (String(field['row_layout'] ?? '') === 'custom' && cm && cm.length !== tr) {
    w.push(`Custom mask is ${cm.length} rows but Total rows is ${tr}; the mask length (${cm.length}) will be used.`)
  }
  // A gap ≥ the female-bay width leaves no room for female rows between bays.
  if (gap && rs && nf > 0 && 2 * gap >= nf * rs) {
    w.push(
      `Bay gap (${gap.toFixed(0)} in each side) is as wide as the female bay (${(nf * rs).toFixed(0)} in) — bays will nearly touch.`,
    )
  }
  return w
}
