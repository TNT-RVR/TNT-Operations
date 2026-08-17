/**
 * QuickBooks settings: connect, map, and see what has been syncing.
 *
 * The four mappings on this screen are not optional decoration — every push is
 * blocked until they're set. An invoice posted with no GST is a filing problem
 * and revenue in the wrong account is something an accountant unpicks months
 * later, so the app refuses rather than picking for you.
 */
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useSession } from '@/auth/session'
import { supabase } from '@/data/supabaseClient'
import { Badge, Button, EmptyState, Select } from '@/components/ui'
import { AlertTriangle, CheckCircle2, Link2, Mail, RefreshCw, Unlink } from 'lucide-react'
import { SUPPORT_EMAIL } from '@/config/contact'
import { SalesChrome } from './SalesChrome'

/** The `qbo_status` view — connection state and config, never the tokens. */
interface QboStatus {
  realm_id: string
  company_name: string
  environment: string
  home_currency: string
  multicurrency_enabled: boolean
  default_tax_code_id: string | null
  exempt_tax_code_id: string | null
  shipping_item_id: string | null
  income_account_id: string | null
  connected: boolean
  expiring_soon: boolean
  connected_at: string
  refresh_token_expires_at: string
  last_error: string
}

interface SyncLogRow {
  id: string
  entity_type: string
  action: string
  ok: boolean
  message: string
  at: string
}

interface Options {
  taxCodes: Array<{ Id: string; Name: string }>
  incomeAccounts: Array<{ Id: string; Name: string }>
  serviceItems: Array<{ Id: string; Name: string }>
  /** Why the lists are empty, when QuickBooks refused rather than returned none. */
  optionsError?: string
}

/** Call a QuickBooks function with the caller's own token — the role is checked server-side. */
async function callFn(path: string, body?: unknown): Promise<{ ok: boolean; error?: string; [k: string]: unknown }> {
  if (!supabase) return { ok: false, error: 'Not connected to Supabase' }
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) return { ok: false, error: 'Sign in again' }

  const r = await fetch(`/.netlify/functions/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const json = await r.json().catch(() => ({}))
  return r.ok ? { ok: true, ...json } : { ok: false, error: json.error ?? `Request failed (${r.status})` }
}

export default function QuickBooksHome() {
  const s = useSession()
  const isAdmin = s.user.role === 'admin'
  const [params, setParams] = useSearchParams()
  const [status, setStatus] = useState<QboStatus | null>(null)
  const [stale, setStale] = useState<QboStatus[]>([])
  /** What this DEPLOY is pointed at — distinct from what is stored. See below. */
  const [cfg, setCfg] = useState<{ environment: string; clientId: string; redirectUri: string } | null>(null)
  const [log, setLog] = useState<SyncLogRow[]>([])
  const [options, setOptions] = useState<Options | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    // ORDERED, and not limited to one row. Going from the sandbox to the real
    // company leaves TWO rows — different realms, so the second is an insert,
    // not an update. An unordered `.limit(1)` then returns whichever row
    // Postgres reaches first, which is the older sandbox one, and this screen
    // would report the sandbox company's environment, mappings and expiry while
    // the functions pushed to the real books. Newest first matches the server.
    const [st, lg] = await Promise.all([
      supabase.from('qbo_status').select('*').order('connected_at', { ascending: false }),
      supabase.from('qbo_sync_log').select('*').order('at', { ascending: false }).limit(20),
    ])
    if (st.error) {
      console.error('[qbo] status:', st.error.message, '— has migration 0017 been applied?')
    }
    const rows = (st.data as QboStatus[]) ?? []
    setStatus(rows[0] ?? null)
    setStale(rows.slice(1))
    setLog((lg.data as SyncLogRow[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Which Intuit app this deploy will actually use. Admins only, and failure is
  // silent on purpose — this is a diagnostic, and a viewer who cannot read it
  // should simply not see it rather than be shown an error.
  useEffect(() => {
    if (!isAdmin) return
    void callFn('qbo-auth?action=config').then((r) => {
      if (r.ok) setCfg(r as unknown as { environment: string; clientId: string; redirectUri: string })
    })
  }, [isAdmin])

  // The OAuth callback bounces back here with ?qbo=connected|denied|error.
  const callbackResult = params.get('qbo')
  useEffect(() => {
    if (!callbackResult) return
    if (callbackResult === 'error' || callbackResult === 'denied') {
      setError(params.get('detail') ?? 'The QuickBooks connection was not completed.')
    }
    // Clear the query so a refresh doesn't replay the banner.
    const next = new URLSearchParams(params)
    next.delete('qbo')
    next.delete('detail')
    setParams(next, { replace: true })
    void load()
  }, [callbackResult, params, setParams, load])

  const loadOptions = useCallback(async () => {
    setBusy('options')
    const r = await callFn('qbo-sync', { action: 'options' })
    setBusy('')
    if (!r.ok) return setError(r.error ?? 'Could not read QuickBooks settings')
    const o = r as unknown as Options
    setOptions(o)
    // The call succeeded, but QuickBooks refused the queries inside it. Without
    // this the screen shows four empty dropdowns and explains nothing.
    if (o.optionsError) setError(`QuickBooks would not list the options — ${o.optionsError}`)
  }, [])

  useEffect(() => {
    if (status?.connected && !options) void loadOptions()
  }, [status?.connected, options, loadOptions])

  const connect = async () => {
    setBusy('connect')
    setError('')
    const r = await callFn('qbo-auth?action=start')
    setBusy('')
    if (r.ok && typeof r.url === 'string') {
      // A full navigation, not fetch — Intuit's login can't run in an XHR.
      window.location.href = r.url
    } else {
      setError(r.error ?? 'Could not start the connection')
    }
  }

  const disconnect = async () => {
    setBusy('disconnect')
    const r = await callFn('qbo-auth', { action: 'disconnect' })
    setBusy('')
    if (!r.ok) setError(r.error ?? 'Could not disconnect')
    await load()
  }

  /**
   * Save one mapping, through the function that holds the service role.
   *
   * NOT a direct supabase.from('qbo_connection').update(): that table is
   * deny-all by design because it holds the OAuth tokens, and the update did
   * not fail — PostgREST reported success having matched zero rows. Combined
   * with an optimistic local update, every choice looked saved and was gone on
   * the next page load.
   *
   * So the state shown afterwards is RE-READ rather than assumed. If a write
   * ever silently does nothing again, the select visibly snaps back instead of
   * lying until you navigate away.
   */
  const saveMapping = async (field: keyof QboStatus, value: string) => {
    if (!status) return
    setError('')
    const r = await callFn('qbo-sync', { action: 'set-mapping', field, value })
    if (!r.ok) return setError(r.error ?? 'Could not save that mapping.')
    await load()
  }

  const run = async (action: string, label: string) => {
    setBusy(action)
    setError('')
    const r = await callFn('qbo-sync', { action })
    setBusy('')
    if (!r.ok) setError(r.error ?? `${label} failed`)
    await load()
  }

  const unmapped = status?.connected
    ? [
        !status.income_account_id && 'income account',
        !status.default_tax_code_id && 'tax code for taxable sales',
        !status.exempt_tax_code_id && 'tax code for exempt sales',
        !status.shipping_item_id && 'freight item',
      ].filter(Boolean)
    : []

  return (
    <SalesChrome
      title="QuickBooks"
      subtitle="Push invoices, estimates, customers and products to QuickBooks Online"
    >
      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <div className="max-w-3xl space-y-4">
          {error && (
            <div className="rounded border border-danger/40 bg-[color:var(--danger-bg)] p-3 text-sm text-danger">
              {error}
            </div>
          )}
          {callbackResult === 'connected' && (
            <div className="rounded border border-brand/40 bg-brand/10 p-3 text-sm text-primary">
              Connected. Set the four mappings below before pushing anything.
            </div>
          )}

          {/* ── Connection ── */}
          <div className="card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 font-semibold text-primary">
                  {status?.connected ? (
                    <>
                      <CheckCircle2 size={18} className="text-brand" />
                      {status.company_name || 'QuickBooks company'}
                    </>
                  ) : (
                    <>
                      <Link2 size={18} className="text-muted" />
                      Not connected
                    </>
                  )}
                </div>
                {status?.connected ? (
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <Badge tone={status.environment === 'production' ? 'green' : 'amber'}>
                      {status.environment}
                    </Badge>
                    <span>
                      {status.home_currency}
                      {status.multicurrency_enabled ? ' · multicurrency on' : ' · multicurrency OFF'}
                    </span>
                    <span>Realm {status.realm_id}</span>
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-muted">
                    Connect a QuickBooks Online company to start pushing invoices.
                  </p>
                )}

                {/*
                  What this DEPLOY will use, shown whether connected or not —
                  the point is to be readable BEFORE clicking Connect.

                  Netlify injects environment variables into functions at deploy
                  time, so changing QBO_CLIENT_ID in its dashboard does nothing
                  until a new deploy runs. Until then the function keeps using
                  the previous Intuit app, and the only symptom is Intuit
                  offering a company from the wrong environment — with nothing
                  anywhere pointing at the stale deploy. Compare the id below
                  against the Intuit dashboard and that becomes a five-second
                  check instead of an afternoon.
                */}
                {cfg && (
                  <p className="mt-1.5 text-xs text-muted">
                    This deploy uses Intuit app{' '}
                    <code className="text-secondary" title="Masked — compare against Keys & credentials at Intuit">
                      {cfg.clientId}
                    </code>{' '}
                    · <span className={cfg.environment === 'production' ? 'text-secondary' : 'text-warn'}>{cfg.environment}</span>
                  </p>
                )}
              </div>

              {isAdmin ? (
                status?.connected ? (
                  <Button variant="ghost" onClick={disconnect} disabled={busy === 'disconnect'}>
                    <Unlink size={16} /> {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
                  </Button>
                ) : (
                  <Button onClick={connect} disabled={busy === 'connect'}>
                    <Link2 size={16} /> {busy === 'connect' ? 'Opening Intuit…' : 'Connect QuickBooks'}
                  </Button>
                )
              ) : (
                <span className="text-xs text-muted">Admins only</span>
              )}
            </div>

            {status && !status.connected && status.last_error && (
              <p className="mt-2 text-xs text-danger">{status.last_error}</p>
            )}
            {status?.expiring_soon && status.connected && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-warn">
                <AlertTriangle size={13} />
                The QuickBooks authorisation expires {new Date(status.refresh_token_expires_at).toLocaleDateString()}.
                Any sync renews it; if it lapses you'll need to reconnect.
              </p>
            )}
            {stale.length > 0 && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-muted">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                <span>
                  {stale.length === 1 ? 'An older connection is' : `${stale.length} older connections are`} still
                  stored ({stale.map((s) => `${s.environment} · ${s.company_name || s.realm_id}`).join(', ')}). Pushes
                  use the company above. Clearing the old rows is safe once you're live.
                </span>
              </p>
            )}
            {status?.connected && !status.multicurrency_enabled && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-warn">
                <AlertTriangle size={13} />
                Multicurrency is off in QuickBooks, so USD orders can't be pushed. Turning it on in QuickBooks is
                permanent.
              </p>
            )}
          </div>

          {/* ── Mappings ── */}
          {status?.connected && (
            <div className="card space-y-3">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">Mapping</h3>
                <p className="mt-1 text-xs text-muted">
                  Pushes are blocked until these are set. The app won't guess an account or a tax code — a wrong
                  one is discovered months later by an accountant.
                </p>
              </div>

              {unmapped.length > 0 && (
                <p className="rounded border border-warn/40 bg-warn/10 p-2 text-xs text-warn">
                  Still to set: {unmapped.join(', ')}.
                </p>
              )}

              {!options ? (
                <Button variant="ghost" onClick={loadOptions} disabled={busy === 'options'}>
                  <RefreshCw size={15} /> {busy === 'options' ? 'Reading…' : 'Load options from QuickBooks'}
                </Button>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="label">Income account (new items)</span>
                    <Select
                      value={status.income_account_id ?? ''}
                      disabled={!isAdmin}
                      onChange={(e) => void saveMapping('income_account_id', e.target.value)}
                    >
                      <option value="">— select —</option>
                      {options.incomeAccounts.map((a) => (
                        <option key={a.Id} value={a.Id}>{a.Name}</option>
                      ))}
                    </Select>
                  </label>
                  <label className="block">
                    <span className="label">Freight / charge item</span>
                    <Select
                      value={status.shipping_item_id ?? ''}
                      disabled={!isAdmin}
                      onChange={(e) => void saveMapping('shipping_item_id', e.target.value)}
                    >
                      <option value="">— select —</option>
                      {options.serviceItems.map((i) => (
                        <option key={i.Id} value={i.Id}>{i.Name}</option>
                      ))}
                    </Select>
                  </label>
                  <label className="block">
                    <span className="label">Tax code — taxable sales</span>
                    <Select
                      value={status.default_tax_code_id ?? ''}
                      disabled={!isAdmin}
                      onChange={(e) => void saveMapping('default_tax_code_id', e.target.value)}
                    >
                      <option value="">— select —</option>
                      {options.taxCodes.map((t) => (
                        <option key={t.Id} value={t.Id}>{t.Name}</option>
                      ))}
                    </Select>
                  </label>
                  <label className="block">
                    <span className="label">Tax code — exempt / exports</span>
                    <Select
                      value={status.exempt_tax_code_id ?? ''}
                      disabled={!isAdmin}
                      onChange={(e) => void saveMapping('exempt_tax_code_id', e.target.value)}
                    >
                      <option value="">— select —</option>
                      {options.taxCodes.map((t) => (
                        <option key={t.Id} value={t.Id}>{t.Name}</option>
                      ))}
                    </Select>
                  </label>
                </div>
              )}

              <div className="flex flex-wrap gap-2 border-t border-subtle pt-3">
                <Button variant="ghost" onClick={() => run('pull-payments', 'Payment pull')} disabled={!!busy}>
                  <RefreshCw size={15} /> {busy === 'pull-payments' ? 'Checking…' : 'Pull payment status'}
                </Button>
                <Button variant="ghost" onClick={() => run('refresh-config', 'Refresh')} disabled={!!busy}>
                  Refresh company info
                </Button>
              </div>
            </div>
          )}

          {/* ── Recent activity ── */}
          <div>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">Recent syncs</h3>
            {log.length === 0 ? (
              <EmptyState>Nothing has synced yet.</EmptyState>
            ) : (
              <div className="card overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="th text-left">When</th>
                      <th className="th text-left">What</th>
                      <th className="th text-left">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {log.map((r) => (
                      <tr key={r.id} className="border-t border-subtle">
                        <td className="px-3 py-2 tabular-nums text-secondary">
                          {new Date(r.at).toLocaleString('en-CA', {
                            timeZone: 'America/Edmonton',
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td className="px-3 py-2 text-secondary">
                          {r.entity_type} · {r.action}
                        </td>
                        <td className="px-3 py-2">
                          {r.ok ? (
                            <Badge tone="green">OK</Badge>
                          ) : (
                            <span className="text-xs text-danger">{r.message}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/*
              Support contact, deliberately HERE rather than in a help menu:
              this is where someone is standing when a push fails, and the
              error text beside it already carries Intuit's intuit_tid — the
              first thing their support asks for. Asking for help should not
              require navigating away from the evidence.
            */}
            <p className="mt-3 flex items-start gap-1.5 text-xs text-muted">
              <Mail size={13} className="mt-0.5 shrink-0" />
              <span>
                Something wrong with a sync? Send the row above, including any{' '}
                <code className="tabular-nums">intuit_tid</code>, to{' '}
                <a
                  href={`mailto:${SUPPORT_EMAIL}?subject=TNT%20Operations%20%E2%80%94%20QuickBooks%20sync`}
                  className="text-brand hover:underline"
                >
                  {SUPPORT_EMAIL}
                </a>
                .
              </span>
            </p>
          </div>
        </div>
      )}
    </SalesChrome>
  )
}

/** Reused by the order editor's "Send to QuickBooks" button. */
export { callFn as callQboFn }
