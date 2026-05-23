import { supabase } from './supabase';

export type ManualPresence = 'online' | 'idle' | 'busy';

export type PrivacySettings = {
  presence_manual: ManualPresence;
  privacy_appear_offline: boolean;
  privacy_desktop_notifications: boolean;
};

const STORAGE_MANUAL = 'dogito_presence_manual';
const STORAGE_APPEAR_OFFLINE = 'dogito_appear_offline';
const STORAGE_DESKTOP_NOTIFICATIONS = 'dogito_desktop_notifications';

const DEFAULTS: PrivacySettings = {
  presence_manual: 'online',
  privacy_appear_offline: false,
  privacy_desktop_notifications: true,
};

function isManualPresence(v: unknown): v is ManualPresence {
  return v === 'online' || v === 'idle' || v === 'busy';
}

export function loadCachedPrivacy(): PrivacySettings {
  const out = { ...DEFAULTS };
  try {
    const manual = localStorage.getItem(STORAGE_MANUAL);
    if (isManualPresence(manual)) out.presence_manual = manual;
    const appear = localStorage.getItem(STORAGE_APPEAR_OFFLINE);
    if (appear === 'true') out.privacy_appear_offline = true;
    if (appear === 'false') out.privacy_appear_offline = false;
    const desktop = localStorage.getItem(STORAGE_DESKTOP_NOTIFICATIONS);
    if (desktop === 'true') out.privacy_desktop_notifications = true;
    if (desktop === 'false') out.privacy_desktop_notifications = false;
  } catch {
    /* ignore */
  }
  return out;
}

export function writeCachedPrivacy(patch: Partial<PrivacySettings>) {
  try {
    if (patch.presence_manual !== undefined) {
      localStorage.setItem(STORAGE_MANUAL, patch.presence_manual);
    }
    if (patch.privacy_appear_offline !== undefined) {
      localStorage.setItem(STORAGE_APPEAR_OFFLINE, String(patch.privacy_appear_offline));
    }
    if (patch.privacy_desktop_notifications !== undefined) {
      localStorage.setItem(STORAGE_DESKTOP_NOTIFICATIONS, String(patch.privacy_desktop_notifications));
    }
  } catch {
    /* ignore */
  }
}

function rowToSettings(row: Record<string, unknown> | null): PrivacySettings | null {
  if (!row) return null;
  const manual = row.presence_manual;
  if (!isManualPresence(manual)) return null;
  return {
    presence_manual: manual,
    privacy_appear_offline: Boolean(row.privacy_appear_offline),
    privacy_desktop_notifications: row.privacy_desktop_notifications !== false,
  };
}

export async function fetchPrivacySettings(
  userId: string,
): Promise<{ data: PrivacySettings | null; error: Error | null }> {
  const { data, error } = await supabase
    .from('users')
    .select('presence_manual, privacy_appear_offline, privacy_desktop_notifications')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    return { data: null, error: new Error(error.message) };
  }

  const settings = rowToSettings(data as Record<string, unknown> | null);
  if (settings) writeCachedPrivacy(settings);
  return { data: settings, error: null };
}

export async function updatePrivacySettings(
  userId: string,
  patch: Partial<PrivacySettings>,
): Promise<{ data: PrivacySettings | null; error: Error | null }> {
  if (Object.keys(patch).length === 0) {
    return { data: loadCachedPrivacy(), error: null };
  }

  writeCachedPrivacy(patch);

  const { data, error } = await supabase
    .from('users')
    .update(patch)
    .eq('id', userId)
    .select('presence_manual, privacy_appear_offline, privacy_desktop_notifications')
    .maybeSingle();

  if (error) {
    return { data: null, error: new Error(error.message) };
  }

  const settings = rowToSettings(data as Record<string, unknown> | null);
  if (settings) writeCachedPrivacy(settings);
  return { data: settings, error: null };
}

/** Push legacy localStorage values to Supabase once columns exist. */
export async function migrateLocalPrivacyToSupabase(userId: string): Promise<void> {
  const cached = loadCachedPrivacy();
  const { data: remote } = await fetchPrivacySettings(userId);
  if (!remote) {
    await updatePrivacySettings(userId, cached);
    return;
  }

  const patch: Partial<PrivacySettings> = {};
  if (cached.presence_manual !== remote.presence_manual) {
    patch.presence_manual = cached.presence_manual;
  }
  if (cached.privacy_appear_offline !== remote.privacy_appear_offline) {
    patch.privacy_appear_offline = cached.privacy_appear_offline;
  }
  if (cached.privacy_desktop_notifications !== remote.privacy_desktop_notifications) {
    patch.privacy_desktop_notifications = cached.privacy_desktop_notifications;
  }

  if (Object.keys(patch).length > 0) {
    await updatePrivacySettings(userId, patch);
  }
}

export const PRIVACY_STORAGE_KEYS = {
  manual: STORAGE_MANUAL,
  appearOffline: STORAGE_APPEAR_OFFLINE,
  desktopNotifications: STORAGE_DESKTOP_NOTIFICATIONS,
} as const;
