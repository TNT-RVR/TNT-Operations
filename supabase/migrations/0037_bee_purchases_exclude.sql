-- ─────────────────────────────────────────────────────────────────────────────
-- TNT Operations — remove a bee-purchase row from the app, not from QuickBooks.
--
-- ── Why a flag and not a delete ──────────────────────────────────────────────
--
-- Rows synced from QuickBooks are upserted on `qbo_id` every Monday. Deleting
-- one outright would work until the next run put it straight back, which is a
-- particularly annoying kind of bug: the row returns days later, on its own,
-- with no trace of what happened.
--
-- So a QuickBooks row is EXCLUDED rather than deleted. The sync keeps the line
-- current — it is still a real transaction in the books — and the app stops
-- counting it. The sync never writes this column, so an exclusion survives
-- every future run.
--
-- Hand-typed rows are still deleted for real: nothing recreates them, and a row
-- you typed by mistake should simply go.
--
-- Nothing here touches QuickBooks. Excluding a line does not delete, void or
-- alter the underlying bill — the money stays exactly where the accountant put
-- it, which is the whole point of the app being downstream of the books.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.bee_purchases
  add column if not exists excluded_at timestamptz;

comment on column public.bee_purchases.excluded_at is
  'Set = hidden from the app''s totals. Never written by the sync, so it survives a re-sync. Does NOT affect QuickBooks.';

-- Reads filter on it constantly; the season index alone does not cover it.
create index if not exists bee_purchases_visible_idx
  on public.bee_purchases (season, purchase_date) where excluded_at is null;
