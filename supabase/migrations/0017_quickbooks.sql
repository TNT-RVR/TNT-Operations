-- ─────────────────────────────────────────────────────────────────────────────
-- TNT Operations — QuickBooks Online connection.
--
-- ── SECURITY: the token table is invisible to the browser ────────────────────
--
-- `qbo_connection` holds an OAuth refresh token, which is a bearer credential
-- to the company's accounting file. Anyone holding it can read every invoice,
-- customer and bank balance in QuickBooks until it is revoked.
--
-- So unlike every other table in this schema, it has RLS enabled and NO POLICY
-- AT ALL. In Postgres that means: deny everything. The anon and authenticated
-- roles cannot select it, and neither can an admin — there is no policy for
-- them to pass. Only the service-role key bypasses RLS, and that key exists
-- solely in Netlify's environment, never in a VITE_ var.
--
-- The app learns whether QuickBooks is connected through `qbo_status`, a view
-- that exposes the realm, the company name and the expiry timestamps and NOT
-- the tokens. Add columns there with care.
--
-- ── Refresh tokens ROTATE ────────────────────────────────────────────────────
--
-- Intuit issues a NEW refresh token on most refreshes and invalidates the old
-- one. Failing to persist the new value breaks the connection at the next
-- refresh, with a 400 that looks like a config error. `refresh_token_expires_at`
-- tracks the ~101-day window; unused past that, the user must re-authorise.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.qbo_connection (
  -- One row per QuickBooks company. Realm id is Intuit's company identifier.
  realm_id      text primary key,
  company_name  text not null default '',

  access_token  text not null,
  refresh_token text not null,
  -- Access tokens last ~1 hour.
  access_token_expires_at timestamptz not null,
  -- Refresh tokens last ~101 days of inactivity, and rotate on use.
  refresh_token_expires_at timestamptz not null,

  -- 'sandbox' talks to sandbox-quickbooks.api.intuit.com; 'production' to
  -- quickbooks.api.intuit.com. Stored per connection so the same deploy can be
  -- pointed at either without a rebuild.
  environment   text not null default 'sandbox' check (environment in ('sandbox', 'production')),

  -- Company facts read from QBO on connect. Cached because every push needs
  -- them and they change about never.
  home_currency text not null default 'CAD',
  multicurrency_enabled boolean not null default false,

  -- Operator choices. Null until set in the QuickBooks settings screen; the
  -- mapping layer BLOCKS a push rather than guessing any of them.
  default_tax_code_id text,
  exempt_tax_code_id  text,
  shipping_item_id    text,
  income_account_id   text,

  connected_at  timestamptz not null default now(),
  connected_by  uuid references public.profiles (id) on delete set null,
  -- Set when a refresh fails, so the UI can say "reconnect" instead of failing
  -- every push with a fresh error.
  disconnected_at timestamptz,
  last_error    text not null default '',
  updated_at    timestamptz not null default now()
);

-- RLS ON, NO POLICIES — deny all. See the header. Do not add a read policy
-- here; add columns to qbo_status instead.
alter table public.qbo_connection enable row level security;

-- What the app is allowed to know: connected or not, to which company, and
-- how the mapping is configured. No tokens.
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
  connected_at,
  disconnected_at,
  refresh_token_expires_at,
  last_error,
  -- The two questions the UI actually asks.
  (disconnected_at is null and refresh_token_expires_at > now()) as connected,
  (refresh_token_expires_at < now() + interval '14 days') as expiring_soon
from public.qbo_connection;

-- The view is SECURITY DEFINER (security_invoker = false), so it reads the
-- table despite the deny-all RLS. Access is then gated on the view itself.
revoke all on public.qbo_status from anon, authenticated;
grant select on public.qbo_status to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Entity links
-- ═══════════════════════════════════════════════════════════════════════════

-- Maps a local record to its QuickBooks counterpart.
--
-- `sync_token` is QuickBooks' optimistic-concurrency stamp: an update must send
-- the CURRENT one or QBO rejects the write. It changes on every edit, including
-- edits made by a human in QuickBooks, so it is refreshed on every read.
create table if not exists public.qbo_links (
  id            uuid primary key default gen_random_uuid(),
  realm_id      text not null,
  entity_type   text not null check (entity_type in ('customer', 'item', 'invoice', 'estimate')),
  -- The id in THIS app.
  local_id      uuid not null,
  -- The id in QuickBooks.
  qbo_id        text not null,
  sync_token    text,
  last_synced_at timestamptz not null default now(),
  last_error    text not null default '',
  -- One link per local record per company. Re-pushing updates rather than
  -- creating a second QuickBooks record — the duplicate-invoice failure mode
  -- is the expensive one.
  unique (realm_id, entity_type, local_id)
);
create index if not exists qbo_links_lookup_idx on public.qbo_links (realm_id, entity_type, local_id);
create index if not exists qbo_links_reverse_idx on public.qbo_links (realm_id, entity_type, qbo_id);

-- Links are not secret — they're just id pairs — so members read them and the
-- functions (service role) write them.
alter table public.qbo_links enable row level security;
drop policy if exists "read for members" on public.qbo_links;
create policy "read for members" on public.qbo_links for select using (has_access());

-- ═══════════════════════════════════════════════════════════════════════════
-- Sync log
-- ═══════════════════════════════════════════════════════════════════════════

-- Every push attempt, successful or not. An accounting sync that fails quietly
-- is worse than one that fails loudly: invoices stop reaching the books and
-- nobody finds out until a reconciliation.
create table if not exists public.qbo_sync_log (
  id            uuid primary key default gen_random_uuid(),
  realm_id      text,
  entity_type   text not null,
  local_id      uuid,
  action        text not null check (action in ('create', 'update', 'read', 'auth')),
  ok            boolean not null,
  message       text not null default '',
  at            timestamptz not null default now()
);
create index if not exists qbo_sync_log_at_idx on public.qbo_sync_log (at desc);

alter table public.qbo_sync_log enable row level security;
drop policy if exists "read for members" on public.qbo_sync_log;
create policy "read for members" on public.qbo_sync_log for select using (has_access());

-- ═══════════════════════════════════════════════════════════════════════════
-- Notifications
-- ═══════════════════════════════════════════════════════════════════════════

-- Raise an alert on a failed sync, and dedupe it: a batch push that fails for
-- one reason (expired auth, say) would otherwise raise one notification per
-- invoice and bury everything else in the bell.
create or replace function public.fn_qbo_sync_failed_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.ok then return new; end if;

  -- One alert per message per hour.
  if exists (
    select 1 from public.app_notifications
    where type = 'qbo_sync_failed'
      and body = new.message
      and created_at > now() - interval '1 hour'
  ) then
    return new;
  end if;

  insert into public.app_notifications (category, type, severity, title, body, source)
  values (
    'quickbooks',
    'qbo_sync_failed',
    'warning',
    'QuickBooks sync failed (' || new.entity_type || ')',
    new.message,
    'quickbooks');
  return new;
end; $$;

drop trigger if exists qbo_sync_failed_notify on public.qbo_sync_log;
create trigger qbo_sync_failed_notify after insert on public.qbo_sync_log
  for each row execute function public.fn_qbo_sync_failed_notify();

-- Alert when the connection drops or the refresh window is closing. Raised by
-- the functions, which set disconnected_at or watch the expiry.
create or replace function public.fn_qbo_auth_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.disconnected_at is not null and old.disconnected_at is null then
    insert into public.app_notifications (category, type, severity, title, body, source)
    values (
      'quickbooks',
      'qbo_auth_expired',
      'critical',
      'QuickBooks disconnected',
      coalesce(nullif(new.last_error, ''), 'The connection needs re-authorising.') ||
        ' Invoices will not reach QuickBooks until it is reconnected.',
      'quickbooks');
  end if;
  return new;
end; $$;

drop trigger if exists qbo_auth_notify on public.qbo_connection;
create trigger qbo_auth_notify after update on public.qbo_connection
  for each row execute function public.fn_qbo_auth_notify();

-- ═══════════════════════════════════════════════════════════════════════════
-- Payment status
-- ═══════════════════════════════════════════════════════════════════════════

-- QuickBooks is the authority on money, so a paid invoice there marks the
-- order paid here. `sales_orders.status` already has 'paid'.
alter table public.sales_orders
  add column if not exists qbo_paid_at timestamptz,
  add column if not exists qbo_balance numeric;

-- ═══════════════════════════════════════════════════════════════════════════
-- updated_at
-- ═══════════════════════════════════════════════════════════════════════════

drop trigger if exists qbo_connection_touch_updated_at on public.qbo_connection;
create trigger qbo_connection_touch_updated_at before update on public.qbo_connection
  for each row execute function public.touch_updated_at();
