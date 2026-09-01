-- ── Muting an incubator, per person ──────────────────────────────────────────
--
-- An incubator standing empty for the season still has a sensor on it, and
-- that sensor still drops off the network. The alert is correct and nobody can
-- act on it, which is how people learn to swipe past the one that matters.
--
-- Muting is a PERSONAL setting, not a property of the equipment: incubator
-- modes are shared across everyone, alerts are not. One person deciding they
-- do not want to hear about Incubator 5 must not silence it for the office.
--
-- Note what this does NOT change: the alert is still evaluated, still recorded
-- in `alerts`, and still written to the shared notification inbox. A mute
-- means "do not send this to me", never "stop watching".
create table if not exists public.incubator_alert_mutes (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  incubator_id uuid not null references public.incubators(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (user_id, incubator_id)
);

create index if not exists incubator_alert_mutes_incubator_idx
  on public.incubator_alert_mutes (incubator_id);

alter table public.incubator_alert_mutes enable row level security;

-- Your mutes are yours. Deliberately not readable by other members: it is a
-- personal preference, and there is no reason for anyone else to see it.
drop policy if exists "own mutes" on public.incubator_alert_mutes;
create policy "own mutes" on public.incubator_alert_mutes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'tnt_readonly') then
    grant select on public.incubator_alert_mutes to tnt_readonly;
    execute 'drop policy if exists tnt_readonly_select on public.incubator_alert_mutes';
    execute 'create policy tnt_readonly_select on public.incubator_alert_mutes '
         || 'for select to tnt_readonly using (true)';
  end if;
end
$$;

-- ── Which incubator an alert is about ────────────────────────────────────────
--
-- The notification inbox is shared and has no recipient, so a personal mute
-- can only be applied when the app renders the list — and to do that it has to
-- know which incubator each row concerns. It was only ever recoverable by
-- parsing the dedup key, which is a string built for de-duplication and not a
-- contract worth reading data out of.
alter table public.app_notifications
  add column if not exists incubator_id uuid references public.incubators(id) on delete set null;

create index if not exists app_notifications_incubator_idx
  on public.app_notifications (incubator_id) where incubator_id is not null;
