import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isAuthFailure, reportAnthropicFailure } from '../functions/lib/anthropicAlert.mjs'

describe('isAuthFailure', () => {
  // These are the ones a person has to fix. Everything else usually fixes
  // itself, and waking somebody for it teaches them to ignore the alerts.
  it('treats 401 and 403 as the key being wrong', () => {
    expect(isAuthFailure(401)).toBe(true)
    expect(isAuthFailure(403)).toBe(true)
  })

  it('does not treat a rate limit or an outage as a key problem', () => {
    for (const s of [429, 500, 502, 503, 529]) expect(isAuthFailure(s)).toBe(false)
  })
})

describe('reportAnthropicFailure', () => {
  const env = { ...process.env }
  let sent

  beforeEach(() => {
    sent = []
    process.env.SUPABASE_URL = 'https://example.test'
    process.env.SUPABASE_SERVICE_ROLE = 'service-role'
    vi.stubGlobal('fetch', async (url, init) => {
      sent.push({ url, body: JSON.parse(init.body) })
      return { ok: true }
    })
  })
  afterEach(() => {
    process.env = { ...env }
    vi.unstubAllGlobals()
  })

  it('writes an alert a person can act on', async () => {
    await reportAnthropicFailure('grants-pull', 401, 'authentication_error')
    expect(sent).toHaveLength(1)
    const row = sent[0].body
    expect(row.type).toBe('anthropic_key_failed')
    expect(row.severity).toBe('critical')
    expect(row.title).toMatch(/key rejected/i)
    // The message has to say what to DO, not just what happened.
    expect(row.body).toMatch(/ANTHROPIC_API_KEY/)
    expect(row.body).toMatch(/redeploy/)
  })

  /*
   * The row must arrive UNSTAMPED or push-pending skips it — these two
   * functions have no sender of their own, which is the whole reason the
   * sweeper exists.
   */
  it('leaves delivery to the sweeper', async () => {
    await reportAnthropicFailure('grants-pull', 401)
    expect(sent[0].body.pushed_at).toBeNull()
  })

  // A key that stays expired must not raise this every Monday.
  it('dedupes an auth failure by kind, not by caller or time', async () => {
    await reportAnthropicFailure('grants-pull', 401)
    await reportAnthropicFailure('analysis-ai', 403)
    expect(sent[0].body.dedup_key).toBe('anthropic_auth')
    expect(sent[1].body.dedup_key).toBe('anthropic_auth')
  })

  it('keeps a transient failure separate and quieter', async () => {
    await reportAnthropicFailure('analysis-ai', 429, 'rate limited')
    expect(sent[0].body.severity).toBe('warning')
    expect(sent[0].body.dedup_key).toBe('anthropic_http_429')
  })

  // Reporting a failure must never become one.
  it('says no rather than throwing when Supabase is unreachable', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('network down')
    })
    await expect(reportAnthropicFailure('grants-pull', 401)).resolves.toBe(false)
  })

  it('does nothing without a service role rather than sending an unauthed write', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE
    expect(await reportAnthropicFailure('grants-pull', 401)).toBe(false)
    expect(sent).toHaveLength(0)
  })
})

describe('the call sites', () => {
  const read = (f) => readFileSync(resolve(__dirname, '../functions', f), 'utf8')

  // Both talk to Anthropic; both must report. grants-pull is the one that
  // matters most, being scheduled — nobody ever sees its response.
  it('report from every place that calls the model', () => {
    for (const f of ['grants-pull.mjs', 'analysis-ai.mjs']) {
      const src = read(f)
      expect(src, f).toContain('reportAnthropicFailure')
      expect(src, f).toMatch(/if \(!res\.ok\)/)
    }
  })
})

describe('the settings registry', () => {
  /*
   * A type nobody can see is a type nobody can turn on. `sensor_offline` was
   * raised 16 times in three weeks with no row in this list, so the only way to
   * enable push for it was SQL — the toggle simply was not on the screen.
   */
  it('offers every type the app actually raises', () => {
    const src = readFileSync(
      resolve(__dirname, '../../src/features/notifications/NotificationsHome.tsx'),
      'utf8',
    )
    for (const type of [
      'sensor_offline',
      'temp_out_of_range',
      'milestone',
      'task_overdue',
      'task_due_soon',
      'qbo_sync_failed',
      'qbo_auth_expired',
      'grant_new',
      'anthropic_key_failed',
    ]) {
      expect(src, `${type} should be in the notification settings list`).toContain(`'${type}'`)
    }
  })
})
