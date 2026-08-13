-- ─────────────────────────────────────────────────────────────────────────────
-- TNT Operations — subscribable calendar feed.
--
-- A public .ics URL that Google Calendar (or Apple, or Outlook) polls on its
-- own schedule. No OAuth, no per-user connection, nothing sent back — the
-- calendar simply reflects the app.
--
-- ── The URL IS the credential ────────────────────────────────────────────────
--
-- Google fetches a subscribed feed anonymously, so there is no session to
-- authenticate. The only thing protecting it is the unguessable token in the
-- path. That has three consequences worth stating plainly:
--
--   * Anyone with the link can read the milestones. That is the point — it is
--     how an external grower subscribes without an account.
--   * The link must be rotatable, because "share it with someone" and "stop
--     sharing with them" are the same action performed at different times.
--     `regenerate` below issues a new token and instantly invalidates the old.
--   * The feed carries incubation milestones only. Nothing priced, nothing
--     personal, no customer data — so a leaked link is embarrassing rather
--     than damaging.
--
-- This is deliberately NOT the OAuth integration (0024_google_calendar.sql),
-- which stays in the codebase UNAPPLIED until that work is picked back up.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.calendar_feed (
  -- One feed for the whole operation. A per-user feed would mean handing every
  -- external subscriber their own link to manage; one shared link that can be
  -- rotated is the simpler thing to reason about.
  id          boolean primary key default true check (id),
  -- The secret in the URL. Long and random; regenerating replaces it.
  token       text not null default encode(gen_random_bytes(24), 'hex'),
  enabled     boolean not null default true,
  -- Set by the function on each fetch, so the UI can show whether anything is
  -- actually subscribed — a feed nobody polls looks identical to a broken one.
  last_fetched_at timestamptz,
  fetch_count integer not null default 0,
  rotated_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

insert into public.calendar_feed (id) values (true) on conflict (id) do nothing;

alter table public.calendar_feed enable row level security;

-- Members may see the link (they need it to subscribe); admins may rotate or
-- disable it. The anon role gets nothing — the FUNCTION reads it with the
-- service key, so the token never has to be publicly readable to work.
drop policy if exists "read for members" on public.calendar_feed;
create policy "read for members" on public.calendar_feed for select using (has_access());
drop policy if exists "write for admins" on public.calendar_feed;
create policy "write for admins" on public.calendar_feed
  for all using (app_role() = 'admin') with check (app_role() = 'admin');

-- Rotate the link. A SECURITY DEFINER function rather than an UPDATE from the
-- client so the new token is generated server-side by pgcrypto, never by a
-- browser's random number generator.
create or replace function public.regenerate_calendar_feed_token()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  fresh text;
begin
  if app_role() <> 'admin' then
    raise exception 'Only an admin can rotate the calendar link.';
  end if;
  fresh := encode(gen_random_bytes(24), 'hex');
  update public.calendar_feed
  set token = fresh, rotated_at = now(), fetch_count = 0, last_fetched_at = null
  where id = true;
  return fresh;
end $$;

revoke all on function public.regenerate_calendar_feed_token() from anon;
grant execute on function public.regenerate_calendar_feed_token() to authenticated;

drop trigger if exists calendar_feed_touch_updated_at on public.calendar_feed;
create trigger calendar_feed_touch_updated_at before update on public.calendar_feed
  for each row execute function public.touch_updated_at();

-- Best-effort usage counter, called by the feed function on each fetch.
-- SECURITY DEFINER because the function calls it with the service key but the
-- row is otherwise admin-write only, and a fetch is not an admin action.
create or replace function public.touch_calendar_feed()
returns void
language sql
security definer
set search_path = public
as $$
  update public.calendar_feed
  set last_fetched_at = now(), fetch_count = fetch_count + 1
  where id = true;
$$;
