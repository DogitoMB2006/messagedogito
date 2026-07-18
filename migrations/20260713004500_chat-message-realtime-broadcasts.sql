-- Publish chat message changes on the exact channels the UI subscribes to.

insert into realtime.channels (pattern, description, enabled)
select 'public:messages:%', 'Per-chat message broadcasts', true
where not exists (select 1 from realtime.channels where pattern = 'public:messages:%');

insert into realtime.channels (pattern, description, enabled)
select 'user-chat-inbox:%', 'Per-user chat list refresh broadcasts', true
where not exists (select 1 from realtime.channels where pattern = 'user-chat-inbox:%');

create or replace function public.publish_message_chat_broadcast()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.messages;
  v_event text;
begin
  if tg_op = 'DELETE' then
    v_row := old;
    v_event := 'message_deleted';
  elsif tg_op = 'UPDATE' then
    v_row := new;
    v_event := 'message_updated';
  else
    v_row := new;
    v_event := 'message_inserted';
  end if;

  perform realtime.publish(
    'public:messages:' || v_row.chat_id::text,
    v_event,
    case
      when tg_op = 'DELETE' then jsonb_build_object('id', v_row.id, 'chat_id', v_row.chat_id)
      else jsonb_build_object('record', to_jsonb(v_row))
    end
  );

  if tg_op = 'INSERT' then
    perform realtime.publish(
      'user-chat-inbox:' || cp.user_id::text,
      'refresh_chats',
      jsonb_build_object('chat_id', v_row.chat_id, 'message_id', v_row.id, 'sender_id', v_row.sender_id)
    )
    from public.chat_participants cp
    where cp.chat_id = v_row.chat_id
      and cp.user_id <> v_row.sender_id;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists messages_chat_broadcast on public.messages;
create trigger messages_chat_broadcast
after insert or update or delete on public.messages
for each row execute function public.publish_message_chat_broadcast();
