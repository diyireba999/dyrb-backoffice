-- DYRB Back Office: disable a login (023)
-- Run in Supabase SQL Editor after 022_usernames.sql. Safe to run again.
--
-- Someone who leaves is disabled, not deleted: their claims, payslips and the
-- documents they entered still point at them. Disabling does two things:
--   * Supabase refuses their sign-in (auth.users.banned_until).
--   * my_role() stops returning a role, so a browser already signed in loses
--     access to everything straight away instead of when its session expires.

alter table profiles add column if not exists active boolean not null default true;

create or replace function my_role() returns app_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and active
$$;

create or replace function set_login_active(p_user uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if my_role() is distinct from 'owner' then raise exception 'Only the owner can disable people'; end if;
  if p_user = auth.uid() then raise exception 'You cannot disable yourself'; end if;
  update profiles set active = p_active where id = p_user;
  if not found then raise exception 'No such login'; end if;
  update auth.users set banned_until = case when p_active then null else 'infinity'::timestamptz end,
                        updated_at = now()
   where id = p_user;
end $$;

revoke execute on function set_login_active(uuid, boolean) from public, anon;
