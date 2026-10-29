// scripts/lib/projects.js
// What Wheelhouse keeps about each project on this computer, at
// ~/.wheelhouse/projects/<project>/project.json:
//
//   ProjectRecord = {
//     folder: string,      the project's working folder (a full path)
//     remoteUrl: string,   the repository's address, with no credentials in it
//     host: 'github' | 'gitlab',
//     repo: string,        owner/name (GitLab: group/subgroup/name)
//     connection: Connection,   see scripts/host/connection.js; holds no secret
//   }
//
// Setup writes it. The helper reads it: the lock's and the mirror's repository comes from
// here, never from a request.
//
// A Lean project has no host, so no project.json: its record is lean.json beside where project.json
// would be (scripts/lean/project.js). readProject and registeredProjects never read it;
// projectForFolder does, so a Lean folder is placed.
import fs from 'node:fs';
import path from 'node:path';
import { stateDir, projectsDir } from './paths.js';
import { readLean } from '../lean/project.js';

const REPO = /^[A-Za-z0-9_.][A-Za-z0-9_.-]*(\/[A-Za-z0-9_.][A-Za-z0-9_.-]*)+$/;
const caseBlind = process.platform === 'win32' || process.platform === 'darwin';

// stateDir refuses a name that is not a folder name.
function projectFolder(project) {
  return path.join(stateDir(project), '..');
}

// The repository path in a remote address: https://, ssh:// and file:// forms,
// git@host:owner/name, and a plain path. No .git suffix, no trailing slash, lower case.
// Where a remote address puts the repository: its path, and whether that path
// is the whole of it (a host address) or may sit under local folders (a plain
// path or file://, as local test remotes do). No .git suffix, no trailing
// slash, lower case.
function repoPathOf(remoteUrl) {
  let text = String(remoteUrl).trim().replaceAll('\\', '/');
  let local = true;
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/[^/]*(\/.*)?$/.exec(text);
  if (scheme) {
    text = scheme[2] ?? '';
    local = scheme[1].toLowerCase() === 'file';
  } else {
    const scp = /^[^/@\s]+@[^/:\s]+:(?!\/)(.*)$/.exec(text);
    if (scp) {
      text = scp[1];
      local = false;
    }
  }
  return { path: text.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/i, '').toLowerCase(), local };
}

// A host address must name the repository exactly: with nested groups,
// other/owner/name is a different project from owner/name.
function namesRepo(remoteUrl, repo) {
  const found = repoPathOf(remoteUrl);
  const wanted = repo.toLowerCase();
  return found.path === wanted || (found.local && found.path.endsWith(`/${wanted}`));
}

function checkRecord(record) {
  if (!record || typeof record !== 'object') throw new Error('The project record must be an object');
  if (typeof record.folder !== 'string' || !path.isAbsolute(record.folder)) throw new Error('The project\'s folder must be a full path');
  if (record.host !== 'github' && record.host !== 'gitlab') throw new Error('The project\'s host must be github or gitlab');
  if (typeof record.repo !== 'string' || !REPO.test(record.repo)) throw new Error('The project\'s repository must be written owner/name');
  if (typeof record.remoteUrl !== 'string' || !namesRepo(record.remoteUrl, record.repo)) {
    throw new Error('The project\'s remote address does not name its repository');
  }
  if (!record.connection || typeof record.connection !== 'object' || Array.isArray(record.connection)) {
    throw new Error('The project needs a connection');
  }
  return record;
}

// The project's record, or null when there is none or it is unreadable.
export function readProject(project) {
  try {
    return checkRecord(JSON.parse(fs.readFileSync(path.join(projectFolder(project), 'project.json'), 'utf8')));
  } catch {
    return null;
  }
}

// The names a project goes by, as the director may write them: its repository's own name and its folder's, each
// once. Empty when neither record reads.
export function namesOf(project) {
  let record = null;
  try {
    record = readProject(project) ?? readLean(project);
  } catch {
    return [];
  }
  const names = [
    typeof record?.repo === 'string' ? record.repo.split('/').at(-1) : null,
    typeof record?.folder === 'string' ? path.basename(record.folder) : null,
  ].filter((n) => typeof n === 'string' && n !== '');
  return [...new Set(names)];
}

// The projects registered on this computer, by folder name in order: each folder under projects/
// with a record that reads, { project, record }.
export function registeredProjects() {
  let names;
  try {
    names = fs.readdirSync(projectsDir());
  } catch {
    return [];
  }
  return names.sort().flatMap((project) => {
    const record = readProject(project);
    return record === null ? [] : [{ project, record }];
  });
}

// Writes the record whole: a temporary file in the same folder, then a rename.
export function writeProject(project, record) {
  const folder = projectFolder(project);
  checkRecord(record);
  const file = path.join(folder, 'project.json');
  const kept = {
    folder: record.folder, remoteUrl: record.remoteUrl, host: record.host, repo: record.repo, connection: record.connection,
  };
  fs.mkdirSync(folder, { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(kept, null, 2)}\n`);
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

function realPath(p) {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return null;
  }
}

const keyOf = (p) => (caseBlind ? p.toLowerCase() : p);

// The project whose folder contains `folder` (real paths, so a link or a
// different spelling is followed; case is ignored where the system ignores it).
// The nearest folder wins when projects nest. A Lean project (no project.json, a lean.json) is
// `{ project, record: { folder }, lean: true }`; where both records are there, project.json's wins.
export function projectForFolder(folder) {
  if (typeof folder !== 'string' || folder === '') return null;
  const target = realPath(folder);
  if (target === null) return null;
  const inside = keyOf(target);
  let names;
  try {
    names = fs.readdirSync(projectsDir());
  } catch {
    return null;
  }
  let best = null;
  for (const project of names) {
    let record = readProject(project);
    let lean = false;
    if (!record) {
      const leanRecord = readLean(project);
      if (!leanRecord) continue;
      record = { folder: leanRecord.folder };
      lean = true;
    }
    const root = realPath(record.folder);
    if (root === null) continue;
    const base = keyOf(root);
    const contains = inside === base || inside.startsWith(base.endsWith(path.sep) ? base : base + path.sep);
    if (contains && (best === null || base.length > best.length)) best = { project, record, lean, length: base.length };
  }
  if (!best) return null;
  return best.lean ? { project: best.project, record: best.record, lean: true } : { project: best.project, record: best.record };
}

// Whether `dir` is `folder` or inside it (real paths; case is ignored where the system ignores it).
export function isInsideFolder(folder, dir) {
  const root = realPath(folder);
  const target = realPath(dir);
  if (root === null || target === null) return false;
  const base = keyOf(root);
  const inside = keyOf(target);
  return inside === base || inside.startsWith(base.endsWith(path.sep) ? base : base + path.sep);
}
