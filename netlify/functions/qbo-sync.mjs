/**
 * Push records into QuickBooks, and pull payment status back.
 *
 *   POST /.netlify/functions/qbo-sync   { action: 'order',    id }
 *   POST /.netlify/functions/qbo-sync   { action: 'customer', id }
 *   POST /.netlify/functions/qbo-sync   { action: 'product',  id }
 *   POST /.netlify/functions/qbo-sync   { action: 'pull-payments' }
 *   POST /.netlify/functions/qbo-sync   { action: 'refresh-config' }
 *
 * Requires a signed-in editor's token; the role is checked server-side.
 *
 * ── Push order: dependencies first ───────────────────────────────────────────
 *
 * A QuickBooks invoice references a customer and an item by id, so both must
 * exist there before the invoice can. `action: 'order'` therefore syncs the
 * customer and every referenced product first, then the transaction. Asking an
 * operator to do that in the right order by hand would be a bad afternoon and
 * they would get it wrong.
 *
 * ── Re-pushing UPDATES, it does not duplicate ────────────────────────────────
 *
 * `qbo_links` is unique on (realm, type, local id). A second push of the same
 * invoice reads the current SyncToken and updates. Duplicate invoices in an
 * accounting system are the expensive failure here, so the code path that
 * creates is only reachable when no link exists.
 */
import { db, env, getConnection, getLink, logSync, qboFetch, qboQuery, upsertLink } from './lib/qbo.mjs'

const json = (body, status) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

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
  const role = prof?.[0]?.role
  if (!['admin', 'developer', 'operator'].includes(role)) return { error: 'Not allowed', status: 403 }
  return { userId: me.id }
}

/** Escape a value for a QBO query string literal. */
const q = (s) => String(s).replace(/'/g, "\\'")

// ── Mapping (mirrors src/domain/quickbooks.ts; a function can't import from src/) ──

const cents = (n) => Math.round(Number(n) * 100) / 100

function customerDisplayName(c, all) {
  const company = (c.company ?? '').trim()
  const contact = (c.contact_name ?? '').trim()
  if (!company) return contact || 'Unnamed customer'
  const shares = all.some((o) => o.id !== c.id && (o.company ?? '').trim().toLowerCase() === company.toLowerCase())
  return shares && contact ? `${company} (${contact})` : company
}

function customerPayload(c, all) {
  const parts = (c.contact_name ?? '').trim().split(/\s+/).filter(Boolean)
  const addr = {}
  if (c.address_lines?.[0]) addr.Line1 = c.address_lines[0]
  if (c.city) addr.City = c.city
  if (c.region) addr.CountrySubDivisionCode = c.region
  if (c.postal_code) addr.PostalCode = c.postal_code
  if (c.country) addr.Country = c.country

  return {
    DisplayName: customerDisplayName(c, all),
    ...(c.company ? { CompanyName: c.company } : {}),
    ...(parts[0] ? { GivenName: parts[0] } : {}),
    ...(parts.length > 1 ? { FamilyName: parts.slice(1).join(' ') } : {}),
    ...(c.email ? { PrimaryEmailAddr: { Address: c.email } } : {}),
    ...(c.phone ? { PrimaryPhone: { FreeFormNumber: c.phone } } : {}),
    ...(c.notes ? { Notes: c.notes } : {}),
    ...(Object.keys(addr).length ? { BillAddr: addr } : {}),
  }
}

// ── Sync one entity ──

/** Create or update, driven by whether a link already exists. */
async function pushEntity(conn, { entity, localId, payload }) {
  const link = await getLink(conn.realm_id, entity === 'Invoice' ? 'invoice' : entity === 'Estimate' ? 'estimate' : entity === 'Item' ? 'item' : 'customer', localId)
  const type = entity.toLowerCase()

  if (link?.qbo_id) {
    // Read the CURRENT SyncToken — a human may have edited the record in
    // QuickBooks since we last touched it, and a stale token fails the write.
    const { data: current } = await qboFetch(conn, `${type}/${link.qbo_id}`)
    const existing = current?.[entity]
    if (!existing) throw new Error(`${entity} ${link.qbo_id} no longer exists in QuickBooks`)

    const { data } = await qboFetch(conn, type, {
      method: 'POST',
      body: { ...payload, Id: link.qbo_id, SyncToken: existing.SyncToken, sparse: true },
    })
    const saved = data?.[entity]
    return { qboId: saved.Id, syncToken: saved.SyncToken, created: false }
  }

  const { data } = await qboFetch(conn, type, { method: 'POST', body: payload })
  const saved = data?.[entity]
  return { qboId: saved.Id, syncToken: saved.SyncToken, created: true }
}

async function syncCustomer(conn, customerId) {
  const all = await db().get('sales_customers?select=*')
  const c = all.find((x) => x.id === customerId)
  if (!c) throw new Error('Customer not found')

  const payload = customerPayload(c, all)
  if (!payload.DisplayName || payload.DisplayName === 'Unnamed customer') {
    throw new Error('Customer has neither a company nor a contact name')
  }

  const r = await pushEntity(conn, { entity: 'Customer', localId: customerId, payload })
  await upsertLink({
    realmId: conn.realm_id,
    entityType: 'customer',
    localId: customerId,
    qboId: r.qboId,
    syncToken: r.syncToken,
  })
  return r
}

async function syncProduct(conn, productId) {
  const [p] = await db().get(`sales_products?id=eq.${productId}&select=*&limit=1`)
  if (!p) throw new Error('Product not found')
  if (!conn.income_account_id) {
    throw new Error('Pick the income account for new items in the QuickBooks settings first')
  }

  const payload = {
    Name: p.name,
    Sku: p.sku,
    Type: 'NonInventory',
    IncomeAccountRef: { value: conn.income_account_id },
    ...(p.notes ? { Description: p.notes } : {}),
    Taxable: true,
  }

  const r = await pushEntity(conn, { entity: 'Item', localId: productId, payload })
  await upsertLink({
    realmId: conn.realm_id,
    entityType: 'item',
    localId: productId,
    qboId: r.qboId,
    syncToken: r.syncToken,
  })
  return r
}

async function syncOrder(conn, orderId) {
  const [o] = await db().get(`sales_orders?id=eq.${orderId}&select=*&limit=1`)
  if (!o) throw new Error('Order not found')
  const lines = await db().get(`sales_order_lines?order_id=eq.${orderId}&select=*&order=sort.asc`)
  const charges = await db().get(`sales_order_charges?order_id=eq.${orderId}&select=*&order=sort.asc`)
  if (lines.length === 0 && charges.length === 0) throw new Error('Nothing to send — the order has no lines')

  if (!o.customer_id) throw new Error('No customer on this order')

  // Currency guard: QuickBooks rejects a foreign-currency transaction when
  // multicurrency is off, with an opaque error.
  //
  // `multicurrency_enabled` is cached from the last time we read QuickBooks,
  // and it is stale in exactly the direction that matters here: this error
  // tells the operator to go and switch multicurrency ON, and if we never
  // re-read it, the push keeps failing after they have — a dead end at the end
  // of instructions the app itself gave. So ask QuickBooks before refusing.
  // Only on the failing path, so a normal push costs nothing extra.
  if (o.currency !== conn.home_currency && !conn.multicurrency_enabled) {
    conn = { ...conn, ...(await refreshConfig(conn)) }
  }
  if (o.currency !== conn.home_currency && !conn.multicurrency_enabled) {
    throw new Error(
      `Order is in ${o.currency} but the QuickBooks file is ${conn.home_currency} with multicurrency off. ` +
        'Turn it on in QuickBooks (Account and Settings → Advanced → Currency) — it cannot be undone — then send again.',
    )
  }

  // Dependencies first — QuickBooks references these by id.
  const customerLink =
    (await getLink(conn.realm_id, 'customer', o.customer_id)) ??
    (await syncCustomer(conn, o.customer_id).then(() => getLink(conn.realm_id, 'customer', o.customer_id)))

  const [customer] = await db().get(`sales_customers?id=eq.${o.customer_id}&select=country,email&limit=1`)
  // A shipment leaving Canada is a zero-rated export. Default, not a ruling.
  const taxable = (customer?.country ?? 'CA').toUpperCase() === 'CA'
  const taxCode = taxable ? conn.default_tax_code_id : conn.exempt_tax_code_id
  if (taxable && !conn.default_tax_code_id) {
    throw new Error('No tax code chosen for taxable sales — set one in the QuickBooks settings')
  }

  const Line = []
  for (const l of lines) {
    if (!l.product_id) throw new Error(`Line "${l.description}" has no product to map to a QuickBooks item`)
    let itemLink = await getLink(conn.realm_id, 'item', l.product_id)
    if (!itemLink) {
      await syncProduct(conn, l.product_id)
      itemLink = await getLink(conn.realm_id, 'item', l.product_id)
    }
    Line.push({
      DetailType: 'SalesItemLineDetail',
      Amount: cents(l.extended),
      Description: l.description,
      SalesItemLineDetail: {
        ItemRef: { value: itemLink.qbo_id },
        Qty: Number(l.qty),
        UnitPrice: cents(l.unit_price),
        ...(taxCode ? { TaxCodeRef: { value: taxCode } } : {}),
      },
    })
  }

  for (const c of charges) {
    if (!conn.shipping_item_id) {
      throw new Error(`Charge "${c.label}" needs a QuickBooks item — set the freight item in the settings`)
    }
    Line.push({
      DetailType: 'SalesItemLineDetail',
      Amount: cents(c.amount),
      Description: c.label,
      SalesItemLineDetail: {
        ItemRef: { value: conn.shipping_item_id },
        Qty: 1,
        UnitPrice: cents(c.amount),
        ...(taxCode ? { TaxCodeRef: { value: taxCode } } : {}),
      },
    })
  }

  const entity = o.kind === 'estimate' ? 'Estimate' : 'Invoice'
  const payload = {
    DocNumber: o.number,
    TxnDate: o.issued_date,
    ...(o.due_date ? { DueDate: o.due_date } : {}),
    CustomerRef: { value: customerLink.qbo_id },
    CurrencyRef: { value: o.currency },
    Line,
    GlobalTaxCalculation: taxable ? 'TaxExcluded' : 'NotApplicable',
    ...(o.po_number ? { CustomerMemo: { value: `PO ${o.po_number}` } } : {}),
    ...(o.notes ? { PrivateNote: o.notes } : {}),
    ...(customer?.email ? { BillEmail: { Address: customer.email } } : {}),
  }

  const r = await pushEntity(conn, { entity, localId: orderId, payload })
  await upsertLink({
    realmId: conn.realm_id,
    entityType: o.kind,
    localId: orderId,
    qboId: r.qboId,
    syncToken: r.syncToken,
  })
  return r
}

/**
 * Pull balances for every linked invoice and mark the paid ones.
 *
 * QuickBooks is the authority on money, so this direction has no conflict to
 * resolve: whatever it says the balance is, is the balance.
 */
async function pullPayments(conn) {
  const links = await db().get(
    `qbo_links?realm_id=eq.${encodeURIComponent(conn.realm_id)}&entity_type=eq.invoice&select=local_id,qbo_id`,
  )
  if (links.length === 0) return { checked: 0, paid: 0 }

  let paid = 0
  // Batch the query rather than one call per invoice — Intuit rate-limits at
  // 500 requests/minute per realm and a season of invoices would approach it.
  const CHUNK = 50
  for (let i = 0; i < links.length; i += CHUNK) {
    const slice = links.slice(i, i + CHUNK)
    const ids = slice.map((l) => `'${q(l.qbo_id)}'`).join(',')
    const { data } = await qboQuery(conn, `select Id, DocNumber, TotalAmt, Balance from Invoice where Id in (${ids})`)
    const rows = data?.QueryResponse?.Invoice ?? []

    for (const row of rows) {
      const link = slice.find((l) => l.qbo_id === String(row.Id))
      if (!link) continue
      const total = Number(row.TotalAmt ?? 0)
      const balance = Number(row.Balance ?? 0)
      // A zero-total invoice also has a zero balance — that is not "paid".
      const isPaid = total > 0 && balance === 0

      const patch = { qbo_balance: balance }
      if (isPaid) {
        patch.qbo_paid_at = new Date().toISOString()
        patch.status = 'paid'
        paid++
      }
      await db().write('PATCH', `sales_orders?id=eq.${link.local_id}`, patch, 'return=minimal')
    }
  }
  return { checked: links.length, paid }
}

/** Re-read company name, currency and multicurrency from QuickBooks. */
async function refreshConfig(conn) {
  const { data: info } = await qboFetch(conn, `companyinfo/${conn.realm_id}`)
  const { data: prefs } = await qboFetch(conn, 'preferences')
  const cur = prefs?.Preferences?.CurrencyPrefs ?? {}
  const patch = {
    company_name: info?.CompanyInfo?.CompanyName ?? '',
    home_currency: cur.HomeCurrency?.value ?? 'CAD',
    multicurrency_enabled: cur.MultiCurrencyEnabled === true,
  }
  await db().write('PATCH', `qbo_connection?realm_id=eq.${encodeURIComponent(conn.realm_id)}`, patch, 'return=minimal')
  return patch
}

/** Tax codes, income accounts and service items, for the settings dropdowns. */
async function readOptions(conn) {
  const [taxes, accounts, items] = await Promise.all([
    qboQuery(conn, 'select Id, Name, Description from TaxCode maxresults 100').catch(() => ({ data: null })),
    qboQuery(
      conn,
      "select Id, Name, AccountType from Account where AccountType = 'Income' maxresults 100",
    ).catch(() => ({ data: null })),
    qboQuery(conn, "select Id, Name, Type from Item where Type = 'Service' maxresults 100").catch(() => ({ data: null })),
  ])
  return {
    taxCodes: taxes.data?.QueryResponse?.TaxCode ?? [],
    incomeAccounts: accounts.data?.QueryResponse?.Account ?? [],
    serviceItems: items.data?.QueryResponse?.Item ?? [],
  }
}

export default async (req) => {
  const { missing } = env()
  if (missing.length) return json({ error: `Not configured. Missing: ${missing.join(', ')}` }, 501)
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const auth = await requireEditor(req)
  if (auth.error) return json({ error: auth.error }, auth.status)

  let body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }
  const { action, id } = body ?? {}

  const conn = await getConnection()
  if (!conn) return json({ error: 'QuickBooks is not connected' }, 409)
  if (conn.disconnected_at) return json({ error: 'QuickBooks is disconnected — reconnect it' }, 409)

  try {
    let result
    switch (action) {
      case 'order':
        result = await syncOrder(conn, id)
        break
      case 'customer':
        result = await syncCustomer(conn, id)
        break
      case 'product':
        result = await syncProduct(conn, id)
        break
      case 'pull-payments':
        result = await pullPayments(conn)
        break
      case 'refresh-config':
        result = await refreshConfig(conn)
        break
      case 'options':
        result = await readOptions(conn)
        break
      default:
        return json({ error: `Unknown action "${action}"` }, 400)
    }

    await logSync({
      realmId: conn.realm_id,
      entityType: action,
      localId: id ?? null,
      action: result?.created === false ? 'update' : result?.created ? 'create' : 'read',
      ok: true,
      message: '',
      intuitTid: result?.intuitTid,
    })
    return json({ ok: true, ...result }, 200)
  } catch (e) {
    await logSync({
      realmId: conn.realm_id,
      entityType: action ?? 'unknown',
      localId: id ?? null,
      action: 'create',
      ok: false,
      message: e.message,
      // Set by qboFetch when Intuit answered. Absent for our own validation
      // failures, which never reached them.
      intuitTid: e.intuitTid,
    })
    return json({ ok: false, error: e.message }, 400)
  }
}
