/**
 * What each field on the shipping paperwork means, in plain words.
 *
 * Every section of these forms carries an info button, because the person
 * filling one in is signing for its accuracy and the terms are not obvious:
 * "freight class", "INCOTERM", "HS code" and "country of origin" are all things
 * a carrier or a border officer will hold you to.
 *
 * ── Written for the person, not the regulator ────────────────────────────────
 *
 * Each note says what the field is, where the app got its value, and what goes
 * wrong if it is wrong. That last part is the useful bit — "the carrier reweighs
 * and bills the difference" tells someone whether to check it, in a way that
 * "gross weight of the shipment" never does.
 *
 * Kept out of the components so the same words appear wherever a field does,
 * and so they can be read and corrected without hunting through JSX.
 */

export interface HelpNote {
  title: string
  /** Paragraphs. Short — this is read standing at a desk with a carrier waiting. */
  body: string[]
}

export const DOC_HELP: Record<string, HelpNote> = {
  shipper: {
    title: 'Shipper',
    body: [
      'Who the goods leave from — TNT, and the yard the carrier physically collects at.',
      'Filled from the company details in Users & Settings → Company. Change it there and it changes on every document rather than on this one.',
    ],
  },

  consignee: {
    title: 'Consignee',
    body: [
      'Who receives the goods, and the address the carrier delivers to.',
      'Filled from the customer on this order. If the delivery address differs from the billing address, fix it on the customer record — a carrier drives to what is printed here.',
    ],
  },

  pickupDate: {
    title: 'Pickup date',
    body: [
      'The day the carrier collects. A quote is priced for the day it is given; asking for a quote in May for an August pickup usually means re-quoting.',
    ],
  },

  incoterm: {
    title: 'Terms of sale (INCOTERM)',
    body: [
      'Where your responsibility for the goods ends and the buyer’s begins — and therefore who pays freight and who carries the risk in transit.',
      'FCA, which TNT has used, means you hand the goods to the carrier and the buyer takes it from there. It is a term of the SALE, so it must match what the customer agreed, not what suits the shipment.',
    ],
  },

  logistics: {
    title: 'Pickup and delivery conditions',
    body: [
      'Appointment, loading dock, liftgate and residential each change the price, and each one you get wrong turns into an accessorial charge after the fact.',
      'Liftgate is the one that bites: no dock at the far end and no liftgate on the truck means the driver cannot unload, and the load comes back.',
    ],
  },

  handlingUnits: {
    title: 'Handling units',
    body: [
      'What the carrier physically moves — pallets, not pieces. Eleven pallets holding 1,100 trays is eleven handling units.',
      'Worked out by the app from the item specs: how many fit a pallet, how tall they stack, what each weighs. Edit a spec in Sales → Catalogue and every future shipment follows.',
    ],
  },

  weight: {
    title: 'Weight',
    body: [
      'Gross weight, including the pallets themselves — carriers bill what crosses the scale, not what is in the box.',
      'Understating it is the most common reason a freight bill comes back higher than the quote: the terminal reweighs, and rebills the difference plus a fee.',
    ],
  },

  dimensions: {
    title: 'Dimensions',
    body: [
      'The outside of a loaded pallet, in inches — length × width × height, including the pallet deck.',
      'Height is the one that moves: the same trays stacked to 82 in instead of 50 in change the density, and with it the freight class and the price.',
    ],
  },

  freightClass: {
    title: 'Freight class',
    body: [
      'Carriers price by class, 50 to 500. Dense freight is cheap to haul and classes low; bulky freight classes high and costs more per pound.',
      'The app computes it from density — the load’s weight divided by its cubic feet — and you can type a different class over it.',
      'Your carrier may use a different one: a specific NMFC item number for the commodity, or a rate negotiated on your account, both beat the density scale. Estes billed 175 on a load of these trays that the scale calls 200, so the override is there for a reason.',
    ],
  },

  stackable: {
    title: 'Stackable',
    body: [
      'Whether the carrier may put freight on top of yours. Saying yes uses less of the trailer and costs less; saying no when it is not true gets the load crushed.',
    ],
  },

  dangerousGoods: {
    title: 'DG UN number',
    body: [
      'Only for regulated dangerous goods, which bee trays are not — leave it blank.',
      'If a shipment ever does carry something regulated, the carrier needs the UN number AND the safety data sheet before quoting, not after.',
    ],
  },

  hsCode: {
    title: 'HS code',
    body: [
      'The customs tariff code that decides the duty rate. TNT’s plastic trays go under 3926.90 — other plastic articles.',
      'Held on the product so every document uses the same code. A wrong code is a customs problem rather than a carrier one: the goods clear against it, and the importer pays whatever it says.',
    ],
  },

  countryOfOrigin: {
    title: 'Country of origin',
    body: [
      'Where the goods were made, which is not where they are shipping from. TNT’s trays are made in the USA and shipped from Alberta, so the origin is the USA on a form filled out in Canada.',
      'It decides whether a preferential rate under CUSMA can be claimed, so it is worth getting right rather than assuming.',
    ],
  },

  unitValue: {
    title: 'Unit value and total',
    body: [
      'What the goods are worth for customs — the price on the invoice, not what they cost you to make and not the freight.',
      'The border uses this to assess duty, so it must match the commercial invoice for the same shipment. The app takes both from the same order for that reason.',
    ],
  },

  broker: {
    title: 'Customs broker',
    body: [
      'Who clears the goods at the border. TNT uses Cole International, and the carrier needs to know that before the truck arrives — a shipment reaching the border with no broker named waits there.',
    ],
  },

  billingTerms: {
    title: 'Billing terms',
    body: [
      'Who the carrier invoices. Prepaid means TNT pays and usually rebills; collect means the consignee pays the carrier directly.',
      'It should follow from the INCOTERM. If the sale is FCA and the bill says prepaid, someone is paying for freight they did not agree to.',
    ],
  },
}

/** The note for a key, or null when a field has nothing worth explaining. */
export function helpFor(key: string): HelpNote | null {
  return DOC_HELP[key] ?? null
}
