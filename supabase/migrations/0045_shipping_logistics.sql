-- The handful of freight answers a person gives per shipment.
--
-- Everything else on the Cole quote comes from the order: parties, quantities,
-- HS codes, values, and the pallet maths from the item specs. What is left is
-- facts about a place and a day that cannot be derived — the pickup date and
-- hours, and whether each end has an appointment, a dock, a liftgate, or is
-- residential. Each of those changes the price, and each one guessed wrong
-- becomes an accessorial charge after the truck has been.
--
-- One jsonb rather than a dozen columns: it is a form, it is read and written
-- whole, and nothing queries across it. The shape lives in
-- src/domain/freightQuote.ts (QuoteLogistics).
alter table public.sales_orders
  add column if not exists shipping_logistics jsonb;

comment on column public.sales_orders.shipping_logistics is
  'Per-shipment freight answers for the Cole quote (QuoteLogistics in src/domain/freightQuote.ts). NULL = not filled in yet.';
