-- ─────────────────────────────────────────────────────────────────────────────
-- TNT Operations — Google Calendar sync (one-way: app → Google).
--
-- RENUMBERED from 0022 to 0024. It collided with 0022_sample_origin.sql, and a
-- duplicate number is the kind of thing where you apply one, see "0022" in the
-- list, and believe both are done. `sample_origin` is applied and this is not,
-- so nothing in the database depends on the old name. This file is still
-- UNAPPLIED on purpose — the Google Calendar API sync is tabled in favour of
-- the subscribable .ics feed (0023_calendar_feed.sql). Run it only when that
-- work resumes.
--
-- ── Per user, not per company ────────────────────────────────────────────────
--
-- Each person connects their OWN Google account and gets their own copy of the
-- calendar. That is the opposite of the QuickBooks connection (0017), which is
-- one company-wide row, and the difference is deliberate: QuickBooks is a
-- shared business record, whereas a calendar belongs to whoever is looking at
-- their phone. It also means one person disconnecting cannot take the calendar
-- away from everyone else.
--
-- ── Same token-secrecy rule as QuickBooks ────────────────────────────────────
--
-- A Google refresh token is a bearer credential. `gcal_connection` therefore
-- has RLS with policies scoped to the OWNER ONLY — not even an admin can read
-- another person's tokens, because an admin who could would be able to write to
-- that person's calendar. The app learns connection state through
-- `gcal_status`, which exposes everything except the tokens.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.gcal_connection (
  user_id       uuid primary key references public.profiles (id) on delete cascade,

  -- The Google account that was connected, for "connected as …".
  google_email  text not null default '',

  access_token  text not null,
  refresh_token text not null,
  access_token_expires_at timestamptz not null,

  -- The calendar this app CREATED and owns. Under the calendar.app.created
  -- scope we can only touch calendars we made, so this id is the entirety of
  -- our reach into the account.
  calendar_id   text,

  sync_enabled  boolean not null default true,
  last_synced_at timestamptz,
  last_error    text not null default '',
  -- Set when a refresh fails, so the UI says "reconnect" instead of failing
  -- every sync with the same opaque message.
  disconnected_at timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.gcal_connection enable row level security;

-- OWNER ONLY, spelled out per operation so the intent is unmistakable.
drop policy if exists "read own gcal" on public.gcal_connection;
create policy "read own gcal" on public.gcal_connection for select using (user_id = auth.uid());
drop policy if exists "insert own gcal" on public.gcal_connection;
create policy "insert own gcal" on public.gcal_connection for insert with check (user_id = auth.uid());
drop policy if exists "update own gcal" on public.gcal_connection;
create policy "update own gcal" on public.gcal_connection
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "delete own gcal" on public.gcal_connection;
create policy "delete own gcal" on public.gcal_connection for delete using (user_id = auth.uid());

-- What the app may know: connected or not, to which account, how it is going.
-- No tokens. Security definer so it can read past the deny-by-default policies,
-- then filtered to the caller's own row.
create or replace view public.gcal_status
with (security_invoker = false) as
select
  user_id,
  google_email,
  calendar_id,
  sync_enabled,
  last_synced_at,
  last_error,
  disconnected_at,
  (disconnected_at is null and calendar_id is not null) as connected
from public.gcal_connection
where user_id = auth.uid();

revoke all on public.gcal_status from anon, authenticated;
grant select on public.gcal_status to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- What we last pushed
-- ═══════════════════════════════════════════════════════════════════════════

-- One row per event this app has put on a user's calendar.
--
-- This is what makes DELETION possible. Without a record of what was pushed,
-- a run whose start date moves leaves its old milestones on the calendar
-- forever, and a crew sees two "Vapona out" dates with no way to tell which is
-- real. The date and summary are kept so an unchanged event can be skipped
-- rather than rewritten — a full re-push makes every event look freshly
-- changed in someone's notification feed.
create table if not exists public.gcal_synced_events (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  -- The id we derive from (incubator, milestone) — see src/domain/calendarSync.ts.
  event_id    text not null,
  event_date  date not null,
  summary     text not null default '',
  synced_at   timestamptz not null default now(),
  primary key (user_id, event_id)
);

alter table public.gcal_synced_events enable row level security;
drop policy if exists "own synced events" on public.gcal_synced_events;
create policy "own synced events" on public.gcal_synced_events
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists gcal_connection_touch_updated_at on public.gcal_connection;
create trigger gcal_connection_touch_updated_at before update on public.gcal_connection
  for each row execute function public.touch_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Notification
-- ═══════════════════════════════════════════════════════════════════════════

-- Raised when a connection drops. A silently broken calendar sync is the worst
-- kind: the events simply stop updating, and the person trusting them has no
-- signal that anything is wrong.
create or replace function public.fn_gcal_disconnected_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.disconnected_at is not null and old.disconnected_at is null then
    insert into public.app_notifications (category, type, severity, title, body, source)
    values (
      'calendar',
      'gcal_disconnected',
      'warning',
      'Google Calendar disconnected',
      coalesce(nullif(new.last_error, ''), 'The connection needs re-authorising.') ||
        ' Incubation milestones will stop updating until it is reconnected.',
      'calendar');
  end if;
  return new;
end; $$;

drop trigger if exists gcal_disconnected_notify on public.gcal_connection;
create trigger gcal_disconnected_notify after update on public.gcal_connection
  for each row execute function public.fn_gcal_disconnected_notify();
