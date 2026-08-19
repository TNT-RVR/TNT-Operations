import { describe, expect, it } from 'vitest'
import {
  isDoneBackground,
  mapColumns,
  mergeCell,
  parseSheetDate,
  parseSheetNote,
  readGrid,
  readSheetCell,
  serialToIso,
} from '../functions/lib/checklistSheet.mjs'

const cell = (formattedValue, opts = {}) => ({
  formattedValue,
  effectiveValue: opts.serial !== undefined ? { numberValue: opts.serial } : undefined,
  effectiveFormat: opts.bg ? { backgroundColor: opts.bg } : undefined,
})

const BLUE = { red: 74 / 255, green: 134 / 255, blue: 232 / 255 }
const WHITE = { red: 1, green: 1, blue: 1 }

describe('serialToIso', () => {
  // Google's epoch is 1899-12-30, not 1900-01-01. Getting it wrong shifts an
  // entire season by a day or two, which nobody notices until it matters.
  it('uses the 1899-12-30 epoch', () => {
    expect(serialToIso(1)).toBe('1899-12-31')
    expect(serialToIso(46181)).toBe('2026-06-08')
  })
  it('ignores anything that is not a number', () => {
    expect(serialToIso('46181')).toBeNull()
    expect(serialToIso(undefined)).toBeNull()
  })
})

describe('parseSheetDate', () => {
  it('reads a real date from its serial', () => {
    expect(parseSheetDate(cell('6/8/2026', { serial: 46181 }))).toBe('2026-06-08')
  })
  it('reads dates typed as text', () => {
    expect(parseSheetDate(cell('2026-06-08'))).toBe('2026-06-08')
    expect(parseSheetDate(cell('7/16/2026'))).toBe('2026-07-16')
  })
  // The sheet really contains these. A guessed date would record something
  // nobody said; the text belongs in the note instead.
  it('refuses to invent a date from prose', () => {
    expect(parseSheetDate(cell('Half- 7/16/2026'))).toBeNull()
    expect(parseSheetDate(cell('Most in June 29th, Rest July 4'))).toBeNull()
    expect(parseSheetNote(cell('Most in June 29th'))).toBe('Most in June 29th')
    expect(parseSheetNote(cell('2026-06-08'))).toBe('')
  })
})

describe('isDoneBackground', () => {
  it('recognises the blue TNT marks completion with', () => {
    expect(isDoneBackground(BLUE)).toBe(true)
  })
  it('is not fooled by white, no fill, or a pale tint', () => {
    expect(isDoneBackground(WHITE)).toBe(false)
    expect(isDoneBackground(undefined)).toBe(false)
    expect(isDoneBackground({ red: 1, green: 1, blue: 1, alpha: 0 })).toBe(false)
  })
  // Three seasons of hand-highlighting do not produce one exact blue.
  it('accepts near-misses of the same blue', () => {
    expect(isDoneBackground({ red: 0.26, green: 0.52, blue: 0.96 })).toBe(true)
    expect(isDoneBackground({ red: 0.4, green: 0.6, blue: 0.85 })).toBe(true)
  })
  it('does not call green or amber done', () => {
    expect(isDoneBackground({ red: 0.3, green: 0.75, blue: 0.4 })).toBe(false)
    expect(isDoneBackground({ red: 1, green: 0.72, blue: 0.21 })).toBe(false)
  })
})

describe('readSheetCell', () => {
  it('reads a plain date as PLANNED and a blue one as DONE', () => {
    expect(readSheetCell(cell('6/8/2026', { serial: 46181 }))).toMatchObject({
      plannedDate: '2026-06-08',
      completedDate: null,
    })
    expect(readSheetCell(cell('6/8/2026', { serial: 46181, bg: BLUE }))).toMatchObject({
      plannedDate: null,
      completedDate: '2026-06-08',
    })
  })
})

describe('mergeCell — app wins on conflict', () => {
  const snap = { plannedDate: '2026-06-08', completedDate: null }

  it('does nothing when neither side moved', () => {
    expect(mergeCell(snap, snap, snap).winner).toBe('none')
  })

  it('takes the sheet when only the sheet moved', () => {
    const sheet = { plannedDate: '2026-06-11', completedDate: null }
    const r = mergeCell(snap, sheet, snap)
    expect(r.winner).toBe('sheet')
    expect(r.value.plannedDate).toBe('2026-06-11')
  })

  it('takes the app when only the app moved', () => {
    const app = { plannedDate: '2026-06-08', completedDate: '2026-06-12' }
    const r = mergeCell(app, snap, snap)
    expect(r.winner).toBe('app')
    expect(r.value.completedDate).toBe('2026-06-12')
  })

  it('takes the app when BOTH moved', () => {
    const app = { plannedDate: '2026-06-08', completedDate: '2026-06-12' }
    const sheet = { plannedDate: '2026-06-20', completedDate: null }
    const r = mergeCell(app, sheet, snap)
    expect(r.winner).toBe('app')
    expect(r.value).toMatchObject({ plannedDate: '2026-06-08', completedDate: '2026-06-12' })
  })

  // The first ever sync: no snapshot, and the app is empty. Everything in the
  // sheet must flow in, or three seasons of history would be discarded on the
  // grounds that "the app wins".
  it('imports the sheet on the first sync, when the app holds nothing', () => {
    const sheet = { plannedDate: null, completedDate: '2026-06-19' }
    const r = mergeCell(null, sheet, null)
    expect(r.winner).toBe('sheet')
    expect(r.value.completedDate).toBe('2026-06-19')
  })

  it('keeps an app-only value when the sheet is blank and unchanged', () => {
    const app = { plannedDate: null, completedDate: '2026-07-01' }
    const r = mergeCell(app, null, null)
    expect(r.winner).toBe('app')
  })

  it('treats clearing a date as a change, not as nothing', () => {
    const app = { plannedDate: null, completedDate: null }
    const r = mergeCell(app, snap, snap)
    expect(r.winner).toBe('app')
    expect(r.value.plannedDate).toBeNull()
  })
})

describe('mapColumns / readGrid', () => {
  const header = {
    values: [
      cell('Field Name'),
      cell('Flag'),
      cell('Structures In'),
      cell('Mouse Poison'),
      cell('Bees In'),
      cell('Structures Out'),
      cell('Gallons'),
      cell('Image'),
    ],
  }

  it('finds each step by its header, not by position', () => {
    expect(mapColumns(header)).toMatchObject({
      flag: 1,
      structures_in: 2,
      mouse_poison: 3,
      bees_in: 4,
      structures_out: 5,
    })
  })

  // The 2023 sheet carries an extra "Blocks" column the others lack, so fixed
  // positions would write Bees In into the wrong column for that season.
  it('survives an extra column mid-row', () => {
    const shifted = { values: [cell('Field Name'), cell('Flag'), cell('Structures In'), cell('Blocks'), cell('Mouse Poison'), cell('Bees In')] }
    expect(mapColumns(shifted)).toMatchObject({ mouse_poison: 4, bees_in: 5 })
  })

  it('never claims a column it does not own', () => {
    expect(Object.values(mapColumns(header))).not.toContain(6) // Gallons
    expect(Object.values(mapColumns(header))).not.toContain(7) // Image
  })

  it('reads rows, skipping the ~1000 empty padding rows', () => {
    const grid = {
      rowData: [
        header,
        { values: [cell('BASF Stolk'), cell('6/8/2026', { serial: 46181, bg: BLUE })] },
        { values: [cell('')] },
        { values: [] },
        { values: [cell('Corteva Stolk'), cell('6/9/2026', { serial: 46182 })] },
      ],
    }
    const out = readGrid(grid)
    expect(out.rows.map((r) => r.fieldName)).toEqual(['BASF Stolk', 'Corteva Stolk'])
    expect(out.rows[0].cells.flag.completedDate).toBe('2026-06-08')
    expect(out.rows[1].cells.flag.plannedDate).toBe('2026-06-09')
  })
})
