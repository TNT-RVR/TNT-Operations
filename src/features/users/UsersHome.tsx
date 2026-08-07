/**
 * The Users tab: who has access, who was invited and never showed up.
 *
 * ── Why "Waiting on setup" is its own panel ──────────────────────────────────
 *
 * An invited user who never signed in has a profile and a role but cannot do
 * anything, and from the roster they are indistinguishable from an active
 * account. Two of TNT's invites had been sitting unaccepted for 26 days without
 * anyone noticing. Splitting them out — with how long it's been and a resend
 * button — turns an invisible failure into an obvious one.
 *
 * ── Archive vs delete ────────────────────────────────────────────────────────
 *
 * Archive is the normal exit: they lose access and disappear from pickers, but
 * their name stays on the inspections they logged and the shelters they placed.
 * Delete destroys the login. Both are offered; archive is the one that isn't
 * destructive, so it comes first and reads as the default.
 */
import { useState } from 'react'
import { ASSIGNABLE_ROLES, type Role, useSession } from '@/auth/session'
import { useData } from '@/data/context'
import { Badge, Button, EmptyState, IconButton, Input, Modal, Select } from '@/components/ui'
import { Archive, Mail, Pencil, Plus, Send, Trash2 } from 'lucide-react'
import { SettingsChrome, relativeDays } from './SettingsChrome'

function roleTone(role: Role): 'brand' | 'blue' | 'amber' | 'neutral' {
  if (role === 'admin') return 'brand'
  if (role === 'developer') return 'blue'
  if (role === 'pending') return 'amber'
  return 'neutral'
}

export default function UsersHome() {
  const s = useSession()
  const canEdit = s.can('users', 'edit')
  const { userPresence, archiveUser } = useData()
  const [inviting, setInviting] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')

  // An invited account that has never been signed into. Unknown (mock mode, or
  // pre-0018) counts as signed in, so nobody is wrongly shown as stuck.
  const neverSignedIn = (id: string) => {
    const p = userPresence[id]
    return p ? p.lastSignInAt == null : false
  }

  const waiting = s.users.filter((u) => neverSignedIn(u.id))
  const active = s.users.filter((u) => !neverSignedIn(u.id))

  const resend = async (u: { email: string; name: string; role: Role }) => {
    setBusy(u.email)
    setNote('')
    const r = await s.inviteUser({ email: u.email, name: u.name, role: u.role })
    setBusy('')
    // "Already registered" is the expected answer for a resend — the account
    // exists, it's the sign-in that hasn't happened. Say something useful.
    setNote(
      r.ok
        ? `Invite re-sent to ${u.email}.`
        : /already/i.test(r.error ?? '')
          ? `${u.email} already has an account — send them a password-reset link instead.`
          : (r.error ?? 'Could not resend.'),
    )
  }

  const archive = async (id: string) => {
    setBusy(id)
    const r = await archiveUser(id)
    setBusy('')
    setNote(r.ok ? 'Archived. Restore them any time under Archive.' : (r.error ?? 'Could not archive'))
  }

  const startEdit = (id: string, name: string) => {
    setEditing(id)
    setDraftName(name)
  }
  const commitEdit = () => {
    if (editing) s.updateUserName(editing, draftName.trim())
    setEditing(null)
  }

  return (
    <SettingsChrome
      actions={
        canEdit ? (
          <Button onClick={() => setInviting(true)}>
            <Plus size={16} /> Add user
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-6">
        {note && <p className="rounded border border-subtle bg-overlay p-2 text-xs text-secondary">{note}</p>}

        {/* ── Waiting on setup ── */}
        {waiting.length > 0 && (
          <section>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-warn">
              <Mail size={15} /> Waiting on setup · {waiting.length}
            </h2>
            <div className="rounded-lg border border-warn/40 bg-warn/10 p-3">
              <p className="mb-3 text-xs text-secondary">
                These people were invited but haven't signed in yet, so they can't use the app. Re-send their link
                if it got buried or went to junk.
              </p>
              <ul className="space-y-2">
                {waiting.map((u) => (
                  <li key={u.id} className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-primary">{u.name || '—'}</div>
                      <div className="text-xs text-muted">{u.email}</div>
                    </div>
                    {userPresence[u.id]?.invitedAt && (
                      <Badge tone="amber">invited {relativeDays(userPresence[u.id].invitedAt)}</Badge>
                    )}
                    {canEdit && (
                      <Button variant="ghost" onClick={() => void resend(u)} disabled={busy === u.email}>
                        <Send size={15} /> {busy === u.email ? 'Sending…' : 'Resend invite'}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {/* ── Active accounts ── */}
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">
            Active accounts · {active.length}
          </h2>
          {active.length === 0 ? (
            <EmptyState>No active accounts.</EmptyState>
          ) : (
            <div className="card overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="th text-left">Name</th>
                    <th className="th text-left">Email</th>
                    <th className="th text-left">Role</th>
                    <th className="th text-left">Status</th>
                    {canEdit && <th className="th text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {active.map((u) => {
                    const isYou = u.id === s.user.id
                    return (
                      <tr key={u.id} className="border-t border-subtle">
                        <td className="px-3 py-2">
                          {editing === u.id ? (
                            <Input
                              autoFocus
                              value={draftName}
                              onChange={(e) => setDraftName(e.target.value)}
                              onBlur={commitEdit}
                              onKeyDown={(e) => e.key === 'Enter' && commitEdit()}
                            />
                          ) : (
                            <span className="flex items-center gap-2">
                              <span className="font-medium text-primary">{u.name || '—'}</span>
                              {isYou && <Badge tone="neutral">you</Badge>}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-secondary">{u.email}</td>
                        <td className="px-3 py-2">
                          {canEdit && !isYou ? (
                            <Select
                              value={u.role}
                              onChange={(e) => s.updateUserRole(u.id, e.target.value as Role)}
                              className="w-32"
                            >
                              {ASSIGNABLE_ROLES.map((r) => (
                                <option key={r} value={r}>
                                  {r}
                                </option>
                              ))}
                              {u.role === 'pending' && <option value="pending">pending</option>}
                            </Select>
                          ) : (
                            <Badge tone={roleTone(u.role)}>{u.role}</Badge>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {u.role === 'pending' ? (
                            <Badge tone="amber">Awaiting approval</Badge>
                          ) : (
                            <Badge tone="green">Active</Badge>
                          )}
                        </td>
                        {canEdit && (
                          <td className="px-3 py-2">
                            <div className="flex justify-end gap-1">
                              <IconButton label="Edit name" onClick={() => startEdit(u.id, u.name)}>
                                <Pencil size={15} />
                              </IconButton>
                              {!isYou && (
                                <>
                                  <IconButton label="Archive" onClick={() => void archive(u.id)}>
                                    <Archive size={15} />
                                  </IconButton>
                                  <IconButton label="Delete" onClick={() => s.deleteUser(u.id)}>
                                    <Trash2 size={15} />
                                  </IconButton>
                                </>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs text-faint">
            Edit sets their name. Archive hides them and signs them out — restore any time under Archive. Delete
            removes their login permanently. You can't archive or delete yourself.
          </p>
        </section>
      </div>

      {inviting && <InviteDialog onClose={() => setInviting(false)} />}
    </SettingsChrome>
  )
}

function InviteDialog({ onClose }: { onClose: () => void }) {
  const s = useSession()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<Role>('operator')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    const r = await s.inviteUser({ email: email.trim(), name: name.trim(), role })
    setBusy(false)
    if (r.ok) setSent(true)
    else setError(r.error ?? 'Invite failed')
  }

  return (
    <Modal title="Invite a user" onClose={onClose}>
      {sent ? (
        <div className="space-y-3">
          <p className="text-sm text-secondary">
            Invite sent to <strong className="text-primary">{email}</strong>. They'll get an email with a link to
            set a password and arrive as <strong className="text-primary">{role}</strong>.
          </p>
          <p className="text-xs text-muted">
            Until they sign in they'll show under "Waiting on setup" — check back if it's been a few days.
          </p>
          <Button onClick={onClose}>Done</Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <label className="block">
            <span className="label">Email</span>
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">Name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">Role</span>
            <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ASSIGNABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </label>
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !email.trim()}>
              <Send size={16} /> {busy ? 'Sending…' : 'Send invite'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
