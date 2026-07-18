/** Must match `ChatWindow` topic: `public:messages:${chatId}`. */
export function chatMessagesRealtimeTopic(chatId: string): string {
  return `public:messages:${chatId}`;
}

/** Broadcast to all subscribers on the chat messages channel without requiring a prior `subscribe()` (REST). */
export async function httpBroadcastChatMessages(
  client: any,
  chatId: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const ch = client.channel(chatMessagesRealtimeTopic(chatId), {
    config: { broadcast: { self: true } },
  });
  try {
    await ch.httpSend(event, payload);
  } finally {
    await client.removeChannel(ch);
  }
}
