/**
 * Run every configured Google Sheet sync, on a schedule.
 *
 * One scheduled function for all of them rather than one per sheet: they share
 * auth, they share a cadence, and a per-sheet schedule is a per-sheet thing to
 * forget. A sync whose spreadsheet id is not set is skipped, so an unconfigured
 * one is quiet rather than an hourly failure.
 *
 * The current season only. Past seasons are history — they change when someone
 * edits them, which is what the Sync now button is for.
 *
 * Netlify refuses HTTP invocation of a scheduled function, so the manual door
 * is sheet-sync-now.mjs. See netlify/tests/scheduledNotFetched.test.mjs.
 */
import { configuredSyncs } from './lib/sheetSyncs.mjs'

export const config = { schedule: '*/30 * * * *' }

export default async () => {
  const year = String(new Date().getFullYear())
  const syncs = configuredSyncs()
  if (syncs.length === 0) {
    console.info('[sheet-sync] nothing configured; skipping')
    return new Response(JSON.stringify({ ok: true, skipped: 'nothing configured' }), { status: 200 })
  }

  const results = []
  for (const sync of syncs) {
    try {
      const out = await sync.run({ year })
      console.info(`[sheet-sync] ${sync.name} ${year}: ${out.toApp} in, ${out.toSheet} out`)
      results.push({ name: sync.name, ...out })
    } catch (e) {
      // One sheet failing must not stop the others — they are unrelated.
      console.error(`[sheet-sync] ${sync.name}:`, e)
      results.push({ name: sync.name, ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return new Response(JSON.stringify({ ok: true, year, results }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
