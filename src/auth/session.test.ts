import { describe, it, expect } from 'vitest'
import { grants, MODULES, type Role, type Module } from './session'

/**
 * Locks the role → module → action permission matrix. This is the security seam
 * that both route gating (`Protected`) and the Supabase RLS policies mirror, so
 * a regression here is a real access-control bug.
 */
describe('grants (role permission matrix)', () => {
  it('admin and developer can edit every module', () => {
    for (const role of ['admin', 'developer'] as Role[]) {
      for (const m of MODULES) {
        expect(grants(role, m, 'view')).toBe(true)
        expect(grants(role, m, 'edit')).toBe(true)
      }
    }
  })

  it('operator runs the operation but cannot administer users', () => {
    expect(grants('operator', 'maps', 'edit')).toBe(true)
    expect(grants('operator', 'incubation', 'edit')).toBe(true)
    expect(grants('operator', 'sensors', 'edit')).toBe(true)
    expect(grants('operator', 'dashboard', 'view')).toBe(true)
    expect(grants('operator', 'dashboard', 'edit')).toBe(false) // view-only
    expect(grants('operator', 'users', 'view')).toBe(false) // no users access at all
    expect(grants('operator', 'users', 'edit')).toBe(false)
  })

  it('operator can upload the season sheet', () => {
    // Analysis is office work, not field work, but the same people do it.
    expect(grants('operator', 'analysis', 'view')).toBe(true)
    expect(grants('operator', 'analysis', 'edit')).toBe(true)
  })

  it('viewer can read the analysis but cannot import over it', () => {
    expect(grants('viewer', 'analysis', 'view')).toBe(true)
    expect(grants('viewer', 'analysis', 'edit')).toBe(false)
  })

  it('viewer can view operational sections but never edit, and has no users access', () => {
    for (const m of ['dashboard', 'maps', 'incubation', 'sensors', 'analysis'] as Module[]) {
      expect(grants('viewer', m, 'view')).toBe(true)
      expect(grants('viewer', m, 'edit')).toBe(false)
    }
    expect(grants('viewer', 'users', 'view')).toBe(false)
  })

  it('only admin/developer reach the users module', () => {
    const canUsers = (['admin', 'developer', 'operator', 'viewer', 'pending'] as Role[]).filter((r) =>
      grants(r, 'users', 'view'),
    )
    expect(canUsers).toEqual(['admin', 'developer'])
  })

  it('pending (awaiting approval) can do nothing at all', () => {
    for (const m of MODULES) {
      expect(grants('pending', m, 'view')).toBe(false)
      expect(grants('pending', m, 'edit')).toBe(false)
    }
  })
})
