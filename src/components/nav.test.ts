import { describe, it, expect } from 'vitest'
import { reachableNav, USERS_ITEM } from './Layout'
import { MATRIX, MODULES, grants, type Module, type Role } from '@/auth/session'

/**
 * A phone must reach everywhere a desktop can.
 *
 * Users & Settings was rendered straight into the desktop sidebar and left out
 * of NAV, so it never reached either mobile list — on a phone there was simply
 * no route to it, and nothing failed to say so. The bottom bar shows four
 * primary sections and folds the rest behind "More", so anything missing from
 * the source list is not merely awkward on mobile, it is unreachable.
 *
 * These check the derivation for every role rather than one, because a gap that
 * only affects operators is exactly the one nobody notices.
 */
const ROLES = Object.keys(MATRIX) as Role[]

const canFor = (role: Role) => (m: Module) => grants(role, m, 'view')

describe('reachableNav', () => {
  it('covers every role without throwing', () => {
    for (const role of ROLES) expect(Array.isArray(reachableNav(canFor(role)))).toBe(true)
  })

  it('includes Users & Settings for every role that can view it', () => {
    for (const role of ROLES) {
      const can = canFor(role)
      const nav = reachableNav(can)
      expect(nav.some((n) => n.to === USERS_ITEM.to), `${role} should reach ${USERS_ITEM.to}`).toBe(can('users'))
    }
  })

  it('splits cleanly into the two mobile buckets, losing nothing', () => {
    // The bottom bar renders primary; "More" renders the rest. Anything in
    // neither is unreachable on a phone.
    for (const role of ROLES) {
      const nav = reachableNav(canFor(role))
      const primary = nav.filter((n) => n.mobilePrimary)
      const more = nav.filter((n) => !n.mobilePrimary)
      expect(primary.length + more.length).toBe(nav.length)
    }
  })

  it('keeps the bottom bar to four primary tabs plus More', () => {
    // Five labels plus More collide at 375px, which is every phone in the shop.
    for (const role of ROLES) {
      const primary = reachableNav(canFor(role)).filter((n) => n.mobilePrimary)
      expect(primary.length, `${role} has ${primary.length} primary tabs`).toBeLessThanOrEqual(4)
    }
  })

  it('gives every nav destination a module that exists', () => {
    const known = new Set<string>(MODULES as readonly string[])
    for (const n of reachableNav(() => true)) {
      expect(known.has(n.module), `${n.to} points at unknown module "${n.module}"`).toBe(true)
    }
  })

  it('has no duplicate destinations', () => {
    const tos = reachableNav(() => true).map((n) => n.to)
    expect(new Set(tos).size).toBe(tos.length)
  })
})
