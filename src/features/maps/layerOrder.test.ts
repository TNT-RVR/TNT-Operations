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
