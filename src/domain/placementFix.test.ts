import { describe, it, expect } from 'vitest'
import { checkPlacementFix, MAX_ACCURACY_M, MAX_DRIFT_M } from './placementFix'

const good = { lat: 49.9, lng: -111.5, acc: 6 }

describe('checkPlacementFix', () => {
  it('accepts a good fix inside the field', () => {
    expect(checkPlacementFix({ fix: good, insideField: true, driftM: 8 })).toEqual({
      ok: true,
      reason: null,
    })
  })

  it('accepts having no fix at all', () => {
    // No fix records the planned pin and says so. That is honest and roughly
    // right; refusing it would strand a crew whose phone cannot see the sky.
    expect(checkPlacementFix({ fix: null, insideField: null, driftM: null }).ok).toBe(true)
  })

  it('refuses a fix outside the field, by name', () => {
    const v = checkPlacementFix({
      fix: good,
      insideField: false,
      driftM: 12,
      fieldName: 'Bow Island Quarter',
    })
    expect(v.ok).toBe(false)
    if (v.ok) return
    expect(v.reason).toBe('outside-field')
    expect(v.message).toContain('Bow Island Quarter')
  })

  it('refuses a fix too coarse to tell one shelter from the next', () => {
    const v = checkPlacementFix({ fix: { ...good, acc: 120 }, insideField: true, driftM: 3 })
    expect(v.ok).toBe(false)
    if (v.ok) return
    expect(v.reason).toBe('inaccurate')
    expect(v.message).toContain('120 m')
  })

  it('complains about accuracy before location when both are bad', () => {
    // A 500 m fix usually reads as outside the field too, and "your GPS is
    // poor" is the more actionable of the two things to be told.
    const v = checkPlacementFix({ fix: { ...good, acc: 500 }, insideField: false, driftM: 900 })
    expect(v.ok).toBe(false)
    if (v.ok) return
    expect(v.reason).toBe('inaccurate')
  })

  it('refuses a fix implausibly far from the pin being placed', () => {
    const v = checkPlacementFix({ fix: good, insideField: true, driftM: MAX_DRIFT_M + 1 })
    expect(v.ok).toBe(false)
    if (v.ok) return
    expect(v.reason).toBe('far-from-pin')
  })

  it('allows the ordinary detour around a slough', () => {
    // Crews move shelters tens of metres routinely; this is not a rule about
    // tidiness, it is a rule about fixes that are plainly wrong.
    expect(checkPlacementFix({ fix: good, insideField: true, driftM: 60 }).ok).toBe(true)
  })

  it('is inclusive at both thresholds', () => {
    expect(checkPlacementFix({ fix: { ...good, acc: MAX_ACCURACY_M }, insideField: true, driftM: 0 }).ok).toBe(true)
    expect(checkPlacementFix({ fix: good, insideField: true, driftM: MAX_DRIFT_M }).ok).toBe(true)
  })

  it('does not refuse when containment is simply unknown', () => {
    // A field with no usable boundary cannot answer "inside?", and an
    // unanswerable question must not become a refusal.
    expect(checkPlacementFix({ fix: good, insideField: null, driftM: 10 }).ok).toBe(true)
  })

  it('ignores a nonsense accuracy rather than refusing on it', () => {
    expect(checkPlacementFix({ fix: { ...good, acc: NaN }, insideField: true, driftM: 5 }).ok).toBe(true)
  })
})
