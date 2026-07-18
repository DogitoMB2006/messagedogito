import { getVersion } from '@tauri-apps/api/app';
import { isNativeAndroidApp } from './runtime';

interface PushPayload {
  chatId: string;
  recipientUserIds: string[];
  title: string;
  body: string;
  kind: 'message' | 'incoming_call';
}

const REGISTERED_PUSH_USER_KEY = 'dogito.androidPushRegisteredUser';

export async function ensureAndroidPushRegistration(supabase: any, userId: string): Promise<void> {
  if (!isNativeAndroidApp()) return;

  try {
    const notifications = await import('@choochmeque/tauri-plugin-notifications-api');
    const granted = await notifications.requestPermission();
    if (granted !== 'granted') return;

    await notifications.createChannel({
      id: 'messages',
      name: 'Messages',
      description: 'New chat messages',
      importance: notifications.Importance.High,
      visibility: notifications.Visibility.Private,
      vibration: true,
    }).catch(() => undefined);

    await notifications.createChannel({
      id: 'calls',
      name: 'Calls',
      description: 'Incoming voice calls',
      importance: notifications.Importance.High,
      visibility: notifications.Visibility.Public,
      vibration: true,
    }).catch(() => undefined);

    const token = await notifications.registerForPushNotifications();
    const appVersion = await getVersion().catch(() => null);

    const { error } = await supabase.from('push_tokens').upsert(
      {
        user_id: userId,
        token,
        platform: 'android',
        app_version: appVersion,
        last_seen_at: new Date().toISOString(),
        disabled_at: null,
      },
      { onConflict: 'token' },
    );

    if (!error) {
      localStorage.setItem(REGISTERED_PUSH_USER_KEY, userId);
    }
  } catch (error) {
    console.warn('Android push registration unavailable', error);
  }
}

export async function unregisterAndroidPushDevice(supabase: any, userId: string): Promise<void> {
  if (!isNativeAndroidApp()) return;

  try {
    await supabase
      .from('push_tokens')
      .update({ disabled_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('platform', 'android');
  } catch (error) {
    console.warn('Could not disable Android push token', error);
  } finally {
    localStorage.removeItem(REGISTERED_PUSH_USER_KEY);
  }
}

export function shouldRefreshAndroidPushRegistration(userId: string): boolean {
  if (!isNativeAndroidApp()) return false;
  return localStorage.getItem(REGISTERED_PUSH_USER_KEY) !== userId;
}

export async function sendMobilePushNotification(supabase: any, payload: PushPayload): Promise<void> {
  if (payload.recipientUserIds.length === 0) return;

  try {
    const { error } = await supabase.functions.invoke('push-notify', {
      body: payload,
    });
    if (error) throw error;
  } catch (error) {
    console.warn('push-notify invoke failed', error);
  }
}
