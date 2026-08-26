-- Items that do not stack.
--
-- The spec model assumed every shippable thing nests into itself: pallet height
-- came from stacks × the height each ADDITIONAL item adds. That is right for
-- trays and Cubees and wrong for anchors, which are not stacked at all — they
-- go loose into a tub, and a tub of anchors is not an anchor plus an anchor
-- plus an anchor.
--
-- There is no per-item nested height to measure there. Inventing one to fill
-- the box would produce a made-up pallet height, which becomes a made-up
-- density, which becomes a made-up freight class on a document a carrier bills
-- against. So a loose item states what a loaded pallet MEASURES instead, which
-- is a thing somebody can put a tape against.
--
-- NULL pack_mode means 'stacked', so every existing row behaves exactly as it
-- did and the column can be filled in only where it is needed.

alter table public.sales_item_specs
  add column if not exists pack_mode text
    check (pack_mode is null or pack_mode in ('stacked', 'loose')),
  add column if not exists loose_height_in numeric,
  add column if not exists container_tare_lbs numeric;

comment on column public.sales_item_specs.pack_mode is
  'How the item fills a pallet: ''stacked'' (height derived from stacks x nested height) or ''loose'' (height stated). NULL = stacked.';
comment on column public.sales_item_specs.loose_height_in is
  'Loose items only: height of a LOADED pallet excluding the deck, inches. Measured, not derived.';
comment on column public.sales_item_specs.container_tare_lbs is
  'Loose items only: weight of the empty containers on one full pallet. Counted pro rata on a part-full pallet.';
