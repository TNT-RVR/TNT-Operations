/**
 * Which metric pairs are related BY ARITHMETIC rather than by agronomy.
 *
 * This module exists because of what the real data does when you screen every
 * pair. Running the all-pairs correlation over the 157 exported field-seasons,
 * 47 of 473 pairs clear Holm correction — but the strongest ones are all
 * definitional:
 *
 *     r = -1.000   percent_female vs percent_male       (they sum to 100)
 *     r = +0.974   gallons_returned vs pounds           (same bees, two units)
 *     r = -0.948   live_prepupae vs pollen_balls        (closed composition)
 *     r = +0.940   male_rows vs female_rows             (set by the pattern)
 *     r = +0.825   acres vs num_structures              (shelters placed per acre)
 *
 * None of those tell anyone anything about running the operation. Left
 * unmarked they crowd out the top of a list ranked by |r|, and — worse — an
 * LLM asked to explain the leading correlations will happily narrate a causal
 * story about why returning more gallons produces more pounds.
 *
 * The 11 x-ray grading percentages are a CLOSED COMPOSITION: verified over the
 * export, they sum to 100 on 152 of 157 rows (mean 99.86). Compositional parts
 * are forced toward negative correlation with one another regardless of
 * biology — if one component rises the rest must fall. Correlations within that
 * set are reported, but flagged, and never presented as findings.
 *
 * Nothing here is hidden from the user. The relation is attached to the result
 * so the UI can say *why* a strong number is uninteresting, which is far more
 * useful than quietly dropping it.
 */

export type RelationKind =
  | 'complementary' // the two are two parts of the same whole (sum to a constant)
  | 'compositional' // both are shares of one closed total
  | 'derived' // one is computed from the other
  | 'same-quantity' // the same physical thing, differently measured
  | 'co-determined' // both fixed by a third choice (planting pattern, contract)

export interface MetricRelation {
  kind: RelationKind
  /** Shown to the user in place of "insight" — plain, specific, no hedging. */
  reason: string
}

/** The 11 x-ray grading shares. Verified to sum to ~100 across the export. */
export const COMPOSITION_MEMBERS: readonly string[] = [
  'live_prepupae',
  'immature_larvae',
  'dead_prepupae',
  'dead_larvae',
  'pollen_balls',
  'second_generation',
  'predators_and_pests',
  'parasites',
  'chalkbrood_sporulating',
  'chalkbrood_non_sporulating',
  'machine_damage',
]

const COMPOSITION = new Set(COMPOSITION_MEMBERS)

/** Order-independent key for a pair. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

function pair(a: string, b: string, kind: RelationKind, reason: string): [string, MetricRelation] {
  return [pairKey(a, b), { kind, reason }]
}

/** Explicit pairs, beyond the compositional set. */
const EXPLICIT: ReadonlyMap<string, MetricRelation> = new Map([
  pair(
    'percent_female',
    'percent_male',
    'complementary',
    'The two shares sum to 100%, so r is forced to exactly -1. This is arithmetic, not a finding.',
  ),
  pair(
    'gallons_returned',
    'pounds',
    'same-quantity',
    'Both measure the bee material that came back — one by volume, one by weight.',
  ),
  pair(
    'percent_return',
    'gallons_returned',
    'derived',
    'Return % is gallons returned divided by gallons put out, so it moves with its own numerator.',
  ),
  pair(
    'percent_return',
    'gallons_put_out',
    'derived',
    'Return % is gallons returned divided by gallons put out, so it moves with its own denominator.',
  ),
  pair(
    'percent_return',
    'pounds',
    'derived',
    'Pounds tracks gallons returned, which is the numerator of return %.',
  ),
  pair(
    'acres',
    'num_structures',
    'derived',
    'Shelter count is set by placing shelters per acre, so it scales with field size by construction.',
  ),
  pair(
    'acres',
    'gallons_put_out',
    'derived',
    'Bees are stocked per acre, so gallons out scales with field size by construction.',
  ),
  pair(
    'num_structures',
    'shelters_per_acre',
    'derived',
    'Shelter count is acres multiplied by shelters per acre.',
  ),
  pair(
    'acres',
    'shelters_per_acre',
    'derived',
    'Shelters per acre is a rate over acres; the two are linked by definition.',
  ),
  pair(
    'gals_per_acre',
    'gallons_put_out',
    'derived',
    'Gallons per acre is gallons put out divided by acres.',
  ),
  pair('gals_per_acre', 'acres', 'derived', 'Gallons per acre is gallons put out divided by acres.'),
  pair(
    'num_structures',
    'gallons_put_out',
    'co-determined',
    'Both are set from field size by the same stocking plan.',
  ),
  pair(
    'clean_weight_yield',
    'yield_per_acre',
    'derived',
    'Yield per acre is clean weight yield divided by acres.',
  ),
  pair(
    'male_rows',
    'female_rows',
    'co-determined',
    'Both are fixed by the planting pattern the seed company specifies.',
  ),
  pair(
    'male_row_spacing',
    'female_row_spacing',
    'co-determined',
    'Both are fixed by the planting pattern the seed company specifies.',
  ),
  pair(
    'male_row_spacing',
    'male_rows',
    'co-determined',
    'Row count and row spacing are two readings of the same planting pattern.',
  ),
  pair(
    'male_row_spacing',
    'female_rows',
    'co-determined',
    'Row count and row spacing are two readings of the same planting pattern.',
  ),
  pair(
    'female_row_spacing',
    'male_rows',
    'co-determined',
    'Row count and row spacing are two readings of the same planting pattern.',
  ),
  pair(
    'female_row_spacing',
    'female_rows',
    'co-determined',
    'Row count and row spacing are two readings of the same planting pattern.',
  ),
  pair(
    'live_prepupae',
    'live_count',
    'derived',
    'Live count is the graded sample scaled up by the live share, so the two move together.',
  ),
  pair(
    'pollen_balls',
    'live_count',
    'compositional',
    'Live count is driven by the live share, which every other component of the grading trades against.',
  ),
])

/**
 * How two metrics are related by construction, or null if the relationship —
 * whatever it turns out to be — is a genuine empirical question.
 */
export function metricRelation(a: string, b: string): MetricRelation | null {
  if (a === b) {
    return { kind: 'derived', reason: 'A metric against itself.' }
  }
  const explicit = EXPLICIT.get(pairKey(a, b))
  if (explicit) return explicit
  if (COMPOSITION.has(a) && COMPOSITION.has(b)) {
    return {
      kind: 'compositional',
      reason:
        'Both are shares of the same x-ray grading, which sums to 100%. Components of a closed total are pushed toward negative correlation whatever the biology does.',
    }
  }
  return null
}

/** True when a pair carries no information about how the operation is run. */
export function isDefinitional(a: string, b: string): boolean {
  return metricRelation(a, b) !== null
}
