/**
 * The decisions the block scanner makes, as pure functions.
 *
 * These used to live inside BlockScan.tsx, tangled with camera state, GPS and
 * flash messages — which meant the branchiest, highest-consequence logic in the
 * app was also the only part with no tests. What a scan is FILED UNDER and
 * whether it may proceed decide where a season of returns lands; getting either
 * wrong is invisible until the weights come in months later.
 *
 * Two rules run through all of it:
 *  - Never block the work. A crew that cannot scan stops scanning, and the day's
 *    data is lost instead of one block's.
 *  - Never decide something destructive on the operator's behalf.
 */

import type { Block, BlockPlacement } from '@/data/types'
import { findBlock } from './blocks'

// ── Which field a placement scan is filed under ─────────────────────────────

export interface FieldResolution {
  /** The field a scan will be recorded against, or '' when there is none. */
  fieldId: string
  /** Where that came from — the UI says this out loud rather than implying it. */
  source: 'gps' | 'manual' | 'last-used' | 'none'
  /** May a placement scan proceed? */
  canScan: boolean
  /** Why not, when it can't. */
  blockedReason: string | null
}

export interface FieldInputs {
  mode: 'auto' | 'manual'
  /** Field the GPS fix falls inside, if any. */
  detectedFieldId: string | null
  /** Field picked by hand. */
  pickedFieldId: string
  /** Last field a block actually went into, remembered across reloads. */
  lastFieldId: string
  /** Whether a hand-picked field that contradicts the GPS has been confirmed. */
  overrideConfirmed: boolean
}

/**
 * Where a placement scan gets filed, and whether it may happen at all.
 *
 * Detection wins whenever there is one. Falling back to the last field used
 * matters more than it looks: a fix drops out of its polygon for a few scans on
 * a poor signal, and the truthful answer is then "the field you have been
 * working all morning", not "nowhere".
 */
export function resolveScanField(input: FieldInputs): FieldResolution {
  const { mode, detectedFieldId, pickedFieldId, lastFieldId, overrideConfirmed } = input

  if (mode === 'manual') {
    if (!pickedFieldId) {
      return { fieldId: '', source: 'none', canScan: false, blockedReason: 'No field chosen yet.' }
    }
    // A hand-picked field the phone contradicts is the exact mistake this
    // screen exists to prevent, so it pauses until someone stands behind it.
    if (detectedFieldId && detectedFieldId !== pickedFieldId && !overrideConfirmed) {
      return {
        fieldId: pickedFieldId,
        source: 'manual',
        canScan: false,
        blockedReason: 'Your location disagrees with the field you picked.',
      }
    }
    return { fieldId: pickedFieldId, source: 'manual', canScan: true, blockedReason: null }
  }

  if (detectedFieldId) {
    return { fieldId: detectedFieldId, source: 'gps', canScan: true, blockedReason: null }
  }
  if (pickedFieldId) {
    return { fieldId: pickedFieldId, source: 'manual', canScan: true, blockedReason: null }
  }
  if (lastFieldId) {
    return { fieldId: lastFieldId, source: 'last-used', canScan: true, blockedReason: null }
  }
  return {
    fieldId: '',
    source: 'none',
    canScan: false,
    blockedReason: 'No fix inside a field yet, and no field chosen.',
  }
}

// ── What a weigh scan should do ─────────────────────────────────────────────

export type WeighDecision =
  /** Take the weight. `caveat` is a warning to show, not a refusal. */
  | { action: 'weigh'; label: string; caveat: string | null }
  /** Already weighed at this stage — ask before replacing. */
  | { action: 'confirm-replace'; label: string; existingLbs: number; stageLabel: string }

export interface WeighInputs {
  label: string
  mode: 'retrieve' | 'strip'
  season: number
  blocks: Block[]
  placements: BlockPlacement[]
}

/**
 * What happens when a block is scanned in a weigh mode.
 *
 * Never refuses. An unknown label, a missing placement, a weigh-out with no
 * weigh-in — each is recorded with a warning, because a block missing one
 * weigh-in simply yields no return, which is a small visible loss rather than a
 * stopped crew.
 *
 * The one thing it will NOT do on its own is overwrite a weight already on
 * file. Scanners catch labels nobody meant to scan, and replacing a good weight
 * with a stray one cannot be spotted afterwards.
 */
export function decideWeighScan(input: WeighInputs): WeighDecision {
  const { label, mode, season, blocks, placements } = input
  const block = findBlock(blocks, label)
  const placement = block
    ? placements.find((p) => p.blockId === block.id && p.season === season)
    : undefined
  const shown = block?.label ?? label.trim()
  const stageLabel = mode === 'retrieve' ? 'weigh-in' : 'weigh-out'

  const already = placement
    ? mode === 'retrieve'
      ? placement.grossWeightLbs
      : placement.strippedWeightLbs
    : null
  if (already != null) {
    return { action: 'confirm-replace', label: shown, existingLbs: already, stageLabel }
  }

  let caveat: string | null = null
  if (!block) caveat = 'New label — it will be registered.'
  else if (!placement) caveat = `No ${season} placement on record — it will be created.`
  else if (mode === 'strip' && placement.grossWeightLbs == null) {
    caveat = 'Never weighed in, so this block gives no return.'
  }

  return { action: 'weigh', label: shown, caveat }
}
