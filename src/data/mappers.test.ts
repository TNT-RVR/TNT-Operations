import { describe, it, expect } from 'vitest'
import {
  toField,
  toIncubator,
  toInspection,
  toSensorReading,
  inspectionInsert,
} from './mappers'

describe('supabase row mappers', () => {
  it('maps a field row → Field', () => {
    expect(
      toField({
        id: 'f1',
        name: 'NW Pivot',
        client: 'Corteva',
        region: 'Taber, AB',
        shape_type: 'pivot',
        shelter_count: 24,
        updated_at: '2026-07-18T15:00:00Z',
      }),
    ).toEqual({
      id: 'f1',
      name: 'NW Pivot',
      client: 'Corteva',
      region: 'Taber, AB',
      shapeType: 'pivot',
      shelterCount: 24,
      updatedAt: '2026-07-18T15:00:00Z',
    })
  })

  it('exposes non-empty data jsonb as geometry, empty/absent as undefined', () => {
    const withGeom = toField({
      id: 'f1',
      name: 'NW Pivot',
      client: 'c',
      region: 'r',
      shape_type: 'pivot',
      shelter_count: 24,
      data: { PP_Latitude: '49.83', Radius: '400' },
      updated_at: '2026-07-18T15:00:00Z',
    })
    expect(withGeom.geometry).toEqual({ PP_Latitude: '49.83', Radius: '400' })

    const emptyData = toField({
      id: 'f2',
      name: 'x',
      client: 'c',
      region: 'r',
      shape_type: 'polygon',
      shelter_count: 0,
      data: {},
      updated_at: '2026-07-18T15:00:00Z',
    })
    expect(emptyData.geometry).toBeUndefined()
  })

  it('coerces numeric-as-string (PostgREST) and null started_at', () => {
    const inc = toIncubator({
      id: 'i3',
      name: 'Incubator C',
      location: 'Trailer',
      status: 'idle',
      started_at: null,
      temp_target_c: '30',
      humidity_target_pct: '55',
    })
    expect(inc.startedAt).toBeNull()
    expect(inc.tempTargetC).toBe(30)
    expect(inc.humidityTargetPct).toBe(55)
    expect(typeof inc.tempTargetC).toBe('number')
  })

  it('maps the live incubator fields (temp mode, humidity band, blanks → null)', () => {
    const inc = toIncubator({
      id: 'i1',
      name: 'Incubator 2',
      location: '',
      status: 'idle',
      started_at: null,
      temp_target_c: 30,
      humidity_target_pct: 55,
      temp_mode: 'incubation',
      humidity_min: '55',
      humidity_max: null,
      incubation_start: '2026-07-10',
      capacity: '665',
    })
    expect(inc.tempMode).toBe('incubation')
    expect(inc.humidityMin).toBe(55)
    expect(inc.humidityMax).toBeNull()
    expect(inc.incubationStart).toBe('2026-07-10')
    expect(inc.capacity).toBe(665)
  })

  it('maps inspection + sensor reading rows', () => {
    expect(
      toInspection({
        id: 'in1',
        incubator_id: 'i1',
        at: '2026-07-20T16:00:00Z',
        inspector: 'Tyler',
        health_score: '92',
        notes: 'strong',
      }),
    ).toEqual({
      id: 'in1',
      incubatorId: 'i1',
      at: '2026-07-20T16:00:00Z',
      inspector: 'Tyler',
      healthScore: 92,
      notes: 'strong',
      // rich fields absent on the row → null/undefined
      thermometerTempC: null,
      goveeTempC: null,
      tempDiffC: null,
      batchId: null,
    })

    expect(
      toSensorReading({
        id: 'r1',
        incubator_id: 'i1',
        at: '2026-07-22T12:00:00Z',
        temp_c: '30.1',
        humidity_pct: '54',
        source: 'govee',
      }),
    ).toEqual({
      id: 'r1',
      incubatorId: 'i1',
      at: '2026-07-22T12:00:00Z',
      tempC: 30.1,
      humidityPct: 54,
      source: 'govee',
    })
  })

  it('maps the rich inspection checklist (period, thermometer vs govee, checks)', () => {
    const insp = toInspection({
      id: 'in9',
      incubator_id: 'i3',
      at: '2026-06-25T09:27:00Z',
      inspector: '',
      health_score: 0,
      notes: 'looks good',
      period: 'morning',
      thermometer_temp_c: '15.0',
      govee_temp_c: '15.6',
      temp_diff_c: '0.6',
      temp_alert: false,
      heat_pumps_ok: true,
      parasites_emerging: false,
      bees_emerging: true,
      fans_ok: true,
      black_lights_ok: true,
      batch_id: null,
    })
    expect(insp.period).toBe('morning')
    expect(insp.thermometerTempC).toBe(15)
    expect(insp.goveeTempC).toBe(15.6)
    expect(insp.tempDiffC).toBe(0.6)
    expect(insp.tempAlert).toBe(false)
    expect(insp.beesEmerging).toBe(true)
    expect(insp.blackLightsOk).toBe(true)
    expect(insp.batchId).toBeNull()
  })

  it('includes rich checklist fields in the insert payload when provided', () => {
    const payload = inspectionInsert({
      incubatorId: 'i3',
      at: '2026-06-25T09:27:00Z',
      inspector: 'Darren',
      healthScore: 0,
      notes: '',
      period: 'evening',
      thermometerTempC: 15,
      goveeTempC: 15.6,
      tempDiffC: 0.6,
      tempAlert: false,
      heatPumpsOk: true,
      fansOk: true,
      blackLightsOk: true,
      beesEmerging: true,
      parasitesEmerging: false,
    })
    expect(payload).toMatchObject({
      incubator_id: 'i3',
      period: 'evening',
      thermometer_temp_c: 15,
      govee_temp_c: 15.6,
      temp_diff_c: 0.6,
      temp_alert: false,
      heat_pumps_ok: true,
      fans_ok: true,
      black_lights_ok: true,
      bees_emerging: true,
      parasites_emerging: false,
    })
    expect('batch_id' in payload).toBe(false)
  })

  it('builds an insert payload from an app inspection (no id, snake_case)', () => {
    const payload = inspectionInsert({
      incubatorId: 'i2',
      at: '2026-07-22T00:00:00Z',
      inspector: 'Darren',
      healthScore: 80,
      notes: 'ok',
    })
    expect(payload).toEqual({
      incubator_id: 'i2',
      at: '2026-07-22T00:00:00Z',
      inspector: 'Darren',
      health_score: 80,
      notes: 'ok',
    })
    expect('id' in payload).toBe(false)
  })
})
