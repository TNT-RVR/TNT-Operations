/**
 * Experiment notes — an observation, and the things it is about.
 *
 * The rules here exist to keep a note-taking box from becoming a form. Every
 * field except the note text is optional, and nothing is refused that a person
 * standing in a field might reasonably have written: an unresolved label is
 * kept, a note with no experiment name is kept, a note with no GPS is kept.
 * The one thing that must never happen is an observation going unrecorded
 * because the app wanted something the observer did not have.
 */

export type ItemKind = 'block' | 'tray'

export interface NoteItem {
  kind: ItemKind
  /** What was scanned or typed, verbatim. */
  label: string
  /** The record it matched, when it matched one. */
  blockId?: string | null
  trayId?: string | null
  lat?: number | null
  lng?: number | null
}

export interface NoteDraft {
  experiment: string
  notes: string
  fieldId: string | null
  items: NoteItem[]
  lat?: number | null
  lng?: number | null
  accuracyM?: number | null
}

export type SaveCheck = { ok: true } | { ok: false; reason: string }

/**
 * Is there anything here worth saving?
 *
 * The bar is deliberately at the floor: some text, or something scanned. A
 * note that is only a scanned tray is a valid record ("this tray was in the
 * trial"), and a note that is only text is the normal case. Empty is the only
 * refusal, and that is to stop a stray tap creating a row nobody can interpret.
 */
export function canSaveNote(draft: Pick<NoteDraft, 'notes' | 'items'>): SaveCheck {
  if (draft.notes.trim() !== '') return { ok: true }
  if (draft.items.length > 0) return { ok: true }
  return { ok: false, reason: 'Write something, or scan a block or tray.' }
}

/**
 * Add a scanned item, unless it is already there.
 *
 * Scanning the same tag twice is a slip, not an intention — a camera fires
 * repeatedly and a tag stays in frame. Matching is by kind and label, case and
 * whitespace insensitive, because that is the same physical tag.
 *
 * Returns the list unchanged when it is a duplicate, so the caller can tell
 * the difference and say "already added" rather than silently doing nothing.
 */
export function addItem(items: NoteItem[], item: NoteItem): { items: NoteItem[]; added: boolean } {
  const key = (i: NoteItem) => `${i.kind}:${i.label.trim().toLowerCase()}`
  if (items.some((i) => key(i) === key(item))) return { items, added: false }
  return { items: [...items, item], added: true }
}

export function removeItem(items: NoteItem[], index: number): NoteItem[] {
  return items.filter((_, i) => i !== index)
}

/** How many of each kind, for a one-line summary of a saved note. */
export function countItems(items: NoteItem[]): { blocks: number; trays: number } {
  return {
    blocks: items.filter((i) => i.kind === 'block').length,
    trays: items.filter((i) => i.kind === 'tray').length,
  }
}

/**
 * Experiment names already in use, most recent first.
 *
 * Offered as suggestions rather than a fixed list: the names are typed, and
 * seeing "Tray density 2026" already there is what stops the fourth note
 * being filed under "tray density 26".
 */
export function experimentNames(
  notes: Array<{ experiment: string; observedAt: string }>,
): string[] {
  // Keyed case-insensitively, keeping the most recent SPELLING: a name that
  // drifted from "Tray density" to "tray density" should show once, as whoever
  // typed it last wrote it.
  const latest = new Map<string, { name: string; at: string }>()
  for (const n of notes) {
    const name = n.experiment.trim()
    if (!name) continue
    const key = name.toLowerCase()
    const cur = latest.get(key)
    if (!cur || n.observedAt > cur.at) latest.set(key, { name, at: n.observedAt })
  }
  return [...latest.values()].sort((a, b) => b.at.localeCompare(a.at)).map((v) => v.name)
}

/** Notes for one experiment, newest first. Blank name matches the unfiled. */
export function notesForExperiment<T extends { experiment: string; observedAt: string }>(
  notes: T[],
  experiment: string,
): T[] {
  const want = experiment.trim().toLowerCase()
  return notes
    .filter((n) => n.experiment.trim().toLowerCase() === want)
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt))
}
