-- Web push: where to send, and what's already been sent.
--
-- One row per DEVICE, not per user — the same person signing in on a phone and
-- a tablet gets two subscriptions and should be reached on both. The browser's
-- endpoint URL is the natural identity, so it carries the unique constraint;
-- re-subscribing on the same device updates its keys rather than duplicating.
--
-- Subscriptions die on their own (browser reinstalled, permission revoked,
-- push service expires them). The sender marks those gone rather than deleting
-- immediately, so a transient failure can't silently unsubscribe someone.

create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  -- The push service URL the browser handed us. Unique = one row per device.
  endpoint     text not null unique,
  -- Encryption material from PushSubscription.getKey().
  p256dh       text not null,
  auth         text not null,
  -- Helps a user recognise which device a row is, when managing them.
  user_agent   text not null default '',
  created_at   timestamptz not null default now(),
  last_sent_at timestamptz,
  -- Set when the push service says this endpoint is permanently gone (404/410).
  -- Kept rather than deleted so the row can be inspected after the fact.
  expired_at   timestamptz
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id) where expired_at is null;

-- RLS: a subscription is personal. Users manage only their own rows; the
-- service role (the Netlify sender) bypasses RLS entirely.
alter table public.push_subscriptions enable row level security;

drop policy if exists "own subscriptions read" on public.push_subscriptions;
create policy "own subscriptions read" on public.push_subscriptions
  for select using (auth.uid() = user_id);

drop policy if exists "own subscriptions write" on public.push_subscriptions;
create policy "own subscriptions write" on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- `alerts.dedup_key` and `alerts.notified` already exist (imported from the
-- desktop app) and are what the sender uses to avoid re-notifying the same
-- condition every polling cycle. Index the lookup it does on every run.
create index if not exists alerts_dedup_recent_idx
  on public.alerts (dedup_key, triggered_at desc);
