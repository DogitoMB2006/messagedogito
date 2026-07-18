-- Fix recursive RLS introduced by policies that queried chat_participants from
-- chat_participants policies. SECURITY DEFINER helpers run outside caller RLS.

create or replace function public.is_chat_participant(p_chat_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null and exists (
    select 1
    from public.chat_participants cp
    where cp.chat_id = p_chat_id
      and cp.user_id = p_user_id
  );
$$;

create or replace function public.is_chat_owner(p_chat_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null and exists (
    select 1
    from public.chats c
    where c.id = p_chat_id
      and c.owner_id = p_user_id
  );
$$;

create or replace function public.has_group_permission(
  p_chat_id uuid,
  p_user_id uuid,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null and exists (
    select 1
    from public.chat_participants cp
    join public.group_roles gr on gr.id = cp.group_role_id
    where cp.chat_id = p_chat_id
      and cp.user_id = p_user_id
      and case p_permission
        when 'can_kick' then gr.can_kick
        when 'can_edit_group_profile' then gr.can_edit_group_profile
        when 'can_delete_others_messages' then gr.can_delete_others_messages
        else false
      end
  );
$$;

create or replace function public.can_delete_message(p_chat_id uuid, p_sender_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_sender_id = auth.uid()
    or public.is_chat_owner(p_chat_id, auth.uid())
    or public.has_group_permission(p_chat_id, auth.uid(), 'can_delete_others_messages');
$$;

create or replace function public.can_edit_group_chat_profile(p_chat_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_chat_owner(p_chat_id, auth.uid())
    or public.has_group_permission(p_chat_id, auth.uid(), 'can_edit_group_profile');
$$;

drop policy if exists chats_select_participants_or_owner on public.chats;
drop policy if exists chats_insert_authenticated on public.chats;
drop policy if exists chats_update_group_profile on public.chats;
drop policy if exists chats_delete_owner on public.chats;

create policy chats_select_participants_or_owner
  on public.chats for select
  using (owner_id = auth.uid() or public.is_chat_participant(id, auth.uid()));

create policy chats_insert_authenticated
  on public.chats for insert to authenticated
  with check (auth.uid() is not null and (owner_id is null or owner_id = auth.uid()));

create policy chats_update_group_profile
  on public.chats for update to authenticated
  using (public.can_edit_group_chat_profile(id))
  with check (public.can_edit_group_chat_profile(id));

create policy chats_delete_owner
  on public.chats for delete to authenticated
  using (is_group = true and owner_id = auth.uid());

drop policy if exists chat_participants_select_members on public.chat_participants;
drop policy if exists chat_participants_insert_chat_owner on public.chat_participants;
drop policy if exists chat_participants_update_self_or_owner on public.chat_participants;
drop policy if exists chat_participants_delete_self_or_owner on public.chat_participants;

create policy chat_participants_select_members
  on public.chat_participants for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_chat_participant(chat_id, auth.uid())
    or public.is_chat_owner(chat_id, auth.uid())
  );

create policy chat_participants_insert_chat_owner
  on public.chat_participants for insert to authenticated
  with check (user_id = auth.uid() or public.is_chat_owner(chat_id, auth.uid()));

create policy chat_participants_update_self_or_owner
  on public.chat_participants for update to authenticated
  using (user_id = auth.uid() or public.is_chat_owner(chat_id, auth.uid()))
  with check (user_id = auth.uid() or public.is_chat_owner(chat_id, auth.uid()));

create policy chat_participants_delete_self_or_owner
  on public.chat_participants for delete to authenticated
  using (user_id = auth.uid() or public.is_chat_owner(chat_id, auth.uid()));

drop policy if exists group_roles_select_participants on public.group_roles;
drop policy if exists group_roles_insert_owner on public.group_roles;
drop policy if exists group_roles_update_owner on public.group_roles;
drop policy if exists group_roles_delete_owner on public.group_roles;

create policy group_roles_select_participants
  on public.group_roles for select to authenticated
  using (public.is_chat_participant(chat_id, auth.uid()));

create policy group_roles_insert_owner
  on public.group_roles for insert to authenticated
  with check (public.is_chat_owner(chat_id, auth.uid()));

create policy group_roles_update_owner
  on public.group_roles for update to authenticated
  using (public.is_chat_owner(chat_id, auth.uid()))
  with check (public.is_chat_owner(chat_id, auth.uid()));

create policy group_roles_delete_owner
  on public.group_roles for delete to authenticated
  using (public.is_chat_owner(chat_id, auth.uid()));

drop policy if exists messages_select_participants on public.messages;
drop policy if exists messages_insert_participants on public.messages;
drop policy if exists messages_update_own on public.messages;
drop policy if exists messages_delete_policy on public.messages;

create policy messages_select_participants
  on public.messages for select to authenticated
  using (public.is_chat_participant(chat_id, auth.uid()));

create policy messages_insert_participants
  on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.is_chat_participant(chat_id, auth.uid()));

create policy messages_update_own
  on public.messages for update to authenticated
  using (sender_id = auth.uid())
  with check (sender_id = auth.uid());

create policy messages_delete_policy
  on public.messages for delete to authenticated
  using (public.can_delete_message(chat_id, sender_id));

drop policy if exists chat_typing_select_participants on public.chat_typing;
drop policy if exists chat_typing_insert_self on public.chat_typing;
drop policy if exists chat_typing_update_self on public.chat_typing;
drop policy if exists chat_typing_delete_self on public.chat_typing;

create policy chat_typing_select_participants
  on public.chat_typing for select to authenticated
  using (public.is_chat_participant(chat_id, auth.uid()));

create policy chat_typing_insert_self
  on public.chat_typing for insert to authenticated
  with check (user_id = auth.uid() and public.is_chat_participant(chat_id, auth.uid()));

create policy chat_typing_update_self
  on public.chat_typing for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy chat_typing_delete_self
  on public.chat_typing for delete to authenticated
  using (user_id = auth.uid());

drop policy if exists voice_calls_select_participants on public.voice_calls;
drop policy if exists voice_calls_insert_caller on public.voice_calls;
drop policy if exists voice_calls_update_parties on public.voice_calls;
drop policy if exists voice_calls_delete_parties on public.voice_calls;

create policy voice_calls_select_participants
  on public.voice_calls for select to authenticated
  using (public.is_chat_participant(chat_id, auth.uid()));

create policy voice_calls_insert_caller
  on public.voice_calls for insert to authenticated
  with check (
    caller_id = auth.uid()
    and exists (select 1 from public.chats c where c.id = voice_calls.chat_id and c.is_group = false)
    and public.is_chat_participant(chat_id, caller_id)
    and public.is_chat_participant(chat_id, callee_id)
  );

create policy voice_calls_update_parties
  on public.voice_calls for update to authenticated
  using (auth.uid() = caller_id or auth.uid() = callee_id)
  with check (auth.uid() = caller_id or auth.uid() = callee_id);

create policy voice_calls_delete_parties
  on public.voice_calls for delete to authenticated
  using (auth.uid() = caller_id or auth.uid() = callee_id);

grant execute on function public.is_chat_participant(uuid, uuid) to authenticated;
grant execute on function public.is_chat_owner(uuid, uuid) to authenticated;
grant execute on function public.has_group_permission(uuid, uuid, text) to authenticated;
