/**
 * `viewport-fit=cover` and the iOS status-bar style have to agree.
 *
 * Cover lets the page draw UNDER the system bars, and the app then keeps itself
 * clear with `env(safe-area-inset-*)`. That is only worth doing when something
 * actually needs to be behind a system bar — on this app, that was
 * `apple-mobile-web-app-status-bar-style: black-translucent`.
 *
 * Leaving cover on WITHOUT that reason is not neutral. On Android with
 * three-button navigation the bottom inset is commonly reported as 0 while the
 * nav bar still overlays the viewport, so `.safe-bottom` adds no padding and
 * the app's own bottom bar renders underneath the system one — invisible, and
 * intermittently so, since the inset changes with gesture-vs-button navigation,
 * rotation and the keyboard.
 *
 * That is exactly what happened: the status-bar style went to `default` when
 * the app went light, and cover was left behind. This keeps the two in step.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8')

const meta = (name: string) =>
  new RegExp(`<meta\\s+name="${name}"\\s+content="([^"]*)"`).exec(html)?.[1] ?? null

describe('viewport fit', () => {
  const cover = /viewport-fit\s*=\s*cover/.test(meta('viewport') ?? '')
  const translucent = meta('apple-mobile-web-app-status-bar-style') === 'black-translucent'

  it('only draws under the system bars when something needs to be there', () => {
    // If this fails after turning cover back on, the bottom nav needs checking
    // on an Android phone with three-button navigation before shipping.
    expect(
      cover && !translucent,
      'viewport-fit=cover without black-translucent hides the bottom bar under Android system nav',
    ).toBe(false)
  })

  it('still declares a responsive viewport', () => {
    expect(meta('viewport')).toContain('width=device-width')
  })
})
