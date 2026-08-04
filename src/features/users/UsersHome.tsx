import { useState } from 'react'
import { Moon, Sun, Pencil, Trash2, Check, X, UserPlus } from 'lucide-react'
import { PageHeader, Badge, Card, Switch, IconButton, Modal } from '@/components/ui'
import { useSession, ASSIGNABLE_ROLES, type Role } from '@/auth/session'
import { useTheme } from '@/styles/theme'

/** Invite-by-email dialog. The invitee arrives with the role chosen here. */
function InviteDialog({ onClose }: { onClose: () => void }) {
  const s = useSession()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<Role>('operator')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await s.inviteUser({ email: email.trim(), name: name.trim(), role })
    setBusy(false)
    if (res.ok) setSent(true)
    else setError(res.error ?? 'Invite failed')
  }

  return (
    <Modal title="Invite a user" onClose={onClose}>
      {sent ? (
        <div className="space-y-4">
          <p
            className="rounded-md px-3 py-2 text-sm"
            style={{ background: 'var(--ok-bg)', border: '1px solid var(--ok-bd)', color: 'var(--ok-fg)' }}
          >
            Invite sent to <strong>{email}</strong>. They'll get an email with a link to set a password, and arrive
            with the <strong>{role}</strong> role — no approval needed.
          </p>
          <button className="btn-primary w-full" onClick={onClose}>
            Done
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <label className="block">
            <span className="label">Email</span>
            <input
              className="input"
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
            />
          </label>
          <label className="block">
            <span className="label">Name (optional)</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Their name" />
          </label>
          <label className="block">
            <span className="label">Role</span>
            <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ASSIGNABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-muted">
            They're emailed a link to set their own password. You never handle it.
          </p>
          {error && (
            <p
              className="rounded-md px-3 py-2 text-sm"
              style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger-bd)', color: 'var(--danger-fg)' }}
            >
              {error}
            </p>
          )}
          <div className="flex gap-2 pt-1">
            <button type="button" className="btn-ghost flex-1" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary flex-1" disabled={busy || !email.trim()}>
              {busy ? 'Sending…' : 'Send invite'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}

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

  // Inline rename state.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  // Two-step delete confirmation.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)

  function startEdit(id: string, name: string) {
    setEditingId(id)
    setEditName(name)
    setConfirmDeleteId(null)
  }
  function commitEdit() {
    if (editingId && editName.trim()) s.updateUserName(editingId, editName.trim())
    setEditingId(null)
  }

  return (
    <div>
      <PageHeader
        title="Users & Settings"
        subtitle="Roles and access (admin only)"
        actions={
          <div className="flex items-center gap-2">
            {pendingCount > 0 && <Badge tone="amber">{pendingCount} awaiting approval</Badge>}
            {canEdit && (
              <button className="btn-primary min-h-0 px-3 py-1.5 text-sm" onClick={() => setInviting(true)}>
                <UserPlus size={15} /> Invite user
              </button>
            )}
          </div>
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
                {canEdit && <th className="th w-24"></th>}
              </tr>
            </thead>
            <tbody>
              {s.users.map((u) => {
                const isSelf = u.id === s.user.id
                const editing = editingId === u.id
                const confirming = confirmDeleteId === u.id
                return (
                  <tr
                    key={u.id}
                    className="border-t border-subtle"
                    style={u.role === 'pending' ? { background: 'var(--warn-bg)', color: 'var(--warn-fg)' } : undefined}
                  >
                    <td className="px-3 py-2 font-medium">
                      {editing ? (
                        <span className="flex items-center gap-1.5">
                          <input
                            className="input min-h-0 w-44 px-2 py-1 text-sm"
                            value={editName}
                            autoFocus
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitEdit()
                              if (e.key === 'Escape') setEditingId(null)
                            }}
                          />
                          <IconButton label="Save name" onClick={commitEdit}>
                            <Check size={15} />
                          </IconButton>
                          <IconButton label="Cancel" onClick={() => setEditingId(null)}>
                            <X size={15} />
                          </IconButton>
                        </span>
                      ) : (
                        u.name || <span className="text-faint">—</span>
                      )}
                    </td>
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
                    {canEdit && (
                      <td className="px-3 py-2">
                        {confirming ? (
                          <span className="flex items-center gap-1.5">
                            <button
                              className="rounded-sm px-2 py-1 text-xs font-semibold"
                              style={{ background: 'var(--red-500)', color: 'var(--white)' }}
                              onClick={() => {
                                s.deleteUser(u.id)
                                setConfirmDeleteId(null)
                              }}
                            >
                              Remove
                            </button>
                            <IconButton label="Cancel" onClick={() => setConfirmDeleteId(null)}>
                              <X size={15} />
                            </IconButton>
                          </span>
                        ) : (
                          <span className="flex items-center gap-1">
                            <IconButton label="Edit name" onClick={() => startEdit(u.id, u.name)}>
                              <Pencil size={15} />
                            </IconButton>
                            {!isSelf && (
                              <IconButton label="Remove user" onClick={() => setConfirmDeleteId(u.id)}>
                                <Trash2 size={15} />
                              </IconButton>
                            )}
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-sm text-muted">
          {s.authMode === 'supabase'
            ? 'People sign up at the app and land here as "pending." Assign them a role to grant access. Removing a user revokes access — if they sign in again they re-appear as pending.'
            : 'Mock mode uses seeded users. In the Supabase backend, new sign-ups appear here for approval.'}
        </p>
      </div>
      {inviting && <InviteDialog onClose={() => setInviting(false)} />}
    </div>
  )
}
