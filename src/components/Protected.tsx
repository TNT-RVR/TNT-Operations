import type { ReactNode } from 'react'
import { useSession, type Module, type Role } from '@/auth/session'
import { NoAccess } from './ui'

/** Route/view gate: renders children only if the user can view `module`. */
export function Protected({
  module,
  denyRoles,
  children,
}: {
  module: Module
  /**
   * Roles refused this route even though the module allows it.
   *
   * For screens inside a section a role otherwise needs — a crew iPad has
   * Blocks so it can scan, but the season Overview and the Returns map are
   * office reading it has no business with. Hiding the nav link alone is not
   * enough: a typed URL or a stale bookmark would walk straight in.
   */
  denyRoles?: readonly Role[]
  children: ReactNode
}) {
  const s = useSession()
  if (!s.can(module, 'view')) return <NoAccess />
  if (denyRoles?.includes(s.user.role)) return <NoAccess />
  return <>{children}</>
}
