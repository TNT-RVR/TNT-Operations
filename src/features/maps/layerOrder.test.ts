import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

/**
 * Every `addLayer` must come after the `addSource` it reads.
 *
 * MapLibre does NOT throw when a layer names a source that does not exist yet.
 * It fires an error event and silently skips the layer — so the map still
 * loads, everything else still draws, and the missing layer looks like a
 * feature that was never built rather than one that failed.
 *
 * That is exactly what happened to `shelters-label`: it sat four lines above
 * `addSource('shelters')`, so the pin-number toggle set its property and
 * nothing ever rendered it. Nothing caught it, because the map never
 * initialises in a unit test and the browser only logged an error event.
 *
 * This reads the source text rather than running the map, which is crude but is
 * the only thing that can see the bug without a live WebGL context.
 *
 * Scoped to the `style.load` handler, where file order IS execution order.
 * Layers added lazily from an effect (the LLD lookup does this) sit earlier in
 * the file than the init block but run long after it, and they guard themselves
 * with `getSource`/`getLayer` — comparing those by line number would be
 * comparing two different moments in time.
 */
const MAP_FILES = ['MapsHome.tsx']

describe('map layer registration order', () => {
  for (const name of MAP_FILES) {
    it(`${name}: every layer's source is added before it`, () => {
      const whole = readFileSync(resolve(__dirname, name), 'utf8')
      const initAt = whole.indexOf("map.on('style.load'")
      expect(initAt, 'the style.load handler should exist').toBeGreaterThan(-1)
      const src = whole.slice(initAt)

      // Position of each `addSource('id'` in the file.
      const sourceAt = new Map<string, number>()
      for (const m of src.matchAll(/addSource\(\s*'([^']+)'/g)) {
        if (!sourceAt.has(m[1])) sourceAt.set(m[1], m.index ?? 0)
      }

      // Each `addLayer({ … source: 'id' … })`, with the layer id when present.
      const problems: string[] = []
      for (const m of src.matchAll(/addLayer\(\s*\{([\s\S]{0,600}?)\}\s*\)/g)) {
        const body = m[1]
        const source = /source:\s*'([^']+)'/.exec(body)?.[1]
        if (!source) continue // a layer with no source (e.g. background)
        const id = /id:\s*'([^']+)'/.exec(body)?.[1] ?? '(unnamed)'
        const declaredAt = sourceAt.get(source)
        if (declaredAt === undefined) {
          problems.push(`layer '${id}' reads source '${source}', which is never added`)
        } else if (declaredAt > (m.index ?? 0)) {
          problems.push(`layer '${id}' is added BEFORE its source '${source}'`)
        }
      }

      expect(problems).toEqual([])
    })
  }
})

/**
 * A symbol layer with a `text-field` cannot draw anything in this app.
 *
 * `SATELLITE_STYLE` (basemap.ts) declares no `glyphs` URL, and MapLibre needs
 * one to rasterise any text. Without it a symbol layer is added successfully,
 * reports itself present via `getLayer`, and renders nothing — for ever. That
 * is how the shelter pin numbers looked like a feature nobody had built.
 *
 * Text is therefore drawn as DOM markers instead (see the pin labels in
 * MapsHome, and the field names in Field Mode). This test does not ban the
 * pattern outright, because one layer still uses it and is correspondingly
 * invisible — the parcel name on an LLD search. It pins that list so another
 * cannot be added by accident.
 */
describe('text layers need glyphs, which this style has none of', () => {
  /** Layers with a text-field that are known to render nothing today. */
  const KNOWN_DEAD = ['lld-lookup-label']

  it('the style still declares no glyphs — the reason for all this', () => {
    const style = readFileSync(resolve(__dirname, 'basemap.ts'), 'utf8')
    expect(style).not.toMatch(/\bglyphs\s*:/)
  })

  it('no NEW text layer has been added', () => {
    const src = readFileSync(resolve(__dirname, 'MapsHome.tsx'), 'utf8')
    const withText: string[] = []
    for (const m of src.matchAll(/addLayer\(\s*\{([\s\S]{0,700}?)\}\s*\)/g)) {
      const body = m[1]
      if (!/'text-field'/.test(body)) continue
      withText.push(/id:\s*'([^']+)'/.exec(body)?.[1] ?? '(unnamed)')
    }
    // Adding to this list means shipping something invisible. Draw a marker.
    expect(withText.sort()).toEqual([...KNOWN_DEAD].sort())
  })
})
