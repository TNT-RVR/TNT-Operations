-- Did the chamber actually DO it?
--
-- Three different questions were collapsed into two columns, and the one that
-- matters operationally had no column at all:
--
--   ok           - the app accepted the command into the queue
--   delivered_at - the device collected it on one of its posts
--   (nothing)    - the chamber acted on it
--
-- The firmware has always known the answer. `startBurst` repeats a command to
-- the Nano until the Nano's own telemetry confirms it, and gives up after eight
-- seconds with `TX->NANO BURST: timeout (no telemetry confirm)`. That verdict
-- went to the serial cable and nowhere else, so in the app a purge looked
-- identical whether the chamber purged or ignored it.
--
-- Found commissioning the first chamber: a purge was sent, something was
-- audible at the machine, the Nano never reported `"purge":1`, and the app
-- showed a command sent successfully. For the mechanism that keeps a sealed
-- box at 10% oxygen, "I asked and nothing came back" has to be visible.

alter table public.hypoxia_commands
  add column confirmed_at timestamptz,
  add column outcome text
    check (outcome in ('confirmed', 'timeout'));

comment on column public.hypoxia_commands.confirmed_at is
  'When the DEVICE reported the outcome back. NULL = delivered but not yet reported on.';

comment on column public.hypoxia_commands.outcome is
  'What the chamber did: confirmed = the Nano''s telemetry showed the command took effect; timeout = the firmware repeated it for its burst window and the Nano never confirmed. NULL = no report yet, which for a command delivered long ago means the device stopped talking mid-command.';

-- The screen asks "how did the recent commands for this chamber go", newest
-- first. Narrow: only rows that were actually delivered can have an outcome.
create index hypoxia_commands_outcome_idx
  on public.hypoxia_commands (chamber_id, sent_at desc)
  where delivered_at is not null;
