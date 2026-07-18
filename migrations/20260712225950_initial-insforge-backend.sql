create extension if not exists pgcrypto;

-- Fresh InsForge backend schema for DogitoChat. Supabase remains storage-only.

create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  display_name text,
  avatar_url text,
  banner_url text,
  bio text,
  presence_status text not null default 'offline' check (presence_status in ('online', 'idle', 'busy', 'offline')),
  presence_updated_at timestamptz,
  presence_manual text not null default 'online' check (presence_manual in ('online', 'idle', 'busy')),
  privacy_appear_offline boolean not null default false,
  privacy_desktop_notifications boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  is_group boolean not null default false,
  owner_id uuid references public.users (id) on delete set null default auth.uid(),
  name text,
  avatar_url text,
  bio text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_participants (
  chat_id uuid not null references public.chats (id) on delete cascade,
  user_id uuid not null constraint chat_participants_user_id_fkey references public.users (id) on delete cascade,
  group_role_id uuid,
  last_read_at timestamptz,
  notifications_muted boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (chat_id, user_id)
);

create table if not exists public.group_roles (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats (id) on delete cascade,
  name text not null,
  can_kick boolean not null default false,
  can_edit_group_profile boolean not null default false,
  can_delete_others_messages boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.chat_participants
  add constraint chat_participants_group_role_id_fkey
  foreign key (group_role_id) references public.group_roles (id) on delete set null;

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats (id) on delete cascade,
  sender_id uuid not null references public.users (id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.friends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null constraint friends_user_id_fkey references public.users (id) on delete cascade,
  friend_id uuid not null constraint friends_friend_id_fkey references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint friends_distinct_users check (user_id <> friend_id),
  constraint friends_pair_unique unique (user_id, friend_id)
);

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null constraint friend_requests_sender_id_fkey references public.users (id) on delete cascade,
  receiver_id uuid not null constraint friend_requests_receiver_id_fkey references public.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint friend_requests_distinct_users check (sender_id <> receiver_id),
  constraint friend_requests_pair_unique unique (sender_id, receiver_id)
);

create table if not exists public.chat_typing (
  chat_id uuid not null references public.chats (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  display_name text not null default '',
  updated_at timestamptz not null default now(),
  primary key (chat_id, user_id)
);

create table if not exists public.voice_calls (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats (id) on delete cascade,
  caller_id uuid not null references public.users (id) on delete cascade,
  callee_id uuid not null references public.users (id) on delete cascade,
  status text not null default 'ringing' check (status in ('ringing', 'active', 'ended', 'declined', 'missed', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz,
  constraint voice_calls_distinct_users check (caller_id <> callee_id)
);

create table if not exists public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  token text not null unique,
  platform text not null check (platform in ('android')),
  app_version text,
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stickers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users (id) on delete cascade,
  url text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.sticker_favorites (
  user_id uuid not null references public.users (id) on delete cascade,
  sticker_id uuid not null references public.stickers (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, sticker_id)
);

create table if not exists public.user_diamonds (
  user_id uuid primary key references public.users (id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_decorations (
  user_id uuid primary key references public.users (id) on delete cascade,
  owned_ids text[] not null default '{}',
  active_id text,
  updated_at timestamptz not null default now()
);

create table if not exists public.ad_watches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  watched_at timestamptz not null default now()
);

create index if not exists chats_owner_idx on public.chats (owner_id);
create index if not exists chat_participants_user_idx on public.chat_participants (user_id);
create index if not exists chat_participants_group_role_idx on public.chat_participants (group_role_id);
create index if not exists group_roles_chat_idx on public.group_roles (chat_id);
create index if not exists messages_chat_created_idx on public.messages (chat_id, created_at);
create index if not exists messages_sender_idx on public.messages (sender_id);
create index if not exists friend_requests_receiver_status_idx on public.friend_requests (receiver_id, status, created_at desc);
create index if not exists chat_typing_chat_updated_idx on public.chat_typing (chat_id, updated_at desc);
create index if not exists voice_calls_chat_created_idx on public.voice_calls (chat_id, created_at desc);
create index if not exists voice_calls_callee_status_created_idx on public.voice_calls (callee_id, status, created_at desc);
create index if not exists push_tokens_user_platform_idx on public.push_tokens (user_id, platform) where disabled_at is null;
create index if not exists stickers_owner_created_idx on public.stickers (owner_id, created_at);
create index if not exists ad_watches_user_time_idx on public.ad_watches (user_id, watched_at desc);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists users_touch_updated_at on public.users;
create trigger users_touch_updated_at before update on public.users for each row execute function public.touch_updated_at();
drop trigger if exists chats_touch_updated_at on public.chats;
create trigger chats_touch_updated_at before update on public.chats for each row execute function public.touch_updated_at();
drop trigger if exists messages_touch_updated_at on public.messages;
create trigger messages_touch_updated_at before update on public.messages for each row execute function public.touch_updated_at();
drop trigger if exists friend_requests_touch_updated_at on public.friend_requests;
create trigger friend_requests_touch_updated_at before update on public.friend_requests for each row execute function public.touch_updated_at();
drop trigger if exists voice_calls_touch_updated_at on public.voice_calls;
create trigger voice_calls_touch_updated_at before update on public.voice_calls for each row execute function public.touch_updated_at();
drop trigger if exists push_tokens_touch_updated_at on public.push_tokens;
create trigger push_tokens_touch_updated_at before update on public.push_tokens for each row execute function public.touch_updated_at();
drop trigger if exists user_diamonds_touch_updated_at on public.user_diamonds;
create trigger user_diamonds_touch_updated_at before update on public.user_diamonds for each row execute function public.touch_updated_at();
drop trigger if exists user_decorations_touch_updated_at on public.user_decorations;
create trigger user_decorations_touch_updated_at before update on public.user_decorations for each row execute function public.touch_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  v_name := coalesce(
    nullif(new.profile->>'name', ''),
    nullif(new.metadata->>'username', ''),
    split_part(new.email, '@', 1),
    'user'
  );

  insert into public.users (id, username, display_name)
  values (
    new.id,
    lower(regexp_replace(v_name, '\s+', '', 'g')) || '-' || substr(new.id::text, 1, 8),
    v_name
  )
  on conflict (id) do nothing;

  insert into public.user_diamonds (user_id) values (new.id) on conflict do nothing;
  insert into public.user_decorations (user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.can_delete_message(p_chat_id uuid, p_sender_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_sender_id = auth.uid()
    or exists (select 1 from public.chats c where c.id = p_chat_id and c.is_group = true and c.owner_id = auth.uid())
    or exists (
      select 1
      from public.chat_participants cp
      join public.group_roles gr on gr.id = cp.group_role_id
      join public.chats c on c.id = p_chat_id
      where cp.chat_id = p_chat_id
        and cp.user_id = auth.uid()
        and c.is_group = true
        and gr.can_delete_others_messages = true
    );
$$;

create or replace function public.can_edit_group_chat_profile(p_chat_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (select 1 from public.chats c where c.id = p_chat_id and c.is_group = true and c.owner_id = auth.uid())
    or exists (
      select 1
      from public.chat_participants cp
      join public.group_roles gr on gr.id = cp.group_role_id
      where cp.chat_id = p_chat_id
        and cp.user_id = auth.uid()
        and gr.can_edit_group_profile = true
    );
$$;

alter table public.users enable row level security;
alter table public.chats enable row level security;
alter table public.chat_participants enable row level security;
alter table public.group_roles enable row level security;
alter table public.messages enable row level security;
alter table public.friends enable row level security;
alter table public.friend_requests enable row level security;
alter table public.chat_typing enable row level security;
alter table public.voice_calls enable row level security;
alter table public.push_tokens enable row level security;
alter table public.stickers enable row level security;
alter table public.sticker_favorites enable row level security;
alter table public.user_diamonds enable row level security;
alter table public.user_decorations enable row level security;
alter table public.ad_watches enable row level security;

create policy users_select_all on public.users for select using (true);
create policy users_insert_own on public.users for insert with check (id = auth.uid());
create policy users_update_own on public.users for update using (id = auth.uid()) with check (id = auth.uid());

create policy chats_select_participants_or_owner on public.chats for select using (
  owner_id = auth.uid() or exists (select 1 from public.chat_participants cp where cp.chat_id = chats.id and cp.user_id = auth.uid())
);
create policy chats_insert_authenticated on public.chats for insert to authenticated with check (auth.uid() is not null);
create policy chats_update_group_profile on public.chats for update to authenticated using (public.can_edit_group_chat_profile(id)) with check (public.can_edit_group_chat_profile(id));
create policy chats_delete_owner on public.chats for delete to authenticated using (is_group = true and owner_id = auth.uid());

create policy chat_participants_select_members on public.chat_participants for select to authenticated using (
  exists (select 1 from public.chat_participants mine where mine.chat_id = chat_participants.chat_id and mine.user_id = auth.uid())
  or exists (select 1 from public.chats c where c.id = chat_participants.chat_id and c.owner_id = auth.uid())
);
create policy chat_participants_insert_chat_owner on public.chat_participants for insert to authenticated with check (
  user_id = auth.uid() or exists (select 1 from public.chats c where c.id = chat_participants.chat_id and c.owner_id = auth.uid())
);
create policy chat_participants_update_self_or_owner on public.chat_participants for update to authenticated using (
  user_id = auth.uid() or exists (select 1 from public.chats c where c.id = chat_participants.chat_id and c.owner_id = auth.uid())
) with check (
  user_id = auth.uid() or exists (select 1 from public.chats c where c.id = chat_participants.chat_id and c.owner_id = auth.uid())
);
create policy chat_participants_delete_self_or_owner on public.chat_participants for delete to authenticated using (
  user_id = auth.uid() or exists (select 1 from public.chats c where c.id = chat_participants.chat_id and c.owner_id = auth.uid())
);

create policy group_roles_select_participants on public.group_roles for select to authenticated using (
  exists (select 1 from public.chat_participants cp where cp.chat_id = group_roles.chat_id and cp.user_id = auth.uid())
);
create policy group_roles_insert_owner on public.group_roles for insert to authenticated with check (
  exists (select 1 from public.chats c where c.id = group_roles.chat_id and c.is_group = true and c.owner_id = auth.uid())
);
create policy group_roles_update_owner on public.group_roles for update to authenticated using (
  exists (select 1 from public.chats c where c.id = group_roles.chat_id and c.is_group = true and c.owner_id = auth.uid())
) with check (
  exists (select 1 from public.chats c where c.id = group_roles.chat_id and c.is_group = true and c.owner_id = auth.uid())
);
create policy group_roles_delete_owner on public.group_roles for delete to authenticated using (
  exists (select 1 from public.chats c where c.id = group_roles.chat_id and c.is_group = true and c.owner_id = auth.uid())
);

create policy messages_select_participants on public.messages for select to authenticated using (
  exists (select 1 from public.chat_participants cp where cp.chat_id = messages.chat_id and cp.user_id = auth.uid())
);
create policy messages_insert_participants on public.messages for insert to authenticated with check (
  sender_id = auth.uid() and exists (select 1 from public.chat_participants cp where cp.chat_id = messages.chat_id and cp.user_id = auth.uid())
);
create policy messages_update_own on public.messages for update to authenticated using (sender_id = auth.uid()) with check (sender_id = auth.uid());
create policy messages_delete_policy on public.messages for delete to authenticated using (public.can_delete_message(chat_id, sender_id));

create policy friends_select_involved on public.friends for select to authenticated using (auth.uid() = user_id or auth.uid() = friend_id);
create policy friends_insert_involved on public.friends for insert to authenticated with check (auth.uid() = user_id or auth.uid() = friend_id);
create policy friends_delete_involved on public.friends for delete to authenticated using (auth.uid() = user_id or auth.uid() = friend_id);

create policy friend_requests_select_involved on public.friend_requests for select to authenticated using (auth.uid() = sender_id or auth.uid() = receiver_id);
create policy friend_requests_insert_sender on public.friend_requests for insert to authenticated with check (auth.uid() = sender_id and status = 'pending');
create policy friend_requests_update_involved on public.friend_requests for update to authenticated using (auth.uid() = sender_id or auth.uid() = receiver_id) with check (auth.uid() = sender_id or auth.uid() = receiver_id);

create policy chat_typing_select_participants on public.chat_typing for select to authenticated using (
  exists (select 1 from public.chat_participants cp where cp.chat_id = chat_typing.chat_id and cp.user_id = auth.uid())
);
create policy chat_typing_insert_self on public.chat_typing for insert to authenticated with check (
  user_id = auth.uid() and exists (select 1 from public.chat_participants cp where cp.chat_id = chat_typing.chat_id and cp.user_id = auth.uid())
);
create policy chat_typing_update_self on public.chat_typing for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy chat_typing_delete_self on public.chat_typing for delete to authenticated using (user_id = auth.uid());

create policy voice_calls_select_participants on public.voice_calls for select to authenticated using (
  exists (select 1 from public.chat_participants cp where cp.chat_id = voice_calls.chat_id and cp.user_id = auth.uid())
);
create policy voice_calls_insert_caller on public.voice_calls for insert to authenticated with check (
  caller_id = auth.uid()
  and exists (select 1 from public.chats c where c.id = voice_calls.chat_id and c.is_group = false)
  and exists (select 1 from public.chat_participants cp where cp.chat_id = voice_calls.chat_id and cp.user_id = caller_id)
  and exists (select 1 from public.chat_participants cp where cp.chat_id = voice_calls.chat_id and cp.user_id = callee_id)
);
create policy voice_calls_update_parties on public.voice_calls for update to authenticated using (auth.uid() = caller_id or auth.uid() = callee_id) with check (auth.uid() = caller_id or auth.uid() = callee_id);
create policy voice_calls_delete_parties on public.voice_calls for delete to authenticated using (auth.uid() = caller_id or auth.uid() = callee_id);

create policy push_tokens_select_own on public.push_tokens for select to authenticated using (auth.uid() = user_id);
create policy push_tokens_insert_own on public.push_tokens for insert to authenticated with check (auth.uid() = user_id);
create policy push_tokens_update_own on public.push_tokens for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy push_tokens_delete_own on public.push_tokens for delete to authenticated using (auth.uid() = user_id);

create policy stickers_select_authenticated on public.stickers for select to authenticated using (true);
create policy stickers_insert_own on public.stickers for insert to authenticated with check (owner_id = auth.uid());
create policy stickers_delete_own on public.stickers for delete to authenticated using (owner_id = auth.uid());
create policy sticker_favorites_select_own on public.sticker_favorites for select to authenticated using (user_id = auth.uid());
create policy sticker_favorites_insert_own on public.sticker_favorites for insert to authenticated with check (user_id = auth.uid());
create policy sticker_favorites_delete_own on public.sticker_favorites for delete to authenticated using (user_id = auth.uid());

create policy user_diamonds_select_own on public.user_diamonds for select to authenticated using (user_id = auth.uid());
create policy user_diamonds_insert_own on public.user_diamonds for insert to authenticated with check (user_id = auth.uid());
create policy user_diamonds_update_own on public.user_diamonds for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy user_decorations_select_authenticated on public.user_decorations for select to authenticated using (true);
create policy user_decorations_insert_own on public.user_decorations for insert to authenticated with check (user_id = auth.uid());
create policy user_decorations_update_own on public.user_decorations for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy ad_watches_select_own on public.ad_watches for select to authenticated using (user_id = auth.uid());
create policy ad_watches_insert_own on public.ad_watches for insert to authenticated with check (user_id = auth.uid());

create or replace function public.can_delete_message(p_chat_id uuid, p_sender_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_sender_id = auth.uid()
    or exists (select 1 from public.chats c where c.id = p_chat_id and c.is_group = true and c.owner_id = auth.uid())
    or exists (
      select 1
      from public.chat_participants cp
      join public.group_roles gr on gr.id = cp.group_role_id
      join public.chats c on c.id = p_chat_id
      where cp.chat_id = p_chat_id
        and cp.user_id = auth.uid()
        and c.is_group = true
        and gr.can_delete_others_messages = true
    );
$$;

create or replace function public.can_edit_group_chat_profile(p_chat_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (select 1 from public.chats c where c.id = p_chat_id and c.is_group = true and c.owner_id = auth.uid())
    or exists (
      select 1
      from public.chat_participants cp
      join public.group_roles gr on gr.id = cp.group_role_id
      where cp.chat_id = p_chat_id
        and cp.user_id = auth.uid()
        and gr.can_edit_group_profile = true
    );
$$;

create or replace function public.create_group_chat(p_name text, p_bio text, p_member_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chat_id uuid;
  v_owner uuid := auth.uid();
  m uuid;
begin
  if v_owner is null then raise exception 'Not authenticated'; end if;
  if p_name is null or btrim(p_name) = '' then raise exception 'Group name required'; end if;
  if p_member_ids is null or cardinality(p_member_ids) < 1 then raise exception 'Select at least one friend'; end if;

  insert into public.chats (is_group, owner_id, name, bio)
  values (true, v_owner, btrim(p_name), coalesce(p_bio, '')) returning id into v_chat_id;
  insert into public.chat_participants (chat_id, user_id) values (v_chat_id, v_owner);
  foreach m in array p_member_ids loop
    if m is not null and m <> v_owner then
      insert into public.chat_participants (chat_id, user_id) values (v_chat_id, m) on conflict do nothing;
    end if;
  end loop;
  return v_chat_id;
end;
$$;

create or replace function public.invite_to_group(p_chat_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_group boolean;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select c.owner_id, c.is_group into v_owner, v_group from public.chats c where c.id = p_chat_id;
  if not found or v_group is not true then raise exception 'Invalid group'; end if;
  if v_owner <> auth.uid() then raise exception 'Only owner can invite'; end if;
  if p_user_id = v_owner then return; end if;
  insert into public.chat_participants (chat_id, user_id) values (p_chat_id, p_user_id) on conflict do nothing;
end;
$$;

create or replace function public.remove_from_group(p_chat_id uuid, p_target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_can_kick boolean;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select owner_id into v_owner from public.chats where id = p_chat_id and is_group = true;
  if not found then raise exception 'Invalid group'; end if;
  if p_target_user_id = v_owner then raise exception 'Cannot remove owner'; end if;
  if auth.uid() = v_owner then
    v_can_kick := true;
  else
    select coalesce(gr.can_kick, false) into v_can_kick
    from public.chat_participants cp
    join public.group_roles gr on gr.id = cp.group_role_id
    where cp.chat_id = p_chat_id and cp.user_id = auth.uid();
  end if;
  if not coalesce(v_can_kick, false) then raise exception 'Not allowed to remove members'; end if;
  delete from public.chat_participants where chat_id = p_chat_id and user_id = p_target_user_id;
end;
$$;

create or replace function public.assign_group_member_role(p_chat_id uuid, p_user_id uuid, p_role_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select owner_id into v_owner from public.chats where id = p_chat_id and is_group = true;
  if not found then raise exception 'Invalid group'; end if;
  if v_owner <> auth.uid() then raise exception 'Only owner can assign roles'; end if;
  if p_role_id is not null and not exists (select 1 from public.group_roles where id = p_role_id and chat_id = p_chat_id) then
    raise exception 'Role not found';
  end if;
  update public.chat_participants set group_role_id = p_role_id where chat_id = p_chat_id and user_id = p_user_id;
end;
$$;

create or replace function public.transfer_group_ownership(p_chat_id uuid, p_new_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select owner_id into v_owner from public.chats where id = p_chat_id and is_group = true;
  if not found then raise exception 'Group not found'; end if;
  if v_owner <> auth.uid() then raise exception 'Only the owner can transfer ownership'; end if;
  if not exists (select 1 from public.chat_participants where chat_id = p_chat_id and user_id = p_new_owner_id) then
    raise exception 'New owner must be a member of the group';
  end if;
  update public.chats set owner_id = p_new_owner_id where id = p_chat_id and is_group = true;
end;
$$;

create or replace function public.delete_group_chat(p_chat_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select owner_id into v_owner from public.chats where id = p_chat_id and is_group = true;
  if not found then raise exception 'Group not found'; end if;
  if v_owner <> auth.uid() then raise exception 'Only the owner can delete this group'; end if;
  delete from public.chats where id = p_chat_id and is_group = true;
end;
$$;

create or replace function public.leave_group(p_chat_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select owner_id into v_owner from public.chats where id = p_chat_id and is_group = true;
  if not found then raise exception 'Group not found'; end if;
  if v_owner = auth.uid() then raise exception 'Owner cannot leave. Transfer ownership or delete the group.'; end if;
  if not exists (select 1 from public.chat_participants where chat_id = p_chat_id and user_id = auth.uid()) then
    raise exception 'You are not a member of this group';
  end if;
  insert into public.messages (chat_id, sender_id, content) values (p_chat_id, auth.uid(), '[[group:leave]]');
  delete from public.chat_participants where chat_id = p_chat_id and user_id = auth.uid();
end;
$$;

create or replace function public.set_group_notifications_muted(p_chat_id uuid, p_muted boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  update public.chat_participants cp
  set notifications_muted = p_muted
  from public.chats c
  where cp.chat_id = p_chat_id and cp.user_id = auth.uid() and c.id = p_chat_id and c.is_group is true;
  if not found then raise exception 'Not a member of this group or chat is not a group'; end if;
end;
$$;

create or replace function public.mark_dm_chat_read(p_chat_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  update public.chat_participants set last_read_at = now() where chat_id = p_chat_id and user_id = auth.uid();
end;
$$;

create or replace function public.friend_dm_unread_for_me()
returns table (friend_id uuid, chat_id uuid, unread_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as uid),
  my_friends as (
    select case when f.user_id = (select uid from me) then f.friend_id else f.user_id end as friend_id
    from public.friends f
    where f.user_id = (select uid from me) or f.friend_id = (select uid from me)
  ),
  paired as (
    select mf.friend_id, cp_me.chat_id
    from my_friends mf
    join public.chat_participants cp_me on cp_me.user_id = (select uid from me)
    join public.chat_participants cp_them on cp_them.chat_id = cp_me.chat_id and cp_them.user_id = mf.friend_id
    join public.chats c on c.id = cp_me.chat_id and c.is_group = false
  )
  select p.friend_id, p.chat_id,
    least((select count(*)::bigint from public.messages m where m.chat_id = p.chat_id and m.sender_id = p.friend_id and m.created_at > coalesce((select cp.last_read_at from public.chat_participants cp where cp.chat_id = p.chat_id and cp.user_id = (select uid from me)), '-infinity'::timestamptz)), 100) as unread_count
  from paired p;
$$;

create or replace function public.group_unread_for_me()
returns table (chat_id uuid, unread_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as uid)
  select cp.chat_id,
    least((select count(*)::bigint from public.messages m where m.chat_id = cp.chat_id and m.sender_id <> (select uid from me) and m.created_at > coalesce((select cp2.last_read_at from public.chat_participants cp2 where cp2.chat_id = cp.chat_id and cp2.user_id = (select uid from me)), '-infinity'::timestamptz)), 100) as unread_count
  from public.chat_participants cp
  join public.chats c on c.id = cp.chat_id and c.is_group = true
  where cp.user_id = (select uid from me);
$$;

grant execute on function public.can_delete_message(uuid, uuid) to authenticated;
grant execute on function public.can_edit_group_chat_profile(uuid) to authenticated;
grant execute on function public.create_group_chat(text, text, uuid[]) to authenticated;
grant execute on function public.invite_to_group(uuid, uuid) to authenticated;
grant execute on function public.remove_from_group(uuid, uuid) to authenticated;
grant execute on function public.assign_group_member_role(uuid, uuid, uuid) to authenticated;
grant execute on function public.transfer_group_ownership(uuid, uuid) to authenticated;
grant execute on function public.delete_group_chat(uuid) to authenticated;
grant execute on function public.leave_group(uuid) to authenticated;
grant execute on function public.set_group_notifications_muted(uuid, boolean) to authenticated;
grant execute on function public.mark_dm_chat_read(uuid) to authenticated;
grant execute on function public.friend_dm_unread_for_me() to authenticated;
grant execute on function public.group_unread_for_me() to authenticated;

-- InsForge realtime compatibility. The frontend adapter converts Supabase-style
-- postgres_changes listeners into subscriptions on db:{table} channels.
insert into realtime.channels (pattern, description, enabled)
select '%', 'DogitoChat application channels', true
where not exists (select 1 from realtime.channels where pattern = '%');

create or replace function public.publish_table_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table text := tg_table_name;
begin
  perform realtime.publish(
    'db:' || v_table,
    'postgres_changes:' || v_table,
    jsonb_build_object(
      'schema', tg_table_schema,
      'table', v_table,
      'eventType', tg_op,
      'new', case when tg_op = 'DELETE' then null else to_jsonb(new) end,
      'old', case when tg_op = 'INSERT' then null else to_jsonb(old) end
    )
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists users_realtime_publish on public.users;
create trigger users_realtime_publish after insert or update or delete on public.users for each row execute function public.publish_table_change();
drop trigger if exists chats_realtime_publish on public.chats;
create trigger chats_realtime_publish after insert or update or delete on public.chats for each row execute function public.publish_table_change();
drop trigger if exists chat_participants_realtime_publish on public.chat_participants;
create trigger chat_participants_realtime_publish after insert or update or delete on public.chat_participants for each row execute function public.publish_table_change();
drop trigger if exists group_roles_realtime_publish on public.group_roles;
create trigger group_roles_realtime_publish after insert or update or delete on public.group_roles for each row execute function public.publish_table_change();
drop trigger if exists messages_realtime_publish on public.messages;
create trigger messages_realtime_publish after insert or update or delete on public.messages for each row execute function public.publish_table_change();
drop trigger if exists friends_realtime_publish on public.friends;
create trigger friends_realtime_publish after insert or update or delete on public.friends for each row execute function public.publish_table_change();
drop trigger if exists friend_requests_realtime_publish on public.friend_requests;
create trigger friend_requests_realtime_publish after insert or update or delete on public.friend_requests for each row execute function public.publish_table_change();
drop trigger if exists chat_typing_realtime_publish on public.chat_typing;
create trigger chat_typing_realtime_publish after insert or update or delete on public.chat_typing for each row execute function public.publish_table_change();
drop trigger if exists voice_calls_realtime_publish on public.voice_calls;
create trigger voice_calls_realtime_publish after insert or update or delete on public.voice_calls for each row execute function public.publish_table_change();
