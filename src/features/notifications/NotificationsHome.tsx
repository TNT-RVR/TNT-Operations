import { useState } from 'react'
import { PageHeader, EmptyState, Switch } from '@/components/ui'
import { useData, type NotificationPref } from '@/data/context'
import { AlertOctagon, AlertTriangle, Info, Trash2, CheckCheck, type LucideIcon } from 'lucide-react'
import type { NotificationSeverity } from '@/data/types'

/** Alert types the app can raise — the settings grid rows. */
const ALERT_TYPES: Array<{ type: string; label: string; hint: string }> = [
  { type: 'sensor_feed_stale', label: 'Sensor feed stale', hint: 'A Govee/ESP32 feed stops reporting (integration health).' },
  { type: 'temp_out_of_range', label: 'Temperature out of range', hint: 'An incubator leaves its temperature band.' },
  { type: 'humidity_out_of_range', label: 'Humidity out of range', hint: 'An incubator leaves its humidity band.' },
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
  const { notifications, markNotificationsRead, markAllNotificationsRead, deleteNotification, notificationPrefs, saveNotificationPref } =
    useData()
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
            <p className="mb-3 text-sm text-muted">
              Choose which alerts reach you, per channel. In-app shows in the bell; email and push delivery are stored
              now and activate when those channels are connected.
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
                      <label key={k} className="flex flex-col items-center gap-1 text-[11px] uppercase tracking-wider text-muted">
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
          <EmptyState>{tab === 'unread' ? 'No unread notifications. 🎉' : 'No read notifications yet.'}</EmptyState>
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
