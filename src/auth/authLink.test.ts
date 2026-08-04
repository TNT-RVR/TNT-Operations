import { describe, it, expect } from 'vitest'
import { parseAuthType, typeNeedsPassword } from './authLink'

// A real Supabase invite lands as a URL fragment like this.
const INVITE_HASH =
  '#access_token=eyJhbGciOi.fake.token&expires_in=3600&refresh_token=abc123&token_type=bearer&type=invite'
const RECOVERY_HASH = '#access_token=eyJhbGciOi.fake.token&token_type=bearer&type=recovery'

describe('parseAuthType', () => {
  it('reads the type out of a real invite fragment', () => {
    expect(parseAuthType(INVITE_HASH)).toBe('invite')
  })
  it('reads a recovery fragment', () => {
    expect(parseAuthType(RECOVERY_HASH)).toBe('recovery')
  })
  it('falls back to the query string when there is no fragment', () => {
    expect(parseAuthType('', '?type=recovery')).toBe('recovery')
  })
  it('prefers the fragment over the query string', () => {
    expect(parseAuthType('#type=invite', '?type=recovery')).toBe('invite')
  })
  it('is null for an ordinary visit', () => {
    expect(parseAuthType('')).toBeNull()
    expect(parseAuthType('#')).toBeNull()
    expect(parseAuthType('', '?foo=bar')).toBeNull()
  })
  it('tolerates a hash with no leading # and a search with no leading ?', () => {
    expect(parseAuthType('type=invite')).toBe('invite')
    expect(parseAuthType('', 'type=recovery')).toBe('recovery')
  })
})

describe('typeNeedsPassword', () => {
  it('gates invite and recovery — the two that leave no usable password', () => {
    expect(typeNeedsPassword('invite')).toBe(true)
    expect(typeNeedsPassword('recovery')).toBe(true)
  })
  it('lets every other arrival straight through', () => {
    // A normal email confirmation already has a password set at signup.
    expect(typeNeedsPassword('signup')).toBe(false)
    expect(typeNeedsPassword('magiclink')).toBe(false)
    expect(typeNeedsPassword(null)).toBe(false)
  })
})
