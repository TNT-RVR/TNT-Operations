-- ─────────────────────────────────────────────────────────────────────────────
-- TNT Operations — profile photos.
--
-- On `profiles` rather than in a table of their own, because unlike a signature
-- an avatar is PUBLIC: it appears next to every task the person is assigned,
-- so anyone who can see the task must be able to see the photo. A signature is
-- the opposite (see 0019) and that is why the two are stored differently.
--
-- No new policies. `profiles self or admin update` from 0001 already says a
-- person may edit their own row and an admin may edit anyone's — which is
-- exactly "users or admin can add a photo".
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.profiles add column if not exists avatar text;

-- Stored downscaled to a 256 px square, so a real photo lands around 10–30 KB.
-- The ceiling is a backstop against someone writing a full-size image straight
-- into the column: 200 KB of base64 per row, multiplied by every task list that
-- renders it, is a slow app rather than a broken one — the worst kind of bug to
-- track down later.
alter table public.profiles drop constraint if exists profiles_avatar_size;
alter table public.profiles
  add constraint profiles_avatar_size check (avatar is null or length(avatar) < 200000);
