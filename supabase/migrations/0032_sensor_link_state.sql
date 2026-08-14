-- ═══════════════════════════════════════════════════════════════════════════
-- 0032 — remember whether the Govee sensor is on the network
--
-- The H5100 reports exactly two things, temperature and humidity; there is no
-- battery level to read (checked against every sensor, 2026-08-14). What it
-- does report is `devices.capabilities.online`, which the poller was throwing
-- away.
--
-- That flag is the earliest warning this hardware can give: these sensors do
-- not fade, they drop off. Until now a dead one showed up only as silence, and
-- silence takes an hour of running (a day when idle) to become an alert.
--
-- Kept on the incubator rather than in sensor_readings, because an offline
-- sensor produces no reading — a row with null temperature would be a lie to
-- every chart and every "last reading" lookup in the app.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.incubators
  -- What Govee said at the last check. Null = never checked.
  add column if not exists sensor_online     boolean,
  -- When we last asked. Separates "offline" from "nobody has looked lately".
  add column if not exists sensor_checked_at timestamptz,
  -- The last time it was actually ON. This is what the age of an outage is
  -- measured from, and it survives any number of failed checks.
  add column if not exists sensor_seen_at    timestamptz;

comment on column public.incubators.sensor_online is
  'Govee devices.capabilities.online at the last poll. The H5100 exposes no battery level; going offline is how a flat one presents.';
comment on column public.incubators.sensor_seen_at is
  'Last time the sensor reported itself online — the start of any outage.';
