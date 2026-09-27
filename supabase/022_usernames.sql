-- DYRB Back Office: sign in with a username, owner adds people (022)
-- Run in Supabase SQL Editor after 021_entertainment.sql. Safe to run again.
--
-- Supabase only knows emails, so a username is stored as the login email
-- "<username>@dyrb.local". Nobody sees that address and nothing is ever sent
-- to it. The website turns what is typed in the Username box into it.
--
-- Existing people keep their password; their username becomes the part of
-- their email before the @ (diyireba@gmail.com -> diyireba). There are no more
-- "forgot password" emails: the owner sets a new password on the Users screen.
--
-- Adding a login from the browser would normally need the service key, which
-- must never reach the browser. These functions run on the database instead,
-- and only for the owner. They write auth.users directly, which Supabase does
-- not document as stable; if a Supabase upgrade ever breaks sign-in for new
-- people, this is the file to look at.

-- The Supabase SQL editor chokes on a dollar sign inside quotes, so usernames are
-- checked as "right length, no character outside a-z 0-9 . _ -" instead.
alter table profiles add column if not exists username text unique
  check (length(username) between 3 and 30 and username !~ '[^a-z0-9._-]');

-- Existing people: username from their email, login email rewritten to match.
update profiles p set username = lower(split_part(u.email, '@', 1))
  from auth.users u where u.id = p.id;
update auth.users u set email = p.username || '@dyrb.local'
  from profiles p where p.id = u.id;
update auth.identities i set identity_data = i.identity_data || jsonb_build_object('email', p.username || '@dyrb.local')
  from profiles p where p.id = i.user_id and i.provider = 'email';

alter table profiles alter column username set not null;

-- New logins get their username from the login email, so the row is complete.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name, username)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), lower(split_part(new.email, '@', 1)));
  return new;
end $$;

-- Owner adds a person with a username and a first password.
create or replace function create_login(p_username text, p_full_name text, p_role app_role, p_password text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid := gen_random_uuid(); uname text := lower(trim(p_username)); mail text;
begin
  if my_role() is distinct from 'owner' then raise exception 'Only the owner can add people'; end if;
  if length(uname) not between 3 and 30 or uname ~ '[^a-z0-9._-]' then
    raise exception 'Username: 3-30 characters, letters, numbers, dot, dash or underscore'; end if;
  if length(p_password) < 8 then raise exception 'Password must be at least 8 characters'; end if;
  if exists (select 1 from profiles where username = uname) then raise exception 'Username % is taken', uname; end if;
  mail := uname || '@dyrb.local';

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change, email_change_token_new)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', mail,
          crypt(p_password, gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', p_full_name),
          now(), now(), '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), uid, uid::text,
          jsonb_build_object('sub', uid::text, 'email', mail, 'email_verified', true), 'email', now(), now(), now());

  -- handle_new_user() has made the profile row already.
  update profiles set full_name = p_full_name, role = p_role where id = uid;
  return uid;
end $$;

-- Owner sets a new password for someone who forgot theirs.
create or replace function set_login_password(p_user uuid, p_password text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if my_role() is distinct from 'owner' then raise exception 'Only the owner can reset passwords'; end if;
  if length(p_password) < 8 then raise exception 'Password must be at least 8 characters'; end if;
  update auth.users set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now() where id = p_user;
  if not found then raise exception 'No such login'; end if;
end $$;

revoke execute on function create_login(text, text, app_role, text) from public, anon;
revoke execute on function set_login_password(uuid, text) from public, anon;
