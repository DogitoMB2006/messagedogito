import { supabase } from './supabase';

/**
 * Ping a user's client to reload their chat list (e.g. after being invited to a group).
 * They must subscribe to channel `user-chat-inbox:${userId}` (see ChatList).
 */
export async function notifyUserChatListRefresh(targetUserId: string): Promise<void> {
  const ch = supabase.channel(`user-chat-inbox:${targetUserId}`, {
    config: { broadcast: { self: true } },
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('inbox subscribe timeout')), 10000);
      ch.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(t);
          resolve();
        }
      });
    });
    await ch.send({
      type: 'broadcast',
      event: 'refresh_chats',
      payload: {},
    });
  } catch (e) {
    console.warn('notifyUserChatListRefresh', e);
  } finally {
    await supabase.removeChannel(ch);
  }
}
