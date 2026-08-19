-- Google Sheets two-way sync for the Overall Checklist: the agreement snapshot.
--
-- Two values cannot tell "the sheet changed" from "the app changed" — both look
-- like a disagreement, and a sync that cannot tell them apart must either always
-- prefer one side (losing the other's edits) or guess.
--
-- So each row also records what the two sides HELD AT THE END of the last sync.
-- Then a difference from that snapshot is a change, by definition, on whichever
-- side shows it. When both changed, the app wins (decided 2026-08-19) and the
-- sheet is overwritten. When only one changed, that one wins — which is what
-- makes an edit typed into the Google Sheet come back to the app.
--
-- Nullable, and null means "never synced": the first pass then sees the sheet as
-- changed and the app as unchanged, so three seasons of spreadsheet history flow
-- in rather than being overwritten by an empty app.

alter table public.field_checklist
  add column if not exists synced_planned_date   date,
  add column if not exists synced_completed_date date,
  add column if not exists synced_at             timestamptz;

comment on column public.field_checklist.synced_planned_date is
  'Value both sides held after the last sync. Differs from planned_date ⇒ the app changed it since.';
comment on column public.field_checklist.synced_completed_date is
  'Value both sides held after the last sync. Differs from completed_date ⇒ the app changed it since.';
comment on column public.field_checklist.synced_at is
  'When this row last agreed with the sheet. Null = never synced.';

create index if not exists field_checklist_synced_idx on public.field_checklist (synced_at);
