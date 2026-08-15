-- ─────────────────────────────────────────────────────────────────────────────
-- TNT Operations — one-time-use OAuth state for the QuickBooks connect flow.
--
-- ── What the state parameter is for ──────────────────────────────────────────
--
-- Intuit's callback arrives as a plain browser redirect carrying no session, so
-- `state` is the only thing tying it back to the admin who started the flow.
-- Without that check, anyone who found the callback URL could complete it and
-- bind THEIR QuickBooks company to this app.
--
-- The value was already signed (HMAC-SHA256) and short-lived (10 minutes), and
-- the code comment claimed it was single-use. It was not: verification checked
-- the signature and the expiry and nothing else, so one captured value stayed
-- replayable for its whole window. This table is what makes the claim true.
--
-- ── Why a table and not memory ───────────────────────────────────────────────
--
-- The functions are serverless. A Set in module scope lives in ONE warm
-- container, so a replay landing on a different instance — or after a cold
-- start — would sail through. "Used" has to be recorded somewhere both
-- instances can see, which means the database.
--
-- The nonce is the primary key, so consuming a state is an INSERT: the second
-- attempt violates the key and is refused. No read-then-write race.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.qbo_oauth_state (
  -- Random per issued state, and the whole point of the row's existence.
  nonce   text primary key,
  used_at timestamptz not null default now()
);

-- Rows are only ever swept by age.
create index if not exists qbo_oauth_state_used_at_idx on public.qbo_oauth_state (used_at);

-- RLS ON, NO POLICIES — deny all, exactly like qbo_connection. Only the
-- service role in Netlify's environment touches this, and nothing in the
-- browser has any business reading which connect attempts have been made.
alter table public.qbo_oauth_state enable row level security;
