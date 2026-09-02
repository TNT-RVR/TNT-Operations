/**
 * A command's four "sent" states, told apart.
 *
 * Commissioning the first chamber, a purge was sent, something was audible at
 * the machine, the Nano never reported `"purge":1`, and the app showed the
 * command as sent. The firmware knew — it printed
 * `TX->NANO BURST: timeout (no telemetry confirm)` — but only to a serial
 * cable in the shed. These are the states that reporting the verdict home
 * makes distinguishable.
 */
import { describe, it, expect } from 'vitest'
import {
  COMMAND_STATUS_LABEL,
  COMMAND_STATUS_NOTE,
  COMMAND_VERDICT_GRACE_MS,
  commandConcern,
  commandStatus,
  type CommandStatus,
} from './hypoxia'

const NOW = Date.parse('2026-09-02T18:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()

const cmd = (over: Partial<Parameters<typeof commandStatus>[0]> = {}) => ({
  ok: true,
  deliveredAt: ago(20_000),
  outcome: null as 'confirmed' | 'timeout' | null,
  sentAt: ago(30_000),
  ...over,
})

describe('commandStatus', () => {
  it('calls a command the function would not queue refused', () => {
    expect(commandStatus(cmd({ ok: false, deliveredAt: null }), NOW)).toBe('refused')
  })

  it('calls an accepted, uncollected command queued', () => {
    expect(commandStatus(cmd({ deliveredAt: null }), NOW)).toBe('queued')
  })

  it('calls a just-collected command working, not stalled', () => {
    expect(commandStatus(cmd({ deliveredAt: ago(5_000) }), NOW)).toBe('working')
  })

  it('confirms when the device reported the Nano acted', () => {
    expect(commandStatus(cmd({ outcome: 'confirmed' }), NOW)).toBe('confirmed')
  })

  it('reports the burst timeout as not confirmed', () => {
    expect(commandStatus(cmd({ outcome: 'timeout' }), NOW)).toBe('unconfirmed')
  })

  it('stalls a command collected long ago with no verdict', () => {
    expect(commandStatus(cmd({ deliveredAt: ago(COMMAND_VERDICT_GRACE_MS + 1_000) }), NOW)).toBe('stalled')
  })

  /*
   * The grace period must clear the firmware's own timing, or a chamber that
   * is merely slow gets reported as unresponsive. The burst gives up after 8 s
   * and the verdict rides the next post ~15 s later.
   */
  it('leaves room for the firmware burst plus a post cycle', () => {
    expect(COMMAND_VERDICT_GRACE_MS).toBeGreaterThan(8_000 + 15_000)
    expect(commandStatus(cmd({ deliveredAt: ago(30_000) }), NOW)).toBe('working')
  })

  /*
   * A verdict outranks the clock. A device that reported "confirmed" and then
   * went offline did the thing, and must not later be re-described as stalled.
   */
  it('keeps a verdict once given, however old', () => {
    const old = { deliveredAt: ago(30 * 86_400_000), sentAt: ago(30 * 86_400_000) }
    expect(commandStatus(cmd({ ...old, outcome: 'confirmed' }), NOW)).toBe('confirmed')
    expect(commandStatus(cmd({ ...old, outcome: 'timeout' }), NOW)).toBe('unconfirmed')
  })

  it('labels every status', () => {
    const all: CommandStatus[] = ['refused', 'queued', 'working', 'confirmed', 'unconfirmed', 'stalled']
    for (const s of all) expect(COMMAND_STATUS_LABEL[s]).toBeTruthy()
  })

  /*
   * Notes exist for the states a person has to act on. Attaching one to every
   * status is how people stop reading them.
   */
  it('explains only the states that need explaining', () => {
    expect(COMMAND_STATUS_NOTE.unconfirmed).toBeTruthy()
    expect(COMMAND_STATUS_NOTE.stalled).toBeTruthy()
    expect(COMMAND_STATUS_NOTE.confirmed).toBeUndefined()
    expect(COMMAND_STATUS_NOTE.queued).toBeUndefined()
  })
})

describe('commandConcern', () => {
  const base = { chamberId: 'c1', ok: true }

  it('is silent when the newest command confirmed', () => {
    const rows = [
      { ...base, sentAt: ago(10_000), deliveredAt: ago(9_000), outcome: 'confirmed' as const },
      { ...base, sentAt: ago(90_000), deliveredAt: ago(89_000), outcome: 'timeout' as const },
    ]
    expect(commandConcern(rows, 'c1', NOW)).toBeNull()
  })

  /*
   * An older failure that a later command superseded is history. Surfacing
   * every past failure buries the current one, which is the only actionable
   * thing on the card.
   */
  it('reports the newest command, not the worst one', () => {
    const rows = [
      { ...base, sentAt: ago(90_000), deliveredAt: ago(89_000), outcome: 'confirmed' as const },
      { ...base, sentAt: ago(10_000), deliveredAt: ago(9_000), outcome: 'timeout' as const },
    ]
    expect(commandConcern(rows, 'c1', NOW)?.status).toBe('unconfirmed')
  })

  it('ignores other chambers', () => {
    const rows = [{ ...base, chamberId: 'other', sentAt: ago(10_000), deliveredAt: ago(9_000), outcome: 'timeout' as const }]
    expect(commandConcern(rows, 'c1', NOW)).toBeNull()
  })

  it('is silent for a chamber with no commands', () => {
    expect(commandConcern([], 'c1', NOW)).toBeNull()
  })

  it('does not warn about a command still in flight', () => {
    const rows = [{ ...base, sentAt: ago(5_000), deliveredAt: ago(4_000), outcome: null }]
    expect(commandConcern(rows, 'c1', NOW)).toBeNull()
  })
})
