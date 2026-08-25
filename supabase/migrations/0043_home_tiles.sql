-- Which shortcut tiles a person keeps on their phone home screen.
--
-- On the profile rather than in localStorage: a crew lead who picks up a
-- different tablet, or checks something on their own phone, should find the
-- same six tiles. It is a preference about a PERSON, not about a device — the
-- opposite of the checklist's hidden columns, which are about one screen on one
-- device and stay local.
--
-- A list of keys from `src/domain/homeTiles.ts`, in the order they appear. Null
-- means "never chose", which is different from an empty list: the first shows
-- the sensible default six, the second is someone who deliberately cleared it.
alter table public.profiles
  add column if not exists home_tiles jsonb;

comment on column public.profiles.home_tiles is
  'Ordered tile keys for the phone home screen (src/domain/homeTiles.ts). NULL = never chosen, so show defaults; [] = deliberately empty.';
