/** Set by PresenceProvider; read by AuthContext before desktop notifications. */
let notificationsSilenced = false;

export function setPresenceNotificationsSilenced(silenced: boolean) {
  notificationsSilenced = silenced;
}

export function arePresenceNotificationsSilenced(): boolean {
  return notificationsSilenced;
}

let pushOfflineBeforeSignOut: (() => Promise<void>) | null = null;

export function registerPresenceOfflineBeforeSignOut(fn: () => Promise<void>) {
  pushOfflineBeforeSignOut = fn;
}

export function unregisterPresenceOfflineBeforeSignOut() {
  pushOfflineBeforeSignOut = null;
}

export async function runPresenceOfflineBeforeSignOut() {
  await pushOfflineBeforeSignOut?.();
}
