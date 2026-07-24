-- ─────────────────────────────────────────────────────────────────────────────
-- TNT Operations — allow legacy blanks on incubator threshold/order columns.
--
-- 0003 created these NOT NULL (with a default). Real incubators in the old DB
-- left them blank, and we want to preserve that blank rather than invent a
-- value, so drop the NOT NULL. The DEFAULT stays for app-created rows.
-- (For a fresh install 0003 already declares them nullable, so this is a no-op.)
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.incubators alter column humidity_min drop not null;
alter table public.incubators alter column humidity_max drop not null;
alter table public.incubators alter column sort_order   drop not null;
