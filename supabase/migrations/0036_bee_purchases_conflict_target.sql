-- ─────────────────────────────────────────────────────────────────────────────
-- TNT Operations — make the bee-purchase upsert's ON CONFLICT target usable.
--
-- 0035 created the uniqueness as a PARTIAL index:
--
--   create unique index bee_purchases_qbo_uidx
--     on public.bee_purchases (qbo_id) where qbo_id is not null;
--
-- Postgres will only infer a partial index as an ON CONFLICT arbiter when the
-- statement repeats the same predicate — `on conflict (qbo_id) where qbo_id is
-- not null`. PostgREST emits a bare `on conflict (qbo_id)`, so the upsert failed
-- outright with 42P10, "no unique or exclusion constraint matching the ON
-- CONFLICT specification". The sync could read QuickBooks and then not store a
-- single row.
--
-- The predicate was never needed. A plain unique index already permits any
-- number of NULLs — Postgres treats NULLs as distinct unless a constraint is
-- declared NULLS NOT DISTINCT — so the many manual rows carrying no qbo_id
-- coexist happily under a full index. Every other on_conflict target in this
-- codebase is a primary key or a plain unique constraint; this was the odd one.
-- ─────────────────────────────────────────────────────────────────────────────

drop index if exists public.bee_purchases_qbo_uidx;

create unique index if not exists bee_purchases_qbo_uidx
  on public.bee_purchases (qbo_id);

-- ── Verify ───────────────────────────────────────────────────────────────────
-- `indpred` must be NULL. A non-null predicate means it is still partial and
-- the upsert will keep failing.
--
--   select i.relname, x.indpred is null as usable_for_on_conflict
--   from pg_index x
--   join pg_class i on i.oid = x.indexrelid
--   where i.relname = 'bee_purchases_qbo_uidx';
