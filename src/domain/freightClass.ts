/**
 * Freight class from density — the number LTL carriers price on.
 *
 * A carrier does not bill by weight alone. Every shipment carries a class from
 * 50 (dense, cheap) to 500 (light, bulky), and 200 costs meaningfully more per
 * pound than 175. For most manufactured goods the class comes from an NMFC item
 * number for that commodity, and many of those items are "subject to density",
 * which is the calculation below.
 *
 * ── The honest caveat, which the app must show rather than hide ──────────────
 *
 * Density is not always the last word. TNT's own paperwork proves it: the Estes
 * bill of lading for 4,725 lb over 1,002 ft³ — 4.71 PCF, squarely in the 4–5
 * bracket that scales to 200 — was billed at **175**. Estes is applying either a
 * specific NMFC item for plastic articles or a negotiated exception on the
 * account.
 *
 * So this computes the scale answer and says so plainly, and `classNote` gives
 * the text the info button shows: here is your density, here is what the scale
 * says, here is why your carrier may say something else. The computed value is
 * a starting point that can be overridden per line, never a silent decision.
 */

/** Cubic inches in a cubic foot. */
const IN3_PER_FT3 = 1728

/**
 * The standard density scale, densest first.
 *
 * `min` is inclusive: a load at exactly 5.0 PCF is class 175, not 200. Carriers
 * and NMFTA publish this the same way, and the boundary matters — the trays sit
 * near 4.9 and a rounding difference would move them a whole class.
 */
export const DENSITY_SCALE: Array<{ min: number; freightClass: number }> = [
  { min: 50, freightClass: 50 },
  { min: 35, freightClass: 55 },
  { min: 30, freightClass: 60 },
  { min: 22.5, freightClass: 65 },
  { min: 15, freightClass: 70 },
  { min: 13.5, freightClass: 77.5 },
  { min: 12, freightClass: 85 },
  { min: 10.5, freightClass: 92.5 },
  { min: 9, freightClass: 100 },
  { min: 8, freightClass: 110 },
  { min: 7, freightClass: 125 },
  { min: 6, freightClass: 150 },
  { min: 5, freightClass: 175 },
  { min: 4, freightClass: 200 },
  { min: 3, freightClass: 250 },
  { min: 2, freightClass: 300 },
  { min: 1, freightClass: 400 },
  { min: 0, freightClass: 500 },
]

export interface DensityInput {
  /** Total weight of the handling units, INCLUDING pallets — carriers bill gross. */
  totalWeightLbs: number
  /** One handling unit's outside dimensions, in inches. */
  lengthIn: number
  widthIn: number
  heightIn: number
  /** How many of that handling unit. */
  units: number
}

export interface FreightClassResult {
  /** Cubic feet of the whole load. */
  cubicFeet: number
  /** Pounds per cubic foot. */
  density: number
  /** What the density scale says. */
  freightClass: number
  /** Null when the inputs cannot give a density. */
  problem: string | null
}

/** Cubic feet for one handling unit. */
export function cubicFeet(lengthIn: number, widthIn: number, heightIn: number): number {
  return (lengthIn * widthIn * heightIn) / IN3_PER_FT3
}

/** The class the standard density scale gives. */
export function classForDensity(density: number): number {
  if (!Number.isFinite(density) || density <= 0) return 500
  const band = DENSITY_SCALE.find((b) => density >= b.min)
  return band ? band.freightClass : 500
}

/**
 * Density and class for a load.
 *
 * Returns a `problem` rather than throwing or guessing: a missing dimension is
 * common on a half-entered order, and a class computed from a zero would be
 * 500 — the most expensive one there is — presented as though it were a fact.
 */
export function freightClassFor(input: DensityInput): FreightClassResult {
  const { totalWeightLbs, lengthIn, widthIn, heightIn, units } = input
  const empty = { cubicFeet: 0, density: 0, freightClass: 0 }

  if (![lengthIn, widthIn, heightIn].every((n) => Number.isFinite(n) && n > 0)) {
    return { ...empty, problem: 'Dimensions are missing, so density cannot be worked out.' }
  }
  if (!Number.isFinite(units) || units <= 0) {
    return { ...empty, problem: 'No handling units on this line.' }
  }
  if (!Number.isFinite(totalWeightLbs) || totalWeightLbs <= 0) {
    return { ...empty, problem: 'Weight is missing, so density cannot be worked out.' }
  }

  const cube = cubicFeet(lengthIn, widthIn, heightIn) * units
  const density = totalWeightLbs / cube
  return { cubicFeet: cube, density, freightClass: classForDensity(density), problem: null }
}

/**
 * The explanation behind an info button: the arithmetic, then the caveat.
 *
 * Written as sentences rather than a formula because the person reading it is
 * checking whether the number is defensible to a carrier, not recomputing it.
 */
export function classNote(result: FreightClassResult, override?: number | null): string[] {
  if (result.problem) return [result.problem, 'Fill in the weight and dimensions and the class works itself out.']

  const lines = [
    `This load is ${result.cubicFeet.toFixed(1)} cubic feet and ${Math.round(result.density * 100) / 100} lb per cubic foot.`,
    `On the standard density scale that is class ${result.freightClass}.`,
    'Carriers price by class, from 50 (dense) to 500 (bulky). A higher class costs more per pound.',
  ]

  if (override != null && override !== result.freightClass) {
    lines.push(
      `You have set this line to ${override}, which is what will print. That is normal when a carrier has ` +
        'given you a specific NMFC item or a negotiated class — TNT has been billed 175 on a 4.7 PCF load ' +
        'that this scale would call 200.',
    )
  } else {
    lines.push(
      'Your carrier may still class it differently: a specific NMFC item number for the commodity, or a ' +
        'negotiated rate, overrides the scale. Estes billed 175 on a 4.7 PCF load of these trays.',
    )
  }
  return lines
}
