/**
 * The Overall Checklist adapter: one sheet's worth of meaning.
 *
 * Everything generic — auth, grids, tabs, appends, painting — is in
 * `sheets.mjs`; everything about how a checklist cell reads is in
 * `checklistSheet.mjs`. This file is the ~150 lines in between, and it is the
 * template for the next sheet TNT wants synced. See `sheetSyncs.mjs` for how
 * one is registered and `docs/checklist-sheet-sync.md` for the contract.
 *
 * What an adapter owes the registry:
 *   name, label, env var holding the spreadsheet id, and `run({ year })`
 *   returning `{ ok, toApp, toSheet, ... }`.
 */
import { appendRows, colLetter, ensureSeasonTab, getGrid, setBackgrounds, writeValues } from './sheets.mjs'
import { DONE_COLOR, mergeCell, readGrid, rowKey, SHEET_COLUMNS, splitKey } from './checklistSheet.mjs'

const TABLE = 'field_checklist'

const restHeaders = () => {
  const key = process.env.SUPABASE_SERVICE_ROLE
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
}

export const checklistSync = {
  name: 'checklist',
  label: 'Overall Checklist',
  sheetIdEnv: 'CHECKLIST_SHEET_ID',

  async run({ year }) {
    const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    const SHEET_ID = process.env[this.sheetIdEnv]
    if (!SB_URL || !process.env.SUPABASE_SERVICE_ROLE) throw Object.assign(new Error('Supabase not configured'), { status: 500 })
    if (!SHEET_ID) throw Object.assign(new Error(`Not configured (${this.sheetIdEnv})`), { status: 501 })

    // A season nobody has made a tab for yet — including a brand-new year —
    // gets one, with last season's header copied so the columns this sync does
    // not own come along in TNT's own order.
    const { created, copiedFrom } = await ensureSeasonTab(SHEET_ID, year)
    const grid = await getGrid(SHEET_ID, String(year))
    if (!grid) throw Object.assign(new Error(`Could not open the ${year} tab`), { status: 502 })
    const parsed = readGrid(grid.data)

    // ── The app's side ───────────────────────────────────────────────────────
    const rest = restHeaders()
    const dbRes = await fetch(`${SB_URL}/rest/v1/${TABLE}?year=eq.${encodeURIComponent(year)}&select=*`, { headers: rest })
    if (!dbRes.ok) throw Object.assign(new Error(`Supabase read failed (${dbRes.status})`), { status: 502 })
    const dbRows = await dbRes.json()

    const dbByKey = new Map(dbRows.map((r) => [rowKey(r.field_name, r.step), r]))
    const sheetByKey = new Map()
    const rowOfName = new Map()
    for (const row of parsed.rows) {
      rowOfName.set(row.fieldName, row.rowIndex)
      for (const [step, cell] of Object.entries(row.cells)) sheetByKey.set(rowKey(row.fieldName, step), cell)
    }

    // A field the app knows about with no line in the sheet gets one, or its
    // marks could never be pushed out — synced from the app's side and missing
    // from the spreadsheet everyone else reads.
    const wantedNames = [...new Set(dbRows.map((r) => r.field_name))]
    const missing = wantedNames.filter((n) => !rowOfName.has(n))
    if (missing.length > 0) {
      const added = await appendRows(SHEET_ID, String(year), missing)
      for (const a of added) if (a.rowIndex !== null) rowOfName.set(a.name, a.rowIndex)
    }

    // ── Merge ────────────────────────────────────────────────────────────────
    const upserts = []
    const valueWrites = []
    const fillWrites = []
    const columns = Object.keys(parsed.columns).length ? parsed.columns : defaultColumns()

    for (const key of new Set([...dbByKey.keys(), ...sheetByKey.keys()])) {
      const [fieldName, step] = splitKey(key)
      if (!(step in SHEET_COLUMNS)) continue
      const db = dbByKey.get(key)
      const sh = sheetByKey.get(key)
      const app = db ? { plannedDate: db.planned_date, completedDate: db.completed_date } : null
      const snapshot = db ? { plannedDate: db.synced_planned_date, completedDate: db.synced_completed_date } : null
      const { winner, value } = mergeCell(app, sh, snapshot)

      const sheetNote = sh?.note ?? ''
      const agreementMoved =
        !db || db.synced_planned_date !== value.plannedDate || db.synced_completed_date !== value.completedDate
      if (winner === 'sheet' || agreementMoved || (sheetNote && sheetNote !== db?.note)) {
        upserts.push({
          year: String(year),
          field_name: fieldName,
          step,
          planned_date: value.plannedDate,
          completed_date: value.completedDate,
          note: winner === 'sheet' && sheetNote ? sheetNote : (db?.note ?? ''),
          shelter_field_id: db?.shelter_field_id ?? null,
          synced_planned_date: value.plannedDate,
          synced_completed_date: value.completedDate,
          synced_at: new Date().toISOString(),
        })
      }

      const col = columns[step]
      const rowIndex = rowOfName.get(fieldName)
      const sheetDiffers =
        (sh?.plannedDate ?? null) !== value.plannedDate || (sh?.completedDate ?? null) !== value.completedDate
      if (winner === 'app' && sheetDiffers && col !== undefined && rowIndex !== undefined) {
        valueWrites.push({
          range: `${year}!${colLetter(col)}${rowIndex + 1}`,
          value: value.completedDate ?? value.plannedDate ?? '',
        })
        fillWrites.push({
          sheetId: grid.sheetId,
          rowIndex,
          col,
          // Completed goes blue, planned back to white — TNT's own convention,
          // so a synced cell is indistinguishable from a hand-marked one.
          color: value.completedDate ? DONE_COLOR : null,
        })
      }
    }

    if (upserts.length > 0) {
      const up = await fetch(`${SB_URL}/rest/v1/${TABLE}?on_conflict=year,field_name,step`, {
        method: 'POST',
        headers: { ...rest, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(upserts),
      })
      if (!up.ok) {
        const text = await up.text().catch(() => '')
        throw Object.assign(new Error(`Supabase write failed (${up.status}). ${text.slice(0, 200)}`), { status: 502 })
      }
    }

    await writeValues(SHEET_ID, valueWrites)
    await setBackgrounds(SHEET_ID, fillWrites)

    return {
      ok: true,
      year: String(year),
      toApp: upserts.length,
      toSheet: valueWrites.length,
      rowsAdded: missing.length,
      tabCreated: created ? { copiedFrom } : null,
    }
  },
}

/** A tab created from nothing has the header we just wrote; use its order. */
function defaultColumns() {
  const out = {}
  Object.keys(SHEET_COLUMNS).forEach((step, i) => (out[step] = i + 1))
  return out
}
