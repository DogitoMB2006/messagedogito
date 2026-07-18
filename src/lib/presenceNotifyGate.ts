/** Set by PresenceProvider when status is busy; read by AuthContext before desktop notifications. */
let notificationsSilenced = false;

/** Set from user privacy settings. Default true until loaded. */
let desktopNotificationsEnabled = true;

export function setPresenceNotificationsSilenced(silenced: boolean) {
  notificationsSilenced = silenced;
}

export function arePresenceNotificationsSilenced(): boolean {
  return notificationsSilenced;
}

export function setDesktopNotificationsEnabled(enabled: boolean) {
  desktopNotificationsEnabled = enabled;
}

export function areDesktopNotificationsEnabled(): boolean {
  return desktopNotificationsEnabled;
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
