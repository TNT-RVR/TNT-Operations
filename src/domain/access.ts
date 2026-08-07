/**
 * Effective permissions: the built-in matrix, plus per-role overrides stored in
 * the database. Pure functions — no React, no DB.
 *
 * ── Why there is a lock ──────────────────────────────────────────────────────
 *
 * Editable permissions have one catastrophic failure mode: an admin removes
 * admin access to the Users screen, and now nobody can reach the screen that
 * would put it back. The app is bricked short of a hand-written SQL statement
 * against production.
 *
 * So `admin` → `users` is pinned at `edit` and no override can move it. Every
 * other cell is yours. This is not a limitation to work around; it is the
 * ladder out of the hole.
 *
 * ── Overrides are sparse ─────────────────────────────────────────────────────
 *
 * Only cells that DIFFER from the built-in matrix are stored. A fresh install
 * has no override rows at all and behaves exactly as the hard-coded matrix
 * always did, which means this can be added to a live app without changing
 * anyone's access on the day it ships.
 */
import { MODULES, type Action, type Module, type Role } from '@/auth/session'

/** What a role may do with a section. `none` means the nav item is hidden. */
export type Grant = 'none' | 'view' | 'edit'

export const GRANTS: Grant[] = ['none', 'view', 'edit']

/** Sparse overrides: role → module → grant. Anything absent uses the built-in. */
export type AccessOverrides = Partial<Record<Role, Partial<Record<Module, Grant>>>>

/**
 * The cell that cannot be overridden.
 *
 * If you ever add a second lock, add it here rather than special-casing at a
 * call site — `isLocked` is what the UI greys out, and the two must agree or
 * the screen will offer a change it then silently discards.
 */
export const LOCKED: ReadonlyArray<{ role: Role; module: Module; grant: Grant }> = [
  { role: 'admin', module: 'users', grant: 'edit' },
]

export function isLocked(role: Role, module: Module): boolean {
  return LOCKED.some((l) => l.role === role && l.module === module)
}

/** The built-in grant for a cell, as a `Grant`. */
export function baseGrant(
  role: Role,
  module: Module,
  matrix: Record<Role, Partial<Record<Module, Action>>>,
): Grant {
  return matrix[role]?.[module] ?? 'none'
}

/**
 * What `role` may actually do with `module`, once overrides are applied.
 *
 * The lock wins over everything, including an override that says otherwise —
 * a stale or hand-edited row must not be able to brick the app either.
 */
export function effectiveGrant(
  role: Role,
  module: Module,
  matrix: Record<Role, Partial<Record<Module, Action>>>,
  overrides: AccessOverrides = {},
): Grant {
  const locked = LOCKED.find((l) => l.role === role && l.module === module)
  if (locked) return locked.grant
  return overrides[role]?.[module] ?? baseGrant(role, module, matrix)
}

/** Whether `role` may perform `action` on `module`. `edit` satisfies `view`. */
export function allows(
  role: Role,
  module: Module,
  action: Action,
  matrix: Record<Role, Partial<Record<Module, Action>>>,
  overrides: AccessOverrides = {},
): boolean {
  const g = effectiveGrant(role, module, matrix, overrides)
  if (g === 'none') return false
  return action === 'view' ? true : g === 'edit'
}

/**
 * Only the cells that differ from the built-in matrix.
 *
 * The editor holds a full grid in state; this is what gets saved. Storing the
 * whole grid would freeze today's defaults into the database, so a later change
 * to the built-in matrix would silently not apply to anyone.
 */
export function diffFromBase(
  grid: Record<Role, Partial<Record<Module, Grant>>>,
  matrix: Record<Role, Partial<Record<Module, Action>>>,
): Array<{ role: Role; module: Module; grant: Grant }> {
  const out: Array<{ role: Role; module: Module; grant: Grant }> = []
  for (const role of Object.keys(grid) as Role[]) {
    for (const module of MODULES) {
      const want = grid[role]?.[module]
      if (!want) continue
      if (isLocked(role, module)) continue
      if (want !== baseGrant(role, module, matrix)) out.push({ role, module, grant: want })
    }
  }
  return out
}

/** A full grid for the editor: built-ins with overrides layered on. */
export function buildGrid(
  roles: readonly Role[],
  matrix: Record<Role, Partial<Record<Module, Action>>>,
  overrides: AccessOverrides = {},
): Record<Role, Partial<Record<Module, Grant>>> {
  const grid = {} as Record<Role, Partial<Record<Module, Grant>>>
  for (const role of roles) {
    grid[role] = {}
    for (const module of MODULES) {
      grid[role][module] = effectiveGrant(role, module, matrix, overrides)
    }
  }
  return grid
}

export interface AccessWarning {
  severity: 'blocker' | 'warning'
  message: string
}

/**
 * Problems with a proposed grid, checked BEFORE it is saved.
 *
 * The blocker is the one that matters: no admin path to the Users screen. The
 * lock already guarantees it, so this is belt and braces — but a future edit to
 * LOCKED could remove the guarantee, and this check would catch it.
 */
export function accessWarnings(
  grid: Record<Role, Partial<Record<Module, Grant>>>,
): AccessWarning[] {
  const out: AccessWarning[] = []

  if (grid.admin?.users !== 'edit') {
    out.push({
      severity: 'blocker',
      message:
        'Admins must keep edit access to Users & Settings — it is the only way back if a permission change goes wrong.',
    })
  }

  const noAccess = (Object.keys(grid) as Role[]).filter(
    (r) => r !== 'pending' && MODULES.every((m) => grid[r]?.[m] === 'none'),
  )
  for (const r of noAccess) {
    out.push({
      severity: 'warning',
      message: `"${r}" can no longer reach any section. Anyone with that role will sign in to an empty app.`,
    })
  }

  return out
}
