/**
 * Every Google Sheet this app syncs with, in one list.
 *
 * TNT runs on spreadsheets, and the checklist is the first of several. So the
 * plumbing is shared and a sheet is a small ADAPTER registered here, rather than
 * each one growing its own scheduled function, its own HTTP door, its own auth
 * and its own half-remembered conflict rule.
 *
 * ── Adding a sheet ───────────────────────────────────────────────────────────
 *
 * 1. Write `lib/<thing>Sync.mjs` exporting an object with:
 *
 *      name        stable id, used in the URL and the button
 *      label       what a person calls it
 *      sheetIdEnv  the Netlify variable holding its spreadsheet id
 *      run({ year })  → { ok, toApp, toSheet, ... }
 *
 *    `sheets.mjs` gives you the mechanics: read a grid with its formatting,
 *    create a season tab from last year's header, append rows, write values,
 *    paint cells. Copy `checklistSync.mjs` — it is deliberately the size it is.
 *
 * 2. Add it to `SYNCS` below.
 * 3. Set its `sheetIdEnv` in Netlify and share that sheet with the SAME service
 *    account. One robot, many sheets — nothing new to create per sheet.
 *
 * That is the whole checklist. The schedule picks it up automatically, and the
 * Sync now door accepts its `name` with no code change.
 *
 * ── What every sync should keep ──────────────────────────────────────────────
 *
 * The rules below are not the checklist's; they are what made it survivable, and
 * a new adapter that drops one will lose someone's work quietly:
 *
 *   - store the agreement snapshot, so "changed" is knowable and one side's
 *     edit does not have to be assumed;
 *   - find columns by HEADER TEXT, never by position;
 *   - never touch a column you do not own, and never delete a row;
 *   - carry the formatting if the sheet uses it to mean something.
 */
import { checklistSync } from './checklistSync.mjs'

export const SYNCS = {
  [checklistSync.name]: checklistSync,
}

/** Registered syncs that are actually configured, i.e. have a sheet id set. */
export function configuredSyncs() {
  return Object.values(SYNCS).filter((s) => Boolean(process.env[s.sheetIdEnv]))
}

export function getSync(name) {
  return SYNCS[String(name ?? '')] ?? null
}
