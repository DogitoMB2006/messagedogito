-- Diamonds: individual currency per user (persists across group changes)
-- Run in Supabase SQL Editor

-- ─── user_diamonds ────────────────────────────────────────────────────────────
create table if not exists public.user_diamonds (
  user_id uuid primary key references public.users (id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

alter table public.user_diamonds enable row level security;

-- Anyone can read any user's balance (for future leaderboard / display)
create policy "diamonds_select_any"
  on public.user_diamonds for select
  using (true);

create policy "diamonds_insert_own"
  on public.user_diamonds for insert
  with check (auth.uid() = user_id);

create policy "diamonds_update_own"
  on public.user_diamonds for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.touch_user_diamonds_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists user_diamonds_touch_updated_at on public.user_diamonds;
create trigger user_diamonds_touch_updated_at
before update on public.user_diamonds
for each row execute procedure public.touch_user_diamonds_updated_at();

-- ─── user_decorations ─────────────────────────────────────────────────────────
create table if not exists public.user_decorations (
  user_id uuid primary key references public.users (id) on delete cascade,
  owned_ids text[] not null default '{}',
  active_id text,
  updated_at timestamptz not null default now()
);

alter table public.user_decorations enable row level security;

-- Anyone can read decorations (to render other users' bubble styles)
create policy "decorations_select_any"
  on public.user_decorations for select
  using (true);

create policy "decorations_insert_own"
  on public.user_decorations for insert
  with check (auth.uid() = user_id);

create policy "decorations_update_own"
  on public.user_decorations for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.touch_user_decorations_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists user_decorations_touch_updated_at on public.user_decorations;
create trigger user_decorations_touch_updated_at
before update on public.user_decorations
for each row execute procedure public.touch_user_decorations_updated_at();

-- ─── ad_watches ───────────────────────────────────────────────────────────────
create table if not exists public.ad_watches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  watched_at timestamptz not null default now()
);

create index if not exists ad_watches_user_time_idx
  on public.ad_watches (user_id, watched_at desc);

alter table public.ad_watches enable row level security;

create policy "ad_watches_select_own"
  on public.ad_watches for select
  using (auth.uid() = user_id);

create policy "ad_watches_insert_own"
  on public.ad_watches for insert
  with check (auth.uid() = user_id);
