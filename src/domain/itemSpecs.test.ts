import { describe, expect, it } from 'vitest'
import { DEFAULT_ITEM_SPECS, type ItemSpec, packLine } from './packing'
import {
  emptySpec,
  fullPalletPreview,
  isSpecUsable,
  missingSpecs,
  productsShippingAs,
  freightGapAdvice,
  lineFreightGap,
  specProblems,
  unshippedProducts,
} from './itemSpecs'

const TOPS = DEFAULT_ITEM_SPECS.find((s) => s.item === 'Tray Tops')!
const at = (over: Partial<ItemSpec>): ItemSpec => ({ ...TOPS, ...over })

describe('specProblems', () => {
  it('has nothing to say about the real tray spec', () => {
    expect(specProblems(TOPS)).toEqual([])
  })

  // Zero is how the source workbook recorded "nobody measured this", and it is
  // the reason a load of corners quoted as weightless.
  it('treats a zero as unmeasured, not as a measurement', () => {
    const p = specProblems(at({ weightLbs: 0 }))
    expect(p).toHaveLength(1)
    expect(p[0].severity).toBe('blocking')
    expect(p[0].message).toMatch(/reweigh/i)
  })

  // Blocking is measured against what packLine USES. The item's own length,
  // width and height are not in that set - every freight number comes off the
  // pallet - so a spec missing them is incomplete, not unusable.
  it('blocks on every figure a pallet cannot be worked out without', () => {
    const blank = specProblems(emptySpec('Corners')).filter((p) => p.severity === 'blocking')
    expect(blank.map((p) => p.field).sort()).toEqual(
      ['maxItemsOnPallet', 'stackedHeightIn', 'weightLbs'].sort(),
    )
  })

  it('mentions missing item dimensions without refusing over them', () => {
    const p = specProblems(at({ lengthIn: 0, widthIn: 0 }))
    expect(p).toHaveLength(1)
    expect(p[0].severity).toBe('check')
    expect(p[0].message).toMatch(/No length, width recorded/)
    expect(isSpecUsable(at({ lengthIn: 0, widthIn: 0 }))).toBe(true)
  })

  it('wants a name that a product can ship as', () => {
    expect(specProblems(emptySpec('')).some((p) => p.field === 'item')).toBe(true)
  })

  // The mistake people actually make: typing the height off the tape measure
  // instead of what one more adds to the stack.
  it('catches a nested height taller than the item itself', () => {
    const p = specProblems(at({ stackedHeightIn: 5, heightIn: 3.5 })).filter(
      (x) => x.field === 'stackedHeightIn',
    )
    expect(p).toHaveLength(1)
    expect(p[0].severity).toBe('check')
    expect(p[0].message).toMatch(/cannot add more than the whole item/)
  })

  // 125 tray tops go on a pallet in 4 stacks - 31.25 a stack. Uneven stacking
  // is the normal case on the item TNT ships most, so it is not a finding.
  it('says nothing about stacks that do not divide evenly', () => {
    expect(specProblems(at({ maxItemsOnPallet: 125, stacksPerPallet: 4 }))).toEqual([])
    expect(isSpecUsable(at({ maxItemsOnPallet: 101 }))).toBe(true)
  })
})

describe('fullPalletPreview', () => {
  it('describes one full pallet the way the paperwork will', () => {
    const p = fullPalletPreview(TOPS)!
    expect(p.pallets).toBe(1)
    expect(p.qty).toBe(125)
    // 125 tops, 4 stacks, 2.48 in each nested, plus a 5.5 in deck.
    expect(p.outsideHeightIn).toBe(83)
    expect(Math.round(p.totalWeightLbs)).toBe(425)
  })

  it('refuses rather than previewing a pallet from a half-filled spec', () => {
    expect(fullPalletPreview(at({ weightLbs: 0 }))).toBeNull()
  })
})

describe('missingSpecs', () => {
  const products = [
    { name: 'Tray Top (air)', shipItem: 'Tray Tops', active: true },
    { name: 'Shelter Corners', shipItem: 'Corners', active: true },
    { name: 'Corner bracket', shipItem: 'Corners', active: true },
    { name: 'Old widget', shipItem: 'Widgets', active: false },
    { name: 'Consulting', shipItem: null, active: true },
  ]

  it('names the missing spec once, with everything waiting on it', () => {
    expect(missingSpecs(products, [{ item: 'Tray Tops' }])).toEqual([
      { item: 'Corners', products: ['Shelter Corners', 'Corner bracket'] },
    ])
  })

  // A retired product cannot reach a new estimate, so a gap behind one is not
  // a problem to put in front of anybody.
  it('ignores products that are no longer offered', () => {
    expect(missingSpecs(products, [{ item: 'Tray Tops' }]).map((m) => m.item)).not.toContain('Widgets')
  })

  it('says nothing when every shippable product has a spec', () => {
    expect(missingSpecs(products, [{ item: 'Tray Tops' }, { item: 'Corners' }])).toEqual([])
  })
})

describe('productsShippingAs', () => {
  it('lists what a change to a spec would move', () => {
    const products = [
      { name: 'Tray Top (air)', shipItem: 'Tray Tops' },
      { name: 'Tray Set', shipItem: 'Tray Tops' },
      { name: 'Bee Shelter', shipItem: 'Shelters' },
    ]
    expect(productsShippingAs(products, 'Tray Tops')).toEqual(['Tray Top (air)', 'Tray Set'])
  })
})

describe('the loaded-pallet check', () => {
  // The failure mode this exists for: every box on the form looks reasonable
  // on its own. 300 anchors, one stack, 1.5 in each — and a 456 in pallet.
  it('catches a pallet nothing could carry', () => {
    const p = specProblems(at({ maxItemsOnPallet: 300, stacksPerPallet: 1, stackedHeightIn: 1.5, heightIn: 2 }))
    expect(p).toHaveLength(1)
    expect(p[0].severity).toBe('check')
    expect(p[0].message).toMatch(/456 in tall/)
  })

  // TNT really does ship 83 in pallets of tray tops, so the ceiling has to sit
  // above the load the company actually sends.
  it('says nothing about the pallets TNT actually ships', () => {
    expect(specProblems(TOPS)).toEqual([])
    expect(fullPalletPreview(TOPS)!.outsideHeightIn).toBe(83)
  })

  // Nothing to measure from a spec that cannot make a pallet at all, and the
  // check must not talk over the missing figures that caused it.
  it('does not try to measure a pallet it cannot build', () => {
    const p = specProblems(at({ weightLbs: 0, maxItemsOnPallet: 9999 }))
    expect(p.every((x) => x.severity === 'blocking')).toBe(true)
  })
})

describe('unshippedProducts', () => {
  const products = [
    { name: 'Bee Shelter', shipItem: null, active: true },
    { name: 'Tray Set (top + bottom)', shipItem: null, active: true },
    { name: 'Tray Top (air)', shipItem: 'Tray Tops', active: true },
    { name: 'Retired thing', shipItem: null, active: false },
  ]

  // The packer falls back to the DESCRIPTION, so these do not fail loudly —
  // they fail at quote time with a message about weights rather than links.
  it('names the active products that never say what they ship as', () => {
    expect(unshippedProducts(products)).toEqual(['Bee Shelter', 'Tray Set (top + bottom)'])
  })

  it('leaves retired products out of it', () => {
    expect(unshippedProducts(products)).not.toContain('Retired thing')
  })

  // Kept separate from missingSpecs on purpose: one is a broken link, the other
  // may simply be a service with nothing to pallet.
  it('does not double-report a product that names a missing spec', () => {
    const withGap = [{ name: 'Shelter Corners', shipItem: 'Corners', active: true }]
    expect(unshippedProducts(withGap)).toEqual([])
    expect(missingSpecs(withGap, [])).toHaveLength(1)
  })
})

describe('lineFreightGap', () => {
  const specs = [TOPS, { ...TOPS, item: 'Anchors', heightIn: 0, stackedHeightIn: 0 }]

  it('is quiet about a line that packs', () => {
    expect(lineFreightGap({ description: 'Tray Top (air)', shipItem: 'Tray Tops' }, specs)).toBeNull()
  })

  // The live case: three of five products carry no ship item, and the packer
  // then looks the DESCRIPTION up, which is why this used to read as a missing
  // spec for an item nobody ever meant to create.
  it('separates a product that never says what it ships as', () => {
    expect(lineFreightGap({ description: 'Bee Shelter', shipItem: null }, specs)).toBe('no-ship-item')
  })

  it('still allows a description that happens to be a spec name', () => {
    expect(lineFreightGap({ description: 'Tray Tops', shipItem: null }, specs)).toBeNull()
  })

  it('separates a named item nobody has measured', () => {
    expect(lineFreightGap({ description: 'Corner', shipItem: 'Corners' }, specs)).toBe('no-spec')
  })

  it('separates a spec that exists but cannot make a pallet', () => {
    expect(lineFreightGap({ description: 'Anchor', shipItem: 'Anchors' }, specs)).toBe('unusable-spec')
  })
})

describe('freightGapAdvice', () => {
  // Each gap has a different fix, and the message has to name it — the whole
  // point of telling them apart.
  it('sends a set to be quoted as its parts', () => {
    const line = { description: 'Tray Set (top + bottom)', shipItem: null }
    expect(freightGapAdvice('no-ship-item', line)).toMatch(/quote those items as their own lines/)
  })

  it('sends a missing spec to the specs screen', () => {
    expect(freightGapAdvice('no-spec', { description: 'Corner', shipItem: 'Corners' })).toMatch(/Shipping specs/)
  })
})

describe('loose items — anchors in a tub', () => {
  /**
   * The real case: 300 anchors go on a pallet in tubs. There is no "height one
   * more anchor adds", so the spec states what a loaded pallet measures.
   */
  const ANCHORS: ItemSpec = {
    item: 'Anchors',
    weightLbs: 1.7,
    lengthIn: 21.5,
    widthIn: 3,
    heightIn: 1.5,
    stackedHeightIn: 0,
    maxItemsOnPallet: 300,
    palletSize: '48x40',
    stacksPerPallet: 0,
    packMode: 'loose',
    looseHeightIn: 34,
    containerTareLbs: 12,
  }

  it('does not ask a loose item for figures it cannot have', () => {
    expect(specProblems(ANCHORS)).toEqual([])
    expect(isSpecUsable(ANCHORS)).toBe(true)
  })

  it('asks for the one figure it can have, and blocks without it', () => {
    const p = specProblems({ ...ANCHORS, looseHeightIn: 0 })
    expect(p).toHaveLength(1)
    expect(p[0].severity).toBe('blocking')
    expect(p[0].message).toMatch(/Measure a real full pallet/)
  })

  it('uses the stated height rather than deriving one', () => {
    const p = fullPalletPreview(ANCHORS)!
    expect(p.heightPerPalletIn).toBe(34)
    expect(p.outsideHeightIn).toBe(40) // 34 + the 5.5 in deck, rounded up
  })

  // Tubs are not weightless, and understating gross is what gets rebilled.
  it('carries the empty containers in the weight', () => {
    const p = fullPalletPreview(ANCHORS)!
    expect(p.totalWeightLbs).toBeCloseTo(300 * 1.7 + 12, 5)
  })

  it('charges a part-full pallet only its share of the containers', () => {
    const half = packLine({ item: 'Anchors', qty: 150 }, ANCHORS)
    expect(half.totalWeightLbs).toBeCloseTo(150 * 1.7 + 6, 5)
  })

  // Reported as 0 rather than 1: there is nothing to change, and the freight
  // quote's stacks box must not look like it would move the height.
  it('reports no stacks at all', () => {
    expect(fullPalletPreview(ANCHORS)!.stacksPerPallet).toBe(0)
  })

  it('still catches a loose pallet nothing could carry', () => {
    const p = specProblems({ ...ANCHORS, looseHeightIn: 200 })
    expect(p.map((x) => x.severity)).toEqual(['check'])
  })

  // The default is unchanged, so every existing spec behaves as it always has.
  it('leaves a stacked spec alone', () => {
    expect(fullPalletPreview(TOPS)!.outsideHeightIn).toBe(83)
  })
})
