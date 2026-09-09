import { describe, it, expect } from 'vitest'
import { neighbours } from './incubatorNav'

const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

describe('neighbours', () => {
  it('gives the ones either side, in list order', () => {
    const n = neighbours(list, 'b')
    expect(n.prev?.id).toBe('a')
    expect(n.next?.id).toBe('c')
  })

  it('wraps at the end', () => {
    // Eight incubators is a ring, not a queue: a dead arrow at the end is a
    // tap that has to be explained.
    expect(neighbours(list, 'c').next?.id).toBe('a')
  })

  it('wraps at the start', () => {
    expect(neighbours(list, 'a').prev?.id).toBe('c')
  })

  it('says where you are in the list', () => {
    expect(neighbours(list, 'b')).toMatchObject({ index: 2, total: 3 })
  })

  it('offers nothing when there is only one', () => {
    // Stepping to yourself is a button that appears broken.
    const n = neighbours([{ id: 'only' }], 'only')
    expect(n.prev).toBeNull()
    expect(n.next).toBeNull()
    expect(n).toMatchObject({ index: 1, total: 1 })
  })

  it('offers nothing for an id that is not in the list', () => {
    const n = neighbours(list, 'missing')
    expect(n.prev).toBeNull()
    expect(n.next).toBeNull()
    expect(n.index).toBe(0)
  })

  it('survives an empty list', () => {
    expect(neighbours([], 'anything')).toEqual({ prev: null, next: null, index: 0, total: 0 })
  })
})
