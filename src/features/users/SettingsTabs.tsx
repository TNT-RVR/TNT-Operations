/**
 * The Access, Company, Integrations, Archive and Account tabs.
 *
 * Grouped in one file because each is small and they share the same shape:
 * read a bit of config, let an admin change it, say plainly what the change
 * does. The Users tab stays in UsersHome.tsx — it's the biggest of the six.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ASSIGNABLE_ROLES,
  MATRIX,
  MODULES,
  type Module,
  type Role,
  setAccessOverrides,
  useSession,
} from '@/auth/session'
import { supabase } from '@/data/supabaseClient'
import { useTheme } from '@/styles/theme'
import { Badge, Button, EmptyState, Input, Switch } from '@/components/ui'
import { AlertTriangle, ArchiveRestore, Check, ExternalLink, Lock, Save } from 'lucide-react'
import {
  type AccessOverrides,
  type Grant,
  accessWarnings,
  buildGrid,
  diffFromBase,
  isLocked,
} from '@/domain/access'
import { SettingsChrome, relativeDays } from './SettingsChrome'

const ALL_ROLES: Role[] = [...ASSIGNABLE_ROLES, 'pending']

// ═══════════════════════════════════════════════════════════════════════════
// Access
// ═══════════════════════════════════════════════════════════════════════════

const GRANT_LABEL: Record<Grant, string> = { none: 'None', view: 'View', edit: 'Edit' }
const GRANT_TONE: Record<Grant, string> = {
  none: 'bg-overlay text-faint',
  view: 'bg-overlay text-secondary',
  edit: 'bg-brand text-on-brand',
}

export function AccessTab() {
  const s = useSession()
  const canEdit = s.can('users', 'edit')
  const [grid, setGrid] = useState(() => buildGrid(ALL_ROLES, MATRIX))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // Load the stored overrides and layer them on.
  useEffect(() => {
    if (!supabase) return
    void supabase
      .from('app_role_access')
      .select('role, module, grant_level')
      .then(({ data, error: e }) => {
        if (e) {
          console.error('[access]', e.message, '— has migration 0018 been applied?')
          return
        }
        const o: AccessOverrides = {}
        for (const r of data ?? []) {
          const role = r.role as Role
          o[role] = { ...(o[role] ?? {}), [r.module as Module]: r.grant_level as Grant }
        }
        setGrid(buildGrid(ALL_ROLES, MATRIX, o))
      })
  }, [])

  const warnings = useMemo(() => accessWarnings(grid), [grid])
  const blocked = warnings.some((w) => w.severity === 'blocker')

  const cycle = (role: Role, module: Module) => {
    if (!canEdit || isLocked(role, module)) return
    const order: Grant[] = ['none', 'view', 'edit']
    const cur = grid[role]?.[module] ?? 'none'
    const next = order[(order.indexOf(cur) + 1) % order.length]
    setGrid({ ...grid, [role]: { ...grid[role], [module]: next } })
    setSaved(false)
  }

  const save = async () => {
    if (!supabase || blocked) return
    setSaving(true)
    setError('')
    const diff = diffFromBase(grid, MATRIX)

    // Replace wholesale: the table is sparse, so anything not in the diff has
    // gone back to its built-in and its row must disappear.
    const del = await supabase.from('app_role_access').delete().neq('role', '__none__')
    if (del.error) {
      setError(del.error.message)
      setSaving(false)
      return
    }
    if (diff.length > 0) {
      const ins = await supabase.from('app_role_access').insert(
        diff.map((d) => ({ role: d.role, module: d.module, grant_level: d.grant })),
      )
      if (ins.error) {
        setError(ins.error.message)
        setSaving(false)
        return
      }
    }

    // Apply immediately so the nav updates without a reload.
    const o: AccessOverrides = {}
    for (const d of diff) o[d.role] = { ...(o[d.role] ?? {}), [d.module]: d.grant }
    setAccessOverrides(o)

    setSaving(false)
    setSaved(true)
  }

  return (
    <SettingsChrome
      actions={
        canEdit ? (
          <Button onClick={save} disabled={saving || blocked}>
            <Save size={16} /> {saving ? 'Saving…' : saved ? 'Saved' : 'Save access'}
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-muted">
          What each role can reach. Click a cell to cycle None → View → Edit. Changes apply to everyone with that
          role the next time they load the app.
        </p>

        {warnings.map((w, i) => (
          <div
            key={i}
            className={`rounded border p-2 text-xs ${
              w.severity === 'blocker'
                ? 'border-danger/40 bg-[color:var(--danger-bg)] text-danger'
                : 'border-warn/40 bg-warn/10 text-warn'
            }`}
          >
            <AlertTriangle size={13} className="mr-1 inline" />
            {w.message}
          </div>
        ))}

        {error && <p className="text-xs text-danger">{error}</p>}

        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="th text-left">Section</th>
                {ALL_ROLES.map((r) => (
                  <th key={r} className="th text-center capitalize">
                    {r}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MODULES.map((m) => (
                <tr key={m} className="border-t border-subtle">
                  <td className="px-3 py-2 capitalize text-primary">{m}</td>
                  {ALL_ROLES.map((r) => {
                    const g = grid[r]?.[m] ?? 'none'
                    const locked = isLocked(r, m)
                    return (
                      <td key={r} className="px-2 py-1.5 text-center">
                        <button
                          onClick={() => cycle(r, m)}
                          disabled={!canEdit || locked}
                          title={
                            locked
                              ? 'Locked — an admin must always be able to reach this screen to undo a mistake'
                              : undefined
                          }
                          className={`inline-flex min-w-16 items-center justify-center gap-1 rounded px-2 py-1 text-xs ${GRANT_TONE[g]} ${
                            canEdit && !locked ? 'hover:opacity-80' : 'cursor-default'
                          }`}
                        >
                          {locked && <Lock size={11} />}
                          {GRANT_LABEL[g]}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-faint">
          Admin access to Users &amp; Settings is locked on purpose. It is the only way back if a permission
          change goes wrong.
        </p>
      </div>
    </SettingsChrome>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Company
// ═══════════════════════════════════════════════════════════════════════════

interface Company {
  legal_name: string
  trade_name: string
  address_lines: string[]
  city: string
  region: string
  postal_code: string
  country: string
  business_number: string
  gst_number: string
  phone: string
  email: string
  website: string
  signatory_name: string
  signatory_title: string
}

const FIELDS: Array<[keyof Company, string, string?]> = [
  ['legal_name', 'Legal name'],
  ['trade_name', 'Trade name (if different)'],
  ['city', 'City'],
  ['region', 'Province'],
  ['postal_code', 'Postal code'],
  ['country', 'Country (ISO 2)'],
  ['business_number', 'Business Number (BN)'],
  ['gst_number', 'GST number'],
  ['phone', 'Phone'],
  ['email', 'Email'],
  ['website', 'Website'],
  ['signatory_name', 'Default signatory'],
  ['signatory_title', 'Signatory title'],
]

export function CompanyTab() {
  const s = useSession()
  const canEdit = s.user.role === 'admin'
  const [c, setC] = useState<Company | null>(null)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!supabase) return
    void supabase
      .from('app_company')
      .select('*')
      .limit(1)
      .maybeSingle()
      .then(({ data, error: e }) => {
        if (e) console.error('[company]', e.message, '— has migration 0018 been applied?')
        setC((data as Company) ?? null)
      })
  }, [])

  const save = async (patch: Partial<Company>) => {
    if (!supabase || !c) return
    setC({ ...c, ...patch })
    setSaved(false)
    const { error: e } = await supabase.from('app_company').update(patch).eq('id', true)
    if (e) setError(e.message)
    else setSaved(true)
  }

  return (
    <SettingsChrome>
      {!c ? (
        <EmptyState>Company details aren't set up yet — run migration 0018.</EmptyState>
      ) : (
        <div className="max-w-3xl space-y-4">
          <p className="text-sm text-muted">
            These print on your commercial invoices and CUSMA certifications as the vendor. Until now they were
            hardcoded, so getting them right here is the only way to correct the paperwork.
          </p>
          {error && <p className="text-xs text-danger">{error}</p>}
          {saved && (
            <p className="flex items-center gap-1 text-xs text-brand">
              <Check size={13} /> Saved
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="label">Street address</span>
              <Input
                value={c.address_lines?.[0] ?? ''}
                disabled={!canEdit}
                onChange={(e) => void save({ address_lines: [e.target.value] })}
              />
            </label>
            {FIELDS.map(([key, label]) => (
              <label key={key} className="block">
                <span className="label">{label}</span>
                <Input
                  value={String(c[key] ?? '')}
                  disabled={!canEdit}
                  onChange={(e) => void save({ [key]: e.target.value } as Partial<Company>)}
                />
              </label>
            ))}
          </div>
          {!canEdit && <p className="text-xs text-muted">Admins only.</p>}
        </div>
      )}
    </SettingsChrome>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Integrations
// ═══════════════════════════════════════════════════════════════════════════

interface IntegrationCard {
  name: string
  what: string
  status: 'live' | 'configured' | 'not-built'
  detail: string
  to?: string
}

export function IntegrationsTab() {
  const [qbo, setQbo] = useState<{ connected: boolean; company_name: string } | null>(null)

  useEffect(() => {
    if (!supabase) return
    void supabase
      .from('qbo_status')
      .select('connected, company_name')
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setQbo(data as { connected: boolean; company_name: string } | null))
  }, [])

  const cards: IntegrationCard[] = [
    {
      name: 'QuickBooks Online',
      what: 'Push invoices, estimates, customers and products; pull payment status back.',
      status: qbo?.connected ? 'live' : 'configured',
      detail: qbo?.connected ? `Connected to ${qbo.company_name || 'a company'}` : 'Not connected yet',
      to: '/users/integrations/quickbooks',
    },
    {
      name: 'Govee sensors',
      what: 'Polls every incubator with a Govee device every 5 minutes and raises stale-feed alerts.',
      status: 'live',
      detail: 'Runs on a schedule; needs GOVEE_API_KEY in Netlify.',
    },
    {
      name: 'Grant discovery',
      what: 'Asks Claude with web search for open Alberta and Canada funding programs each Monday.',
      status: 'live',
      detail: 'Needs ANTHROPIC_API_KEY in Netlify.',
    },
    {
      name: 'Task scheduler',
      what: 'Creates recurring tasks and raises due-soon and overdue alerts, daily at 06:00.',
      status: 'live',
      detail: 'No configuration needed.',
    },
    {
      name: 'Weather',
      what: 'Open-Meteo season archive for the Analysis section, cached per field-season.',
      status: 'live',
      detail: 'No API key required.',
    },
    {
      name: 'Push notifications',
      what: 'Alerts on a phone or tablet, even with the app closed.',
      status: 'live',
      detail: 'Turned on per device in Notifications → Settings.',
    },
    {
      name: 'Email delivery',
      what: 'Sending alerts by email.',
      status: 'not-built',
      detail: 'The per-alert email toggles store your choice, but nothing sends yet — needs SMTP configured.',
    },
    {
      name: 'ESP32 sensors',
      what: 'Direct sensor ingest without Govee.',
      status: 'not-built',
      detail: "The source type exists but nothing ingests it.",
    },
  ]

  const TONE: Record<IntegrationCard['status'], { label: string; tone: 'green' | 'amber' | 'neutral' }> = {
    live: { label: 'Live', tone: 'green' },
    configured: { label: 'Needs setup', tone: 'amber' },
    'not-built': { label: 'Not built', tone: 'neutral' },
  }

  return (
    <SettingsChrome>
      <div className="space-y-2">
        <p className="mb-3 text-sm text-muted">
          Everything the app talks to. Server keys live in Netlify's environment, never in the browser.
        </p>
        <ul className="grid gap-2 md:grid-cols-2">
          {cards.map((c) => (
            <li key={c.name} className="card flex flex-col gap-1.5">
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium text-primary">{c.name}</span>
                <Badge tone={TONE[c.status].tone}>{TONE[c.status].label}</Badge>
              </div>
              <p className="text-xs text-muted">{c.what}</p>
              <p className="text-xs text-faint">{c.detail}</p>
              {c.to && (
                <Link to={c.to} className="mt-auto pt-1 text-xs text-brand hover:underline">
                  Open settings <ExternalLink size={11} className="inline" />
                </Link>
              )}
            </li>
          ))}
        </ul>
      </div>
    </SettingsChrome>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Archive
// ═══════════════════════════════════════════════════════════════════════════

interface ArchivedUser {
  id: string
  name: string
  email: string
  role: string
  archived_at: string
}

export function ArchiveTab() {
  const s = useSession()
  const canEdit = s.can('users', 'edit')
  const [rows, setRows] = useState<ArchivedUser[]>([])
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!supabase) return
    const { data, error: e } = await supabase
      .from('profiles')
      .select('id, name, email, role, archived_at')
      .not('archived_at', 'is', null)
      .order('archived_at', { ascending: false })
    if (e) console.error('[archive]', e.message, '— has migration 0018 been applied?')
    setRows((data as ArchivedUser[]) ?? [])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const restore = async (id: string) => {
    if (!supabase) return
    const { error: e } = await supabase
      .from('profiles')
      .update({ archived_at: null, archived_by: null })
      .eq('id', id)
    if (e) setError(e.message)
    await load()
  }

  return (
    <SettingsChrome>
      <div className="max-w-3xl space-y-3">
        <p className="text-sm text-muted">
          Archived people keep their history — their name still appears on the inspections they logged and the
          shelters they placed — but they can't sign in and don't show in pickers.
        </p>
        {error && <p className="text-xs text-danger">{error}</p>}
        {rows.length === 0 ? (
          <EmptyState>Nobody is archived.</EmptyState>
        ) : (
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th text-left">Name</th>
                  <th className="th text-left">Email</th>
                  <th className="th text-left">Archived</th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id} className="border-t border-subtle">
                    <td className="px-3 py-2 text-primary">{u.name || '—'}</td>
                    <td className="px-3 py-2 text-secondary">{u.email}</td>
                    <td className="px-3 py-2 text-secondary">{relativeDays(u.archived_at)}</td>
                    <td className="px-3 py-2 text-right">
                      {canEdit && (
                        <Button variant="ghost" onClick={() => void restore(u.id)}>
                          <ArchiveRestore size={15} /> Restore
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </SettingsChrome>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Account
// ═══════════════════════════════════════════════════════════════════════════

export function AccountTab() {
  const s = useSession()
  const { theme, setTheme } = useTheme()
  const [name, setName] = useState(s.user.name)
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  const saveName = () => {
    s.updateUserName(s.user.id, name.trim())
    setMsg('Name saved.')
  }

  const changePassword = async () => {
    setError('')
    setMsg('')
    if (pw.length < 8) return setError('Use at least 8 characters.')
    if (pw !== pw2) return setError("The two passwords don't match.")
    if (!supabase) return setError('Not connected.')
    const { error: e } = await supabase.auth.updateUser({ password: pw })
    if (e) return setError(e.message)
    setPw('')
    setPw2('')
    setMsg('Password changed.')
  }

  return (
    <SettingsChrome>
      <div className="max-w-lg space-y-4">
        <div className="card space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">You</h3>
          <div className="text-sm">
            <div className="text-primary">{s.user.email}</div>
            <div className="mt-1">
              <Badge tone="brand">{s.user.role}</Badge>
            </div>
          </div>
          <label className="block">
            <span className="label">Display name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} />
          </label>
        </div>

        <div className="card space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">Appearance</h3>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-primary">Light theme</div>
              <div className="text-xs text-muted">Dark is the default. This is stored on this device.</div>
            </div>
            <Switch
              checked={theme === 'light'}
              onChange={(v) => setTheme(v ? 'light' : 'dark')}
              label="Light theme"
            />
          </div>
        </div>

        {supabase && (
          <div className="card space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">Password</h3>
            <label className="block">
              <span className="label">New password</span>
              <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
            </label>
            <label className="block">
              <span className="label">Confirm</span>
              <Input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
            </label>
            <Button onClick={changePassword} disabled={!pw}>
              Change password
            </Button>
          </div>
        )}

        {error && <p className="text-xs text-danger">{error}</p>}
        {msg && (
          <p className="flex items-center gap-1 text-xs text-brand">
            <Check size={13} /> {msg}
          </p>
        )}

        <Button variant="ghost" onClick={s.signOut}>
          Sign out
        </Button>
      </div>
    </SettingsChrome>
  )
}
