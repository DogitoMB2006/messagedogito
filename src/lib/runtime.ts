const MOBILE_UA_RE = /Android|iPhone|iPad|iPod|Mobile/i;

export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
}

export function isAndroid(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android/i.test(navigator.userAgent);
}

export function isMobileUserAgent(): boolean {
  if (typeof navigator === 'undefined') return false;
  return MOBILE_UA_RE.test(navigator.userAgent);
}

export function isNativeAndroidApp(): boolean {
  return isTauriRuntime() && isAndroid();
}

export function isDesktopChromeAvailable(): boolean {
  return isTauriRuntime() && !isMobileUserAgent();
}
