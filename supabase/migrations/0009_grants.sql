-- Grant tracker. Grants that apply to a leafcutter-bee / pollination operation
-- or a small Alberta ag business are pulled in automatically (or added by hand),
-- tracked through a workflow, and worked as assignable tasks.
-- Mirrors the RVR Management App's grants feature.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'grant_status') then
    create type grant_status as enum ('new', 'reviewing', 'applying', 'submitted', 'awarded', 'declined', 'ignored');
  end if;
end $$;

create table if not exists public.grants (
  id                  uuid primary key default gen_random_uuid(),
  title               text not null,
  funder              text,                 -- who offers it
  url                 text,
  status              grant_status not null default 'new',
  amount_min          numeric,
  amount_max          numeric,
  eligibility_summary text,                 -- quick summary of who/what is eligible
  summary             text,                 -- quick description of the grant
  notes_md            text,                 -- our notes
  opens_on            date,
  closes_on           date,
  region              text,                 -- e.g. Alberta / Canada
  categories          text[] default '{}',  -- e.g. {pollination, equipment}
  assigned_to         uuid references public.profiles (id) on delete set null,
  source              text not null default 'manual',   -- manual | auto
  external_key        text unique,          -- dedup key for auto-pulled grants (url)
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists grants_status_idx on public.grants (status);
create index if not exists grants_closes_idx on public.grants (closes_on);

-- Grant work items: assignable tasks / subtasks per grant.
create table if not exists public.grant_tasks (
  id          uuid primary key default gen_random_uuid(),
  grant_id    uuid not null references public.grants (id) on delete cascade,
  title       text not null,
  status      text not null default 'open',   -- open | done
  assigned_to uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists grant_tasks_grant_idx on public.grant_tasks (grant_id);

-- RLS: any signed-in, non-pending user can read and work the pipeline.
do $$
declare t text;
begin
  foreach t in array array['grants', 'grant_tasks'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "read for members" on public.%I;', t);
    execute format('create policy "read for members" on public.%I for select using (has_access());', t);
    execute format('drop policy if exists "write for editors" on public.%I;', t);
    execute format(
      'create policy "write for editors" on public.%I for all using (can_edit()) with check (can_edit());', t);
  end loop;
end $$;

drop trigger if exists grants_touch_updated_at on public.grants;
create trigger grants_touch_updated_at
  before update on public.grants
  for each row execute function public.touch_updated_at();

-- Alert the team when the weekly pull discovers a new grant.
create or replace function public.fn_grant_new_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.source = 'auto' then
    insert into public.app_notifications (category, type, severity, title, body, source)
    values (
      'grants',
      'grant_new',
      'info',
      'New grant: ' || new.title,
      coalesce(new.funder, '') ||
        case when new.closes_on is not null then ' · closes ' || new.closes_on else '' end,
      'grants_pull');
  end if;
  return new;
end; $$;

drop trigger if exists grant_new_notify on public.grants;
create trigger grant_new_notify after insert on public.grants
  for each row execute function public.fn_grant_new_notify();
