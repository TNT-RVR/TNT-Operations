import type { Tray, ShelterTrayLink } from '@/data/types'

/**
 * Putting a tray out: what the scan means, decided before anything is written.
 *
 * A tray scanned into a shelter in the field has left the incubator — that is
 * the same event seen from two sides, and recording one without the other is
 * how an incubator ends up showing trays that are sitting in a field.
 *
 * Pure, so the awkward cases are settled here rather than in a component
 * someone is using in a truck.
 */

export type TrayReleaseDecision =
  /** Link it to the shelter and mark it out of the incubator. */
  | { action: 'release'; tray: Tray; caveat: string | null }
  /** Already in this shelter — a re-scan of the same tray. */
  | { action: 'already-here'; tray: Tray }
  /** Scanned into a DIFFERENT shelter earlier; moving it needs a decision. */
  | { action: 'confirm-move'; tray: Tray; fromShelterId: string }
  /** Nothing matched the label. */
  | { action: 'unknown'; label: string }

export function decideTrayRelease(input: {
  label: string
  shelterId: string
  trays: Tray[]
  links: ShelterTrayLink[]
}): TrayReleaseDecision {
  const want = input.label.trim().toLowerCase()
  if (!want) return { action: 'unknown', label: input.label }

  const tray = input.trays.find((t) => t.trayNumber.trim().toLowerCase() === want)
  // Unlike a block, a tray is NOT registered on the fly: it carries a sample,
  // a weight and an incubator, none of which a field scan can invent. An
  // unknown label is a wrong label.
  if (!tray) return { action: 'unknown', label: input.label }

  const existing = input.links.find((l) => l.trayId === tray.id)
  if (existing) {
    return existing.shelterId === input.shelterId
      ? { action: 'already-here', tray }
      : { action: 'confirm-move', tray, fromShelterId: existing.shelterId }
  }

  // Worth saying, not worth blocking: a tray with no incubator was either
  // already released or never properly assigned, and the crew is holding it.
  const caveat = tray.incubatorId
    ? null
    : 'This tray was not in an incubator — recording it anyway.'
  return { action: 'release', tray, caveat }
}
