/**
 * The Cole International "Pricing Quote Request — Freight" form, built from an
 * order instead of filled in by hand.
 *
 * TNT has been filling this by hand for every US shipment: the same shipper
 * block, the same contact, the same trays, re-copied each time from an invoice
 * that already holds most of it. Everything below that can come from the order
 * does; what remains is the handful of logistics answers that genuinely change
 * per shipment, and those are the form.
 *
 * ── What is computed, and from what ──────────────────────────────────────────
 *
 *   handling units, dimensions, weight   packing.ts, from the item specs
 *   freight class                        freightClass.ts, from density
 *   qty, HS code, origin, unit value     the order lines
 *   parties and contacts                 the customer and the company settings
 *
 * ── What is asked ────────────────────────────────────────────────────────────
 *
 * Pickup date, hours, and the appointment / dock / liftgate / residential flags
 * at both ends. Each of those changes the price and none can be derived: they
 * are facts about a place and a day.
 *
 * Every section carries a `help` key into `docHelp.ts`, so the form can explain
 * itself field by field — the person filling it in is the one who signs for it.
 */
import { classNote, freightClassFor, type FreightClassResult } from './freightClass'
import type { PackedShipment } from './packing'

export type YesNo = 'yes' | 'no' | ''

/**
 * The two freight answers that belong to an ITEM on THIS shipment.
 *
 * Stacks per pallet is the one that moves money. It is not a property of the
 * item — the same trays go four stacks high for a full trailer and two for a
 * customer whose door is low — and it sets the pallet height, which sets the
 * density, which sets the class. The item spec holds the usual answer and this
 * overrides it for one shipment.
 */
export interface ItemFreight {
  stacksPerPallet?: number
  stackable?: YesNo
}

/** The answers only a person can give. Stored per order. */
export interface QuoteLogistics {
  pickupDate: string
  pickupHours: string
  dropOffHours: string
  pickupApptRequired: YesNo
  dropApptRequired: YesNo
  pickupLoadingDock: YesNo
  dropLoadingDock: YesNo
  pickupLiftgate: YesNo
  dropLiftgate: YesNo
  residentialPickup: YesNo
  residentialDelivery: YesNo
  specialEquipment: string
  modeOfTransport: 'air' | 'ocean' | 'truck' | ''
  /** Keyed by the item's shipping name, so it survives a line being re-sorted. */
  perItem: Record<string, ItemFreight>
}

export const EMPTY_LOGISTICS: QuoteLogistics = {
  pickupDate: '',
  pickupHours: '8:00 AM – 5:00 PM',
  dropOffHours: '',
  pickupApptRequired: 'no',
  dropApptRequired: '',
  pickupLoadingDock: '',
  dropLoadingDock: '',
  pickupLiftgate: 'no',
  dropLiftgate: '',
  residentialPickup: 'no',
  residentialDelivery: '',
  specialEquipment: '',
  // Everything TNT has shipped on this form went by truck; it is still shown
  // and still editable, because an air quote is a different form of words.
  modeOfTransport: 'truck',
  perItem: {},
}

export interface QuoteParty {
  company: string
  address: string
  cityRegion: string
  postalCode: string
  contactName: string
  contactPhone: string
  contactEmail: string
}

/** One row of FREIGHT INFO on the form. */
export interface FreightRow {
  /** The shipping item this row packs — the key into the per-item answers. */
  item: string
  /** What prints in the description column. */
  description: string
  handlingUnitType: string
  units: number
  dimensions: string
  weightPerUnitLbs: number
  totalWeightLbs: number
  dgUn: string
  /** The carrier's NMFC item number, when one is on file. */
  nmfc: string
  /** Stacks used on each pallet — what makes the height what it is. */
  stacksPerPallet: number
  /** What will print — the override when there is one, else the computed. */
  freightClass: number | null
  /** Kept so the form can show the working and flag a disagreement. */
  computed: FreightClassResult
  overridden: boolean
  stackable: YesNo
  /** Sentences for the info button beside the class. */
  classExplanation: string[]
}

/** One row of COMMERCIAL INFO. */
export interface CommercialRow {
  partNumber: string
  description: string
  origin: string
  qty: number
  hsCode: string
  unitValue: number
  currency: string
  total: number
}

export interface FreightQuote {
  shipper: QuoteParty
  consignee: QuoteParty
  logistics: QuoteLogistics
  incoterm: string
  freight: FreightRow[]
  commercial: CommercialRow[]
  totals: { units: number; weightLbs: number; value: number }
  /** Things that would make the quote wrong, in the words of the person asking. */
  blockers: string[]
}

export interface QuoteInput {
  shipper: QuoteParty
  consignee: QuoteParty
  incoterm: string
  currency: string
  logistics: QuoteLogistics
  packing: PackedShipment
  /** Order lines, already matched to their packed line by item name. */
  lines: Array<{
    item: string
    partNumber?: string
    description: string
    qty: number
    hsCode?: string
    origin?: string
    unitValue: number
    /** Per-line class override; null uses the computed one. */
    freightClass?: number | null
    stackable?: YesNo
    dgUn?: string
    nmfc?: string
  }>
  /** Outside pallet dimensions, inches. Length and width are the deck. */
  palletLengthIn?: number
  palletWidthIn?: number
}

const DEFAULT_PALLET_L = 48
const DEFAULT_PALLET_W = 40

export function buildFreightQuote(input: QuoteInput): FreightQuote {
  const L = input.palletLengthIn ?? DEFAULT_PALLET_L
  const W = input.palletWidthIn ?? DEFAULT_PALLET_W

  const freight: FreightRow[] = []
  const commercial: CommercialRow[] = []

  for (const line of input.lines) {
    const packed = input.packing.lines.find((p) => p.item === line.item)
    if (packed) {
      const computed = freightClassFor({
        totalWeightLbs: packed.totalWeightLbs,
        lengthIn: L,
        widthIn: W,
        heightIn: packed.outsideHeightIn,
        units: packed.pallets,
      })
      const override = line.freightClass ?? null
      const per = input.logistics.perItem?.[line.item]
      freight.push({
        item: line.item,
        description: line.description || line.item,
        handlingUnitType: 'Pallet',
        units: packed.pallets,
        dimensions: packed.outsideHeightIn > 0 ? `${L}x${W}x${packed.outsideHeightIn}` : '',
        weightPerUnitLbs: Math.round(packed.weightPerPalletLbs),
        totalWeightLbs: Math.round(packed.totalWeightLbs),
        dgUn: line.dgUn ?? '',
        nmfc: line.nmfc ?? '',
        stacksPerPallet: packed.stacksPerPallet,
        freightClass: override ?? (computed.problem ? null : computed.freightClass),
        computed,
        overridden: override != null && override !== computed.freightClass,
        stackable: per?.stackable ?? line.stackable ?? '',
        classExplanation: classNote(computed, override),
      })
    }

    commercial.push({
      partNumber: line.partNumber ?? '',
      description: line.description || line.item,
      origin: line.origin ?? '',
      qty: line.qty,
      hsCode: line.hsCode ?? '',
      unitValue: line.unitValue,
      currency: input.currency,
      total: Math.round(line.qty * line.unitValue * 100) / 100,
    })
  }

  /*
   * Blockers, not warnings. Cole prices from this sheet, so a missing HS code
   * or a blank destination is not a formatting problem — it is a quote that
   * comes back wrong or comes back as a question.
   */
  const blockers: string[] = []
  if (!input.logistics.pickupDate) blockers.push('Pickup date — a quote is priced for a day.')
  if (!input.consignee.company || !input.consignee.cityRegion) {
    blockers.push('Destination address — the whole price depends on where it goes.')
  }
  if (!input.incoterm) blockers.push('Terms of sale (INCOTERM) — decides who is paying for this freight.')
  for (const c of commercial) {
    if (!c.hsCode) blockers.push(`HS code for ${c.description} — customs clears against it.`)
    if (!c.origin) blockers.push(`Country of origin for ${c.description}.`)
  }
  for (const u of input.packing.unspecced) {
    blockers.push(`${u.item} has no weight or dimensions on file, so it is missing from the freight table.`)
  }
  if (freight.length === 0) blockers.push('Nothing shippable on this order yet.')

  return {
    shipper: input.shipper,
    consignee: input.consignee,
    logistics: input.logistics,
    incoterm: input.incoterm,
    freight,
    commercial,
    totals: {
      units: freight.reduce((n, r) => n + r.units, 0),
      weightLbs: freight.reduce((n, r) => n + r.totalWeightLbs, 0),
      value: Math.round(commercial.reduce((n, r) => n + r.total, 0) * 100) / 100,
    },
    blockers,
  }
}
