-- ─────────────────────────────────────────────────────────────────────────────
-- TNT Operations — Sales: estimates, invoices, shipping paperwork, inventory.
--
-- Ports the "Sale Cost Calculator" workbook into the app. The math lives in
-- src/domain/{pricing,packing,salesDocs}.ts; this is where its inputs and its
-- output documents are stored.
--
-- Every table is prefixed `sales_` because this Supabase project is SHARED with
-- the legacy beetent-maps app (see CLAUDE.md). Nothing here collides.
--
-- ── Three decisions worth understanding before changing anything ─────────────
--
-- 1. ORDER LINES SNAPSHOT THEIR PRICING. `sales_order_lines` copies the unit
--    price, unit cost, HS code and origin at the moment the line is added, and
--    keeps only a soft reference to the product. Re-costing a BOM next season
--    must NOT silently restate an invoice that has already gone to a customer,
--    and a customs document has to keep saying what it said when it was filed.
--
-- 2. STOCK RESERVES ON INVOICE AND COMMITS ON SHIPMENT. Invoicing moves
--    quantity into `reserved`; marking the shipment moves it out of `on_hand`.
--    `available` is a generated column, so nothing can compute it differently.
--    Every change is journalled in `sales_stock_movements` — the counts are
--    derived from an audit trail rather than being an unexplained number.
--
-- 3. FINISHED GOODS ONLY. Raw parts (coroplast, rivets, bungees) live in
--    `sales_product_parts` as BOM lines for costing, and are deliberately NOT
--    stocked. Confirmed 2026-08-05. Adding parts inventory later means giving
--    `sales_inventory` a nullable `part` alongside `product_id`, not a new table.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
-- Catalogue
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.sales_products (
  id            uuid primary key default gen_random_uuid(),
  sku           text not null unique,
  name          text not null,
  currency      text not null default 'CAD' check (currency in ('CAD', 'USD')),
  -- Unit of sale: 'each', 'ft', 'set'. Prints on the paperwork.
  unit          text not null default 'each',

  labor         numeric not null default 0,
  -- A fraction, not a percent: 0.5 is a 50% markup on cost.
  markup        numeric not null default 0 check (markup > -1),
  -- Round the sale price UP to this increment. NULL quotes the exact figure.
  round_to      numeric check (round_to is null or round_to > 0),

  -- Joins to sales_item_specs.item for pallet/weight math. NULL for something
  -- that never ships on its own (a service line).
  ship_item     text,

  -- Customs facts. NULL is honest — salesDocs reports them missing rather than
  -- guessing, because a wrong HS code or origin is a misdeclaration.
  hs_code       text,
  country_of_origin text,

  active        boolean not null default true,
  notes         text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Bill of materials. `unit_cost` NULL means "not costed yet" and is surfaced by
-- pricingWarnings — the workbook's shelter BOM shipped with an uncosted
-- 14-per-unit rivet line, which understated every shelter quote.
create table if not exists public.sales_product_parts (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.sales_products (id) on delete cascade,
  part          text not null,
  qty           numeric not null default 1,
  unit_cost     numeric,
  -- Freight for this part line, per FINISHED unit — the sheet's =(B*C)+D adds
  -- it once per line, not per part.
  freight_per_unit numeric not null default 0,
  note          text not null default '',
  sort          integer not null default 0
);
create index if not exists sales_product_parts_product_idx
  on public.sales_product_parts (product_id, sort);

-- Volume breaks, for goods sold by the foot or the thousand (corners).
create table if not exists public.sales_price_tiers (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.sales_products (id) on delete cascade,
  min_qty       numeric not null,
  unit_cost     numeric not null,
  unique (product_id, min_qty)
);

-- The `Item Specs` sheet. Imperial is the source of truth; metric is derived in
-- the app so the two can never disagree.
create table if not exists public.sales_item_specs (
  id            uuid primary key default gen_random_uuid(),
  item          text not null unique,
  weight_lbs    numeric not null,
  length_in     numeric not null default 0,
  width_in      numeric not null default 0,
  height_in     numeric not null default 0,
  -- Height each NESTED item adds. Differs from height_in a lot on trays
  -- (3.5 in standing, 2.48 in nested) and using the wrong one over-heights a load.
  stacked_height_in numeric not null default 0,
  max_items_on_pallet integer not null check (max_items_on_pallet > 0),
  pallet_size   text not null default '48x40',
  stacks_per_pallet integer not null default 1 check (stacks_per_pallet > 0),
  updated_at    timestamptz not null default now()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- Parties
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.sales_customers (
  id            uuid primary key default gen_random_uuid(),
  company       text not null default '',
  contact_name  text not null default '',
  address_lines text[] not null default '{}',
  city          text not null default '',
  region        text not null default '',
  postal_code   text not null default '',
  -- ISO 3166-1 alpha-2. Drives which paperwork a shipment needs.
  country       text not null default 'CA',
  -- BN (Canada) or EIN (US) — the `Customers` sheet's EIN/BN column.
  tax_id        text not null default '',
  email         text not null default '',
  phone         text not null default '',
  gps_link      text not null default '',
  notes         text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.sales_suppliers (
  id            uuid primary key default gen_random_uuid(),
  part          text not null default '',
  -- Which product the part feeds — the sheet's "For Which Item".
  for_item      text not null default '',
  company       text not null default '',
  contact_name  text not null default '',
  email         text not null default '',
  phone         text not null default '',
  website       text not null default '',
  notes         text not null default '',
  created_at    timestamptz not null default now()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- Estimates and invoices
-- ═══════════════════════════════════════════════════════════════════════════

-- One table for both. An estimate that is accepted spawns a NEW invoice row
-- linked by `from_estimate_id`, rather than mutating in place — the quote and
-- the bill are separate documents and both need to survive.
create table if not exists public.sales_orders (
  id            uuid primary key default gen_random_uuid(),
  number        text not null unique,
  kind          text not null check (kind in ('estimate', 'invoice')),
  status        text not null default 'draft'
                  check (status in ('draft', 'sent', 'accepted', 'declined',
                                    'invoiced', 'shipped', 'paid', 'void')),
  from_estimate_id uuid references public.sales_orders (id) on delete set null,

  customer_id   uuid references public.sales_customers (id) on delete restrict,

  currency      text not null default 'CAD' check (currency in ('CAD', 'USD')),
  -- Rate used if the order was converted from another currency. Recorded so an
  -- old invoice can be re-read at the rate it was actually written at.
  fx_rate       numeric check (fx_rate is null or fx_rate > 0),

  issued_date   date not null default current_date,
  due_date      date,
  po_number     text not null default '',

  -- Customs / freight terms. All nullable: salesDocs reports what's missing.
  incoterm      text,
  incoterm_place text not null default '',
  payment_terms text not null default '',
  transport_mode text check (transport_mode is null
                    or transport_mode in ('road', 'rail', 'air', 'marine', 'courier')),
  place_of_direct_shipment text not null default '',
  country_of_transhipment text not null default '',
  reason_for_export text not null default '',
  date_of_direct_shipment date,

  carrier       text not null default '',
  freight_terms text check (freight_terms is null
                  or freight_terms in ('prepaid', 'collect', 'third-party')),
  declared_value numeric,
  special_instructions text not null default '',

  -- CUSMA certification. Only generated when certifier_role is set — a
  -- certification is a legal representation and nobody should find one in
  -- their packet by default.
  certifier_role text check (certifier_role is null
                    or certifier_role in ('importer', 'exporter', 'producer')),
  producer      text not null default '',
  signatory_name text not null default '',
  signatory_title text not null default '',

  notes         text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists sales_orders_customer_idx on public.sales_orders (customer_id);
create index if not exists sales_orders_kind_status_idx on public.sales_orders (kind, status);

-- Priced lines. See decision 1 at the top: these are a SNAPSHOT.
create table if not exists public.sales_order_lines (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.sales_orders (id) on delete cascade,
  -- Soft reference: the catalogue can change or a product be retired without
  -- rewriting history, so this is `set null`, never a cascade.
  product_id    uuid references public.sales_products (id) on delete set null,

  description   text not null,
  qty           numeric not null default 0,
  unit          text not null default 'each',

  -- Frozen at the moment the line was priced.
  unit_price    numeric not null default 0,
  unit_cost     numeric not null default 0,
  extended      numeric not null default 0,

  hs_code       text,
  country_of_origin text,
  origin_criterion text check (origin_criterion is null
                      or origin_criterion in ('A', 'B', 'C', 'D')),

  -- Which sales_item_specs.item this line packs as, frozen alongside the price.
  ship_item     text,

  sort          integer not null default 0
);
create index if not exists sales_order_lines_order_idx on public.sales_order_lines (order_id, sort);

-- Freight, tariffs, brokerage — amounts that aren't goods.
create table if not exists public.sales_order_charges (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.sales_orders (id) on delete cascade,
  label         text not null,
  amount        numeric not null default 0,
  -- Billed at cost (no margin). The workbook did both: tray freight was marked
  -- up, corners freight was passed through.
  pass_through  boolean not null default true,
  -- Transport/insurance from the place of direct shipment — CI1 box 23 has to
  -- break this out of the invoice total.
  is_transport_to_border boolean not null default false,
  sort          integer not null default 0
);
create index if not exists sales_order_charges_order_idx on public.sales_order_charges (order_id, sort);

-- ═══════════════════════════════════════════════════════════════════════════
-- Shipments
-- ═══════════════════════════════════════════════════════════════════════════

-- Marking a shipment is what COMMITS the stock draw-down. The packing figures
-- are frozen here so the paperwork keeps matching what actually went on the
-- truck, even if a spec is corrected afterwards.
create table if not exists public.sales_shipments (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.sales_orders (id) on delete cascade,
  shipped_at    timestamptz not null default now(),
  carrier       text not null default '',
  tracking      text not null default '',
  pallet_count  integer,
  net_weight_lbs numeric,
  gross_weight_lbs numeric,
  notes         text not null default '',
  created_at    timestamptz not null default now()
);
create index if not exists sales_shipments_order_idx on public.sales_shipments (order_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- Inventory — finished goods
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.sales_inventory (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null unique references public.sales_products (id) on delete cascade,
  on_hand       numeric not null default 0,
  -- Spoken for by an invoice that hasn't shipped. Never negative: releasing
  -- more than was reserved is a bug, and the constraint says so loudly.
  reserved      numeric not null default 0 check (reserved >= 0),
  -- What can still be promised. Generated so no caller can compute it
  -- differently from any other caller.
  available     numeric generated always as (on_hand - reserved) stored,
  -- Below this, raise a low_stock notification. NULL disables the alert.
  reorder_point numeric,
  location      text not null default '',
  updated_at    timestamptz not null default now()
);

-- Why every count is what it is. Inventory is an audit trail with a running
-- total, not a number somebody typed.
create table if not exists public.sales_stock_movements (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.sales_products (id) on delete cascade,
  -- Signed: +50 received, −20 shipped.
  delta         numeric not null,
  reason        text not null check (reason in
                  ('receive', 'ship', 'adjust', 'reserve', 'release', 'count', 'build')),
  order_id      uuid references public.sales_orders (id) on delete set null,
  note          text not null default '',
  at            timestamptz not null default now(),
  by_user       uuid references public.profiles (id) on delete set null
);
create index if not exists sales_stock_movements_product_idx
  on public.sales_stock_movements (product_id, at desc);
create index if not exists sales_stock_movements_order_idx on public.sales_stock_movements (order_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- Low-stock alerts
-- ═══════════════════════════════════════════════════════════════════════════

-- Fires when AVAILABLE crosses below the reorder point — on the crossing only,
-- not on every subsequent write. Without the "was above before" test, every
-- shipment of an already-low product would raise another notification and the
-- bell would be useless within a week.
create or replace function public.fn_sales_low_stock_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  prod record;
begin
  if new.reorder_point is null then return new; end if;
  if new.available >= new.reorder_point then return new; end if;
  -- Only on the downward crossing.
  if tg_op = 'UPDATE' and old.reorder_point is not null and old.available < old.reorder_point then
    return new;
  end if;

  select sku, name into prod from public.sales_products where id = new.product_id;

  insert into public.app_notifications (category, type, severity, title, body, source)
  values (
    'inventory',
    'low_stock',
    case when new.available <= 0 then 'critical' else 'warning' end,
    'Low stock: ' || coalesce(prod.name, 'product'),
    coalesce(prod.sku, '') || ' — ' || new.available || ' available' ||
      ' (reorder at ' || new.reorder_point || ')' ||
      case when new.reserved > 0 then ', ' || new.reserved || ' reserved' else '' end,
    'inventory');
  return new;
end; $$;

drop trigger if exists sales_low_stock_notify on public.sales_inventory;
create trigger sales_low_stock_notify after insert or update on public.sales_inventory
  for each row execute function public.fn_sales_low_stock_notify();

-- ═══════════════════════════════════════════════════════════════════════════
-- updated_at
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare t text;
begin
  foreach t in array array['sales_products', 'sales_customers', 'sales_orders',
                           'sales_inventory', 'sales_item_specs'] loop
    execute format('drop trigger if exists %I_touch_updated_at on public.%I;', t, t);
    execute format(
      'create trigger %I_touch_updated_at before update on public.%I
         for each row execute function public.touch_updated_at();', t, t);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS — mirrors the MODULES matrix: members read, editors write.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare t text;
begin
  foreach t in array array[
    'sales_products', 'sales_product_parts', 'sales_price_tiers', 'sales_item_specs',
    'sales_customers', 'sales_suppliers', 'sales_orders', 'sales_order_lines',
    'sales_order_charges', 'sales_shipments', 'sales_inventory', 'sales_stock_movements'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "read for members" on public.%I;', t);
    execute format('create policy "read for members" on public.%I for select using (has_access());', t);
    execute format('drop policy if exists "write for editors" on public.%I;', t);
    execute format(
      'create policy "write for editors" on public.%I for all using (can_edit()) with check (can_edit());', t);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Seed: the workbook's own reference data
-- ═══════════════════════════════════════════════════════════════════════════

-- Item Specs rows 16:20. Zip Ties, Bungees, Nesting Blocks and Corners are
-- deliberately ABSENT — the sheet lists them with no measurements, and a row of
-- zeros here would reproduce exactly the silent under-weighing the port fixes.
-- Add them when someone weighs one.
insert into public.sales_item_specs
  (item, weight_lbs, length_in, width_in, height_in, stacked_height_in,
   max_items_on_pallet, pallet_size, stacks_per_pallet)
values
  ('Tray Tops',     3.4, 25.75, 18, 3.5, 2.48, 125, '48x40', 4),
  ('Tray Bottoms',  3.6, 25.75, 18, 3.5, 3.00, 100, '48x40', 4),
  ('Cubee Tops',   10.0, 48,    40, 2.0, 2.00,  25, '48x40', 1),
  ('Cubee Bottoms',10.0, 48,    40, 5.0, 2.50,  25, '48x40', 1),
  ('Anchors',       1.7, 21.5,   3, 0.0, 0.00, 300, '48x40', 1)
on conflict (item) do nothing;

-- Suppliers, from the `Suppliers` sheet.
insert into public.sales_suppliers (part, for_item, company, contact_name, email, phone, website, notes)
values
  ('Coroplast', 'Shelters', 'Polymer Shapes', 'Fraser Pittman', 'fpittman@polymershapes.com', '403 250 1670',
   'https://www.polymershapes.com/product/polypropylene-twinwall-corrugated-plastic/', ''),
  ('Pallets', 'Shelters', 'PSI- Polymer Solutions', 'Ryan Overcash', 'rovercash@prostack.com', '215 805 1544',
   '', 'Custom made pallet'),
  ('Anchors', 'Shelters', '', '', '', '', '', ''),
  ('Zip Ties', 'Shelters', 'Cable Ties and More', '', '', '1-877-284-7760',
   'https://www.cabletiesandmore.ca/heavy-duty-black-zip-ties-uv', ''),
  ('Bungees', 'Shelters', 'Universal Polymer', 'Hiram Johnson', 'johnsonh@universalpolymer.com',
   '1-330-310-4604', '', ''),
  ('Straps', 'Shelters', 'Patio Furniture Rehab', '', '', '',
   'https://www.patiofurniturerehab.com/product/bv1225/', '225 ft rolls at $38.75 USD'),
  ('Rivets', 'Shelters', 'Lawson Products', 'Travis Watson', '', '1-403-473-4606', '', ''),
  ('Corners', 'Corners', 'Barbour Plastics', 'Michael Casey', 'casey93@barbourplastics.com',
   '1-508-944-1757', '', ''),
  ('Moulding', 'TNT Blocks', 'Optimoule', 'Catherine and Serge Blanchet', 'cblanchet@optimoule.com',
   '418-281-2549', '', ''),
  ('Bees', 'Bees', '', 'Craig Newton', '', '', '', ''),
  ('Bees', 'Bees', '', 'Ryan Stewart', '', '', '', ''),
  ('Bees', 'Bees', '', 'Ron Weighill', '', '', '', ''),
  ('Bees', 'Bees', 'MR Pollination', 'Weldon Hobbs', '', '', '', ''),
  ('Bees', 'Bees', 'Mennie Bee Equipment', 'Wayne Mennie', '', '', '', ''),
  ('Bees', 'Bees', 'Tyler Pickering', 'Tyler Pickering', '', '', '', '')
on conflict do nothing;

-- Customers, from the `Customers` sheet. Country is inferred from the address
-- as written; the two US customers already carry their EIN.
insert into public.sales_customers
  (company, contact_name, address_lines, city, region, postal_code, country, tax_id, email, phone, gps_link, notes)
values
  ('Palmer Ag Ventures', 'Braden Palmer', array['54 Railway Avenue'], 'Carrot River', 'SK', 'S0E 0L0', 'CA', '',
   'palmerbradenw@gmail.com', '306-768-7469', '', 'Ordered 100 trays in 2025'),
  ('SD Custom Pollination Ltd.', 'Stuart Brummelhuis', array['528 Center St.'], 'Rosemary', 'AB', 'T0J 2W0', 'CA', '',
   'stuartbrummelhuis@gmail.com', '403-427-1036', '', 'Works with Dennis. Bought shelters, taking another 50.'),
  ('SD Custom Pollination Ltd.', 'Dennis Unruh', array['528 Center St.'], 'Rosemary', 'AB', 'T0J 2W0', 'CA', '',
   'dennisunruh@hotmail.ca', '403-376-6667', '', 'Works with Stuart.'),
  ('Saddleridge Farming Co.', 'Jenn Retzlaff', array[]::text[], 'Rosemary', 'AB', '', 'CA', '',
   'researchmanager@alfalfaseedab.com', '403-793-4797', '',
   'Researcher and leafcutter producer near Brooks. Wants to try shelters and trays (2025)'),
  ('', 'Chris Siemens', array[]::text[], 'Hays', 'AB', '', 'CA', '',
   'chrissiemensfarm@gmail.com', '403-654-0293', '', 'Took some sample shelters'),
  ('Watts Solitary Bees', 'Jim Watts', array['1347 NW Washington Ave'], 'Ontario', 'OR', '97914', 'US', '75-3006708',
   'rjmwatts@comcast.net', '425-879-2337', '', 'Took 50 sample shelters (2025)'),
  ('M&S Buckley Farms', 'Alyson Buckley', array['763 Talbitt Road'], 'Walla Walla', 'WA', '99362', 'US', '81-4440743',
   'msbuckleyfarms@gmail.com', '509-200-1183', '', 'Bought 500 trays (2025)'),
  ('Polinature', 'Gail MacInnis', array[]::text[], '', 'QC', '', 'CA', '',
   'gail@pollinature.ca', '438-995-7848', '', 'Researcher, has bought shelters in the past'),
  ('Slenders Farms', 'Brian Slenders', array[]::text[], 'Scandia', 'AB', '', 'CA', '',
   'brian.slenders@eidnet.org', '403-793-7887', '', 'Took a couple sample shelters'),
  ('', 'Brendan Wiens', array[]::text[], 'Rosemary', 'AB', '', 'CA', '',
   'brendan.wiens@hotmail.com', '403-633-1950', '', 'Took a couple sample shelters'),
  ('Witdouk', 'Witdouk', array[]::text[], '', '', '', 'CA', '', '', '', '', 'Interested in a couple trays'),
  ('', 'Cornell Ovinge', array[]::text[], '', '', '', 'CA', '', 'cornellovinge@hotmail.com', '', '', ''),
  ('', 'Jeff Friedman', array[]::text[], '', 'SK', '', 'CA', '', '', '306-921-7426',
   'https://maps.app.goo.gl/VyZ6raxx7CuMvd9j9', 'Took a couple sample trays'),
  ('Greer Farm', 'Jacob Greer', array['5087 101st Ave SE'], 'Marion', 'ND', '58466', 'US', '',
   'jacob.greer@hotmail.com', '701-269-9808', '', 'Interested in trying shelters and trays'),
  ('', 'Andy Wagman', array[]::text[], 'Medicine Hat', 'AB', '', 'CA', '', '', '403-866-4220', '',
   'Interested in us pollinating, also in getting started with our equipment'),
  ('', 'Peter Lunguard', array[]::text[], 'Peace River', 'AB', '', 'CA', '', '', '780-835-1765', '',
   'Interested in sample trays'),
  ('Oj Finlinson', 'OJ Finlinson', array['2250 W 500 N'], 'Delta', 'UT', '84624', 'US', '',
   'ojfinlin@gmail.com', '435-979-0528', '', 'Interested in trays'),
  ('DNH Farms Ltd.', 'Daryl Dyck', array[]::text[], 'Rosemary', 'AB', '', 'CA', '',
   'dhdyck@eidnet.org', '403-501-4521', 'https://maps.app.goo.gl/3mom3KtLhB8yqDUL8', 'Bought 280 trays (2025)')
on conflict do nothing;

-- ── Products ────────────────────────────────────────────────────────────────
-- Costs are as the workbook had them on Feb 6 2025, INCLUDING the two broken
-- rivet lines: the 3/4 in rivets are left uncosted rather than invented, so the
-- app flags them for a real number instead of quietly shipping a wrong one.

insert into public.sales_products (sku, name, currency, unit, labor, markup, round_to, ship_item, country_of_origin, notes)
values
  ('shelter', 'Bee Shelter', 'CAD', 'each', 20, 0.50, 10, null, 'CA',
   'Shelters Cost sheet. 3/4 in rivets are UNCOSTED in the source workbook — price is understated until that is filled in.'),
  ('tray-set', 'Tray Set (top + bottom)', 'USD', 'set', 0, 0.25, null, null, 'CA',
   'Tray Cost sheets. Order-level setup/pallet/freight costs are entered per order and amortized.'),
  ('tray-top', 'Tray Top (air)', 'USD', 'each', 0, 0.25, null, 'Tray Tops', 'CA', ''),
  ('tray-bottom', 'Tray Bottom (dough)', 'USD', 'each', 0, 0.25, null, 'Tray Bottoms', 'CA', ''),
  ('corners', 'Shelter Corners', 'CAD', 'ft', 0, 0.25, null, null, 'CA',
   'Corners Cost sheet. Freight is passed through at cost, not marked up.')
on conflict (sku) do nothing;

insert into public.sales_product_parts (product_id, part, qty, unit_cost, freight_per_unit, note, sort)
select p.id, v.part, v.qty, v.unit_cost, v.freight, v.note, v.sort
from public.sales_products p
join (values
  ('shelter', 'Coroplast Sheets',      2::numeric, 36.5::numeric,  0.25::numeric, '', 1),
  ('shelter', 'Pallet',                1,          10.0,           0.25,          '', 2),
  ('shelter', 'Anchor',                1,          12.0,           0.00,          '', 3),
  ('shelter', 'Zip Ties',              4,           0.11,          0.01,          '', 4),
  ('shelter', 'Short Bungees (21 in)', 2,           0.70,          0.02,          '', 5),
  ('shelter', 'Vinyl straps',          2,           1.046172839,   0.00,
   '$2,118.50 per 8,100 in roll, 4 in per strap', 6),
  ('shelter', '1/2 in. rivets',        6,           0.00,          0.10,
   'Costed at $0 in the source workbook — confirm', 7),
  ('shelter', '3/4 in rivets',        14,           null,          0.00,
   'NO COST in the source workbook. 14 per shelter are currently free.', 8),
  ('tray-set', 'Top (air)',            1,          13.50,          0.00,          '', 1),
  ('tray-set', 'Top screen',           1,           2.00,          0.00,          '', 2),
  ('tray-set', 'Screen assembly',      1,          10.29,          0.00,
   'Connecticut path. Grassy Lake assembly removes this line.', 3),
  ('tray-set', 'Bottom (dough)',       1,          12.50,          0.00,          '', 4)
) as v(sku, part, qty, unit_cost, freight, note, sort) on v.sku = p.sku
where not exists (
  select 1 from public.sales_product_parts x where x.product_id = p.id and x.part = v.part
);

-- Corners volume breaks (Corners Cost G2:H3).
insert into public.sales_price_tiers (product_id, min_qty, unit_cost)
select p.id, v.min_qty, v.unit_cost
from public.sales_products p
join (values ('corners', 8000::numeric, 0.72::numeric), ('corners', 10000, 0.61))
  as v(sku, min_qty, unit_cost) on v.sku = p.sku
on conflict (product_id, min_qty) do nothing;

-- Start every product tracked at zero rather than absent, so the Inventory
-- screen lists the catalogue on day one instead of an empty table.
insert into public.sales_inventory (product_id, on_hand, reserved)
select id, 0, 0 from public.sales_products
on conflict (product_id) do nothing;
