-- ─────────────────────────────────────────────────────────────────────────────
-- TNT Operations — Tasks and Checklists.
--
-- Tables are `app_`-prefixed, matching `app_notifications`, because this
-- Supabase project is SHARED with the legacy beetent-maps app.
--
-- ── A checklist run IS a task ────────────────────────────────────────────────
--
-- The obvious design is two parallel trees — tasks with subtasks, checklists
-- with steps — and it duplicates every query, every notification and every
-- permission check. So there is one tree:
--
--   app_tasks        a task. If `checklist_id` is set it is a CHECKLIST RUN:
--                    the same row, created from a template.
--   app_task_steps   its subtasks / checklist steps, each optionally assigned
--                    to somebody other than the task's own assignee.
--   app_checklists       a reusable template ("Field prep — shelter build")
--   app_checklist_steps  the template's steps, copied into a run on assignment
--
-- "Subtask" and "checklist step" are the same mechanism. A plain task with
-- three subtasks and a checklist run with thirty steps differ only in where
-- the steps came from.
--
-- ── Dates ────────────────────────────────────────────────────────────────────
--
-- `due_date` is a DATE, not a timestamptz. A task due August 10 is due all of
-- August 10 in Alberta; storing an instant makes it go red overnight for anyone
-- in the wrong timezone. Completion IS an instant, so `completed_at` is a
-- timestamptz. See src/domain/tasks.ts.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
-- Templates
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.app_checklists (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text not null default '',
  -- Free-text grouping: 'Field', 'Shop', 'Season start'.
  category    text not null default '',
  active      boolean not null default true,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.app_checklist_steps (
  id            uuid primary key default gen_random_uuid(),
  checklist_id  uuid not null references public.app_checklists (id) on delete cascade,
  title         text not null,
  notes         text not null default '',
  -- Steps are ordered but NOT gated: field prep gets done in whatever order the
  -- yard allows, and a checklist that refuses step 4 until step 3 is ticked
  -- just teaches people to tick things they haven't done.
  sort          integer not null default 0,
  required      boolean not null default true
);
create index if not exists app_checklist_steps_parent_idx
  on public.app_checklist_steps (checklist_id, sort);

-- ═══════════════════════════════════════════════════════════════════════════
-- Tasks (and checklist runs)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.app_tasks (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  notes         text not null default '',

  -- Set ⇒ this is a run of that checklist. Null ⇒ a plain task.
  -- `set null` on delete: retiring a template must not delete the record of
  -- work people actually did.
  checklist_id  uuid references public.app_checklists (id) on delete set null,

  assignee_id   uuid references public.profiles (id) on delete set null,
  created_by    uuid references public.profiles (id) on delete set null,

  -- A calendar date. See the header note.
  due_date      date,
  priority      text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  status        text not null default 'open' check (status in ('open', 'in_progress', 'done', 'cancelled')),
  completed_at  timestamptz,
  completed_by  uuid references public.profiles (id) on delete set null,

  -- ── Recurrence ──
  -- Null unit ⇒ one-off.
  recur_unit    text check (recur_unit is null or recur_unit in ('daily', 'weekly', 'monthly', 'yearly')),
  recur_interval integer not null default 1 check (recur_interval >= 1),
  -- 'schedule' counts the next due date from the last DUE date; 'completion'
  -- counts from when the work was actually finished. Different jobs — see
  -- src/domain/tasks.ts.
  recur_anchor  text not null default 'schedule' check (recur_anchor in ('schedule', 'completion')),
  -- Weekly only: 0 = Sunday. Empty ⇒ same weekday as the due date.
  recur_weekdays smallint[] not null default '{}',
  recur_until   date,
  -- The task this one was generated from, so a series can be traced and the
  -- tick knows which rows it already made.
  recur_parent_id uuid references public.app_tasks (id) on delete set null,

  -- Lead time for the "due soon" notification.
  remind_days_before integer not null default 1 check (remind_days_before >= 0),
  -- Set when each notification fires, so the nightly tick raises them ONCE
  -- rather than every night the task stays overdue.
  notified_due_soon_at timestamptz,
  notified_overdue_at  timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists app_tasks_assignee_idx on public.app_tasks (assignee_id, status);
create index if not exists app_tasks_due_idx on public.app_tasks (due_date) where status <> 'done';
create index if not exists app_tasks_checklist_idx on public.app_tasks (checklist_id);

create table if not exists public.app_task_steps (
  id            uuid primary key default gen_random_uuid(),
  task_id       uuid not null references public.app_tasks (id) on delete cascade,
  title         text not null,
  notes         text not null default '',
  sort          integer not null default 0,
  required      boolean not null default true,
  -- Optional: a step can belong to someone other than the task's assignee.
  -- "Darren owns field prep, but Jim loads the trailer."
  assignee_id   uuid references public.profiles (id) on delete set null,
  completed_at  timestamptz,
  completed_by  uuid references public.profiles (id) on delete set null,
  -- Which template step this came from, if any. Kept so a run can be compared
  -- against the template it was made from after the template changes.
  source_step_id uuid references public.app_checklist_steps (id) on delete set null
);
create index if not exists app_task_steps_task_idx on public.app_task_steps (task_id, sort);

-- ═══════════════════════════════════════════════════════════════════════════
-- Notifications
-- ═══════════════════════════════════════════════════════════════════════════

-- Fire when a task lands on somebody. Covers both a new assigned task and a
-- reassignment, but NOT a no-op update that leaves the assignee unchanged —
-- otherwise editing a due date would re-notify.
create or replace function public.fn_app_task_assigned_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who text;
begin
  if new.assignee_id is null then return new; end if;
  if tg_op = 'UPDATE' and old.assignee_id is not distinct from new.assignee_id then return new; end if;
  -- Assigning something to yourself is not news.
  if new.assignee_id = coalesce(new.created_by, '00000000-0000-0000-0000-000000000000'::uuid)
     and tg_op = 'INSERT' then
    return new;
  end if;

  select coalesce(nullif(name, ''), email) into who from public.profiles where id = new.created_by;

  insert into public.app_notifications (category, type, severity, title, body, source)
  values (
    'tasks',
    'task_assigned',
    'info',
    'Assigned to you: ' || new.title,
    coalesce(who, 'Someone') || ' assigned you a task' ||
      case when new.due_date is not null then ', due ' || new.due_date else '' end,
    'tasks');
  return new;
end; $$;

drop trigger if exists app_task_assigned_notify on public.app_tasks;
create trigger app_task_assigned_notify after insert or update of assignee_id on public.app_tasks
  for each row execute function public.fn_app_task_assigned_notify();

-- ═══════════════════════════════════════════════════════════════════════════
-- Completion bookkeeping
-- ═══════════════════════════════════════════════════════════════════════════

-- Keep `status` and `completed_at` from disagreeing. They are separate columns
-- because the UI filters on one and displays the other, and a row saying
-- status='done' with a null completed_at breaks every date calculation
-- downstream.
create or replace function public.fn_app_task_sync_completion() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status = 'done' and new.completed_at is null then
    new.completed_at := now();
  elsif new.status <> 'done' and new.completed_at is not null
        and (tg_op = 'INSERT' or old.status = 'done') then
    -- Reopened: clear the stamp so it can't claim it was finished.
    new.completed_at := null;
    new.completed_by := null;
  end if;
  return new;
end; $$;

drop trigger if exists app_task_sync_completion on public.app_tasks;
create trigger app_task_sync_completion before insert or update on public.app_tasks
  for each row execute function public.fn_app_task_sync_completion();

-- ═══════════════════════════════════════════════════════════════════════════
-- updated_at
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare t text;
begin
  foreach t in array array['app_tasks', 'app_checklists'] loop
    execute format('drop trigger if exists %I_touch_updated_at on public.%I;', t, t);
    execute format(
      'create trigger %I_touch_updated_at before update on public.%I
         for each row execute function public.touch_updated_at();', t, t);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS
-- ═══════════════════════════════════════════════════════════════════════════

-- Everyone with access reads everything: a crew needs to see the whole job, and
-- hiding tasks from the people doing them helps nobody. Writes need `can_edit`,
-- EXCEPT that any member may tick off a step or complete a task assigned to
-- them — which is the point of the section for a viewer-level field hand.
do $$
declare t text;
begin
  foreach t in array array['app_tasks', 'app_task_steps', 'app_checklists', 'app_checklist_steps'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "read for members" on public.%I;', t);
    execute format('create policy "read for members" on public.%I for select using (has_access());', t);
    execute format('drop policy if exists "write for editors" on public.%I;', t);
    execute format(
      'create policy "write for editors" on public.%I for all using (can_edit()) with check (can_edit());', t);
  end loop;
end $$;

-- The assignee exception. A read-only user can still finish their own work.
drop policy if exists "assignee may complete own task" on public.app_tasks;
create policy "assignee may complete own task" on public.app_tasks
  for update using (has_access() and assignee_id = auth.uid())
  with check (has_access() and assignee_id = auth.uid());

drop policy if exists "assignee may tick own step" on public.app_task_steps;
create policy "assignee may tick own step" on public.app_task_steps
  for update using (
    has_access() and (
      assignee_id = auth.uid()
      or exists (select 1 from public.app_tasks t where t.id = task_id and t.assignee_id = auth.uid())
    )
  )
  with check (
    has_access() and (
      assignee_id = auth.uid()
      or exists (select 1 from public.app_tasks t where t.id = task_id and t.assignee_id = auth.uid())
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- Seed: one real checklist, from the example given
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.app_checklists (name, description, category)
select 'Field prep — shelter build',
       'Everything that has to be loaded and checked before a crew leaves to build shelters on a field.',
       'Field'
where not exists (select 1 from public.app_checklists where name = 'Field prep — shelter build');

insert into public.app_checklist_steps (checklist_id, title, notes, sort, required)
select c.id, v.title, v.notes, v.sort, v.required
from public.app_checklists c
join (values
  ('Confirm field and access route',    'Check the map for the gate, access road and any wet zones.', 1, true),
  ('Print or load the shelter map',     'Pin positions and crew route for the field.',                2, true),
  ('Load coroplast sheets',             '2 per shelter.',                                             3, true),
  ('Load pallets',                      '1 per shelter.',                                             4, true),
  ('Load anchors',                      '1 per shelter.',                                             5, true),
  ('Load zip ties',                     '4 per shelter, plus spares.',                                6, true),
  ('Load bungees',                      '2 per shelter, plus spares.',                                7, true),
  ('Load vinyl straps',                 '2 per shelter.',                                             8, true),
  ('Load rivets (1/2 in and 3/4 in)',   '6 and 14 per shelter.',                                      9, true),
  ('Rivet gun + spare mandrels',        '',                                                          10, true),
  ('Cordless drill + charged batteries','',                                                          11, true),
  ('Tape measure and marking flags',    '',                                                          12, true),
  ('Water and first aid kit',           '',                                                          13, true),
  ('Fuel up the truck',                 '',                                                          14, true),
  ('Charge the tablet for Field Mode',  'GPS shelter placement runs off it.',                        15, true),
  ('Check the weather',                 'Wind decides whether shelters can be stood up at all.',     16, true)
) as v(title, notes, sort, required) on c.name = 'Field prep — shelter build'
where not exists (
  select 1 from public.app_checklist_steps s where s.checklist_id = c.id and s.title = v.title
);
