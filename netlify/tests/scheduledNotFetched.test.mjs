import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The browser must never fetch a SCHEDULED function.
 *
 * Netlify refuses direct HTTP invocation of any function declaring a
 * `schedule` — it answers 403 before the request reaches our code, and the
 * response carries no body, so the app can only report a bare "403" with no
 * hint of why. Authentication is irrelevant; the door is not there.
 *
 * This was already written down in run.mjs's header and got broken anyway: a
 * "Sync now" button was pointed straight at the weekly bee-purchase sync. The
 * fix is the poll-govee/poll-now shape — the scheduled file exports the work,
 * and a second file with no schedule is the HTTP door.
 *
 * A comment did not prevent it. This does.
 */
const FN_DIR = resolve(__dirname, '../functions')
const SRC_DIR = resolve(__dirname, '../../src')

/** Function names that declare a cron schedule. */
function scheduledFunctions() {
  return readdirSync(FN_DIR)
    .filter((f) => /\.mjs$/.test(f) && !/\.test\./.test(f))
    .filter((f) => /config\s*=\s*\{[^}]*\bschedule\b/s.test(readFileSync(resolve(FN_DIR, f), 'utf8')))
    .map((f) => f.replace(/\.mjs$/, ''))
}

/** Every `/.netlify/functions/NAME` the client source fetches. */
function fetchedFromClient() {
  const hits = new Map()
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = resolve(dir, e.name)
      if (e.isDirectory()) return walk(p)
      return /\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : []
    })

  for (const file of walk(SRC_DIR)) {
    // Comments stripped: the fix for this bug is explained in one, by name.
    const text = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    for (const m of text.matchAll(/\/\.netlify\/functions\/([a-z0-9-]+)/gi)) {
      if (!hits.has(m[1])) hits.set(m[1], file.slice(SRC_DIR.length + 1).replace(/\\/g, '/'))
    }
  }
  return hits
}

describe('scheduled functions are not reachable over HTTP', () => {
  const scheduled = scheduledFunctions()
  const fetched = fetchedFromClient()

  it('finds both sides, so a broken parser cannot pass silently', () => {
    expect(scheduled.length, 'no scheduled functions parsed').toBeGreaterThan(0)
    expect(fetched.size, 'no client fetches of functions found').toBeGreaterThan(0)
  })

  it('the client never fetches one', () => {
    const offenders = [...fetched.entries()]
      .filter(([name]) => scheduled.includes(name))
      .map(([name, file]) => `${name} (fetched in src/${file})`)

    expect(
      offenders,
      'Netlify answers 403 to an HTTP request for a scheduled function, with no body to explain it. ' +
        'Export the work from the scheduled file and add a second function with NO schedule as the ' +
        'HTTP door — see poll-govee.mjs / poll-now.mjs.',
    ).toEqual([])
  })
})
