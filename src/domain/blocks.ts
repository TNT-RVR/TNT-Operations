/**
 * Nesting-block domain logic: the place → retrieve → strip cycle and the bee
 * returns that come out of it. Pure functions only — no React, no backend.
 *
 * The unit of record is one BlockPlacement: one physical block, one season.
 */
import type { Block, BlockPlacement, BlockStage } from '@/data/types'
import { LBS_PER_KG } from './incubation'

/** Weights are entered and stored in lbs; kg is always derived from them. */
export function lbsToKgWeight(lbs: number | null | undefined): number | null {
  return lbs == null || !Number.isFinite(lbs) ? null : lbs * LBS_PER_KG
}

export function kgToLbsWeight(kg: number | null | undefined): number | null {
  return kg == null || !Number.isFinite(kg) ? null : kg / LBS_PER_KG
}

/**
 * The bee material recovered from a block: what it weighed full, minus what
 * the bare block weighs. Null until BOTH weigh-ins have happened — a partial
 * answer here would read as "no return" rather than "not weighed yet".
 */
export function beeReturnLbs(p: Pick<BlockPlacement, 'grossWeightLbs' | 'strippedWeightLbs'>): number | null {
  const { grossWeightLbs: gross, strippedWeightLbs: stripped } = p
  if (gross == null || stripped == null) return null
  return gross - stripped
}

/**
 * True when the stripped weight came out HEAVIER than the gross — physically
 * impossible, so it's a swapped entry or a mis-scan. Surfaced rather than
 * silently clamped, because the fix is to re-weigh, not to hide it.
 */
export function hasImpossibleWeights(
  p: Pick<BlockPlacement, 'grossWeightLbs' | 'strippedWeightLbs'>,
): boolean {
  const r = beeReturnLbs(p)
  return r != null && r < 0
}

/**
 * How far a placement has got. Derived from the timestamps rather than stored,
 * so it can never disagree with the data it describes.
 */
export function blockStage(p: BlockPlacement): BlockStage {
  if (p.strippedAt) return 'stripped'
  if (p.retrievedAt) return 'retrieved'
  return 'placed'
}

export const STAGE_LABEL: Record<BlockStage, string> = {
  placed: 'In field',
  retrieved: 'Retrieved',
  stripped: 'Stripped',
}

/** What scan a block is waiting for next; null once the cycle is complete. */
export function nextAction(p: BlockPlacement): 'retrieve' | 'strip' | null {
  const stage = blockStage(p)
  if (stage === 'placed') return 'retrieve'
  if (stage === 'retrieved') return 'strip'
  return null
}

/** Days a block sat in the field. Null until it's been retrieved. */
export function daysInField(p: BlockPlacement, now: Date = new Date()): number | null {
  if (!p.placedAt) return null
  const end = p.retrievedAt ? new Date(p.retrievedAt) : now
  const ms = end.getTime() - new Date(p.placedAt).getTime()
  return ms < 0 ? null : Math.floor(ms / 86_400_000)
}

export interface FieldReturns {
  fieldId: string | null
  /** Placements for this field in the season. */
  blocks: number
  /** How many have both weigh-ins done and so contribute a return. */
  weighed: number
  totalReturnLbs: number
  /** Mean over the WEIGHED blocks only — averaging in un-weighed ones as zero
   *  would understate the field while collection is still in progress. */
  avgReturnLbs: number | null
}

/**
 * Roll returns up per field, which is the number that actually gets acted on:
 * which fields produced bees and which didn't.
 */
export function returnsByField(placements: BlockPlacement[]): FieldReturns[] {
  const acc = new Map<string, FieldReturns>()
  for (const p of placements) {
    const key = p.fieldId ?? ''
    let row = acc.get(key)
    if (!row) {
      row = { fieldId: p.fieldId, blocks: 0, weighed: 0, totalReturnLbs: 0, avgReturnLbs: null }
      acc.set(key, row)
    }
    row.blocks += 1
    const ret = beeReturnLbs(p)
    if (ret != null) {
      row.weighed += 1
      row.totalReturnLbs += ret
    }
  }
  for (const row of acc.values()) {
    row.avgReturnLbs = row.weighed > 0 ? row.totalReturnLbs / row.weighed : null
  }
  return [...acc.values()].sort((a, b) => b.totalReturnLbs - a.totalReturnLbs)
}

export interface SeasonSummary {
  blocks: number
  placed: number
  retrieved: number
  stripped: number
  totalReturnLbs: number
  avgReturnLbs: number | null
}

/** Headline counts for a season: where every block currently sits. */
export function seasonSummary(placements: BlockPlacement[]): SeasonSummary {
  const s: SeasonSummary = {
    blocks: placements.length,
    placed: 0,
    retrieved: 0,
    stripped: 0,
    totalReturnLbs: 0,
    avgReturnLbs: null,
  }
  let weighed = 0
  for (const p of placements) {
    s[blockStage(p)] += 1
    const ret = beeReturnLbs(p)
    if (ret != null) {
      weighed += 1
      s.totalReturnLbs += ret
    }
  }
  s.avgReturnLbs = weighed > 0 ? s.totalReturnLbs / weighed : null
  return s
}

/**
 * A weight that shouldn't be accepted without a second look.
 *
 * `error` is physically impossible and refused. `warn` is merely suspicious —
 * allowed through on confirmation, because a genuinely odd block is a real
 * thing and the person holding it knows better than the software.
 */
export interface WeightCheck {
  level: 'error' | 'warn'
  message: string
}

/** Below this, someone has typed a fraction of what they meant. */
const MIN_PLAUSIBLE_LBS = 0.5
/** Above this, someone has typed a scale reading in the wrong unit, or slipped. */
const MAX_PLAUSIBLE_LBS = 300

/**
 * Check a weight before it's recorded.
 *
 * The mistake this exists for is a decimal point: 125 where 12.5 was meant, or
 * 1.25. Nothing about that is malformed, so nothing else catches it, and it
 * lands straight in the bee return — where it drags the whole field's map with
 * it. Compared against the OTHER blocks weighed this season, since what counts
 * as normal is a property of the season, not a constant.
 */
export function checkWeight(
  lbs: number,
  stage: 'retrieve' | 'strip',
  placement: Pick<BlockPlacement, 'grossWeightLbs'> | null,
  peerWeightsLbs: number[],
): WeightCheck | null {
  if (!Number.isFinite(lbs) || lbs <= 0) {
    return { level: 'error', message: 'Enter a weight greater than zero.' }
  }

  // Empty can't outweigh full. Physically impossible, so refuse it outright
  // rather than storing a negative return for someone to find later.
  if (stage === 'strip' && placement?.grossWeightLbs != null && lbs >= placement.grossWeightLbs) {
    return {
      level: 'error',
      message: `The empty weight (${lbs.toFixed(1)}) can't be as much as the full weight (${placement.grossWeightLbs.toFixed(1)}). Check the scale, or re-weigh it full.`,
    }
  }

  if (lbs < MIN_PLAUSIBLE_LBS) {
    return { level: 'warn', message: `${lbs} lbs is very light for a block. Is that right?` }
  }
  if (lbs > MAX_PLAUSIBLE_LBS) {
    return { level: 'warn', message: `${lbs} lbs is very heavy for a block. Is that right?` }
  }

  // Against the season's own blocks. Needs enough of them to have a normal.
  const peers = peerWeightsLbs.filter((w) => Number.isFinite(w) && w > 0)
  if (peers.length >= 5) {
    const sorted = [...peers].sort((a, b) => a - b)
    const mid = sorted.length >> 1
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
    if (median > 0) {
      // A factor of three either way. Wide enough that ordinary variation
      // passes silently, narrow enough to catch a slipped decimal point.
      if (lbs > median * 3) {
        return {
          level: 'warn',
          message: `${lbs} lbs is more than three times the usual ${median.toFixed(1)} for this season. Check the decimal point.`,
        }
      }
      if (lbs < median / 3) {
        return {
          level: 'warn',
          message: `${lbs} lbs is less than a third of the usual ${median.toFixed(1)} for this season. Check the decimal point.`,
        }
      }
    }
  }
  return null
}

/** Every season a block has been used, newest first — its history. */
export function blockHistory(placements: BlockPlacement[], blockId: string): BlockPlacement[] {
  return placements.filter((p) => p.blockId === blockId).sort((a, b) => b.season - a.season)
}

/** Seasons present in the data, newest first — drives the year filter. */
export function seasonsOf(placements: BlockPlacement[]): number[] {
  return [...new Set(placements.map((p) => p.season))].sort((a, b) => b - a)
}

/**
 * Resolve a scanned code to a block. Labels are matched case-insensitively and
 * whitespace-trimmed: the same physical label read by different scanners (or
 * typed by hand) must land on one record.
 */
export function findBlock(blocks: Block[], label: string): Block | undefined {
  const want = label.trim().toLowerCase()
  if (!want) return undefined
  return blocks.find((b) => b.label.trim().toLowerCase() === want)
}
