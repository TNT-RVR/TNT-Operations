import { describe, it, expect } from 'vitest'
import { haversineMeters } from './geo'

describe('haversineMeters', () => {
  it('is zero for identical points', () => {
    expect(haversineMeters({ lng: -112, lat: 49.8 }, { lng: -112, lat: 49.8 })).toBe(0)
  })

  it('~1 degree of latitude ≈ 111 km', () => {
    const d = haversineMeters({ lng: 0, lat: 0 }, { lng: 0, lat: 1 })
    expect(d).toBeGreaterThan(110_000)
    expect(d).toBeLessThan(112_000)
  })
})
