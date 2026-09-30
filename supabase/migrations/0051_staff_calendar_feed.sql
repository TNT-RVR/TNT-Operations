-- ─────────────────────────────────────────────────────────────────────────────
-- TNT Operations — a second calendar link, for staff.
--
-- 0023 gave the operation ONE subscribable .ics link, carrying incubation
-- milestones and nothing else. That restraint was deliberate: the URL is the
-- whole credential, it gets handed to external growers, and a leaked link
-- holding only "Incubator 3 — Vapona out" is embarrassing rather than damaging.
--
-- Work orders are a different matter. They name fields and crews, and the
-- people who need them in their own calendar are staff, not growers. So rather
-- than widening the existing link, this adds a SECOND token on the same row:
--
--   token        → milestones only. The grower link. Unchanged.
--   staff_token  → milestones AND work orders and calendar events.
--
-- Two tokens rather than two tables because there is still one feed setting
-- ("on" or "off") and one place to manage it. Either token can be rotated on
-- its own, which is what "stop sharing with that person" means here.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.calendar_feed
  add column if not exists staff_token text not null default encode(gen_random_bytes(24), 'hex'),
  add column if not exists staff_rotated_at timestamptz;

-- Rotate the staff link. Mirrors regenerate_calendar_feed_token: SECURITY
-- DEFINER so the new token comes from pgcrypto on the server, never from a
-- browser's random number generator.
create or replace function public.regenerate_staff_calendar_feed_token()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  fresh text;
begin
  if app_role() <> 'admin' then
    raise exception 'Only an admin can rotate the staff calendar link.';
  end if;
  fresh := encode(gen_random_bytes(24), 'hex');
  update public.calendar_feed
  set staff_token = fresh, staff_rotated_at = now()
  where id = true;
  return fresh;
end $$;

revoke all on function public.regenerate_staff_calendar_feed_token() from anon;
grant execute on function public.regenerate_staff_calendar_feed_token() to authenticated;
