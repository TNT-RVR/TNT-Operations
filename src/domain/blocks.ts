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
  // A stage is reached by having the WEIGHT, not by carrying a timestamp.
  // Correcting a mis-scan clears the weight; keying off the timestamp then
  // left the block claiming "weighed out" with nothing weighed — a stage that
  // contradicts the row it sits in. The timestamp still stands as when it
  // happened, for anything that has one without a number.
  if (p.strippedWeightLbs != null || p.strippedAt) return 'stripped'
  if (p.grossWeightLbs != null || p.retrievedAt) return 'retrieved'
  return 'placed'
}

export const STAGE_LABEL: Record<BlockStage, string> = {
  placed: 'In field',
  retrieved: 'Weighed in',
  stripped: 'Weighed out',
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
  /** Blocks at each CURRENT stage — mutually exclusive, so they sum to `blocks`. */
  placed: number
  retrieved: number
  stripped: number
  /**
   * How many weigh-ins have actually HAPPENED. Cumulative, not exclusive: a
   * block weighed in and out counts in both.
   *
   * The stage counts above cannot answer "how many have we weighed in?" — a
   * finished block leaves `retrieved` and lands in `stripped`, so a fully
   * processed season reports zero weigh-ins, which is plainly false to anyone
   * reading it.
   */
  weighedIn: number
  weighedOut: number
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
    weighedIn: 0,
    weighedOut: 0,
    totalReturnLbs: 0,
    avgReturnLbs: null,
  }
  let weighed = 0
  for (const p of placements) {
    s[blockStage(p)] += 1
    if (p.grossWeightLbs != null) s.weighedIn += 1
    if (p.strippedWeightLbs != null) s.weighedOut += 1
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

/**
 * Hard limits on a recorded weight, in kg — the unit these are actually
 * thought about in.
 *
 * Set from real seasons rather than guessed: 2025 ran from 0.95 kg to 3.8 kg.
 * The bounds sit well outside that on both sides, so an exceptional block
 * passes and a slipped decimal (0.38, 38) does not. Refused rather than
 * queried: nothing in this range of work produces 40 kg, so accepting it can
 * only mean recording something false.
 */
const MIN_WEIGHT_KG = 0.1
const MAX_WEIGHT_KG = 15

const MIN_PLAUSIBLE_LBS = MIN_WEIGHT_KG / LBS_PER_KG
const MAX_PLAUSIBLE_LBS = MAX_WEIGHT_KG / LBS_PER_KG

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

  // Outside the possible range: refused, not queried. A block does not weigh
  // 40 kg, so there is nothing to confirm — only a wrong number to correct.
  if (lbs < MIN_PLAUSIBLE_LBS || lbs > MAX_PLAUSIBLE_LBS) {
    const kg = lbs * LBS_PER_KG
    return {
      level: 'error',
      message: `${kg.toFixed(2)} kg (${lbs.toFixed(1)} lbs) is outside the possible range of ${MIN_WEIGHT_KG}–${MAX_WEIGHT_KG} kg. Check the decimal point and the units.`,
    }
  }

  // Against the season's own blocks. Needs enough of them to have a normal.
  const peers = peerWeightsLbs.filter((w) => Number.isFinite(w) && w > 0)
  if (peers.length >= 5) {
    const sorted = [...peers].sort((a, b) => a - b)
    const mid = sorted.length >> 1
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
    if (median > 0) {
      // A factor of FOUR either way. 2025 spanned 0.95-3.8 kg, a genuine 4x
      // between the extremes, so a tighter ratio would query real blocks all
      // season — and a warning people learn to dismiss protects nothing. The
      // absolute bounds above do the heavy lifting; this catches a slip that
      // stays inside them.
      if (lbs > median * 4) {
        return {
          level: 'warn',
          message: `${(lbs * LBS_PER_KG).toFixed(2)} kg is more than four times this season's usual ${(median * LBS_PER_KG).toFixed(2)} kg. Check the decimal point.`,
        }
      }
      if (lbs < median / 4) {
        return {
          level: 'warn',
          message: `${(lbs * LBS_PER_KG).toFixed(2)} kg is less than a quarter of this season's usual ${(median * LBS_PER_KG).toFixed(2)} kg. Check the decimal point.`,
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

// ═══════════════════════════════════════════════════════════════════════════
// Closing the cycle: a field's returns become next season's lot
// ═══════════════════════════════════════════════════════════════════════════

/** What a field's returns look like once they become a sample lot. */
export interface LotFromReturns {
  name: string
  fieldId: string
  harvestSeason: number
  totalWeightLbs: number
  notes: string
}

export interface LotProposal {
  lot: LotFromReturns | null
  /** Why a lot can't be made yet, or a caveat worth reading before it is. */
  problem: string | null
  warning: string | null
}

/**
 * Turn one field's season of block returns into the lot those bees become.
 *
 * The bee cycle closes here: blocks go out, come back, are weighed in full and
 * out empty, and the difference is the bees that go into next season's
 * incubators. Until this existed the link was a person typing a field name
 * into a sample, which is why no lot could be traced back to the ground it
 * came from.
 *
 * Refuses rather than guesses. A field with nothing weighed has no lot; a
 * field still part-way through collection gets a warning with the number,
 * because "make the lot now and add to it later" quietly loses the rest.
 */
export function proposeLotFromReturns(
  returns: FieldReturns,
  fieldName: string,
  season: number,
): LotProposal {
  if (!returns.fieldId) {
    return { lot: null, problem: 'These blocks are not attributed to a field.', warning: null }
  }
  if (returns.weighed === 0) {
    return {
      lot: null,
      problem: `No blocks from ${fieldName} have been weighed both in and out yet, so there is no return to record.`,
      warning: null,
    }
  }
  if (returns.totalReturnLbs <= 0) {
    return {
      lot: null,
      problem: `${fieldName}'s returns add up to ${returns.totalReturnLbs.toFixed(1)} lbs, which cannot be a lot.`,
      warning: null,
    }
  }

  const outstanding = returns.blocks - returns.weighed
  return {
    lot: {
      // Field and harvest year, because a lot is read a year later by someone
      // who wasn't there — and it goes out the season AFTER it is harvested.
      name: `${fieldName} ${season}`,
      fieldId: returns.fieldId,
      harvestSeason: season,
      totalWeightLbs: Math.round(returns.totalReturnLbs * 100) / 100,
      notes: `Bee returns from ${fieldName}, ${season} — ${returns.weighed} block${
        returns.weighed === 1 ? '' : 's'
      } weighed.`,
    },
    problem: null,
    warning:
      outstanding > 0
        ? `${outstanding} of ${returns.blocks} blocks from ${fieldName} are not weighed yet. The lot will hold only the ${returns.weighed} that are.`
        : null,
  }
}
