import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase, isSupabaseConfigured } from '@/data/supabaseClient'
import { LoginScreen } from './LoginScreen'
import { MfaChallenge } from './MfaChallenge'
import { MFA_OFF, readMfaState, type MfaState } from './mfa'
import { PendingApproval } from './PendingApproval'
import { SetPassword } from './SetPassword'
import { arrivedNeedingPassword, initialAuthType } from './authLink'
import { BeeMark } from '@/components/BeeMark'
import { type AccessOverrides, allows } from '@/domain/access'

/** App sections that can be permission-gated. Keep in sync with the nav + routes. */
/**
 * `field` and `calendar` are their own modules rather than riding on `maps`
 * and `incubation`. They used to share, which made "can see Field Mode" and
 * "can see Shelter Maps" the same permission — so a crew iPad could not be
 * given the field screens without also handing it the office planning tools.
 */
export const MODULES = ['dashboard', 'maps', 'field', 'incubation', 'calendar', 'blocks', 'analysis', 'sales', 'tasks', 'grants', 'users'] as const
export type Module = (typeof MODULES)[number]
export type Action = 'view' | 'edit'

export type Role = 'admin' | 'developer' | 'operator' | 'viewer' | 'device' | 'pending'

/** Roles an admin can assign in the Users screen (excludes the transient `pending`). */
export const ASSIGNABLE_ROLES: Role[] = ['admin', 'developer', 'operator', 'viewer', 'device']

export interface User {
  id: string
  name: string
  email: string
  role: Role
  /** Profile photo as a data URL, or null. Public — it shows on task rows. */
  avatar?: string | null
}

/** Role → what it can do. `edit` implies `view`. */
export const MATRIX: Record<Role, Partial<Record<Module, Action>>> = {
  // Full access — highest grant wins.
  admin: { dashboard: 'edit', maps: 'edit', field: 'edit', incubation: 'edit', calendar: 'edit', blocks: 'edit', analysis: 'edit', sales: 'edit', tasks: 'edit', grants: 'edit', users: 'edit' },
  developer: { dashboard: 'edit', maps: 'edit', field: 'edit', incubation: 'edit', calendar: 'edit', blocks: 'edit', analysis: 'edit', sales: 'edit', tasks: 'edit', grants: 'edit', users: 'edit' },
  // Field/office staff: run the operation, but not user administration.
  // `analysis: edit` is what lets them upload the season sheet.
  operator: { dashboard: 'view', maps: 'edit', field: 'edit', incubation: 'edit', calendar: 'edit', blocks: 'edit', analysis: 'edit', sales: 'edit', tasks: 'edit', grants: 'edit' },
  /**
   * A shared iPad in a truck, signed in permanently and belonging to nobody.
   *
   * It sees the four things a crew in a truck needs — Field Mode, Calendar,
   * Blocks and Tasks — and nothing else. No Shelter Maps, no Incubation, no
   * Sales, no Users: an unlocked iPad on a seat is a set of credentials in a
   * cab, and what it can reach should be what the crew is doing today.
   *
   * These are DEFAULTS. Every cell is adjustable per role in Users & Settings,
   * so tightening `blocks` to view-only is a switch rather than a deploy.
   *
   * Note it can still join a crew and broadcast: those are field_crew_members
   * writes gated on has_access(), not on a module grant. That is the one thing
   * a device account is FOR.
   */
  device: { field: 'edit', calendar: 'view', blocks: 'edit', tasks: 'edit' },
  // Read-only.
  viewer: { dashboard: 'view', maps: 'view', field: 'view', incubation: 'view', calendar: 'view', blocks: 'view', analysis: 'view', sales: 'view', tasks: 'view', grants: 'view' },
  // Signed up, awaiting admin approval — no access to anything.
  pending: {},
}

/** Whether `role` may perform `action` on `module`. Exported for the matrix test. */
/**
 * Per-role overrides from `app_role_access`, loaded once by the session
 * provider.
 *
 * Module-level rather than React state because `grants()` is called from
 * non-component code (route guards, the nav filter) and threading a context
 * through all of it would be a far larger change. The provider bumps a version
 * counter when this loads so `can()` is rebuilt and the UI re-renders.
 *
 * Before it loads this is empty, which means the built-in matrix applies —
 * the safe direction: a brief window of DEFAULT permissions, never a window of
 * elevated ones.
 */
let ACCESS_OVERRIDES: AccessOverrides = {}

export function setAccessOverrides(o: AccessOverrides): void {
  ACCESS_OVERRIDES = o
}

export function getAccessOverrides(): AccessOverrides {
  return ACCESS_OVERRIDES
}

export function grants(role: Role, module: Module, action: Action): boolean {
  // Delegates to the domain layer, which applies the admin/users lock — see
  // src/domain/access.ts. That lock is what makes editable permissions safe.
  return allows(role, module, action, MATRIX, ACCESS_OVERRIDES)
}

/** Seed users for mock mode. Real users come from Supabase `profiles` in supabase mode. */
const SEED_USERS: User[] = [
  { id: 'u_admin', name: 'Tyler (Admin)', email: 'tyler.torrie@gmail.com', role: 'admin' },
  { id: 'u_dev', name: 'Darren (Developer)', email: 'darren@example.com', role: 'developer' },
  { id: 'u_op', name: 'Field Operator', email: 'operator@example.com', role: 'operator' },
  { id: 'u_view', name: 'Viewer', email: 'viewer@example.com', role: 'viewer' },
  // A crew iPad, so the switcher can show what a device actually sees.
  { id: 'u_ipad', name: 'iPad A', email: 'ipad-a@devices.invalid', role: 'device' },
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
  /**
   * Set a profile photo. You may change your own; an admin may change anyone's.
   * That split is enforced by the `profiles self or admin update` policy from
   * migration 0001, not by this signature.
   */
  updateUserAvatar: (userId: string, avatar: string | null) => Promise<{ ok: boolean; error?: string }>
  /** Admins remove a user's profile (revokes access; they re-appear as pending
   *  if they sign in again). Cannot remove yourself. */
  deleteUser: (userId: string) => void
  /**
   * Admins email an invite. The invitee arrives with the role chosen here, so
   * they skip the pending queue (see migration 0011). Server-side only — it
   * needs the service key — so this posts to the invite-user function.
   */
  inviteUser: (input: { email: string; name: string; role: Role }) => Promise<{ ok: boolean; error?: string }>
  /**
   * Admins create a DEVICE account — a shared iPad — from a username and
   * password, with no email involved.
   *
   * The iPads belong to nobody, so inviting them would mean inventing a
   * mailbox per device and clicking a confirmation link on a tablet in a
   * truck. The server synthesises an address on the reserved `.invalid`
   * domain and creates the account already confirmed.
   */
  createDeviceUser: (input: {
    username: string
    password: string
    name: string
  }) => Promise<{ ok: boolean; error?: string }>
  /**
   * Change your OWN password. On the auth seam rather than the data seam,
   * because it is an identity operation, not a table write — and because the
   * Account screen would otherwise have to import the Supabase client directly.
   */
  changePassword: (password: string) => Promise<{ ok: boolean; error?: string }>
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
      updateUserAvatar: async (uid, avatar) => {
        setUsers((prev) => prev.map((u) => (u.id === uid ? { ...u, avatar } : u)))
        return { ok: true }
      },
      deleteUser: (uid) => {
        if (uid === user.id) return
        setUsers((prev) => prev.filter((u) => u.id !== uid))
      },
      // Mock: no email to send — drop the invitee straight into the roster.
      changePassword: async () => ({
        ok: false,
        error: 'Mock mode has no real login, so there is no password to change.',
      }),
      inviteUser: async ({ email, name, role }) => {
        if (users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
          return { ok: false, error: 'That email already has an account.' }
        }
        setUsers((prev) => [...prev, { id: `u_${Date.now()}`, name: name || email, email, role }])
        return { ok: true }
      },
      createDeviceUser: async ({ username, password, name }) => {
        const slug = username.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
        if (!slug) return { ok: false, error: 'Enter a username — letters and numbers.' }
        if (password.length < 10) return { ok: false, error: 'Use a password of at least 10 characters.' }
        const email = `${slug}@devices.invalid`
        if (users.some((u) => u.email === email)) {
          return { ok: false, error: `A device called "${slug}" already exists.` }
        }
        setUsers((prev) => [
          ...prev,
          { id: `u_${Date.now()}`, name: name.trim() || slug, email, role: 'device' as Role },
        ])
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
  // Only ever true for someone who chose to enrol a second factor. See mfa.ts.
  const [mfa, setMfa] = useState<MfaState>(MFA_OFF)

  useEffect(() => {
    let cancelled = false

    async function loadProfile(session: Awaited<ReturnType<typeof sb.auth.getSession>>['data']['session']) {
      if (!session) {
        if (cancelled) return
        setUser(null)
        setUsers([])
        setMfa(MFA_OFF)
        setStatus('signed-out')
        return
      }

      // Read the assurance level before anything is rendered. Enrolled users
      // hold a real session at this point — the password was accepted — so
      // without this the app would flash into view behind the challenge.
      const level = await readMfaState(sb)
      if (cancelled) return
      setMfa(level)
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
              // A refused role change used to fail into the console, so the
              // control simply did nothing and an admin had no way to know why.
              // `device` was rejected for a year's worth of reasons — an enum
              // that had never heard of it — and looked like a broken button.
              alert(
                `Could not set that role: ${error.message}

` +
                  'If this mentions the app_role type, the database has not been ' +
                  'taught the role yet — see migration 0028.',
              )
              return
            }
            setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role } : u)))
          })
      },
      updateUserAvatar: async (userId, avatar) => {
        if (!supabase) return { ok: false, error: 'Not connected' }
        const { error } = await supabase.from('profiles').update({ avatar }).eq('id', userId)
        if (error) return { ok: false, error: error.message }
        setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, avatar } : u)))
        return { ok: true }
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
      changePassword: async (password: string) => {
        if (!supabase) return { ok: false, error: 'Not connected' }
        const { error } = await supabase.auth.updateUser({ password })
        return error ? { ok: false, error: error.message } : { ok: true }
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
      createDeviceUser: async ({ username, password, name }) => {
        const { data } = await sb.auth.getSession()
        const token = data.session?.access_token
        if (!token) return { ok: false, error: 'Your session expired — sign in again.' }
        try {
          const res = await fetch('/.netlify/functions/create-device-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ username, password, name }),
          })
          const out = await res.json().catch(() => ({}))
          if (!res.ok) return { ok: false, error: out.error ?? `Could not create the device (${res.status})` }
          // Unlike an invite, the account exists NOW — show it straight away
          // rather than waiting for a refresh to prove it worked.
          setUsers((prev) =>
            prev.some((u) => u.id === out.id)
              ? prev
              : [...prev, { id: out.id, name: out.name, email: out.email, role: 'device' as Role }],
          )
          return { ok: true }
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : 'Could not create the device' }
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
  // Enrolled in two-factor, password accepted, code not yet given. Gated ahead
  // of everything else: an aal1 session is unproven, and the database's own
  // policies treat it that way, so nothing behind this should render.
  if (mfa.challengeRequired) {
    return <MfaChallenge onVerified={() => setMfa({ enrolled: true, challengeRequired: false })} onSignOut={value.signOut} />
  }
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
/**
 * Loads the stored permission overrides once, before anything renders.
 *
 * Gating render on this matters: without it the app paints with the built-in
 * matrix and then re-paints when the overrides land, so a role that has had a
 * section REMOVED would see it flash up and disappear. Worse, a route guard
 * could admit them in that window.
 *
 * A failure here is deliberately silent — the built-in matrix applies, which is
 * the safe direction. Users see default permissions, never elevated ones.
 */
function AccessGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!supabase) {
      setReady(true)
      return
    }
    let cancelled = false
    void supabase
      .from('app_role_access')
      .select('role, module, grant_level')
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          // Pre-0018 the table doesn't exist. Built-ins apply.
          console.warn('[auth] access overrides unavailable:', error.message)
        } else {
          const o: AccessOverrides = {}
          for (const r of data ?? []) {
            const role = r.role as Role
            o[role] = { ...(o[role] ?? {}), [r.module as Module]: r.grant_level }
          }
          setAccessOverrides(o)
        }
        setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!ready) return null
  return <>{children}</>
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const source = import.meta.env.VITE_DATA_SOURCE ?? 'mock'
  if (source === 'supabase' && isSupabaseConfigured) {
    return (
      <AccessGate>
        <SupabaseSessionProvider>{children}</SupabaseSessionProvider>
      </AccessGate>
    )
  }
  return <MockSessionProvider>{children}</MockSessionProvider>
}
