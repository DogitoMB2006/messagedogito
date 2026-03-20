import type { SupabaseClient } from '@supabase/supabase-js';

export async function findOrCreateDmChatId(
  supabase: SupabaseClient,
  currentUserId: string,
  friendId: string,
): Promise<{ chatId: string } | { error: string }> {
  if (friendId === currentUserId) return { error: 'self' };

  const { data: myChats } = await supabase.from('chat_participants').select('chat_id').eq('user_id', currentUserId);
  const myChatIds = myChats?.map((c) => c.chat_id) || [];

  if (myChatIds.length > 0) {
    const { data: common } = await supabase
      .from('chat_participants')
      .select('chat_id')
      .eq('user_id', friendId)
      .in('chat_id', myChatIds);
    const sharedIds = common?.map((c) => c.chat_id).filter(Boolean) ?? [];
    if (sharedIds.length > 0) {
      const { data: dmChats } = await supabase
        .from('chats')
        .select('id')
        .in('id', sharedIds)
        .eq('is_group', false)
        .limit(1);
      if (dmChats && dmChats.length > 0) {
        return { chatId: dmChats[0].id };
      }
    }
  }

  const { data: newChat, error: chatErr } = await supabase.from('chats').insert({ is_group: false }).select().single();
  if (chatErr || !newChat) return { error: chatErr?.message || 'Could not create chat' };

  await supabase.from('chat_participants').insert([
    { chat_id: newChat.id, user_id: currentUserId },
    { chat_id: newChat.id, user_id: friendId },
  ]);

  return { chatId: newChat.id };
}
