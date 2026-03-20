export const CHAT_LIST_INVALIDATE_EVENT = 'dogito:chat-list-invalidate';

export function invalidateChatList() {
  window.dispatchEvent(new CustomEvent(CHAT_LIST_INVALIDATE_EVENT));
}
