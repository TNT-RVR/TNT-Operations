import { useState } from 'react'
import { PageHeader, EmptyState } from '@/components/ui'
import { useData } from '@/data/context'
import { AlertOctagon, AlertTriangle, Info, Trash2, CheckCheck, type LucideIcon } from 'lucide-react'
import type { NotificationSeverity } from '@/data/types'

const TZ = 'America/Edmonton'
const fmt = (iso: string) =>
  new Date(iso).toLocaleString('en-CA', { timeZone: TZ, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

const SEV: Record<NotificationSeverity, { icon: LucideIcon; color: string }> = {
  critical: { icon: AlertOctagon, color: 'text-danger' },
  warning: { icon: AlertTriangle, color: 'text-warn' },
  info: { icon: Info, color: 'text-info' },
}

export default function NotificationsHome() {
  const { notifications, markNotificationsRead, markAllNotificationsRead, deleteNotification } = useData()
  const [tab, setTab] = useState<'unread' | 'read'>('unread')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const unread = notifications.filter((n) => !n.readAt)
  const read = notifications.filter((n) => n.readAt)
  const list = tab === 'unread' ? unread : read

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
  const switchTab = (t: 'unread' | 'read') => {
    setTab(t)
    setSelected(new Set())
  }

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
          {(['unread', 'read'] as const).map((t) => (
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

        {list.length === 0 ? (
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
