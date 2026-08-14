-- ═══════════════════════════════════════════════════════════════════════════
-- 0031 — shelter removal as a third kind of work order
--
-- Placing shelters and taking them back out are different jobs done weeks
-- apart, with different loads: one leaves with a trailer full and comes back
-- empty, the other the reverse. 0030 only knew about putting things out.
--
-- Nothing is dropped and nothing is rewritten: the CHECK is replaced with a
-- wider one, so every booking already made stays valid.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.calendar_events
  drop constraint if exists calendar_events_task_check;

alter table public.calendar_events
  add constraint calendar_events_task_check
  check (task is null or task in ('shelter', 'tray', 'removal'));

-- The crews table carries the same vocabulary for "what is this crew on right
-- now", and would otherwise refuse an assignment the calendar accepts.
alter table public.field_crews
  drop constraint if exists field_crews_current_task_check;

alter table public.field_crews
  add constraint field_crews_current_task_check
  check (current_task is null or current_task in ('shelter', 'tray', 'removal'));
