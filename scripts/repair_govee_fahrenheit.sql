-- ── Repair Govee readings stored in Fahrenheit as if they were Celsius ───────
--
-- WHAT WENT WRONG. The poller guessed the unit: "above 50 must be °F". Govee
-- actually sends Fahrenheit always, so every real temperature at or below 10 °C
-- (= 50 °F) was stored unconverted — a real 9.7 °C became 49.46 "°C". The chart
-- shows an incubator spiking to ~50 °C and dropping straight back.
--
-- WHY THE 42–50 BAND IS SAFE TO CONVERT. Established from the data on
-- 2026-09-16, not assumed:
--   * every govee reading stored between 42 and 50 converts to 5.7–10.0 °C —
--     all just under the 10 °C line, which is exactly where this bug lives;
--   * each sits in a cold context (cool storage in September; the room
--     hovering right on 10 °C on 2026-08-03 for Incubator 6);
--   * no genuine reading has ever exceeded 37.7 °C, so nothing real is in the
--     band to be damaged.
-- Readings BELOW 42 are left alone on purpose. The 32–42 range holds real
-- incubation-season heat (June–August), and a value-only rule cannot tell them
-- apart there. None of the bad readings found fall below 42.
--
-- RUN ORDER. Deploy the poller fix FIRST. Until it is live, incubators in cool
-- storage keep writing new bad readings every 15 minutes, and a repair run
-- before the deploy would miss those. This script is safe to run again later —
-- a row already repaired is skipped — so running it twice costs nothing.
--
-- UNDO. Every original value is kept in govee_fahrenheit_repair:
--   update public.sensor_readings s set temp_c = r.original_temp_c
--   from public.govee_fahrenheit_repair r where r.reading_id = s.id;

create table if not exists public.govee_fahrenheit_repair (
  reading_id      uuid primary key,
  -- numeric, matching sensor_readings.temp_c: step 2 compares these for
  -- equality, and a float column would only match by the luck of the cast.
  original_temp_c numeric not null,
  repaired_temp_c numeric not null,
  repaired_at     timestamptz not null default now()
);

-- A repair log, not app data: RLS on with no policies, so the API cannot read
-- or write it and only this script (run as the database owner) touches it.
alter table public.govee_fahrenheit_repair enable row level security;

-- 1. Record what is about to change, before changing it.
insert into public.govee_fahrenheit_repair (reading_id, original_temp_c, repaired_temp_c)
select id, temp_c, round((temp_c - 32) * 5 / 9, 2)
from public.sensor_readings
where source = 'govee'
  and temp_c >= 42 and temp_c <= 50.001
  and id not in (select reading_id from public.govee_fahrenheit_repair);

-- 2. Convert exactly the rows just recorded, and no others.
update public.sensor_readings s
set temp_c = r.repaired_temp_c
from public.govee_fahrenheit_repair r
where r.reading_id = s.id
  and s.temp_c = r.original_temp_c;

-- 3. Check. `still_in_band` should be 0; `repaired` is how many were fixed in
--    total across every run of this script.
select
  (select count(*) from public.govee_fahrenheit_repair) as repaired,
  (select count(*) from public.sensor_readings
     where source = 'govee' and temp_c >= 42 and temp_c <= 50.001) as still_in_band,
  (select round(min(repaired_temp_c)::numeric, 1) from public.govee_fahrenheit_repair) as lowest_c,
  (select round(max(repaired_temp_c)::numeric, 1) from public.govee_fahrenheit_repair) as highest_c;
