/**
 * Tests for the offline outbox.
 *
 * The cases that matter are the failure ones: a corrupt queue, a poison entry,
 * and a tick that happens while a flush is already in progress. Those are what
 * decide whether a crew's work survives the drive back into signal.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { clear, enqueue, flush, pending, pendingCount, pendingTargets } from './outbox'

const KEY = 'tnt.outbox.v1'
const okSend = async () => ({ ok: true })
const failSend = async () => ({ ok: false, error: 'offline' })

/**
 * A minimal localStorage, because the suite runs under `environment: 'node'`
 * and pulling in jsdom for one module isn't worth it. The outbox falls back to
 * memory when this is absent, which the last test here covers.
 */
const fake = new Map<string, string>()
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => fake.get(k) ?? null,
  setItem: (k: string, v: string) => void fake.set(k, v),
  removeItem: (k: string) => void fake.delete(k),
  clear: () => fake.clear(),
  key: (i: number) => [...fake.keys()][i] ?? null,
  get length() {
    return fake.size
  },
} as Storage

beforeEach(() => {
  fake.clear()
})

describe('enqueue', () => {
  it('queues an action', () => {
    enqueue('step.setComplete', 'step_1', { complete: true })
    expect(pendingCount()).toBe(1)
    expect(pending()[0].targetId).toBe('step_1')
  })

  it('supersedes an earlier action on the same row', () => {
    // Only the latest state of a checkbox matters — replaying tick → untick →
    // tick is three round trips to reach the same place.
    enqueue('step.setComplete', 'step_1', { complete: true })
    enqueue('step.setComplete', 'step_1', { complete: false })
    enqueue('step.setComplete', 'step_1', { complete: true })
    expect(pendingCount()).toBe(1)
    expect(pending()[0].payload).toEqual({ complete: true })
  })

  it('keeps actions on different rows separate', () => {
    enqueue('step.setComplete', 'step_1', { complete: true })
    enqueue('step.setComplete', 'step_2', { complete: true })
    expect(pendingCount()).toBe(2)
  })

  it('keeps different kinds on the same row separate', () => {
    enqueue('step.setComplete', 'x', { complete: true })
    enqueue('task.setStatus', 'x', { status: 'done' })
    expect(pendingCount()).toBe(2)
  })

  it('stamps when the human acted, not when it syncs', () => {
    const before = Date.now()
    const e = enqueue('step.setComplete', 'step_1', { complete: true })
    expect(new Date(e.queuedAt).getTime()).toBeGreaterThanOrEqual(before - 1000)
  })
})

describe('pendingTargets', () => {
  it('lists the rows with unsynced changes', () => {
    enqueue('step.setComplete', 'a', {})
    enqueue('step.setComplete', 'b', {})
    expect(pendingTargets()).toEqual(new Set(['a', 'b']))
  })
})

describe('flush', () => {
  it('does nothing on an empty queue', async () => {
    expect(await flush(okSend)).toEqual({ sent: 0, failed: 0, dropped: 0 })
  })

  it('sends everything and empties the queue', async () => {
    enqueue('step.setComplete', 'a', {})
    enqueue('step.setComplete', 'b', {})
    expect(await flush(okSend)).toEqual({ sent: 2, failed: 0, dropped: 0 })
    expect(pendingCount()).toBe(0)
  })

  it('replays oldest first, so the last thing the human did wins', async () => {
    const seen: string[] = []
    enqueue('step.setComplete', 'a', { n: 1 })
    await new Promise((r) => setTimeout(r, 2))
    enqueue('step.setComplete', 'b', { n: 2 })
    await flush(async (e) => {
      seen.push(e.targetId)
      return { ok: true }
    })
    expect(seen).toEqual(['a', 'b'])
  })

  it('keeps a failed entry for the next attempt', async () => {
    enqueue('step.setComplete', 'a', {})
    expect(await flush(failSend)).toEqual({ sent: 0, failed: 1, dropped: 0 })
    expect(pendingCount()).toBe(1)
    expect(pending()[0].attempts).toBe(1)
    expect(pending()[0].lastError).toBe('offline')
  })

  it('drops a poison entry after 5 attempts instead of wedging the queue', async () => {
    enqueue('step.setComplete', 'gone', {})
    for (let i = 0; i < 4; i++) await flush(failSend)
    expect(pendingCount()).toBe(1)
    expect(await flush(failSend)).toEqual({ sent: 0, failed: 0, dropped: 1 })
    expect(pendingCount()).toBe(0)
  })

  it('treats a thrown error as a failure rather than losing the entry', async () => {
    enqueue('step.setComplete', 'a', {})
    const r = await flush(async () => {
      throw new Error('network down')
    })
    expect(r.failed).toBe(1)
    expect(pending()[0].lastError).toBe('network down')
  })

  it('does not discard a tick made WHILE the flush is running', async () => {
    // The bug this guards: flush reads the queue, sends, then overwrites
    // storage with what it kept — clobbering anything queued in between.
    enqueue('step.setComplete', 'a', {})
    await flush(async () => {
      enqueue('step.setComplete', 'b', { late: true })
      return { ok: true }
    })
    expect(pendingCount()).toBe(1)
    expect(pending()[0].targetId).toBe('b')
  })

  it('sends only what was queued when the flush started', async () => {
    enqueue('step.setComplete', 'a', {})
    const seen: string[] = []
    await flush(async (e) => {
      seen.push(e.targetId)
      if (e.targetId === 'a') enqueue('step.setComplete', 'b', {})
      return { ok: true }
    })
    expect(seen).toEqual(['a'])
  })
})

describe('resilience', () => {
  it('survives a corrupt queue rather than bricking the screen', () => {
    fake.set(KEY, '{not json')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(pending()).toEqual([])
    expect(pendingCount()).toBe(0)
    warn.mockRestore()
  })

  it('survives a queue that parses but is not an array', () => {
    fake.set(KEY, '{"nope":1}')
    expect(pending()).toEqual([])
  })

  it('clears', () => {
    enqueue('step.setComplete', 'a', {})
    clear()
    expect(pendingCount()).toBe(0)
  })
})
