-- Chambers report to TNT directly. ThingsBoard is out.
--
-- 0048 assumed the student's ThingsBoard account stayed in the middle: the
-- chambers published to it and commands came back from it as RPC. TNT does not
-- own that account, and depending on one we cannot administer — for the only
-- path to a sealed chamber full of live bees — is not a dependency worth
-- keeping.
--
-- So the ESP32 posts its telemetry straight here and reads its next command out
-- of the SAME response. One round trip does both, which removes the broker, the
-- persistent connection and the RPC plumbing all at once. Latency is one
-- publish cycle (~15 s), which is nothing for "purge" or "set target".
--
-- ── The token problem, solved rather than rotated ──────────────────────────
--
-- The student's firmware carried its ThingsBoard token as a string literal, so
-- anyone who saw the source could command the chamber. Here the device holds a
-- key and the DATABASE holds only its SHA-256, so a copy of this schema, a
-- backup, or a leaked query result cannot be replayed against a chamber. The
-- key is shown once, when it is generated, and never again.

alter table public.hypoxia_chambers
  add column if not exists device_key_hash text unique,
  -- Last four characters, so a person can tell two chambers' keys apart
  -- without the key itself being recoverable.
  add column if not exists device_key_hint text not null default '',
  add column if not exists key_set_at timestamptz;

-- `tb_device_id` is left in place rather than dropped. It holds nothing (no
-- chamber was ever linked) and dropping a column is irreversible, which the
-- run-sql guard is right to make deliberate. Retired, not used, not read.
comment on column public.hypoxia_chambers.tb_device_id is
  'RETIRED 2026-08-29 with the move off ThingsBoard. Always NULL; nothing reads it.';
comment on column public.hypoxia_chambers.device_key_hash is
  'SHA-256 of the device key. The key itself is shown once at generation and never stored.';

-- ── Commands become a queue ────────────────────────────────────────────────
--
-- With no broker there is nothing to push to a device, so the device collects
-- instead: the next undelivered command rides back on its own telemetry POST.
-- `delivered_at` is stamped when it does, which is also the audit answer to
-- "did the chamber ever actually receive that".
alter table public.hypoxia_commands
  add column if not exists delivered_at timestamptz;

-- The ingest endpoint asks for one row, oldest first, per chamber.
create index if not exists hypoxia_commands_pending_idx
  on public.hypoxia_commands (chamber_id, sent_at)
  where delivered_at is null;

comment on column public.hypoxia_commands.delivered_at is
  'When the device collected this command. NULL = still queued.';
comment on column public.hypoxia_commands.ok is
  'Whether the command was accepted into the queue. Delivery is delivered_at.';
