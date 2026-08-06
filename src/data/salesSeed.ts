/**
 * Mock seed for the sales slice — the same rows migration 0015 seeds, so
 * `npm run dev` shows the real catalogue and customer list with no backend.
 *
 * Two omissions are deliberate and must stay:
 *
 *  - No item spec for Corners, Zip Ties, Bungees or Nesting Blocks. The
 *    workbook lists them with no measurements, and a row of zeros here would
 *    reproduce exactly the silent under-weighing the port exists to fix.
 *    `packShipment` reports them as `unspecced` instead.
 *  - The 3/4 in rivet BOM line is seeded UNCOSTED. 14 go into every shelter
 *    and the workbook never priced them, so every shelter quote is understated.
 *    Showing that is the point.
 */
import type {
  InventoryLevel,
  ItemSpecRow,
  Product,
  SalesCustomer,
  SalesOrder,
  Supplier,
} from './types'

export const SEED_ITEM_SPECS: ItemSpecRow[] = [
  { id: 'spec_tt', item: 'Tray Tops', weightLbs: 3.4, lengthIn: 25.75, widthIn: 18, heightIn: 3.5, stackedHeightIn: 2.48, maxItemsOnPallet: 125, palletSize: '48x40', stacksPerPallet: 4 },
  { id: 'spec_tb', item: 'Tray Bottoms', weightLbs: 3.6, lengthIn: 25.75, widthIn: 18, heightIn: 3.5, stackedHeightIn: 3.0, maxItemsOnPallet: 100, palletSize: '48x40', stacksPerPallet: 4 },
  { id: 'spec_ct', item: 'Cubee Tops', weightLbs: 10, lengthIn: 48, widthIn: 40, heightIn: 2, stackedHeightIn: 2, maxItemsOnPallet: 25, palletSize: '48x40', stacksPerPallet: 1 },
  { id: 'spec_cb', item: 'Cubee Bottoms', weightLbs: 10, lengthIn: 48, widthIn: 40, heightIn: 5, stackedHeightIn: 2.5, maxItemsOnPallet: 25, palletSize: '48x40', stacksPerPallet: 1 },
  { id: 'spec_an', item: 'Anchors', weightLbs: 1.7, lengthIn: 21.5, widthIn: 3, heightIn: 0, stackedHeightIn: 0, maxItemsOnPallet: 300, palletSize: '48x40', stacksPerPallet: 1 },
]

export const SEED_PRODUCTS: Product[] = [
  {
    id: 'prod_shelter',
    sku: 'shelter',
    name: 'Bee Shelter',
    currency: 'CAD',
    unit: 'each',
    labor: 20,
    markup: 0.5,
    roundTo: 10,
    shipItem: null,
    hsCode: null,
    countryOfOrigin: 'CA',
    active: true,
    notes: 'Shelters Cost sheet. 3/4 in rivets are UNCOSTED in the source workbook.',
    parts: [
      { id: 'pp_1', part: 'Coroplast Sheets', qty: 2, unitCost: 36.5, freightPerUnit: 0.25, note: '', sort: 1 },
      { id: 'pp_2', part: 'Pallet', qty: 1, unitCost: 10, freightPerUnit: 0.25, note: '', sort: 2 },
      { id: 'pp_3', part: 'Anchor', qty: 1, unitCost: 12, freightPerUnit: 0, note: '', sort: 3 },
      { id: 'pp_4', part: 'Zip Ties', qty: 4, unitCost: 0.11, freightPerUnit: 0.01, note: '', sort: 4 },
      { id: 'pp_5', part: 'Short Bungees (21 in)', qty: 2, unitCost: 0.7, freightPerUnit: 0.02, note: '', sort: 5 },
      { id: 'pp_6', part: 'Vinyl straps', qty: 2, unitCost: (2118.5 / 8100) * 4, freightPerUnit: 0, note: '$2,118.50 per 8,100 in roll, 4 in per strap', sort: 6 },
      { id: 'pp_7', part: '1/2 in. rivets', qty: 6, unitCost: 0, freightPerUnit: 0.1, note: 'Costed at $0 in the source workbook — confirm', sort: 7 },
      { id: 'pp_8', part: '3/4 in rivets', qty: 14, unitCost: null, freightPerUnit: 0, note: 'NO COST in the source workbook. 14 per shelter are currently free.', sort: 8 },
    ],
    tiers: [],
  },
  {
    id: 'prod_tray_set',
    sku: 'tray-set',
    name: 'Tray Set (top + bottom)',
    currency: 'USD',
    unit: 'set',
    labor: 0,
    markup: 0.25,
    roundTo: null,
    shipItem: null,
    hsCode: null,
    countryOfOrigin: 'CA',
    active: true,
    notes: 'Order-level setup/pallet/freight are entered per order and amortized.',
    parts: [
      { id: 'pt_1', part: 'Top (air)', qty: 1, unitCost: 13.5, freightPerUnit: 0, note: '', sort: 1 },
      { id: 'pt_2', part: 'Top screen', qty: 1, unitCost: 2, freightPerUnit: 0, note: '', sort: 2 },
      { id: 'pt_3', part: 'Screen assembly', qty: 1, unitCost: 10.29, freightPerUnit: 0, note: 'Connecticut path. Grassy Lake assembly removes this line.', sort: 3 },
      { id: 'pt_4', part: 'Bottom (dough)', qty: 1, unitCost: 12.5, freightPerUnit: 0, note: '', sort: 4 },
    ],
    tiers: [],
  },
  {
    id: 'prod_tray_top',
    sku: 'tray-top',
    name: 'Tray Top (air)',
    currency: 'USD',
    unit: 'each',
    labor: 0,
    markup: 0.25,
    roundTo: null,
    shipItem: 'Tray Tops',
    hsCode: null,
    countryOfOrigin: 'CA',
    active: true,
    notes: '',
    parts: [
      { id: 'ptt_1', part: 'Top (air)', qty: 1, unitCost: 13.5, freightPerUnit: 0, note: '', sort: 1 },
      { id: 'ptt_2', part: 'Top screen', qty: 1, unitCost: 2, freightPerUnit: 0, note: '', sort: 2 },
    ],
    tiers: [],
  },
  {
    id: 'prod_tray_bottom',
    sku: 'tray-bottom',
    name: 'Tray Bottom (dough)',
    currency: 'USD',
    unit: 'each',
    labor: 0,
    markup: 0.25,
    roundTo: null,
    shipItem: 'Tray Bottoms',
    hsCode: null,
    countryOfOrigin: 'CA',
    active: true,
    notes: '',
    parts: [{ id: 'ptb_1', part: 'Bottom (dough)', qty: 1, unitCost: 12.5, freightPerUnit: 0, note: '', sort: 1 }],
    tiers: [],
  },
  {
    id: 'prod_corners',
    sku: 'corners',
    name: 'Shelter Corners',
    currency: 'CAD',
    unit: 'ft',
    labor: 0,
    markup: 0.25,
    roundTo: null,
    shipItem: null,
    hsCode: null,
    countryOfOrigin: 'CA',
    active: true,
    notes: 'Freight is passed through at cost, not marked up.',
    parts: [],
    tiers: [
      { id: 'tier_1', minQty: 8000, unitCost: 0.72 },
      { id: 'tier_2', minQty: 10000, unitCost: 0.61 },
    ],
  },
]

const cust = (
  id: string,
  company: string,
  contactName: string,
  city: string,
  region: string,
  country: string,
  extra: Partial<SalesCustomer> = {},
): SalesCustomer => ({
  id,
  company,
  contactName,
  addressLines: [],
  city,
  region,
  postalCode: '',
  country,
  taxId: '',
  email: '',
  phone: '',
  gpsLink: '',
  notes: '',
  ...extra,
})

export const SEED_SALES_CUSTOMERS: SalesCustomer[] = [
  cust('cus_1', 'Palmer Ag Ventures', 'Braden Palmer', 'Carrot River', 'SK', 'CA', {
    addressLines: ['54 Railway Avenue'], postalCode: 'S0E 0L0',
    email: 'palmerbradenw@gmail.com', phone: '306-768-7469', notes: 'Ordered 100 trays in 2025',
  }),
  cust('cus_2', 'SD Custom Pollination Ltd.', 'Stuart Brummelhuis', 'Rosemary', 'AB', 'CA', {
    addressLines: ['528 Center St.'], postalCode: 'T0J 2W0',
    email: 'stuartbrummelhuis@gmail.com', phone: '403-427-1036', notes: 'Works with Dennis.',
  }),
  cust('cus_3', 'SD Custom Pollination Ltd.', 'Dennis Unruh', 'Rosemary', 'AB', 'CA', {
    addressLines: ['528 Center St.'], postalCode: 'T0J 2W0',
    email: 'dennisunruh@hotmail.ca', phone: '403-376-6667', notes: 'Works with Stuart.',
  }),
  cust('cus_4', 'Saddleridge Farming Co.', 'Jenn Retzlaff', 'Rosemary', 'AB', 'CA', {
    email: 'researchmanager@alfalfaseedab.com', phone: '403-793-4797',
    notes: 'Researcher and leafcutter producer near Brooks.',
  }),
  cust('cus_5', '', 'Chris Siemens', 'Hays', 'AB', 'CA', {
    email: 'chrissiemensfarm@gmail.com', phone: '403-654-0293', notes: 'Took some sample shelters',
  }),
  cust('cus_6', 'Watts Solitary Bees', 'Jim Watts', 'Ontario', 'OR', 'US', {
    addressLines: ['1347 NW Washington Ave'], postalCode: '97914', taxId: '75-3006708',
    email: 'rjmwatts@comcast.net', phone: '425-879-2337', notes: 'Took 50 sample shelters (2025)',
  }),
  cust('cus_7', 'M&S Buckley Farms', 'Alyson Buckley', 'Walla Walla', 'WA', 'US', {
    addressLines: ['763 Talbitt Road'], postalCode: '99362', taxId: '81-4440743',
    email: 'msbuckleyfarms@gmail.com', phone: '509-200-1183', notes: 'Bought 500 trays (2025)',
  }),
  cust('cus_8', 'Polinature', 'Gail MacInnis', '', 'QC', 'CA', {
    email: 'gail@pollinature.ca', phone: '438-995-7848', notes: 'Researcher',
  }),
  cust('cus_9', 'Slenders Farms', 'Brian Slenders', 'Scandia', 'AB', 'CA', {
    email: 'brian.slenders@eidnet.org', phone: '403-793-7887', notes: 'Took a couple sample shelters',
  }),
  cust('cus_10', '', 'Brendan Wiens', 'Rosemary', 'AB', 'CA', {
    email: 'brendan.wiens@hotmail.com', phone: '403-633-1950', notes: 'Took a couple sample shelters',
  }),
  cust('cus_11', 'Witdouk', 'Witdouk', '', '', 'CA', { notes: 'Interested in a couple trays' }),
  cust('cus_12', '', 'Cornell Ovinge', '', '', 'CA', { email: 'cornellovinge@hotmail.com' }),
  cust('cus_13', '', 'Jeff Friedman', '', 'SK', 'CA', {
    phone: '306-921-7426', gpsLink: 'https://maps.app.goo.gl/VyZ6raxx7CuMvd9j9', notes: 'Took a couple sample trays',
  }),
  cust('cus_14', 'Greer Farm', 'Jacob Greer', 'Marion', 'ND', 'US', {
    addressLines: ['5087 101st Ave SE'], postalCode: '58466',
    email: 'jacob.greer@hotmail.com', phone: '701-269-9808', notes: 'Interested in shelters and trays',
  }),
  cust('cus_15', '', 'Andy Wagman', 'Medicine Hat', 'AB', 'CA', {
    phone: '403-866-4220', notes: 'Interested in us pollinating, also in our equipment',
  }),
  cust('cus_16', '', 'Peter Lunguard', 'Peace River', 'AB', 'CA', {
    phone: '780-835-1765', notes: 'Interested in sample trays',
  }),
  cust('cus_17', 'Oj Finlinson', 'OJ Finlinson', 'Delta', 'UT', 'US', {
    addressLines: ['2250 W 500 N'], postalCode: '84624',
    email: 'ojfinlin@gmail.com', phone: '435-979-0528', notes: 'Interested in trays',
  }),
  cust('cus_18', 'DNH Farms Ltd.', 'Daryl Dyck', 'Rosemary', 'AB', 'CA', {
    email: 'dhdyck@eidnet.org', phone: '403-501-4521',
    gpsLink: 'https://maps.app.goo.gl/3mom3KtLhB8yqDUL8', notes: 'Bought 280 trays (2025)',
  }),
]

const sup = (
  id: string, part: string, forItem: string, company: string,
  contactName = '', email = '', phone = '', website = '', notes = '',
): Supplier => ({ id, part, forItem, company, contactName, email, phone, website, notes })

export const SEED_SUPPLIERS: Supplier[] = [
  sup('sup_1', 'Coroplast', 'Shelters', 'Polymer Shapes', 'Fraser Pittman', 'fpittman@polymershapes.com', '403 250 1670'),
  sup('sup_2', 'Pallets', 'Shelters', 'PSI- Polymer Solutions', 'Ryan Overcash', 'rovercash@prostack.com', '215 805 1544', '', 'Custom made pallet'),
  sup('sup_3', 'Anchors', 'Shelters', ''),
  sup('sup_4', 'Zip Ties', 'Shelters', 'Cable Ties and More', '', '', '1-877-284-7760', 'https://www.cabletiesandmore.ca/heavy-duty-black-zip-ties-uv'),
  sup('sup_5', 'Bungees', 'Shelters', 'Universal Polymer', 'Hiram Johnson', 'johnsonh@universalpolymer.com', '1-330-310-4604'),
  sup('sup_6', 'Straps', 'Shelters', 'Patio Furniture Rehab', '', '', '', 'https://www.patiofurniturerehab.com/product/bv1225/', '225 ft rolls at $38.75 USD'),
  sup('sup_7', 'Rivets', 'Shelters', 'Lawson Products', 'Travis Watson', '', '1-403-473-4606'),
  sup('sup_8', 'Corners', 'Corners', 'Barbour Plastics', 'Michael Casey', 'casey93@barbourplastics.com', '1-508-944-1757'),
  sup('sup_9', 'Moulding', 'TNT Blocks', 'Optimoule', 'Catherine and Serge Blanchet', 'cblanchet@optimoule.com', '418-281-2549'),
  sup('sup_10', 'Bees', 'Bees', '', 'Craig Newton'),
  sup('sup_11', 'Bees', 'Bees', '', 'Ryan Stewart'),
  sup('sup_12', 'Bees', 'Bees', '', 'Ron Weighill'),
  sup('sup_13', 'Bees', 'Bees', 'MR Pollination', 'Weldon Hobbs'),
  sup('sup_14', 'Bees', 'Bees', 'Mennie Bee Equipment', 'Wayne Mennie'),
  sup('sup_15', 'Bees', 'Bees', 'Tyler Pickering', 'Tyler Pickering'),
]

/** Empty by default — mock starts with a clean order book. */
export const SEED_SALES_ORDERS: SalesOrder[] = []

/**
 * Every product tracked from zero, so the Inventory screen lists the catalogue
 * on day one rather than showing an empty table.
 *
 * Reorder points are seeded on the two finished goods that actually sit in
 * stock, so the low-stock path is visible in mock without hand-setup.
 */
export function seedInventory(products: readonly Product[]): InventoryLevel[] {
  const REORDER: Record<string, number> = { shelter: 25, 'tray-set': 100 }
  const ON_HAND: Record<string, number> = { shelter: 40, 'tray-set': 620, 'tray-top': 310, 'tray-bottom': 295 }
  return products.map((p, i) => {
    const onHand = ON_HAND[p.sku] ?? 0
    return {
      id: `inv_${i}`,
      productId: p.id,
      onHand,
      reserved: 0,
      available: onHand,
      reorderPoint: REORDER[p.sku] ?? null,
      location: '',
      updatedAt: new Date().toISOString(),
    }
  })
}
