/** Shared Realtime broadcast for peer presence (works when postgres_changes on `users` does not). */

export type PeerPresencePayload = {
  userId: string;
  presence_status: string;
  presence_updated_at: string;
};

const listeners = new Set<(p: PeerPresencePayload) => void>();

export function subscribePeerPresenceBroadcast(cb: (p: PeerPresencePayload) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function dispatchPeerPresenceBroadcast(p: PeerPresencePayload): void {
  for (const cb of listeners) {
    try {
      cb(p);
    } catch (e) {
      console.warn('peer presence listener failed', e);
    }
  }
}

export const PEER_PRESENCE_REALTIME_CHANNEL = 'dogito:peer_presence';
export const PEER_PRESENCE_BROADCAST_EVENT = 'peer_presence';
