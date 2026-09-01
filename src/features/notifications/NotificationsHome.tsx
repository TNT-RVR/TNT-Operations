import { useState, useMemo } from 'react'
import { usePush } from './usePush'
import { visibleAlerts, hiddenCount } from '@/domain/alertMutes'
import { PageHeader, EmptyState, Switch } from '@/components/ui'
import { useData, type NotificationPref } from '@/data/context'
import { AlertOctagon, AlertTriangle, Info, Trash2, CheckCheck, BellRing, type LucideIcon } from 'lucide-react'
import type { NotificationSeverity } from '@/data/types'

/** Alert types the app can raise — the settings grid rows. */
const ALERT_TYPES: Array<{ type: string; label: string; hint: string }> = [
  { type: 'sensor_feed_stale', label: 'Sensor feed stale', hint: 'A Govee/ESP32 feed stops reporting (integration health).' },
  { type: 'sensor_offline', label: 'Sensor offline', hint: 'An incubator stops reporting anything at all. Raised by the hourly watchdog, with an all-clear when it comes back.' },
  { type: 'temp_out_of_range', label: 'Temperature out of range', hint: 'An incubator leaves its temperature band.' },
  { type: 'humidity_out_of_range', label: 'Humidity out of range', hint: 'An incubator leaves its humidity band.' },
  { type: 'hypoxia_silent', label: 'Hypoxia chamber silent', hint: 'A controlled-atmosphere chamber stopped reporting. It is sealed and nobody can see inside it from here.' },
  { type: 'hypoxia_fault', label: 'Hypoxia chamber fault', hint: 'The chamber controller raised its own error flag — its readings cannot be trusted until it clears.' },
  { type: 'hypoxia_out_of_band', label: 'Hypoxia oxygen out of band', hint: 'Oxygen drifted outside the target range. Purging and maintenance are excluded, since both leave the band on purpose.' },
  { type: 'milestone', label: 'Milestone due today', hint: 'Vapona in/out, earliest cool, expected release — from the calendar.' },
  { type: 'grant_new', label: 'New grant found', hint: 'The weekly search finds a funding program you could apply for.' },
  { type: 'task_assigned', label: 'Task assigned to you', hint: 'Someone assigns you a task or a checklist.' },
  { type: 'task_due_soon', label: 'Task due soon', hint: 'Your lead time before a task is due (set per task).' },
  { type: 'task_overdue', label: 'Task overdue', hint: 'A due date passed. Fires once on the crossing, not daily.' },
  { type: 'low_stock', label: 'Low stock', hint: 'A finished good drops below its reorder point. Fires on the crossing, not on every shipment.' },
  { type: 'qbo_sync_failed', label: 'QuickBooks sync failed', hint: 'A push to QuickBooks failed. Deduped to one per reason per hour.' },
  { type: 'qbo_auth_expired', label: 'QuickBooks disconnected', hint: 'The connection needs re-authorising — invoices stop reaching your books until it is.' },
  { type: 'anthropic_key_failed', label: 'Claude API key rejected', hint: 'The key expired, was revoked or is wrong. Grant pulls and analysis notes silently do nothing until it is replaced.' },
  { type: 'welcome', label: 'System announcements', hint: 'App news and account notices.' },
]
const DEFAULT_PREF: NotificationPref = { inApp: true, email: false, push: false }

const TZ = 'America/Edmonton'
const fmt = (iso: string) =>
  new Date(iso).toLocaleString('en-CA', { timeZone: TZ, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

const SEV: Record<NotificationSeverity, { icon: LucideIcon; color: string }> = {
  critical: { icon: AlertOctagon, color: 'text-danger' },
  warning: { icon: AlertTriangle, color: 'text-warn' },
  info: { icon: Info, color: 'text-info' },
}

export default function NotificationsHome() {
  const { notifications: allNotifications, markNotificationsRead, markAllNotificationsRead, deleteNotification, notificationPrefs, saveNotificationPref, mutedIncubatorIds } =
    useData()

  /**
   * The inbox is shared — one list, no recipient — so a personal mute is
   * applied here rather than at the database. Alerts about incubators this
   * user muted are hidden from THEM; everyone else's inbox is untouched.
   */
  const notifications = useMemo(
    () => visibleAlerts(allNotifications, mutedIncubatorIds),
    [allNotifications, mutedIncubatorIds],
  )
  const hidden = useMemo(
    () => hiddenCount(allNotifications, mutedIncubatorIds),
    [allNotifications, mutedIncubatorIds],
  )
  const [tab, setTab] = useState<'unread' | 'read' | 'settings'>('unread')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const unread = notifications.filter((n) => !n.readAt)
  const read = notifications.filter((n) => n.readAt)
  const list = tab === 'read' ? read : unread

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  const shownSelected = list.filter((n) => selected.has(n.id))
  const allSelected = list.length > 0 && shownSelected.length === list.length
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(list.map((n) => n.id)))
  const markSelected = () => {
    markNotificationsRead(shownSelected.map((n) => n.id))
    setSelected(new Set())
  }
  const switchTab = (t: 'unread' | 'read' | 'settings') => {
    setTab(t)
    setSelected(new Set())
  }

  const prefFor = (type: string): NotificationPref => notificationPrefs[type] ?? DEFAULT_PREF
  const setChannel = (type: string, channel: keyof NotificationPref, v: boolean) =>
    saveNotificationPref(type, { ...prefFor(type), [channel]: v })

  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle="Alerts about your integrations, incubators, and system health"
        actions={
          unread.length > 0 ? (
            <button className="btn-ghost" onClick={markAllNotificationsRead}>
              <CheckCheck size={16} /> Mark all read
            </button>
          ) : undefined
        }
      />

      <div className="p-4 md:p-6">
        {/* Tabs */}
        <div className="mb-4 flex items-center gap-1 border-b border-subtle">
          {(['unread', 'read', 'settings'] as const).map((t) => (
            <button
              key={t}
              onClick={() => switchTab(t)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium capitalize ${
 tab === t ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-secondary'
              }`}
            >
              {t}
              {t === 'unread' && unread.length > 0 && (
                <span className="ml-1.5 rounded-full bg-brand px-1.5 py-0.5 text-xs text-on-brand">{unread.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* Bulk actions (unread tab) */}
        {tab === 'unread' && list.length > 0 && (
          <div className="mb-3 flex items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              <span className="text-secondary">Select all</span>
            </label>
            {shownSelected.length > 0 && (
              <button className="btn-primary" onClick={markSelected}>
                Mark {shownSelected.length} read
              </button>
            )}
          </div>
        )}

        {tab === 'settings' ? (
          <div className="max-w-2xl space-y-2">
            <PushCard />
            <p className="mb-3 text-sm text-muted">
              Choose which alerts reach you, per channel. In-app shows in the bell. Push goes to any device where
              you've turned notifications on above; email is stored now and activates when that channel is connected.
            </p>
            {ALERT_TYPES.map((a) => {
              const p = prefFor(a.type)
              return (
                <div key={a.type} className="card flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-primary">{a.label}</div>
                    <div className="text-xs text-muted">{a.hint}</div>
                  </div>
                  <div className="flex items-center gap-5">
                    {(
                      [
                        ['inApp', 'In-app'],
                        ['email', 'Email'],
                        ['push', 'Push'],
                      ] as const
                    ).map(([k, label]) => (
                      <label key={k} className="flex flex-col items-center gap-1 text-[11px] text-muted">
                        {label}
                        <Switch checked={p[k]} onChange={(v) => setChannel(a.type, k, v)} label={`${a.label} via ${label}`} />
                      </label>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        ) : list.length === 0 ? (
          <EmptyState>
            {tab === 'unread' ? 'No unread notifications. 🎉' : 'No read notifications yet.'}
            {/* An inbox that quietly shows less is indistinguishable from a
                broken one, and the person who muted an incubator is exactly
                the person who should be reminded they did. */}
            {hidden > 0 && (
              <span className="mt-1 block text-xs text-faint">
                {hidden} hidden because you muted {hidden === 1 ? 'that incubator' : 'those incubators'}.
              </span>
            )}
          </EmptyState>
        ) : (

          <ul className="space-y-2">
            {list.map((n) => {
              const s = SEV[n.severity]
              const Icon = s.icon
              return (
                <li key={n.id} className={`card flex items-start gap-3 ${!n.readAt ? 'border-l-4 border-l-brand' : ''}`}>
                  {tab === 'unread' && (
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selected.has(n.id)}
                      onChange={() => toggle(n.id)}
                    />
                  )}
                  <Icon size={20} className={`mt-0.5 shrink-0 ${s.color}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-semibold text-primary">{n.title}</span>
                      <span className="text-xs text-faint">{fmt(n.createdAt)}</span>
                    </div>
                    {n.body && <p className="mt-0.5 text-sm text-secondary">{n.body}</p>}
                    <p className="mt-1 text-xs text-faint">
                      {n.category} · {n.source || 'system'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {!n.readAt && (
                      <button
                        className="rounded p-1 text-faint hover:bg-overlay hover:text-secondary"
                        title="Mark read"
                        onClick={() => markNotificationsRead([n.id])}
                      >
                        <CheckCheck size={16} />
                      </button>
                    )}
                    <button
                      className="rounded p-1 text-faint hover:bg-[color:var(--danger-bg)] hover:text-danger"
                      title="Delete"
                      onClick={() => deleteNotification(n.id)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

/**
 * Per-DEVICE push switch.
 *
 * Separate from the per-type grid below on purpose: that grid says WHICH alerts
 * you want, this says whether THIS phone or tablet is allowed to buzz. Both
 * have to be on for a push to arrive, and they're different questions.
 */
function PushCard() {
  const { state, error, enable, disable } = usePush()

  const body = () => {
    switch (state) {
      case 'busy':
        return <p className="text-xs text-muted">Checking…</p>
      case 'unsupported':
        return <p className="text-xs text-muted">This browser doesn’t support push notifications.</p>
      case 'ios-needs-install':
        return (
          <p className="text-xs text-muted">
            On iPhone, push only works once the app is installed: tap Share → Add to Home Screen, then open it from
            there and turn this on.
          </p>
        )
      case 'denied':
        return (
          <p className="text-xs text-danger">
            Notifications are blocked for this site. Allow them in your browser’s site settings, then come back.
          </p>
        )
      default:
        return (
          <p className="text-xs text-muted">
            {state === 'on'
              ? 'This device will buzz for the alert types you’ve enabled below.'
              : 'Get incubator alerts on this device, even when the app is closed.'}
          </p>
        )
    }
  }

  return (
    <div className="card mb-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-semibold text-primary">
            <BellRing size={16} className="text-brand" />
            Push notifications on this device
          </div>
          <div className="mt-1">{body()}</div>
          {error && <p className="mt-1 text-xs text-danger">{error}</p>}
        </div>
        {(state === 'on' || state === 'off') && (
          <Switch
            checked={state === 'on'}
            onChange={(v) => void (v ? enable() : disable())}
            label="Push notifications on this device"
          />
        )}
      </div>
    </div>
  )
}
