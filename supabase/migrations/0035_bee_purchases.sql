-- ─────────────────────────────────────────────────────────────────────────────
-- TNT Operations — bee purchases: what was bought, and what a gallon cost.
--
-- Two sources in one table, deliberately:
--
--   'quickbooks'  synced weekly from expense lines posted to the bee-larvae
--                 account. Owned by the sync — overwritten on every run.
--   'manual'      previous seasons typed in by hand, from before QuickBooks
--                 held them. Owned by whoever typed them; the sync must never
--                 touch these.
--
-- Keeping them apart by `source` rather than in two tables is what lets one
-- price-per-gallon series run across both without a union at every read.
--
-- ── gallons is NULLABLE, and that is the point ───────────────────────────────
--
-- QuickBooks has no field for volume; it is written into the line description
-- by hand ("250 gal"). Some lines will not state one. A line whose volume
-- cannot be read is stored NULL, never 0 — cost per gallon is money over
-- gallons, and a zero keeps the dollars in the numerator while contributing
-- nothing to the denominator, silently inflating the price of every gallon.
-- The app reports those lines instead.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.bee_purchases (
  id          uuid primary key default gen_random_uuid(),

  source      text not null default 'manual' check (source in ('quickbooks', 'manual')),
  -- QuickBooks transaction line id. Null on manual rows.
  qbo_id      text,

  purchase_date date not null,
  vendor      text not null default '',
  description text not null default '',

  -- Null = the description stated no volume. See the header.
  gallons     numeric check (gallons is null or gallons > 0),
  amount      numeric not null default 0,
  currency    text not null default 'CAD',

  -- Buying season, named for the year it ENDS in: a run goes December to May,
  -- so it straddles the new year and a calendar-year grouping would split it.
  -- Stored rather than derived so a manual row can be filed against the season
  -- it belongs to even when the paperwork is dated oddly.
  season      integer not null,

  notes       text not null default '',

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.profiles (id) on delete set null
);

-- Re-syncing must update a line, not duplicate it. Partial, so the many manual
-- rows with a null qbo_id do not collide with each other.
create unique index if not exists bee_purchases_qbo_uidx
  on public.bee_purchases (qbo_id) where qbo_id is not null;

create index if not exists bee_purchases_season_idx on public.bee_purchases (season, purchase_date);

alter table public.bee_purchases enable row level security;

drop policy if exists "read for members" on public.bee_purchases;
create policy "read for members" on public.bee_purchases for select using (has_access());

-- Typing in a previous season's purchases is ordinary operations work.
drop policy if exists "write for editors" on public.bee_purchases;
create policy "write for editors" on public.bee_purchases
  for all using (can_edit()) with check (can_edit());

drop trigger if exists bee_purchases_touch_updated_at on public.bee_purchases;
create trigger bee_purchases_touch_updated_at before update on public.bee_purchases
  for each row execute function public.touch_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Which QuickBooks account holds bee purchases
-- ═══════════════════════════════════════════════════════════════════════════

-- The app will not guess this. Expense accounts are numerous and similarly
-- named, and syncing the wrong one produces a cost-per-gallon that looks
-- entirely plausible and is wrong — the worst kind of wrong.
alter table public.qbo_connection
  add column if not exists bee_expense_account_id text;

-- Surface it through the status view, which is how the settings screen reads
-- configuration. Tokens stay invisible; see 0017.
create or replace view public.qbo_status
with (security_invoker = false) as
select
  realm_id,
  company_name,
  environment,
  home_currency,
  multicurrency_enabled,
  default_tax_code_id,
  exempt_tax_code_id,
  shipping_item_id,
  income_account_id,
  bee_expense_account_id,
  connected_at,
  disconnected_at,
  refresh_token_expires_at,
  last_error,
  (disconnected_at is null and refresh_token_expires_at > now()) as connected,
  (refresh_token_expires_at < now() + interval '14 days') as expiring_soon
from public.qbo_connection;

revoke all on public.qbo_status from anon, authenticated;
grant select on public.qbo_status to authenticated;
