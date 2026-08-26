-- Freight class on a shipment line, and on the item it came from.
--
-- The app computes class from density (src/domain/freightClass.ts), which is
-- how the standard NMFC density scale works. But density is not always the last
-- word: a specific NMFC item number for the commodity, or a class negotiated on
-- the account, beats it — Estes billed TNT 175 on a 4.71 PCF load of trays that
-- the scale calls 200.
--
-- So the computed value is a starting point and these columns are the override.
-- NULL means "use what the app worked out", which is different from a number
-- someone typed and equal to it: the first follows the load when it is packed
-- differently, the second does not.
--
-- `nmfc` is the carrier's item number when they have given one. It is the blank
-- column on TNT's bill of lading, and having it on file is what makes a class
-- defensible if a carrier ever reclasses a load.

alter table public.sales_order_lines
  add column if not exists freight_class numeric,
  add column if not exists nmfc text;

comment on column public.sales_order_lines.freight_class is
  'Override for the density-computed freight class. NULL = use the computed one.';
comment on column public.sales_order_lines.nmfc is
  'NMFC item number from the carrier, when one has been given.';

-- The same two on the item, so a product that always classes a certain way
-- carries it forward onto new orders instead of being retyped per shipment.
alter table public.sales_item_specs
  add column if not exists freight_class numeric,
  add column if not exists nmfc text;

comment on column public.sales_item_specs.freight_class is
  'Default freight class for this item, used when a line has no override.';
