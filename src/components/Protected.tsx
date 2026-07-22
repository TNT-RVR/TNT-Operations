import type { ReactNode } from 'react'
import { useSession, type Module } from '@/auth/session'
import { NoAccess } from './ui'

/** Route/view gate: renders children only if the user can view `module`. */
export function Protected({ module, children }: { module: Module; children: ReactNode }) {
  const s = useSession()
  if (!s.can(module, 'view')) return <NoAccess />
  return <>{children}</>
}
