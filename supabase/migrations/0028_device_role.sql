-- ── Teach the database about the `device` role ───────────────────────────────
--
-- `profiles.role` is not text: it is the enum `app_role`. Adding a role to the
-- TypeScript union therefore did nothing at all — Postgres rejected every
-- assignment as an invalid enum value, and because the app only logged that to
-- the console, picking "device" in the Users screen looked like a button that
-- did nothing.
--
-- The second half matters more. `has_access()` is what every RLS policy calls,
-- and it lists the roles allowed to read anything at all. A device left out of
-- it can sign in, see a nav bar, and read NOTHING — no fields, no crews — and
-- cannot join a crew, which is the one thing it exists to do.
--
-- Run the two statements SEPARATELY. Postgres will not let a transaction use
-- an enum value it added itself, so the function update has to come after the
-- ALTER TYPE has committed.

-- 1 ──
alter type public.app_role add value if not exists 'device';

-- 2 ── (run after the above has committed)
create or replace function public.has_access()
returns boolean
language sql
stable
as $$
  select public.app_role() in ('admin', 'developer', 'operator', 'viewer', 'device')
     and not exists (
       select 1 from public.profiles
       where id = auth.uid() and archived_at is not null
     );
$$;

-- Deliberately NOT added to can_edit() (admin/developer/operator). A device
-- reads, reports its crew's position, and joins crews — all of which run
-- through has_access() — but it has no business editing the tables can_edit()
-- guards.
