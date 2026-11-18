-- CA Outdoors Land: database setup. Run once in Supabase: SQL Editor -> New query -> paste -> Run.

-- Live data written by the scheduled jobs (weather, status, alerts). Anyone can read; only the
-- service-role key used by GitHub Actions can write (it bypasses row-level security).
create table if not exists public.feeds (
  key text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.feeds enable row level security;
drop policy if exists "Feeds are public" on public.feeds;
create policy "Feeds are public" on public.feeds for select using (true);

-- Each person's saved places. Only that person can see or change their own rows.
create table if not exists public.favorites (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  site_id text not null,
  kind text not null,
  kind_label text,
  name text not null,
  lat double precision,
  lon double precision,
  note text,
  created_at timestamptz not null default now(),
  primary key (user_id, site_id)
);
alter table public.favorites enable row level security;
drop policy if exists "Read own favorites" on public.favorites;
drop policy if exists "Add own favorites" on public.favorites;
drop policy if exists "Change own favorites" on public.favorites;
drop policy if exists "Remove own favorites" on public.favorites;
create policy "Read own favorites" on public.favorites for select using (auth.uid() = user_id);
create policy "Add own favorites" on public.favorites for insert with check (auth.uid() = user_id);
create policy "Change own favorites" on public.favorites for update using (auth.uid() = user_id);
create policy "Remove own favorites" on public.favorites for delete using (auth.uid() = user_id);

-- Shared lists: a snapshot of someone's places that anyone with the link (?list=<id>) can open.
-- The random id is the only way to find a list; lists can't be browsed or searched.
create table if not exists public.shared_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) <= 120),
  items jsonb not null check (jsonb_array_length(items) <= 500),
  created_at timestamptz not null default now()
);
alter table public.shared_lists enable row level security;
drop policy if exists "Open a shared list by link" on public.shared_lists;
drop policy if exists "Create own shared lists" on public.shared_lists;
drop policy if exists "Delete own shared lists" on public.shared_lists;
create policy "Open a shared list by link" on public.shared_lists for select using (true);
create policy "Create own shared lists" on public.shared_lists for insert with check (auth.uid() = user_id);
create policy "Delete own shared lists" on public.shared_lists for delete using (auth.uid() = user_id);

-- Table access for the website (anon = signed out, authenticated = signed in) and the scheduled
-- jobs (service_role). Newer Supabase projects don't grant these automatically. Row-level security
-- above still decides which rows each person can see or change.
grant usage on schema public to anon, authenticated, service_role;
grant select on public.feeds to anon, authenticated;
grant select, insert, update, delete on public.feeds to service_role;
grant select, insert, update, delete on public.favorites to authenticated;
grant all on public.favorites to service_role;
grant select on public.shared_lists to anon, authenticated;
grant insert, delete on public.shared_lists to authenticated;
grant all on public.shared_lists to service_role;
