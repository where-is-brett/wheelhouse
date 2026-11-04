// scripts/host/retire-helper.js
// Telling whether the helper that answers is from an older copy of the plugin.
import { compareVersions } from '../lib/versions.js';

// True only when `version` is plainly older than `own`, by semantic versioning precedence (a
// pre-release is below its release); a newer, equal or unreadable one is not.
export function isOlder(version, own) {
  return compareVersions(version, own) === -1;
}
