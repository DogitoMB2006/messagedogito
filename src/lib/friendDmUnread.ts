export const FRIEND_DM_READ_EVENT = 'dogito:friend-dm-read';
export const CHAT_READ_EVENT = 'dogito:chat-read';

export type FriendDmUnreadRow = {
  friend_id: string;
  chat_id: string;
  unread_count: number;
};

export type GroupUnreadRow = {
  chat_id: string;
  unread_count: number;
};

export function dispatchFriendDmRead(friendId: string) {
  window.dispatchEvent(new CustomEvent(FRIEND_DM_READ_EVENT, { detail: { friendId } }));
}

/** Clears sidebar unread for a chat (DM or group). */
export function dispatchChatRead(chatId: string) {
  window.dispatchEvent(new CustomEvent(CHAT_READ_EVENT, { detail: { chatId } }));
}

export async function fetchFriendDmUnreadRows(client: any): Promise<FriendDmUnreadRow[]> {
  const { data, error } = await client.rpc('friend_dm_unread_for_me');
  if (error) {
    console.warn('friend_dm_unread_for_me', error.message);
    return [];
  }
  const rows = (data ?? []) as { friend_id: string; chat_id: string; unread_count: number | string }[];
  return rows.map((r) => ({
    friend_id: String(r.friend_id),
    chat_id: String(r.chat_id),
    unread_count: Math.min(100, Math.max(0, Number(r.unread_count) || 0)),
  }));
}

export async function fetchGroupUnreadRows(client: any): Promise<GroupUnreadRow[]> {
  const { data, error } = await client.rpc('group_unread_for_me');
  if (error) {
    console.warn('group_unread_for_me', error.message);
    return [];
  }
  const rows = (data ?? []) as { chat_id: string; unread_count: number | string }[];
  return rows.map((r) => ({
    chat_id: String(r.chat_id),
    unread_count: Math.min(100, Math.max(0, Number(r.unread_count) || 0)),
  }));
}

/** DM + group unread counts keyed by chat id (for ChatList). */
export async function fetchUnreadCountByChatId(client: any): Promise<Map<string, number>> {
  const [dmRows, groupRows] = await Promise.all([
    fetchFriendDmUnreadRows(client),
    fetchGroupUnreadRows(client),
  ]);
  const m = new Map<string, number>();
  for (const r of dmRows) m.set(r.chat_id, r.unread_count);
  for (const r of groupRows) m.set(r.chat_id, r.unread_count);
  return m;
}

/** Build chat_id -> friend_id for DM unread realtime handling (Friends page). */
export function chatIdToFriendIdMap(rows: FriendDmUnreadRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of rows) {
    map.set(r.chat_id, r.friend_id);
  }
  return map;
}

export async function markDmChatRead(client: any, chatId: string): Promise<void> {
  const { error } = await client.rpc('mark_dm_chat_read', { p_chat_id: chatId });
  if (error) console.warn('markDmChatRead failed', error.message);
}

export function formatFriendUnreadBadge(count: number): string {
  if (count >= 100) return '99+';
  return String(count);
}
