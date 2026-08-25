import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TILE_KEYS,
  HOME_TILES,
  availableTiles,
  moveTile,
  resolveTiles,
  toggleTile,
} from './homeTiles'

const all = () => true
const only =
  (...modules: string[]) =>
  (m: string) =>
    modules.includes(m)

describe('the catalogue', () => {
  it('has unique keys, since a saved list is keys', () => {
    expect(new Set(HOME_TILES.map((t) => t.key)).size).toBe(HOME_TILES.length)
  })

  it('points every tile at a real path and a module', () => {
    for (const t of HOME_TILES) {
      expect(t.to.startsWith('/'), t.key).toBe(true)
      expect(t.module.length, t.key).toBeGreaterThan(0)
    }
  })

  it('offers a default that is usable rather than everything', () => {
    expect(DEFAULT_TILE_KEYS.length).toBeGreaterThan(3)
    expect(DEFAULT_TILE_KEYS.length).toBeLessThan(9)
    for (const k of DEFAULT_TILE_KEYS) expect(HOME_TILES.some((t) => t.key === k), k).toBe(true)
  })
})

describe('resolveTiles', () => {
  it('falls back to the defaults for someone who has chosen nothing', () => {
    expect(resolveTiles(null, all).map((t) => t.key)).toEqual(DEFAULT_TILE_KEYS)
    expect(resolveTiles([], all).map((t) => t.key)).toEqual(DEFAULT_TILE_KEYS)
  })

  // Someone who put the scanner first meant it.
  it('keeps the order chosen, not the catalogue order', () => {
    expect(resolveTiles(['blockScan', 'field'], all).map((t) => t.key)).toEqual(['blockScan', 'field'])
  })

  // A crew tablet has field, calendar, blocks and tasks — offering it Sales
  // would be offering a locked door.
  it('drops tiles the person cannot open', () => {
    const keys = resolveTiles(['field', 'sales', 'blockScan'], only('field', 'blocks')).map((t) => t.key)
    expect(keys).toEqual(['field', 'blockScan'])
  })

  // A tile can be renamed or retired between deploys; a stale key in someone's
  // saved list should cost nothing.
  it('ignores keys that no longer exist', () => {
    expect(resolveTiles(['field', 'no-such-tile'], all).map((t) => t.key)).toEqual(['field'])
  })

  it('ignores a key listed twice', () => {
    expect(resolveTiles(['field', 'field'], all).map((t) => t.key)).toEqual(['field'])
  })
})

describe('availableTiles', () => {
  it('offers only what the person may open', () => {
    const mods = new Set(availableTiles(only('incubation')).map((t) => t.module))
    expect([...mods]).toEqual(['incubation'])
  })
})

describe('toggleTile', () => {
  it('adds to the end, so a new tile appears where it was chosen', () => {
    expect(toggleTile(['field', 'tasks'], 'costs')).toEqual(['field', 'tasks', 'costs'])
  })
  it('removes without disturbing the rest', () => {
    expect(toggleTile(['field', 'tasks', 'costs'], 'tasks')).toEqual(['field', 'costs'])
  })
})

describe('moveTile', () => {
  it('swaps with its neighbour', () => {
    expect(moveTile(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(moveTile(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b'])
  })
  it('does nothing at either end, rather than wrapping', () => {
    expect(moveTile(['a', 'b'], 'a', -1)).toEqual(['a', 'b'])
    expect(moveTile(['a', 'b'], 'b', 1)).toEqual(['a', 'b'])
  })
  it('does nothing for a key that is not there', () => {
    expect(moveTile(['a', 'b'], 'zz', 1)).toEqual(['a', 'b'])
  })
})
