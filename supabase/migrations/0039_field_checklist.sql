-- Overall Checklist: one row per field per season per step.
--
-- Ported from the spreadsheet TNT has kept since 2023 ("Checklist", one sheet
-- per year, fields down the side and steps across the top). The sheet records
-- two different things in ONE cell: a date typed when the step is planned, and
-- the same cell highlighted blue when it is done — so "planned for the 8th" and
-- "done on the 8th" are indistinguishable in the file unless you can see the
-- fill. Here they are separate columns, which is the whole point of moving it.
--
-- The FIELD LIST is not stored. Rows are the season's fields, live from
-- shelter_fields, so a field added to the map appears on the checklist without
-- anyone re-typing it. Only the marks live here.
--
-- Natural key is (year, field_name, step): the sheet is name-keyed, and names
-- in it predate the mapped fields (2023 rows are "#9", "Weibes"). shelter_field_id
-- is filled in when the name matches a mapped field, so the link exists where it
-- can and nothing is lost where it cannot.

create table if not exists public.field_checklist (
  id                uuid primary key default gen_random_uuid(),
  year              text not null,
  field_name        text not null,
  step              text not null,
  shelter_field_id  uuid references public.shelter_fields (id) on delete set null,
  -- Both dates are DATE, not timestamptz: this is a day's work, and an
  -- afternoon in Edmonton must not read as the next day in UTC.
  planned_date      date,
  completed_date    date,
  -- The sheet has cells like "Half- 7/16/2026" and "Most in June 29th" — real
  -- operational nuance that a date column would throw away.
  note              text not null default '',
  updated_at        timestamptz not null default now(),
  updated_by        uuid references public.profiles (id) on delete set null,
  unique (year, field_name, step)
);

create index if not exists field_checklist_year_idx on public.field_checklist (year);
create index if not exists field_checklist_field_idx on public.field_checklist (shelter_field_id);

alter table public.field_checklist enable row level security;

-- Same shape as every other operational table: anyone with access reads, the
-- roles that can edit tasks write.
drop policy if exists "field_checklist read" on public.field_checklist;
create policy "field_checklist read" on public.field_checklist
  for select to authenticated using (public.has_access());

drop policy if exists "field_checklist write" on public.field_checklist;
create policy "field_checklist write" on public.field_checklist
  for insert to authenticated with check (public.can_edit());

drop policy if exists "field_checklist update" on public.field_checklist;
create policy "field_checklist update" on public.field_checklist
  for update to authenticated using (public.can_edit()) with check (public.can_edit());

drop policy if exists "field_checklist delete" on public.field_checklist;
create policy "field_checklist delete" on public.field_checklist
  for delete to authenticated using (public.can_edit());

-- Touch updated_at on every write, so a Google Sheets sync can tell which side
-- moved last without trusting a client clock.
create or replace function public.fn_touch_field_checklist() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists field_checklist_touch on public.field_checklist;
create trigger field_checklist_touch before update on public.field_checklist
  for each row execute function public.fn_touch_field_checklist();
