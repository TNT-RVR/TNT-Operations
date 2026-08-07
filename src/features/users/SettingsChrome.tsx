/**
 * Users & Settings — the tab bar, and the one place that loads settings data.
 *
 * Everything administrative lives behind these six tabs: people, what roles can
 * reach, company details, integrations, archived accounts, and your own
 * account. Previously the integrations were scattered across the sections they
 * belonged to, which meant "where do I connect QuickBooks?" had no obvious
 * answer.
 */
import { type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { PageHeader } from '@/components/ui'
import { Archive, Building2, Plug, ShieldCheck, UserCog, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export const SETTINGS_TABS: Array<{ to: string; label: string; icon: LucideIcon; end?: boolean }> = [
  { to: '/users', label: 'Users', icon: Users, end: true },
  { to: '/users/access', label: 'Access', icon: ShieldCheck },
  { to: '/users/company', label: 'Company', icon: Building2 },
  { to: '/users/integrations', label: 'Integrations', icon: Plug },
  { to: '/users/archive', label: 'Archive', icon: Archive },
  { to: '/users/account', label: 'Account', icon: UserCog },
]

export function SettingsChrome({ actions, children }: { actions?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <PageHeader title="Users & Settings" subtitle="People, access, and integrations" actions={actions} />

      <div className="border-b border-subtle px-4 md:px-6">
        <div className="flex flex-wrap items-center gap-1">
          {SETTINGS_TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                `-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium ${
                  isActive ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-secondary'
                }`
              }
            >
              <t.icon size={15} />
              {t.label}
            </NavLink>
          ))}
        </div>
      </div>

      <div className="p-4 md:p-6">{children}</div>
    </div>
  )
}

/** "26 days ago" — for the invite age on the waiting-on-setup list. */
export function relativeDays(iso: string | null | undefined): string {
  if (!iso) return ''
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (!Number.isFinite(days) || days < 0) return ''
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}
