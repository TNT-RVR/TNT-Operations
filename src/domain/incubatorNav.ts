/**
 * Stepping between incubators without going back to the list.
 *
 * The dashboard shows all eight at once, which is the right home screen — but
 * comparing two of them used to be one tap out and one tap in, and as pages it
 * became a navigation each way. This is the missing sideways move.
 */

export interface Neighbours<T> {
  prev: T | null
  next: T | null
  /** 1-based position, for saying "3 of 8". */
  index: number
  total: number
}

/**
 * The incubators either side of this one, in the order the list shows them.
 *
 * WRAPS at both ends. With a fixed set of eight, cycling is what somebody
 * flicking through them wants, and a disabled arrow at the end is a dead tap
 * that has to be explained. The buttons name where they lead, so wrapping
 * round to the first is never a surprise.
 *
 * A list of one has no neighbours: stepping to yourself is a button that
 * appears to do nothing, which is worse than no button.
 */
export function neighbours<T extends { id: string }>(list: T[], id: string): Neighbours<T> {
  const at = list.findIndex((x) => x.id === id)
  if (at < 0) return { prev: null, next: null, index: 0, total: list.length }
  if (list.length < 2) return { prev: null, next: null, index: 1, total: list.length }
  return {
    prev: list[(at - 1 + list.length) % list.length],
    next: list[(at + 1) % list.length],
    index: at + 1,
    total: list.length,
  }
}
