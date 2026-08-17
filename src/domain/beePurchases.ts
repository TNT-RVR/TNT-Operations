/**
 * Bee purchases: what was bought, how much of it, and what a gallon cost.
 *
 * ── Where the gallons come from ──────────────────────────────────────────────
 *
 * QuickBooks records the money. The VOLUME is only ever written into the line
 * description by whoever entered the bill — "Leafcutter bees 250 gal", "500
 * gallons", "300gal @ 41.00". There is no quantity field to rely on, so the
 * number has to be read out of prose.
 *
 * That makes one rule load-bearing: a line whose gallons cannot be read is
 * reported as UNKNOWN, never as zero. Cost per gallon is money ÷ gallons, so a
 * line silently counted as zero gallons keeps its dollars in the numerator and
 * contributes nothing to the denominator — which does not fail, it just quietly
 * inflates the price of every gallon in the season. A visible gap is worth far
 * more than a confident wrong number.
 */

/** One purchase line, from QuickBooks or entered by hand. */
export interface BeePurchase {
  id: string
  /** 'quickbooks' rows are synced and overwritten; 'manual' rows are yours. */
  source: 'quickbooks' | 'manual'
  /** QuickBooks transaction id, absent on manual rows. */
  qboId: string | null
  /** ISO date (YYYY-MM-DD). */
  date: string
  vendor: string
  description: string
  /** Null when the description carried no readable volume. NOT zero. */
  gallons: number | null
  amount: number
  currency: string
  /** Buying season this belongs to — see `seasonOf`. Overridable by hand. */
  season: number
  notes: string
}

// ── Reading gallons out of a description ─────────────────────────────────────

/**
 * Matches a number followed by a gallon unit: "250 gal", "500 gallons",
 * "300gal", "1,250 US gal", "62.5 Gallon".
 *
 * The unit is REQUIRED. A description contains prices, invoice numbers, lot
 * numbers and years; taking a bare number because it is the only one would be
 * right until the first line that mentions two.
 */
const GALLONS_RE = /(\d[\d,]*(?:\.\d+)?)\s*(?:us\s*)?gal(?:s|lon|lons)?\b/i

/**
 * Gallons stated in a description, or null if none is stated.
 *
 * When a description names a volume more than once — a split line, a corrected
 * entry — the values are SUMMED rather than the first one taken, because
 * "200 gal + 150 gal" is a single line for 350.
 */
export function parseGallons(description: string): number | null {
  const text = String(description ?? '')
  if (!text.trim()) return null

  let total = 0
  let found = false
  for (const m of text.matchAll(new RegExp(GALLONS_RE, 'gi'))) {
    const n = Number(m[1].replace(/,/g, ''))
    if (Number.isFinite(n) && n > 0) {
      total += n
      found = true
    }
  }
  return found ? total : null
}

// ── Seasons ──────────────────────────────────────────────────────────────────

/**
 * The buying season a date belongs to.
 *
 * Buying runs December through May, so a season STRADDLES the new year: bees
 * bought in December 2025 and in April 2026 are the same purchase run, and
 * grouping them by calendar year would split it in half — which is the one
 * thing this view exists to avoid.
 *
 * The season is named for the year it ends in, matching how a crew talks about
 * it. Anything from June onwards belongs to the season ahead, so an off-cycle
 * summer purchase lands with the run it will actually be used in rather than
 * the one already finished.
 */
export function seasonOf(isoDate: string): number {
  const [y, m] = String(isoDate).split('-').map(Number)
  if (!Number.isFinite(y) || !Number.isFinite(m)) return NaN
  return m >= 6 ? y + 1 : y
}

/** First and last date that fall in a season, inclusive. */
export function seasonRange(season: number): { from: string; to: string } {
  return { from: `${season - 1}-06-01`, to: `${season}-05-31` }
}

// ── Totals ───────────────────────────────────────────────────────────────────

export interface PurchaseTotals {
  /** Money spent, including lines whose volume is unknown. */
  amount: number
  /** Volume from lines that stated one. */
  gallons: number
  /** amount ÷ gallons, or null when nothing measurable was bought. */
  costPerGallon: number | null
  lines: number
  /** Lines whose description carried no readable volume. */
  unknownGallonLines: number
  /** Money on those lines — the part `costPerGallon` cannot account for. */
  unknownGallonAmount: number
}

/**
 * Roll up a set of lines.
 *
 * `costPerGallon` deliberately divides the FULL amount by the KNOWN gallons,
 * which is the honest reading of an incomplete set: every dollar was spent, and
 * we can only attribute the volume we can see. `unknownGallonAmount` says how
 * much of the total is riding on lines with no volume, so a reader can judge
 * whether the figure is trustworthy instead of taking it on faith.
 */
export function totalsFor(purchases: BeePurchase[]): PurchaseTotals {
  let amount = 0
  let gallons = 0
  let unknownGallonLines = 0
  let unknownGallonAmount = 0

  for (const p of purchases) {
    amount += p.amount
    if (p.gallons === null) {
      unknownGallonLines++
      unknownGallonAmount += p.amount
    } else {
      gallons += p.gallons
    }
  }

  return {
    amount,
    gallons,
    costPerGallon: gallons > 0 ? amount / gallons : null,
    lines: purchases.length,
    unknownGallonLines,
    unknownGallonAmount,
  }
}

export interface SeasonSummary extends PurchaseTotals {
  season: number
  purchases: BeePurchase[]
}

/** Group by season, newest first, each with its own totals. */
export function bySeason(purchases: BeePurchase[]): SeasonSummary[] {
  const groups = new Map<number, BeePurchase[]>()
  for (const p of purchases) {
    const key = Number.isFinite(p.season) ? p.season : seasonOf(p.date)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(p)
  }

  return [...groups.entries()]
    .map(([season, list]) => ({
      season,
      purchases: [...list].sort((a, b) => a.date.localeCompare(b.date)),
      ...totalsFor(list),
    }))
    .sort((a, b) => b.season - a.season)
}

/**
 * Season-by-season price, oldest first, for the chart.
 *
 * Seasons with no measurable volume are dropped rather than plotted at zero: a
 * zero on a price chart reads as "bees were free that year", which is worse
 * than a gap.
 */
export function pricePerGallonSeries(
  purchases: BeePurchase[],
): Array<{ season: number; costPerGallon: number; gallons: number; amount: number }> {
  return bySeason(purchases)
    .filter((s) => s.costPerGallon !== null)
    .map((s) => ({
      season: s.season,
      costPerGallon: s.costPerGallon as number,
      gallons: s.gallons,
      amount: s.amount,
    }))
    .sort((a, b) => a.season - b.season)
}

/**
 * Change in price per gallon against the previous season, as a fraction.
 * Null when there is nothing to compare against.
 */
export function priceChange(purchases: BeePurchase[]): { season: number; change: number } | null {
  const series = pricePerGallonSeries(purchases)
  if (series.length < 2) return null
  const last = series[series.length - 1]
  const prev = series[series.length - 2]
  if (prev.costPerGallon === 0) return null
  return { season: last.season, change: (last.costPerGallon - prev.costPerGallon) / prev.costPerGallon }
}
