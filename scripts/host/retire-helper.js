// scripts/host/retire-helper.js
// Telling whether the helper that answers is from an older copy of the plugin.

// A version as its numbers ([0, 2, 3]), or null when it is not dotted numbers (a pre-release tag is cut off).
export function versionParts(version) {
  if (typeof version !== 'string') return null;
  const match = /^v?(\d+(?:\.\d+)*)(?:[-+].*)?$/.exec(version.trim());
  return match ? match[1].split('.').map(Number) : null;
}

// True only when `version` is plainly older than `own`; a newer, equal or unreadable one is not.
export function isOlder(version, own) {
  const a = versionParts(version);
  const b = versionParts(own);
  if (a === null || b === null) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}
