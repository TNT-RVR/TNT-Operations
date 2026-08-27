-- Mark a notification as having been pushed, so a sweeper can find the rest.
--
-- Push delivery lives in the alert PRODUCERS: poll-govee, watchdog,
-- notify-milestones and tasks-tick each write their inbox row and then send to
-- whoever opted in. That works, and it is instant, but it only covers alerts
-- raised by a Netlify function.
--
-- Two are not. `qbo_sync_failed` and `qbo_auth_expired` are raised by TRIGGERS
-- in 0017, inside the database, where there is no sender to call — the row
-- landed in the bell and nothing ever reached a phone, however the preference
-- was set. Seven of them went out that way in three weeks.
--
-- Rather than teach the triggers to make an HTTP call (which needs pg_net and a
-- shared secret stored in the database, where a migration in a public repo
-- cannot safely put one), a scheduled function sweeps up anything unpushed.
-- The cost is latency measured in minutes, which for "your QuickBooks token
-- expired" is no cost at all. The benefit is that ANY row, from any path —
-- trigger, function, or a person inserting one by hand — gets delivered, with
-- nobody having to remember to wire a sender.
--
-- So this column means "delivery has been dealt with", NOT "a push was sent":
-- a producer that pushes stamps it at insert, and so does one that has decided
-- nobody should be pushed. The sweeper only looks at NULL.
alter table public.app_notifications
  add column if not exists pushed_at timestamptz;

comment on column public.app_notifications.pushed_at is
  'When push delivery was handled for this row (or declined). NULL = the sweeper in netlify/functions/push-pending.mjs still owes it a look.';

-- The sweeper's query: unpushed, recent, newest first.
create index if not exists app_notifications_unpushed_idx
  on public.app_notifications (created_at)
  where pushed_at is null and deleted_at is null;
