/** Fired when a messages row changes via postgres (same path as sidebar refresh). ChatWindow merges into open thread. */
export const MESSAGE_ROW_UPDATED_EVENT = 'dogito:message-row-updated';
export const MESSAGE_ROW_INSERTED_EVENT = 'dogito:message-row-inserted';

export type MessageRowUpdatedDetail = { record: Record<string, unknown> };

export function dispatchMessageRowUpdated(record: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent<MessageRowUpdatedDetail>(MESSAGE_ROW_UPDATED_EVENT, { detail: { record } }));
}

export function dispatchMessageRowInserted(record: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent<MessageRowUpdatedDetail>(MESSAGE_ROW_INSERTED_EVENT, { detail: { record } }));
}
