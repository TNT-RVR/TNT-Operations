-- ─────────────────────────────────────────────────────────────────────────────
-- TNT Operations — record Intuit's transaction id on every sync attempt.
--
-- Intuit stamps every API response with an `intuit_tid` header. It is the first
-- thing their support asks for, and once a call is over it is the only handle
-- on that specific call — our own timestamps and messages cannot identify it on
-- their side. Capturing it costs one column and turns "a push failed sometime
-- Tuesday" into a request they can act on.
--
-- Nullable on purpose: it is absent for failures that never reached Intuit at
-- all (a missing tax code, an order with no lines), and a null correctly says
-- "there is no Intuit call to look up" rather than inventing one.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.qbo_sync_log
  add column if not exists intuit_tid text;

-- Support asks by tid, so that is how it gets looked up.
create index if not exists qbo_sync_log_intuit_tid_idx
  on public.qbo_sync_log (intuit_tid)
  where intuit_tid is not null;
