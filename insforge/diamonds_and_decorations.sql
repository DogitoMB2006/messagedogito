-- Diamonds economy for DogitoChat (InsForge hybrid)
-- user_id = Supabase auth UUID (no FK to InsForge auth.users)

create table if not exists public.user_diamonds (
  user_id uuid primary key,
  balance integer not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_decorations (
  user_id uuid primary key,
  owned_ids text[] not null default '{}',
  active_id text,
  updated_at timestamptz not null default now()
);

create table if not exists public.ad_watches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  watched_at timestamptz not null default now()
);

create index if not exists ad_watches_user_time_idx
  on public.ad_watches (user_id, watched_at desc);

create or replace function public.touch_user_diamonds_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_diamonds_touch_updated_at on public.user_diamonds;
create trigger user_diamonds_touch_updated_at
before update on public.user_diamonds
for each row execute function public.touch_user_diamonds_updated_at();

create or replace function public.touch_user_decorations_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_decorations_touch_updated_at on public.user_decorations;
create trigger user_decorations_touch_updated_at
before update on public.user_decorations
for each row execute function public.touch_user_decorations_updated_at();
