/**
 * Shared chrome for the Tasks section: the two tabs, the one place that calls
 * `loadTasks()`, and the offline indicator.
 *
 * The sync badge is deliberately always visible when there is queued work,
 * on every Tasks screen. Someone who ticked twenty checklist steps in a field
 * needs to know whether the office has seen them before they drive away.
 */
import { useEffect, type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { useData } from '@/data/context'
import { PageHeader } from '@/components/ui'
import { CloudOff } from 'lucide-react'

const TABS = [
  { to: '/tasks', label: 'Tasks', end: true },
  { to: '/tasks/checklists', label: 'Checklists' },
  { to: '/tasks/overall', label: 'Overall Checklist' },
]

export function TasksChrome({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
}) {
  const { loadTasks, tasksLoading, pendingSync } = useData()
  useEffect(() => {
    void loadTasks()
  }, [loadTasks])

  return (
    <div>
      <PageHeader title={title} subtitle={subtitle} actions={actions} />

      <div className="flex flex-wrap items-center gap-3 border-b border-subtle px-4 md:px-6">
        <div className="flex flex-wrap items-center gap-1">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                `tap-target -mb-px inline-flex items-center border-b-2 px-4 py-2 text-sm font-medium ${
                  isActive ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-secondary'
                }`
              }
            >
              {t.label}
            </NavLink>
          ))}
        </div>
        {pendingSync > 0 && (
          <span className="ml-auto flex items-center gap-1.5 py-2 text-xs text-warn">
            <CloudOff size={14} />
            {pendingSync} not synced
          </span>
        )}
      </div>

      <div className="p-4 md:p-6">
        {tasksLoading ? <p className="text-sm text-muted">Loading…</p> : children}
      </div>
    </div>
  )
}
