import { openExternalUrl } from './openExternalUrl';

export interface AndroidReleaseUpdate {
  kind: 'android';
  version: string;
  body: string;
  currentVersion: string;
  downloadUrl: string;
  publishedAt?: string;
}

interface AndroidLatestManifest {
  version?: string;
  notes?: string;
  apkUrl?: string;
  pubDate?: string;
}

function parseVersionParts(version: string): number[] {
  return version
    .replace(/^v/i, '')
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

export function isVersionNewer(nextVersion: string, currentVersion: string): boolean {
  const next = parseVersionParts(nextVersion);
  const current = parseVersionParts(currentVersion);
  const length = Math.max(next.length, current.length);

  for (let i = 0; i < length; i += 1) {
    const a = next[i] ?? 0;
    const b = current[i] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }

  return false;
}

export async function checkAndroidReleaseUpdate(currentVersion: string): Promise<AndroidReleaseUpdate | null> {
  const response = await fetch(`https://github.com/DogitoMB2006/messagedogito/releases/latest/download/android-latest.json?t=${Date.now()}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });

  if (response.status === 404 || response.status === 204) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Android update check failed (${response.status})`);
  }

  const payload = (await response.json()) as AndroidLatestManifest;
  if (!payload.version || !payload.apkUrl) {
    throw new Error('Android update feed is missing version or apkUrl');
  }

  if (!isVersionNewer(payload.version, currentVersion)) {
    return null;
  }

  return {
    kind: 'android',
    version: payload.version,
    body: payload.notes ?? 'A new Android APK is ready to download.',
    currentVersion,
    downloadUrl: payload.apkUrl,
    publishedAt: payload.pubDate,
  };
}

export async function downloadAndroidApk(url: string): Promise<void> {
  await openExternalUrl(url);
}
