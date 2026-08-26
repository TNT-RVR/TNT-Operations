import { describe, expect, it } from 'vitest'
import { launchRedirect, type LaunchContext } from './launchRoute'

const ctx = (over: Partial<LaunchContext> = {}): LaunchContext => ({
  path: '/field',
  standalone: true,
  historyLength: 1,
  canDashboard: true,
  ...over,
})

describe('launchRedirect', () => {
  // The case that made this exist: an icon installed when start_url was
  // /field, which reinstalling did not shift.
  it('sends a stale install to the home screen', () => {
    expect(launchRedirect(ctx())).toBe('/')
  })

  // Crews must never be moved. A device account has no dashboard, so this is
  // off for them by construction rather than by a role check that could drift.
  it('leaves a crew account in Field Mode', () => {
    expect(launchRedirect(ctx({ canDashboard: false }))).toBeNull()
  })

  it('does nothing in a browser tab, where the person chose the address', () => {
    expect(launchRedirect(ctx({ standalone: false }))).toBeNull()
  })

  // Once someone has moved around, /field is somewhere they went on purpose.
  it('does nothing once anything has been navigated', () => {
    expect(launchRedirect(ctx({ historyLength: 2 }))).toBeNull()
    expect(launchRedirect(ctx({ historyLength: 9 }))).toBeNull()
  })

  // Redirecting from "anywhere that is not /" would break every deep link.
  it('only rescues paths that were once a start_url', () => {
    expect(launchRedirect(ctx({ path: '/blocks/scan' }))).toBeNull()
    expect(launchRedirect(ctx({ path: '/tasks/overall' }))).toBeNull()
    expect(launchRedirect(ctx({ path: '/' }))).toBeNull()
  })

  it('does not touch a deeper field route', () => {
    expect(launchRedirect(ctx({ path: '/field/shelters' }))).toBeNull()
  })
})
