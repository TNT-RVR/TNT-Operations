import { describe, it, expect } from 'vitest'
import { parseCsv, parseNumber, normalizeHeader, parseXraySheet, mapSheetRows } from './xrayImport'

describe('normalizeHeader', () => {
  it('lowercases, trims, drops ? and collapses whitespace', () => {
    expect(normalizeHeader('  Total   KGs ')).toBe('total kgs')
    expect(normalizeHeader('Live Bees per Pound?')).toBe('live bees per pound')
    expect(normalizeHeader('')).toBe('')
  })
})

describe('parseNumber', () => {
  it('strips commas, percent and dollar signs', () => {
    expect(parseNumber('1,117')).toBe(1117)
    expect(parseNumber('86%')).toBe(86)
    expect(parseNumber('$5.66')).toBe(5.66)
    expect(parseNumber(' 2.57 ')).toBe(2.57)
  })

  it('treats blanks and junk as no value', () => {
    expect(parseNumber('')).toBeNull()
    expect(parseNumber('   ')).toBeNull()
    expect(parseNumber(null)).toBeNull()
    expect(parseNumber(undefined)).toBeNull()
    expect(parseNumber('n/a')).toBeNull()
  })
})

describe('parseCsv', () => {
  it('handles quoted fields containing commas and newlines', () => {
    const csv = 'a,b\n"one, two","line1\nline2"'
    expect(parseCsv(csv)).toEqual([
      ['a', 'b'],
      ['one, two', 'line1\nline2'],
    ])
  })

  it('treats doubled quotes as an escaped quote', () => {
    expect(parseCsv('x\n"say ""hi"""')).toEqual([['x'], ['say "hi"']])
  })

  it('strips a UTF-8 BOM so the first header still matches', () => {
    const [header] = parseCsv('﻿Sample Name,Total KGs\nA,1')
    expect(header[0]).toBe('Sample Name')
  })

  it('handles CRLF and drops blank lines', () => {
    expect(parseCsv('a,b\r\n1,2\r\n\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
})

describe('parseXraySheet', () => {
  const csv = [
    'Sample Name,Total KGs,Live Bees per KG,Parasites,Chalkbrood,Total Gal Bees,Total KG for 2gal,Expected Trays,Incubator Space,Notes',
    '26-102,506.7,9866,1.2,0.4,520,2.57,250,0.11,Strong lot',
    '#4 Sanfoin,177.8,9039,,,180,2.32,71,,',
  ].join('\n')

  it('converts a kg column to pounds rather than storing both', () => {
    // Kilograms are pounds times a constant. Keeping the second copy is what
    // let the imported data carry a kg figure 2.2x too large without anyone
    // noticing, so the import now keeps only the pounds.
    const { samples } = parseXraySheet(csv)
    expect(samples[0].totalWeightKg).toBeUndefined()
    expect(samples[0].totalWeightLbs).toBeCloseTo(1117.08, 1)
    expect(samples[1].totalWeightLbs).toBeCloseTo(391.98, 1)
  })

  it('keeps the sheet’s pounds when it carries both units', () => {
    const { samples } = parseXraySheet(
      ['Sample Name,Total Pounds,Total KGs', '26-102,1117,506.7'].join('\n'),
    )
    expect(samples[0].totalWeightLbs).toBe(1117)
    expect(samples[0].totalWeightKg).toBeUndefined()
  })

  it('maps the desktop app’s headers onto sample fields', () => {
    const { samples } = parseXraySheet(csv)
    expect(samples).toHaveLength(2)
    expect(samples[0]).toMatchObject({
      name: '26-102',
      liveBeesPerKg: 9866,
      parasites: 1.2,
      chalkbrood: 0.4,
      totalVolumeGal: 520,
      kgPer2Gal: 2.57,
      totalTrays: 250,
      incubatorSpace: 0.11,
      notes: 'Strong lot',
    })
  })

  it('accepts "Expected Trays" as an alias for total trays', () => {
    const { samples } = parseXraySheet('Sample Name,Total Trays\nA,12')
    expect(samples[0].totalTrays).toBe(12)
  })

  it('leaves blank numeric cells as null rather than 0', () => {
    const { samples } = parseXraySheet(csv)
    // A missing parasite count must not read as "zero parasites".
    expect(samples[1].parasites).toBeNull()
    expect(samples[1].chalkbrood).toBeNull()
  })

  it('skips rows with no sample name, and reports how many', () => {
    const { samples, skipped } = parseXraySheet('Sample Name,Total KGs\n,5\nReal,6')
    expect(samples.map((s) => s.name)).toEqual(['Real'])
    expect(skipped).toBe(1)
  })

  it('reports unrecognised headers instead of silently dropping them', () => {
    const { ignoredHeaders } = parseXraySheet('Sample Name,Mystery Column\nA,1')
    expect(ignoredHeaders).toEqual(['mystery column'])
  })

  it('returns nothing for an empty or header-only sheet', () => {
    expect(parseXraySheet('').samples).toEqual([])
    expect(parseXraySheet('Sample Name,Total KGs').samples).toEqual([])
  })
})

describe('mapSheetRows (shared by the CSV and .xlsx paths)', () => {
  it('accepts already-typed cells, as the xlsx reader returns them', () => {
    // read-excel-file hands back real numbers/nulls rather than strings.
    const { samples } = mapSheetRows([
      ['Sample Name', 'Total KGs', 'Total KG for 2gal', 'Expected Trays', 'Notes'],
      ['26-102', 506.7, 2.57, 250, null],
      ['#4 Sanfoin', null, 2.32, 71, 'ok'],
    ])
    expect(samples[0]).toMatchObject({ name: '26-102', kgPer2Gal: 2.57, totalTrays: 250 })
    expect(samples[0].totalWeightLbs).toBeCloseTo(1117.08, 1)
    expect(samples[1].totalWeightLbs).toBeNull()
    expect(samples[1].notes).toBe('ok')
  })

  it('ignores a trailing blank header column', () => {
    const { samples, ignoredHeaders } = mapSheetRows([
      ['Sample Name', ''],
      ['A', 'junk'],
    ])
    expect(ignoredHeaders).toEqual([])
    expect(samples[0].name).toBe('A')
  })
})
