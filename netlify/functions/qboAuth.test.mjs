import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { checkStateSignature, makeState } from './qbo-auth.mjs'
import { endpoints, resetDiscoveryCache } from './lib/qbo.mjs'

/**
 * The OAuth state parameter, and the discovery lookup.
 *
 * Intuit's callback carries no session, so `state` is the only thing tying it
 * back to the admin who started the flow. These lock the three properties that
 * makes it worth anything: it must be unforgeable, it must expire, and each
 * value must be distinct so that spending one cannot silently spend another.
 *
 * The single-use property itself lives in the database (a primary key on the
 * nonce), so it is not testable here without a live Postgres — what IS testable
 * here, and what actually broke before, is that a nonce exists at all and is
 * different every time.
 */
let saved
beforeEach(() => {
  saved = process.env.QBO_CLIENT_SECRET
  process.env.QBO_CLIENT_SECRET = 'test-client-secret'
})
afterEach(() => {
  if (saved === undefined) delete process.env.QBO_CLIENT_SECRET
  else process.env.QBO_CLIENT_SECRET = saved
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const USER = '11111111-2222-3333-4444-555555555555'

describe('OAuth state', () => {
  it('round-trips the user id', () => {
    expect(checkStateSignature(makeState(USER))?.userId).toBe(USER)
  })

  it('carries a DIFFERENT nonce every time', () => {
    // The whole single-use mechanism keys on this. Two states issued in the
    // same millisecond by the same admin were previously identical strings, so
    // spending one spent both.
    const a = checkStateSignature(makeState(USER))
    const b = checkStateSignature(makeState(USER))
    expect(a.nonce).not.toBe(b.nonce)
    expect(a.nonce.length).toBeGreaterThan(16)
  })

  it('rejects a forged signature', () => {
    const state = makeState(USER)
    const forged = state.replace(/\.[^.]+$/, '.notarealsignature')
    expect(checkStateSignature(forged)).toBeNull()
  })

  it('rejects a state signed with a different secret', () => {
    const state = makeState(USER)
    process.env.QBO_CLIENT_SECRET = 'a-different-secret'
    expect(checkStateSignature(state)).toBeNull()
  })

  it('rejects a tampered user id, so nobody can swap in another account', () => {
    const [, expiry, nonce, sig] = makeState(USER).split('.')
    expect(checkStateSignature(['99999999-0000-0000-0000-000000000000', expiry, nonce, sig].join('.'))).toBeNull()
  })

  it('expires', () => {
    const state = makeState(USER)
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 11 * 60 * 1000)
    expect(checkStateSignature(state)).toBeNull()
  })

  it('rejects junk without throwing', () => {
    // timingSafeEqual throws on a length mismatch, so the shape must be
    // checked before the comparison, not after.
    for (const junk of [null, undefined, '', 'x', 'a.b.c', 'a.b.c.d.e', '...']) {
      expect(() => checkStateSignature(junk)).not.toThrow()
      expect(checkStateSignature(junk)).toBeNull()
    }
  })
})

describe('discovery', () => {
  // The lookup is cached for twelve hours, so without this the first test here
  // would decide the answer for all of them.
  beforeEach(() => resetDiscoveryCache())

  it('uses the endpoints Intuit publishes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          authorization_endpoint: 'https://example.test/authorize',
          token_endpoint: 'https://example.test/token',
          revocation_endpoint: 'https://example.test/revoke',
        }),
      })),
    )
    expect(await endpoints()).toEqual({
      auth: 'https://example.test/authorize',
      token: 'https://example.test/token',
      revoke: 'https://example.test/revoke',
    })
  })

  it('falls back to the known endpoints when discovery is unreachable', async () => {
    // Discovery is one more thing in the path of connecting. If it is down,
    // refusing to talk to Intuit at all would be worse than using endpoints
    // that have not moved in years.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down')
      }),
    )
    const e = await endpoints()
    expect(e.token).toBe('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer')
    expect(e.auth).toBe('https://appcenter.intuit.com/connect/oauth2')
    expect(e.revoke).toBe('https://developer.api.intuit.com/v2/oauth2/tokens/revoke')
  })

  it('does not let a PARTIAL document blank out an endpoint we know', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ token_endpoint: 'https://example.test/token' }) })),
    )
    const e = await endpoints()
    expect(e.token).toBe('https://example.test/token')
    expect(e.auth).toBe('https://appcenter.intuit.com/connect/oauth2')
    expect(e.revoke).toBe('https://developer.api.intuit.com/v2/oauth2/tokens/revoke')
  })
})
