/**
 * Google Sheets mechanics, with nothing about any particular sheet in them.
 *
 * Everything here is the part that is identical whichever sheet you are syncing:
 * fetching a grid WITH its formatting, creating a season tab, appending a row,
 * writing values, and painting a cell. What a cell MEANS stays in the per-sheet
 * adapter — see `checklistSync.mjs` for the shape one takes.
 *
 * Auth is the service account in `googleServiceAccount.mjs`.
 */
import { getAccessToken } from './googleServiceAccount.mjs'

const API = 'https://sheets.googleapis.com/v4/spreadsheets'

/** Grid data plus the formatting, which for these sheets is half the data. */
const GRID_FIELDS =
  'sheets(properties(sheetId,title,gridProperties(rowCount)),data(rowData(values(formattedValue,effectiveValue,effectiveFormat(backgroundColor)))))'

async function google(url, init = {}) {
  const token = await getAccessToken()
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  const text = await res.text()
  let body
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    body = { raw: text }
  }
  if (!res.ok) {
    const err = new Error(body?.error?.message || `Sheets ${res.status}`)
    err.status = res.status
    err.body = body
    throw err
  }
  return body
}

/** Column index → letter. 0 → A, 25 → Z, 26 → AA. */
export function colLetter(i) {
  let s = ''
  for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s
  return s
}

/** Every tab's title and id, cheaply. */
export async function listTabs(spreadsheetId) {
  const doc = await google(`${API}/${spreadsheetId}?fields=sheets(properties(sheetId,title))`)
  return (doc.sheets ?? []).map((s) => ({ id: s.properties.sheetId, title: String(s.properties.title) }))
}

/** One tab's grid, or null when the tab does not exist. */
export async function getGrid(spreadsheetId, tabTitle) {
  try {
    const doc = await google(
      `${API}/${spreadsheetId}?includeGridData=true&ranges=${encodeURIComponent(`${tabTitle}!A1:Z1000`)}&fields=${GRID_FIELDS}`,
    )
    const sheet = doc.sheets?.[0]
    return { sheetId: sheet?.properties?.sheetId, title: sheet?.properties?.title, data: sheet?.data?.[0] }
  } catch (e) {
    if (/Unable to parse range/i.test(e.message)) return null
    throw e
  }
}

/**
 * Make sure a season's tab exists, creating it from the most recent existing
 * season if not.
 *
 * A new year otherwise means someone remembering to duplicate last year's tab
 * in January — and the sync quietly doing nothing until they do. The header is
 * COPIED rather than generated so the columns this sync does not own (Gallons,
 * Structures, Image, Type) come along, in TNT's own order.
 *
 * Returns `{ sheetId, created }`.
 */
export async function ensureSeasonTab(spreadsheetId, year) {
  const tabs = await listTabs(spreadsheetId)
  const existing = tabs.find((t) => t.title === String(year))
  if (existing) return { sheetId: existing.id, created: false }

  // The most recent season that DOES exist, to copy a header from. Seasons are
  // four-digit titles; anything else in the workbook is left out of this.
  const seasons = tabs.filter((t) => /^\d{4}$/.test(t.title)).sort((a, b) => b.title.localeCompare(a.title))
  const source = seasons[0]

  const added = await google(`${API}/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [
        {
          addSheet: {
            // Index 0: seasons read newest-first in these workbooks, and a new
            // year appearing at the far right is a year nobody notices.
            properties: { title: String(year), index: 0, gridProperties: { rowCount: 1000, columnCount: 26 } },
          },
        },
      ],
    }),
  })
  const sheetId = added.replies?.[0]?.addSheet?.properties?.sheetId

  if (source) {
    const header = await google(
      `${API}/${spreadsheetId}/values/${encodeURIComponent(`${source.title}!A1:Z1`)}`,
    ).catch(() => null)
    const values = header?.values?.[0]
    if (values?.length) {
      await google(
        `${API}/${spreadsheetId}/values/${encodeURIComponent(`${year}!A1`)}?valueInputOption=RAW`,
        { method: 'PUT', body: JSON.stringify({ values: [values] }) },
      )
    }
  }
  return { sheetId, created: true, copiedFrom: source?.title ?? null }
}

/** Write individual cells. `updates` are `{ range, value }`, range A1-style. */
export async function writeValues(spreadsheetId, updates) {
  if (updates.length === 0) return
  await google(`${API}/${spreadsheetId}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      valueInputOption: 'USER_ENTERED',
      data: updates.map((u) => ({ range: u.range, values: [[u.value]] })),
    }),
  })
}

/** Paint cells. `cells` are `{ sheetId, rowIndex, col, color }` (color: null = white). */
export async function setBackgrounds(spreadsheetId, cells) {
  if (cells.length === 0) return
  await google(`${API}/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: cells.map((c) => ({
        repeatCell: {
          range: {
            sheetId: c.sheetId,
            startRowIndex: c.rowIndex,
            endRowIndex: c.rowIndex + 1,
            startColumnIndex: c.col,
            endColumnIndex: c.col + 1,
          },
          cell: { userEnteredFormat: { backgroundColor: c.color ?? { red: 1, green: 1, blue: 1 } } },
          fields: 'userEnteredFormat.backgroundColor',
        },
      })),
    }),
  })
}

/**
 * Add rows at the bottom of a tab and report where they landed, so the caller
 * can write into them in the same pass.
 *
 * Appending matters as much as updating: a field added to the map after the
 * season started has no line in the sheet, and without this its marks could
 * never be pushed out — they would look synced from the app and be missing from
 * the spreadsheet everyone else reads.
 */
export async function appendRows(spreadsheetId, tabTitle, rows) {
  if (rows.length === 0) return []
  const res = await google(
    `${API}/${spreadsheetId}/values/${encodeURIComponent(`${tabTitle}!A1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values: rows.map((r) => [r]) }) },
  )
  const firstRow = firstRowIndexOf(res.updates?.updatedRange)
  return rows.map((name, i) => ({ name, rowIndex: firstRow === null ? null : firstRow + i }))
}

/**
 * Where an append landed: `"'2027'!A16:A17"` → 15, zero-based.
 *
 * Exported because it is the one piece of `appendRows` that can be wrong
 * silently — an off-by-one here writes a field's marks onto the row above it,
 * which reads as data corruption rather than as a bug in a range parser.
 */
export function firstRowIndexOf(updatedRange) {
  const m = /![A-Z]+(\d+)/.exec(String(updatedRange ?? ''))
  return m ? Number(m[1]) - 1 : null
}
