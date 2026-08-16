import { describe, it, expect } from 'vitest'
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Every file at the root of netlify/functions IS a deployed function.
 *
 * Netlify does not ask what a file is for — it takes each one at that level as
 * a function and derives the name from the filename. A period in the base name
 * is rejected, so a single `foo.test.mjs` dropped in there FAILS THE WHOLE
 * BUILD, not just itself.
 *
 * That is worse than it sounds, because a failed build is not a visible outage:
 * the previous deploy keeps serving. It cost real time once — production
 * QuickBooks keys were set in Netlify, the build failed on exactly this, the old
 * bundle kept running with the sandbox client id, and the symptom was Intuit
 * offering a sandbox company with no hint that a deploy had not happened.
 *
 * Tests live in netlify/tests/ instead, which the functions bundler never looks
 * at and vitest picks up through `netlify/*­*­/*.test.mjs`.
 */
const FUNCTIONS_DIR = resolve(__dirname, '../functions')

describe('netlify/functions', () => {
  const entries = readdirSync(FUNCTIONS_DIR, { withFileTypes: true })

  it('holds no test files at its root', () => {
    const tests = entries.filter((e) => e.isFile() && /\.(test|spec)\./.test(e.name)).map((e) => e.name)
    expect(tests, `move these to netlify/tests/ — Netlify would try to deploy them: ${tests.join(', ')}`).toEqual([])
  })

  it('gives every function a name Netlify will accept', () => {
    // Alphanumerics, hyphens and underscores only, before the extension.
    const bad = entries
      .filter((e) => e.isFile() && /\.(mjs|js|ts)$/.test(e.name))
      .map((e) => e.name)
      .filter((n) => !/^[A-Za-z0-9_-]+\.(mjs|js|ts)$/.test(n))
    expect(bad, `Netlify rejects these function names: ${bad.join(', ')}`).toEqual([])
  })
})
