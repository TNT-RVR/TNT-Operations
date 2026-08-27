/**
 * The Access, Company, Integrations, Archive and Account tabs.
 *
 * Grouped in one file because each is small and they share the same shape:
 * read a bit of config, let an admin change it, say plainly what the change
 * does. The Users tab stays in UsersHome.tsx — it's the biggest of the six.
 */
import { useEffect, useMemo, useState } from 'react'
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
import { useData } from '@/data/context'
import { useTheme } from '@/styles/theme'
import { Badge, Button, EmptyState, Input, Switch } from '@/components/ui'
import { AlertTriangle, ArchiveRestore, CalendarDays, Check, ExternalLink, Lock, PenLine, RefreshCw, Save, Trash2 } from 'lucide-react'
import {
  type AccessOverrides,
  type Grant,
  accessWarnings,
  buildGrid,
  diffFromBase,
  isLocked,
} from '@/domain/access'
import type { CompanyDetails } from '@/data/types'
import { MAX_SIGNATURE_BYTES, checkSignatureImage } from '@/domain/signature'
import { AvatarPicker } from './AvatarPicker'
import { MfaCard } from './MfaCard'
import { HomeTilesSettings } from './HomeTilesSettings'
import { InstallCard } from './InstallCard'
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
  const { accessOverrides, saveAccessOverrides } = useData()
  const [grid, setGrid] = useState(() => buildGrid(ALL_ROLES, MATRIX, accessOverrides))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // Re-layer whenever the stored overrides arrive or change.
  useEffect(() => {
    setGrid(buildGrid(ALL_ROLES, MATRIX, accessOverrides))
  }, [accessOverrides])

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
    if (blocked) return
    setSaving(true)
    setError('')
    const diff = diffFromBase(grid, MATRIX)
    const r = await saveAccessOverrides(diff)
    if (!r.ok) {
      setError(r.error ?? 'Could not save')
      setSaving(false)
      return
    }

    // Push into the module-level store too, so the nav and route guards pick
    // the change up without a reload.
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

const FIELDS: Array<[keyof CompanyDetails, string]> = [
  ['legalName', 'Legal name'],
  ['tradeName', 'Trade name (if different)'],
  ['city', 'City'],
  ['region', 'Province'],
  ['postalCode', 'Postal code'],
  ['country', 'Country (ISO 2)'],
  ['businessNumber', 'Business Number (BN)'],
  ['gstNumber', 'GST number'],
  ['phone', 'Phone'],
  ['email', 'Email'],
  ['website', 'Website'],
  ['signatoryName', 'Default signatory (CUSMA)'],
  ['signatoryTitle', 'Signatory title'],
]

export function CompanyTab() {
  const s = useSession()
  const { company: c, saveCompany } = useData()
  const canEdit = s.user.role === 'admin'
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const save = async (patch: Partial<CompanyDetails>) => {
    setSaved(false)
    const r = await saveCompany(patch)
    if (!r.ok) setError(r.error ?? 'Could not save')
    else setSaved(true)
  }

  return (
    <SettingsChrome>
      {(
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
                value={c.addressLines?.[0] ?? ''}
                disabled={!canEdit}
                onChange={(e) => void save({ addressLines: [e.target.value] })}
              />
            </label>
            {FIELDS.map(([key, label]) => (
              <label key={key} className="block">
                <span className="label">{label}</span>
                <Input
                  value={String(c[key] ?? '')}
                  disabled={!canEdit}
                  onChange={(e) => void save({ [key]: e.target.value } as Partial<CompanyDetails>)}
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
  const { qboStatus: qbo } = useData()

  const cards: IntegrationCard[] = [
    {
      name: 'QuickBooks Online',
      what: 'Push invoices, estimates, customers and products; pull payment status back.',
      status: qbo?.connected ? 'live' : 'configured',
      detail: qbo?.connected ? `Connected to ${qbo.companyName || 'a company'}` : 'Not connected yet',
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

        <CalendarFeedCard />

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

export function ArchiveTab() {
  const s = useSession()
  const { archivedUsers, restoreUser } = useData()
  const canEdit = s.can('users', 'edit')
  const [error, setError] = useState('')

  return (
    <SettingsChrome>
      <div className="max-w-3xl space-y-3">
        <p className="text-sm text-muted">
          Archived people keep their history — their name still appears on the inspections they logged and the
          shelters they placed — but they cannot sign in and do not show in pickers.
        </p>
        {error && <p className="text-xs text-danger">{error}</p>}
        {archivedUsers.length === 0 ? (
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
                {archivedUsers.map((u) => (
                  <tr key={u.id} className="border-t border-subtle">
                    <td className="px-3 py-2 text-primary">{u.name || '—'}</td>
                    <td className="px-3 py-2 text-secondary">{u.email}</td>
                    <td className="px-3 py-2 text-secondary">{relativeDays(u.archivedAt)}</td>
                    <td className="px-3 py-2 text-right">
                      {canEdit && (
                        <Button
                          variant="ghost"
                          onClick={async () => {
                            const r = await restoreUser(u.id)
                            if (!r.ok) setError(r.error ?? 'Could not restore')
                            // The Users roster is active-only; re-read it so
                            // they are back in the list, not just out of this one.
                            else await s.refreshUsers()
                          }}
                        >
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

  const changePassword = async () => {
    setError('')
    setMsg('')
    if (pw.length < 8) return setError('Use at least 8 characters.')
    if (pw !== pw2) return setError("The two passwords do not match.")
    const r = await s.changePassword(pw)
    if (!r.ok) return setError(r.error ?? 'Could not change the password.')
    setPw('')
    setPw2('')
    setMsg('Password changed.')
  }

  return (
    <SettingsChrome>
      <div className="max-w-lg space-y-4">
        <div className="card space-y-3">
          <h3 className="text-sm font-semibold text-muted">You</h3>
          <AvatarPicker user={s.user} canEdit showButtons />
          <div className="text-sm">
            <div className="text-primary">{s.user.email}</div>
            <div className="mt-1">
              <Badge tone="brand">{s.user.role}</Badge>
            </div>
          </div>
          <label className="block">
            <span className="label">Display name</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => s.updateUserName(s.user.id, name.trim())}
            />
          </label>
        </div>

        {/* Installing comes before choosing what is on the home screen:
            one is no use without the other, and this is the step people
            ask for help with. */}
        <InstallCard />

        {/* Then what sits on it. */}
        <HomeTilesSettings />

        <MfaCard />

        <SignatureCard />

        <div className="card space-y-3">
          <h3 className="text-sm font-semibold text-muted">Appearance</h3>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-primary">Light theme</div>
              <div className="text-xs text-muted">Dark is the default. Stored on this device.</div>
            </div>
            <Switch
              checked={theme === 'light'}
              onChange={(v) => setTheme(v ? 'light' : 'dark')}
              label="Light theme"
            />
          </div>
        </div>

        {s.authMode === 'supabase' && (
          <div className="card space-y-3">
            <h3 className="text-sm font-semibold text-muted">Password</h3>
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

/**
 * Your signature image and title.
 *
 * PRIVATE. RLS on `user_signatures` is owner-only with no admin exception, so
 * this can only ever be your own — an admin who could read it could sign as
 * you, which would defeat the point. Other people add their own here; nobody
 * can pick up yours.
 */
function SignatureCard() {
  const { mySignature, saveMySignature, deleteMySignature } = useData()
  const [title, setTitle] = useState(mySignature?.title ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    setTitle(mySignature?.title ?? '')
  }, [mySignature?.title])

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setError('')
    setMsg('')
    const problem = checkSignatureImage(file)
    if (problem) return setError(problem.message)

    setBusy(true)
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('Could not read that file'))
      reader.readAsDataURL(file)
    }).catch((e) => {
      setError(e.message)
      return ''
    })
    if (!dataUrl) return setBusy(false)

    const r = await saveMySignature({ image: dataUrl, title })
    setBusy(false)
    if (!r.ok) setError(r.error ?? 'Could not save')
    else setMsg('Signature saved.')
  }

  return (
    <div className="card space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-muted">Your signature</h3>
        <p className="mt-1 text-xs text-muted">
          Only you can see or use this. Other people add their own; nobody can sign as you. Applying it to a
          document records who signed, when, from where, and a fingerprint of exactly what was signed.
        </p>
      </div>

      {mySignature?.image ? (
        <div className="rounded border border-subtle bg-[color:var(--paper)] p-3">
          <img src={mySignature.image} alt="Your signature" className="max-h-24 max-w-full object-contain" />
        </div>
      ) : (
        <p className="text-xs text-faint">No signature yet.</p>
      )}

      <label className="block">
        <span className="label">Title (prints under the signature)</span>
        <Input
          value={title}
          placeholder="Owner"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            if (mySignature?.image && title !== mySignature.title) {
              void saveMySignature({ image: mySignature.image, title })
            }
          }}
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <label className="btn-ghost cursor-pointer">
          <PenLine size={15} /> {mySignature ? 'Replace image' : 'Upload image'}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </label>
        {mySignature && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={async () => {
              const r = await deleteMySignature()
              if (!r.ok) setError(r.error ?? 'Could not remove')
            }}
          >
            <Trash2 size={15} /> Remove
          </Button>
        )}
      </div>

      <p className="text-xs text-faint">
        A PNG with a transparent background looks best. Crop it to just the signature — under{' '}
        {MAX_SIGNATURE_BYTES / 1024} KB. A photo of a signature on white paper works too.
      </p>

      {busy && <p className="text-xs text-muted">Saving…</p>}
      {error && <p className="text-xs text-danger">{error}</p>}
      {msg && (
        <p className="flex items-center gap-1 text-xs text-brand">
          <Check size={13} /> {msg}
        </p>
      )}
    </div>
  )
}


/**
 * The subscribable calendar link.
 *
 * A plain .ics URL that Google, Apple or Outlook polls on its own schedule.
 * No account needed at the other end, which is the point: an external grower
 * subscribes once and never signs in.
 *
 * The URL IS the credential, so it is treated like one — hidden until asked
 * for, and rotatable. "Stop sharing with someone" and "issue a new link" are
 * the same action here, which is worth saying out loud on screen rather than
 * leaving people to work out.
 */
function CalendarFeedCard() {
  const { calendarFeed: feed, regenerateFeedToken, setFeedEnabled } = useData()
  const s = useSession()
  const isAdmin = s.user.role === 'admin'
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!feed) {
    return (
      <div className="card mb-3">
        <div className="flex items-center gap-2 font-medium text-primary">
          <CalendarDays size={16} className="text-muted" /> Calendar subscription
        </div>
        <p className="mt-1 text-xs text-muted">Not set up yet — run migration 0023.</p>
      </div>
    )
  }

  const url = `${window.location.origin}/.netlify/functions/calendar-feed?token=${feed.token}`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      // Clipboard is blocked in some contexts; revealing the URL lets them
      // select it by hand rather than leaving them stuck.
      setRevealed(true)
      setError('Could not copy automatically — select the link below instead.')
    }
  }

  return (
    <div className="card mb-3 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-medium text-primary">
            <CalendarDays size={16} className={feed.enabled ? 'text-brand' : 'text-muted'} />
            Calendar subscription
            <Badge tone={feed.enabled ? 'green' : 'neutral'}>{feed.enabled ? 'On' : 'Off'}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted">
            Subscribe to this link in Google Calendar and incubation milestones appear there, staying current on
            their own. Read-only, and no account needed — you can send it to anyone.
          </p>
          <p className="mt-1 text-xs text-faint">
            {feed.fetchCount > 0
              ? `Fetched ${feed.fetchCount} time${feed.fetchCount === 1 ? '' : 's'}${
                  feed.lastFetchedAt
                    ? `, last ${new Date(feed.lastFetchedAt).toLocaleString('en-CA', {
                        timeZone: 'America/Edmonton',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}`
                    : ''
                }.`
              : 'Nothing has subscribed yet.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <Switch checked={feed.enabled} onChange={(v) => void setFeedEnabled(v)} label="Calendar feed on" />
          )}
          <Button variant="ghost" onClick={copy}>
            <Check size={15} className={copied ? '' : 'hidden'} />
            {copied ? 'Copied' : 'Copy link'}
          </Button>
          <Button variant="ghost" onClick={() => setRevealed((v) => !v)}>
            {revealed ? 'Hide' : 'Show'}
          </Button>
        </div>
      </div>

      {revealed && (
        <code className="block break-all rounded bg-inset p-2 text-xs text-secondary">{url}</code>
      )}

      <details className="text-xs text-muted">
        <summary className="cursor-pointer">How to subscribe</summary>
        <ol className="mt-1 list-decimal space-y-0.5 pl-5">
          <li>Copy the link above.</li>
          <li>
            In Google Calendar, open <strong>Other calendars → + → From URL</strong>, paste it, and add.
          </li>
          <li>It appears within a few minutes and refreshes itself after that.</li>
        </ol>
        <p className="mt-1">
          Google decides how often to re-poll — usually a few hours, occasionally up to a day. There is no way to
          make that faster from this side; that is what the full API connection would fix.
        </p>
      </details>

      {isAdmin && (
        <div className="flex flex-wrap items-center gap-2 border-t border-subtle pt-2">
          <Button
            variant="ghost"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setError('')
              const r = await regenerateFeedToken()
              setBusy(false)
              if (!r.ok) setError(r.error ?? 'Could not issue a new link')
              else setRevealed(true)
            }}
          >
            <RefreshCw size={15} /> {busy ? 'Working…' : 'Issue a new link'}
          </Button>
          <span className="text-xs text-faint">
            Anyone holding the current link keeps access until you do. This is how you revoke it — everyone will
            need the new one.
          </span>
        </div>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  )
}
