import { describe, expect, it } from 'vitest'
import { colLetter, firstRowIndexOf } from '../functions/lib/sheets.mjs'

describe('colLetter', () => {
  it('numbers columns the way a spreadsheet does', () => {
    expect(colLetter(0)).toBe('A')
    expect(colLetter(5)).toBe('F') // Structures Out, on the current sheet
    expect(colLetter(25)).toBe('Z')
  })
  // The wrap is where naive base-26 goes wrong: there is no "zero" column, so
  // 26 is AA, not BA — and a sheet that grows past Z would write into the wrong
  // column for the rest of the season.
  it('wraps past Z correctly', () => {
    expect(colLetter(26)).toBe('AA')
    expect(colLetter(27)).toBe('AB')
    expect(colLetter(51)).toBe('AZ')
    expect(colLetter(52)).toBe('BA')
  })
})

describe('firstRowIndexOf', () => {
  it('reads the first appended row, zero-based', () => {
    expect(firstRowIndexOf("'2027'!A16:A17")).toBe(15)
    expect(firstRowIndexOf('2026!A2:A2')).toBe(1)
    expect(firstRowIndexOf("'Sheet 1'!AA100:AA101")).toBe(99)
  })
  it('says nothing rather than guessing when the range is unusable', () => {
    expect(firstRowIndexOf(undefined)).toBeNull()
    expect(firstRowIndexOf('')).toBeNull()
    expect(firstRowIndexOf('A1:A2')).toBeNull() // no tab, so no anchor
  })
})
