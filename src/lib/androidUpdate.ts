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

interface GitHubReleaseAsset {
  name?: string;
  browser_download_url?: string;
}

interface GitHubLatestRelease {
  tag_name?: string;
  body?: string;
  published_at?: string;
  assets?: GitHubReleaseAsset[];
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

function normalizeVersion(version: string): string {
  return version.replace(/^v/i, '');
}

async function checkAndroidReleaseFromGitHubApi(currentVersion: string): Promise<AndroidReleaseUpdate | null> {
  const response = await fetch('https://api.github.com/repos/DogitoMB2006/messagedogito/releases/latest', {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    cache: 'no-store',
  });

  if (response.status === 404 || response.status === 204) {
    return null;
  }

  if (response.status === 403) {
    throw new Error('GitHub API rate limit reached');
  }

  if (!response.ok) {
    throw new Error(`Android update check failed (${response.status})`);
  }

  const payload = (await response.json()) as GitHubLatestRelease;
  const version = normalizeVersion(payload.tag_name ?? '');
  const apkUrl = payload.assets?.find((asset) => asset.name?.endsWith('.apk'))?.browser_download_url;

  if (!version || !apkUrl) {
    throw new Error('Latest GitHub release is missing an Android APK asset');
  }

  if (!isVersionNewer(version, currentVersion)) {
    return null;
  }

  return {
    kind: 'android',
    version,
    body: payload.body?.trim() || 'A new Android APK is ready to download.',
    currentVersion,
    downloadUrl: apkUrl,
    publishedAt: payload.published_at,
  };
}

async function checkAndroidReleaseFromManifest(currentVersion: string): Promise<AndroidReleaseUpdate | null> {
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
    version: normalizeVersion(payload.version),
    body: payload.notes ?? 'A new Android APK is ready to download.',
    currentVersion,
    downloadUrl: payload.apkUrl,
    publishedAt: payload.pubDate,
  };
}

export async function checkAndroidReleaseUpdate(currentVersion: string): Promise<AndroidReleaseUpdate | null> {
  try {
    return await checkAndroidReleaseFromGitHubApi(currentVersion);
  } catch {
    return await checkAndroidReleaseFromManifest(currentVersion);
  }
}

export async function downloadAndroidApk(url: string): Promise<void> {
  await openExternalUrl(url);
}
