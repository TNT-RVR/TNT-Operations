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
 * ── Why "Logins with no profile" exists ─────────────────────────────────────
 *
 * Everything on this screen reads `profiles`. An account can sign in without
 * one — the profile-only delete used to cause it — and such a person is then
 * invisible here while stuck on the approval gate, and cannot be re-invited
 * because the login already exists. Nothing showed the account both halves of
 * that stalemate were about. This panel does, and only appears when there is
 * one to show.
 *
 * ── Archive vs delete ────────────────────────────────────────────────────────
 *
 * Archive is the normal exit: they lose access and disappear from pickers, but
 * their name stays on the inspections they logged and the shelters they placed.
 * Delete destroys the login. Both are offered; archive is the one that isn't
 * destructive, so it comes first and reads as the default.
 */
import { useEffect, useState } from 'react'
import { ASSIGNABLE_ROLES, type OrphanLogin, type Role, useSession } from '@/auth/session'
import { useData } from '@/data/context'
import { Avatar, Badge, Button, EmptyState, IconButton, Input, Modal, Select } from '@/components/ui'
import { Archive, ExternalLink, Mail, Pencil, Plus, Send, Tablet, Trash2, TriangleAlert, UserPlus } from 'lucide-react'
import { AvatarPicker } from './AvatarPicker'
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
  const [addingDevice, setAddingDevice] = useState(false)
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

  // Logins with no profile. Checked once, quietly: it needs a server function,
  // so on mock data (or a dev server with no functions) it simply finds none.
  const [orphans, setOrphans] = useState<OrphanLogin[]>([])
  useEffect(() => {
    if (!canEdit) return
    let cancelled = false
    void s.listOrphanLogins().then((r) => {
      if (!cancelled && r.ok) setOrphans(r.logins)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit])

  const adopt = async (o: OrphanLogin, role: Role) => {
    setBusy(o.id)
    const r = await s.adoptOrphanLogin({ id: o.id, role, name: o.name })
    setBusy('')
    if (r.ok) {
      setOrphans((prev) => prev.filter((x) => x.id !== o.id))
      setNote(`${o.email} restored as ${role}. They can sign in with their existing password.`)
    } else setNote(r.error ?? 'Could not restore')
  }

  const resend = async (u: { email: string; name: string; role: Role }) => {
    setBusy(u.email)
    setNote('')
    const r = await s.inviteUser({ email: u.email, name: u.name, role: u.role })
    setBusy('')
    // "Already registered" is the expected answer for a resend — the account
    // exists, it's the sign-in that hasn't happened. Say something useful.
    // An address that already has a login cannot be re-invited, so the server
    // sends a set-password link instead. Name the mail that actually went out —
    // otherwise they go looking in their inbox for the wrong subject line.
    setNote(
      r.ok
        ? r.mode === 'recovery'
          ? `Sent ${u.email} a link to set their password. (The original invite can't be re-sent once the account exists.)`
          : `Invite re-sent to ${u.email}.`
        : (r.error ?? 'Could not resend.'),
    )
  }

  const archive = async (id: string) => {
    setBusy(id)
    const r = await archiveUser(id)
    // The roster is active-only, so it has to be re-read for them to leave it.
    if (r.ok) await s.refreshUsers()
    setBusy('')
    setNote(r.ok ? 'Archived. Restore them any time under Archive.' : (r.error ?? 'Could not archive'))
  }

  /**
   * Delete destroys the login itself, and there is no undo — a mis-click here
   * used to be silent, and (because it only removed the profile) left an
   * account that blocked re-inviting the same address. Ask first, then say
   * what happened.
   */
  const remove = async (u: { id: string; name: string; email: string }) => {
    if (!window.confirm(`Delete ${u.name || u.email} permanently? Their login is destroyed and cannot be restored — use Archive to keep their history.`)) return
    setBusy(u.id)
    const r = await s.deleteUser(u.id)
    setBusy('')
    setNote(r.ok ? `${u.email} deleted. That address can be invited again.` : (r.error ?? 'Could not delete'))
  }

  /**
   * "Where is the app again?" — the question that actually gets asked, months
   * after the invite mail it was answered in. Sends a magic link: the address
   * and a way in, in one click. Devices have no mailbox, so the row hides it.
   */
  const appLink = async (u: { id: string; email: string }) => {
    setBusy(u.id)
    const r = await s.sendAppLink(u.id)
    setBusy('')
    setNote(r.ok ? `Sent ${u.email} a link to the app. It signs them in, and expires after an hour.` : (r.error ?? 'Could not send the link'))
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
          <div className="flex gap-2">
            <Button onClick={() => setInviting(true)}>
              <Plus size={16} /> Add user
            </Button>
            {/* Separate button, not a role in the invite form: a device has no
                mailbox to invite, and the whole flow differs. */}
            <Button variant="ghost" onClick={() => setAddingDevice(true)}>
              <Tablet size={16} /> Add device
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-6">
        {note && <p className="rounded border border-subtle bg-overlay p-2 text-xs text-secondary">{note}</p>}

        {/* ── Logins with no profile ── */}
        {orphans.length > 0 && (
          <section>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-danger">
              <TriangleAlert size={15} /> Logins with no profile · {orphans.length}
            </h2>
            <div className="rounded-lg border border-danger/40 bg-danger/10 p-3">
              <p className="mb-3 text-xs text-secondary">
                These accounts can sign in but have no TNT profile, so they see only an error screen and cannot be
                invited again. Restore one to put it back on the roster — their password still works.
              </p>
              <ul className="space-y-2">
                {orphans.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-primary">{o.name || o.email}</div>
                      <div className="text-xs text-muted">
                        {o.email}
                        {o.lastSignInAt ? ` · last signed in ${relativeDays(o.lastSignInAt)}` : ' · never signed in'}
                      </div>
                    </div>
                    <RestoreLogin login={o} busy={busy === o.id} onRestore={(role) => void adopt(o, role)} />
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {/* ── Waiting on setup ── */}
        {waiting.length > 0 && (
          <section>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-warn">
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
                    <Avatar user={u} size="md" />
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
          <h2 className="mb-2 text-sm font-semibold text-muted">
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
                              <AvatarPicker user={u} canEdit={canEdit} />
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
                              {u.role !== 'device' && (
                                <IconButton
                                  label="Email them a link to the app"
                                  disabled={busy === u.id}
                                  onClick={() => void appLink(u)}
                                >
                                  <ExternalLink size={15} />
                                </IconButton>
                              )}
                              {!isYou && (
                                <>
                                  <IconButton label="Archive" onClick={() => void archive(u.id)}>
                                    <Archive size={15} />
                                  </IconButton>
                                  <IconButton label="Delete" onClick={() => void remove(u)}>
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
            Edit sets their name. The link button emails them the app's address — it signs them in, so it answers
            "where is it?" and "I'm locked out" at once. Archive hides them and signs them out — restore any time
            under Archive. Delete removes their login permanently. You can't archive or delete yourself.
          </p>
        </section>
      </div>

      {inviting && <InviteDialog onClose={() => setInviting(false)} />}
      {addingDevice && <DeviceDialog onClose={() => setAddingDevice(false)} />}
    </SettingsChrome>
  )
}

/**
 * Role picker + Restore for one orphaned login. Defaults to the role its
 * inviter chose, which is still on the auth user's metadata even though the
 * profile that should have carried it never appeared.
 */
function RestoreLogin({
  login,
  busy,
  onRestore,
}: {
  login: OrphanLogin
  busy: boolean
  onRestore: (role: Role) => void
}) {
  const [role, setRole] = useState<Role>(login.invitedRole ?? 'operator')
  return (
    <div className="flex items-center gap-2">
      <Select value={role} onChange={(e) => setRole(e.target.value as Role)} className="w-32">
        {ASSIGNABLE_ROLES.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </Select>
      <Button variant="ghost" disabled={busy} onClick={() => onRestore(role)}>
        <UserPlus size={15} /> {busy ? 'Restoring…' : 'Restore'}
      </Button>
    </div>
  )
}

/**
 * Create a shared-device account — a crew iPad — from a username and password.
 *
 * No email: the iPads belong to nobody, and inviting them would mean inventing
 * a mailbox per device and then clicking a confirmation link on a tablet in a
 * truck. The server makes an address on the reserved `.invalid` domain, which
 * can never receive mail or collide with a person's.
 *
 * Always the `device` role — maps-view and nothing else. An iPad left unlocked
 * on a seat should be worth no more than the map on its screen.
 */
function DeviceDialog({ onClose }: { onClose: () => void }) {
  const s = useSession()
  const [username, setUsername] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  const slug = username.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    const r = await s.createDeviceUser({ username, password, name })
    setBusy(false)
    if (r.ok) setDone(true)
    else setError(r.error ?? 'Could not create the device')
  }

  return (
    <Modal title="Add a device (iPad)" onClose={onClose}>
      {done ? (
        <div className="space-y-3">
          <p className="text-sm text-secondary">
            <strong className="text-primary">{name.trim() || slug}</strong> is ready. Sign in on the
            iPad with:
          </p>
          <div className="rounded-sm border border-default bg-inset p-2 font-mono text-sm">
            <div>{slug}@devices.invalid</div>
            <div>{password}</div>
          </div>
          <p className="text-xs text-amber-600">
            Write the password down now — it is not stored anywhere you can read it back.
          </p>
          <p className="text-xs text-muted">
            Then open Field Mode → Crews on the iPad and join its crew with &ldquo;Join as
            iPad&rdquo;, or assign it from Manage people.
          </p>
          <Button onClick={onClose}>Done</Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <label className="block">
            <span className="label">Username</span>
            <Input
              required
              value={username}
              placeholder="ipad-a"
              onChange={(e) => setUsername(e.target.value)}
            />
            {slug && (
              <span className="text-xs text-faint">Signs in as {slug}@devices.invalid</span>
            )}
          </label>
          <label className="block">
            <span className="label">Display name</span>
            <Input value={name} placeholder="iPad A" onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">Password</span>
            <Input
              required
              minLength={10}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <span className="text-xs text-faint">
              At least 10 characters. Typed once on the iPad and then left signed in.
            </span>
          </label>
          <p className="text-xs text-muted">
            Devices can see the field maps and report their crew position. They cannot change
            anything.
          </p>
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !slug || password.length < 10}>
              <Tablet size={16} /> {busy ? 'Creating…' : 'Create device'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
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
