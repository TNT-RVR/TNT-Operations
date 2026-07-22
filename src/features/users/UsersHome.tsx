import { PageHeader, Badge } from '@/components/ui'
import { useSession } from '@/auth/session'

export default function UsersHome() {
  const s = useSession()
  return (
    <div>
      <PageHeader title="Users & Settings" subtitle="Roles and access (admin only)" />
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
              {s.users.map((u) => (
                <tr key={u.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium">{u.name}</td>
                  <td className="px-3 py-2 text-slate-600">{u.email}</td>
                  <td className="px-3 py-2">
                    <Badge tone={u.role === 'admin' || u.role === 'developer' ? 'brand' : 'blue'}>{u.role}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-sm text-slate-500">
          In mock mode users are seeded. With the Supabase backend, admins invite users and set roles here.
        </p>
      </div>
    </div>
  )
}
