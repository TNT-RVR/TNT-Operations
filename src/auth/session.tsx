import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

/** App sections that can be permission-gated. Keep in sync with the nav + routes. */
export const MODULES = ['dashboard', 'maps', 'incubation', 'sensors', 'users'] as const
export type Module = (typeof MODULES)[number]
export type Action = 'view' | 'edit'

export type Role = 'admin' | 'developer' | 'operator' | 'viewer'

export interface User {
  id: string
  name: string
  email: string
  role: Role
}

/** Role → what it can do. `edit` implies `view`. */
const MATRIX: Record<Role, Partial<Record<Module, Action>>> = {
  // Full access — highest grant wins.
  admin: { dashboard: 'edit', maps: 'edit', incubation: 'edit', sensors: 'edit', users: 'edit' },
  developer: { dashboard: 'edit', maps: 'edit', incubation: 'edit', sensors: 'edit', users: 'edit' },
  // Field/office staff: run the operation, but not user administration.
  operator: { dashboard: 'view', maps: 'edit', incubation: 'edit', sensors: 'edit' },
  // Read-only.
  viewer: { dashboard: 'view', maps: 'view', incubation: 'view', sensors: 'view' },
}

function grants(role: Role, module: Module, action: Action): boolean {
  const have = MATRIX[role][module]
  if (!have) return false
  if (action === 'view') return true // edit or view both satisfy view
  return have === 'edit'
}

/** Seed users for mock mode. Real users come from the backend in supabase mode. */
const SEED_USERS: User[] = [
  { id: 'u_admin', name: 'Tyler (Admin)', email: 'tyler.torrie@gmail.com', role: 'admin' },
  { id: 'u_dev', name: 'Darren (Developer)', email: 'darren@example.com', role: 'developer' },
  { id: 'u_op', name: 'Field Operator', email: 'operator@example.com', role: 'operator' },
  { id: 'u_view', name: 'Viewer', email: 'viewer@example.com', role: 'viewer' },
]

const LS_KEY = 'tnt.session.userId'

export interface SessionValue {
  user: User
  users: User[]
  can: (module: Module, action?: Action) => boolean
  switchUser: (id: string) => void
}

const SessionCtx = createContext<SessionValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string>(() => localStorage.getItem(LS_KEY) ?? SEED_USERS[0].id)

  const value = useMemo<SessionValue>(() => {
    const user = SEED_USERS.find((u) => u.id === userId) ?? SEED_USERS[0]
    return {
      user,
      users: SEED_USERS,
      can: (module, action = 'view') => grants(user.role, module, action),
      switchUser: (id) => {
        localStorage.setItem(LS_KEY, id)
        setUserId(id)
      },
    }
  }, [userId])

  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionCtx)
  if (!ctx) throw new Error('useSession must be used within <SessionProvider>')
  return ctx
}
