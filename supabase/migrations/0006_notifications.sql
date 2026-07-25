-- ─────────────────────────────────────────────────────────────────────────────
-- TNT Operations — notifications / alert system.
--
-- A shared alert inbox (read/unread state on the row) plus per-user channel
-- preferences. Alerts are raised by the app or by scheduled functions (e.g. the
-- integration-health monitor: "the Govee feed has gone stale"). The web app
-- shows a bell + unread dot and a Notifications view.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  category    text not null default 'system',                 -- integration | incubation | maps | system
  type        text not null,                                  -- e.g. sensor_feed_stale, temp_out_of_range
  severity    text not null default 'warning' check (severity in ('info', 'warning', 'critical')),
  title       text not null,
  body        text not null default '',
  source      text not null default '',                       -- e.g. govee_poller
  dedup_key   text,                                           -- suppress repeats of the same active alert
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  read_at     timestamptz,                                    -- null = unread (shared inbox)
  deleted_at  timestamptz                                     -- soft delete
);
create index if not exists notifications_active_idx
  on public.notifications (created_at desc) where deleted_at is null;
-- One active (undeleted, unread) alert per dedup_key — a stalled feed shouldn't
-- pile up a new alert every cycle.
create unique index if not exists notifications_dedup_idx
  on public.notifications (dedup_key)
  where dedup_key is not null and deleted_at is null and read_at is null;

-- Per-user channel preferences, keyed by alert type. Absent row → defaults.
create table if not exists public.notification_prefs (
  user_id  uuid not null references auth.users (id) on delete cascade,
  type     text not null,
  in_app   boolean not null default true,
  email    boolean not null default false,
  push     boolean not null default false,
  primary key (user_id, type)
);

alter table public.notifications      enable row level security;
alter table public.notification_prefs enable row level security;

-- Notifications: any user with a real role can read / mark read / delete; only
-- editors may insert manually (scheduled functions use the service role, which
-- bypasses RLS).
drop policy if exists "notif read" on public.notifications;
create policy "notif read" on public.notifications
  for select to authenticated using (public.has_access());
drop policy if exists "notif update" on public.notifications;
create policy "notif update" on public.notifications
  for update to authenticated using (public.has_access()) with check (public.has_access());
drop policy if exists "notif delete" on public.notifications;
create policy "notif delete" on public.notifications
  for delete to authenticated using (public.has_access());
drop policy if exists "notif insert" on public.notifications;
create policy "notif insert" on public.notifications
  for insert to authenticated with check (public.can_edit());

-- Prefs: each user manages only their own rows.
drop policy if exists "prefs own" on public.notification_prefs;
create policy "prefs own" on public.notification_prefs
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Realtime so a new alert lights the bell without a refresh.
do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; end $$;
