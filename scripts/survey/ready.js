// scripts/survey/ready.js
// Ready-made changes (design section 15, rulings A2 and A4; plan rulings P4 and P5): the commit a
// piece of work starts from, put into the project's folder at the work's own ref,
// refs/wheelhouse/from/<work>, and at no other ref. Carrying a request on fetches the host's own
// ref for it (a pull request's refs/pull/<n>/head, a merge request's refs/merge-requests/<n>/head,
// which hold a request from someone's own copy too) from the project's recorded address, and keeps
// it only when it is the head the host listed for the open request. Archiving another agent
// setup's instructions, and putting them back, build one commit each with git's plumbing and a
// temporary index, on the default branch as it is now, so neither the director's index nor their
// working copy is touched. Nothing here pushes: the foreman starts the work from the ref, on a line
// of its own (scripts/foreman/act.js).
//
// `git(args, { input, env })` is git in the project's folder, fenced as setup's git is (folderGit);
// `env` may add only the temporary index and the commit's author.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setupGit } from '../setup/git.js';
import {
  ARCHIVE, ARCHIVE_MANIFEST, PLAIN_FILE, archiveAt, blindKey, insideProject, otherSetupFile, treeEntries, underArchive,
} from '../setup/uninstall.js';
import { SLUG } from '../lib/build-loop.js';
import { scanContent } from '../state/secret-scan.js';

// A refusal said as it is: what couldn't be made ready, and why.
export class ReadyRefusal extends Error {}
const refuse = (message) => { throw new ReadyRefusal(message); };

const FULL_SHA = /^[0-9a-f]{40}$/;
const NO_OBJECT = '0'.repeat(40);
export const ARCHIVE_README = `${ARCHIVE}/README.md`;
// The most work ids tried after the first, and the most a request's text is kept to.
const MOST_TRIES = 20;
const TEXT_CHARS = 20000;
// What a call may add to the fenced environment.
const ADDED = new Set(['GIT_INDEX_FILE', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL']);

export const ARCHIVE_MESSAGE = 'Archive another agent setup\'s instructions';
export const RESTORE_MESSAGE = 'Put another agent setup\'s instructions back';
// What the archive folder says of itself, to anyone who opens it.
const README = [
  '# Archived instructions',
  '',
  'These files are another agent setup\'s instructions. Wheelhouse moved them here, each keeping its path',
  'from the top of the project, so that agents see one set of instructions. No agent reads this folder.',
  '',
  'archived.json lists what was moved and from where. Asking Wheelhouse to put them back moves them back,',
  'and removing Wheelhouse does too.',
  '',
].join('\n');

export const fromRef = (work) => `refs/wheelhouse/from/${work}`;

// git in `folder`, as setup runs it there (scripts/setup/git.js): the repository's settings looked
// at before every call, git's global and system config shut out, no hooks, and the folder as the
// working tree. `env` is the director's sign-in and the transport their recorded address needs.
export function folderGit({ run, folder, env = {} }) {
  return (args, { input, env: added = {} } = {}) => {
    if (Object.keys(added).some((k) => !ADDED.has(k))) throw new Error('only the temporary index and the author may be added to git\'s environment');
    return setupGit({ run, env: { ...env, ...added }, cwd: folder, workTree: folder })(args, input === undefined ? {} : { input });
  };
}

const checkWork = (work) => {
  if (typeof work !== 'string' || !SLUG.test(work)) refuse('the work needs an id that is a short slug');
};
// An address git takes as an address, never as an option.
const checkAddress = (url) => {
  if (typeof url !== 'string' || url === '' || url.startsWith('-') || /[\0-\x1f]/.test(url)) refuse('the project has no address recorded to fetch from');
};
const secretIn = (s) => scanContent(JSON.stringify(String(s))).length > 0;

// The commit `rev` names, in full, or a refusal.
async function commitOf(git, rev, what) {
  const got = await git(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]);
  const sha = String(got.stdout ?? '').trim();
  if (got.code !== 0 || !FULL_SHA.test(sha)) refuse(`${what} couldn't be read in the project's folder`);
  return sha;
}

// Takes the work's ref out again, only while it still names `sha` (any value, without one).
export async function dropRef(git, work, sha = null) {
  try {
    await git(['update-ref', '-d', fromRef(work), ...(sha === null ? [] : [sha])]);
  } catch { /* tidying is best effort */ }
}

// The first of `base`, `base-2`, `base-3` … whose line, feature/<id>, is none of `lines` (the open
// requests' own), is not on the host (read now from `remoteUrl`) nor in the folder (a line of its
// own, the folder's copy of the host's, or a ready-made change at refs/wheelhouse/from/<id>), and
// which `used(id)` doesn't name (work recorded already, or a ready record). The foreman refuses
// work whose line is any of those, so the id said back is one it can start.
export async function freeWork({ git, remoteUrl, base, lines = [], used = () => false }) {
  checkAddress(remoteUrl);
  const listed = await git(['ls-remote', '--heads', remoteUrl]);
  if (listed.code !== 0) refuse('the host couldn\'t be read, to choose a name for the work');
  const held = await git(['for-each-ref', '--format=%(refname)', 'refs/heads/feature/', 'refs/remotes/origin/feature/', 'refs/wheelhouse/from/']);
  if (held.code !== 0) refuse('the project\'s folder couldn\'t be read, to choose a name for the work');
  const taken = new Set([
    ...String(listed.stdout).split('\n').map((l) => l.split('\t')[1]).filter(Boolean),
    ...String(held.stdout).split('\n').map((l) => l.trim()).filter(Boolean),
  ]);
  for (let n = 1; n <= MOST_TRIES; n += 1) {
    const id = n === 1 ? base : `${base}-${n}`;
    if (!SLUG.test(id)) break;
    const line = `feature/${id}`;
    if (lines.includes(line) || taken.has(`refs/heads/${line}`) || taken.has(`refs/remotes/origin/${line}`) || taken.has(fromRef(id))) continue;
    if (await used(id)) continue;
    return id;
  }
  return refuse(`no free name for the work was found after ${base}-${MOST_TRIES}`);
}

// Fetches `source` on the host, from `remoteUrl` alone, into the work's ref, which must not be
// there yet, and gives the commit it names. Nothing else in the folder is written: no other ref,
// no FETCH_HEAD, no tags, no submodule.
export async function fetchInto({ git, remoteUrl, source, work }) {
  checkWork(work);
  checkAddress(remoteUrl);
  if (typeof source !== 'string' || !/^refs\/[A-Za-z0-9._/-]+$/.test(source) || source.includes('..') || source.includes('//')) refuse('the change on the host has a name that isn\'t fetched');
  const ref = fromRef(work);
  if ((await git(['rev-parse', '--verify', '--quiet', ref])).code === 0) refuse(`the work ${work} has a ready-made change already`);
  const fetched = await git(['fetch', '-q', '--no-tags', '--no-recurse-submodules', '--no-write-fetch-head', '--no-prune', remoteUrl, `${source}:${ref}`]);
  if (fetched.code !== 0) {
    await dropRef(git, work);
    refuse('the change couldn\'t be fetched from the host');
  }
  try {
    return await commitOf(git, ref, 'The fetched change');
  } catch (error) {
    await dropRef(git, work);
    throw error;
  }
}

// carryOn({ git, adapter, remoteUrl, number, work }) -> { sha, ref, request, branch, fork, title,
// body, bodyWithheld, files, commits }: open request `number` fetched by the host's own ref for it
// into the work's ref, kept only when it names the head the host lists for the open request now;
// with what a brief is written from. The title, body, file names and subjects are left out where
// the secret scan finds anything (the body says so by `bodyWithheld`).
export async function carryOn({ git, adapter, remoteUrl, number, work }) {
  if (!Number.isInteger(number) || number < 1) refuse('the request\'s number must be a whole number from 1');
  checkWork(work);
  const open = await adapter.openRequests();
  const request = (Array.isArray(open) ? open : []).find((r) => r?.number === number);
  if (request === undefined) refuse(`#${number} isn't open on the host, so there is nothing to carry on`);
  if (typeof request.head !== 'string' || !FULL_SHA.test(request.head)) refuse(`the host didn't say where #${number} stands`);
  const source = adapter.pullRef(number);
  if (source !== `refs/pull/${number}/head` && source !== `refs/merge-requests/${number}/head`) refuse(`the host's ref for #${number} isn't one of its own request refs`);
  const details = await adapter.requestDetails(number);
  const sha = await fetchInto({ git, remoteUrl, source, work });
  if (sha !== request.head) {
    await dropRef(git, work, sha);
    refuse(`#${number} moved on while it was fetched, so it wasn't kept: ask again`);
  }
  const text = (s) => (typeof s === 'string' && !secretIn(s) ? s.slice(0, TEXT_CHARS) : '');
  const body = typeof request.body === 'string' ? request.body : '';
  return {
    sha, ref: fromRef(work), request: number,
    branch: typeof request.branch === 'string' && request.branch !== '' && !/[\0-\x1f]/.test(request.branch) ? request.branch : null,
    fork: request.fork === true,
    title: text(request.title), body: text(body), bodyWithheld: body !== '' && text(body) === '',
    files: (Array.isArray(details?.files) ? details.files : []).filter((f) => typeof f?.path === 'string' && !secretIn(f.path))
      .map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions })),
    commits: (Array.isArray(details?.commits) ? details.commits : []).filter((c) => typeof c === 'string').map(text),
  };
}

// The author and committer of a commit built here: the signed-in host account, as step 7's.
function authorEnv(author) {
  const fine = (s) => typeof s === 'string' && s.trim() !== '' && s.length <= 200 && !/[\0-\x1f<>]/.test(s);
  if (!fine(author?.name) || !fine(author?.email)) refuse('the signed-in account couldn\'t be read, so nothing was built');
  return { GIT_AUTHOR_NAME: author.name, GIT_AUTHOR_EMAIL: author.email, GIT_COMMITTER_NAME: author.name, GIT_COMMITTER_EMAIL: author.email };
}

// A blob of `text` in the folder's objects.
async function blobOf(git, text) {
  const made = await git(['hash-object', '-w', '--stdin'], { input: text });
  const sha = String(made.stdout ?? '').trim();
  if (made.code !== 0 || !FULL_SHA.test(sha)) refuse('git couldn\'t write the archive\'s list');
  return sha;
}

// Every entry of `commit`'s tree, folders too.
async function entriesOf(git, commit) {
  const listed = await git(['ls-tree', '-r', '-t', '-z', '--full-tree', commit]);
  if (listed.code !== 0) refuse('the main line\'s files couldn\'t be read');
  return treeEntries(listed.stdout);
}

// A commit of `base`'s tree with `changes` made ({ path, remove } or { path, mode, sha }), built in
// a temporary index of its own, out of the folder: read-tree, update-index, write-tree, commit-tree.
async function commitWith({ git, base, changes, message, author }) {
  const who = authorEnv(author);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-ready-'));
  const env = { GIT_INDEX_FILE: path.join(dir, 'index') };
  try {
    if ((await git(['read-tree', base], { env })).code !== 0) refuse('the main line\'s files couldn\'t be read');
    const records = changes.map((c) => (c.remove ? `0 ${NO_OBJECT}\t${c.path}\0` : `${c.mode} ${c.sha}\t${c.path}\0`)).join('');
    if ((await git(['update-index', '-z', '--index-info'], { env, input: records })).code !== 0) refuse('git couldn\'t lay out the change');
    const tree = await git(['write-tree'], { env });
    const treeSha = String(tree.stdout ?? '').trim();
    if (tree.code !== 0 || !FULL_SHA.test(treeSha)) refuse('git couldn\'t lay out the change');
    const made = await git(['commit-tree', treeSha, '-p', base, '-F', '-'], { env: who, input: `${message}\n` });
    const sha = String(made.stdout ?? '').trim();
    if (made.code !== 0 || !FULL_SHA.test(sha)) refuse('git couldn\'t make the change');
    return sha;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// The commit fetched into the work's ref (fetchInto), as fetchInto gave it: a full commit, never a
// name read again, since an agent can point the ref elsewhere meanwhile.
async function fetchedBase(git, base) {
  if (typeof base !== 'string' || !FULL_SHA.test(base)) refuse('the change needs the commit fetched to build on');
  return commitOf(git, base, 'The main line as fetched');
}

// Points the work's ref at `sha`, only while it still names `base`, the commit fetched into it.
async function setRef(git, work, sha, base) {
  const set = await git(['update-ref', fromRef(work), sha, base]);
  if (set.code !== 0) refuse('the ready-made change couldn\'t be kept, as its ref moved after it was fetched: ask again');
}

// archiveCommit({ git, base, files, work, author }) -> { sha, ref, moved }: one commit on `base`,
// the default branch's commit fetched into the work's ref (fetchInto), moving each of `files` (the
// survey's list) that is, on `base`, a plain file of another agent setup's instructions to
// .wheelhouse-archive/<its path>, with the list of
// what moved (archived.json, { v: 1, moved: [{ from, to }] }) and a README, as uninstall reads it
// back (scripts/setup/uninstall.js, archiveAt). A file no longer there, a link, or anything under
// the archive folder is left out; a default branch holding an archive already is refused.
export async function archiveCommit({ git, base: fetched, files, work, author }) {
  checkWork(work);
  const ref = fromRef(work);
  const base = await fetchedBase(git, fetched);
  const entries = await entriesOf(git, base);
  if (entries.some((e) => underArchive(e.path))) refuse(`the project has a ${ARCHIVE}/ folder already: put those back first`);
  const at = new Map(entries.map((e) => [e.path, e]));
  const wanted = [...new Set((Array.isArray(files) ? files : []).filter((f) => typeof f === 'string'))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const moves = wanted.filter((from) => insideProject(from) && !underArchive(from) && otherSetupFile(from))
    .map((from) => at.get(from)).filter((e) => e !== undefined && e.type === 'blob' && PLAIN_FILE.includes(e.mode))
    .map((e) => ({ from: e.path, to: `${ARCHIVE}/${e.path}`, mode: e.mode, sha: e.sha }));
  if (moves.length === 0) refuse('none of those instruction files is on the main line now, so there is nothing to archive');
  if (new Set(moves.map((m) => blindKey(m.from))).size < moves.length) refuse('two of those files differ only in the case of their names, so they can\'t share the archive');
  const manifest = `${JSON.stringify({ v: 1, moved: moves.map(({ from, to }) => ({ from, to })) }, null, 2)}\n`;
  const sha = await commitWith({
    git, base, author, message: ARCHIVE_MESSAGE,
    changes: [
      ...moves.map((m) => ({ path: m.from, remove: true })),
      ...moves.map((m) => ({ path: m.to, mode: m.mode, sha: m.sha })),
      { path: ARCHIVE_MANIFEST, mode: '100644', sha: await blobOf(git, manifest) },
      { path: ARCHIVE_README, mode: '100644', sha: await blobOf(git, README) },
    ],
  });
  // Read back as uninstall reads it: every move there to put back.
  const back = await archiveAt(git, sha);
  if (back?.view?.refused !== undefined || back?.view?.moves?.length !== moves.length) refuse('the archive wasn\'t as uninstall reads one, so it wasn\'t kept');
  await setRef(git, work, sha, base);
  return { sha, ref, moved: moves.map((m) => m.from) };
}

// restoreCommit({ git, base, work, author }) -> { sha, ref, moved }: one commit on `base`, fetched as
// archiveCommit's is, putting each archived file back where it was, as uninstall would (archiveAt). A
// file whose place is taken now stays in the archive, and the list then names it alone; once
// everything is back, the list and the README go too. An archive uninstall would refuse is refused.
export async function restoreCommit({ git, base: fetched, work, author }) {
  checkWork(work);
  const ref = fromRef(work);
  const base = await fetchedBase(git, fetched);
  const found = await archiveAt(git, base);
  if (found === null) refuse('there is no archive of another agent setup\'s instructions on the main line, so nothing to put back');
  if (found.view.refused !== undefined) refuse(`the archive can't be put back: ${found.view.refused}`);
  const { moves, taken } = found.view;
  if (moves.length === 0) refuse('nothing in the archive can go back: each file\'s place is taken, or it is gone');
  const left = found.manifest.moved.filter((m) => taken.includes(m.from)).map(({ from, to }) => ({ from, to }));
  const readme = found.entries.find((e) => e.path === ARCHIVE_README && e.type === 'blob');
  const list = left.length === 0
    ? [{ path: ARCHIVE_MANIFEST, remove: true }, ...(readme ? [{ path: ARCHIVE_README, remove: true }] : [])]
    : [{ path: ARCHIVE_MANIFEST, mode: '100644', sha: await blobOf(git, `${JSON.stringify({ v: 1, moved: left }, null, 2)}\n`) }];
  const sha = await commitWith({
    git, base, author, message: RESTORE_MESSAGE,
    changes: [
      ...moves.map((m) => ({ path: m.to, remove: true })),
      ...moves.map((m) => ({ path: m.from, mode: m.mode, sha: m.sha })),
      ...list,
    ],
  });
  await setRef(git, work, sha, base);
  return { sha, ref, moved: moves.map((m) => m.from) };
}
