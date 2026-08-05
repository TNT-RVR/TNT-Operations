import { describe, expect, it } from 'vitest'
import {
  cleanCell,
  isBlankCell,
  isValidLat,
  isValidLng,
  looksLikeAlberta,
  parseAnalysisCsvRow,
  parseCoordinatePair,
  parseDateCell,
  parseNumberCell,
  validateAnalysisRows,
} from './analysisImport'

describe('cleanCell / isBlankCell', () => {
  it("strips Excel's text-prefix apostrophe", () => {
    // 13 columns of the real export carry "'-" rather than "-", which the
    // Base44 importer stored verbatim into field_id and variety_code.
    expect(cleanCell("'-")).toBe('-')
    expect(cleanCell("'1158-46")).toBe('1158-46')
    expect(isBlankCell("'-")).toBe(true)
  })

  it('treats the sheet’s missing markers as blank', () => {
    expect(isBlankCell('')).toBe(true)
    expect(isBlankCell('  ')).toBe(true)
    expect(isBlankCell('-')).toBe(true)
    expect(isBlankCell('N/A')).toBe(true)
    expect(isBlankCell(null)).toBe(true)
    expect(isBlankCell('0')).toBe(false)
  })
})

describe('parseNumberCell', () => {
  it('strips percent signs and separators', () => {
    expect(parseNumberCell('69.52%')).toBe(69.52)
    expect(parseNumberCell('3,828')).toBe(3828)
    expect(parseNumberCell('35%')).toBe(35)
  })

  it('returns null for blanks rather than zero', () => {
    expect(parseNumberCell('')).toBeNull()
    expect(parseNumberCell('-')).toBeNull()
    expect(parseNumberCell("'-")).toBeNull()
    expect(parseNumberCell('0.00%')).toBe(0)
  })

  it('returns null for text', () => {
    expect(parseNumberCell('Seed Canola')).toBeNull()
  })
})

describe('parseDateCell', () => {
  it('parses the sheet’s US M/D/YYYY', () => {
    expect(parseDateCell('6/25/2025')).toBe('2025-06-25')
    expect(parseDateCell('5/8/2025')).toBe('2025-05-08')
    expect(parseDateCell('12/31/2024')).toBe('2024-12-31')
  })

  it('passes ISO through', () => {
    expect(parseDateCell('2025-06-25')).toBe('2025-06-25')
  })

  it('rejects impossible dates and junk', () => {
    expect(parseDateCell('13/1/2025')).toBeNull()
    expect(parseDateCell('6/32/2025')).toBeNull()
    expect(parseDateCell("'-")).toBeNull()
    expect(parseDateCell('sometime in June')).toBeNull()
  })
})

describe('parseAnalysisCsvRow', () => {
  it('maps the real export’s headers', () => {
    const row = parseAnalysisCsvRow({
      'Field Name': 'Stolk N half SW 34-10-15',
      Year: '2025',
      Company: 'Corteva',
      Crop: 'Seed Canola',
      'Field ID#': '1158-46',
      'Live Prepupae': '69.52%',
      'Pollen Balls': '20.92%',
      Acres: '65',
      'Gallons Put Out': '219',
      'Percent Return': '35%',
      Lat: '49.8635',
      Long: '-111.963',
      'Seeding Date': '5/8/2025',
      'Variety Code': "'-",
    })
    expect(row).not.toBeNull()
    expect(row!.field_name).toBe('Stolk N half SW 34-10-15')
    expect(row!.year).toBe('2025')
    expect(row!.live_prepupae).toBe(69.52)
    expect(row!.pollen_balls).toBe(20.92)
    expect(row!.acres).toBe(65)
    expect(row!.percent_return).toBe(35)
    expect(row!.lng).toBe(-111.963)
    expect(row!.seeding_date).toBe('2025-05-08')
    // "'-" is missing data, not a variety called "-".
    expect(row!.variety_code).toBe('')
  })

  it('accepts our own column names, so an export round-trips', () => {
    const row = parseAnalysisCsvRow({
      field_name: 'Bow Island NW 12-9-12',
      year: '2026',
      live_prepupae: '74.2',
      hail_damage: 'true',
    })
    expect(row!.field_name).toBe('Bow Island NW 12-9-12')
    expect(row!.live_prepupae).toBe(74.2)
    expect(row!.hail_damage).toBe(true)
  })

  it('is case- and whitespace-insensitive about headers', () => {
    const row = parseAnalysisCsvRow({
      '  FIELD NAME ': 'A field',
      YEAR: '2025',
      '  Live   Prepupae ': '50%',
    })
    expect(row!.field_name).toBe('A field')
    expect(row!.live_prepupae).toBe(50)
  })

  it('handles the header alias drift between seasons', () => {
    const a = parseAnalysisCsvRow({ 'Field Name': 'F', Year: '2025', 'Field ID': '9' })
    const b = parseAnalysisCsvRow({ 'Field Name': 'F', Year: '2025', 'Field ID#': '9' })
    expect(a!.field_id).toBe('9')
    expect(b!.field_id).toBe('9')
  })

  it('rejects a row with no field name or no year', () => {
    // These two identify the record; without them it cannot be upserted.
    expect(parseAnalysisCsvRow({ Year: '2025', Acres: '65' })).toBeNull()
    expect(parseAnalysisCsvRow({ 'Field Name': 'A field', Acres: '65' })).toBeNull()
    expect(parseAnalysisCsvRow({ 'Field Name': '  ', Year: '2025' })).toBeNull()
  })

  it('ignores columns it does not recognise rather than guessing', () => {
    const row = parseAnalysisCsvRow({
      'Field Name': 'F',
      Year: '2025',
      'Some New Column Darren Added': '42',
    })
    expect(row).not.toBeNull()
    expect(Object.keys(row!)).not.toContain('Some New Column Darren Added')
  })

  it('defaults an unticked exclusion flag to false, not missing', () => {
    const row = parseAnalysisCsvRow({ 'Field Name': 'F', Year: '2025', 'Hail Damage': '' })
    expect(row!.hail_damage).toBe(false)
  })
})

describe('parseCoordinatePair', () => {
  it('reads the form Google Maps puts on the clipboard', () => {
    expect(parseCoordinatePair('49.8635, -111.963')).toEqual({ lat: 49.8635, lng: -111.963 })
  })

  it('accepts space, tab and degree-sign separators', () => {
    expect(parseCoordinatePair('49.8635 -111.963')).toEqual({ lat: 49.8635, lng: -111.963 })
    expect(parseCoordinatePair('49.8635\t-111.963')).toEqual({ lat: 49.8635, lng: -111.963 })
    expect(parseCoordinatePair('49.8635° -111.963°')).toEqual({ lat: 49.8635, lng: -111.963 })
  })

  it('reads the hemisphere form the crew scan files use', () => {
    // Same spelling importPaths.ts already accepts from handhelds.
    expect(parseCoordinatePair('49.8635°N, 111.963°W')).toEqual({ lat: 49.8635, lng: -111.963 })
    expect(parseCoordinatePair('49.8635 N 111.963 W')).toEqual({ lat: 49.8635, lng: -111.963 })
  })

  it('lets the hemisphere letter override a contradictory sign', () => {
    expect(parseCoordinatePair('49.8635N, -111.963W')).toEqual({ lat: 49.8635, lng: -111.963 })
  })

  it('accepts an explicitly reversed pair', () => {
    // "111.96W, 49.86N" is unambiguous — the letters say which is which.
    expect(parseCoordinatePair('111.963°W, 49.8635°N')).toEqual({ lat: 49.8635, lng: -111.963 })
  })

  it('returns null rather than guessing at unreadable input', () => {
    // A mis-parsed coordinate puts a field in the wrong province and quietly
    // pollutes every weather correlation it touches.
    expect(parseCoordinatePair('')).toBeNull()
    expect(parseCoordinatePair('49.8635')).toBeNull()
    expect(parseCoordinatePair('somewhere near Taber')).toBeNull()
    expect(parseCoordinatePair('999, -111.963')).toBeNull()
    expect(parseCoordinatePair('49.8635, -999')).toBeNull()
  })
})

describe('isValidLat / isValidLng', () => {
  it('bounds latitude and longitude', () => {
    expect(isValidLat(49.8)).toBe(true)
    expect(isValidLat(90)).toBe(true)
    expect(isValidLat(90.1)).toBe(false)
    expect(isValidLat(NaN)).toBe(false)
    expect(isValidLng(-111.9)).toBe(true)
    expect(isValidLng(-180)).toBe(true)
    expect(isValidLng(180.1)).toBe(false)
  })
})

describe('looksLikeAlberta', () => {
  it('accepts real field coordinates from the export', () => {
    expect(looksLikeAlberta(49.86350894672768, -111.9630002975464)).toBe(true)
    expect(looksLikeAlberta(50.061, -112.113)).toBe(true)
  })

  it('rejects a swapped pair, which is the common typo', () => {
    expect(looksLikeAlberta(-111.963, 49.8635)).toBe(false)
  })

  it('rejects somewhere clearly elsewhere', () => {
    expect(looksLikeAlberta(51.5, -0.12)).toBe(false) // London
    expect(looksLikeAlberta(49.86, 111.963)).toBe(false) // sign dropped
  })
})

describe('validateAnalysisRows', () => {
  const base = { field_name: 'F', year: '2025' }

  it('passes clean rows', () => {
    expect(validateAnalysisRows([{ ...base, live_prepupae: 69.5 }])).toEqual([])
  })

  it('catches a percentage outside 0–100 before the DB CHECK does', () => {
    const problems = validateAnalysisRows([{ ...base, live_prepupae: 6952 }])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('live_prepupae')
    expect(problems[0]).toContain('F (2025)')
  })

  it('catches a duplicate natural key', () => {
    const problems = validateAnalysisRows([base, base])
    expect(problems.some((p) => p.includes('more than once'))).toBe(true)
  })

  it('allows the same field in different years', () => {
    expect(validateAnalysisRows([base, { ...base, year: '2024' }])).toEqual([])
  })
})
