/**
 * Pallet and weight math for a shipment. Pure functions — no React, no DB.
 *
 * Ported from the "Sale Cost Calculator" workbook's `Item Specs` and
 * `Shipping Calculator` sheets. Given what's on the order, it works out how
 * many pallets, how heavy each one is, how tall it stacks, and what the load
 * weighs in total — the numbers a freight quote, a packing list and a customs
 * declaration all need.
 *
 * ── Imperial is the source of truth ──────────────────────────────────────────
 * The sheet kept two parallel blocks: rows 16–24 in inches and pounds (typed by
 * hand) and rows 3–11 in millimetres and kilograms (formulas pointing at the
 * imperial rows). Same here — `ItemSpec` is imperial, and metric is derived on
 * demand by `toMetric`. One set of numbers to maintain, and rounding can't make
 * the two disagree.
 *
 * ── Deliberate differences from the workbook ─────────────────────────────────
 *
 * 1. A MISSING SPEC IS AN ERROR, NOT A ZERO. Every lookup in the sheet was
 *    wrapped in `iferror(…, 0)`, and `Item Specs` has no weight or dimensions
 *    for Zip Ties, Bungees, Nesting Blocks or Corners. Put corners on an order
 *    and the calculator reported them as weightless and needing no pallet —
 *    a freight quote that is wrong in the expensive direction, with nothing
 *    on screen to say so. `packShipment` returns those items in `unspecced`
 *    and refuses to count them toward the totals.
 *
 * 2. PALLETS HAVE WEIGHT. The sheet totalled only the goods. Carriers bill
 *    gross, so `palletTareLbs` adds the deck weight back; it defaults to 0,
 *    which reproduces the sheet exactly, and a real value (a 48×40 wood pallet
 *    is 33–48 lb) gives the number the carrier will actually invoice.
 *
 * 3. ITEMS SPREAD EVENLY ACROSS PALLETS. `I = qty ÷ pallets` is the sheet's own
 *    formula and is kept, so 500 tray tops over 4 pallets reports 125 each
 *    rather than 125/125/125/125. Worth knowing when reading a packing list:
 *    it's the average, and the last pallet is usually the light one.
 */
import { LBS_PER_KG } from './incubation'

/** Millimetres per inch. */
export const MM_PER_IN = 25.4

// ═══════════════════════════════════════════════════════════════════════════
// Item specs — the `Item Specs` sheet, imperial rows 16:24
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The physical facts about one shippable item.
 *
 * `heightIn` is the item standing alone; `stackedHeightIn` is how much height
 * each ADDITIONAL one adds once nested. They differ a lot on trays — a top is
 * 3.5 in tall but nests into 2.48 in — and using the wrong one is how a load
 * ends up over height.
 */
export interface ItemSpec {
  /** Item name — the lookup key, matching a product SKU's shipping name. */
  item: string
  weightLbs: number
  lengthIn: number
  widthIn: number
  heightIn: number
  /** Height each nested item adds to a stack. */
  stackedHeightIn: number
  /** How many fit on one pallet, all stacks combined. */
  maxItemsOnPallet: number
  /** Pallet footprint, e.g. '48x40'. Descriptive. */
  palletSize: string
  /** Side-by-side stacks on one pallet — 4 for trays, 1 for a full-deck Cubee. */
  stacksPerPallet: number

  /**
   * How the item occupies a pallet.
   *
   * `stacked` is the original and the default: identical things nest into each
   * other, so the height of a pallet is worked out from how many stacks there
   * are and what each additional item adds. That is right for trays and Cubees.
   *
   * `loose` is for goods that do not stack at all — anchors go into a tub, and
   * a tub of anchors is not "an anchor plus an anchor plus an anchor". There is
   * no per-item nested height to measure and inventing one produces a made-up
   * pallet height, which becomes a made-up density and a made-up freight class.
   * So a loose item states the loaded pallet height instead, which is the thing
   * somebody can actually put a tape measure against.
   */
  packMode?: 'stacked' | 'loose'
  /**
   * Height of a loaded pallet EXCLUDING the pallet deck, inches. `loose` only.
   * Measure a real full one: goods, tubs, wrap and all.
   */
  looseHeightIn?: number
  /**
   * Weight of the empty containers on ONE full pallet, pounds. `loose` only,
   * and optional — but tubs are not weightless, and understating gross weight
   * is the most expensive mistake on a freight bill.
   */
  containerTareLbs?: number
}

/** The metric view of a spec — the sheet's rows 3:11, derived not typed. */
export interface ItemSpecMetric {
  item: string
  weightKg: number
  lengthMm: number
  widthMm: number
  heightMm: number
  stackedHeightMm: number
  maxItemsOnPallet: number
  palletSize: string
  stacksPerPallet: number
}

export function toMetric(s: ItemSpec): ItemSpecMetric {
  return {
    item: s.item,
    weightKg: s.weightLbs * LBS_PER_KG,
    lengthMm: s.lengthIn * MM_PER_IN,
    widthMm: s.widthIn * MM_PER_IN,
    heightMm: s.heightIn * MM_PER_IN,
    stackedHeightMm: s.stackedHeightIn * MM_PER_IN,
    maxItemsOnPallet: s.maxItemsOnPallet,
    palletSize: s.palletSize,
    stacksPerPallet: s.stacksPerPallet,
  }
}

/**
 * The specs as recorded in `Item Specs` rows 16:20, verbatim.
 *
 * Rows 21:24 (Zip Ties, Bungees, Nesting Blocks, Corners) exist in the sheet as
 * labels with no measurements, so they are deliberately absent here rather than
 * present with zeros — see difference 1 above.
 */
export const DEFAULT_ITEM_SPECS: ItemSpec[] = [
  {
    item: 'Tray Tops',
    weightLbs: 3.4,
    lengthIn: 25.75,
    widthIn: 18,
    heightIn: 3.5,
    stackedHeightIn: 2.48,
    maxItemsOnPallet: 125,
    palletSize: '48x40',
    stacksPerPallet: 4,
  },
  {
    item: 'Tray Bottoms',
    weightLbs: 3.6,
    lengthIn: 25.75,
    widthIn: 18,
    heightIn: 3.5,
    stackedHeightIn: 3.0,
    maxItemsOnPallet: 100,
    palletSize: '48x40',
    stacksPerPallet: 4,
  },
  {
    item: 'Cubee Tops',
    weightLbs: 10,
    lengthIn: 48,
    widthIn: 40,
    heightIn: 2,
    stackedHeightIn: 2,
    maxItemsOnPallet: 25,
    palletSize: '48x40',
    stacksPerPallet: 1,
  },
  {
    item: 'Cubee Bottoms',
    weightLbs: 10,
    lengthIn: 48,
    widthIn: 40,
    heightIn: 5,
    stackedHeightIn: 2.5,
    maxItemsOnPallet: 25,
    palletSize: '48x40',
    stacksPerPallet: 1,
  },
  {
    item: 'Anchors',
    weightLbs: 1.7,
    lengthIn: 21.5,
    widthIn: 3,
    heightIn: 0,
    stackedHeightIn: 0,
    maxItemsOnPallet: 300,
    palletSize: '48x40',
    stacksPerPallet: 1,
  },
]

// ═══════════════════════════════════════════════════════════════════════════
// Packing one line
// ═══════════════════════════════════════════════════════════════════════════

/** A line to ship: how many of what. */
export interface PackLine {
  item: string
  qty: number
  /**
   * Stacks on a pallet for THIS shipment, when it differs from the item’s
   * usual. Absent means use the spec.
   */
  stacksPerPallet?: number
}

/** The packing result for one line — `Shipping Calculator` columns D:L. */
/**
 * Height of the pallet itself, added under the goods.
 *
 * A carrier measures the outside of what it moves, deck included, and height
 * decides density, which decides freight class. A standard 48×40 wood pallet is
 * about 5.5 in; the workbook ignored it, which understated every pallet by
 * roughly the thickness of a deck board and could move a load a class.
 */
export const DEFAULT_PALLET_DECK_IN = 5.5

export interface PackedLine {
  item: string
  qty: number
  maxItemsOnPallet: number
  weightPerItemLbs: number
  /** qty ÷ maxItemsOnPallet, unrounded. Column G. */
  palletsExact: number
  /** Whole pallets — ROUNDUP(G). Column H. */
  pallets: number
  /** qty ÷ pallets — the AVERAGE per pallet. Column I. */
  itemsPerPallet: number
  /** Goods weight on one pallet, excluding the pallet itself. Column J. */
  weightPerPalletLbs: number
  /** Goods weight for the line. Column K. */
  totalWeightLbs: number
  /** Loaded height of one pallet, excluding the deck. Column L. */
  heightPerPalletIn: number
  /**
   * What a carrier would measure: goods plus the pallet deck, rounded up to the
   * inch. This is the height that goes on a bill of lading and into density.
   */
  outsideHeightIn: number
  /** Stacks actually used — the spec's default, or this shipment's override. */
  stacksPerPallet: number
}

/** An item that could not be packed because nothing is on file for it. */
export interface UnspeccedItem {
  item: string
  qty: number
  reason: string
}

/**
 * Pack one line against its spec.
 *
 * A zero or negative quantity packs to nothing rather than throwing — an
 * estimate line often sits at 0 while it's being filled in.
 */
export function packLine(line: PackLine, spec: ItemSpec, deckIn: number = DEFAULT_PALLET_DECK_IN): PackedLine {
  const qty = Math.max(0, line.qty)
  /*
   * Stacks are a decision made on the day, not a property of the item: the same
   * trays go four stacks high for a full trailer and two for a customer with a
   * low door. The spec's number is the usual answer, and the shipment can say
   * otherwise.
   */
  const stacksPerPallet = line.stacksPerPallet ?? spec.stacksPerPallet
  const palletsExact = spec.maxItemsOnPallet > 0 ? qty / spec.maxItemsOnPallet : 0
  const pallets = Math.ceil(palletsExact)
  const itemsPerPallet = pallets > 0 ? qty / pallets : 0
  const loose = spec.packMode === 'loose'
  /*
   * Containers ride on every pallet, so their weight is on every pallet — but
   * only in proportion to how full the last one is, the same way the goods are
   * spread. A half-empty pallet does not carry a full set of tubs.
   */
  const weightPerPalletLbs =
    itemsPerPallet * spec.weightLbs +
    (loose && spec.maxItemsOnPallet > 0
      ? (spec.containerTareLbs ?? 0) * (itemsPerPallet / spec.maxItemsOnPallet)
      : 0)
  /*
   * A stacked item derives its height; a loose one states it. Neither guesses:
   * a loose item with no stated height reports zero, which `packShipment`
   * already treats as a spec that cannot be quoted from.
   */
  const heightPerPalletIn = loose
    ? (pallets > 0 ? (spec.looseHeightIn ?? 0) : 0)
    : stacksPerPallet > 0
      ? (itemsPerPallet / stacksPerPallet) * spec.stackedHeightIn
      : 0
  // Rounded UP: a carrier measuring 81.4 in writes 82, and rounding down is how
  // a load gets reclassed at the terminal.
  const outsideHeightIn = heightPerPalletIn > 0 ? Math.ceil(heightPerPalletIn + deckIn) : 0

  return {
    item: spec.item,
    qty,
    maxItemsOnPallet: spec.maxItemsOnPallet,
    weightPerItemLbs: spec.weightLbs,
    palletsExact,
    pallets,
    itemsPerPallet,
    weightPerPalletLbs,
    totalWeightLbs: weightPerPalletLbs * pallets,
    heightPerPalletIn,
    outsideHeightIn,
    // Zero, not one: a loose item has no stacks, and reporting "1" would invite
    // somebody to change it on a freight quote and expect the height to move.
    stacksPerPallet: loose ? 0 : stacksPerPallet,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Packing a shipment
// ═══════════════════════════════════════════════════════════════════════════

export interface PackOptions {
  /**
   * Weight of one empty pallet, in pounds. 0 reproduces the workbook; a real
   * 48×40 wood pallet is 33–48 lb and the carrier bills it.
   */
  palletTareLbs?: number
  /** Pallet positions on one truck — `Shipping Calculator` K12 was 28. */
  maxPalletsPerTruck?: number
  /** Legal or practical stack limit, for the over-height check. */
  maxPalletHeightIn?: number
  /** Height of an empty pallet. Defaults to a 48×40 wood deck. */
  palletDeckHeightIn?: number
}

export interface PackedShipment {
  lines: PackedLine[]
  /** Items on the order with no spec on file — NOT counted in any total. */
  unspecced: UnspeccedItem[]
  totalPallets: number
  /** Goods only, matching the sheet's N3/N14. */
  netWeightLbs: number
  /** Goods + pallet decks — what the carrier weighs. */
  grossWeightLbs: number
  netWeightKg: number
  grossWeightKg: number
  /** Tallest loaded pallet, deck excluded. */
  tallestPalletIn: number
  /** Trucks needed at `maxPalletsPerTruck`, or null if no limit was given. */
  trucksRequired: number | null
  /** Anything that makes these numbers unsafe to quote from. */
  warnings: string[]
}

/**
 * Pack a whole shipment.
 *
 * Unknown items are collected into `unspecced` and excluded from the totals,
 * so a quote built on an incomplete spec table is visibly incomplete instead
 * of quietly light.
 */
export function packShipment(
  lines: readonly PackLine[],
  specs: readonly ItemSpec[] = DEFAULT_ITEM_SPECS,
  opts: PackOptions = {},
): PackedShipment {
  const { palletTareLbs = 0, maxPalletsPerTruck, maxPalletHeightIn } = opts
  const byName = new Map(specs.map((s) => [s.item, s]))

  const packed: PackedLine[] = []
  const unspecced: UnspeccedItem[] = []
  const warnings: string[] = []

  for (const line of lines) {
    if (line.qty <= 0) continue
    const spec = byName.get(line.item)
    if (!spec) {
      unspecced.push({
        item: line.item,
        qty: line.qty,
        reason: 'No weight or dimensions on file — excluded from pallet and weight totals.',
      })
      continue
    }
    if (spec.maxItemsOnPallet <= 0) {
      unspecced.push({
        item: line.item,
        qty: line.qty,
        reason: 'Spec says 0 items fit on a pallet — excluded from totals.',
      })
      continue
    }
    packed.push(packLine(line, spec, opts.palletDeckHeightIn ?? DEFAULT_PALLET_DECK_IN))
  }

  const totalPallets = packed.reduce((s, l) => s + l.pallets, 0)
  const netWeightLbs = packed.reduce((s, l) => s + l.totalWeightLbs, 0)
  const grossWeightLbs = netWeightLbs + totalPallets * palletTareLbs
  const tallestPalletIn = packed.reduce((m, l) => Math.max(m, l.heightPerPalletIn), 0)

  if (unspecced.length > 0) {
    const names = unspecced.map((u) => u.item).join(', ')
    warnings.push(
      `${unspecced.length} item type${unspecced.length === 1 ? '' : 's'} missing shipping specs (${names}). ` +
        'Pallet count and weight are understated — add specs before quoting freight.',
    )
  }
  if (palletTareLbs === 0 && totalPallets > 0) {
    warnings.push(
      'Pallet weight is set to 0, so this is goods weight only. A 48×40 wood pallet is 33–48 lb; ' +
        'the carrier will bill the gross.',
    )
  }
  if (maxPalletHeightIn != null && tallestPalletIn > maxPalletHeightIn) {
    warnings.push(
      `Tallest pallet is ${tallestPalletIn.toFixed(1)} in, over the ${maxPalletHeightIn} in limit.`,
    )
  }

  return {
    lines: packed,
    unspecced,
    totalPallets,
    netWeightLbs,
    grossWeightLbs,
    netWeightKg: netWeightLbs * LBS_PER_KG,
    grossWeightKg: grossWeightLbs * LBS_PER_KG,
    tallestPalletIn,
    trucksRequired:
      maxPalletsPerTruck && maxPalletsPerTruck > 0 ? Math.ceil(totalPallets / maxPalletsPerTruck) : null,
    warnings,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Freight bands
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A quoted freight price that applies up to a pallet count — the
 * `Tray Cost (TNT)` J4:L6 block, where 11 pallets cost $5,675 New Jersey to
 * Grassy Lake and 22 cost $7,650.
 */
export interface FreightBand {
  /** Highest pallet count this price covers. */
  maxPallets: number
  price: number
}

/**
 * Freight for `pallets`, from the cheapest band that fits.
 *
 * Returns null above the largest band rather than extrapolating — past the
 * quoted range the honest answer is "get a quote", not a number that looks
 * authoritative. The sheet's `if((C14+C15)<=11, K6, L6)` silently applied the
 * 22-pallet price to a 40-pallet load.
 */
export function freightFor(bands: readonly FreightBand[], pallets: number): number | null {
  const fits = [...bands].filter((b) => pallets <= b.maxPallets).sort((a, b) => a.maxPallets - b.maxPallets)
  return fits[0]?.price ?? null
}
