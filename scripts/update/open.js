// scripts/update/open.js
// How the update opens the project's reviewed change (update design, section 6.2). The change is one commit on the release's
// branch (`wheelhouse-release-<commit>`, or `wheelhouse-undo-<commit>`) holding only the marketplace `ref` change in
// .claude/settings.json. It is built from the project's main version with git's plumbing, beside the director's main checkout:
// no file, no index and no branch of the checkout is touched. The branch is then pushed through the helper's /push and the change
// opened through /pr/open-release, which records that the update opened it. Nothing here merges anything.
import { run as defaultRun } from '../lib/run.js';
import { safeGit } from '../lib/safe-git.js';
import { RELEASE_BRANCH, SETTINGS_FILE } from '../lineage/release.js';

const FULL_SHA = /^[0-9a-f]{40}$/;
const IDENTITY = { GIT_AUTHOR_NAME: 'Wheelhouse', GIT_AUTHOR_EMAIL: 'wheelhouse@localhost.invalid', GIT_COMMITTER_NAME: 'Wheelhouse', GIT_COMMITTER_EMAIL: 'wheelhouse@localhost.invalid',
  GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z' };
const MAIN_NOT_FOUND = 'The project\'s main version could not be found, so the change could not be made.';

// The tip of the project's main version: the host's default branch as the checkout last saw it, else a local main or master.
export async function mainTip(git) {
  const head = await git(['symbolic-ref', '-q', 'refs/remotes/origin/HEAD'], { input: '' });
  const names = [head.code === 0 ? head.stdout.trim() : null, 'refs/remotes/origin/main', 'refs/remotes/origin/master', 'refs/heads/main', 'refs/heads/master'].filter(Boolean);
  for (const name of names) {
    const got = await git(['rev-parse', '--verify', '-q', `${name}^{commit}`], { input: '' });
    if (got.code === 0 && FULL_SHA.test(got.stdout.trim())) return got.stdout.trim();
  }
  return null;
}

// The entries of a tree as [mode, type, sha, name], or none for a tree that is not there.
async function entriesOf(git, treeish) {
  if (treeish === null) return [];
  const got = await git(['ls-tree', '-z', treeish], { input: '' });
  if (got.code !== 0) throw new Error('a folder of the project could not be read');
  return got.stdout.split('\0').filter(Boolean).map((entry) => {
    const tab = entry.indexOf('\t');
    const [mode, type, sha] = entry.slice(0, tab).split(' ');
    return [mode, type, sha, entry.slice(tab + 1)];
  });
}

// The tree of `treeish` with the blob `blob` at `parts` (a path inside it), every other entry as it was.
async function withBlob(git, treeish, parts, blob) {
  const [name, ...rest] = parts;
  const entries = (await entriesOf(git, treeish)).filter((e) => e[3] !== name);
  if (rest.length === 0) {
    entries.push(['100644', 'blob', blob, name]);
  } else {
    const found = (await entriesOf(git, treeish)).find((e) => e[3] === name);
    const child = found && found[1] === 'tree' ? found[2] : null;
    entries.push(['040000', 'tree', await withBlob(git, child, rest, blob), name]);
  }
  const made = await git(['mktree', '-z'], { input: entries.map(([mode, type, sha, n]) => `${mode} ${type} ${sha}\t${n}\0`).join('') });
  if (made.code !== 0) throw new Error('the changed folder could not be made');
  return made.stdout.trim();
}

// Opens the change. `client` is the helper's client (push, openReleasePr). Resolves { ok: true, number } or { ok: false, refused }.
export async function openReleaseChange({
  project, projectDir, client, run = defaultRun, git = null, branch, file, text, title, body, release, commit,
}) {
  const refuse = (refused) => ({ ok: false, refused });
  if (!RELEASE_BRANCH.test(String(branch)) || RELEASE_BRANCH.exec(branch)[1] !== commit || !FULL_SHA.test(commit ?? '')) return refuse('The change must be on the release\'s own branch.');
  if (file !== SETTINGS_FILE) return refuse('The update changes only the project\'s Wheelhouse settings.');
  const run_ = git ?? safeGit({ run, cwd: projectDir, list: 'project', look: 'once', caller: 'helper', what: 'the project', env: IDENTITY });
  try {
    // The branch is made again from the project's main version each time, never reused as an earlier try left it: its local name
    // is reset to the commit worked out here. The commit is the same for the same main version (its dates are fixed), so a
    // second try pushes the same commit; a branch of this name on the host that holds anything else is refused by the push,
    // which never forces.
    const base = await mainTip(run_);
    if (base === null) return refuse(MAIN_NOT_FOUND);
    const blob = await run_(['hash-object', '-w', '--stdin'], { input: text });
    if (blob.code !== 0) return refuse('The change could not be made.');
    const root = (await run_(['rev-parse', `${base}^{tree}`], { input: '' })).stdout.trim();
    const tree = await withBlob(run_, root, file.split('/'), blob.stdout.trim());
    const made = await run_(['commit-tree', tree, '-p', base, '-m', title], { input: '' });
    if (made.code !== 0) return refuse('The change could not be made.');
    const ref = await run_(['update-ref', `refs/heads/${branch}`, made.stdout.trim()], { input: '' });
    if (ref.code !== 0) return refuse('The change\'s branch could not be made.');
    const tip = await run_(['rev-parse', '--verify', '-q', `refs/heads/${branch}^{commit}`], { input: '' });
    if (tip.code !== 0 || tip.stdout.trim() !== made.stdout.trim()) return refuse('The change\'s branch could not be made.');
  } catch (error) {
    return refuse(String(error?.message ?? error).replace(/\s+/g, ' '));
  }
  const pushed = await client.push({ project, dir: projectDir, refspec: branch });
  if (pushed?.ok !== true) return refuse(pushed?.refused ?? 'The change could not be sent.');
  const opened = await client.openReleasePr({ project, release, commit, head: branch, title, body });
  if (opened?.ok !== true) return refuse(opened?.refused ?? 'The change could not be opened.');
  const number = opened.result?.number ?? Number(/\/(\d+)\/?$/.exec(String(opened.result?.url ?? ''))?.[1]);
  return { ok: true, ...(Number.isInteger(number) && number > 0 ? { number } : {}) };
}
