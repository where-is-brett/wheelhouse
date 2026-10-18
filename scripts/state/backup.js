// scripts/state/backup.js
import fs from 'node:fs';
import path from 'node:path';
import { profileDir, stateDir } from '../lib/paths.js';
import { git } from './git.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const KEEP = 8;
const NAME = /^(\d{4}-\d{2}-\d{2})\.bundle$/;

// Bundles the state branch into profile/backups/<project>/<YYYY-MM-DD>.bundle. Skips, returning
// the newest existing path, when a bundle dated within the last seven days is there; keeps the
// newest eight and removes only older .bundle files.
export async function writeBackup({ project, now = () => new Date() }) {
  if (typeof project !== 'string' || /[\\/]/.test(project) || /^\.+$/.test(project)) throw new Error('A project folder name may not hold a path');
  const folder = path.join(profileDir(), 'backups', project);
  fs.mkdirSync(folder, { recursive: true });
  const at = now();
  // A bundle dated after now (a clock set wrong once) counts for nothing: it neither
  // holds back the backup nor takes one of the eight places.
  const age = (f) => at.getTime() - Date.parse(`${f.slice(0, 10)}T00:00:00.000Z`);
  const existing = () => fs.readdirSync(folder).filter((f) => NAME.test(f) && age(f) >= 0).sort();
  const recent = existing().filter((f) => age(f) < WEEK_MS);
  if (recent.length) return path.join(folder, recent[recent.length - 1]);

  const file = path.join(folder, `${at.toISOString().slice(0, 10)}.bundle`);
  const partial = `${file}.partial`;
  const dir = stateDir(project);
  let made = await git(dir, ['bundle', 'create', partial, 'wheelhouse-state']);
  if (made.code !== 0) made = await git(dir, ['bundle', 'create', partial, 'refs/remotes/origin/wheelhouse-state']);
  if (made.code !== 0) {
    fs.rmSync(partial, { force: true });
    throw new Error('The state branch could not be bundled');
  }
  fs.renameSync(partial, file);
  for (const old of existing().slice(0, -KEEP)) fs.rmSync(path.join(folder, old), { force: true });
  return file;
}
