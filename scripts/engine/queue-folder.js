// scripts/engine/queue-folder.js
// The folder Archon's merge queue runs in (check 81): Wheelhouse's own checkout of a project's fetch mirror, under the
// engine folder, never the director's project. The queue's gate asks GitHub through the broker, which reaches the
// helper on its socket, and a Claude step's sandbox refuses every local socket it isn't told of. So this folder's
// settings are the project's own shared settings as its default branch holds them, with only the helper's socket
// opened (sandbox.network.allowUnixSockets): the deny lists, the sandbox and the plugins stay as they are, and the
// broker's call list, its permits and the signed approval stay the only way to merge. The project's own settings never
// change. The folder carries a mark naming its project and remote, and one marked for another (or not marked, or a
// link) is taken away and made afresh, never reused. Uninstall takes it away with the project's fetch mirror.
import fs from 'node:fs';
import path from 'node:path';
import { engineDir } from '../lib/paths.js';
import { safeGit } from '../lib/safe-git.js';
import { run as realRun } from '../lib/run.js';
import { mergeSettings } from '../protection/settings.js';
import { isInsideFolder } from '../lib/projects.js';

export const QUEUE_MARK = '.wheelhouse-queue.json';
const SHARED = '.claude/settings.json';
const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// The queue's folder for a project, under the engine folder.
export const queueFolderOf = (project, engine = engineDir()) => path.join(engine, 'queues', project);

// Which of `projects` owns the queue folder holding `cwd`, or null: the broker places the queue's gh calls by it, as
// it places a run's by the project's own folder. Nothing else is placed by it.
export function queueProjectOf(cwd, projects, engine = engineDir()) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) return null;
  return projects.find((project) => isInsideFolder(queueFolderOf(project, engine), cwd)) ?? null;
}

// A path's real spelling, or for one not made yet, its nearest made parent's with the rest as named. The sandbox
// matches a socket by its real path, as it does a folder (check 81).
function realOf(file) {
  for (let at = file, rest = ''; ; rest = path.join(path.basename(at), rest), at = path.dirname(at)) {
    try { return path.join(fs.realpathSync.native(at), rest); } catch { /* not made yet: look higher */ }
    if (path.dirname(at) === at) return file;
  }
}

// The project's shared settings with only the helper's socket opened, by both its spellings.
export function queueSettings(shared, socket) {
  const sockets = [...new Set([socket, realOf(socket)])];
  return mergeSettings(isPlain(shared) ? shared : {}, { sandbox: { network: { allowUnixSockets: sockets } } });
}

const kindOf = (file) => {
  try {
    const stat = fs.lstatSync(file);
    return stat.isDirectory() ? 'dir' : stat.isFile() ? 'file' : 'other';
  } catch {
    return 'none';
  }
};

const readMark = (folder) => {
  try { return JSON.parse(fs.readFileSync(path.join(folder, QUEUE_MARK), 'utf8')); } catch { return null; }
};

// prepareQueueFolder({ project, remoteUrl, mirror, socket, engine, run }) -> { ok: true, folder } | { ok: false, refused }
// Makes the folder (or takes away one that isn't this project's), brings it to the mirror's default branch, and writes
// its settings. `mirror` is the project's fetch mirror, its HEAD naming the default branch; `remoteUrl` the project's
// remote, which the folder's origin names so Archon reads the same project as the project's own runs.
export async function prepareQueueFolder({ project, remoteUrl, mirror, socket, engine = engineDir(), run = realRun } = {}) {
  if (!project || !remoteUrl || !mirror || !socket) return { ok: false, refused: 'the merge queue\'s folder needs the project, its remote, its mirror and the helper\'s socket' };
  const folder = queueFolderOf(project, engine);
  const git = (cwd) => safeGit({ run, cwd, reach: 'local', look: 'never', timeoutMs: 120000 });
  const must = async (cwd, args, why) => {
    const got = await git(cwd)(args);
    if (got.code !== 0) throw new Error(why);
    return String(got.stdout ?? '').trim();
  };
  try {
    const mark = readMark(folder);
    const ours = kindOf(folder) === 'dir' && mark?.project === project && mark?.remoteUrl === remoteUrl && mark?.mirror === mirror;
    if (!ours && kindOf(folder) !== 'none') fs.rmSync(folder, { recursive: true, force: true });
    const base = await must(mirror, ['symbolic-ref', '--short', 'HEAD'], 'the fetch mirror names no default branch');
    if (!/^[A-Za-z0-9._/-]+$/.test(base) || base.includes('..')) throw new Error('the fetch mirror\'s default branch has a name that can\'t be used');
    if (!ours) {
      fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
      await must(folder, ['init', '-q'], 'the merge queue\'s folder could not be made');
      await must(folder, ['remote', 'add', 'origin', remoteUrl], 'the merge queue\'s folder could not name its remote');
      fs.writeFileSync(path.join(folder, QUEUE_MARK), `${JSON.stringify({ project, remoteUrl, mirror }, null, 2)}\n`);
      const exclude = path.join(folder, '.git', 'info', 'exclude');
      fs.mkdirSync(path.dirname(exclude), { recursive: true });
      fs.appendFileSync(exclude, `/${QUEUE_MARK}\n`);
    }
    // Back to the branch as the mirror holds it: the shared settings first, so git may put them back too.
    await git(folder)(['update-index', '--no-skip-worktree', '--', SHARED]);
    await must(folder, ['-c', 'protocol.file.allow=always', 'fetch', '-q', '--no-tags', '--prune', mirror, `+refs/heads/*:refs/remotes/origin/*`], 'the merge queue\'s folder could not be brought up to date');
    await must(folder, ['checkout', '-q', '--force', '-B', base, `refs/remotes/origin/${base}`], 'the merge queue\'s folder could not take the default branch');
    await must(folder, ['clean', '-q', '-d', '-f', '-e', QUEUE_MARK], 'the merge queue\'s folder could not be cleared');
    // The settings: the branch's own, with the socket opened, kept out of git.
    const file = path.join(folder, ...SHARED.split('/'));
    if (!['none', 'dir'].includes(kindOf(path.dirname(file))) || !['none', 'file'].includes(kindOf(file))) throw new Error('the branch\'s shared settings are a link or not a plain file');
    let shared = {};
    if (kindOf(file) === 'file') {
      try { shared = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error('the branch\'s shared settings could not be read'); }
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(queueSettings(shared, socket), null, 2)}\n`);
    if ((await git(folder)(['ls-files', '--', SHARED])).stdout?.trim()) await must(folder, ['update-index', '--skip-worktree', '--', SHARED], 'the merge queue\'s settings could not be kept out of git');
    return { ok: true, folder };
  } catch (error) {
    return { ok: false, refused: error.message };
  }
}
