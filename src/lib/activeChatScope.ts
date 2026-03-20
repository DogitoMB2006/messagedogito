/** Synced from Home when `?id=` chat changes; used to suppress desktop notifications while that thread is open. */
let activeChatId: string | null = null;

export function setActiveChatIdForNotifications(id: string | null) {
  activeChatId = id;
}

export function getActiveChatIdForNotifications(): string | null {
  return activeChatId;
}
