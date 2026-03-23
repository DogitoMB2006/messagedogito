import { writeFileSync } from 'node:fs';

const [version, apkUrl, ...notesParts] = process.argv.slice(2);

if (!version || !apkUrl) {
  throw new Error('Usage: node scripts/create-android-latest-manifest.mjs <version> <apkUrl> [notes]');
}

const manifest = {
  version,
  apkUrl,
  notes: notesParts.join(' ') || `DogitoChat ${version} for Android is ready to download.`,
  pubDate: new Date().toISOString(),
};

writeFileSync('android-latest.json', `${JSON.stringify(manifest, null, 2)}\n`);
