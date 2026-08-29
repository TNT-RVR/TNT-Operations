-- Hypoxia chambers: controlled-atmosphere bee storage.
--
-- A chamber holds its oxygen near 10% by purging with nitrogen, which slows the
-- bees' metabolism and is meant to let them store far longer than cold alone
-- allows. An Arduino Nano runs each chamber; an ESP32-C3 bridges it to
-- ThingsBoard over MQTT, and that is where commands come back from.
--
-- ── Why this data lives here at all ─────────────────────────────────────────
--
-- ThingsBoard stays the device gateway — no firmware changes, nothing reflashed.
-- But it keeps only what a dashboard needs, and the app needs the same things it
-- needs for incubators: history that outlives a retention window, alerting
-- through `app_notifications`, and one place to answer "what happened in that
-- chamber last Tuesday". So a scheduled poller copies telemetry in, exactly the
-- shape the Govee poller already works in.
--
-- Names are prefixed `hypoxia_` — this is a shared Supabase project and plain
-- `chambers` or `readings` would be asking for the collision that
-- `public.fields` already caused once.

-- ── The chambers ───────────────────────────────────────────────────────────
create table public.hypoxia_chambers (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  -- Where it sits, in the crew's words: "Shed 2 · Stack A · Pod 1".
  location        text not null default '',
  -- The ThingsBoard device this maps to. Telemetry is read from it and RPC is
  -- sent to it; without one the chamber is a row nobody can hear.
  tb_device_id    text unique,
  -- What the Nano calls itself in its own telemetry ("pod":1). Kept so a line
  -- can be matched back to a chamber if the device mapping is ever wrong.
  pod             integer not null default 1,

  -- The chamber's own targets. NOT authoritative — the firmware holds these and
  -- these are what the app last SENT. A chamber power-cycled back to defaults
  -- would disagree, which is why the app shows the reading, not this.
  setpoint_pct    numeric not null default 10.0,
  deadband_pct    numeric not null default 1.0,

  active          boolean not null default true,
  -- Stamped by the poller. Drives the "silent" alert; null = never heard from.
  last_seen_at    timestamptz,
  notes           text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ── Telemetry history ──────────────────────────────────────────────────────
create table public.hypoxia_readings (
  id                 uuid primary key default gen_random_uuid(),
  chamber_id         uuid not null references public.hypoxia_chambers (id) on delete cascade,
  -- The device's own timestamp, from ThingsBoard. Not when we polled: the
  -- bridge publishes every 15 s and the poller runs every few minutes, so
  -- poll time would compress real history into a lie.
  at                 timestamptz not null,

  o2_pct             numeric not null,
  temp_c             numeric,
  rh_pct             numeric,

  valve1             boolean not null default false,
  valve2             boolean not null default false,
  blower_duty        integer not null default 0,
  circulation_duty   integer not null default 0,
  purging            boolean not null default false,
  maintenance        boolean not null default false,
  warn               boolean not null default false,
  error              boolean not null default false,

  -- The poller re-reads the LATEST value every run and will see the same one
  -- twice whenever the device has not published since. This makes that a no-op
  -- instead of a duplicate, so the poller can be dumb and idempotent.
  unique (chamber_id, at)
);

create index hypoxia_readings_recent_idx
  on public.hypoxia_readings (chamber_id, at desc);

-- ── What was sent, by whom ─────────────────────────────────────────────────
--
-- An audit trail, not a queue. These commands physically move things in a
-- sealed chamber full of live bees — a valve opened, a blast door opened, the
-- control loop switched off — and "who opened that valve, and when" is a
-- question that will be asked. Every attempt is recorded, including refused
-- ones, because a refusal is also an answer.
create table public.hypoxia_commands (
  id           uuid primary key default gen_random_uuid(),
  chamber_id   uuid not null references public.hypoxia_chambers (id) on delete cascade,
  -- The exact string handed to the firmware, e.g. 'PURGE' or 'SP=100'.
  wire         text not null,
  risk         text not null default 'routine'
                 check (risk in ('routine', 'setpoint', 'manual', 'calibration')),
  sent_by      uuid references auth.users (id) on delete set null,
  sent_at      timestamptz not null default now(),
  ok           boolean not null default false,
  error        text
);

create index hypoxia_commands_recent_idx
  on public.hypoxia_commands (chamber_id, sent_at desc);

-- ── RLS ────────────────────────────────────────────────────────────────────
--
-- Reading mirrors the incubation module: anyone with a real role may look.
-- WRITING is deliberately not offered to the client at all — chambers and
-- readings are maintained by the poller under the service role, and commands
-- are inserted by the command function after it has checked the caller's role.
-- A client that could insert into hypoxia_commands could forge an audit trail.
alter table public.hypoxia_chambers enable row level security;
alter table public.hypoxia_readings enable row level security;
alter table public.hypoxia_commands enable row level security;

create policy "hypoxia chambers read" on public.hypoxia_chambers
  for select to authenticated using (public.has_access());
create policy "hypoxia readings read" on public.hypoxia_readings
  for select to authenticated using (public.has_access());
create policy "hypoxia commands read" on public.hypoxia_commands
  for select to authenticated using (public.has_access());

-- Editors may adjust a chamber's own record (its name, where it sits, which
-- device it is). Not its readings, and not its command history.
create policy "hypoxia chambers write" on public.hypoxia_chambers
  for update to authenticated
  using (public.app_role() in ('admin', 'developer', 'operator'))
  with check (public.app_role() in ('admin', 'developer', 'operator'));

comment on table public.hypoxia_chambers is
  'Controlled-atmosphere bee storage chambers. Bridged to ThingsBoard; polled by netlify/functions/poll-hypoxia.mjs.';
comment on column public.hypoxia_chambers.setpoint_pct is
  'What the app last SENT. The firmware holds the real value — show the reading, not this.';
comment on table public.hypoxia_commands is
  'Audit trail of commands sent to a chamber, including refused ones.';
