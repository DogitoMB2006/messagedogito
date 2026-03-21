const STORAGE_KEY = 'dogito_autostart_enabled';

export function getAutostartPreference(): boolean {
  const v = localStorage.getItem(STORAGE_KEY);
  if (v === null) return true;
  return v === 'true';
}

export function setAutostartPreference(enabled: boolean) {
  localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
}

/** Desktop only: first launch defaults to enabled; later launches apply saved preference. */
export async function applyAutostartPreferenceOnLaunch(): Promise<void> {
  try {
    const { enable, disable } = await import('@tauri-apps/plugin-autostart');
    if (localStorage.getItem(STORAGE_KEY) === null) {
      localStorage.setItem(STORAGE_KEY, 'true');
      await enable();
      return;
    }
    if (getAutostartPreference()) await enable();
    else await disable();
  } catch {
    /* Vite dev in browser or unsupported */
  }
}

export async function setAutostartEnabled(enabled: boolean): Promise<void> {
  setAutostartPreference(enabled);
  try {
    const { enable, disable } = await import('@tauri-apps/plugin-autostart');
    if (enabled) await enable();
    else await disable();
  } catch {
    /* web */
  }
}

export async function readAutostartEnabledFromOs(): Promise<boolean | null> {
  try {
    const { isEnabled } = await import('@tauri-apps/plugin-autostart');
    return await isEnabled();
  } catch {
    return null;
  }
}
