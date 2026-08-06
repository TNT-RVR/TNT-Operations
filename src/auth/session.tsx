import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase, isSupabaseConfigured } from '@/data/supabaseClient'
import { LoginScreen } from './LoginScreen'
import { PendingApproval } from './PendingApproval'
import { SetPassword } from './SetPassword'
import { arrivedNeedingPassword, initialAuthType } from './authLink'
import { BeeMark } from '@/components/BeeMark'

/** App sections that can be permission-gated. Keep in sync with the nav + routes. */
export const MODULES = ['dashboard', 'maps', 'incubation', 'blocks', 'sensors', 'analysis', 'sales', 'grants', 'users'] as const
export type Module = (typeof MODULES)[number]
export type Action = 'view' | 'edit'

export type Role = 'admin' | 'developer' | 'operator' | 'viewer' | 'pending'

/** Roles an admin can assign in the Users screen (excludes the transient `pending`). */
export const ASSIGNABLE_ROLES: Role[] = ['admin', 'developer', 'operator', 'viewer']

export interface User {
  id: string
  name: string
  email: string
  role: Role
}

/** Role → what it can do. `edit` implies `view`. */
const MATRIX: Record<Role, Partial<Record<Module, Action>>> = {
  // Full access — highest grant wins.
  admin: { dashboard: 'edit', maps: 'edit', incubation: 'edit', blocks: 'edit', sensors: 'edit', analysis: 'edit', sales: 'edit', grants: 'edit', users: 'edit' },
  developer: { dashboard: 'edit', maps: 'edit', incubation: 'edit', blocks: 'edit', sensors: 'edit', analysis: 'edit', sales: 'edit', grants: 'edit', users: 'edit' },
  // Field/office staff: run the operation, but not user administration.
  // `analysis: edit` is what lets them upload the season sheet.
  operator: { dashboard: 'view', maps: 'edit', incubation: 'edit', blocks: 'edit', sensors: 'edit', analysis: 'edit', sales: 'edit', grants: 'edit' },
  // Read-only.
  viewer: { dashboard: 'view', maps: 'view', incubation: 'view', blocks: 'view', sensors: 'view', analysis: 'view', sales: 'view', grants: 'view' },
  // Signed up, awaiting admin approval — no access to anything.
  pending: {},
}

/** Whether `role` may perform `action` on `module`. Exported for the matrix test. */
export function grants(role: Role, module: Module, action: Action): boolean {
  const have = MATRIX[role][module]
  if (!have) return false
  if (action === 'view') return true // edit or view both satisfy view
  return have === 'edit'
}

/** Seed users for mock mode. Real users come from Supabase `profiles` in supabase mode. */
const SEED_USERS: User[] = [
  { id: 'u_admin', name: 'Tyler (Admin)', email: 'tyler.torrie@gmail.com', role: 'admin' },
  { id: 'u_dev', name: 'Darren (Developer)', email: 'darren@example.com', role: 'developer' },
  { id: 'u_op', name: 'Field Operator', email: 'operator@example.com', role: 'operator' },
  { id: 'u_view', name: 'Viewer', email: 'viewer@example.com', role: 'viewer' },
  { id: 'u_pending', name: 'New Signup', email: 'pending@example.com', role: 'pending' },
]

const LS_KEY = 'tnt.session.userId'

export type AuthMode = 'mock' | 'supabase'

export interface SessionValue {
  user: User
  /** Roster shown in the Users screen. Mock: seeds; supabase: profiles you can read. */
  users: User[]
  can: (module: Module, action?: Action) => boolean
  /** Mock: switch the active seed user. Supabase: no-op (identity is the login). */
  switchUser: (id: string) => void
  /** Mock: no-op. Supabase: sign out of the Supabase session. */
  signOut: () => void | Promise<void>
  /** Admins assign/approve a user's role (updates `profiles.role` in supabase mode). */
  updateUserRole: (userId: string, role: Role) => void
  /** Admins rename a user (updates `profiles.name` in supabase mode). */
  updateUserName: (userId: string, name: string) => void
  /** Admins remove a user's profile (revokes access; they re-appear as pending
   *  if they sign in again). Cannot remove yourself. */
  deleteUser: (userId: string) => void
  /**
   * Admins email an invite. The invitee arrives with the role chosen here, so
   * they skip the pending queue (see migration 0011). Server-side only — it
   * needs the service key — so this posts to the invite-user function.
   */
  inviteUser: (input: { email: string; name: string; role: Role }) => Promise<{ ok: boolean; error?: string }>
  authMode: AuthMode
}

const SessionCtx = createContext<SessionValue | null>(null)

export function useSession(): SessionValue {
  const ctx = useContext(SessionCtx)
  if (!ctx) throw new Error('useSession must be used within <SessionProvider>')
  return ctx
}

// ── Mock session: the seeded user switcher (no backend) ───────────────────────
function MockSessionProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string>(() => localStorage.getItem(LS_KEY) ?? SEED_USERS[0].id)
  const [users, setUsers] = useState<User[]>(SEED_USERS)
  const user = users.find((u) => u.id === userId) ?? users[0]

  const backToAdmin = () => {
    localStorage.setItem(LS_KEY, SEED_USERS[0].id)
    setUserId(SEED_USERS[0].id)
  }

  const value = useMemo<SessionValue>(
    () => ({
      user,
      users,
      can: (module, action = 'view') => grants(user.role, module, action),
      switchUser: (id) => {
        localStorage.setItem(LS_KEY, id)
        setUserId(id)
      },
      signOut: backToAdmin,
      updateUserRole: (uid, role) => setUsers((prev) => prev.map((u) => (u.id === uid ? { ...u, role } : u))),
      updateUserName: (uid, name) => setUsers((prev) => prev.map((u) => (u.id === uid ? { ...u, name } : u))),
      deleteUser: (uid) => {
        if (uid === user.id) return
        setUsers((prev) => prev.filter((u) => u.id !== uid))
      },
      // Mock: no email to send — drop the invitee straight into the roster.
      inviteUser: async ({ email, name, role }) => {
        if (users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
          return { ok: false, error: 'That email already has an account.' }
        }
        setUsers((prev) => [...prev, { id: `u_${Date.now()}`, name: name || email, email, role }])
        return { ok: true }
      },
      authMode: 'mock',
    }),
    [user, users],
  )

  // A pending user (e.g. selected in the switcher) sees the awaiting-approval gate.
  if (user.role === 'pending') return <PendingApproval name={user.name} onSignOut={backToAdmin} />
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>
}

// ── Supabase session: real auth backed by the `profiles` table ────────────────
interface ProfileRow {
  id: string
  name: string
  email: string
  role: Role
}

function mapProfile(row: ProfileRow, fallbackEmail: string): User {
  return {
    id: row.id,
    name: row.name || fallbackEmail || 'User',
    email: row.email || fallbackEmail || '',
    role: row.role,
  }
}

type AuthStatus = 'loading' | 'signed-out' | 'ready'

function SupabaseSessionProvider({ children }: { children: ReactNode }) {
  const sb = supabase! // guaranteed non-null: selector only mounts this when configured
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [user, setUser] = useState<User | null>(null)
  const [users, setUsers] = useState<User[]>([])
  // Set once, from the emailed link that opened the app (see authLink.ts).
  const [needsPassword, setNeedsPassword] = useState<boolean>(() => arrivedNeedingPassword())

  useEffect(() => {
    let cancelled = false

    async function loadProfile(session: Awaited<ReturnType<typeof sb.auth.getSession>>['data']['session']) {
      if (!session) {
        if (cancelled) return
        setUser(null)
        setUsers([])
        setStatus('signed-out')
        return
      }
      const authEmail = session.user.email ?? ''
      const { data, error } = await sb
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single()
      if (cancelled) return

      // The signup trigger creates the profile; if we race it, fall back to a
      // minimal viewer so the app still renders (an admin sets the real role).
      const u: User =
        error || !data
          ? { id: session.user.id, name: authEmail, email: authEmail, role: 'pending' }
          : mapProfile(data as ProfileRow, authEmail)
      setUser(u)

      // Admins/devs manage users, so hydrate the full roster for the Users screen;
      // everyone else can only see themselves (RLS enforces this too).
      if (u.role === 'admin' || u.role === 'developer') {
        const { data: all } = await sb.from('profiles').select('*').order('email', { ascending: true })
        if (!cancelled) setUsers(((all as ProfileRow[]) ?? []).map((r) => mapProfile(r, r.email)))
      } else {
        setUsers([u])
      }
      if (!cancelled) setStatus('ready')
    }

    sb.auth.getSession().then(({ data }) => loadProfile(data.session))
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      setStatus('loading')
      loadProfile(session)
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [sb])

  const value = useMemo<SessionValue | null>(() => {
    if (!user) return null
    return {
      user,
      users,
      can: (module, action = 'view') => grants(user.role, module, action),
      switchUser: () => {},
      signOut: async () => {
        await sb.auth.signOut()
      },
      updateUserRole: (userId, role) => {
        sb.from('profiles')
          .update({ role })
          .eq('id', userId)
          .then(({ error }) => {
            if (error) {
              console.error('[auth] updateUserRole:', error.message)
              return
            }
            setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role } : u)))
          })
      },
      updateUserName: (userId, name) => {
        sb.from('profiles')
          .update({ name })
          .eq('id', userId)
          .then(({ error }) => {
            if (error) {
              console.error('[auth] updateUserName:', error.message)
              return
            }
            setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, name } : u)))
          })
      },
      inviteUser: async ({ email, name, role }) => {
        const { data } = await sb.auth.getSession()
        const token = data.session?.access_token
        if (!token) return { ok: false, error: 'Your session expired — sign in again.' }
        try {
          const res = await fetch('/.netlify/functions/invite-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ email, name, role }),
          })
          const out = await res.json().catch(() => ({}))
          if (!res.ok) return { ok: false, error: out.error ?? `Invite failed (${res.status})` }
          // The profile row appears when they accept; show them as pending-invite
          // in the meantime so the admin can see it went out.
          setUsers((prev) =>
            prev.some((u) => u.email.toLowerCase() === email.toLowerCase())
              ? prev
              : [...prev, { id: `invited_${email}`, name: name || email, email, role }],
          )
          return { ok: true }
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : 'Invite failed' }
        }
      },
      deleteUser: (userId) => {
        if (userId === user.id) return // never remove yourself
        sb.from('profiles')
          .delete()
          .eq('id', userId)
          .then(({ error }) => {
            if (error) {
              console.error('[auth] deleteUser:', error.message)
              return
            }
            setUsers((prev) => prev.filter((u) => u.id !== userId))
          })
      },
      authMode: 'supabase',
    }
  }, [user, users, sb])

  if (status === 'loading') {
    return (
      <div className="grid min-h-full place-items-center bg-base">
        <div className="flex flex-col items-center gap-3 text-sm text-muted">
          <span className="animate-pulse" style={{ color: 'var(--logo-ink)' }}>
            <BeeMark size={48} />
          </span>
          Loading…
        </div>
      </div>
    )
  }
  if (!value) return <LoginScreen />
  // Arrived from an invite / reset email: signed in, but no usable password yet.
  // Gate the app until they choose one, or they could never sign back in.
  if (needsPassword) {
    return <SetPassword invited={initialAuthType() === 'invite'} onDone={() => setNeedsPassword(false)} />
  }
  // Signed in but not yet approved → awaiting-approval gate (no app, no data).
  if (value.user.role === 'pending') {
    return <PendingApproval name={value.user.name || value.user.email} onSignOut={value.signOut} />
  }
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>
}

/**
 * Picks the session backend the SAME way `DataProvider` picks its data source:
 * real Supabase Auth when `VITE_DATA_SOURCE=supabase` AND the client is
 * configured, else the mock user switcher. Keeping the two seams aligned means
 * `supabase` mode always pairs a real session with the RLS-guarded data.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const source = import.meta.env.VITE_DATA_SOURCE ?? 'mock'
  if (source === 'supabase' && isSupabaseConfigured) {
    return <SupabaseSessionProvider>{children}</SupabaseSessionProvider>
  }
  return <MockSessionProvider>{children}</MockSessionProvider>
}
