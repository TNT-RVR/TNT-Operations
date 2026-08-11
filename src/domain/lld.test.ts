/**
 * Tests for Legal Land Description matching.
 *
 * The bug this module exists to fix: the field list matched with a plain
 * substring, so a field stored `SW-35-8-21-W4` was found by typing `35-8-21`
 * and NOT by typing `SW 35 8 21`. Which separator someone reaches for depends
 * on whether they are copying from a title, a spray record or memory, so the
 * search failed in exactly the case it exists for.
 */
import { describe, it, expect } from 'vitest'
import { formatLld, lldMatches, looksLikeLld, normalizeLld, parseLld } from './lld'

describe('normalizeLld', () => {
  it('reduces every common way of writing one to the same string', () => {
    const forms = [
      'SW-35-8-21-W4',
      'SW 35 8 21 W4',
      'sw35-8-21w4',
      'SW.35.8.21.W4',
      'SW-35-8-21-W4M',
      '  SW 35 8 21 W4  ',
    ]
    const normalized = forms.map(normalizeLld)
    expect(new Set(normalized).size).toBe(1)
    expect(normalized[0]).toBe('SW35821W4')
  })

  it('drops the quarter symbol from a scanned title', () => {
    expect(normalizeLld('SW¼ 35-8-21 W4')).toBe('SW35821W4')
    expect(normalizeLld('SW 1/4 35-8-21 W4')).toBe('SW35821W4')
  })

  it('treats W4 and W4M as the same meridian', () => {
    expect(normalizeLld('SW-35-8-21-W4M')).toBe(normalizeLld('SW-35-8-21-W4'))
  })

  it('is empty for nothing', () => {
    expect(normalizeLld('')).toBe('')
    expect(normalizeLld(null)).toBe('')
    expect(normalizeLld(undefined)).toBe('')
    expect(normalizeLld('---')).toBe('')
  })
})

describe('lldMatches', () => {
  const FIELD = 'SW-35-8-21-W4'

  it('FIXES THE BUG: matches when the separators differ', () => {
    expect(lldMatches(FIELD, 'SW 35 8 21 W4')).toBe(true)
    expect(lldMatches(FIELD, 'sw35821w4')).toBe(true)
    expect(lldMatches(FIELD, 'SW.35.8.21.W4')).toBe(true)
  })

  it('still matches the exact stored form', () => {
    expect(lldMatches(FIELD, FIELD)).toBe(true)
  })

  it('matches a partial description', () => {
    // Someone half-remembering the quarter should still find it.
    expect(lldMatches(FIELD, '35-8-21')).toBe(true)
    expect(lldMatches(FIELD, 'SW 35')).toBe(true)
    expect(lldMatches(FIELD, '821W4')).toBe(true)
  })

  it('does not match a different quarter of the same section', () => {
    expect(lldMatches(FIELD, 'NE 35 8 21 W4')).toBe(false)
  })

  it('does not match a different section', () => {
    expect(lldMatches(FIELD, 'SW 36 8 21 W4')).toBe(false)
  })

  it('is false for an empty query rather than matching everything', () => {
    // The caller decides what an empty box means; silently matching all would
    // make "no LLD typed" look like "every field is an LLD hit".
    expect(lldMatches(FIELD, '')).toBe(false)
    expect(lldMatches(FIELD, '   ')).toBe(false)
  })

  it('is false when the field has no LLD', () => {
    expect(lldMatches(null, '35-8-21')).toBe(false)
    expect(lldMatches('', '35-8-21')).toBe(false)
  })
})

describe('parseLld', () => {
  it('reads a full description', () => {
    expect(parseLld('SW-35-8-21-W4')).toEqual({
      quarter: 'SW',
      section: 35,
      township: 8,
      range: 21,
      meridian: 4,
    })
  })

  it('reads one written with spaces', () => {
    expect(parseLld('NE 12 9 15 W4')).toEqual({
      quarter: 'NE',
      section: 12,
      township: 9,
      range: 15,
      meridian: 4,
    })
  })

  it('reads one with no quarter', () => {
    expect(parseLld('35-8-21-W4')?.quarter).toBeNull()
  })

  it('reads one with no meridian', () => {
    expect(parseLld('SW-35-8-21')?.meridian).toBeNull()
  })

  it('accepts the M suffix', () => {
    expect(parseLld('SW-35-8-21-W4M')?.meridian).toBe(4)
  })

  it('REJECTS an impossible section rather than reporting it confidently', () => {
    // There are 36 sections in a township. 40 means we misread the string, and
    // a confident wrong answer is worse than none.
    expect(parseLld('SW-40-8-21-W4')).toBeNull()
    expect(parseLld('SW-0-8-21-W4')).toBeNull()
  })

  it('rejects an impossible range and meridian', () => {
    expect(parseLld('SW-35-8-99-W4')).toBeNull()
    expect(parseLld('SW-35-8-21-W9')).toBeNull()
  })

  it('rejects a township past the survey', () => {
    expect(parseLld('SW-35-200-21-W4')).toBeNull()
  })

  it('is null for a field name', () => {
    expect(parseLld('Wordmans')).toBeNull()
    expect(parseLld('')).toBeNull()
    expect(parseLld(null)).toBeNull()
  })
})

describe('formatLld', () => {
  it('canonicalises whatever was typed', () => {
    expect(formatLld('sw 35 8 21 w4')).toBe('SW-35-8-21-W4')
    expect(formatLld('SW-35-8-21-W4M')).toBe('SW-35-8-21-W4')
  })

  it('omits the parts that were not given', () => {
    expect(formatLld('35-8-21')).toBe('35-8-21')
    expect(formatLld('SW-35-8-21')).toBe('SW-35-8-21')
  })

  it('is null for something unreadable', () => {
    expect(formatLld('Wordmans')).toBeNull()
  })
})

describe('looksLikeLld', () => {
  it('recognises a query starting with a quarter', () => {
    expect(looksLikeLld('SW 35')).toBe(true)
    expect(looksLikeLld('ne 12-9-15')).toBe(true)
  })

  it('recognises a mostly-numeric query', () => {
    expect(looksLikeLld('35-8-21')).toBe(true)
    expect(looksLikeLld('12 9 15 W4')).toBe(true)
  })

  it('does NOT mistake a field name for one', () => {
    expect(looksLikeLld('Wordmans')).toBe(false)
    expect(looksLikeLld('Carrots')).toBe(false)
    expect(looksLikeLld('')).toBe(false)
  })

  it('does not mistake a year for one', () => {
    // "2025" is three-plus digits but people type it to filter by season.
    // It will still fall through to the plain text match, which is correct;
    // this only decides whether to ALSO try LLD matching.
    expect(looksLikeLld('2025')).toBe(true)
  })
})
