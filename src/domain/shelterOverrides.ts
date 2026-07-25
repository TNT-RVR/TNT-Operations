import type { FieldDict } from './tentGrid'

/**
 * Manual overrides of COMPUTED shelter pins (drag / delete), scoped per
 * settings combo — faithful port of the desktop app's `_combo_key` /
 * `_sync_combo_adjustments` / override merge (docs/web-rebuild-spec.md §5.7).
 *
 * `shelter_overrides` = { "<grid idx>": [lat, lon] | null }  (null = deleted)
 * `tray_overrides`    = { "<grid idx>": count }
 * `adjust_by_combo`   = { comboKey: { shelter_overrides, tray_overrides } }
 *
 * Moves made under one settings combo only show under that combo; changing a
 * setting that changes the base grid swaps to that combo's saved set.
 */

export type ShelterOverrides = Record<string, [number, number] | null>
export type TrayOverrides = Record<string, number>

const MODE_KEY: Record<string, string> = {
  total: 'num_structures',
  per_acre: 'shelters_per_acre',
  acres_per_shelter: 'acres_per_shelter',
  spacing: 'spacing',
}

/** Identity of the current shelter-placement combo (mode + typed count + outside-pass + spray-both). */
export function comboKey(field: FieldDict): string {
  const mode = String(field['shelter_mode'] || 'total')
  const sk = MODE_KEY[mode]
  const cnt = sk ? String(field[sk] ?? '').trim() : ''
  const outside = String(field['shelters_in_outside_pass'] || 'Yes')
  const both = field['spray_both_ways'] ? '1' : '0'
  return `${mode}|${sk ?? 'undefined'}=${cnt}|out=${outside}|both=${both}`
}

/** Merge overrides into computed positions: replace moved pins, drop deleted ones.
 *  Returns the merged list plus each survivor's original grid index. */
export function applyShelterOverrides(
  positions: Array<{ lat: number; lng: number }>,
  overrides: ShelterOverrides | undefined | null,
): Array<{ lat: number; lng: number; gridIdx: number }> {
  const merged = positions.map((p, i) => ({ lat: p.lat, lng: p.lng, gridIdx: i }))
  if (!overrides) return merged
  const deleted = new Set<number>()
  for (const [k, val] of Object.entries(overrides)) {
    const idx = Number(k)
    if (!Number.isInteger(idx) || idx < 0 || idx >= merged.length) continue
    if (val === null) deleted.add(idx)
    else if (Array.isArray(val) && Number.isFinite(Number(val[0])) && Number.isFinite(Number(val[1]))) {
      merged[idx] = { lat: Number(val[0]), lng: Number(val[1]), gridIdx: idx }
    }
  }
  return merged.filter((p) => !deleted.has(p.gridIdx))
}

/**
 * Pure version of `_sync_combo_adjustments`: make the live overrides match the
 * field's CURRENT combo. `prevCombo` is the combo the live set was made under
 * (null on first sync). Returns the patch to apply to the field + the combo now
 * live. Same combo → just registers the live set; combo changed → stashes the
 * live set under the old combo and swaps in the new combo's saved set (empty if
 * none).
 */
export function syncComboAdjustments(
  field: FieldDict,
  prevCombo: string | null,
): { patch: Partial<Record<'shelter_overrides' | 'tray_overrides' | 'adjust_by_combo', unknown>>; combo: string } {
  const combo = comboKey(field)
  const store = { ...((field['adjust_by_combo'] as Record<string, unknown>) || {}) }
  const snap = {
    shelter_overrides: { ...((field['shelter_overrides'] as ShelterOverrides) || {}) },
    tray_overrides: { ...((field['tray_overrides'] as TrayOverrides) || {}) },
  }
  if (prevCombo === null || combo === prevCombo) {
    store[combo] = snap
    return { patch: { adjust_by_combo: store }, combo }
  }
  store[prevCombo] = snap
  const slot = (store[combo] as { shelter_overrides?: ShelterOverrides; tray_overrides?: TrayOverrides }) || {}
  return {
    patch: {
      adjust_by_combo: store,
      shelter_overrides: { ...(slot.shelter_overrides || {}) },
      tray_overrides: { ...(slot.tray_overrides || {}) },
    },
    combo,
  }
}

/** "Reflow to Grid": clear the current combo's overrides so pins re-snap to the
 *  recomputed grid (manually-added pins are untouched — they live elsewhere). */
export function reflowToGrid(field: FieldDict): Partial<Record<string, unknown>> {
  const combo = comboKey(field)
  const store = { ...((field['adjust_by_combo'] as Record<string, unknown>) || {}) }
  store[combo] = { shelter_overrides: {}, tray_overrides: {} }
  return { shelter_overrides: {}, tray_overrides: {}, adjust_by_combo: store }
}
