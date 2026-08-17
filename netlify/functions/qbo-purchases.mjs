/**
 * Pull bee-larvae purchases out of QuickBooks, weekly.
 *
 *   scheduled, Mondays 15:00 UTC → sync the current buying season
 *
 * There is NO manual door here. Netlify refuses direct HTTP invocation of any
 * function declaring a `schedule` — it answers 403 by design — so a "sync now"
 * button pointed at this URL cannot work, however well it is authenticated.
 * `qbo-purchases-now.mjs` is that door: no schedule, imports `syncSeason` from
 * here, and returns the result so the button can report it. Same rule and same
 * shape as poll-govee/poll-now.
 *
 * ── Why both Purchase and Bill ───────────────────────────────────────────────
 *
 * QuickBooks records a card or cash payment as a `Purchase` and an invoice from
 * a supplier as a `Bill`. They are different entities with the same shape of
 * expense line, and bees get bought both ways. Querying only one would produce
 * a total that is quietly missing whichever half was paid differently — which
 * looks like a working feature, not a bug.
 *
 * ── Idempotence ──────────────────────────────────────────────────────────────
 *
 * Every run re-reads the whole season and upserts on the QuickBooks line id, so
 * an edited bill corrects itself rather than double-counting. Manually entered
 * history is never touched: those rows carry source='manual' and no qbo_id, and
 * nothing here writes them.
 */
import { activeEnvironment, db, env, getConnection, logSync, qboQuery } from './lib/qbo.mjs'

/** Mondays at 15:00 UTC — bees are bought December to May, so weekly is ample. */
export const config = { schedule: '0 15 * * 1' }

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Season a date belongs to. Mirrors `seasonOf` in src/domain/beePurchases.ts. */
export function seasonOf(isoDate) {
  const [y, m] = String(isoDate).split('-').map(Number)
  return m >= 6 ? y + 1 : y
}

function seasonRange(season) {
  return { from: `${season - 1}-06-01`, to: `${season}-05-31` }
}

/**
 * Gallons stated in a description, or null.
 *
 * Mirrors `parseGallons` in src/domain/beePurchases.ts — a Netlify function
 * cannot import the TypeScript domain, so the rule lives in both places. If you
 * change one, change the other; `beePurchases.test.ts` holds the cases.
 */
export function parseGallons(description) {
  const text = String(description ?? '')
  if (!text.trim()) return null
  let total = 0
  let found = false
  for (const m of text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(?:us\s*)?gal(?:s|lon|lons)?\b/gi)) {
    const n = Number(m[1].replace(/,/g, ''))
    if (Number.isFinite(n) && n > 0) {
      total += n
      found = true
    }
  }
  return found ? total : null
}

/** Expense lines posted to one account, across both transaction types. */
async function linesForAccount(conn, accountId, from, to) {
  const out = []

  for (const entity of ['Purchase', 'Bill']) {
    // QuickBooks has no way to filter on a LINE's account, so the transactions
    // are fetched by date and the lines filtered here.
    const { data } = await qboQuery(
      conn,
      `select * from ${entity} where TxnDate >= '${from}' and TxnDate <= '${to}' maxresults 1000`,
    )
    const rows = data?.QueryResponse?.[entity] ?? []

    for (const txn of rows) {
      const vendor = txn.EntityRef?.name ?? txn.VendorRef?.name ?? ''
      for (const l of txn.Line ?? []) {
        const detail = l.AccountBasedExpenseLineDetail
        if (detail?.AccountRef?.value !== accountId) continue
        out.push({
          // Line ids repeat across transactions, so the key is both.
          qbo_id: `${entity}:${txn.Id}:${l.Id ?? out.length}`,
          purchase_date: txn.TxnDate,
          vendor,
          description: l.Description ?? txn.PrivateNote ?? '',
          amount: Number(l.Amount ?? 0),
          currency: txn.CurrencyRef?.value ?? conn.home_currency ?? 'CAD',
        })
      }
    }
  }
  return out
}

export async function syncSeason(conn, season) {
  if (!conn.bee_expense_account_id) {
    throw new Error('No bee purchase account chosen — set it in the QuickBooks settings first.')
  }
  const { from, to } = seasonRange(season)
  const lines = await linesForAccount(conn, conn.bee_expense_account_id, from, to)

  const rows = lines.map((l) => ({
    source: 'quickbooks',
    qbo_id: l.qbo_id,
    purchase_date: l.purchase_date,
    vendor: l.vendor,
    description: l.description,
    gallons: parseGallons(l.description),
    amount: l.amount,
    currency: l.currency,
    season: seasonOf(l.purchase_date),
    notes: '',
  }))

  if (rows.length) {
    await db().write(
      'POST',
      'bee_purchases?on_conflict=qbo_id',
      rows,
      'resolution=merge-duplicates,return=minimal',
    )
  }

  const unknown = rows.filter((r) => r.gallons === null).length
  return {
    season,
    lines: rows.length,
    gallons: rows.reduce((n, r) => n + (r.gallons ?? 0), 0),
    amount: rows.reduce((n, r) => n + r.amount, 0),
    linesWithoutGallons: unknown,
  }
}

export default async (req) => {
  const { missing } = env()
  if (missing.length) return json({ error: `Not configured. Missing: ${missing.join(', ')}` }, 501)

  const conn = await getConnection()
  if (!conn) return json({ error: `QuickBooks is not connected (${activeEnvironment()})` }, 409)
  if (conn.disconnected_at) return json({ error: 'QuickBooks is disconnected — reconnect it' }, 409)

  /*
   * TWO seasons, not one.
   *
   * Buying runs December to May, and a season is named for the year it ends
   * in — so from June to November the "current" season is one whose buying has
   * not begun. A run in August syncing only the current season reads an empty
   * window and reports 0 lines every week, which is exactly what it did.
   *
   * Worse, it would never look at the season that just finished again, so a
   * bill entered late — and they are, after the season, when the invoices land
   * — would never be picked up at all.
   *
   * Syncing the previous season too costs one extra query a week and closes
   * both holes. Upserting on the QuickBooks line id makes re-reading a settled
   * season free of consequence.
   */
  const today = new Date().toISOString().slice(0, 10)
  const month = Number(today.slice(5, 7))
  // Mirrors `activeSeason` in src/domain/beePurchases.ts. December is ≥ 6 but
  // STARTS a season, so the dead window is June THROUGH November, not "from
  // June" — getting that wrong points the sync a whole year off.
  const named = seasonOf(today)
  const active = month >= 6 && month <= 11 ? named - 1 : named
  // The active season, and the one before it: late bills land after a season
  // closes, and nothing would ever look at it again otherwise.
  const seasons = [...new Set([active, active - 1])]

  try {
    const results = []
    for (const season of seasons) results.push(await syncSeason(conn, season))
    const total = results.reduce((n, r) => n + r.lines, 0)
    await logSync({
      realmId: conn.realm_id,
      entityType: 'bee-purchases',
      action: 'read',
      ok: true,
      message: results.map((r) => `season ${r.season}: ${r.lines} lines, ${r.gallons} gal`).join('; '),
    })
    console.log('[qbo-purchases]', JSON.stringify(results))
    return json({ ok: true, seasons: results, lines: total }, 200)
  } catch (e) {
    await logSync({
      realmId: conn.realm_id,
      entityType: 'bee-purchases',
      action: 'read',
      ok: false,
      message: e.message,
      intuitTid: e.intuitTid,
    })
    return json({ ok: false, error: e.message }, 400)
  }
}
