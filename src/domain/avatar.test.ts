/**
 * Tests for profile photos.
 *
 * Nearly all of these are about the INITIALS fallback, because that is what
 * most people will actually see — a task list of blank circles would make the
 * screen worse than no avatars at all.
 */
import { describe, it, expect } from 'vitest'
import {
  AVATAR_SIZES,
  MAX_AVATAR_BYTES,
  checkAvatarDataUrl,
  checkAvatarFile,
  initialsOf,
} from './avatar'

describe('initialsOf', () => {
  it('takes the first and last word of a name', () => {
    expect(initialsOf({ name: 'Tyler Torrie' })).toBe('TT')
  })

  it('uses the LAST word, not the second', () => {
    // "Stuart Van Der Berg" should read SB, not SV.
    expect(initialsOf({ name: 'Stuart Van Der Berg' })).toBe('SB')
  })

  it('takes two letters from a single-word name', () => {
    expect(initialsOf({ name: 'Witdouk' })).toBe('WI')
  })

  it('handles a one-letter name without crashing', () => {
    expect(initialsOf({ name: 'X' })).toBe('X')
  })

  it('ignores surrounding and repeated whitespace', () => {
    expect(initialsOf({ name: '  Tyler   Torrie  ' })).toBe('TT')
  })

  it('falls back to the email when there is no name', () => {
    // An invited user who has never signed in has only an email.
    expect(initialsOf({ name: '', email: 'tyler.torrie@gmail.com' })).toBe('TT')
  })

  it('treats plus-addressing as a word break', () => {
    expect(initialsOf({ email: 'tyler+claude@gmail.com' })).toBe('TC')
  })

  it('handles underscores and hyphens in an email', () => {
    expect(initialsOf({ email: 'alyson_buckley@example.com' })).toBe('AB')
    expect(initialsOf({ email: 'jean-luc@example.com' })).toBe('JL')
  })

  it('takes two letters from a single-token email', () => {
    expect(initialsOf({ email: 'darren@example.com' })).toBe('DA')
  })

  it('ignores a parenthetical suffix', () => {
    // Caught in the browser: "Tyler (Admin)" was rendering as "T(" because the
    // last word starts with a bracket. Roles and honorifics in a display name
    // are normal, not exotic.
    expect(initialsOf({ name: 'Tyler (Admin)' })).toBe('TY')
    expect(initialsOf({ name: 'Darren (Developer)' })).toBe('DA')
    expect(initialsOf({ name: 'Alyson Buckley (Sales)' })).toBe('AB')
  })

  it('ignores a leading honorific that is punctuation-only', () => {
    expect(initialsOf({ name: '- Chris Siemens' })).toBe('CS')
  })

  it('falls back to ? when a name is only punctuation', () => {
    expect(initialsOf({ name: '(((' })).toBe('?')
  })

  it('handles a non-Latin name', () => {
    expect(initialsOf({ name: 'Мария Иванова' })).toBe('МИ')
  })

  it('is ? when there is nothing at all', () => {
    expect(initialsOf({})).toBe('?')
    expect(initialsOf({ name: '   ', email: '' })).toBe('?')
  })

  it('is always uppercase', () => {
    expect(initialsOf({ name: 'braden palmer' })).toBe('BP')
  })

  it('never returns more than two characters', () => {
    // The circle is 24px at its smallest; three letters would not fit.
    for (const n of ['Tyler Torrie', 'X', 'Witdouk', 'A B C D E']) {
      expect(initialsOf({ name: n }).length).toBeLessThanOrEqual(2)
    }
  })
})

describe('checkAvatarFile', () => {
  it('accepts the common image types', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) {
      expect(checkAvatarFile({ type, size: 2_000_000 })).toBeNull()
    }
  })

  it('accepts a large phone photo, because it gets downscaled', () => {
    expect(checkAvatarFile({ type: 'image/jpeg', size: 8 * 1024 * 1024 })).toBeNull()
  })

  it('rejects a non-image', () => {
    expect(checkAvatarFile({ type: 'application/pdf', size: 1000 })?.message).toContain('PNG')
  })

  it('rejects an empty file', () => {
    expect(checkAvatarFile({ type: 'image/png', size: 0 })?.message).toContain('empty')
  })

  it('rejects something absurd before trying to decode it', () => {
    const p = checkAvatarFile({ type: 'image/jpeg', size: 40 * 1024 * 1024 })
    expect(p?.message).toContain('MB')
  })
})

describe('checkAvatarDataUrl', () => {
  const dataUrl = (bytes: number) => 'data:image/jpeg;base64,' + 'A'.repeat(Math.ceil((bytes * 4) / 3))

  it('accepts a downscaled photo', () => {
    expect(checkAvatarDataUrl(dataUrl(20_000))).toBeNull()
  })

  it('rejects one still over the stored limit', () => {
    expect(checkAvatarDataUrl(dataUrl(MAX_AVATAR_BYTES + 5_000))?.message).toContain('KB')
  })
})

describe('AVATAR_SIZES', () => {
  it('goes smallest to largest', () => {
    const v = Object.values(AVATAR_SIZES)
    expect([...v].sort((a, b) => a - b)).toEqual(v)
  })

  it('has a size small enough for a task row and one big enough to edit', () => {
    expect(AVATAR_SIZES.xs).toBeLessThanOrEqual(24)
    expect(AVATAR_SIZES.xl).toBeGreaterThanOrEqual(64)
  })
})
