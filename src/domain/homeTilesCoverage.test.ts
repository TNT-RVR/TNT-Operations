/**
 * Every new view is offered as a phone shortcut, or is deliberately not.
 *
 * The rule (Tyler, 2026-08-25): when a view is built, it becomes an option in
 * the home-screen tile settings. Left as a note in CLAUDE.md it would hold for
 * about two features — the same way "the browser must never fetch a scheduled
 * function" was written down, and then a Sync button was pointed straight at
 * one. So it is a test.
 *
 * A new route therefore forces a DECISION rather than a default: add it to
 * `HOME_TILES`, or add it to `NOT_A_SHORTCUT` below with the reason. Both are
 * fine answers; silently doing neither is not.
 *
 * Routes with a URL parameter are exempt automatically. "A field" is not a
 * destination anyone can pin — only a specific one is, and that is a link from
 * a list rather than a tile.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HOME_TILES } from './homeTiles'

/**
 * Views that are real but are not shortcut material, with why.
 *
 * Mostly sub-tabs: a section's chrome already carries them, and a home screen
 * of twenty tiles is the sidebar problem again. If one of these turns out to be
 * something people go to directly all day, move it into HOME_TILES instead.
 */
const NOT_A_SHORTCUT: Record<string, string> = {
  // Redirects, not views.
  'field/schedule': 'redirect to /field',
  'sales/quickbooks': 'redirect into Users & Settings',
  'users/integrations/quickbooks': 'a panel inside Integrations, reached from it',

  // Section sub-tabs, reached from the chrome of the section above them.
  'analysis/correlations': 'Analysis sub-tab',
  'analysis/fields': 'Analysis sub-tab',
  'analysis/growers': 'Analysis sub-tab',
  'analysis/map': 'Analysis sub-tab',
  'analysis/upload': 'Analysis sub-tab',
  'analysis/weather': 'Analysis sub-tab',
  'blocks/list': 'Blocks sub-tab',
  'incubation/alerts': 'Incubation sub-tab; the Alerts tile covers app-wide notices',
  'incubation/lineage': 'Incubation sub-tab, browsed from a sample or tray',
  'finances': 'redirect to /finances/sales',
  'finances/sales/customers': 'Sales sub-tab',
  'finances/sales/products': 'Sales sub-tab',
  'finances/sales/shipping': 'Sales sub-tab — reference figures, edited when an item is new',

  // The pre-Finances paths, kept so pinned tiles and bookmarks still land.
  // They are redirects, not views, and the thing they redirect TO is the
  // tile.
  'sales': 'redirect to /finances/sales',
  'sales/invoices': 'redirect to /finances/sales/invoices',
  'sales/inventory': 'redirect to /finances/sales/inventory',
  'sales/products': 'redirect to /finances/sales/products',
  'sales/customers': 'redirect to /finances/sales/customers',
  'sales/shipping': 'redirect to /finances/sales/shipping',
  'sales/bees': 'redirect to /finances/bees',
  'maps/costs': 'redirect to /finances/costs',
  'tasks/checklists': 'Tasks sub-tab — templates, not the daily list',
  'users/access': 'Settings sub-tab',
  'users/account': 'Settings sub-tab — and where the tiles themselves are chosen',
  'users/archive': 'Settings sub-tab',
  'users/company': 'Settings sub-tab',
  'users/integrations': 'Settings sub-tab',
}

function routesFromApp(): string[] {
  const src = readFileSync(join(process.cwd(), 'src', 'App.tsx'), 'utf8')
  return [...src.matchAll(/path="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((p) => !p.includes(':')) // a parameterised route is not pinnable
}

describe('home-screen shortcut coverage', () => {
  it('offers every view as a tile, or says why not', () => {
    const tiled = new Set(HOME_TILES.map((t) => t.to.replace(/^\//, '')))
    const undecided = routesFromApp().filter((p) => !tiled.has(p) && !(p in NOT_A_SHORTCUT))

    expect(
      undecided,
      `New view(s) with no decision about the phone home screen: ${undecided.join(', ')}.\n` +
        'Add each to HOME_TILES in src/domain/homeTiles.ts, or to NOT_A_SHORTCUT in this test with the reason.',
    ).toEqual([])
  })

  // The exemption list is only useful while it describes reality; a route that
  // was renamed leaves an entry here that quietly excuses nothing.
  it('has no stale exemptions', () => {
    const routes = new Set(routesFromApp())
    const stale = Object.keys(NOT_A_SHORTCUT).filter((p) => !routes.has(p))
    expect(stale, `NOT_A_SHORTCUT lists routes that no longer exist: ${stale.join(', ')}`).toEqual([])
  })

  it('points every tile at a route that exists', () => {
    const routes = new Set(routesFromApp())
    const broken = HOME_TILES.map((t) => t.to.replace(/^\//, '')).filter((p) => p !== '' && !routes.has(p))
    expect(broken, `Tiles pointing nowhere: ${broken.join(', ')}`).toEqual([])
  })
})
