-- ─────────────────────────────────────────────────────────────────────────────
-- TNT Operations — full incubation model (ports the old bee-incubation SQLite
-- schema into the SAME Supabase project as Shelter Maps).
--
-- ADDITIVE to 0001_init.sql: the simplified `incubators`, `inspections` and
-- `sensor_readings` from 0001 become SUPERSETS (old rich columns added), and the
-- rest of the old model (batches, samples, trays, alerts, settings, VOC) is
-- created here. Re-runnable (if-not-exists / add-column-if-not-exists).
--
-- Column names mirror the old SQLite tables so the import (scripts/
-- import_incubation.py) is a near 1:1 map. Reuses the role helpers + RLS pattern
-- from 0001 (public.can_edit / public.is_admin).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── incubators: physical units. Add the old operational columns. ──────────────
alter table public.incubators add column if not exists capacity            integer not null default 50;
alter table public.incubators add column if not exists govee_device_id     text    not null default '';
alter table public.incubators add column if not exists govee_sku           text    not null default '';
alter table public.incubators add column if not exists temp_mode           text    not null default 'incubation'
  check (temp_mode in ('off', 'cool_storage', 'incubation', 'holding'));
alter table public.incubators add column if not exists temp_alerts_enabled boolean not null default true;
alter table public.incubators add column if not exists humidity_min        numeric not null default 55;
alter table public.incubators add column if not exists humidity_max        numeric not null default 75;
alter table public.incubators add column if not exists sort_order          integer not null default 0;
alter table public.incubators add column if not exists is_hidden           boolean not null default false;

-- ── samples: an x-rayed lot of bee cells. ─────────────────────────────────────
create table if not exists public.samples (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  source            text not null default '',
  lot_number        text not null default '',
  xray_live_pct     numeric,
  xray_parasite_pct numeric,
  xray_dead_pct     numeric,
  total_volume_gal  numeric,
  total_weight_lbs  numeric,
  notes             text not null default '',
  import_date       timestamptz
);

-- ── incubation_batches: a run in an incubator, with its lifecycle event dates. ─
create table if not exists public.incubation_batches (
  id                   uuid primary key default gen_random_uuid(),
  incubator_id         uuid references public.incubators (id) on delete set null,
  sample_id            uuid references public.samples (id) on delete set null,
  name                 text not null default '',
  start_date           date,
  vapona_in            date,
  vapona_out           date,
  air_out              date,
  male_10pct_emergence date,
  earliest_cool        date,
  estimated_release    date,
  latest_release       date,
  status               text not null default 'active',
  notes                text not null default ''
);
create index if not exists batches_incubator_idx on public.incubation_batches (incubator_id);

-- ── trays: a physical tray loaded from a sample into a batch/incubator. ────────
create table if not exists public.trays (
  id                  uuid primary key default gen_random_uuid(),
  tray_number         text not null,
  sample_id           uuid references public.samples (id) on delete set null,
  incubation_batch_id uuid references public.incubation_batches (id) on delete set null,
  incubator_id        uuid references public.incubators (id) on delete set null,
  weight_lbs          numeric,
  live_count          integer,
  parasite_level_pct  numeric,
  volume_gal          numeric,
  in_date             date,
  out_date            date,
  status              text not null default 'active',
  notes               text not null default ''
);
create index if not exists trays_batch_idx on public.trays (incubation_batch_id);

-- ── inspections: add the old rich thermometer/checklist columns (superset). ───
alter table public.inspections add column if not exists period             text not null default 'manual';
alter table public.inspections add column if not exists thermometer_temp_c numeric;
alter table public.inspections add column if not exists govee_temp_c       numeric;
alter table public.inspections add column if not exists temp_diff_c        numeric;
alter table public.inspections add column if not exists temp_alert         boolean not null default false;
alter table public.inspections add column if not exists heat_pumps_ok      boolean not null default false;
alter table public.inspections add column if not exists parasites_emerging boolean not null default false;
alter table public.inspections add column if not exists bees_emerging      boolean not null default false;
alter table public.inspections add column if not exists fans_ok            boolean not null default false;
alter table public.inspections add column if not exists black_lights_ok    boolean not null default false;
alter table public.inspections add column if not exists batch_id           uuid references public.incubation_batches (id) on delete set null;

-- ── alerts: temperature / date / VOC alerts raised by the poller. ─────────────
create table if not exists public.alerts (
  id              uuid primary key default gen_random_uuid(),
  alert_type      text not null,
  severity        text not null default 'warning',
  incubator_id    uuid references public.incubators (id) on delete set null,
  tray_id         uuid references public.trays (id) on delete set null,
  batch_id        uuid references public.incubation_batches (id) on delete set null,
  message         text not null,
  triggered_at    timestamptz not null default now(),
  acknowledged    boolean not null default false,
  acknowledged_at timestamptz,
  dedup_key       text
);
create index if not exists alerts_triggered_idx on public.alerts (triggered_at desc);

-- ── settings: small key/value app config (lbs_per_gal, poll interval…). ───────
create table if not exists public.settings (
  key   text primary key,
  value text
);

-- ── VOC fumigation subsystem ──────────────────────────────────────────────────
create table if not exists public.presets (
  id             uuid primary key default gen_random_uuid(),
  chemical_name  text not null unique,
  description    text not null default '',
  low_alert_ppm  numeric not null default 0.20,
  low_warn_ppm   numeric not null default 0.25,
  high_warn_ppm  numeric not null default 0.60,
  high_alert_ppm numeric not null default 0.70,
  confirmed      boolean not null default false,
  is_builtin     boolean not null default false,
  created_at     timestamptz,
  updated_at     timestamptz
);

create table if not exists public.sensor_positions (
  id            uuid primary key default gen_random_uuid(),
  incubator_id  uuid references public.incubators (id) on delete cascade,
  position      text not null check (position in ('front', 'back')),
  sensor_serial text not null default ''
);

create table if not exists public.voc_runs (
  id              uuid primary key default gen_random_uuid(),
  incubator_id    uuid references public.incubators (id) on delete cascade,
  preset_id       uuid references public.presets (id) on delete set null,
  chemical_name   text,
  preset_snapshot text,
  start_time      timestamptz,
  end_time        timestamptz,
  notes           text not null default '',
  status          text not null default 'active'
);

create table if not exists public.voc_readings (
  id           uuid primary key default gen_random_uuid(),
  incubator_id uuid,
  run_id       uuid references public.voc_runs (id) on delete cascade,
  position     text,
  timestamp    timestamptz not null,
  voc_ppm      numeric,
  temp_c       numeric
);
create index if not exists voc_readings_run_idx on public.voc_readings (run_id, timestamp desc);

create table if not exists public.voc_alert_events (
  id           uuid primary key default gen_random_uuid(),
  incubator_id uuid,
  run_id       uuid,
  position     text,
  ppm          numeric,
  zone         text,
  message      text,
  timestamp    timestamptz,
  acknowledged boolean not null default false
);

-- ── RLS: same model as 0001 — read for any signed-in user, write for editors. ─
do $$
declare t text;
begin
  foreach t in array array[
    'samples', 'incubation_batches', 'trays', 'alerts', 'settings',
    'presets', 'sensor_positions', 'voc_runs', 'voc_readings', 'voc_alert_events'
  ] loop
    execute format('alter table public.%I enable row level security;', t);

    execute format('drop policy if exists "read for authenticated" on public.%I;', t);
    execute format('create policy "read for authenticated" on public.%I for select to authenticated using (true);', t);

    execute format('drop policy if exists "insert for editors" on public.%I;', t);
    execute format('create policy "insert for editors" on public.%I for insert to authenticated with check (public.can_edit());', t);

    execute format('drop policy if exists "update for editors" on public.%I;', t);
    execute format('create policy "update for editors" on public.%I for update to authenticated using (public.can_edit()) with check (public.can_edit());', t);

    execute format('drop policy if exists "delete for editors" on public.%I;', t);
    execute format('create policy "delete for editors" on public.%I for delete to authenticated using (public.can_edit());', t);
  end loop;
end $$;

-- ── Realtime: stream live alerts + VOC readings to the app. ───────────────────
do $$
declare t text;
begin
  foreach t in array array['alerts', 'voc_readings'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I;', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ── Seed defaults (mirrors the old app's init: settings + built-in presets). ──
insert into public.settings (key, value) values
  ('govee_api_key', ''),
  ('lbs_per_gal', '2.2'),
  ('target_gals_per_tray', '2.0'),
  ('qr_server_port', '5151'),
  ('qr_server_enabled', '1'),
  ('poll_interval_sec', '60'),
  ('temp_unit', 'C'),
  ('date_alert_lookahead', '7')
on conflict (key) do nothing;

insert into public.presets (chemical_name, description, is_builtin) values
  ('Conk (permethrin)', 'Built-in preset', true),
  ('DDVP (Vapona)', 'Built-in preset', true),
  ('Other / Custom', 'Built-in preset', true)
on conflict (chemical_name) do nothing;
