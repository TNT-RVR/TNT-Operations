-- ─────────────────────────────────────────────────────────────────────────────
-- TNT Operations — self-signup "request access" flow.
--
-- New people can sign themselves up at the app URL, but land in a no-access
-- `pending` state until an admin assigns them a real role in the Users screen.
-- Crucially, `pending` users can't READ any data either (the read policies are
-- tightened here) — so an unapproved signup sees nothing.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. New role value (no module access; excluded from has_access below).
alter type public.app_role add value if not exists 'pending';

-- 2. New signups start as 'pending' (was 'viewer'). Existing users are untouched.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    coalesce(new.email, ''),
    'pending'
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- 3. "Has a real role" — pending (and null) are denied.
create or replace function public.has_access()
returns boolean
language sql
stable
as $$
  select public.app_role() in ('admin', 'developer', 'operator', 'viewer');
$$;

-- 4. Tighten every operational read policy from "any authenticated" to
--    "has_access()", so pending users can't pull data via the API.
do $$
declare t text;
begin
  foreach t in array array[
    'shelter_fields', 'incubators', 'inspections', 'sensor_readings',
    'samples', 'incubation_batches', 'trays', 'tray_inspections', 'alerts', 'settings',
    'presets', 'sensor_positions', 'voc_runs', 'voc_readings', 'voc_alert_events'
  ] loop
    execute format('drop policy if exists "read for authenticated" on public.%I;', t);
    execute format(
      'create policy "read for authenticated" on public.%I for select to authenticated using (public.has_access());', t);
  end loop;
end $$;

-- (profiles read policy is unchanged: a user always sees their own row — needed
--  so the app can show them the "pending approval" screen — and admins see all.)
