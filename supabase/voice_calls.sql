-- Voice calls for private (DM) chats.
-- Run in Supabase SQL Editor. Ensure `public.users` exists (or change FK to match your schema).

create table if not exists public.voice_calls (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats (id) on delete cascade,
  caller_id uuid not null references public.users (id) on delete cascade,
  callee_id uuid not null references public.users (id) on delete cascade,
  status text not null default 'ringing'
    check (status in ('ringing', 'active', 'ended', 'declined', 'missed', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz,
  constraint voice_calls_distinct_users check (caller_id <> callee_id)
);

create index if not exists voice_calls_chat_created_idx
  on public.voice_calls (chat_id, created_at desc);

create index if not exists voice_calls_callee_status_created_idx
  on public.voice_calls (callee_id, status, created_at desc);

alter table public.voice_calls enable row level security;

-- Participants in the chat can read calls for that chat.
create policy "voice_calls_select_participants"
  on public.voice_calls for select
  using (
    exists (
      select 1 from public.chat_participants cp
      where cp.chat_id = voice_calls.chat_id
        and cp.user_id = auth.uid()
    )
  );

-- Caller can create only their own outbound DM call.
create policy "voice_calls_insert_caller"
  on public.voice_calls for insert
  with check (
    caller_id = auth.uid()
    and exists (
      select 1
      from public.chats c
      where c.id = voice_calls.chat_id
        and coalesce(c.is_group, false) = false
    )
    and exists (
      select 1 from public.chat_participants cp
      where cp.chat_id = voice_calls.chat_id
        and cp.user_id = caller_id
    )
    and exists (
      select 1 from public.chat_participants cp
      where cp.chat_id = voice_calls.chat_id
        and cp.user_id = callee_id
    )
  );

-- Either side can update call status and timestamps for their own call row.
create policy "voice_calls_update_parties"
  on public.voice_calls for update
  using (auth.uid() = caller_id or auth.uid() = callee_id)
  with check (
    (auth.uid() = caller_id or auth.uid() = callee_id)
    and exists (
      select 1 from public.chat_participants cp
      where cp.chat_id = voice_calls.chat_id
        and cp.user_id = auth.uid()
    )
  );

-- Either side can delete their own call rows if needed.
create policy "voice_calls_delete_parties"
  on public.voice_calls for delete
  using (auth.uid() = caller_id or auth.uid() = callee_id);

-- Realtime: add table to publication (safe if already added)
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'voice_calls'
  ) then
    alter publication supabase_realtime add table public.voice_calls;
  end if;
end $$;
