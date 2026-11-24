// scripts/host/retire-helper.js
// Telling whether the helper that answers is from an older copy of the plugin.
import { compareVersions } from '../lib/versions.js';
import { DEV_VERSION } from '../lib/plugin-version.js';

// True only when `version` is plainly older than `own`, by semantic versioning precedence (a
// pre-release is below its release); a newer, equal or unreadable one is not. A copy from the main
// line (DEV_VERSION) counts any release's helper as older, since the main line moves on from the
// last release; two copies from the main line can't be told apart, so neither is older.
export function isOlder(version, own) {
  if (own === DEV_VERSION) return version !== DEV_VERSION && compareVersions(version, version) === 0;
  return compareVersions(version, own) === -1;
}
