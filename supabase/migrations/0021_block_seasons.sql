-- ── Block season index ───────────────────────────────────────────────────────
--
-- The blocks screens need to offer a season picker before they know what is in
-- any season. Deriving that list from the placements themselves means loading
-- every placement of every season just to fill a dropdown — which is exactly
-- what we're moving away from: some seasons run to 14,000 blocks, and at that
-- size "load it all, then filter in the browser" stops being viable.
--
-- One row per season, so the picker costs a single tiny request whatever the
-- season holds.
--
-- security_invoker = true: the view answers as the CALLER, so the row-level
-- policies on block_placements still apply. A view is not a way around RLS.
create or replace view public.block_seasons
with (security_invoker = true) as
select
  season,
  count(*)::int                                             as placed,
  count(gross_weight_lbs)::int                              as retrieved,
  count(stripped_weight_lbs)::int                           as stripped
from public.block_placements
group by season
order by season desc;

grant select on public.block_seasons to authenticated;

-- The read-only reporting role gets it too, matching every other block table.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'tnt_readonly') then
    grant select on public.block_seasons to tnt_readonly;
  end if;
end
$$;

-- Season is the access pattern now — every placement query filters on it.
create index if not exists block_placements_season_idx
  on public.block_placements (season);
