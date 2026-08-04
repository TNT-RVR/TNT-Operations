-- Repair double-encoded text in the imported incubation data.
--
-- During the original import, UTF-8 bytes were written as if they were cp1252,
-- so "Day 17–18 — Male emergence" became "Day 17â€œ18 â€ Male emergence".
--
-- This matters beyond looks: tray_inspections.dev_stage must match a DEV_STAGES
-- label EXACTLY for the app to compare an observation against the schedule, and
-- a mangled label never will.
--
-- SCOPE (measured, not assumed):
--   alerts.message                 139 rows  — all mojibake
--   tray_inspections.dev_stage       2 rows  — all mojibake
--   app_notifications.body          21 rows  — NON-ASCII BUT CORRECT. These are
--                                    written by the Govee poller in proper
--                                    UTF-8; they are deliberately NOT touched.
--
-- Every sequence below was extracted from the live data, not guessed:
--   Â°   (U+00C2 U+00B0)          283x  ->  °
--   â€ (U+00E2 U+20AC U+201D)   13x  ->  —  em dash
--   Î   (U+00CE U+201D)             9x  ->  Δ  delta
--   â€œ (U+00E2 U+20AC U+0153)    2x  ->  “
--   â€ (U+00E2 U+20AC U+009D)     2x  ->  ”
--   â€™ (U+00E2 U+20AC U+2122)    1x  ->  ’
--   â€“ (U+00E2 U+20AC U+201C)    1x  ->  –  en dash
--
-- Characters are written as chr(N) so this file's own encoding can't corrupt
-- the fix — the exact problem we're repairing.
--
-- Order matters: three-character sequences run first, and the rules that CREATE
-- chr(8220)/chr(8221) run after the rules that CONSUME them, so a repair can't
-- manufacture a new false match.

begin;

-- ── Before ───────────────────────────────────────────────────────────────────
select 'BEFORE' as stage,
       (select count(*) from public.alerts
         where message like '%' || chr(194) || '%'
            or message like '%' || chr(226) || chr(8364) || '%'
            or message like '%' || chr(206) || chr(8221) || '%') as alerts_mojibake,
       (select count(*) from public.tray_inspections
         where dev_stage like '%' || chr(226) || chr(8364) || '%') as dev_stage_mojibake;

-- ── alerts.message ───────────────────────────────────────────────────────────
update public.alerts
set message =
  replace(                                          -- 7. degree
    replace(                                        -- 6. right single quote
      replace(                                      -- 5. right double quote
        replace(                                    -- 4. left double quote
          replace(                                  -- 3. en dash
            replace(                                -- 2. delta
              replace(                              -- 1. em dash
                message,
                chr(226) || chr(8364) || chr(8221), chr(8212)),
              chr(206) || chr(8221), chr(916)),
            chr(226) || chr(8364) || chr(8220), chr(8211)),
          chr(226) || chr(8364) || chr(339), chr(8220)),
        chr(226) || chr(8364) || chr(157), chr(8221)),
      chr(226) || chr(8364) || chr(8482), chr(8217)),
    chr(194) || chr(176), chr(176))
where message like '%' || chr(194) || '%'
   or message like '%' || chr(226) || chr(8364) || '%'
   or message like '%' || chr(206) || chr(8221) || '%';

-- ── tray_inspections.dev_stage ───────────────────────────────────────────────
update public.tray_inspections
set dev_stage =
  replace(
    replace(
      replace(
        replace(
          replace(
            replace(
              replace(
                dev_stage,
                chr(226) || chr(8364) || chr(8221), chr(8212)),
              chr(206) || chr(8221), chr(916)),
            chr(226) || chr(8364) || chr(8220), chr(8211)),
          chr(226) || chr(8364) || chr(339), chr(8220)),
        chr(226) || chr(8364) || chr(157), chr(8221)),
      chr(226) || chr(8364) || chr(8482), chr(8217)),
    chr(194) || chr(176), chr(176))
where dev_stage like '%' || chr(226) || chr(8364) || '%';

-- ── After: both counts should be 0, and the samples should read correctly ────
select 'AFTER' as stage,
       (select count(*) from public.alerts
         where message like '%' || chr(194) || '%'
            or message like '%' || chr(226) || chr(8364) || '%'
            or message like '%' || chr(206) || chr(8221) || '%') as alerts_mojibake,
       (select count(*) from public.tray_inspections
         where dev_stage like '%' || chr(226) || chr(8364) || '%') as dev_stage_mojibake;

-- The two dev_stage values must now match DEV_STAGES exactly, or the app can't
-- compare an observation to the schedule.
select dev_stage, count(*) from public.tray_inspections group by dev_stage;

-- A sample of each repaired alert type, to eyeball before committing.
select distinct on (alert_type) alert_type, message from public.alerts order by alert_type, triggered_at desc;

-- Check the output above, then:
commit;
-- ...or if anything looks wrong:
-- rollback;
