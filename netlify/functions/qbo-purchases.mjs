/**
 * Pull bee-larvae purchases out of QuickBooks, weekly.
 *
 *   scheduled, Mondays 15:00 UTC       → sync the current buying season
 *   POST { season?: number }           → sync one season on demand (editors)
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
function seasonOf(isoDate) {
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

async function syncSeason(conn, season) {
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

/** Editors only, verified server-side — the browser cannot assert its own role. */
async function requireEditor(req) {
  const { url, key } = env()
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return { error: 'Sign in first', status: 401 }
  const me = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${jwt}` } })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
  if (!me?.id) return { error: 'Your session is invalid — sign in again', status: 401 }
  const prof = await fetch(`${url}/rest/v1/profiles?id=eq.${me.id}&select=role`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
  if (!['admin', 'developer', 'operator'].includes(prof?.[0]?.role)) return { error: 'Not allowed', status: 403 }
  return { userId: me.id }
}

export default async (req) => {
  const { missing } = env()
  if (missing.length) return json({ error: `Not configured. Missing: ${missing.join(', ')}` }, 501)

  // A POST is a person asking; anything else is the schedule.
  const byHand = req.method === 'POST'
  if (byHand) {
    const auth = await requireEditor(req)
    if (auth.error) return json({ error: auth.error }, auth.status)
  }

  const conn = await getConnection()
  if (!conn) return json({ error: `QuickBooks is not connected (${activeEnvironment()})` }, 409)
  if (conn.disconnected_at) return json({ error: 'QuickBooks is disconnected — reconnect it' }, 409)

  let season = seasonOf(new Date().toISOString().slice(0, 10))
  if (byHand) {
    const body = await req.json().catch(() => ({}))
    if (Number.isFinite(Number(body?.season))) season = Number(body.season)
  }

  try {
    const result = await syncSeason(conn, season)
    await logSync({
      realmId: conn.realm_id,
      entityType: 'bee-purchases',
      action: 'read',
      ok: true,
      message: `season ${result.season}: ${result.lines} lines, ${result.gallons} gal`,
    })
    console.log('[qbo-purchases]', JSON.stringify(result))
    return json({ ok: true, ...result }, 200)
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
