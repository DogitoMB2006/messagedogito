export type PresenceStatus = 'online' | 'idle' | 'busy' | 'offline';

const STALE_MS = 120_000;

export function resolvePeerPresence(
  status: string | null | undefined,
  updatedAt: string | null | undefined,
): PresenceStatus {
  if (!updatedAt) return 'offline';
  const t = new Date(updatedAt).getTime();
  if (Number.isNaN(t) || Date.now() - t > STALE_MS) return 'offline';
  if (status === 'online' || status === 'idle' || status === 'busy') return status;
  return 'offline';
}

/** Activity dot: online, idle, and busy (distinct colors). */
export function presenceShowsActivityDot(p: PresenceStatus): boolean {
  return p === 'online' || p === 'idle' || p === 'busy';
}

export function presenceDotClass(p: PresenceStatus): string {
  if (p === 'online') return 'bg-emerald-500';
  if (p === 'idle') return 'bg-amber-400';
  if (p === 'busy') return 'bg-rose-500';
  return '';
}

export function peerPresenceLabel(p: PresenceStatus): string {
  if (p === 'online') return 'Online';
  if (p === 'idle') return 'Idle';
  if (p === 'busy') return 'Busy';
  return 'Offline';
}

export function peerPresenceSubtextClass(p: PresenceStatus): string {
  if (p === 'online') return 'text-emerald-500';
  if (p === 'idle') return 'text-amber-500';
  if (p === 'busy') return 'text-rose-500';
  return 'text-muted-foreground';
}
