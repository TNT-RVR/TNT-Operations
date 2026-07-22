-- ─────────────────────────────────────────────────────────────────────────────
-- TNT Operations — demo/dev seed. Mirrors src/data/seed.ts so `supabase` mode
-- shows the same data as `mock` mode out of the box. Idempotent (fixed UUIDs +
-- on-conflict-do-nothing). Safe to skip in a real production project.
--
-- Does NOT seed profiles/auth users — those come from real Supabase Auth
-- signups; an admin sets roles afterward in the Users screen.
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.fields (id, name, client, region, shape_type, shelter_count, updated_at) values
  ('f1000000-0000-4000-8000-000000000001', 'Grassy Lake NW Pivot', 'Corteva', 'Grassy Lake, AB', 'pivot',   24, '2026-07-18T15:00:00Z'),
  ('f1000000-0000-4000-8000-000000000002', 'Bow Island Quarter',   'Corteva', 'Bow Island, AB',  'polygon', 16, '2026-07-19T18:30:00Z'),
  ('f1000000-0000-4000-8000-000000000003', 'Taber South Pivot',    'Corteva', 'Taber, AB',       'pivot',   30, '2026-07-20T13:10:00Z')
on conflict (id) do nothing;

insert into public.incubators (id, name, location, status, started_at, temp_target_c, humidity_target_pct) values
  ('a1000000-0000-4000-8000-000000000001', 'Incubator A', 'Shop — north wall', 'active', '2026-07-10T06:00:00Z', 30, 55),
  ('a1000000-0000-4000-8000-000000000002', 'Incubator B', 'Shop — south wall', 'active', '2026-07-14T06:00:00Z', 30, 55),
  ('a1000000-0000-4000-8000-000000000003', 'Incubator C', 'Trailer',           'idle',   null,                   30, 55)
on conflict (id) do nothing;

insert into public.inspections (id, incubator_id, at, inspector, health_score, notes) values
  ('c1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', '2026-07-20T16:00:00Z', 'Tyler', 92, 'Emergence starting, looks strong.'),
  ('c1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002', '2026-07-21T16:00:00Z', 'Tyler', 88, 'On track. Humidity a touch low.')
on conflict (id) do nothing;

insert into public.sensor_readings (id, incubator_id, at, temp_c, humidity_pct, source) values
  ('d1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', '2026-07-22T12:00:00Z', 30.1, 54, 'govee'),
  ('d1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', '2026-07-22T13:00:00Z', 30.3, 53, 'govee'),
  ('d1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000002', '2026-07-22T13:00:00Z', 29.6, 49, 'esp32')
on conflict (id) do nothing;
