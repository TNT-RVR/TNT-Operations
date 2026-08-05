/**
 * Product pricing math. Pure functions — no React, no DB.
 *
 * Ported from the "Sale Cost Calculator" workbook (copy dated Feb 6 2025),
 * which priced four products with the same shape but three different layouts:
 *
 *   Shelters Cost        — a per-unit bill of materials + labour + markup
 *   Tray Cost (TNT)      — a BOM plus ORDER-level costs (tooling setup, pallets,
 *                          freight) amortized across the order quantity
 *   Tray Cost (Customer) — the TNT cost with a second markup on top
 *   Corners Cost         — a per-foot rate chosen from volume tiers
 *
 * One model covers all four, so the empty `TNT Block Cost` and `Incubator Cost`
 * sheets can be filled in later without new code:
 *
 *   unit materials  = Σ (qty × unitCost + freightPerUnit)   ← the BOM
 *   unit build cost = materials + labour
 *   order overhead  = (setup + pallets + freight) ÷ quantity ← amortized
 *   unit cost       = build cost + order overhead
 *   sale price      = unit cost × (1 + markup), optionally rounded up
 *
 * ── Deliberate differences from the workbook ─────────────────────────────────
 *
 * 1. THE QUOTED PRICE IS THE DISPLAYED PRICE. `Shelters Cost` showed a rounded
 *    price in E15 ($180) but multiplied the UNROUNDED E14 ($179.3435…) into the
 *    quote — so a 150-shelter quote came out $98 below its own list price.
 *    Here `roundTo` is applied once, in `priceProduct`, and `extend()` bills
 *    exactly what was quoted.
 *
 * 2. VOLUME TIERS MATCH RANGES, NOT EXACT VALUES. `Corners Cost` used
 *    `IF(B3=H2,G2,IF(B3=H3,G3))`, which returns FALSE for any quantity that
 *    isn't exactly 8000 or 10000. `tierUnitPrice` picks the best tier whose
 *    threshold the quantity MEETS OR EXCEEDS, and returns the base rate below
 *    the first threshold.
 *
 * 3. MISSING COSTS ARE REPORTED, NOT TREATED AS ZERO. The shelter BOM had no
 *    unit cost on `3/4 in rivets` (14 per shelter) and $0 on `1/2 in. rivets`,
 *    so the build cost was understated with nothing to indicate it. A line with
 *    a null `unitCost` is surfaced by `pricingWarnings` instead of silently
 *    contributing $0.
 *
 * Money is carried as plain numbers in a single currency per product (the tray
 * sheets are USD, the shelter sheet CAD) — see `Money` and `convert`.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Currency
// ═══════════════════════════════════════════════════════════════════════════

export type Currency = 'CAD' | 'USD'

/** An amount that knows what currency it is in. */
export interface Money {
  amount: number
  currency: Currency
}

export const money = (amount: number, currency: Currency): Money => ({ amount, currency })

/**
 * Convert between currencies at an explicit rate.
 *
 * `rate` is units of `to` per one unit of `from` (0.73 turns CAD into USD).
 * Same-currency conversion ignores the rate entirely, so a missing or stale
 * rate can never corrupt a single-currency quote.
 */
export function convert(m: Money, to: Currency, rate: number): Money {
  if (m.currency === to) return m
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`convert: need a positive ${m.currency}→${to} rate, got ${rate}`)
  }
  return { amount: m.amount * rate, currency: to }
}

// ═══════════════════════════════════════════════════════════════════════════
// Bill of materials
// ═══════════════════════════════════════════════════════════════════════════

/**
 * One part line of a product's BOM — the `Shelters Cost` A2:E9 block.
 *
 * `freightPerUnit` is freight for THIS PART, per finished product, and is added
 * once per line rather than multiplied by `qty` — matching the sheet's
 * `=(B*C)+D`. On the shelter that reads as "$0.25 to get the two coroplast
 * sheets for one shelter here", not "$0.25 per sheet".
 */
export interface BomLine {
  /** Part name — also the join key to inventory and the supplier list. */
  part: string
  /** How many of this part go into ONE finished product. */
  qty: number
  /**
   * Cost of one part. `null` means "not costed yet" — reported by
   * `pricingWarnings` rather than quietly counted as free.
   */
  unitCost: number | null
  /** Freight for this part line, per finished product. */
  freightPerUnit: number
  /** Where the number came from, when it isn't a plain purchase price. */
  note?: string
}

/** Cost of one BOM line, per finished product. An uncosted line contributes 0. */
export function bomLineTotal(line: BomLine): number {
  return (line.unitCost ?? 0) * line.qty + line.freightPerUnit
}

/** Total materials cost for one finished product. */
export function materialsCost(bom: readonly BomLine[]): number {
  return bom.reduce((sum, l) => sum + bomLineTotal(l), 0)
}

// ═══════════════════════════════════════════════════════════════════════════
// Volume tiers
// ═══════════════════════════════════════════════════════════════════════════

/** A price break: at `minQty` or more, each unit costs `unitCost`. */
export interface PriceTier {
  minQty: number
  unitCost: number
}

/**
 * The unit cost that applies at `qty`.
 *
 * Picks the tier with the highest `minQty` that `qty` reaches. Below every
 * threshold, `base` applies. Unlike the sheet's exact-match `IF` chain, an
 * in-between quantity gets a real answer.
 */
export function tierUnitCost(tiers: readonly PriceTier[], qty: number, base: number): number {
  const applicable = tiers
    .filter((t) => qty >= t.minQty)
    .sort((a, b) => b.minQty - a.minQty)
  return applicable[0]?.unitCost ?? base
}

// ═══════════════════════════════════════════════════════════════════════════
// Order-level (amortized) costs
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Costs incurred ONCE for an order and spread across its units — the
 * `Tray Cost (TNT)` C20:C27 block.
 *
 * Tooling setup is the clearest case: $1,525 of dough/air/screen setup over 500
 * sets is $3.05 a set, and over 5,000 sets it is $0.305. Pricing a small order
 * off a big order's per-unit cost is how you lose money on the small one.
 */
export interface OrderCosts {
  /** One-time tooling/setup charges for the production run. */
  setup: number
  /** Pallets for the whole shipment. */
  pallets: number
  /** Freight for the whole shipment. */
  freight: number
}

export const NO_ORDER_COSTS: OrderCosts = { setup: 0, pallets: 0, freight: 0 }

/** Per-unit share of the order-level costs. Zero quantity spreads to zero. */
export function amortize(costs: OrderCosts, qty: number): number {
  if (!Number.isFinite(qty) || qty <= 0) return 0
  return (costs.setup + costs.pallets + costs.freight) / qty
}

// ═══════════════════════════════════════════════════════════════════════════
// Product spec + pricing
// ═══════════════════════════════════════════════════════════════════════════

/** Everything needed to price one product. */
export interface ProductSpec {
  /** Stable key — joins to inventory and the estimate lines. */
  sku: string
  name: string
  currency: Currency
  /** Parts consumed per finished unit. Empty for a bought-in resale item. */
  bom: BomLine[]
  /** Labour to build one unit. */
  labor: number
  /** Fraction, not percent: 0.5 is a 50% markup on cost. */
  markup: number
  /**
   * Round the sale price UP to this increment (the sheet's `ROUNDUP(x,-1)` is
   * `roundTo: 10`). `null` quotes the exact figure.
   */
  roundTo: number | null
  /**
   * Volume breaks on the UNIT COST, for products bought by the foot or the
   * thousand (corners). Empty for BOM-built products.
   */
  tiers?: PriceTier[]
  /** Unit of sale — 'each', 'ft', 'set'. Display and paperwork only. */
  unit: string
}

/** The full cost→price waterfall for one unit, so the UI can show its work. */
export interface UnitPrice {
  materials: number
  labor: number
  /** materials + labor */
  buildCost: number
  /** Per-unit share of setup + pallets + freight. */
  overhead: number
  /** buildCost + overhead — what the unit actually costs TNT. */
  unitCost: number
  markupAmount: number
  /** unitCost + markupAmount, before rounding. */
  exactPrice: number
  /** The price actually quoted and billed. */
  price: number
  currency: Currency
}

const EPSILON = 1e-9

/**
 * Round `value` UP to the nearest `step` — the sheet's `ROUNDUP(x, -1)`.
 *
 * The epsilon keeps a value that is already on the step from jumping a whole
 * increment because of float drift (a computed 180.0000000001 must stay 180,
 * not become 190).
 */
export function roundUpTo(value: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) return value
  return Math.ceil(value / step - EPSILON) * step
}

/**
 * Price one unit of `spec` for an order of `qty`.
 *
 * Quantity matters even for the per-unit figure: it selects the volume tier and
 * sets how thinly the order-level costs spread.
 */
export function priceUnit(spec: ProductSpec, qty: number, orderCosts: OrderCosts = NO_ORDER_COSTS): UnitPrice {
  const tiered = spec.tiers?.length
    ? tierUnitCost(spec.tiers, qty, materialsCost(spec.bom))
    : materialsCost(spec.bom)

  const materials = tiered
  const buildCost = materials + spec.labor
  const overhead = amortize(orderCosts, qty)
  const unitCost = buildCost + overhead
  const markupAmount = unitCost * spec.markup
  const exactPrice = unitCost + markupAmount
  const price = spec.roundTo == null ? exactPrice : roundUpTo(exactPrice, spec.roundTo)

  return {
    materials,
    labor: spec.labor,
    buildCost,
    overhead,
    unitCost,
    markupAmount,
    exactPrice,
    price,
    currency: spec.currency,
  }
}

/** A priced order line: unit economics plus the extended totals. */
export interface LinePrice extends UnitPrice {
  qty: number
  /** price × qty — what the customer is billed. */
  extended: number
  /** unitCost × qty — what it costs TNT. */
  extendedCost: number
  /** extended − extendedCost. */
  margin: number
  /** margin ÷ extended, or null on a zero-value line. */
  marginRate: number | null
}

/**
 * Extend a unit price across a quantity.
 *
 * Bills `price` — the rounded, quoted figure — so the invoice total always
 * reconciles with the unit price printed beside it.
 */
export function priceLine(spec: ProductSpec, qty: number, orderCosts: OrderCosts = NO_ORDER_COSTS): LinePrice {
  const unit = priceUnit(spec, qty, orderCosts)
  const extended = unit.price * qty
  const extendedCost = unit.unitCost * qty
  const margin = extended - extendedCost
  return {
    ...unit,
    qty,
    extended,
    extendedCost,
    margin,
    marginRate: extended === 0 ? null : margin / extended,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Order totals
// ═══════════════════════════════════════════════════════════════════════════

/**
 * An order-level amount added AFTER markup — freight, tariffs, brokerage.
 *
 * Freight lands in one of two places depending on how the product is sold, and
 * the workbook did both:
 *
 *   - Inside `OrderCosts` → amortized into unit cost, and therefore marked up.
 *     `Tray Cost (TNT)` C28 folds shipping into the per-set cost, which
 *     `Tray Cost (Customer)` then marks up 25%.
 *   - As an `OrderCharge` → passed through at cost. `Corners Cost` B10 is
 *     `((rate × qty) × 1.25) + 700`: the corners are marked up, the $700 of
 *     freight is not.
 *
 * Which one is right is a commercial decision per product, so both are
 * available and the choice is explicit rather than buried in a formula.
 */
export interface OrderCharge {
  label: string
  amount: number
  /** A pass-through charge is billed at cost and contributes no margin. */
  passThrough: boolean
}

export interface OrderTotals {
  currency: Currency
  /** Σ line extensions, before charges. */
  subtotal: number
  /** Σ charges. */
  charges: number
  /** subtotal + charges — what the customer owes. */
  total: number
  /** Σ line costs, plus any pass-through charge (which costs what it bills). */
  totalCost: number
  margin: number
  marginRate: number | null
}

/**
 * Sum priced lines and order charges.
 *
 * Throws on mixed currencies rather than adding them: a tray line in USD and a
 * shelter line in CAD have to be converted at a stated rate first, and a
 * silently wrong total on a cross-border invoice is a customs problem, not just
 * an accounting one.
 */
export function orderTotals(
  lines: readonly LinePrice[],
  charges: readonly OrderCharge[] = [],
): OrderTotals {
  const empty: OrderTotals = {
    currency: 'CAD',
    subtotal: 0,
    charges: 0,
    total: 0,
    totalCost: 0,
    margin: 0,
    marginRate: null,
  }
  if (lines.length === 0 && charges.length === 0) return empty

  const currency = lines[0]?.currency ?? 'CAD'
  const mixed = lines.find((l) => l.currency !== currency)
  if (mixed) {
    throw new Error(
      `orderTotals: cannot add ${mixed.currency} to ${currency} — convert the lines to one currency first`,
    )
  }

  const subtotal = lines.reduce((s, l) => s + l.extended, 0)
  const chargeTotal = charges.reduce((s, c) => s + c.amount, 0)
  const total = subtotal + chargeTotal

  // A pass-through charge is billed at what it cost, so it adds to both sides
  // and nets to zero margin. A marked-up charge adds only to the bill.
  const passThroughCost = charges.filter((c) => c.passThrough).reduce((s, c) => s + c.amount, 0)
  const totalCost = lines.reduce((s, l) => s + l.extendedCost, 0) + passThroughCost

  const margin = total - totalCost
  return {
    currency,
    subtotal,
    charges: chargeTotal,
    total,
    totalCost,
    margin,
    marginRate: total === 0 ? null : margin / total,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Warnings
// ═══════════════════════════════════════════════════════════════════════════

export interface PricingWarning {
  sku: string
  kind: 'uncosted-part' | 'zero-cost-part' | 'no-markup' | 'negative-margin'
  message: string
}

/**
 * Problems that make a quote untrustworthy.
 *
 * Every one of these was live in the workbook. The shelter BOM shipped with an
 * uncosted 14-per-unit rivet line and a $0 rivet line, which is exactly the
 * failure this catches: a price that looks precise and is quietly too low.
 */
export function pricingWarnings(spec: ProductSpec, priced?: LinePrice): PricingWarning[] {
  const out: PricingWarning[] = []

  for (const line of spec.bom) {
    if (line.unitCost == null) {
      out.push({
        sku: spec.sku,
        kind: 'uncosted-part',
        message: `"${line.part}" has no unit cost — ${line.qty} per unit are being counted as free.`,
      })
    } else if (line.unitCost === 0 && line.qty > 0) {
      out.push({
        sku: spec.sku,
        kind: 'zero-cost-part',
        message: `"${line.part}" is costed at $0. Confirm that's real and not a missing entry.`,
      })
    }
  }

  if (spec.markup <= 0) {
    out.push({ sku: spec.sku, kind: 'no-markup', message: 'No markup — this sells at or below cost.' })
  }
  if (priced && priced.margin < 0) {
    out.push({
      sku: spec.sku,
      kind: 'negative-margin',
      message: `Selling below cost by ${Math.abs(priced.margin).toFixed(2)} ${priced.currency}.`,
    })
  }

  return out
}
