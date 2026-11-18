-- Usernames for accounts (sign in with username or email + password).
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.

-- One username per account. Usernames are public (they appear on reviews); emails are never exposed.
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "Usernames are public" on public.profiles;
drop policy if exists "Create own profile" on public.profiles;
drop policy if exists "Change own username" on public.profiles;
create policy "Usernames are public" on public.profiles for select using (true);
create policy "Create own profile" on public.profiles for insert with check (auth.uid() = user_id);
create policy "Change own username" on public.profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select on public.profiles to anon, authenticated;
grant insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;

-- New accounts get their profile from the username chosen at sign-up.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.raw_user_meta_data ->> 'username', '') <> '' then
    insert into public.profiles (user_id, username) values (new.id, lower(new.raw_user_meta_data ->> 'username'));
  end if;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- The sign-up form checks whether a username is free.
create or replace function public.username_available(name text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.profiles where username = lower(name));
$$;
revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;

-- Username -> email, for the website's sign-in endpoint only (it runs on Cloudflare with the secret key).
-- Browsers can't call this, so nobody can look up someone's email from their username.
create or replace function public.email_for_username(name text) returns text
language sql stable security definer set search_path = public, auth as $$
  select u.email from auth.users u join public.profiles p on p.user_id = u.id where p.username = lower(name);
$$;
revoke all on function public.email_for_username(text) from public, anon, authenticated;
grant execute on function public.email_for_username(text) to service_role;
