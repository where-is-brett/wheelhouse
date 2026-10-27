// scripts/profile/store.js
// The director's personal settings on this computer (design section 24.2): events in their own
// private record at profileDir() (~/.wheelhouse/settings/), a git repository with no remote, laid out
// as a project's record is (scripts/state/record.js). Only the helper writes it. Each computer keeps
// its own; nothing is pushed or fetched. The views built from it sit at profileViewsDir().
//
// Wheelhouse v0.1.x kept these settings on the `wheelhouse-profile` branch of a private repository,
// cloned at ~/.wheelhouse/profile/ and named by ~/.wheelhouse/profile.json. The import copies that
// clone's events in once (scripts/state/import.js); its folder, profile.json and the repository stay
// as they are until the director's click.
import fs from 'node:fs';
import path from 'node:path';
import { profileDir, profileViewsDir, wheelhouseHome } from '../lib/paths.js';
import { writeViews } from '../state/views.js';

// The branch v0.1.x kept the profile on: still recognised as Wheelhouse's own.
export const PROFILE_BRANCH = 'wheelhouse-profile';

// Any user part in a scheme address (`https://<token>@host/...`, `https://user:pass@host/...`),
// except a plain user name on ssh://, which names the account and carries no key.
const CREDENTIALS = /^(?!ssh:\/\/[^/@:\s]+@)[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/\s]*@/i;

// Where v0.1.x's profile repository is, as its setup wrote it to ~/.wheelhouse/profile.json:
// { remoteUrl, host, repo, connection }. Null while the file is missing or damaged. Read only by
// uninstall, to name a GitLab key that connection holds.
export function profileRemote() {
  let found;
  try {
    found = JSON.parse(fs.readFileSync(path.join(wheelhouseHome(), 'profile.json'), 'utf8'));
  } catch {
    return null;
  }
  if (!found || typeof found !== 'object' || Array.isArray(found)) return null;
  const { remoteUrl, host, repo, connection } = found;
  if (typeof remoteUrl !== 'string' || remoteUrl.trim() === '' || CREDENTIALS.test(remoteUrl)) return null;
  if (typeof host !== 'string' || typeof repo !== 'string' || repo === '') return null;
  if (!connection || typeof connection !== 'object' || Array.isArray(connection)) return null;
  return { remoteUrl, host, repo, connection };
}

// The settings' events, built as a project's are, written whole to profileViewsDir().
export function writeProfileViews({ now = () => new Date() } = {}) {
  return writeViews(undefined, { now, dir: profileDir(), out: profileViewsDir() });
}

// The views last written, read back; null when there are none or one can't be read.
// Between the two renames of a write only the `.old` folder is there, so it is read then.
export function readProfileViews() {
  const out = profileViewsDir();
  for (const folder of [out, `${out}.old`]) {
    let names;
    try {
      names = fs.readdirSync(folder).filter((n) => n.endsWith('.json'));
    } catch {
      continue;
    }
    if (names.length === 0) return null;
    const views = {};
    try {
      for (const name of names) views[name.slice(0, -'.json'.length)] = JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8'));
    } catch {
      return null;
    }
    return views;
  }
  return null;
}
