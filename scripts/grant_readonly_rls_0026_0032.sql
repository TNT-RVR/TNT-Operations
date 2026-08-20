-- Repair the read-only inspection role, found broken during a health check on
-- 2026-08-20.
--
-- TWO SEPARATE FAULTS, both of which made `tnt_readonly` useless on tables it
-- was supposed to be able to read.
--
-- 1. `has_access()` calls `auth.uid()`, and tnt_readonly has no USAGE on the
--    `auth` schema. Postgres ORs a table's policies together and may evaluate
--    any of them, so the moment a `has_access()` policy was considered the
--    whole query died with "permission denied for schema auth" — even on
--    tables that DO have a tnt_readonly policy (blocks, block_placements,
--    placed_shelters, shelter_tray_links all failed this way).
--
--    Granting USAGE does not expose any auth table. It lets the function
--    resolve, where auth.uid() is null for this role, has_access() returns
--    false, and the tnt_readonly policy decides the row — which is the design.
--
-- 2. The tables added since migration 0026 never got a read-only policy, so
--    they would return ZERO ROWS rather than an error. That is the worse
--    failure of the two: it reads as "the table is empty".
--
-- SAFE: purely additive. No data touched, no existing policy altered, nothing
-- about what the app's own users can see. Re-runnable.
--
-- DELIBERATELY EXCLUDED: the old beetent-maps tables (crews, scans, fields),
-- per the hard rule in CLAUDE.md. `fields` returning zero rows to this role is
-- intentional, not a fault.
--
-- To undo: revoke usage on schema auth from tnt_readonly;
--          drop policy tnt_readonly_select on public.<table>;

grant usage on schema auth to tnt_readonly;

do $$
declare
  t text;
  new_tables text[] := array[
    -- 0029/0030 calendar and scheduling
    'calendar_events',
    -- 0026/0027 crews
    'field_crews',
    'field_crew_members',
    -- tasks and checklists
    'app_tasks',
    'app_task_steps',
    'app_checklists',
    'app_checklist_steps',
    -- incubation and field history
    'incubator_mode_events',
    'field_checklist',
    'field_analysis',
    'weather_cache',
    'bee_purchases',
    'direction',
    -- signatures (read-only inspection only; nothing here is secret to an
    -- operator, and a signature the office cannot audit is not much use)
    'document_signatures',
    'user_signatures'
  ];
begin
  foreach t in array new_tables loop
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t
    ) then
      execute format('drop policy if exists tnt_readonly_select on public.%I', t);
      execute format(
        'create policy tnt_readonly_select on public.%I '
        || 'for select to tnt_readonly using (true)', t);
      raise notice 'read-only select policy added: public.%', t;
    else
      raise notice 'skipped (no such table): public.%', t;
    end if;
  end loop;
end $$;

-- Verify: has_policy should be 1 on every row, and auth_usage should be true.
select has_schema_privilege('tnt_readonly', 'auth', 'usage') as auth_usage;

select c.relname as table_name,
       (select count(*) from pg_policies p
         where p.schemaname = 'public'
           and p.tablename = c.relname
           and p.policyname = 'tnt_readonly_select') as has_policy
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in (
    'calendar_events','field_crews','field_crew_members','app_tasks',
    'app_task_steps','app_checklists','app_checklist_steps',
    'incubator_mode_events','field_checklist','field_analysis',
    'weather_cache','bee_purchases','direction','document_signatures',
    'user_signatures')
order by c.relname;
