import { describe, it, expect } from 'vitest'
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

  it('states a contact address, and only one', () => {
    // Both documents read from one constant, so the address can never be
    // updated in the licence and missed in the policy.
    const emails = new Set(page.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? [])
    expect(emails.size, `expected one contact address, found ${[...emails].join(', ')}`).toBe(1)
    expect(page).toMatch(/const CONTACT_EMAIL = /)
  })
})
