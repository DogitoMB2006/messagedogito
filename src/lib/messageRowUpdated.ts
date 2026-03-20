/** Fired when a messages row changes via postgres (same path as sidebar refresh). ChatWindow merges into open thread. */
export const MESSAGE_ROW_UPDATED_EVENT = 'dogito:message-row-updated';

export type MessageRowUpdatedDetail = { record: Record<string, unknown> };

export function dispatchMessageRowUpdated(record: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent<MessageRowUpdatedDetail>(MESSAGE_ROW_UPDATED_EVENT, { detail: { record } }));
}
