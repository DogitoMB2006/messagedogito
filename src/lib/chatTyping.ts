export const CHAT_TYPING_STALE_MS = 6000;

export type ChatTypingRow = {
  chat_id: string;
  user_id: string;
  display_name: string;
  updated_at: string;
};

export function isTypingRowFresh(row: Pick<ChatTypingRow, 'updated_at'>, now = Date.now()): boolean {
  return new Date(row.updated_at).getTime() > now - CHAT_TYPING_STALE_MS;
}

/** Sorted display names for stable UI. */
export function typingDisplayNames(rows: ChatTypingRow[], excludeUserId: string | undefined): string[] {
  const uid = excludeUserId != null ? String(excludeUserId) : '';
  return rows
    .filter((r) => String(r.user_id) !== uid && isTypingRowFresh(r))
    .map((r) => (r.display_name || 'Someone').trim() || 'Someone')
    .sort((a, b) => a.localeCompare(b));
}

/**
 * 1: "Ada is typing"
 * 2: "Ada and Bob are typing"
 * 3+: "Ada, Bob and Carol are typing" (up to 4 names)
 * 5+ typers: "Multiple users are typing"
 */
export function formatTypingLabel(names: string[]): string {
  const n = names.length;
  if (n === 0) return '';
  if (n > 4) return 'Multiple users are typing';
  if (n === 1) return `${names[0]} is typing`;
  if (n === 2) return `${names[0]} and ${names[1]} are typing`;
  if (n === 3) return `${names[0]}, ${names[1]} and ${names[2]} are typing`;
  return `${names[0]}, ${names[1]}, ${names[2]} and ${names[3]} are typing`;
}

/** Realtime Broadcast topic per chat (instant typing; complements postgres `chat_typing`). */
export function typingBroadcastTopic(chatId: string) {
  return `typing-broadcast:${chatId}`;
}

export const TYPING_BROADCAST_PING = 'typing_ping';
export const TYPING_BROADCAST_STOP = 'typing_stop';

export type TypingBroadcastPingPayload = {
  chat_id: string;
  user_id: string;
  display_name: string;
  updated_at: string;
};

export type TypingBroadcastStopPayload = {
  chat_id: string;
  user_id: string;
};

/** When an open chat receives typing via Realtime Broadcast, mirror into the sidebar list (same tab). */
export const CHAT_TYPING_BRIDGE_EVENT = 'chat_typing_bridge';

export type ChatTypingBridgeDetail =
  | { kind: 'ping'; chatId: string; row: ChatTypingRow }
  | { kind: 'stop'; chatId: string; userId: string };

export function emitChatTypingBridge(detail: ChatTypingBridgeDetail) {
  window.dispatchEvent(new CustomEvent(CHAT_TYPING_BRIDGE_EVENT, { detail }));
}
