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
 * 1: "Ada esta escribiendo"
 * 2+: Spanish typing labels used in chat headers and composer area.
 */
export function formatTypingLabel(names: string[]): string {
  const n = names.length;
  if (n === 0) return '';
  if (n > 4) return 'Varias personas estan escribiendo';
  if (n === 1) return `${names[0]} esta escribiendo`;
  if (n === 2) return `${names[0]} y ${names[1]} estan escribiendo`;
  if (n === 3) return `${names[0]}, ${names[1]} y ${names[2]} estan escribiendo`;
  return `${names[0]}, ${names[1]}, ${names[2]} y ${names[3]} estan escribiendo`;
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
