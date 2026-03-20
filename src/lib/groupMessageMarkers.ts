/** System message: client + DB use this exact string for "user left the group". */
export const GROUP_LEAVE_MESSAGE = '[[group:leave]]';

export function isGroupLeaveMessage(content: unknown): boolean {
  return typeof content === 'string' && content.trim() === GROUP_LEAVE_MESSAGE;
}
