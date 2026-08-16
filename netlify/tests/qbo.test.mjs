import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import { env, openToken, openTokens, sealToken, sealTokens } from '../functions/lib/qbo.mjs'

/**
 * Token encryption at rest.
 *
 * Intuit requires OAuth tokens to be encrypted in storage. These lock the
 * properties that requirement actually rests on — not just that a round trip
 * works, but that the ciphertext does not leak the token, that tampering is
 * caught rather than forwarded to Intuit, and that a connection made before
 * this existed still opens.
 */
const KEY = randomBytes(32).toString('base64')
const TOKEN = 'AB11730000000VvUIeYQ8vTAj0DcMxxNhSDIsRhQZmYJKAAAA'

let saved
beforeEach(() => {
  saved = process.env.QBO_TOKEN_KEY
  process.env.QBO_TOKEN_KEY = KEY
})
afterEach(() => {
  if (saved === undefined) delete process.env.QBO_TOKEN_KEY
  else process.env.QBO_TOKEN_KEY = saved
})

describe('sealToken / openToken', () => {
  it('round-trips a token', () => {
    expect(openToken(sealToken(TOKEN))).toBe(TOKEN)
  })

  it('does not leave the token readable in the ciphertext', () => {
    const sealed = sealToken(TOKEN)
    expect(sealed).not.toContain(TOKEN)
    // Nor in any encoding a casual grep of a database dump would turn up.
    expect(sealed).not.toContain(Buffer.from(TOKEN).toString('base64'))
    expect(sealed).not.toContain(Buffer.from(TOKEN).toString('base64url'))
  })

  it('produces a different ciphertext every time', () => {
    // A fresh IV per seal. Otherwise two connections holding the same token
    // would be visibly identical in the table.
    expect(sealToken(TOKEN)).not.toBe(sealToken(TOKEN))
  })

  it('REFUSES a token altered at rest instead of sending it to Intuit', () => {
    const sealed = sealToken(TOKEN)
    const flipped = sealed.slice(0, -2) + (sealed.endsWith('A') ? 'BB' : 'AA')
    expect(() => openToken(flipped)).toThrow()
  })

  it('will not open with a different key', () => {
    const sealed = sealToken(TOKEN)
    process.env.QBO_TOKEN_KEY = randomBytes(32).toString('base64')
    expect(() => openToken(sealed)).toThrow()
  })

  it('passes through a token stored before encryption existed', () => {
    // Connections made before this change hold plaintext. Refusing them would
    // break a live connection the moment this deployed; they re-seal on the
    // next refresh.
    expect(openToken(TOKEN)).toBe(TOKEN)
  })

  it('leaves empty and missing values alone', () => {
    // revoke() empties these columns, and they are NOT NULL.
    expect(sealToken('')).toBe('')
    expect(openToken('')).toBe('')
    expect(sealToken(null)).toBe(null)
    expect(openToken(undefined)).toBe(undefined)
  })

  it('rejects a key that is not 32 bytes', () => {
    process.env.QBO_TOKEN_KEY = Buffer.from('too short').toString('base64')
    expect(() => sealToken(TOKEN)).toThrow(/32 bytes/)
  })
})

describe('sealTokens / openTokens', () => {
  const row = { realm_id: '123', access_token: 'acc', refresh_token: 'ref', company_name: 'Books' }

  it('round-trips both token fields and leaves the rest of the row alone', () => {
    const sealed = sealTokens(row)
    expect(sealed.access_token).not.toBe('acc')
    expect(sealed.refresh_token).not.toBe('ref')
    expect(sealed.company_name).toBe('Books')
    expect(openTokens(sealed)).toMatchObject({ access_token: 'acc', refresh_token: 'ref', realm_id: '123' })
  })

  it('does not invent token fields on a patch that has none', () => {
    // Most writes to this table are partial — a company name, a mapping id. If
    // this added empty token columns it would wipe a live connection.
    const patch = sealTokens({ company_name: 'Books' })
    expect('access_token' in patch).toBe(false)
    expect('refresh_token' in patch).toBe(false)
  })
})

describe('env', () => {
  it('reports a missing token key, so the integration stops instead of storing in the clear', () => {
    delete process.env.QBO_TOKEN_KEY
    expect(env().missing).toContain('QBO_TOKEN_KEY')
  })

  it('does not report it once set', () => {
    expect(env().missing).not.toContain('QBO_TOKEN_KEY')
  })
})
