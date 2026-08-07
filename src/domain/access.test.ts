/**
 * Tests for editable permissions.
 *
 * The important ones are all about the lock. Editable access has exactly one
 * catastrophic failure — an admin removes admin access to the Users screen, and
 * nobody can reach the screen that would put it back. Everything here exists to
 * prove that cannot happen, including via a hand-edited database row.
 */
import { describe, it, expect } from 'vitest'
import { MODULES, type Action, type Module, type Role } from '@/auth/session'
import {
  type AccessOverrides,
  accessWarnings,
  allows,
  baseGrant,
  buildGrid,
  diffFromBase,
  effectiveGrant,
  isLocked,
} from './access'

/** A stand-in for the built-in matrix, so these tests don't move when it does. */
const MATRIX = {
  admin: { dashboard: 'edit', maps: 'edit', sales: 'edit', users: 'edit' },
  developer: { dashboard: 'edit', maps: 'edit', sales: 'edit', users: 'edit' },
  operator: { dashboard: 'view', maps: 'edit', sales: 'edit' },
  viewer: { dashboard: 'view', maps: 'view', sales: 'view' },
  pending: {},
} as unknown as Record<Role, Partial<Record<Module, Action>>>

const ROLES: Role[] = ['admin', 'developer', 'operator', 'viewer', 'pending']

describe('baseGrant', () => {
  it('reads the built-in matrix', () => {
    expect(baseGrant('operator', 'maps', MATRIX)).toBe('edit')
    expect(baseGrant('viewer', 'maps', MATRIX)).toBe('view')
  })

  it('is none for a module the role has no entry for', () => {
    expect(baseGrant('operator', 'users', MATRIX)).toBe('none')
    expect(baseGrant('pending', 'maps', MATRIX)).toBe('none')
  })
})

describe('effectiveGrant', () => {
  it('falls back to the built-in when there is no override', () => {
    expect(effectiveGrant('viewer', 'maps', MATRIX)).toBe('view')
  })

  it('applies an override', () => {
    const o: AccessOverrides = { viewer: { maps: 'edit' } }
    expect(effectiveGrant('viewer', 'maps', MATRIX, o)).toBe('edit')
  })

  it('applies an override that REMOVES access', () => {
    const o: AccessOverrides = { operator: { sales: 'none' } }
    expect(effectiveGrant('operator', 'sales', MATRIX, o)).toBe('none')
  })

  it('leaves other cells alone', () => {
    const o: AccessOverrides = { operator: { sales: 'none' } }
    expect(effectiveGrant('operator', 'maps', MATRIX, o)).toBe('edit')
    expect(effectiveGrant('viewer', 'sales', MATRIX, o)).toBe('view')
  })
})

describe('the lock', () => {
  it('marks admin/users as locked', () => {
    expect(isLocked('admin', 'users')).toBe(true)
    expect(isLocked('developer', 'users')).toBe(false)
    expect(isLocked('admin', 'maps')).toBe(false)
  })

  it('IGNORES an override that would strip admin access to Users', () => {
    // The whole point. Without this the app can be bricked from its own UI.
    const o: AccessOverrides = { admin: { users: 'none' } }
    expect(effectiveGrant('admin', 'users', MATRIX, o)).toBe('edit')
    expect(allows('admin', 'users', 'edit', MATRIX, o)).toBe(true)
  })

  it('ignores a DOWNGRADE to view as well as a removal', () => {
    const o: AccessOverrides = { admin: { users: 'view' } }
    expect(effectiveGrant('admin', 'users', MATRIX, o)).toBe('edit')
  })

  it('holds even against a hand-edited database row', () => {
    // A row written straight into Postgres bypasses the UI entirely; the lock
    // is applied on READ, so it still cannot take effect.
    const rogue: AccessOverrides = { admin: { users: 'none' } }
    expect(allows('admin', 'users', 'view', MATRIX, rogue)).toBe(true)
  })
})

describe('allows', () => {
  it('treats edit as satisfying view', () => {
    expect(allows('operator', 'maps', 'view', MATRIX)).toBe(true)
    expect(allows('operator', 'maps', 'edit', MATRIX)).toBe(true)
  })

  it('does not let view satisfy edit', () => {
    expect(allows('viewer', 'maps', 'view', MATRIX)).toBe(true)
    expect(allows('viewer', 'maps', 'edit', MATRIX)).toBe(false)
  })

  it('denies everything on none', () => {
    expect(allows('pending', 'maps', 'view', MATRIX)).toBe(false)
  })
})

describe('buildGrid', () => {
  it('covers every role and module', () => {
    const grid = buildGrid(ROLES, MATRIX)
    for (const r of ROLES) for (const m of MODULES) expect(grid[r][m]).toBeDefined()
  })

  it('layers overrides on top of the built-ins', () => {
    const grid = buildGrid(ROLES, MATRIX, { viewer: { sales: 'edit' } })
    expect(grid.viewer.sales).toBe('edit')
    expect(grid.viewer.maps).toBe('view')
  })
})

describe('diffFromBase', () => {
  it('saves NOTHING when the grid matches the built-ins', () => {
    // A fresh install must write no rows, so the app behaves exactly as the
    // hard-coded matrix always did.
    expect(diffFromBase(buildGrid(ROLES, MATRIX), MATRIX)).toEqual([])
  })

  it('saves only the cells that changed', () => {
    const grid = buildGrid(ROLES, MATRIX)
    grid.viewer.sales = 'edit'
    expect(diffFromBase(grid, MATRIX)).toEqual([{ role: 'viewer', module: 'sales', grant: 'edit' }])
  })

  it('never emits a row for a locked cell', () => {
    const grid = buildGrid(ROLES, MATRIX)
    // Even if the UI somehow set it, it must not be persisted.
    grid.admin.users = 'none'
    expect(diffFromBase(grid, MATRIX).some((d) => d.role === 'admin' && d.module === 'users')).toBe(false)
  })

  it('records a removal as an explicit none, not an absence', () => {
    // Absence means "use the built-in", so a removal has to be stored.
    const grid = buildGrid(ROLES, MATRIX)
    grid.operator.sales = 'none'
    expect(diffFromBase(grid, MATRIX)).toContainEqual({ role: 'operator', module: 'sales', grant: 'none' })
  })
})

describe('accessWarnings', () => {
  it('is quiet on a sane grid', () => {
    expect(accessWarnings(buildGrid(ROLES, MATRIX))).toEqual([])
  })

  it('BLOCKS a grid with no admin route to Users', () => {
    const grid = buildGrid(ROLES, MATRIX)
    grid.admin = { ...grid.admin, users: 'none' }
    const w = accessWarnings(grid)
    expect(w.some((x) => x.severity === 'blocker')).toBe(true)
  })

  it('warns when a role is left with nothing at all', () => {
    const grid = buildGrid(ROLES, MATRIX)
    for (const m of MODULES) grid.operator[m] = 'none'
    const w = accessWarnings(grid)
    expect(w.some((x) => x.severity === 'warning' && x.message.includes('operator'))).toBe(true)
  })

  it('does not warn about pending, which is meant to have nothing', () => {
    const grid = buildGrid(ROLES, MATRIX)
    expect(accessWarnings(grid).some((x) => x.message.includes('pending'))).toBe(false)
  })
})

describe('a realistic edit', () => {
  it('lets an operator be given user administration without touching anything else', () => {
    const grid = buildGrid(ROLES, MATRIX)
    grid.operator.users = 'view'
    const diff = diffFromBase(grid, MATRIX)
    expect(diff).toEqual([{ role: 'operator', module: 'users', grant: 'view' }])

    const overrides: AccessOverrides = { operator: { users: 'view' } }
    expect(allows('operator', 'users', 'view', MATRIX, overrides)).toBe(true)
    expect(allows('operator', 'users', 'edit', MATRIX, overrides)).toBe(false)
    expect(allows('operator', 'maps', 'edit', MATRIX, overrides)).toBe(true)
  })
})
