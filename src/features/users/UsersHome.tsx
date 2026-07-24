import { PageHeader, Badge } from '@/components/ui'
import { useSession, ASSIGNABLE_ROLES, type Role } from '@/auth/session'

function roleTone(role: Role): 'brand' | 'blue' | 'amber' {
  if (role === 'admin' || role === 'developer') return 'brand'
  if (role === 'pending') return 'amber'
  return 'blue'
}

export default function UsersHome() {
  const s = useSession()
  const canEdit = s.can('users', 'edit')
  const pendingCount = s.users.filter((u) => u.role === 'pending').length

  return (
    <div>
      <PageHeader
        title="Users & Settings"
        subtitle="Roles and access (admin only)"
        actions={
          pendingCount > 0 ? <Badge tone="amber">{pendingCount} awaiting approval</Badge> : undefined
        }
      />
      <div className="p-4 md:p-6">
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full border-collapse bg-white text-sm">
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
                  <tr key={u.id} className={`border-t border-slate-100 ${u.role === 'pending' ? 'bg-amber-50' : ''}`}>
                    <td className="px-3 py-2 font-medium">{u.name}</td>
                    <td className="px-3 py-2 text-slate-600">{u.email}</td>
                    <td className="px-3 py-2">
                      {canEdit ? (
                        <select
                          className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm disabled:bg-slate-100 disabled:text-slate-400"
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
        <p className="mt-4 text-sm text-slate-500">
          {s.authMode === 'supabase'
            ? 'People sign up at the app and land here as “pending.” Assign them a role to grant access — no Supabase dashboard needed.'
            : 'Mock mode uses seeded users. In the Supabase backend, new sign-ups appear here for approval.'}
        </p>
      </div>
    </div>
  )
}
