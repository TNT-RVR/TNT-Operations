/**
 * The Overall Checklist ↔ Google Sheets translation, as pure functions.
 *
 * Kept apart from the network so the part that can silently lose someone's work
 * — deciding which side of a disagreement wins — is testable without a Google
 * account. `checklist-sheet-sync.mjs` does the talking; this decides.
 *
 * ── What a cell means in the sheet ───────────────────────────────────────────
 *
 * One cell carries two facts. The DATE is when the step is planned or was done,
 * and the blue FILL is what makes it "done" — TNT has highlighted completed
 * cells blue since 2023. So a date on white is a plan, and the same date on
 * blue is a completion. Reading the value without the format loses half the
 * meaning, which is why the sync asks for grid data rather than plain values.
 *
 * ── Why a snapshot, and what "app wins" means ────────────────────────────────
 *
 * Two-way sync with only two values cannot tell "the sheet changed" from "the
 * app changed" — both look like a disagreement. So each row also stores what
 * the two sides agreed on at the END of the last sync. Then:
 *
 *   sheet ≠ snapshot  → the sheet changed
 *   app   ≠ snapshot  → the app changed
 *   both changed      → the APP wins (Tyler's call), sheet gets overwritten
 *   only one changed  → that side wins
 *   neither           → nothing to do
 *
 * Without the snapshot, "app wins" would have to mean "the app always wins",
 * and an edit made in the sheet would never come back — which is the other half
 * of what was asked for.
 */

/** Header text in the sheet → the step key stored in `field_checklist`. */
export const SHEET_COLUMNS = {
  flag: 'Flag',
  structures_in: 'Structures In',
  mouse_poison: 'Mouse Poison',
  bees_in: 'Bees In',
  structures_out: 'Structures Out',
}

/** The blue TNT fills a completed cell with (4A86E8), as Sheets floats. */
export const DONE_COLOR = { red: 74 / 255, green: 134 / 255, blue: 232 / 255 }

const norm = (s) => String(s ?? '').trim().toLowerCase()

/**
 * Sheets serial date → ISO day. Serial 1 is 1899-12-31 in Google's reckoning,
 * so the epoch is 1899-12-30; getting this wrong is the classic off-by-one (or
 * two) that shifts a whole season by a day.
 */
export function serialToIso(serial) {
  if (typeof serial !== 'number' || !Number.isFinite(serial)) return null
  const ms = Math.round(serial) * 86_400_000 + Date.UTC(1899, 11, 30)
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

/**
 * A cell's date, however it was typed. Real dates arrive as serials; text like
 * "Half- 7/16/2026" and "Most in June 29th" is left for the note — the sheet
 * carries genuine operational nuance in these, and inventing a date from
 * "Most in June 29th" would record something nobody said.
 */
export function parseSheetDate(cell) {
  if (!cell) return null
  const n = cell.effectiveValue?.numberValue
  if (typeof n === 'number') return serialToIso(n)
  const text = String(cell.formattedValue ?? '').trim()
  // An unambiguous ISO date typed by hand.
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (iso) return text
  // M/D/YYYY, the other shape that appears in these sheets.
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text)
  if (us) {
    const [, m, d, y] = us
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  return null
}

/** Free text in a cell that is NOT a date — belongs in the note. */
export function parseSheetNote(cell) {
  if (!cell) return ''
  if (typeof cell.effectiveValue?.numberValue === 'number') return ''
  const text = String(cell.formattedValue ?? '').trim()
  return parseSheetDate(cell) ? '' : text
}

/**
 * Is this fill the "done" blue?
 *
 * Deliberately tolerant. Three seasons of hand-highlighting produce several
 * near-identical blues, and Sheets returns floats that do not round-trip
 * exactly. The test is "clearly blue, clearly not white" rather than an
 * equality check that would silently read a slightly-off blue as not-done.
 */
export function isDoneBackground(color) {
  if (!color) return false
  const { red = 0, green = 0, blue = 0, alpha = 1 } = color
  if (alpha === 0) return false
  if (red > 0.9 && green > 0.9 && blue > 0.9) return false // white
  return blue > 0.5 && blue > red + 0.15 && blue > green + 0.1
}

/** One cell as the sheet has it. */
export function readSheetCell(cell) {
  const date = parseSheetDate(cell)
  const done = isDoneBackground(cell?.effectiveFormat?.backgroundColor)
  return {
    plannedDate: done ? null : date,
    completedDate: done ? date : null,
    note: parseSheetNote(cell),
  }
}

const same = (a, b) => (a ?? null) === (b ?? null)

/**
 * Decide one cell. `app` and `sheet` are `{plannedDate, completedDate}`;
 * `snapshot` is what they agreed on last time (null on the first ever sync).
 *
 * Returns `{ winner: 'app' | 'sheet' | 'none', value }` — `value` is what both
 * sides should end up holding.
 */
export function mergeCell(app, sheet, snapshot) {
  const a = { plannedDate: app?.plannedDate ?? null, completedDate: app?.completedDate ?? null }
  const s = { plannedDate: sheet?.plannedDate ?? null, completedDate: sheet?.completedDate ?? null }
  const snap = { plannedDate: snapshot?.plannedDate ?? null, completedDate: snapshot?.completedDate ?? null }

  const appChanged = !same(a.plannedDate, snap.plannedDate) || !same(a.completedDate, snap.completedDate)
  const sheetChanged = !same(s.plannedDate, snap.plannedDate) || !same(s.completedDate, snap.completedDate)

  if (!appChanged && !sheetChanged) return { winner: 'none', value: a }
  // Both moved: the app is the system of record, by decision. The sheet's
  // version is overwritten — which is why the sync logs what it replaced.
  if (appChanged && sheetChanged) return { winner: 'app', value: a }
  if (appChanged) return { winner: 'app', value: a }
  return { winner: 'sheet', value: s }
}

/**
 * Header row → which column index holds which step.
 *
 * Read rather than assumed: the 2023 sheet has a "Blocks" column the others
 * lack, so a fixed B–F mapping would write Bees In into Mouse Poison for that
 * year. Unknown headers (Gallons, Structures, Image, Type) are left alone —
 * the sync must not touch columns it does not own.
 */
export function mapColumns(headerRow) {
  const cells = headerRow?.values ?? []
  const byStep = {}
  cells.forEach((cell, i) => {
    const text = norm(cell?.formattedValue)
    for (const [step, label] of Object.entries(SHEET_COLUMNS)) {
      if (text === norm(label)) byStep[step] = i
    }
  })
  return byStep
}

/** Column index of the field name — column A unless the sheet says otherwise. */
export function fieldNameColumn(headerRow) {
  const cells = headerRow?.values ?? []
  const i = cells.findIndex((c) => norm(c?.formattedValue) === 'field name')
  return i >= 0 ? i : 0
}

/**
 * Sheet grid → `{ fieldName, rowIndex, cells: { step: {plannedDate,...} } }`.
 * Rows with no name are skipped: these sheets run to ~1000 rows, nearly all
 * empty padding.
 */
export function readGrid(gridData) {
  const rows = gridData?.rowData ?? []
  if (rows.length === 0) return { columns: {}, nameCol: 0, rows: [] }
  const columns = mapColumns(rows[0])
  const nameCol = fieldNameColumn(rows[0])
  const out = []
  for (let r = 1; r < rows.length; r++) {
    const values = rows[r]?.values ?? []
    const fieldName = String(values[nameCol]?.formattedValue ?? '').trim()
    if (!fieldName) continue
    const cells = {}
    for (const [step, col] of Object.entries(columns)) cells[step] = readSheetCell(values[col])
    out.push({ fieldName, rowIndex: r, cells })
  }
  return { columns, nameCol, rows: out }
}

/**
 * Map key for one field × one step. The separator is the ASCII unit separator,
 * built with fromCharCode rather than written as an escape: field names carry
 * spaces, dashes and '#', so any printable delimiter can be produced by a name
 * and collide with a different pair.
 */
const KEY_SEP = String.fromCharCode(31)
export const rowKey = (fieldName, step) => `${fieldName}${KEY_SEP}${step}`
export function splitKey(key) {
  const i = key.indexOf(KEY_SEP)
  return i < 0 ? [key, ''] : [key.slice(0, i), key.slice(i + 1)]
}
