import { Moon, Sun } from 'lucide-react'
import { PageHeader, Badge, Card, Switch } from '@/components/ui'
import { useSession, ASSIGNABLE_ROLES, type Role } from '@/auth/session'
import { useTheme } from '@/styles/theme'

function roleTone(role: Role): 'brand' | 'blue' | 'amber' {
  if (role === 'admin' || role === 'developer') return 'brand'
  if (role === 'pending') return 'amber'
  return 'blue'
}

export default function UsersHome() {
  const s = useSession()
  const canEdit = s.can('users', 'edit')
  const pendingCount = s.users.filter((u) => u.role === 'pending').length
  const { theme, setTheme } = useTheme()
  const light = theme === 'light'

  return (
    <div>
      <PageHeader
        title="Users & Settings"
        subtitle="Roles and access (admin only)"
        actions={
          pendingCount > 0 ? <Badge tone="amber">{pendingCount} awaiting approval</Badge> : undefined
        }
      />
      <div className="space-y-6 p-4 md:p-6">
        {/* Appearance — personal, saved per device */}
        <Card className="max-w-md">
          <div className="label mb-1">Appearance</div>
          <h2 className="font-display font-semibold text-primary">Theme</h2>
          <p className="mt-0.5 text-sm text-muted">Dark is the default. Your choice is saved on this device.</p>
          <div className="mt-3 flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm text-secondary">
              {light ? <Sun size={16} /> : <Moon size={16} />}
              {light ? 'Light' : 'Dark'} theme
            </span>
            <Switch checked={light} onChange={(v) => setTheme(v ? 'light' : 'dark')} label="Toggle light theme" />
          </div>
        </Card>

        <div className="overflow-x-auto rounded-lg border border-subtle">
          <table className="w-full border-collapse bg-raised text-sm">
            <thead>
              <tr>
                <th className="th">Name</th>
                <th className="th">Email</th>
                <th className="th">Role</th>
              </tr>
            </thead>
            <tbody>
              {s.users.map((u) => {
                const isSelf = u.id === s.user.id
                return (
                  <tr
                    key={u.id}
                    className="border-t border-subtle"
                    style={u.role === 'pending' ? { background: 'var(--warn-bg)', color: 'var(--warn-fg)' } : undefined}
                  >
                    <td className="px-3 py-2 font-medium">{u.name}</td>
                    <td className="px-3 py-2 text-secondary">{u.email}</td>
                    <td className="px-3 py-2">
                      {canEdit ? (
                        <select
                          className="rounded-lg border border-default bg-raised px-2 py-1.5 text-sm disabled:bg-overlay disabled:text-faint"
                          value={u.role}
                          disabled={isSelf}
                          title={isSelf ? "You can't change your own role" : undefined}
                          onChange={(e) => s.updateUserRole(u.id, e.target.value as Role)}
                        >
                          {u.role === 'pending' && (
                            <option value="pending" disabled>
                              Pending — assign a role…
                            </option>
                          )}
                          {ASSIGNABLE_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Badge tone={roleTone(u.role)}>{u.role}</Badge>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-sm text-muted">
          {s.authMode === 'supabase'
            ? 'People sign up at the app and land here as “pending.” Assign them a role to grant access — no Supabase dashboard needed.'
            : 'Mock mode uses seeded users. In the Supabase backend, new sign-ups appear here for approval.'}
        </p>
      </div>
    </div>
  )
}
