import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The legal pages must stay reachable SIGNED OUT.
 *
 * Intuit requires the licence and privacy URLs to be public, and their reviewer
 * opens them with no session. Everything under <SessionProvider> renders a
 * login screen when there is no session, so if these routes ever move inside it
 * — or if the components start calling useSession/useData, which throw outside
 * their providers — the pages silently become a login form and the QuickBooks
 * app assessment fails. Neither failure is visible to anyone signed in, which is
 * exactly why it needs a test rather than a comment.
 *
 * There is no jsdom in this project, so this reads the source instead of
 * rendering. That is enough to catch the two ways it realistically breaks.
 */
const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8')

describe('the legal routes are public', () => {
  const main = read('../../main.tsx')

  it('mounts /legal/* OUTSIDE SessionProvider', () => {
    const eula = main.indexOf('path="/legal/eula"')
    const privacy = main.indexOf('path="/legal/privacy"')
    const provider = main.indexOf('<SessionProvider>')

    expect(eula, '/legal/eula route is missing from main.tsx').toBeGreaterThan(-1)
    expect(privacy, '/legal/privacy route is missing from main.tsx').toBeGreaterThan(-1)
    expect(provider, 'SessionProvider is missing from main.tsx').toBeGreaterThan(-1)

    // Both routes are declared before the provider opens, so no session is
    // required to match them.
    expect(eula, '/legal/eula must be matched before SessionProvider').toBeLessThan(provider)
    expect(privacy, '/legal/privacy must be matched before SessionProvider').toBeLessThan(provider)
  })

  it('renders the gated app only as the fallback route', () => {
    // The catch-all carries the provider. If <App/> were mounted directly
    // instead, the routes above would never be reached.
    expect(main).toMatch(/path="\*"[\s\S]{0,200}<SessionProvider>/)
  })
})

describe('the legal pages need no backend', () => {
  const raw = read('./LegalPages.tsx')
  // Comments are stripped first: the file's own header explains why it avoids
  // these hooks, and naming them there is not using them.
  const page = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('does not use the session or data seams', () => {
    // Either hook throws when its provider is absent, which is precisely the
    // situation these pages are built for.
    expect(page).not.toMatch(/\buseSession\b/)
    expect(page).not.toMatch(/\buseData\b/)
    expect(page).not.toMatch(/from '@\/data\//)
    expect(page).not.toMatch(/from '@\/auth\//)
  })

  it('hardcodes no address of its own', () => {
    // It reads the shared constant instead. A second copy is how the licence
    // ends up pointing at a mailbox nobody reads.
    const emails = new Set(page.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? [])
    expect(emails.size, `expected no literal address here, found ${[...emails].join(', ')}`).toBe(0)
    expect(page).toMatch(/SUPPORT_EMAIL/)
  })
})

describe('the contact address has exactly one home', () => {
  it('is defined once, in src/config/contact.ts', () => {
    expect(read('../../config/contact.ts')).toMatch(/export const SUPPORT_EMAIL = '[^']+@[^']+'/)
  })

  it('is not copied anywhere else in src/', () => {
    // The address appears on the public legal pages AND on the in-app support
    // line. Two literals drift: one gets updated, the other keeps pointing
    // somewhere dead, and nobody finds out until a message goes unanswered.
    // Test fixtures are exempt — a made-up company address in a document
    // test is not a contact route anyone will follow.
    const cmd = 'git grep -lIE "[a-zA-Z0-9._+-]+@tntpollination\\.com" -- src ":(exclude)*.test.*"'
    // git grep exits 1 when it finds nothing, which execSync raises. That is
    // the PASSING case here, so it must not read as an error.
    let found = ''
    try {
      found = execSync(cmd, { cwd: resolve(__dirname, '../../..'), encoding: 'utf8' })
    } catch (e) {
      if ((e as { status?: number }).status !== 1) throw e
    }
    const strays = found.split('\n').filter((f) => f && f !== 'src/config/contact.ts')

    expect(strays, `the address should only live in src/config/contact.ts, also found in: ${strays.join(', ')}`)
      .toEqual([])
  })
})
