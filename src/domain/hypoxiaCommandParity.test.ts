/**
 * The command whitelist exists twice, and the copies must agree.
 *
 * `src/domain/hypoxia.ts` is what the screen offers; `hypoxia-command.mjs` is
 * what actually decides — a disabled button is a UI state, the function is the
 * gate. A Netlify function cannot import from `src`, so the vocabulary is
 * repeated, the same way `push.mjs` repeats the badge cap.
 *
 * Drift here is not cosmetic. These commands move things in a sealed chamber
 * full of live bees: a command the UI offers but the function rejects is a
 * button that does nothing, and a risk level that disagrees is a manual valve
 * command being waved through on a routine permission check.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { COMMANDS, SETPOINT_MAX_PCT, SETPOINT_MIN_PCT } from './hypoxia'

const fn = readFileSync(join(process.cwd(), 'netlify', 'functions', 'hypoxia-command.mjs'), 'utf8')

/** The FIXED map from the function, as { wire: risk }. */
function fixedFromFunction(): Record<string, string> {
  const block = /const FIXED = \{([\s\S]*?)\n\}/.exec(fn)?.[1]
  if (!block) throw new Error('FIXED map not found in hypoxia-command.mjs')
  const out: Record<string, string> = {}
  for (const m of block.matchAll(/^\s*'?([A-Z0-9=]+)'?:\s*'(\w+)'/gm)) out[m[1]] = m[2]
  return out
}

describe('command vocabulary parity', () => {
  const fixed = fixedFromFunction()

  it('offers nothing the function would reject', () => {
    for (const c of COMMANDS) {
      expect(fixed[c.wire], `${c.wire} is offered by the UI but unknown to the function`).toBeDefined()
    }
  })

  it('agrees on how dangerous each one is', () => {
    for (const c of COMMANDS) {
      expect(fixed[c.wire], `${c.wire} risk`).toBe(c.risk)
    }
  })

  it('accepts nothing the UI does not offer', () => {
    const offered = new Set(COMMANDS.map((c) => c.wire))
    for (const wire of Object.keys(fixed)) {
      expect(offered.has(wire), `${wire} is accepted by the function but never offered`).toBe(true)
    }
  })

  /*
   * The setpoint bounds are the ones worth checking hardest. The firmware reads
   * TENTHS, so the function's limits are in tenths and the domain's are in
   * percent — a mismatch here means either the UI blocks something valid or the
   * function waves through a setpoint that would empty the chamber of oxygen.
   */
  it('bounds the setpoint at the same oxygen levels, despite different units', () => {
    const min = Number(/const SP_MIN_TENTHS = (\d+)/.exec(fn)?.[1])
    const max = Number(/const SP_MAX_TENTHS = (\d+)/.exec(fn)?.[1])
    expect(min / 10).toBe(SETPOINT_MIN_PCT)
    expect(max / 10).toBe(SETPOINT_MAX_PCT)
  })

  // Everything that bypasses the control loop has to be behind the elevated
  // check, or the permission gate is decorative.
  it('treats every manual and calibration command as elevated', () => {
    const elevated = /const ELEVATED = new Set\(\[([^\]]*)\]\)/.exec(fn)?.[1] ?? ''
    for (const risk of ['manual', 'calibration']) {
      expect(elevated, `${risk} should be elevated`).toContain(`'${risk}'`)
    }
    expect(elevated).not.toContain("'routine'")
  })
})
