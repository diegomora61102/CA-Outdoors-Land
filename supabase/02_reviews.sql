-- Campground reviews. Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Anyone can read reviews; signed-in people can write one review per place and edit or delete only their own.
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  author text not null check (char_length(author) between 1 and 60),
  rating smallint not null check (rating between 1 and 5),
  body text not null check (char_length(body) between 1 and 2000),
  visited text check (visited is null or char_length(visited) <= 40),
  created_at timestamptz not null default now(),
  unique (site_id, user_id)
);
create index if not exists reviews_site_idx on public.reviews (site_id, created_at desc);
alter table public.reviews enable row level security;
drop policy if exists "Reviews are public" on public.reviews;
drop policy if exists "Write own review" on public.reviews;
drop policy if exists "Edit own review" on public.reviews;
drop policy if exists "Delete own review" on public.reviews;
create policy "Reviews are public" on public.reviews for select using (true);
create policy "Write own review" on public.reviews for insert with check (auth.uid() = user_id);
create policy "Edit own review" on public.reviews for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Delete own review" on public.reviews for delete using (auth.uid() = user_id);
grant select on public.reviews to anon, authenticated;
grant insert, update, delete on public.reviews to authenticated;
grant all on public.reviews to service_role;
