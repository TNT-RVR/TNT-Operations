/**
 * An offline outbox for field actions.
 *
 * Checklists get used standing at a trailer in a field with no bars. Ticking a
 * step has to work there, and it has to still be ticked when the phone gets
 * signal back — so completions are queued locally and replayed on reconnect.
 *
 * ── What belongs in here, and what doesn't ───────────────────────────────────
 *
 * ONLY completion: ticking a step, finishing a task. Those are the actions a
 * crew takes in the field, and they are the ones safe to replay late.
 *
 * NOT creating, assigning, editing or deleting. Those are office actions done
 * on a connection, and queuing them invites genuine trouble: a task created
 * offline and replayed an hour later can duplicate, and an assignment replayed
 * after someone else reassigned it silently overwrites their decision. The UI
 * disables those controls when offline rather than pretending.
 *
 * ── Why last-write-wins is right here ────────────────────────────────────────
 *
 * Two people can tick the same step offline. Replayed, the second write lands
 * on an already-completed step and sets the same flag again. The stamp differs
 * by a few minutes; the fact — it's done — does not. That is a benign conflict,
 * and resolving it more cleverly would cost more than it's worth.
 *
 * UNticking is the one that could genuinely lose information, so an un-tick is
 * queued too and ordered by `queuedAt`: the last thing the human actually did
 * wins, which is what they'd expect.
 */

const KEY = 'tnt.outbox.v1'
/** Give up on an entry after this many failed replays, so one poison entry can't wedge the queue. */
const MAX_ATTEMPTS = 5

/**
 * Storage, with a fallback.
 *
 * `localStorage` is absent under Node and THROWS on access in Safari private
 * mode — not returns null, throws. Since the whole point of this module is to
 * not lose a crew's work, it degrades to an in-memory queue rather than
 * exploding: that still survives a navigation within the session, which is the
 * common case, and it keeps the module testable without a DOM.
 */
const memory = new Map<string, string>()

function store(): Pick<Storage, 'getItem' | 'setItem'> {
  try {
    if (typeof localStorage !== 'undefined') {
      // Touch it — Safari private mode throws here, not at declaration.
      localStorage.getItem(KEY)
      return localStorage
    }
  } catch {
    /* fall through to memory */
  }
  return {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
  }
}

/** True when queued work is only in memory and won't survive a page reload. */
export function isEphemeral(): boolean {
  try {
    if (typeof localStorage === 'undefined') return true
    localStorage.getItem(KEY)
    return false
  } catch {
    return true
  }
}

export type OutboxKind = 'step.setComplete' | 'task.setStatus'

export interface OutboxEntry {
  id: string
  kind: OutboxKind
  /** The row being changed. */
  targetId: string
  /** Kind-specific payload. */
  payload: Record<string, unknown>
  /** ISO UTC — when the human actually did it, NOT when it synced. */
  queuedAt: string
  attempts: number
  lastError?: string
}

function read(): OutboxEntry[] {
  try {
    const raw = store().getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as OutboxEntry[]) : []
  } catch {
    // A corrupt queue must not brick the app. Losing an unsynced tick is bad;
    // an unopenable Tasks screen is worse.
    console.warn('[outbox] unreadable queue, discarding')
    return []
  }
}

function write(entries: OutboxEntry[]): void {
  try {
    store().setItem(KEY, JSON.stringify(entries))
  } catch (e) {
    // Quota, or Safari private mode. The caller has already applied the change
    // optimistically; say so rather than failing silently.
    console.error('[outbox] could not persist queue:', e)
  }
}

let seq = 0
const newId = () => `ob_${Date.now().toString(36)}_${(seq++).toString(36)}`

/** Queue an action. Returns the entry so the UI can show it as pending. */
export function enqueue(kind: OutboxKind, targetId: string, payload: Record<string, unknown>): OutboxEntry {
  const entry: OutboxEntry = {
    id: newId(),
    kind,
    targetId,
    payload,
    queuedAt: new Date().toISOString(),
    attempts: 0,
  }
  // Supersede any earlier queued action on the same row: only the latest state
  // of a checkbox matters, and replaying tick→untick→tick wastes round trips.
  const rest = read().filter((e) => !(e.kind === kind && e.targetId === targetId))
  write([...rest, entry])
  return entry
}

export function pending(): OutboxEntry[] {
  return read().sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))
}

export function pendingCount(): number {
  return read().length
}

/** Row ids with something queued, so the UI can mark them "not synced yet". */
export function pendingTargets(): Set<string> {
  return new Set(read().map((e) => e.targetId))
}

export function clear(): void {
  write([])
}

export interface FlushResult {
  sent: number
  failed: number
  dropped: number
}

/**
 * Replay the queue, oldest first.
 *
 * `send` returns ok/error per entry. An entry that fails is kept and retried
 * next time, until MAX_ATTEMPTS — after which it is dropped with a loud log,
 * because a permanently-failing entry (a step someone deleted, say) would
 * otherwise block everything queued behind it forever.
 */
export async function flush(
  send: (entry: OutboxEntry) => Promise<{ ok: boolean; error?: string }>,
): Promise<FlushResult> {
  const queue = pending()
  if (queue.length === 0) return { sent: 0, failed: 0, dropped: 0 }

  const keep: OutboxEntry[] = []
  let sent = 0
  let dropped = 0

  for (const entry of queue) {
    let result: { ok: boolean; error?: string }
    try {
      result = await send(entry)
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : String(e) }
    }

    if (result.ok) {
      sent++
      continue
    }

    const attempts = entry.attempts + 1
    if (attempts >= MAX_ATTEMPTS) {
      dropped++
      console.error(
        `[outbox] dropping ${entry.kind} on ${entry.targetId} after ${attempts} attempts:`,
        result.error,
      )
      continue
    }
    keep.push({ ...entry, attempts, lastError: result.error })
  }

  // Merge with anything queued WHILE we were flushing, so a tick made mid-sync
  // isn't thrown away by this write.
  const queuedIds = new Set(queue.map((e) => e.id))
  const arrivedDuringFlush = read().filter((e) => !queuedIds.has(e.id))
  write([...keep, ...arrivedDuringFlush])

  return { sent, failed: keep.length, dropped }
}

/** Whether the browser currently thinks it can reach the network. */
export const isOnline = (): boolean => (typeof navigator === 'undefined' ? true : navigator.onLine !== false)

/**
 * Run `onOnline` whenever connectivity returns. Returns an unsubscribe.
 *
 * `navigator.onLine` only proves a link exists, not that Supabase is reachable
 * — so the flush is written to tolerate failure and simply retry, rather than
 * trusting this event.
 */
export function onReconnect(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener('online', handler)
  return () => window.removeEventListener('online', handler)
}
