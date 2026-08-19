/**
 * Two-way sync: Overall Checklist ↔ the "Checklist" Google Sheet.
 *
 * Runs on a schedule, and on demand from the Sync now button. One pass per
 * season tab:
 *
 *   1. read the sheet's grid (values AND fill colours — the blue IS the data)
 *   2. read this season's marks from Supabase, with the snapshot of what the
 *      two sides agreed on last time
 *   3. merge cell by cell (`lib/checklistSheet.mjs` — app wins a true conflict)
 *   4. write the losers: changed cells back to the sheet, changed cells into
 *      the database, and the new agreement into the snapshot
 *
 * ── Two things it deliberately does not do ───────────────────────────────────
 *
 * It does not touch columns it does not own. Gallons, Structures, Image and
 * Type live in the same sheet and belong to whoever has always maintained them.
 *
 * It does not delete rows. A field removed from the season's map stays in the
 * sheet, because the sheet is also TNT's history and a row silently vanishing
 * from a 2024 tab would be indistinguishable from a bug.
 *
 *   POST /.netlify/functions/checklist-sheet-sync        → sync current season
 *   POST … { "year": "2025" }                            → one other season
 *   Authorization: Bearer <a signed-in user's token>     (manual runs only)
 *
 * Env (Netlify, server-side only):
 *   GOOGLE_SERVICE_ACCOUNT  — service-account key JSON; share the sheet with
 *                             its client_email as an Editor
 *   CHECKLIST_SHEET_ID      — the spreadsheet id
 *   SUPABASE_SERVICE_ROLE / SUPABASE_URL
 */
import { getAccessToken } from './lib/googleServiceAccount.mjs'
import { DONE_COLOR, mergeCell, readGrid, rowKey, SHEET_COLUMNS, splitKey } from './lib/checklistSheet.mjs'

export const config = { schedule: '*/30 * * * *' }

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets'
const json = (body, status) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const colLetter = (i) => {
  let s = ''
  for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s
  return s
}

/**
 * The work itself, exported so the manual door (checklist-sync-now.mjs) can run
 * it too. Netlify refuses HTTP invocation of anything declaring a schedule, so
 * a "Sync now" button pointed here would get a bodiless 403 — the poll-govee /
 * poll-now shape exists for exactly this reason.
 */
export async function runChecklistSync(year) {
  const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const SB_KEY = process.env.SUPABASE_SERVICE_ROLE
  const SHEET_ID = process.env.CHECKLIST_SHEET_ID
  if (!SB_URL || !SB_KEY) return json({ error: 'Not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE)' }, 500)
  if (!SHEET_ID) return json({ error: 'Not configured (CHECKLIST_SHEET_ID)' }, 501)
  if (!process.env.GOOGLE_SERVICE_ACCOUNT) return json({ error: 'Not configured (GOOGLE_SERVICE_ACCOUNT)' }, 501)

  const rest = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' }

  try {
    const token = await getAccessToken()
    const google = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

    // ── 1. The sheet, with formatting ────────────────────────────────────────
    const gridRes = await fetch(
      `${SHEETS}/${SHEET_ID}?includeGridData=true&ranges=${encodeURIComponent(`${year}!A1:Z1000`)}` +
        '&fields=sheets(properties(sheetId,title),data(rowData(values(formattedValue,effectiveValue,effectiveFormat(backgroundColor)))))',
      { headers: google },
    )
    if (!gridRes.ok) {
      const text = await gridRes.text().catch(() => '')
      if (gridRes.status === 403) {
        return json({ error: 'The service account cannot open that sheet — share it with its email as an Editor.' }, 403)
      }
      // A season with no tab yet is not an error; there is simply nothing to sync.
      if (/Unable to parse range/i.test(text)) return json({ ok: true, year, skipped: 'no tab for that season' }, 200)
      return json({ error: `Sheets read failed (${gridRes.status}). ${text.slice(0, 200)}` }, 502)
    }
    const doc = await gridRes.json()
    const sheet = doc.sheets?.[0]
    const grid = readGrid(sheet?.data?.[0])
    const sheetId = sheet?.properties?.sheetId

    // ── 2. This season's marks ───────────────────────────────────────────────
    const dbRes = await fetch(`${SB_URL}/rest/v1/field_checklist?year=eq.${encodeURIComponent(year)}&select=*`, {
      headers: rest,
    })
    if (!dbRes.ok) return json({ error: `Supabase read failed (${dbRes.status})` }, 502)
    const dbRows = await dbRes.json()

    const dbByKey = new Map()
    for (const r of dbRows) dbByKey.set(rowKey(r.field_name, r.step), r)

    const sheetByKey = new Map()
    for (const row of grid.rows) {
      for (const [step, cell] of Object.entries(row.cells)) {
        sheetByKey.set(rowKey(row.fieldName, step), { ...cell, rowIndex: row.rowIndex, fieldName: row.fieldName })
      }
    }

    // ── 3. Merge ─────────────────────────────────────────────────────────────
    const upserts = []
    const sheetWrites = [] // { rowIndex, col, value, done }
    const keys = new Set([...dbByKey.keys(), ...sheetByKey.keys()])

    for (const key of keys) {
      const [fieldName, step] = splitKey(key)
      if (!(step in SHEET_COLUMNS)) continue
      const db = dbByKey.get(key)
      const sh = sheetByKey.get(key)
      const app = db ? { plannedDate: db.planned_date, completedDate: db.completed_date } : null
      const snapshot = db ? { plannedDate: db.synced_planned_date, completedDate: db.synced_completed_date } : null
      const { winner, value } = mergeCell(app, sh, snapshot)

      const noteFromSheet = sh?.note ?? ''
      const needsDbWrite =
        winner === 'sheet' ||
        !db ||
        db.synced_planned_date !== value.plannedDate ||
        db.synced_completed_date !== value.completedDate ||
        (noteFromSheet && noteFromSheet !== db.note)

      if (needsDbWrite) {
        upserts.push({
          year,
          field_name: fieldName,
          step,
          planned_date: value.plannedDate,
          completed_date: value.completedDate,
          note: winner === 'sheet' && noteFromSheet ? noteFromSheet : (db?.note ?? ''),
          // The new agreement. Written in the same statement as the value, so a
          // crash between them cannot leave a snapshot claiming agreement that
          // was never reached.
          synced_planned_date: value.plannedDate,
          synced_completed_date: value.completedDate,
          synced_at: new Date().toISOString(),
        })
      }

      const col = grid.columns[step]
      const sheetDiffers =
        (sh?.plannedDate ?? null) !== value.plannedDate || (sh?.completedDate ?? null) !== value.completedDate
      if (winner === 'app' && sheetDiffers && col !== undefined && sh?.rowIndex !== undefined) {
        sheetWrites.push({
          rowIndex: sh.rowIndex,
          col,
          value: value.completedDate ?? value.plannedDate ?? '',
          done: Boolean(value.completedDate),
        })
      }
    }

    // ── 4a. Into Supabase ────────────────────────────────────────────────────
    if (upserts.length > 0) {
      const up = await fetch(`${SB_URL}/rest/v1/field_checklist?on_conflict=year,field_name,step`, {
        method: 'POST',
        headers: { ...rest, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(upserts),
      })
      if (!up.ok) {
        const text = await up.text().catch(() => '')
        return json({ error: `Supabase write failed (${up.status}). ${text.slice(0, 200)}` }, 502)
      }
    }

    // ── 4b. Back into the sheet ──────────────────────────────────────────────
    if (sheetWrites.length > 0 && sheetId !== undefined) {
      // Values first, then the fills. Both are batched: a season is hundreds of
      // cells and one request each keeps this well inside the rate limits.
      const valueRes = await fetch(`${SHEETS}/${SHEET_ID}/values:batchUpdate`, {
        method: 'POST',
        headers: google,
        body: JSON.stringify({
          valueInputOption: 'USER_ENTERED',
          data: sheetWrites.map((w) => ({
            range: `${year}!${colLetter(w.col)}${w.rowIndex + 1}`,
            values: [[w.value]],
          })),
        }),
      })
      if (!valueRes.ok) {
        const text = await valueRes.text().catch(() => '')
        return json({ error: `Sheets write failed (${valueRes.status}). ${text.slice(0, 200)}` }, 502)
      }

      const fillRes = await fetch(`${SHEETS}/${SHEET_ID}:batchUpdate`, {
        method: 'POST',
        headers: google,
        body: JSON.stringify({
          requests: sheetWrites.map((w) => ({
            repeatCell: {
              range: {
                sheetId,
                startRowIndex: w.rowIndex,
                endRowIndex: w.rowIndex + 1,
                startColumnIndex: w.col,
                endColumnIndex: w.col + 1,
              },
              // Completed goes blue, planned goes back to white — the same
              // convention the sheet has used since 2023, so a person reading
              // it sees no difference between a hand mark and a synced one.
              cell: { userEnteredFormat: { backgroundColor: w.done ? DONE_COLOR : { red: 1, green: 1, blue: 1 } } },
              fields: 'userEnteredFormat.backgroundColor',
            },
          })),
        }),
      })
      if (!fillRes.ok) {
        const text = await fillRes.text().catch(() => '')
        return json({ error: `Sheets format failed (${fillRes.status}). ${text.slice(0, 200)}` }, 502)
      }
    }

    console.info(`[checklist-sheet-sync] ${year}: ${upserts.length} into the app, ${sheetWrites.length} into the sheet`)
    return json({ ok: true, year, toApp: upserts.length, toSheet: sheetWrites.length }, 200)
  } catch (e) {
    console.error('[checklist-sheet-sync]', e)
    return json({ error: e instanceof Error ? e.message : 'Sync failed' }, 500)
  }
}

/** The schedule: every half hour, this season only. */
export default async () => {
  const year = String(new Date().getFullYear())
  return runChecklistSync(year)
}
