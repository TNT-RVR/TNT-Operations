/**
 * The badge cap is written twice, so this makes them agree.
 *
 * `src/domain/appBadge.ts` is what the running app counts with;
 * `netlify/functions/lib/push.mjs` is what the sender puts in the payload for a
 * closed phone. A Netlify function cannot import from `src` — different bundle,
 * and it is TypeScript — so the number is duplicated on purpose.
 *
 * The failure it guards against is quiet and confusing: if the two drift, the
 * icon shows one number while the app is shut and a different one the instant
 * it opens, which reads as broken alerting rather than as a mismatched
 * constant. A comment saying "keep these in step" would hold for about two
 * changes; this holds for all of them.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BADGE_SCAN_LIMIT } from './appBadge'

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8')

describe('badge cap parity', () => {
  it('is the same number in the push sender', () => {
    const sender = read('netlify', 'functions', 'lib', 'push.mjs')
    const m = sender.match(/const BADGE_SCAN_LIMIT = (\d+)/)
    expect(m, 'push.mjs should declare BADGE_SCAN_LIMIT').not.toBeNull()
    expect(Number(m![1])).toBe(BADGE_SCAN_LIMIT)
  })

  // And the same number the provider fetches with, since the cap is only
  // honest if it is genuinely all the app holds.
  it('is what the provider actually loads', () => {
    const provider = read('src', 'data', 'SupabaseProvider.tsx')
    const line = provider
      .split(/\r?\n/)
      .find((l) => l.includes("from('app_notifications')") && l.includes('.limit('))
    expect(line, 'the notifications fetch should cap its limit').toBeDefined()
    expect(line).toContain('.limit(BADGE_SCAN_LIMIT)')
  })
})
