/**
 * Which secret wins, and whether the operator is told.
 *
 * The bug this replaces was not a wrong value — it was a right value that was
 * never reached, with nothing on screen to say so. So the assertions are as
 * much about the NOTICES as about the choice: a silent correct answer and a
 * silent wrong answer look identical from the terminal, which is the whole
 * failure.
 */
import { describe, expect, it } from 'vitest'
import { chooseSecret, fingerprint } from './envConfig.mjs'

const NAME = 'SUPABASE_ACCESS_TOKEN'
const warnings = (r) => r.notices.filter((n) => n.level === 'warn')

describe('choosing a secret', () => {
  it('uses the environment over the file, and says so', () => {
    const r = chooseSecret({ name: NAME, fromEnv: 'sbp_env', fileValues: ['sbp_file'] })
    expect(r.value).toBe('sbp_env')
    expect(r.source).toBe('environment')
    expect(warnings(r)).toHaveLength(1)
    expect(warnings(r)[0].text).toContain('Two different values')
  })

  it('says nothing alarming when they agree', () => {
    const r = chooseSecret({ name: NAME, fromEnv: 'same', fileValues: ['same'] })
    expect(r.value).toBe('same')
    expect(warnings(r)).toHaveLength(0)
    expect(r.notices[0].text).toContain('environment')
  })

  it('falls back to the file, and names it', () => {
    const r = chooseSecret({ name: NAME, fromEnv: null, fileValues: ['sbp_file'] })
    expect(r.value).toBe('sbp_file')
    expect(r.source).toBe('.env.local')
    expect(r.notices[0].text).toContain('.env.local')
  })

  it('reports nothing found rather than inventing a value', () => {
    const r = chooseSecret({ name: NAME, fromEnv: null, fileValues: [] })
    expect(r.value).toBeNull()
    expect(r.source).toBeNull()
    expect(r.notices).toHaveLength(0)
  })

  /*
   * The second shadow, one level down. `.env.local` held the key twice — a
   * truncated line first, the real token second — and the reader returned the
   * first. Removing the environment variable changed nothing, which made the
   * file look innocent.
   */
  it('warns when the file defines the key more than once with different values', () => {
    const r = chooseSecret({ name: NAME, fromEnv: null, fileValues: ['sbp_short', 'sbp_the_real_one'] })
    expect(r.value).toBe('sbp_short')
    expect(warnings(r)[0].text).toContain('2 times')
  })

  it('does not warn when a repeated key repeats the same value', () => {
    const r = chooseSecret({ name: NAME, fromEnv: null, fileValues: ['same', 'same'] })
    expect(warnings(r)).toHaveLength(0)
  })

  it('reports both shadows at once when both are present', () => {
    const r = chooseSecret({ name: NAME, fromEnv: 'sbp_env', fileValues: ['sbp_a', 'sbp_b'] })
    expect(warnings(r)).toHaveLength(2)
  })
})

describe('fingerprint', () => {
  /*
   * These notices print on every run, including in CI logs someone may paste.
   * Enough to tell two tokens apart, never enough to use one.
   */
  it('shows the tail and the length, not the secret', () => {
    const secret = 'sbp_0123456789abcdefXYZ'
    const f = fingerprint(secret)
    expect(f).toContain('efXYZ'.slice(-6))
    expect(f).toContain(String(secret.length))
    expect(f).not.toContain('sbp_0123456789')
  })

  it('handles absence without throwing', () => {
    expect(fingerprint(null)).toBe('none')
    expect(fingerprint('')).toBe('none')
  })
})
