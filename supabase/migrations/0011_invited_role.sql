-- Admin invites: let the inviter choose the new user's role up front.
--
-- Self-serve signups still land as 'pending' and wait for approval (0005). But
-- when an admin invites someone, they have already decided what that person
-- should be, so the invite carries the role in the auth user's metadata and the
-- profile trigger honours it. The invitee signs in and is immediately useful —
-- no second approval step.
--
-- Only the assignable roles are accepted; anything else (including a forged or
-- misspelled value) falls back to 'pending', so a bad metadata value can never
-- escalate someone to admin.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  invited text := new.raw_user_meta_data ->> 'role';
  final_role public.app_role;
begin
  if invited in ('admin', 'developer', 'operator', 'viewer') then
    final_role := invited::public.app_role;
  else
    final_role := 'pending';
  end if;

  insert into public.profiles (id, name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    coalesce(new.email, ''),
    final_role
  )
  on conflict (id) do nothing;
  return new;
end $$;
