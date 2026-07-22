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
