/**
 * What makes a shipping spec usable, and what a bad one costs.
 *
 * `packing.ts` does the pallet arithmetic and refuses to guess: an item with no
 * spec comes back as `unspecced` and is left out of every total rather than
 * being counted as weightless. That is the right behaviour, and it means the
 * specs list is load-bearing — a missing or half-filled row silently stops a
 * product being quotable.
 *
 * This module is the other half of that bargain: it says which rows are
 * incomplete, which products point at a spec that does not exist, and what one
 * full pallet of an item actually works out to, so a spec can be checked
 * against a tape measure before a quote depends on it.
 *
 * Pure functions — no React, no DB.
 */
import { DEFAULT_PALLET_DECK_IN, type ItemSpec, type PackedLine, packLine } from './packing'

export interface SpecProblem {
  field: keyof ItemSpec | 'item'
  /** What is wrong, and what it does to a quote. */
  message: string
  /**
   * `blocking` means the spec cannot produce a pallet, so anything shipping as
   * this item is missing from the freight table. `check` means the numbers work
   * but look wrong, which is worth a second look and not worth refusing.
   */
  severity: 'blocking' | 'check'
}

/**
 * Everything wrong with one spec.
 *
 * The blocking set is exactly what `packLine` needs to produce a pallet: a
 * name, a weight, three dimensions, a per-pallet count and a stack count. Zero
 * is treated as missing rather than as a measurement — nothing that ships
 * weighs nothing, and a zero here is a field somebody never filled in.
 */
/**
 * A practical ceiling on a loaded pallet, inches.
 *
 * A dry van is about 110 in inside and a forklift needs room to place the load,
 * so a stack much past this is not something a carrier will take. It is a CHECK
 * and not a refusal: TNT does ship 83 in pallets, an oversize load is a real
 * thing that gets quoted specially, and the app has no business declaring one
 * impossible. What it can say is that 456 in is not a pallet.
 */
export const SANE_PALLET_HEIGHT_IN = 96

/**
 * The figures `packLine` cannot produce a pallet without.
 *
 * BLOCKING IS MEASURED AGAINST WHAT THE MATH USES, and nothing else. The item's
 * own length, width and height are not in that set — every freight number comes
 * off the PALLET (48x40 by the computed height), and the item dimensions feed
 * only the metric view and this screen's own list. Refusing a spec over a
 * figure that changes no output is how a rule stops being believed.
 *
 * Separate from `specProblems` so the pallet preview can ask whether it is safe
 * to compute one without calling back into the function that computes it.
 */
function blockingProblems(spec: ItemSpec): SpecProblem[] {
  const out: SpecProblem[] = []
  const need = (field: keyof ItemSpec, value: number, message: string) => {
    if (!Number.isFinite(value) || value <= 0) out.push({ field, message, severity: 'blocking' })
  }

  if (!spec.item.trim()) {
    out.push({
      field: 'item',
      message: 'A spec needs a name, and it must match what a product ships as.',
      severity: 'blocking',
    })
  }

  need('weightLbs', spec.weightLbs, 'No weight, so the load has no weight. Carriers reweigh and rebill the difference.')
  need('maxItemsOnPallet', spec.maxItemsOnPallet, 'Nothing fits on a pallet, so no pallet count can be worked out.')

  /*
   * A LOOSE item is measured differently, and asking it for the stacked figures
   * would be asking for numbers that do not exist. Anchors go in a tub: there
   * is no "height one more anchor adds", and a figure invented to fill that box
   * becomes a made-up pallet height, then a made-up density, then a made-up
   * freight class on a document a carrier bills against.
   */
  if (spec.packMode === 'loose') {
    need(
      'looseHeightIn',
      spec.looseHeightIn ?? 0,
      'No loaded pallet height. Measure a real full pallet - goods, containers and wrap - not counting the pallet itself.',
    )
    return out
  }

  need('stacksPerPallet', spec.stacksPerPallet, 'No stacks, so the pallet has no height.')

  /*
   * The nested height is the one people get wrong, because the obvious number
   * to type is the one on the tape measure. A tray top stands 3.5 in tall and
   * nests into 2.48 in, and using the standing height puts a pallet 40% over.
   */
  need(
    'stackedHeightIn',
    spec.stackedHeightIn,
    'No nested height. This is how much each ADDITIONAL item adds to a stack, not how tall one stands.',
  )
  return out
}

/**
 * The item's own dimensions, which are worth having and block nothing.
 *
 * Reported so a half-filled record is still visible, at a severity that matches
 * what it costs: today, nothing computes from them.
 */
function dimensionProblems(spec: ItemSpec): SpecProblem[] {
  const missing = (['lengthIn', 'widthIn', 'heightIn'] as const).filter(
    (f) => !Number.isFinite(spec[f]) || spec[f] <= 0,
  )
  if (missing.length === 0) return []
  const words: Record<string, string> = { lengthIn: 'length', widthIn: 'width', heightIn: 'height' }
  return [
    {
      field: missing[0],
      message:
        `No ${missing.map((f) => words[f]).join(', ')} recorded for a single item. Nothing on a freight ` +
        'document is worked out from these — the pallet is what gets measured — but the record is incomplete.',
      severity: 'check',
    },
  ]
}

/** Everything wrong with one spec: what stops it working, then what looks off. */
export function specProblems(spec: ItemSpec): SpecProblem[] {
  const out = [...blockingProblems(spec), ...dimensionProblems(spec)]

  if (spec.packMode !== 'loose' && spec.stackedHeightIn > spec.heightIn && spec.heightIn > 0) {
    out.push({
      field: 'stackedHeightIn',
      message:
        `Nested height (${spec.stackedHeightIn} in) is more than the item standing up (${spec.heightIn} in). ` +
        'Nesting cannot add more than the whole item, so one of the two is wrong.',
      severity: 'check',
    })
  }

  /*
   * There is deliberately NO check that the per-pallet count divides evenly
   * into the stacks. It does not on the item TNT ships most: 125 tray tops go
   * on a pallet in 4 stacks, which is 31.25 a stack. `packLine` averages, the
   * real Estes bill of lading agrees with the averaged height, and a rule that
   * fires on the primary item in the catalogue is noise rather than a check.
   */

  /*
   * What a full pallet would come to. This is the check that catches a spec
   * whose figures are each individually plausible: 300 anchors in one stack at
   * 1.5 in apiece is a 456 in pallet, and no single box on the form looks wrong.
   */
  const pallet = out.some((x) => x.severity === 'blocking')
    ? null
    : packLine({ item: spec.item, qty: spec.maxItemsOnPallet }, spec)
  if (pallet && pallet.outsideHeightIn > SANE_PALLET_HEIGHT_IN) {
    out.push({
      field: 'maxItemsOnPallet',
      message:
        `A full pallet of ${spec.maxItemsOnPallet} comes to ${pallet.outsideHeightIn} in tall, over the ` +
        `${SANE_PALLET_HEIGHT_IN} in a carrier will normally take. Either fewer fit on a pallet than this says, ` +
        'or they go in more stacks than one.',
      severity: 'check',
    })
  }

  return out
}

/** A spec that can produce a pallet. Anything else is missing from a quote. */
export function isSpecUsable(spec: ItemSpec): boolean {
  return blockingProblems(spec).length === 0
}

/**
 * One full pallet of an item, as the freight documents would describe it.
 *
 * Shown beside the editor so a spec can be checked against something physical
 * — "125 tops, four stacks, 83 in tall, 465 lb" is a thing somebody can walk
 * out and look at, in a way that seven separate numbers are not.
 */
export function fullPalletPreview(spec: ItemSpec, deckIn: number = DEFAULT_PALLET_DECK_IN): PackedLine | null {
  if (blockingProblems(spec).length > 0) return null
  return packLine({ item: spec.item, qty: spec.maxItemsOnPallet }, spec, deckIn)
}

/**
 * Products that name a shipping item nothing has a spec for.
 *
 * This is the gap that reads as a working system right up until someone builds
 * a quote: the product exists, the price is right, and the item simply is not
 * on the freight table. Returned as one entry per missing NAME, with the
 * products waiting on it, because the fix is one new spec rather than one per
 * product.
 */
export function missingSpecs(
  products: Array<{ name: string; shipItem: string | null; active: boolean }>,
  specs: Array<{ item: string }>,
): Array<{ item: string; products: string[] }> {
  const known = new Set(specs.map((s) => s.item))
  const byItem = new Map<string, string[]>()
  for (const p of products) {
    // An inactive product cannot reach a new estimate, so a gap behind one is
    // not a problem to put in front of anybody.
    if (!p.active || !p.shipItem || known.has(p.shipItem)) continue
    const list = byItem.get(p.shipItem) ?? []
    list.push(p.name)
    byItem.set(p.shipItem, list)
  }
  return [...byItem.entries()]
    .map(([item, products]) => ({ item, products }))
    .sort((a, b) => a.item.localeCompare(b.item))
}

/**
 * Products that never say how they ship.
 *
 * A null `shipItem` is NOT automatically wrong — a service has nothing to put
 * on a pallet — so this is reported apart from `missingSpecs` and worded as a
 * question rather than a fault. But it is not harmless either: the packer falls
 * back to the line's DESCRIPTION, so a Bee Shelter with no shipping item is
 * looked up as an item called "Bee Shelter", finds nothing, and lands in
 * `unspecced` — where it blocks the freight quote with a message about weights
 * rather than about the missing link that caused it.
 *
 * Which is exactly the state the live catalogue is in: three of five active
 * products name no shipping item, and the one real order line is one of them.
 */
export function unshippedProducts(
  products: Array<{ name: string; shipItem: string | null; active: boolean }>,
): string[] {
  return products.filter((p) => p.active && !p.shipItem).map((p) => p.name)
}

/** Which products ship as a given spec — shown so a change's blast radius is visible. */
export function productsShippingAs(
  products: Array<{ name: string; shipItem: string | null }>,
  item: string,
): string[] {
  return products.filter((p) => p.shipItem === item).map((p) => p.name)
}

/** A blank spec, for the "new item" form. */
export function emptySpec(item = ''): ItemSpec {
  return {
    item,
    weightLbs: 0,
    lengthIn: 0,
    widthIn: 0,
    heightIn: 0,
    stackedHeightIn: 0,
    maxItemsOnPallet: 0,
    palletSize: '48x40',
    // One stack is the honest default: an item nobody has told us nests is an
    // item that goes on the deck once.
    stacksPerPallet: 1,
    packMode: 'stacked',
  }
}

/** Why a line is missing from the freight table, or null when it is not. */
export type FreightGap = 'no-ship-item' | 'no-spec' | 'unusable-spec'

/**
 * Why one order line will not appear on the freight documents.
 *
 * The packer looks an item up by `shipItem`, falling back to the line's
 * DESCRIPTION when there is none. That fallback is what makes the failure so
 * quiet: a Bee Shelter with no shipping item is looked up as an item called
 * "Bee Shelter", finds nothing, and is reported as a missing spec — which sends
 * whoever reads it off to write a spec for a name that was never meant to be
 * one. The three cases need different fixes, so they are told apart here:
 *
 *   no-ship-item   the product never says what it ships as. Set it, or quote
 *                  the thing as its parts if it is a set of several items.
 *   no-spec        it names an item nothing has measured. Write the spec.
 *   unusable-spec  the spec exists but cannot make a pallet. Finish it.
 */
export function lineFreightGap(
  line: { description: string; shipItem: string | null },
  specs: ItemSpec[],
): FreightGap | null {
  if (!line.shipItem) {
    // A line whose description happens to match a spec is fine — that is how
    // the fallback is meant to work, and plenty of orders rely on it.
    const bySpec = specs.find((s) => s.item === line.description)
    if (!bySpec) return 'no-ship-item'
    return isSpecUsable(bySpec) ? null : 'unusable-spec'
  }
  const spec = specs.find((s) => s.item === line.shipItem)
  if (!spec) return 'no-spec'
  return isSpecUsable(spec) ? null : 'unusable-spec'
}

/** What to do about a gap, in the words of the person who has to do it. */
export function freightGapAdvice(gap: FreightGap, line: { description: string; shipItem: string | null }): string {
  switch (gap) {
    case 'no-ship-item':
      return `${line.description} does not say what it ships as, so it is not in the pallet count or on any freight document. Set “Ships as” on the product — or, if it is a set of several items, quote those items as their own lines instead.`
    case 'no-spec':
      return `Nothing has measured “${line.shipItem}”, so ${line.description} is not in the pallet count. Add it under Sales → Shipping specs.`
    case 'unusable-spec':
      return `The spec for “${line.shipItem ?? line.description}” is missing figures a pallet cannot be worked out without, so ${line.description} is not in the pallet count.`
  }
}
