-- Cost-estimator pricing forms, stored PER PRICING YEAR (spec Part 8).
-- One row per year; `data` holds the whole CostPrefs form (camelCase JSON,
-- matching src/domain/cost.ts). Missing years carry forward in app code.

create table if not exists public.cost_prefs (
  year        text primary key,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.cost_prefs enable row level security;

-- Same access model as the other TNT tables: any signed-in, non-pending role
-- can read; editors can write. Uses the SECURITY DEFINER helpers from 0001/0005.
drop policy if exists cost_prefs_select on public.cost_prefs;
create policy cost_prefs_select on public.cost_prefs
  for select using (has_access());

drop policy if exists cost_prefs_write on public.cost_prefs;
create policy cost_prefs_write on public.cost_prefs
  for all using (can_edit()) with check (can_edit());

drop trigger if exists cost_prefs_touch_updated_at on public.cost_prefs;
create trigger cost_prefs_touch_updated_at
  before update on public.cost_prefs
  for each row execute function public.touch_updated_at();
