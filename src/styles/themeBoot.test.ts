/**
 * The pre-paint theme script must agree with the provider.
 *
 * `index.html` decides the theme synchronously in `<head>`, before any of the
 * bundle exists, so it cannot import the constants — it repeats the storage key
 * and the default by hand. If the two drift, the failure is not an error
 * anywhere: the page paints one theme and React immediately swaps it for the
 * other, on every cold load. That reads as a rendering bug rather than as a
 * mismatched string, so it is worth a test rather than a comment.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME } from './theme'

const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8')
const provider = readFileSync(join(process.cwd(), 'src', 'styles', 'theme.tsx'), 'utf8')

describe('the pre-paint theme script', () => {
  it('reads the same storage key the provider writes', () => {
    const key = provider.match(/const STORAGE_KEY = '([^']+)'/)?.[1]
    expect(key, 'theme.tsx should declare STORAGE_KEY').toBeDefined()
    expect(html).toContain(`localStorage.getItem('${key}')`)
  })

  /*
   * The markup carries the default as a class decision and the script only
   * overrides it for a stored 'dark'. That is the right way round while light
   * is the default; if the default ever flips back, this test is the thing that
   * points at the script.
   */
  it('defaults to the same theme the provider does', () => {
    expect(DEFAULT_THEME).toBe('light')
    expect(html).toMatch(/classList\.toggle\('on-light', !dark\)/)
  })

  it('keeps the browser chrome colour in step with the theme it picked', () => {
    expect(html).toMatch(/theme-color/)
    expect(html).toMatch(/dark \? '#050506' : '#FFFFFF'/)
  })

  // A dark app on a white splash screen (or the reverse) is a visible flash on
  // every launch of the installed app.
  it('has a manifest whose colours match the default', () => {
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), 'public', 'manifest.webmanifest'), 'utf8'),
    )
    expect(manifest.background_color).toBe('#FFFFFF')
    expect(manifest.theme_color).toBe('#FFFFFF')
  })
})
