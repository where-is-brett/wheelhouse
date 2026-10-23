// scripts/host/helper.js
// The host helper (design section 11): a small local server, on a socket file
// or, on Windows, a named pipe. It alone holds the host keys. Agents ask it to
// push a branch, open or update a pull request, read CI, and merge; it applies
// the push rules and the merge gate (section 12.3) before anything reaches the
// host. A key reaches git, gh and glab only through their environment, and no
// answer, error or log carries a key or a remote address with credentials in it.
//
// Pushing: git with a key in its environment runs only in repositories the
// helper owns. Each project has a bare mirror at
// ~/.wheelhouse/projects/<project>/mirror.git, whose origin the helper sets from
// its own state clone. A push first copies the branch's objects from the
// agent's folder into the mirror, with no key, reading nothing but objects
// from that folder (its config, remote, replace refs and hooks count for
// nothing). The checks and the push then run in the mirror, with the key.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import { computerId, helperAddress, profileDir, stateDir, wheelhouseHome } from '../lib/paths.js';
import { stopState, setStop, liftStop } from '../lib/stop.js';
import { bypassActive } from '../lib/bypass.js';
import { run as realRun, withoutGitVars } from '../lib/run.js';
import { gateDecision } from '../gate/conditions.js';
import { classifyChange, readConfig, CI_FILES } from '../gate/guardrails.js';
import { scrub } from './adapter.js';
import { hide, cleanDeep } from '../lib/clean.js';
import { readKey } from './keys.js';
import { checkBaseUrl, gitlabApi } from './gitlab-key.js';
import { DEFAULT_GITLAB } from './gitlab-base.js';
import { unreachableRefusal, certificateRefusal, certificateLine, awayLine, outputKind, companyGitEnv, makeAwayLog, gitlabBaseOf, certificateSetting } from './company-ca.js';
import { childEnv } from './connection.js';
import { protectionStatus } from './protection.js';
import { cutAccess } from './cut-access.js';
import { listEvents, makeEvent, writeEvent, syncState, eventPath, eventHash, dataHash, PLAIN_KINDS, PROTECTED_KINDS, HELPER_ONLY_KINDS, CONFIRMABLE_KINDS } from '../state/events.js';
import { git as stateGit } from '../state/git.js';
import { directorSignIn, reachFor, safeGitEnv } from '../lib/safe-git.js';
import { lookAtSettings, lookRefusalLine, LookRefusal } from '../lib/safe-git.js';
import { cloneState } from '../state/clone.js';
import { takeStartLock } from '../lib/start-lock.js';
import { scanContent, scanText } from '../state/secret-scan.js';
import { buildViews, latestFor, writeViews } from '../state/views.js';
import { takeSurvey, shapedSurvey, recordSurvey } from '../survey/take.js';
import { ReadyRefusal, archiveCommit, carryOn, carryOnPiece, dropRef, fetchInto, folderGit, freeWork, pieceWork, restoreCommit } from '../survey/ready.js';
import { readyRecordFile, writeReadyRecord } from '../survey/ready-record.js';
import { reaching } from '../setup/git.js';
import { directorGitEnv } from '../setup/host.js';
import { commitAuthor } from '../setup/project-files.js';
import { readEnrolled, verify, sign } from '../state/signing.js';
import { delegationReview } from '../frontdesk/learning.js';
import { heldCounter, holdsLock, takeLock, touchLock, readLock } from '../state/lock.js';
import { readProject, isInsideFolder, projectForFolder } from '../lib/projects.js';
import { readLean, leanState, LEAN_NO_HOST } from '../lean/project.js';
import {
  mergeApproved, undoMerge, copyNow, keepMain, leanStatus, storeHead, mergeOnMain, LeanRefusal, LEAN_APPROVE, MAIN_MOVED_LINE, UNDO_LINE,
  SIGNED_LEAN_PROOFS, sameCard, approvalCard, mainMovedCard, undoCard,
} from '../lean/store.js';
import { CHAT_PROOFS, CONFIRMED_STEPS } from '../agents/chat-clicks.js';
import { SIGNED_LABELS, earned } from '../hooks/prompt-record.js';
import { askInWindow, NOT_NOW } from '../confirm/window.js';
import { composeCard } from '../cards/compose.js';
import { LIFT_STOP_CARD } from '../frontdesk/cli.js';
import { matchGlob } from '../gate/glob.js';
import { ciPushLine } from '../state/card-lines.js';
import { checkSetting, definitionOf } from '../settings/catalogue.js';
import { writeBackup, KEEP as BUNDLES_KEPT } from '../state/backup.js';
import { BUNDLE_PATH, PROFILE_BRANCH, PROFILE_HOLDS_KEYS, holdsKeys, profileRemote, ensureProfileClone, writeProfileViews } from '../profile/store.js';
import { canonicalJson } from '../lib/canonical.js';
import { pendingDir } from '../hooks/pending.js';
import { branchOf } from '../hooks/session-start.js';
import { SLUG } from '../lib/build-loop.js';
import { ROOT as OWN_ROOT } from '../lineage/check.js';
import { bodyProvenance, provenanceBlock, sessionProvenance, stampProvenance } from '../lineage/provenance.js';
import { RELEASE_BRANCH, SETTINGS_FILE, briefingLine, checkRelease, pinsOnlyChange } from '../lineage/release.js';
import { WHEELHOUSE_URL } from '../lineage/manifest.js';
import { SCREEN_SIZES, PUT_OFF } from '../lib/front-desk.js';
import { CLICK_MS } from '../lib/core-numbers.js';
import { compareCommits, photographCommit } from '../screens/compare.js';
import { findBrowser, shoot as shootPage, stopsAtPicture } from '../screens/shoot.js';
import { FOREMAN_OUTPUT_BYTES, FOREMAN_RUNNER, FOREMAN_RUN_MS, foremanEnv, foremanRequestRefusal } from './foreman-run.js';
import { setupRoutes, SetupRefusal, STEPS_MODULE } from '../setup/engine.js';
import { uninstallRoutes } from '../setup/uninstall.js';
import { baselineRoutes } from '../measures/baseline.js';
import { ENROLMENT_FILE, MAX_ENROLMENTS, MAX_ENROLMENT_BYTES, enrolmentOf } from '../lib/trust-clicks.js';
import { NO_CLEAN_REVIEW } from '../gate/conditions.js';
import { runReview } from '../review/clean-session.js';
import { reviewsFor } from '../agents/reviews.js';
import { agentOfConfig } from '../agents/project-agent.js';
import { briefHash, featurePaths } from '../feature/files.js';
import { readCapped } from '../feature/status.js';

export const STATE_BRANCH = 'wheelhouse-state';
// The adapter's refusal of a merge by a key GitLab does not let merge (adapter.js), and what the
// director is told on GitLab, where a project with real users merges by Maintainers only.
const NOT_ALLOWED_TO_MERGE = 'this sign-in is not allowed to merge it';
export const GITLAB_MAINTAINERS_ONLY = `${NOT_ALLOWED_TO_MERGE}: a project with real users is merged by Maintainers only on GitLab, so a person who is a Maintainer presses Merge there`;
export const LOCK_BRANCH = 'wheelhouse-lock';
const REMOTE = 'origin';
const INCOMING = 'refs/wheelhouse/incoming';
// A pull's refs in the mirror: the host's copy of the branch, and what is handed back. The bundle
// names PULLED, which `cli.js pull` fetches from it.
const PULL_HOST = 'refs/wheelhouse/pull-host';
const PULLED = 'refs/wheelhouse/pulled';
// The largest bundle a pull hands back in its answer.
const PULL_BUNDLE_BYTES = 32 * 1024 * 1024;
const MOST_BODY = 1024 * 1024;
const PROBE_MS = 1000;
const PIPE = /^\\\\[.?]\\pipe\\/i;
// Git for Windows reads "/dev/null" as its null device too.
const NO_FILE = '/dev/null';
// A restore pull request may be merged under STOP for a day after the director's step 3 click.
const RESTORE_MS = 24 * 60 * 60 * 1000;
const CONTAIN_MS = 10 * 60 * 1000;
const RESTORE_PREFIX = 'wheelhouse-restore-';
const RESTORE_BRANCH = /^wheelhouse-restore-([0-9a-f]{12})$/;
const NEEDS_CLICK = 'this step needs the director\'s click on its card';
const NOT_EARLIER = 'that is not an earlier commit of the default branch, so the product is not put back to it';
const NO_HARM = 'This project has defined no live harm to contain';
const BACKUP_FILE = /^\d{4}-\d{2}-\d{2}\.bundle$/;
const BACKUP_REF = 'refs/wheelhouse/backup';
const EVENT_FILE = /^events\/\d{4}\/\d{2}\/[A-Za-z0-9._-]+\.json$/;
// A version 4 UUID as crypto.randomUUID writes it.
const RANDOM_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// The most of one kept record that is read: a signed click is a few kilobytes.
const PENDING_BYTES = 256 * 1024;

// The records the hooks kept in projects/<p>/pending/ to send later, each { route, body }. Only
// regular files of at most PENDING_BYTES are read; anything else, or a file that won't read, is
// passed over.
function pendingRecords(project) {
  let names = [];
  try {
    names = fs.readdirSync(pendingDir(project)).filter((n) => n.endsWith('.json'));
  } catch { /* none kept */ }
  return names.flatMap((name) => {
    try {
      const file = path.join(pendingDir(project), name);
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.size > PENDING_BYTES) return [];
      const { route, body } = JSON.parse(fs.readFileSync(file, 'utf8'));
      return [{ route, body }];
    } catch {
      return []; // not a record
    }
  });
}

// The ids those records hold: a signed record's own id, the id of the event a kept confirmation
// carries, or a write's given id.
const idsOf = (records) => new Set(records.flatMap(({ body }) => [body?.event?.id, body?.target?.id, body?.id]).filter((id) => typeof id === 'string'));

// Whether a write with this id is one a hook kept to send (a setup answer's glossary entry, ruling
// R59): a kept write of that very kind and data under that id, and no other kept record holding it.
function keptWrite(records, { kind, data, id }) {
  const holding = records.filter(({ body }) => [body?.event?.id, body?.target?.id, body?.id].includes(id));
  return holding.length > 0 && holding.every(({ route, body }) => route === 'write' && body?.id === id && body.kind === kind
    && canonicalJson(body.data ?? null) === canonicalJson(data));
}
const MOST_OUTPUT = 2000;
const MOST_KEPT = 64 * 1024;
// Text from git, gh or glab that says the sign-in is missing or refused.
const AUTH_FAILURE = /authentication|could not read username|permission denied|\b40[13]\b|not logged in|auth login|sign in/i;
const NOT_AMONG = 'that commit is not among the last ten merges, so the product is not put back to it';
const LOCK_REASON = 'this computer no longer holds the lock';
const NO_PROVENANCE = 'this session\'s provenance is not on this computer, so the pull request could not say what built it: send it from a session that started on this computer';

// The plugin's version, from .claude-plugin/plugin.json beside these scripts, so session-start
// can tell a helper left running from an older copy. Null when it cannot be read.
const PLUGIN_VERSION = (() => {
  try {
    const version = JSON.parse(fs.readFileSync(new URL('../../.claude-plugin/plugin.json', import.meta.url), 'utf8'))?.version;
    return typeof version === 'string' && version !== '' ? version : null;
  } catch {
    return null;
  }
})();

// A cache file of pictures' hashes not written for this long is cleared out of the project's cache
// when an approved commit is next photographed.
const SCREENS_KEPT_MS = 30 * 24 * 60 * 60 * 1000;

const FOLDER_MS = 60 * 1000;
const HOST_MS = 5 * 60 * 1000;

// Every git call the helper makes: no prompting, no replace refs. Each starts
// from the helper's environment with every inherited GIT_* variable removed.
const GIT_BASE = { GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1' };

const UNREADABLE_CHANGES = 'the changed files couldn\'t be read, so this needs the director\'s approval';
const BASE_REF = 'refs/wheelhouse/base';
const CONFIG_FILE = '.claude/wheelhouse.json';

// What a pull request changes, and the project's configuration. The pull
// request's head and the default branch are fetched into the mirror with the
// connection's key (`run` is the keyed git runner); the head must be the one
// the host reported. Paths come from the merge base, with renames listed as a
// delete and an add, so a file moved out of .claude/ still counts by its old
// path. The configuration is read from the default branch, never the pull request. For each
// file in `read` that the pull request changes, `files` holds its text at the merge base and at
// the head (null where it is absent) and the head's mode.
export async function changedPaths({ mirror, host, number, headSha, defaultBranch, run: git, read = [] }) {
  if (!Number.isInteger(number) || number < 1) throw new Error('the pull request number must be a whole number from 1');
  if (typeof headSha !== 'string' || !/^[0-9a-f]{40,64}$/.test(headSha)) throw new Error('the head commit is not known');
  if (!plainBranch(defaultBranch)) throw new Error('the default branch is not known');
  const source = host === 'gitlab' ? `refs/merge-requests/${number}/head` : `refs/pull/${number}/head`;
  const prRef = `refs/wheelhouse/pr/${number}`;
  const inMirror = (args, options = {}) => git('git', args, { cwd: mirror, ...options });
  const must = async (args, what) => {
    const answer = await inMirror(args);
    if (answer.code !== 0) throw new Error(`${what} failed`);
    return answer.stdout;
  };
  await must(['fetch', '-q', '--no-tags', REMOTE, `+${source}:${prRef}`, `+refs/heads/${defaultBranch}:${BASE_REF}`], 'fetching the pull request');
  try {
    const fetched = (await must(['rev-parse', '--verify', '--end-of-options', `${prRef}^{commit}`], 'reading the fetched head')).trim();
    if (fetched !== headSha) throw new Error('the fetched head is not the head the host reported');
    const base = (await must(['merge-base', BASE_REF, prRef], 'finding the merge base')).trim();
    const listed = await must(['diff', '--name-only', '-z', '--no-renames', base, prRef], 'listing the changed files');
    const paths = listed.split('\0').filter((p) => p !== '');
    const files = {};
    for (const file of read.filter((f) => paths.includes(f))) {
      const [before, after] = [await blobAt(must, base, file), await blobAt(must, prRef, file)];
      files[file] = { base: before.text, head: after.text, headMode: after.mode };
    }
    return { paths, config: await baseConfig(must), files };
  } finally {
    await inMirror(['update-ref', '-d', prRef]);
  }
}

// One file at `commit` in the mirror, through `must`: { text, mode }, both null when it is absent.
async function blobAt(must, commit, file) {
  const listed = await must(['ls-tree', '-z', commit, '--', file], 'looking for a changed file');
  const entry = /^(\d{6}) blob [0-9a-f]+\t/.exec(listed);
  if (!entry) return { text: null, mode: null };
  return { text: await must(['cat-file', 'blob', `${commit}:${file}`], 'reading a changed file'), mode: entry[1] };
}

// The project's configuration from the default branch's commit (BASE_REF),
// through `must`, which runs git in the mirror and throws when it fails.
async function baseConfig(must) {
  const present = await must(['ls-tree', '-z', '--name-only', BASE_REF, '--', CONFIG_FILE], 'looking for the configuration');
  return readConfig(present === '' ? null : await must(['show', `${BASE_REF}:${CONFIG_FILE}`], 'reading the configuration'));
}

// The pages an approval's screenshots are compared on, from a configuration: none unless it lists some.
const pagesOf = (config) => (Array.isArray(config?.pages) ? config.pages : []);

// The project's cache of pictures' hashes: beside its mirror, outside the state repository, so
// never committed or pushed.
const screensDir = (project) => path.join(stateDir(project), '..', 'screens');

// Removes the files in `dir` not modified for SCREENS_KEPT_MS, by this computer's clock, which is
// the one that set their times. Best effort.
function pruneScreens(dir, nowMs = Date.now()) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const name of names) {
    try {
      const file = path.join(dir, name);
      const stat = fs.lstatSync(file);
      if (stat.isFile() && nowMs - stat.mtimeMs > SCREENS_KEPT_MS) fs.rmSync(file, { force: true });
    } catch { /* left for next time */ }
  }
}

// The paths a branch changes from the default branch (merge base to `sha`),
// and the project's configuration. `sha` is already in the mirror.
async function branchChanges({ mirror, sha, defaultBranch, run: git }) {
  if (!plainBranch(defaultBranch)) throw new Error('the default branch is not known');
  const must = async (args, what) => {
    const answer = await git('git', args, { cwd: mirror, input: '' });
    if (answer.code !== 0) throw new Error(`${what} failed`);
    return answer.stdout;
  };
  const fetched = await git('git', ['fetch', '-q', '--no-tags', REMOTE, `+refs/heads/${defaultBranch}:${BASE_REF}`], { cwd: mirror });
  let from = null;
  let config = readConfig(null);
  if (fetched.code === 0) {
    // With no common history the whole branch counts as changed: it is compared with nothing.
    const common = await git('git', ['merge-base', BASE_REF, sha], { cwd: mirror });
    from = common.code === 0 ? common.stdout.trim() : null;
    config = await baseConfig(must);
  } else {
    // A host with no default branch yet has nothing to compare with; any other failure is not read.
    const listed = await must(['ls-remote', '--heads', REMOTE, `refs/heads/${defaultBranch}`], 'looking for the default branch');
    if (listed.trim() !== '') throw new Error('fetching the default branch failed');
  }
  from ??= (await must(['hash-object', '-t', 'tree', '--stdin'], 'making the empty tree')).trim();
  const listed = await must(['diff', '--name-only', '-z', '--no-renames', from, sha], 'listing the changed files');
  return { paths: listed.split('\0').filter((p) => p !== ''), config };
}

// git in the mirror runs no hooks, and a merge reads no attributes from outside it.
const NO_HOOKS = ['-c', `core.hooksPath=${NO_FILE}`];
const MERGE_ONLY = [
  ...NO_HOOKS, '-c', `core.attributesFile=${NO_FILE}`, '-c', 'core.fsmonitor=false', '-c', 'merge.renormalize=false',
];
const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

// The patch-id of what `head` changes from its merge base with `base` (design section 12):
// `git diff` of the two, binary files included, through `git patch-id --verbatim` (which is
// --stable keeping whitespace; git refuses the two flags together): it ignores line numbers
// but not whitespace, since indentation can be code (ruling R111).
// `git(args, options)` runs git in the mirror. Empty when nothing changes; throws when git fails.
export async function patchIdOf({ git, base, head }) {
  const common = await git([...NO_HOOKS, 'merge-base', '--end-of-options', base, head], { input: '' });
  if (common.code !== 0) throw new Error('finding the merge base failed');
  const diff = await git([...MERGE_ONLY, 'diff', '--no-ext-diff', '--no-textconv', '--binary', '--end-of-options', common.stdout.trim(), head, '--'], { input: '' });
  if (diff.code !== 0) throw new Error('reading the change failed');
  const id = await git(['patch-id', '--verbatim'], { input: diff.stdout });
  if (id.code !== 0) throw new Error('reading the patch-id failed');
  return id.stdout.trim().split(/\s+/)[0] ?? '';
}

// Whether `commit` is a clean update merge: two parents, and its tree is the tree `git
// merge-tree --write-tree` makes of them, so the merge itself changed nothing by hand. With
// `first`, its first parent must be that commit (the pull request's earlier commit); with
// `base`, its second parent must be an ancestor of `base` (the default branch's head), so the
// merge brings in only the default branch, never a side branch of the feature's own.
export async function cleanUpdate({ git, commit, first, base }) {
  if (typeof commit !== 'string' || !FULL_SHA.test(commit)) return false;
  // `commit` is a full ID, so nothing here reads as an option (rev-parse without --verify echoes --end-of-options).
  const listed = await git([...NO_HOOKS, 'rev-parse', `${commit}^{commit}`, `${commit}^@`], { input: '' });
  if (listed.code !== 0) return false;
  const [, ...parents] = listed.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  if (parents.length !== 2 || !parents.every((p) => FULL_SHA.test(p))) return false;
  if (first !== undefined && parents[0] !== first) return false;
  if (base !== undefined) {
    const fromBase = await git([...NO_HOOKS, 'merge-base', '--is-ancestor', '--end-of-options', parents[1], base], { input: '' });
    if (fromBase.code !== 0) return false;
  }
  const merged = await git([...MERGE_ONLY, 'merge-tree', '--write-tree', '--no-messages', '--end-of-options', ...parents], { input: '' });
  if (merged.code !== 0) return false;
  const own = await git([...NO_HOOKS, 'rev-parse', '--verify', '-q', `${commit}^{tree}`], { input: '' });
  return own.code === 0 && own.stdout.trim() === merged.stdout.split('\n')[0].trim();
}

// The author and committer of the commits the helper makes itself.
const WHEELHOUSE_AUTHOR = {
  GIT_AUTHOR_NAME: 'Wheelhouse', GIT_AUTHOR_EMAIL: 'wheelhouse@invalid', GIT_COMMITTER_NAME: 'Wheelhouse', GIT_COMMITTER_EMAIL: 'wheelhouse@invalid',
};

const ciPatterns = (config) => [...CI_FILES, ...config.ciFiles];
const touchesCi = (paths, config) => paths.some((file) => ciPatterns(config).some((p) => matchGlob(p, file, { ignoreCase: true })));

// The incident the gate weighs for a pull request, from the views (design section 12): none open
// is `{ open: false }`. With any open, it is a fix when a verified `incident-fix` of any open
// incident names this pull request (the fix the director clicked is the point); otherwise the id
// is an open incident's, so the reason names one.
export function incidentFor(views, number) {
  const open = views.incidents?.open;
  if (!Array.isArray(open)) return { open: true, isFix: false };
  if (open.length === 0) return { open: false };
  const fixing = open.find((i) => Array.isArray(i.fixes) && i.fixes.includes(number));
  return { open: true, id: (fixing ?? open[0]).id, isFix: fixing !== undefined };
}

const STATE_BEHIND = 'the state could not be brought up to date';
const STATE_DAMAGED = 'the state has damaged events, so an open incident or a shown-first change can\'t be ruled out';

// The work a pull request's head branch names: `feature/<work>` or `feature/<work>/<slice>`.
const FEATURE_BRANCH = new RegExp(`^feature/(${SLUG.source.slice(1, -1)})(?:/[^/]+)?$`);

// Whether the work's signed approval makes the director's approval of this pull request needed
// because the work is shown first (design section 12). The wish is read from the views, which
// take it from the verified `approve-work` alone, never from the work event or the caller, and
// keep it once any of the work's approvals said it, in any lane or for any document (ruling R120).
// A branch that names no work, or work never approved shown first, adds nothing. For work now in
// the feature lane, only a pull request that changes one of the project's flag files counts (the
// switch-on); with no flag files listed, or in any other lane, every pull request of the work does.
export function shownFirstNeeded({ views, headRef, paths, config }) {
  const work = FEATURE_BRANCH.exec(typeof headRef === 'string' ? headRef : '')?.[1];
  if (work === undefined || !Object.hasOwn(views.work ?? {}, work)) return false;
  const w = views.work[work];
  if (w.shownFirst !== true && w.approval?.shownFirst !== true) return false;
  if (w.work?.data?.lane !== 'feature' || config.flagFiles.length === 0) return true;
  return paths.some((file) => config.flagFiles.some((p) => matchGlob(p, file, { ignoreCase: true })));
}

// The git configuration files of a folder, read with fs only: running git
// there could run what the folder's configuration names. Null when the folder
// has no repository; throws when one cannot be read.
function folderGitConfigs(dir) {
  const readIf = (file) => {
    try { return fs.readFileSync(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
  };
  const dot = path.join(dir, '.git');
  let gitdir = null;
  let stat = null;
  try { stat = fs.lstatSync(dot); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (stat?.isDirectory()) {
    gitdir = dot;
  } else if (stat) {
    const match = /^gitdir:\s*(.+?)\s*$/m.exec(readIf(dot));
    if (!match) throw new Error('the folder\'s .git file could not be read');
    gitdir = path.resolve(dir, match[1]);
  } else if (fs.existsSync(path.join(dir, 'HEAD')) && fs.existsSync(path.join(dir, 'objects'))) {
    gitdir = dir;
  }
  if (gitdir === null) return null;
  const dirs = [gitdir];
  const common = readIf(path.join(gitdir, 'commondir')).trim();
  if (common !== '') dirs.push(path.resolve(gitdir, common));
  return dirs.flatMap((d) => [readIf(path.join(d, 'config')), readIf(path.join(d, 'config.worktree'))]);
}

function isPartialClone(dir) {
  const configs = folderGitConfigs(dir);
  // No repository in the folder itself: git would also try <dir>.git, which is not read here.
  if (configs === null) throw new Error('no repository in the folder');
  // An included file is not followed, so a config that includes one is not read.
  return configs.some((text) => /promisor|partialclone|\[\s*include/i.test(text));
}

// A repository's git settings that the look refused (or could not read): its text is the route's refusal.
export { LookRefusal };

export const PUSH_REFUSALS = {
  plain: 'only a plain branch name may be pushed',
  force: 'a force-push is refused',
  remove: 'a branch is never deleted through the helper',
  same: 'a branch may only be pushed to the branch of the same name',
  defaultBranch: 'the default branch is never pushed to: changes reach it only by a merge',
  unknownDefault: 'the default branch is not known, so nothing is pushed',
  missing: 'that branch does not exist in the folder',
  shallow: 'a shallow repository cannot be checked, so nothing is pushed',
  state: 'a state push may only add new plain files under events/',
  lock: 'a lock push may only change lock.json',
  merges: 'a state or lock push may not carry a merge commit',
  ownRequests: 'state and the lock are written through their own requests',
  unchecked: 'the commits being pushed could not be checked',
  ciFile: 'the branch changes a CI file, so it needs the director\'s click on its card',
  ciSignIn: 'sign in to GitHub (or GitLab) on this computer to push the CI change',
  outsideProject: 'the folder to push from is not inside the project',
  notOwn: 'that is not the branch this folder is on: a push sends only the folder\'s own branch',
  partialClone: 'the folder is set up to fetch missing objects from elsewhere, so it is not read',
  movedOn: 'the host\'s branch has moved on since this one was taken from it',
  notJson: 'a file in the state push is not JSON, so nothing is pushed',
  prBase: 'a pull request may only be opened against the default branch',
  profile: 'a profile push may only add new event files under events/, and add or remove bundles under backups/',
  profileNotJson: 'a file in the profile push is not JSON, so nothing is pushed',
};

// Why /pr/update-branch leaves a pull request alone: only the loop's own feature branches, in
// this repository and against the default branch, are brought up to date.
const UPDATE_REFUSALS = {
  base: 'only a pull request against the default branch is brought up to date',
  branch: 'only a pull request from a feature/<work> branch is brought up to date',
  fork: 'the pull request\'s head is not this repository\'s branch of that name, so it is not brought up to date: it may come from a fork',
};

// Why a feature session's pull (/pull) brings nothing in.
export const PULL_REFUSALS = {
  plain: 'only a plain branch name can be brought in',
  feature: 'only a feature/<work> branch is brought in through the helper',
  notOwn: 'that is not the branch this folder is on: a pull brings in only the worktree\'s own branch',
  outsideProject: 'the folder to bring the branch into is not inside the project',
  shallow: 'a shallow repository cannot be checked, so nothing is brought in',
  conflict: 'the host\'s branch and this one change the same lines, so nothing was brought in',
  tooLarge: 'what the host\'s branch adds is too large to hand back through the helper',
  unread: 'the host\'s branch could not be read',
};

// A plain branch name: [A-Za-z0-9._/-], not refs/..., not HEAD, and nothing git
// would read as an option or refuse as a ref name.
function plainBranch(name) {
  return typeof name === 'string'
    && /^[A-Za-z0-9._/-]+$/.test(name)
    && !name.startsWith('refs/')
    && name !== 'HEAD'
    && !/^[-./]/.test(name)
    && !/[/.]$/.test(name)
    && !name.includes('..')
    && !name.includes('//')
    && !name.includes('/.')
    && !name.endsWith('.lock');
}

// What a state or lock push may carry, by status letter, new mode and path.
// 100644 is a plain file: no symlinks, gitlinks or executables.
const ALLOWED_CHANGE = {
  [STATE_BRANCH]: (status, mode, file) => status === 'A' && mode === '100644'
    && file.startsWith('events/') && file.length > 'events/'.length,
  [LOCK_BRANCH]: (status, mode, file) => (status === 'A' || status === 'M') && mode === '100644' && file === 'lock.json',
};

// What a profile push may carry: new plain event files, and bundles added to or removed
// from backups/<project>/. Nothing under keys/, nothing changed in place.
const PROFILE_CHANGE = (status, mode, file) => (ALLOWED_CHANGE[STATE_BRANCH](status, mode, file))
  || (BUNDLE_PATH.test(file) && ((status === 'A' && mode === '100644') || (status === 'D' && mode === '000000')));

// Checks every commit up to `sha` that the remote's copy of `branch` lacks.
// The remote's copy is fetched first; with none, every commit is checked, the
// root commit included.
async function checkCommits({ dir, branch, sha, gitRun, allowed, refused, scan = false, push = 'state' }) {
  const git = (args) => gitRun('git', args, { cwd: dir, env: { GIT_NO_REPLACE_OBJECTS: '1' } });
  const tracking = `refs/remotes/${REMOTE}/${branch}`;
  let range = [sha];
  const fetched = await git(['fetch', '-q', '--no-tags', REMOTE, `+refs/heads/${branch}:${tracking}`]);
  if (fetched.code === 0) {
    range = [sha, `^${tracking}`];
  } else {
    const listed = await git(['ls-remote', '--heads', REMOTE, `refs/heads/${branch}`]);
    // `away`: the host could not be reached at all, which the caller says in its own line.
    if (listed.code !== 0) {
      const kind = outputKind(`${fetched.stderr}\n${listed.stderr}`);
      return { allowed: false, refused: PUSH_REFUSALS.unchecked, away: kind === 'unreachable', untrusted: kind === 'certificate' };
    }
    if (listed.stdout.trim() !== '') return { allowed: false, refused: PUSH_REFUSALS.unchecked };
  }
  const listed = await git(['rev-list', '--parents', ...range, '--']);
  if (listed.code !== 0) return { allowed: false, refused: PUSH_REFUSALS.unchecked };
  for (const line of listed.stdout.split('\n').filter(Boolean)) {
    const [commit, ...parents] = line.trim().split(/\s+/);
    if (parents.length > 1) return { allowed: false, refused: PUSH_REFUSALS.merges };
    const changed = await git(['diff-tree', '--no-commit-id', '-r', '--raw', '--no-renames', '-z', '--root', commit]);
    if (changed.code !== 0) return { allowed: false, refused: PUSH_REFUSALS.unchecked };
    // -z --raw: ":<old mode> <new mode> <old id> <new id> <status>\0<path>\0" per file.
    const parts = changed.stdout.split('\0');
    for (let i = 0; i < parts.length; i += 2) {
      const meta = parts[i];
      if (meta === '') break;
      const [, newMode, , newId, status] = meta.replace(/^:/, '').split(' ');
      const file = parts[i + 1];
      if (typeof file !== 'string' || !allowed(status, newMode, file)) return { allowed: false, refused };
      // `scan` is true for every file, or picks the files to scan.
      if (scan === true || (typeof scan === 'function' && scan(file))) {
        const found = await scanAdded(git, newId, file, push);
        if (found) return { allowed: false, refused: found };
      }
    }
  }
  return { allowed: true };
}

// The secret scan on one file a state or profile push adds (design section 9): its text
// and every decoded string in it. A refusal names the patterns and the file,
// never the value; a file name that itself matches is not repeated.
async function scanAdded(git, blob, file, push = 'state') {
  if (scanText(file).length > 0) return `a file in the ${push} push has a name that looks like a secret, so nothing is pushed`;
  const read = await git(['cat-file', 'blob', blob]);
  if (read.code !== 0) return PUSH_REFUSALS.unchecked;
  const found = scanContent(read.stdout);
  if (found.length > 0) return `the ${push} push was refused because ${file} matched: ${found.join(', ')}`;
  try { JSON.parse(read.stdout); } catch { return push === 'profile' ? PUSH_REFUSALS.profileNotJson : PUSH_REFUSALS.notJson; }
  return null;
}

// The spelling rules alone: `<branch>` or `<branch>:<branch>`, no `+`, a plain
// name, not the default branch.
export function checkRefspec(refspec, defaultBranch) {
  if (typeof refspec !== 'string' || refspec === '') return { allowed: false, refused: PUSH_REFUSALS.plain };
  if (refspec.startsWith('+')) return { allowed: false, refused: PUSH_REFUSALS.force };
  if (refspec.startsWith(':')) return { allowed: false, refused: PUSH_REFUSALS.remove };
  const parts = refspec.split(':');
  if (parts.length > 2) return { allowed: false, refused: PUSH_REFUSALS.plain };
  const [source, target = source] = parts;
  if (!plainBranch(source)) return { allowed: false, refused: PUSH_REFUSALS.plain };
  if (target !== source) return { allowed: false, refused: PUSH_REFUSALS.same };
  if (typeof defaultBranch !== 'string' || defaultBranch === '') return { allowed: false, refused: PUSH_REFUSALS.unknownDefault };
  if (source === defaultBranch) return { allowed: false, refused: PUSH_REFUSALS.defaultBranch };
  return { allowed: true, branch: source };
}

// Whether a push may go ahead: the spelling rules, then, in `dir`, the commit
// being pushed (`sha`, or the branch's own commit when not given). A shallow
// repository is refused. A state push may only add plain files under events/,
// a lock push may only change lock.json. Resolves with the commit checked,
// which is the one to push.
export async function checkPush({
  refspec, dir, defaultBranch, stateBranch = STATE_BRANCH, lockBranch = LOCK_BRANCH, gitRun, sha,
}) {
  // The runner is the caller's fenced one; there is no unfenced default.
  if (typeof gitRun !== 'function') throw new Error('checkPush needs a fenced git runner');
  const spelled = checkRefspec(refspec, defaultBranch);
  if (!spelled.allowed) return spelled;
  const { branch } = spelled;
  const git = (args) => gitRun('git', args, { cwd: dir, env: { GIT_NO_REPLACE_OBJECTS: '1' } });

  const shallow = await git(['rev-parse', '--is-shallow-repository']);
  if (shallow.code !== 0) return { allowed: false, refused: PUSH_REFUSALS.unchecked };
  if (shallow.stdout.trim() === 'true') return { allowed: false, refused: PUSH_REFUSALS.shallow };

  const resolved = await git(['rev-parse', '--verify', '-q', `${sha ?? `refs/heads/${branch}`}^{commit}`]);
  const commit = resolved.stdout.trim();
  if (resolved.code !== 0 || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(commit)) return { allowed: false, refused: PUSH_REFUSALS.missing };

  const rules = { [stateBranch]: ALLOWED_CHANGE[STATE_BRANCH], [lockBranch]: ALLOWED_CHANGE[LOCK_BRANCH] };
  if (rules[branch]) {
    const refusal = branch === stateBranch ? PUSH_REFUSALS.state : PUSH_REFUSALS.lock;
    const checked = await checkCommits({
      dir, branch, sha: commit, gitRun, allowed: rules[branch], refused: refusal, scan: branch === stateBranch,
    });
    if (!checked.allowed) return checked;
  }
  return { allowed: true, branch, sha: commit };
}

// --- keeping secrets out of answers ---
// `hide` and `cleanDeep` are in scripts/lib/clean.js, which the setup engine uses too.

// The secrets in a connection's environment: the keys themselves, and the
// header git is given, with the base64 inside it and the key that decodes from it.
export function secretsOf(env) {
  const out = new Set();
  const add = (value) => { if (typeof value === 'string' && value.length >= 8) out.add(value); };
  for (const [name, value] of Object.entries(env ?? {})) {
    if (typeof value !== 'string') continue;
    if (name === 'GH_TOKEN' || name === 'GITLAB_TOKEN') add(value);
    if (/^GIT_CONFIG_VALUE_\d+$/.test(name)) {
      add(value);
      const match = /\b(?:basic|bearer)\s+(\S+)/i.exec(value);
      if (match) {
        add(match[1]);
        const decoded = Buffer.from(match[1], 'base64').toString('utf8');
        if (/^[\x20-\x7e]+$/.test(decoded)) {
          add(decoded);
          add(decoded.slice(decoded.indexOf(':') + 1));
        }
      }
    }
  }
  return [...out].sort((a, b) => b.length - a.length);
}

// For refusals and errors: the adapter's scrub (key-like text), then every
// secret and any credentials in an address.
function clean(text, secrets) {
  return hide(scrub(hide(text, secrets), Object.fromEntries(secrets.map((s, i) => [i, s]))), secrets);
}

// --- serving ---

// One in-flight call per project: concurrent requests share it, so a rotating
// renewal key is never used twice at once.
export function serialisePerProject(fn) {
  const inFlight = new Map();
  return (project, ...rest) => {
    if (inFlight.has(project)) return inFlight.get(project);
    const promise = Promise.resolve().then(() => fn(project, ...rest));
    inFlight.set(project, promise);
    const done = () => { if (inFlight.get(project) === promise) inFlight.delete(project); };
    promise.then(done, done);
    return promise;
  };
}

// envFor for the real helper: the connection's mode, and its environment from childEnv.
export function envForConnection(connectionFor, { fetch, now } = {}) {
  return async (project) => {
    const connection = await connectionFor(project);
    return { mode: connection?.mode, env: await childEnv(connection, { fetch, now }) };
  };
}

// envFor may answer `{ mode, env }` or a bare environment. A bare one is quick
// when it carries no key, narrow when it does.
export function connectionOf(answer) {
  if (answer && typeof answer === 'object' && (answer.mode === 'quick' || answer.mode === 'narrow')
    && answer.env && typeof answer.env === 'object') {
    return { mode: answer.mode, env: answer.env };
  }
  const env = answer && typeof answer === 'object' ? answer : {};
  // A GIT_CONFIG_VALUE_<n> is a key unless its setting is the company's certificate (company-ca.js).
  const keyed = Object.keys(env).some((k) => k === 'GH_TOKEN' || k === 'GITLAB_TOKEN'
    || (/^GIT_CONFIG_VALUE_\d+$/.test(k) && !certificateSetting(env[`GIT_CONFIG_KEY_${k.slice('GIT_CONFIG_VALUE_'.length)}`])));
  return { mode: keyed ? 'narrow' : 'quick', env };
}

class Refusal extends Error {}
const refuse = (message) => { throw new Refusal(message); };

const NOT_IN_PROJECT = 'This folder is not inside a Wheelhouse project, so the helper does not know which project to act on.';
const FOLDER_NOT_PROJECT = 'the folder given is not inside the project named';

// The project whose folder holds `cwd`, a full path.
function placeFolder(cwd) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) refuse('the folder must be a full path');
  const found = projectForFolder(cwd);
  if (!found) refuse(NOT_IN_PROJECT);
  return found.project;
}

// Beside the runbook's routes, the routes a feature session's commands (scripts/feature/cli.js)
// call. Those commands, like runbook.js, run inside the sandbox, which cannot read
// ~/.wheelhouse: each sends its folder as `cwd`, and the project is placed here.
const FOLDER_ROUTES = ['/state/answer', '/pr/open', '/lineage/provenance', '/config', '/push', '/pull'];

const NOT_MAIN_CHECKOUT = 'the foreman\'s commands run only in the project\'s main checkout';

// The project whose main checkout `folder` is, for /foreman/run (ruling R156): placed from this
// computer's records, as placeFolder does, and refused for any other folder inside the project,
// a feature's worktree among them. No project the request names counts.
function placeMainCheckout(folder) {
  const project = placeFolder(folder);
  const real = (p) => {
    try {
      return fs.realpathSync.native(p);
    } catch {
      return null;
    }
  };
  const record = readProject(project);
  if (record === null && readLean(project) !== null) refuse(LEAN_NO_HOST);
  const here = real(folder);
  if (here === null || typeof record?.folder !== 'string' || here !== real(record.folder)) refuse(NOT_MAIN_CHECKOUT);
  return project;
}

// The request with its project placed from `cwd`. A request that names a project too must
// name the one the folder is in, or it is refused: the folder is placed from this computer's
// records, a project name is only the caller's word, so the name never steers a request away
// from where its folder lies.
function placed(body) {
  const project = placeFolder(body.cwd);
  if (body.project !== undefined && body.project !== project) refuse(FOLDER_NOT_PROJECT);
  return { ...body, project };
}

// Beside the runbook's own routes, these carry on with the director's sign-in once step 2 has
// removed the narrow key: reading a pull request, and recording a signed click, so the
// director's approval of the restore pull request can still be read and kept; and the foreman's
// commands, whose route uses no connection itself (each call its child makes gets its own).
const FALL_BACK_ROUTES = ['/pr/state', '/state/record', '/foreman/run'];

// The front desk's requests (scripts/frontdesk/cli.js), which come from inside the sandbox, where
// ~/.wheelhouse cannot be read: like the runbook's, each may give `cwd`, a full path, and the
// helper places the project from it.
const PLACED_ROUTES = [
  '/state/views', '/state/write', '/pr/state', '/pr/preview', '/session/mark', '/cards/chat-click', '/confirm',
  '/lean/status', '/lean/merge', '/lean/undo', '/lean/copy',
  '/survey/carry-on', '/survey/archive', '/survey/restore',
];

// A Lean project (ruling P5-9) has no code host and no connection: only these routes serve it, on
// its local state repository, before any connection is made. Every other route refuses it.
const LEAN_ROUTES = [
  '/state/write', '/state/views', '/state/answer', '/state/record', '/state/sync', '/session/mark', '/cards/chat-click', '/confirm',
  '/lean/status', '/lean/merge', '/lean/undo', '/lean/copy',
];
// The Lean project's own routes (scripts/lean/store.js), served for a Lean project only.
const LEAN_ONLY = 'that project is not a Lean project';
const isLean = (project) => readProject(project) === null && readLean(project) !== null;

// The marks a session sends (ruling P5-19), each with its fields and what each must be.
const MARK_TEXT_CHARS = 200;
const markText = (v) => typeof v === 'string' && v !== '' && v.length <= MARK_TEXT_CHARS && !/[\u0000-\u001f]/.test(v);
const SESSION_MARKS = Object.freeze({
  'unknown-tool': { name: markText },
  compaction: { trigger: (v) => v === undefined || markText(v) },
  deadline: { event: markText },
});
// The longest card name or label a chat click carries, and the longest of the director's own words with one.
const CHAT_TEXT_CHARS = 500;
const CHAT_WORDS_CHARS = 4000;
// The option that hands the builder the director's own words (ruling P5-27 k): the only click that carries them.
const SUGGEST = 'Suggest a change…';
// A ruling's confirm card, as a click in the chat names it at Lean (ruling P5-52): `ruling-` and the card's id.
const RULING_CARD = /^ruling-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
// The fields of a card-answer that only the helper's click routes write.
const CLICK_FIELDS = ['proof', 'commit', 'hash', 'text'];

const NEEDS_PROFILE = ['/profile/clone', '/profile/write', '/profile/record', '/profile/sync', '/profile/views', '/profile/enrolments', '/state/backup'];
const PROFILE_NOT_SET_UP = { ok: false, why: 'The profile isn\'t set up on this computer yet' };

function checkProject(project) {
  try {
    stateDir(project);
  } catch {
    refuse('the project name is not valid');
  }
  return project;
}

function socketLimit(platform) {
  return platform === 'linux' ? 107 : 103;
}

// Asks the address for /health: 'helper' when a Wheelhouse helper answers,
// 'none' when nothing listens, 'other' otherwise. A fresh connection each
// time: a kept one may belong to a helper that has gone.
function probe(address) {
  return new Promise((resolve) => {
    const req = http.get({ socketPath: address, path: '/health', timeout: PROBE_MS, agent: false }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { if (text.length < 4096) text += c; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(text)?.ok === true ? 'helper' : 'other');
        } catch {
          resolve('other');
        }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve('other'); });
    req.on('error', (error) => resolve(error.code === 'ECONNREFUSED' || error.code === 'ENOENT' ? 'none' : 'other'));
  });
}

const ALREADY = 'A Wheelhouse helper is already running at this address, so a second was not started';
const OTHER = 'Something other than a Wheelhouse helper answers at the helper\'s address, so the helper was not started';

function send(res, status, answer, headers = {}) {
  const body = JSON.stringify(answer);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), ...headers });
  res.end(body);
}

// The request's body, or null when it passed 1 MB: then a 413 has been sent
// and the connection is closed once it has gone.
function readBody(req, res) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const onData = (chunk) => {
      size += chunk.length;
      if (size <= MOST_BODY) {
        chunks.push(chunk);
        return;
      }
      req.off('data', onData);
      req.pause();
      res.on('finish', () => req.socket?.destroy());
      send(res, 413, { ok: false, refused: 'the request is larger than 1 MB' }, { connection: 'close' });
      resolve(null);
    };
    req.on('data', onData);
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function startHelper({
  address = helperAddress(), adapterFor, envFor, now = () => new Date(), run = realRun, onArrive = () => {}, fetch = globalThis.fetch, startWaitMs = 30 * 1000,
  // Whether the preview's screenshots of the configuration's pages are the same at two commits,
  // for an approval to carry over an update (design section 12.3): given { project, before, after,
  // pages }, true only when every page looks the same at every size. By default the helper's own
  // comparison (scripts/screens/compare.js), photographing with `screens`; a test may give its own.
  screenshotsMatch = null,
  // How pictures are taken: `shoot` (scripts/screens/shoot.js's by default) and the browser's path
  // (null for none), or `findBrowser` to look for one (shoot.js's by default) when pictures are
  // needed.
  screens = {},
  // The profile's connection, as setup wrote it to profile.json, the way envFor gives a project's.
  profileEnvFor = envForConnection(() => profileRemote()?.connection, { fetch, now }),
  // The installed Wheelhouse, whose lineage/manifest.json the gate checks a pull request's provenance against.
  pluginRoot = OWN_ROOT,
  // Wheelhouse's own repository, whose release tags the gate reads (ruling R132).
  wheelhouseRepo = WHEELHOUSE_URL,
  // Setup's steps (a module exporting STEPS), the user's own home, whose Projects folder setup may
  // act in, and how a long step's own process is started (scripts/setup/engine.js).
  setupSteps = STEPS_MODULE, userHome = os.homedir(), spawn = nodeSpawn,
  // What the helper does once the last uninstall on this computer has finished (scripts/setup/
  // uninstall.js): given its own close, by default it closes; the real helper (helper-main.js) then
  // exits.
  onStop = (close) => close(),
  // Who a commit the helper builds in the project's folder is by (an archive, or putting it back):
  // the signed-in host account, as setup's own commit is (step 7's commitAuthor), given the
  // project's record; a test may give its own.
  authorFor = (record) => commitAuthor({ host: record.host, run, base: record.connection?.baseUrl }),
  // How the helper's own window is opened (scripts/confirm/window.js): given { title, lines, options }, it resolves
  // with { choice }. By default askInWindow on this system, with the helper's `run`.
  askWindow = (card) => askInWindow({ ...card, run }),
  // Each agent's review module, for the signed review in a clean session (scripts/agents/reviews.js): given an
  // agent's name, its module, or null where its reviews aren't the helper's. A test may give its own.
  reviewModules = reviewsFor,
} = {}) {
  if (typeof adapterFor !== 'function') throw new Error('The helper needs an adapterFor function');
  if (typeof envFor !== 'function') throw new Error('The helper needs an envFor function');
  const pipe = PIPE.test(address);
  if (!pipe && Buffer.byteLength(address) > socketLimit(process.platform)) {
    throw new Error(`The helper's socket path is too long for this system (${Buffer.byteLength(address)} bytes, at most ${socketLimit(process.platform)}): set WHEELHOUSE_HOME to a shorter folder`);
  }

  // Two helpers started at once would both see no socket, and the second would remove the
  // first's and listen in its place, leaving the first running on a socket nobody can reach.
  // So from the probe to the listen one start holds a lock file beside the socket; a lock
  // whose process has gone is taken over. The later start finds the earlier one answering.
  const releaseStart = pipe ? () => {} : await takeStartLock(`${address}.start`, { message: 'Another helper is starting', waitMs: startWaitMs });
  try {
    const found = await probe(address);
    if (found === 'helper') throw new Error(ALREADY);
    if (found === 'other') throw new Error(OTHER);
    if (!pipe) {
      let stat = null;
      try { stat = fs.lstatSync(address); } catch { /* nothing there */ }
      if (stat && !stat.isSocket()) throw new Error('There is a file at the helper\'s address that is not a socket, so it was left alone');
      if (stat) fs.rmSync(address, { force: true });
    }
  } catch (error) {
    releaseStart();
    throw error;
  }

  const sharedEnv = serialisePerProject((project) => envFor(project));

  // The company's certificate for a project record's GitLab address, added to a git environment.
  const companyGit = (env, record) => companyGitEnv(env, { host: record?.host, base: gitlabBaseOf(record) ?? undefined });
  // Where GitLab was lately out of reach, by project, for the board (served on /health).
  const awayLog = makeAwayLog({ now });

  // Each request reads the environment once, before anything else, keeps its
  // secrets for scrubbing that request's answer, and gives that same
  // environment to the adapter.
  // The narrow connection's key is gone (the runbook's step 2 deletes it): the runbook's own
  // routes, and FALL_BACK_ROUTES, carry on with the director's sign-in, as the quick connection does.
  function narrowKeyMissing(project) {
    const connection = readProject(project)?.connection;
    if (connection?.mode !== 'narrow') return false;
    try {
      const key = readKey(connection.host === 'github' ? 'github-app' : `gitlab-project-${connection.projectId}`);
      const token = connection.host === 'github' ? key?.accessToken : key?.token;
      return typeof token !== 'string' || token === '';
    } catch {
      return false; // damaged, or no usable name: the usual path says so
    }
  }

  async function contextFor(project, { fallBack = false } = {}) {
    // Only where the connection's environment cannot be made because the key is gone.
    let found;
    let signedOut = false;
    try {
      found = connectionOf(await sharedEnv(project));
    } catch (error) {
      if (!fallBack || !narrowKeyMissing(project)) throw error;
      signedOut = true;
      found = { mode: 'quick', env: {} };
    }
    const { mode, env } = found;
    let adapter = null;
    return {
      mode,
      env,
      signedOut,
      looked: new Map(),
      // What git gets in the helper's own repositories for this connection, and the transport the
      // project's recorded remote needs (a local path only for a stand-in host), with the company's
      // certificate for this project's GitLab address when setup has made it (company-ca.js). The
      // certificate's pairs are added after the sign-in's, and safeGitEnv (the route every call
      // takes) keeps any pair that is not a fence key.
      gitEnv: companyGit(gitEnvOf(mode, env, readProject(project)?.host, readProject(project)?.remoteUrl), readProject(project)),
      reach: reachFor(readProject(project)?.remoteUrl),
      secrets: secretsOf(env),
      adapter: async () => {
        adapter ??= Promise.resolve(adapterFor(project, { env, envFor: async () => env, now }));
        return adapter;
      },
    };
  }

  // A Lean project's request: no connection, no secret, no transport beyond this computer, and no
  // adapter (ruling P5-9). Its state's git calls carry no key.
  function leanContext() {
    return {
      lean: true,
      mode: 'lean',
      env: {},
      signedOut: false,
      looked: new Map(),
      gitEnv: {},
      reach: 'https',
      secrets: [],
      adapter: async () => refuse(LEAN_NO_HOST),
    };
  }

  const defaults = new Map();
  function defaultBranchOf(project, adapter) {
    if (!defaults.has(project)) {
      const promise = Promise.resolve().then(() => adapter.defaultBranch());
      defaults.set(project, promise);
      promise.catch(() => defaults.delete(project));
    }
    return defaults.get(project);
  }

  // STOP and bypass are read here, when a request's turn comes, never when it
  // arrived: a request queued before STOP was set still reads it.
  const STOP_REFUSAL = { ok: false, refused: 'STOP is on' };
  const stopped = () => stopState().on;
  const BYPASS_PUSH = 'a session on this computer is in bypass mode';

  const queues = new Map();
  function oneAtATime(key, fn) {
    const before = queues.get(key) ?? Promise.resolve();
    const next = before.catch(() => {}).then(fn);
    queues.set(key, next);
    const done = () => { if (queues.get(key) === next) queues.delete(key); };
    next.then(done, done);
    return next;
  }

  // A runner for git with the given environment over the clean base, and a time limit, so a hung
  // remote or folder cannot hold up a queue. Every call goes through the shared fence (safeGitEnv):
  // the director's global and system git config never reach it, hooks are off, only an allowed list
  // of GIT_ variables passes, and the one transport is the one `reach` names, which comes from the
  // project's recorded remote and never from `env`. The quick connection signs in through the host
  // tool (directorSignIn, as the sole credential helper) rather than through the director's own
  // git config, which stays shut out (design section 12.9's git item); the narrow connection's key
  // travels in `env`.
  const gitIn = (env, timeoutMs = HOST_MS, reach = 'https') => (file, args, options = {}) => run(file, args, {
    timeoutMs, ...options, baseEnv: withoutGitVars(process.env), env: safeGitEnv({ ...GIT_BASE, ...env, ...options.env }, { reach }),
  });
  const unkeyed = gitIn({});
  // The connection's git over the project's (or profile's) recorded remote.
  const keyedFor = (ctx) => gitIn(ctx.gitEnv, HOST_MS, ctx.reach);

  // Each request looks once at each repository of its own it uses (the mirror, the lock, state and
  // profile clones, the lineage mirror) and at the folder it copies from, before its first git call
  // there: the repository's config may hold nothing setup's allowed list leaves out. The answer, or
  // the refusal, is kept in the request's context, so later calls there neither look again nor skip
  // the refusal. `marker` is the file whose presence says a repository is there to look at (a
  // repository not made yet has no config to hold anything).
  // `list` is 'own' (the default) for a repository Wheelhouse made, or 'project' for a director's
  // project folder (the one being copied from), as in scripts/lib/safe-git.js.
  async function lookOnce(ctx, dir, marker = null, what = null, list = 'own') {
    if (marker !== null && !fs.existsSync(path.join(dir, marker))) return;
    const { looked } = ctx;
    if (!(looked instanceof Map)) throw new Error('the request has no record of the repositories it has looked at');
    let key = path.resolve(dir);
    try { key = fs.realpathSync.native(dir); } catch { /* the look says what is wrong */ }
    // A look under the own list (the stricter) answers a later request for the project list; a look under
    // the project list does not answer one for the own list.
    const have = looked.get(key);
    if (have === undefined || (have.list === 'project' && list === 'own')) {
      looked.set(key, {
        list,
        done: lookAtSettings({ run, cwd: dir, list }).then((found) => {
          if (found.unread || found.keys.length > 0) throw new LookRefusal(lookRefusalLine('helper', found, { what }));
        }),
      });
    }
    await looked.get(key).done;
  }
  const lookAtState = (ctx, project) => lookOnce(ctx, stateDir(project), '.git', "the project's state repository");
  const lookAtMirror = (ctx, project) => lookOnce(ctx, path.join(stateDir(project), '..', 'mirror.git'), 'HEAD', "the project's mirror repository");
  // Whether the mirror's look refused in this request: then nothing more runs git there.
  async function mirrorRefused(ctx, project) {
    try {
      await lookAtMirror(ctx, project);
      return false;
    } catch {
      return true;
    }
  }
  const lookAtLock = (ctx, project) => lookOnce(ctx, path.join(stateDir(project), '..', 'lock'), '.git', "the project's lock repository");

  // The lock clone is used by pushes and merges alike: one git call at a time.
  function lockHeld(project, ctx) {
    return oneAtATime(`lock:${project}`, async () => {
      // The lock clone reads the state clone's remote first; a refusal ends the request here.
      await lookAtState(ctx, project);
      await lookAtLock(ctx, project);
      const counter = heldCounter({ project });
      return counter !== null && (await holdsLock({ project, counter, env: ctx.gitEnv })) === true;
    });
  }

  // The project's mirror, made if missing, with origin set from the helper's
  // own state clone.
  async function mirrorFor(project, ctx) {
    await lookAtState(ctx, project);
    await lookAtMirror(ctx, project);
    const plain = unkeyed;
    const origin = await plain('git', ['config', '--get', `remote.${REMOTE}.url`], { cwd: stateDir(project) });
    const url = origin.stdout.trim();
    if (origin.code !== 0 || url === '') refuse('the project has no state clone to find its repository from');
    if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/@\s]*:[^/@\s]*@/.test(url)) {
      refuse('the project\'s repository address carries credentials, so nothing is pushed: keys travel only in the environment');
    }
    const mirror = path.join(stateDir(project), '..', 'mirror.git');
    if (!fs.existsSync(path.join(mirror, 'HEAD'))) {
      fs.rmSync(mirror, { recursive: true, force: true });
      fs.mkdirSync(mirror, { recursive: true });
      if ((await plain('git', ['init', '-q', '--bare'], { cwd: mirror })).code !== 0) refuse('the project\'s mirror could not be made');
    }
    if ((await plain('git', ['config', `remote.${REMOTE}.url`, url], { cwd: mirror })).code !== 0) {
      refuse('the project\'s mirror could not be set up');
    }
    return mirror;
  }

  // The mirror keeps what the next fetch negotiates from, and nothing else between requests.
  // The default branch's copy (BASE_REF) stays, so the next fetch asks only for what is new;
  // the refs made per request (incoming, each pull request's head, any other) are dropped
  // after each push and merge. Called inside the project's mirror queue.
  async function dropRequestRefs(project, ctx) {
    try {
      if (await mirrorRefused(ctx, project)) return;
      const mirror = path.join(stateDir(project), '..', 'mirror.git');
      if (!fs.existsSync(path.join(mirror, 'HEAD'))) return;
      const listed = await unkeyed('git', ['for-each-ref', '--format=%(refname)', 'refs/wheelhouse/'], { cwd: mirror });
      for (const name of listed.stdout.split('\n').map((l) => l.trim()).filter(Boolean)) {
        if (name !== BASE_REF) await unkeyed('git', ['update-ref', '-d', name], { cwd: mirror });
      }
    } catch { /* tidying is best effort */ }
  }

  // git tidies the objects itself when enough have built up. It runs after the answer is
  // written, queued behind it on the same key, so the next request waits for it.
  function tidyAfterAnswer(project, ctx) {
    oneAtATime(`mirror:${project}`, async () => {
      try {
        if (await mirrorRefused(ctx, project)) return;
        const mirror = path.join(stateDir(project), '..', 'mirror.git');
        if (!fs.existsSync(path.join(mirror, 'HEAD'))) return;
        await unkeyed('git', ['-c', 'gc.autoDetach=false', 'gc', '--auto', '--quiet'], { cwd: mirror });
      } catch { /* tidying is best effort */ }
    }).catch(() => {});
  }

  // Whether this computer's director clicked the card for pushing this exact
  // commit of this branch in the last ten minutes: a signed `action` event.
  function ciClick(project, branch, sha) {
    const enrolled = readEnrolled();
    const nowMs = now().getTime();
    return listEvents(stateDir(project), { report: () => {} }).some((e) => {
      const age = nowMs - Date.parse(e.at);
      return e.kind === 'action' && e.data?.action === 'ci-push' && e.data.branch === branch && e.data.sha === sha
        && e.computer === computerId() && e.sig?.computer === computerId() && verify(e, enrolled)
        && age <= CLICK_MS && age >= -60 * 1000;
    });
  }

  // Copies the branch in from `source`, checks it, and pushes it with the
  // connection's key. `source` is a folder the helper trusts: a code push's
  // folder (read for objects only), or one of the helper's own clones.
  // One at a time per project: the mirror and its incoming ref are shared.
  function pushFrom(args, ctx) {
    return oneAtATime(`mirror:${args.project}`, async () => {
      try {
        return await pushToHost(args, ctx);
      } finally {
        await dropRequestRefs(args.project, ctx);
        tidyAfterAnswer(args.project, ctx);
      }
    });
  }

  // Copies `branch` in from `source` into the mirror's INCOMING ref, as described in pushToHost.
  // The refusal, or null once it has arrived.
  async function copyIn(mirror, source, branch, ctx) {
    // The folder's own config can name a program for git to run (core.fsmonitor and the like), so
    // git is not run there until its settings have been looked at.
    try {
      await lookOnce(ctx, source, null, 'the folder being copied from', 'project');
    } catch (error) {
      return error instanceof Error ? error.message : 'the folder\'s git settings could not be read';
    }
    const hooked = await configSets(unkeyed, mirror, '^hook\\.');
    if (hooked !== 'none') return 'the mirror\'s git configuration names a hook, or could not be read, so nothing is copied into it';
    await unkeyed('git', ['update-ref', '-d', INCOMING], { cwd: mirror });
    const fetched = await gitIn({ GIT_NO_LAZY_FETCH: '1' }, FOLDER_MS, 'local')('git', [
      '-c', `core.hooksPath=${NO_FILE}`, '-c', 'core.fsmonitor=false', '-c', 'protocol.file.allow=always',
      'fetch', '-q', '--no-tags', '--no-recurse-submodules', source, `+refs/heads/${branch}:${INCOMING}`,
    ], { cwd: mirror });
    if (fetched.timedOut) return 'reading the folder took too long';
    const arrived = await unkeyed('git', ['rev-parse', '--verify', '-q', INCOMING], { cwd: mirror });
    if (fetched.code !== 0 || arrived.code !== 0) return PUSH_REFUSALS.missing;
    return null;
  }

  async function pushToHost({ project, branch, source, refspec, defaultBranch, ciGuard = false, allowStop = false, asDirector: asOwn = false }, ctx) {
    return (async () => {
      const mirror = await mirrorFor(project, ctx);
      // Copy the branch's objects in from the folder, with no key, and nothing
      // from the folder's config, hooks or replace refs taking part. The
      // incoming ref is cleared first: git leaves it alone when it declines a
      // ref (for example one that would make the mirror shallow) yet exits 0.
      // git-upload-pack runs in the folder: GIT_NO_LAZY_FETCH stops a partial
      // clone there from fetching missing objects through its own remote.
      // core.hooksPath set to the null file stops the hooks folder; a hook
      // named in the mirror's configuration (hook.<name>.command) would not
      // be stopped by it, so a mirror whose configuration sets one is refused.
      const copied = await copyIn(mirror, source, branch, ctx);
      if (copied !== null) return { ok: false, refused: copied };

      const keyed = keyedFor(ctx);
      const checked = await checkPush({ refspec, dir: mirror, defaultBranch, gitRun: keyed, sha: INCOMING });
      if (checked.refused === PUSH_REFUSALS.shallow) {
        // A shallow marker came in with the objects: start the mirror afresh next time.
        fs.rmSync(mirror, { recursive: true, force: true });
      }
      if (!checked.allowed) {
        const line = checked.away === true ? awayLine(recordOf(project)) : null;
        if (line !== null) awayLog.set(project, gitlabBaseOf(recordOf(project)));
        const untrusted = checked.untrusted === true ? certificateLine(recordOf(project)) : null;
        return { ok: false, refused: line ?? untrusted ?? checked.refused };
      }

      // A code push that changes a CI file goes only with the director's click
      // for this commit, and then with the director's own sign-in.
      // The director's own sign-in, with the company's certificate for this project's GitLab address.
      const directorGit = () => gitIn(companyGit(directorSignIn(signInHost(project)), readProject(project)), HOST_MS, ctx.reach);
      let pusher = asOwn ? directorGit() : keyed;
      if (ciGuard) {
        let changes;
        try {
          changes = await branchChanges({ mirror, sha: checked.sha, defaultBranch, run: keyed });
        } catch {
          return { ok: false, refused: PUSH_REFUSALS.unchecked };
        }
        if (touchesCi(changes.paths, changes.config)) {
          if (!ciClick(project, branch, checked.sha)) return { ok: false, refused: PUSH_REFUSALS.ciFile };
          pusher = directorGit();
        }
      }
      const asDirector = pusher !== keyed;

      if (stopped() && !allowStop) return STOP_REFUSAL;
      const pushed = await pusher('git', ['push', '--no-verify', '--porcelain', REMOTE, `${checked.sha}:refs/heads/${branch}`], { cwd: mirror });
      if (pushed.code === 0) {
        awayLog.clear(project);
        return { ok: true, sha: checked.sha };
      }
      if (pushed.timedOut) return { ok: false, refused: 'the host did not answer the push in time' };
      // A GitLab that cannot be reached is one line, and the push stays here to be sent later.
      const away = unreachableRefusal(recordOf(project), pushed.stderr);
      if (away !== null) {
        awayLog.set(project, gitlabBaseOf(recordOf(project)));
        return { ok: false, refused: away };
      }
      // A certificate this computer does not trust is the certificate card's line, not git's own text.
      const untrusted = certificateRefusal(recordOf(project), pushed.stderr);
      if (untrusted !== null) return { ok: false, refused: untrusted };
      const refused = pushed.stdout.split('\n').find((line) => line.startsWith('!') && line.includes(`refs/heads/${branch}`));
      // Another computer's push can land between ours: the host then declines to move the branch
      // ("failed to update ref", "incorrect old value provided"), which is the same as the branch having moved on.
      if (refused && /\((?:non-fast-forward|fetch first|failed to update ref|incorrect old value provided)\)/.test(refused)) return { ok: false, rejected: 'non-fast-forward' };
      if (asDirector && /authentication|could not read username|permission denied|\b40[13]\b/i.test(pushed.stderr)) return { ok: false, refused: PUSH_REFUSALS.ciSignIn };
      const detail = clean(pushed.stderr, ctx.secrets);
      return { ok: false, refused: `git could not push the branch${detail ? `: ${detail}` : ''}` };
    })();
  }

  // The state and lock branches are fixed names, never the host's default
  // branch, so a push of either does not ask the host which that is.
  const NOT_THE_DEFAULT = '(a branch that is not the default)';
  const ownFolder = (project, branch) => (branch === STATE_BRANCH ? stateDir(project) : path.join(stateDir(project), '..', 'lock'));

  // Pushes the state or the lock branch from the helper's own clone of it. The
  // objects are read from the clone's resolved path.
  async function pushOwn(project, branch, ctx, { allowStop = false } = {}) {
    if (branch !== STATE_BRANCH && branch !== LOCK_BRANCH) return { ok: false, refused: PUSH_REFUSALS.plain };
    let source = null;
    try { source = fs.realpathSync.native(ownFolder(project, branch)); } catch { /* no clone */ }
    if (source === null) return { ok: false, refused: PUSH_REFUSALS.missing };
    const answer = await pushFrom({ project, branch, source, refspec: branch, defaultBranch: NOT_THE_DEFAULT, allowStop }, ctx);
    if (answer.ok && branch === STATE_BRANCH) {
      // The push went through the mirror, so the clone is told what the host now holds.
      await unkeyed('git', ['update-ref', `refs/remotes/${REMOTE}/${branch}`, answer.sha], { cwd: source });
    }
    return answer.ok ? { ok: true } : answer;
  }

  async function doPush({ project, dir, refspec, byFolder = false }, ctx) {
    if (stopped()) return STOP_REFUSAL;
    const adapter = await ctx.adapter();
    const defaultBranch = await defaultBranchOf(project, adapter);
    const spelled = checkRefspec(refspec, defaultBranch);
    if (!spelled.allowed) return { ok: false, refused: spelled.refused };
    const { branch } = spelled;
    if (branch === STATE_BRANCH || branch === LOCK_BRANCH) return { ok: false, refused: PUSH_REFUSALS.ownRequests };
    if (bypassActive({ now })) return { ok: false, refused: BYPASS_PUSH };
    if (typeof dir !== 'string' || !path.isAbsolute(dir)) refuse('the folder to push from must be a full path');
    let isDir = false;
    try { isDir = fs.statSync(dir).isDirectory(); } catch { /* missing */ }
    if (!isDir) refuse('the folder to push from was not found');
    if (!isInsideFolder(recordOf(project).folder, dir)) return { ok: false, refused: PUSH_REFUSALS.outsideProject };
    // A feature session's push (placed by its folder, `byFolder`): the worktrees of one repository
    // share its branches, so the folder's own branch is the only one it sends, as /pull brings in
    // only that one. Like /pull's, this reads the folder's HEAD, which a session can rewrite, so it
    // keeps a session's commands to their own branch, but holds no hostile agent.
    if (byFolder && branchOf(dir) !== branch) return { ok: false, refused: PUSH_REFUSALS.notOwn };
    try {
      if (isPartialClone(dir)) return { ok: false, refused: PUSH_REFUSALS.partialClone };
    } catch {
      return { ok: false, refused: PUSH_REFUSALS.unchecked };
    }
    if (!(await lockHeld(project, ctx))) return { ok: false, refused: LOCK_REASON };
    const answer = await pushFrom({ project, branch, source: dir, refspec, defaultBranch, ciGuard: true }, ctx);
    if (answer.rejected === 'non-fast-forward') return { ...answer, refused: PUSH_REFUSALS.movedOn };
    return answer.ok ? { ok: true } : answer;
  }

  // A feature session's pull (`cli.js pull`, final review I1): the host's copy of the worktree's own
  // branch, brought together with the worktree's branch in the project's mirror, and handed back as
  // a git bundle. The rules /push keeps hold: the folder places the project and must be inside it;
  // the branch is plain, never the default; and it must be the folder's own feature branch. The
  // helper runs no git in the worktree: it reads the branch's objects from it, as a push does, with
  // no key; then fetches the host's copy with the key, in the mirror, which no session can reach.
  // It brings the two together there: nothing to do when the worktree's has everything the
  // host's has; a fast-forward when the host's is ahead; otherwise a plain merge, made here, the
  // worktree's commit first, refused on a conflict and naming the files. The answer carries only
  // the commits the worktree lacks (the bundle, base64), never a key or the mirror's settings; the
  // session's own git brings them in, inside the sandbox. The host is only read. Refused under STOP.
  async function doPull({ project, dir, branch }, ctx) {
    if (stopped()) return STOP_REFUSAL;
    if (typeof dir !== 'string' || !path.isAbsolute(dir)) refuse('the folder to bring the branch into must be a full path');
    let isDir = false;
    try { isDir = fs.statSync(dir).isDirectory(); } catch { /* missing */ }
    if (!isDir) refuse('the folder to bring the branch into was not found');
    if (!isInsideFolder(recordOf(project).folder, dir)) return { ok: false, refused: PULL_REFUSALS.outsideProject };
    if (!plainBranch(branch)) return { ok: false, refused: PULL_REFUSALS.plain };
    const adapter = await ctx.adapter();
    const defaultBranch = await defaultBranchOf(project, adapter);
    if (typeof defaultBranch !== 'string' || defaultBranch === '' || branch === defaultBranch) return { ok: false, refused: PUSH_REFUSALS.defaultBranch };
    if (!FEATURE_BRANCH.test(branch)) return { ok: false, refused: PULL_REFUSALS.feature };
    if (branchOf(dir) !== branch) return { ok: false, refused: PULL_REFUSALS.notOwn };
    try {
      if (isPartialClone(dir)) return { ok: false, refused: PUSH_REFUSALS.partialClone };
    } catch {
      return { ok: false, refused: PUSH_REFUSALS.unchecked };
    }
    try {
      return await oneAtATime(`mirror:${project}`, () => inMirror(project, ctx, ({ mirror, keyed }) => pullIn({ project, mirror, keyed, dir, branch, ctx })));
    } finally {
      await oneAtATime(`mirror:${project}`, () => dropRequestRefs(project, ctx));
      tidyAfterAnswer(project, ctx);
    }
  }

  // The foreman's start (scripts/foreman/act.js, fetchBase): the host's default branch fetched into
  // the project's mirror's BASE_REF with the connection's key, in the mirror, which no session can
  // reach. The foreman's child then copies it into the main checkout from the mirror with no key,
  // so no key or sign-in is used in a repository an agent can write. The host is only read.
  async function doFetchBase({ project }, ctx) {
    const adapter = await ctx.adapter();
    const defaultBranch = await defaultBranchOf(project, adapter);
    if (!plainBranch(defaultBranch)) return { ok: false, refused: PUSH_REFUSALS.unknownDefault };
    try {
      return await oneAtATime(`mirror:${project}`, () => inMirror(project, ctx, async ({ mirror, keyed }) => {
        const refusal = await mirrorRefusal(mirror, keyed);
        if (refusal) return { ok: false, refused: refusal };
        const fetched = await keyed('git', [
          ...NO_HOOKS, 'fetch', '-q', '--no-tags', '--no-recurse-submodules', '--no-write-fetch-head', REMOTE, `+refs/heads/${defaultBranch}:${BASE_REF}`,
        ], { cwd: mirror, input: '' });
        if (fetched.code !== 0) return { ok: false, refused: 'the host\'s default branch could not be fetched' };
        const read = await local(mirror)([...NO_HOOKS, 'rev-parse', '--verify', '-q', `${BASE_REF}^{commit}`]);
        const sha = read.stdout.trim();
        if (read.code !== 0 || !FULL_SHA.test(sha)) return { ok: false, refused: 'the host\'s default branch could not be read' };
        return { ok: true, branch: defaultBranch, sha };
      }));
    } finally {
      tidyAfterAnswer(project, ctx);
    }
  }

  // The body of a pull, in the project's mirror queue.
  async function pullIn({ project, mirror, keyed, dir, branch, ctx }) {
    const git = local(mirror);
    const refusal = await mirrorRefusal(mirror, keyed);
    if (refusal) return { ok: false, refused: refusal };
    const copied = await copyIn(mirror, dir, branch, ctx);
    if (copied !== null) return { ok: false, refused: copied };
    const shallow = await git([...NO_HOOKS, 'rev-parse', '--is-shallow-repository']);
    if (shallow.code !== 0) return { ok: false, refused: PUSH_REFUSALS.unchecked };
    if (shallow.stdout.trim() === 'true') {
      // A shallow marker came in with the objects: start the mirror afresh next time.
      fs.rmSync(mirror, { recursive: true, force: true });
      return { ok: false, refused: PULL_REFUSALS.shallow };
    }
    const listed = await keyed('git', [...NO_HOOKS, 'ls-remote', '--heads', REMOTE, `refs/heads/${branch}`], { cwd: mirror, input: '' });
    if (listed.code !== 0) return { ok: false, refused: PULL_REFUSALS.unread };
    if (listed.stdout.trim() === '') return { ok: false, refused: `the host has no branch ${branch} yet: push it first` };
    const fetched = await keyed('git', [
      ...NO_HOOKS, 'fetch', '-q', '--no-tags', '--no-recurse-submodules', '--no-write-fetch-head', REMOTE, `+refs/heads/${branch}:${PULL_HOST}`,
    ], { cwd: mirror, input: '' });
    if (fetched.code !== 0) return { ok: false, refused: PULL_REFUSALS.unread };
    const shaOf = async (ref) => {
      const read = await git([...NO_HOOKS, 'rev-parse', '--verify', '-q', `${ref}^{commit}`]);
      return read.code === 0 && FULL_SHA.test(read.stdout.trim()) ? read.stdout.trim() : null;
    };
    const ours = await shaOf(INCOMING);
    const theirs = await shaOf(PULL_HOST);
    if (ours === null || theirs === null) return { ok: false, refused: PULL_REFUSALS.unread };
    const within = async (a, b) => {
      const said = await git([...NO_HOOKS, 'merge-base', '--is-ancestor', a, b]);
      if (said.code > 1) throw new Error('comparing the two branches failed');
      return said.code === 0;
    };
    if (await within(theirs, ours)) return { ok: true, already: true };
    let sha = theirs;
    const merged = !(await within(ours, theirs));
    if (merged) {
      const made = await git([...MERGE_ONLY, 'merge-tree', '--write-tree', '--name-only', '-z', '--no-messages', ours, theirs]);
      if (made.code === 1) return { ok: false, refused: PULL_REFUSALS.conflict, conflicts: made.stdout.split('\0').slice(1).filter((name) => name !== '') };
      if (made.code !== 0) throw new Error('git could not merge the host\'s branch in');
      sha = await mergeCommit(git, made.stdout.split('\0')[0].trim(), ours, theirs, `Merge the host's ${branch} into this worktree's`);
    }
    if ((await git([...NO_HOOKS, 'update-ref', PULLED, sha])).code !== 0) throw new Error('keeping what is handed back failed');
    const file = path.join(stateDir(project), '..', `pull-${crypto.randomUUID()}.bundle`);
    try {
      const bundled = await git([...NO_HOOKS, 'bundle', 'create', '-q', file, PULLED, `^${ours}`]);
      if (bundled.code !== 0) throw new Error('making the bundle failed');
      if (fs.statSync(file).size > PULL_BUNDLE_BYTES) return { ok: false, refused: PULL_REFUSALS.tooLarge };
      return { ok: true, already: false, merged, from: ours, sha, bundle: fs.readFileSync(file).toString('base64') };
    } finally {
      fs.rmSync(file, { force: true });
    }
  }

  // --- state and the lock ---

  function recordOf(project) {
    const record = readProject(project);
    if (!record) refuse('the project has not been set up on this computer');
    return record;
  }

  // The transport the clones' git may use: a local path only where the recorded remote is one (a
  // stand-in host), https otherwise. The fence in state/git.js reads it from GIT_ALLOW_PROTOCOL.
  const LOCAL_PATHS = { GIT_ALLOW_PROTOCOL: 'https:file' };
  const LOOPBACK_HTTP = { GIT_ALLOW_PROTOCOL: 'https:http' };
  // Always an explicit value, laid last, so a GIT_ALLOW_PROTOCOL in a connection's env never widens an https remote.
  const reachEnv = (remoteUrl) => ({ local: LOCAL_PATHS, loopback: LOOPBACK_HTTP })[reachFor(remoteUrl)] ?? { GIT_ALLOW_PROTOCOL: 'https' };
  // The git environment of a connection: the key's own pairs (narrow), or the director's sign-in
  // through the host tool (quick), with the transport the recorded remote needs laid last.
  const signInHost = (project) => hostOf(readProject(project)?.host);
  // An unknown host maps to null: quick then has no credential helper at all and fails closed.
  const hostOf = (host) => (host === 'github' || host === 'gitlab' ? host : null);
  const gitEnvOf = (mode, env, host, remoteUrl) => ({ ...(mode === 'narrow' ? env : directorSignIn(hostOf(host))), ...reachEnv(remoteUrl) });
  const profileGit = (dir, args, env = {}) => stateGit(dir, args, { ...env, ...reachEnv(profileRemote()?.remoteUrl) });

  async function ensureStateClone(project, ctx) {
    await lookAtState(ctx, project);
    await cloneState({ project, remoteUrl: recordOf(project).remoteUrl, env: ctx.gitEnv });
  }

  const pushFor = (project, ctx) => (_dir, branch) => pushOwn(project, branch, ctx);
  // A Lean project's state stays on this computer: its events are committed and never pushed.
  const keptHere = async () => ({ ok: false });
  const statePush = (project, ctx) => (ctx.lean ? keptHere : pushFor(project, ctx));

  const stateRoute = (fn, { clone = true, write = false } = {}) => (body, ctx) => oneAtATime(`state:${body.project}`, async () => {
    if (write && stopped()) return STOP_REFUSAL;
    if (clone && ctx.lean) await leanState(body.project, { run });
    else if (clone) await ensureStateClone(body.project, ctx);
    if (write && stopped()) return STOP_REFUSAL;
    return fn(body, ctx);
  });
  // The lock clone is shared with the merge gate's lock check: the same queue.
  const lockRoute = (fn, { write = false } = {}) => (body, ctx) => oneAtATime(`lock:${body.project}`, async () => {
    if (write && stopped()) return STOP_REFUSAL;
    await oneAtATime(`state:${body.project}`, () => ensureStateClone(body.project, ctx));
    await lookAtLock(ctx, body.project);
    if (write && stopped()) return STOP_REFUSAL;
    return fn(body, ctx);
  });

  const written = (made) => ({
    ok: true, id: made.event.id, pushed: made.result.pushed, ...(made.result.refused ? { refused: made.result.refused } : {}),
  });

  // After each event taken the views are written again, so the board and the briefing never
  // read views older than the last write. A failure here leaves the write as it was; the
  // next write, or /state/views, writes them.
  async function freshViews(write) {
    try { await write(); } catch { /* the views stay as they were */ }
  }

  // A plain event, made here: its time and computer are the helper's. Its id is
  // made here too, unless the caller made it (the foreman's act command does,
  // to record the id as handled before the event exists, ruling R86): then it
  // must be shaped as a random UUID and not one the state holds already.
  // A card-answer naming a proof, a commit or a card's hash is a click record only the helper's own routes make
  // (/cards/chat-click): `own` is theirs. From /state/write, which anyone who reaches the helper may call, it is
  // refused, so no caller can name a proof the gate would read.
  async function doWrite({ project, kind, data, id }, ctx, { own = false } = {}) {
    if (PROTECTED_KINDS.includes(kind)) refuse('a signed kind is recorded through /state/record, never written here');
    if (HELPER_ONLY_KINDS.includes(kind)) refuse('only the helper itself records that kind');
    if (!own && kind === 'card-answer' && data && typeof data === 'object' && CLICK_FIELDS.some((k) => Object.hasOwn(data, k))) refuse('a click\'s proof, commit, hash and words are recorded only by the helper\'s own routes');
    if (!PLAIN_KINDS.includes(kind)) refuse('that kind of event is not known');
    if (!data || typeof data !== 'object' || Array.isArray(data)) refuse('the event\'s data must be an object');
    if (id !== undefined && (typeof id !== 'string' || !RANDOM_UUID.test(id))) refuse('an id given with a record must be a random UUID in lower case');
    if (id !== undefined && listEvents(stateDir(project), { report: () => {} }).some((e) => e.id === id)) refuse('the state already holds an event with that id');
    // A signed click a hook kept to send later must never find its id taken; the kept write itself,
    // sent, is taken under its id.
    if (id !== undefined) {
      const kept = pendingRecords(project);
      if (idsOf(kept).has(id) && !keptWrite(kept, { kind, data, id })) refuse('a record waiting to be sent from this computer has that id');
    }
    if (kind === 'setting') {
      try { checkSetting(data.key, data.value, data.until); } catch (error) { refuse(error.message); }
    }
    const made = makeEvent({ kind, data, now });
    const event = id === undefined ? made : { ...made, id };
    const result = await writeEvent({ project, event, push: statePush(project, ctx), env: ctx.gitEnv, now });
    await freshViews(() => writeViews(project, { now }));
    return written({ event, result });
  }

  // The survey taken again (design section 15, ruling A1; plan ruling P3): only when the latest
  // survey in the state missed the host and was not itself taken again, so it is taken again once.
  // It reads the project's folder and asks the host for its open requests, through this project's
  // adapter, within the survey's own time limit, and never throws (scripts/survey/take.js); the
  // rules found at setup are carried over. The project's state is held only to read the latest
  // survey and then to write, never while the survey looks, so a slow host holds nothing up. What
  // it records is a state write like any other, so it is refused under STOP, read again just
  // before the write, and secret-scanned as every event is: the survey leaves out what looks like
  // a secret first, and one the state still refuses is recorded as a survey that missed the host.
  // A survey taken meanwhile by another request is left as it is.
  async function doSurveyAgain({ project }, ctx) {
    const byOrder = (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const latestSurvey = () => listEvents(stateDir(project), { report: () => {} })
      .filter((e) => e.kind === 'survey' && e.data !== null && typeof e.data === 'object').sort(byOrder).at(-1);
    if (stopped()) return STOP_REFUSAL;
    const latest = await oneAtATime(`state:${project}`, async () => {
      await ensureStateClone(project, ctx);
      return latestSurvey();
    });
    if (!latest || latest.data.hostReached !== false || latest.data.again === true) return { ok: true, taken: false };
    const taken = await takeSurvey({ project, run, adapter: () => ctx.adapter(), rules: shapedSurvey({ rules: latest.data.rules }).rules });
    return oneAtATime(`state:${project}`, async () => {
      if (stopped()) return STOP_REFUSAL;
      if (latestSurvey()?.id !== latest.id) return { ok: true, taken: false };
      let survey = null;
      const got = await recordSurvey({
        write: async (data) => {
          if (stopped()) return STOP_REFUSAL;
          const answer = await writeSurvey(project, data, ctx);
          if (answer.ok) survey = data;
          return answer;
        },
        take: async () => taken,
        again: true,
      });
      if (!got.ok) return got;
      return { ok: true, taken: true, id: got.id, hostReached: survey.hostReached, pushed: got.pushed };
    });
  }

  // The helper's own writer of a survey, the one kind no caller writes (HELPER_ONLY_KINDS): made
  // and written here, and the views written again. A refusal (the state's secret scan, say) is an
  // answer, never a throw. Called in the state's queue, with that route's `ctx`.
  async function writeSurvey(project, data, ctx) {
    try {
      const event = makeEvent({ kind: 'survey', data, now });
      const result = await writeEvent({ project, event, push: pushFor(project, ctx), env: ctx.gitEnv, now });
      await freshViews(() => writeViews(project, { now }));
      return written({ event, result });
    } catch (error) {
      return { ok: false, refused: error instanceof Error ? error.message : 'the survey could not be recorded' };
    }
  }
  // finishSetup's writer: the project's own context, in the state's queue, refused under STOP.
  async function writeSetupSurvey(project, data) {
    try {
      const ctx = await contextFor(checkProject(project));
      return await stateRoute((body, c) => writeSurvey(project, data, c), { write: true })({ project }, ctx);
    } catch (error) {
      return { ok: false, refused: error instanceof Error ? error.message : 'the survey could not be recorded' };
    }
  }

  // --- Ready-made changes (scripts/survey/ready.js; design section 15, A2 and A4; plan rulings P4, P5, P13) ---
  // Carrying a request on, archiving another agent setup's instructions, and putting them back each
  // make one change ready in the project's folder, at refs/wheelhouse/from/<work>, and write its
  // ready record, out of every agent's reach, once the ref is in place; the front desk then records
  // the work through the intake, and the foreman starts it only from a change this record names.
  // They write nothing else: no other ref, no index, no working copy, nothing in the state, and they
  // push nothing. git runs in the folder as step 7's does, with the director's own sign-in, and
  // fetches only from the project's recorded address. One at a time per project; refused under STOP,
  // read again once the state is in hand. The answer says the work id chosen, whose line
  // (feature/<work>) is no request's own and not on the host, and the `from` to record.
  const readyGit = (record) => folderGit({
    run, folder: record.folder,
    env: reaching({ ...directorGitEnv({ host: hostOf(record.host), base: record.connection?.baseUrl }), GIT_NO_REPLACE_OBJECTS: '1' }, record.remoteUrl),
  });
  const readyRoute = (fn) => (body, ctx) => oneAtATime(`ready:${body.project}`, async () => {
    if (stopped()) return STOP_REFUSAL;
    const views = await oneAtATime(`state:${body.project}`, async () => {
      await ensureStateClone(body.project, ctx);
      return writeViews(body.project, { now });
    });
    if (stopped()) return STOP_REFUSAL;
    const record = recordOf(body.project);
    if (typeof record.folder !== 'string' || !path.isAbsolute(record.folder) || !fs.existsSync(record.folder)) refuse('the project\'s folder isn\'t on this computer');
    const git = readyGit(record);
    // Work recorded already, under any id, or a ready record kept for it, is never chosen again.
    const used = (id) => (views.work !== null && typeof views.work === 'object' && Object.hasOwn(views.work, id)) || fs.existsSync(readyRecordFile(body.project, id));
    try {
      return await fn({ ...body, views, record, git, used }, ctx);
    } catch (error) {
      if (error instanceof ReadyRefusal) return { ok: false, refused: error.message };
      throw error;
    }
  });
  // The ready record, written once the ref names `sha`; the ref is taken out again when it can't be.
  async function keepReady(project, git, work, record) {
    try {
      writeReadyRecord(project, work, record);
    } catch (error) {
      await dropRef(git, work, record.sha);
      throw error;
    }
  }

  // An open request carried on: { number }. The answer gives what a brief is written from, the
  // body left out when the secret scan finds anything in it. Or a piece of unfinished work with no
  // request: { line }, its name, as the latest survey lists it (doCarryOnPiece).
  async function doCarryOn(body, ctx) {
    if (body.line !== undefined) return doCarryOnPiece(body, ctx);
    const { project, number, record, git, used } = body;
    if (!Number.isInteger(number) || number < 1) refuse('the request number must be a whole number from 1');
    const adapter = await ctx.adapter();
    const listed = adapter.openRequests();
    const open = { ...adapter, openRequests: () => listed };
    const lines = (await listed).map((r) => r?.branch).filter((b) => typeof b === 'string');
    const work = await freeWork({ git, remoteUrl: record.remoteUrl, base: `carry-on-${number}`, lines, used });
    const made = await carryOn({ git, adapter: open, remoteUrl: record.remoteUrl, number, work });
    await keepReady(project, git, work, { sha: made.sha, ref: made.ref, request: number, branch: made.branch });
    const { sha, ref, request, ...details } = made;
    return { ok: true, work, from: { sha, ref, request }, ...details };
  }

  // A piece of unfinished work the latest survey lists by `line`, its name: pushed with no request,
  // or on this computer. Named in both (the same work, pushed and gone on here, or the other way
  // round), the one that builds on the other is carried on, else the one pushed. Its work's line,
  // feature/<work>, is never the piece's own. The answer gives what a brief is written from: its
  // subjects and files, those holding anything the secret scan finds left out.
  async function doCarryOnPiece({ project, line, views, record, git, used }, ctx) {
    if (typeof line !== 'string' || line === '' || line.length > 400 || /[\0-\x1f]/.test(line)) refuse('give the piece of work by its name, as the survey lists it');
    const data = views.survey?.data;
    const named = (where) => (Array.isArray(data?.[where]) ? data[where] : []).find((i) => i !== null && typeof i === 'object' && i.name === line);
    const pushed = named('pushed');
    const local = named('local');
    if (pushed === undefined && local === undefined) refuse(`the latest survey lists no unfinished work named ${line}`);
    let where = pushed === undefined ? 'local' : 'pushed';
    if (pushed !== undefined && local !== undefined && typeof pushed.head === 'string' && typeof local.head === 'string'
      && (await git(['merge-base', '--is-ancestor', pushed.head, local.head])).code === 0) where = 'local';
    const piece = where === 'pushed' ? pushed : local;
    const defaultBranch = await defaultBranchOf(project, await ctx.adapter());
    const work = await freeWork({ git, remoteUrl: record.remoteUrl, base: pieceWork(line), lines: [line], used });
    const made = await carryOnPiece({
      git, remoteUrl: record.remoteUrl, piece, where, work, base: plainBranch(defaultBranch) ? `refs/remotes/origin/${defaultBranch}` : null,
    });
    await keepReady(project, git, work, { sha: made.sha, ref: made.ref, request: null, branch: made.branch });
    const { sha, ref, request: _request, ...details } = made;
    return { ok: true, work, from: { sha, ref }, ...details };
  }

  // The default branch as it is on the host now, fetched into the work's ref, and the commit `build`
  // makes on it put there in its place; the ref is taken out again when anything fails.
  async function readyOnDefault({ project, record, git, used }, ctx, name, build) {
    const author = await authorFor(record);
    const defaultBranch = await defaultBranchOf(project, await ctx.adapter());
    if (!plainBranch(defaultBranch)) refuse('the host didn\'t name its main line');
    const work = await freeWork({ git, remoteUrl: record.remoteUrl, base: name, used });
    // Built on the commit fetched, never on the ref read again: an agent could point it elsewhere
    // meanwhile, and the ref is moved on only while it still names that commit.
    const base = await fetchInto({ git, remoteUrl: record.remoteUrl, source: `refs/heads/${defaultBranch}`, work });
    let made;
    try {
      made = await build({ work, base, author });
    } catch (error) {
      await dropRef(git, work, base);
      throw error;
    }
    await keepReady(project, git, work, { sha: made.sha, ref: made.ref, request: null, branch: null });
    return { ok: true, work, from: { sha: made.sha, ref: made.ref }, moved: made.moved };
  }

  // Another agent setup's instructions archived: the files the latest survey found, as they are on
  // the default branch now.
  async function doArchive(body, ctx) {
    const files = body.views.survey?.data?.instructions?.files;
    if (!Array.isArray(files) || files.length === 0) refuse('the survey found no instructions of another agent setup to archive');
    return readyOnDefault(body, ctx, 'archive-instructions', (args) => archiveCommit({ git: body.git, files, ...args }));
  }

  // The archive put back, as uninstall would put it.
  const doRestore = (body, ctx) => readyOnDefault(body, ctx, 'restore-instructions', (args) => restoreCommit({ git: body.git, ...args }));
  // A session's mark (ruling P5-19), from a hook that only reads: a plain note naming the mark. A tool the agent
  // has that Wheelhouse doesn't know (`unknown-tool`, the board's line), a compaction, or a hook past its deadline.
  async function doSessionMark({ project, mark, data }, ctx) {
    if (!Object.hasOwn(SESSION_MARKS, mark)) refuse('that kind of session mark is not known');
    if (!data || typeof data !== 'object' || Array.isArray(data)) refuse('the mark\'s data must be an object');
    const fields = SESSION_MARKS[mark];
    if (Object.keys(data).some((k) => !Object.hasOwn(fields, k)) || Object.entries(fields).some(([k, ok]) => !ok(data[k]))) refuse('the mark\'s data is not what that mark carries');
    return doWrite({ project, kind: 'note', data: { mark, ...data } }, ctx);
  }

  // A click in the chat (ruling P5-17): an unsigned card-answer naming its proof, never signed. A label that
  // decides a signed step is taken only on a card a chat click may decide: a merge card, or a guardrail card at
  // Lean; never one of the confirmed steps (a card named for the step, or `<step>-…`), which need the window.
  // Suggest a change… (ruling P5-27 k) carries the director's own words as `text`, and no other click does.
  async function doChatClick({ project, card, hash, label, proof, commit, text }, ctx) {
    if (!CHAT_PROOFS.includes(proof)) refuse(`a click in the chat is recorded as ${CHAT_PROOFS.join(' or ')}`);
    if (text !== undefined && label !== SUGGEST) refuse(`only a click on ${SUGGEST} carries the director's words`);
    if (text !== undefined && (typeof text !== 'string' || text.trim() === '' || text.length > CHAT_WORDS_CHARS)) refuse('the director\'s words must be text');
    if (typeof card !== 'string' || card === '' || card.length > CHAT_TEXT_CHARS) refuse('the card must be named');
    if (typeof label !== 'string' || label === '' || label.length > CHAT_TEXT_CHARS) refuse('the click must name the option chosen');
    if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) refuse('the card\'s hash must be its sha256, in lower case');
    if (commit !== undefined && (typeof commit !== 'string' || !/^[0-9a-f]{40}$/.test(commit))) refuse('the commit must be written in full');
    const confirmed = CONFIRMED_STEPS.some((step) => card === step || card.startsWith(`${step}-`));
    if (confirmed && SIGNED_LABELS.includes(label)) refuse('that step is confirmed outside the chat, never by a click in it');
    // A ruling's confirm card at Lean (rulings P5-52, P5-53): one click in the chat, unsigned, with proof chat-click,
    // on the card named `ruling-<its id>`, when the state holds that card as a ruling's confirm card, the click names
    // its text as the state holds it, the label is one of its options and nothing has answered it yet. Confirm puts the
    // ruling in force in a Lean project's rulebook; Not now or Suggest a change… (with the new words) closes the card.
    // On any other project Confirm stays signed and is refused below.
    const rulingCard = RULING_CARD.exec(card);
    if (ctx.lean === true && rulingCard) {
      if (proof !== 'chat-click') refuse('a click on a ruling\'s card is recorded as chat-click');
      if (commit !== undefined) refuse('a click on a ruling\'s card names no commit');
      const events = listEvents(stateDir(project), { report: () => {} });
      const held = events.find((e) => e.id === rulingCard[1] && e.kind === 'card');
      if (!held || held.data?.kind !== 'confirm' || !/^Confirm ruling \S+: "/.test(held.data?.line ?? '') || typeof held.data?.question !== 'string') refuse('that is not a ruling\'s confirm card in this project');
      if (hash !== crypto.createHash('sha256').update(held.data.question).digest('hex')) refuse('the click must name the card\'s text as the state holds it');
      if (!Array.isArray(held.data.options) || !held.data.options.includes(label)) refuse('that label isn\'t one of the card\'s options');
      if (events.some((e) => e.kind === 'card-answer' && e.data?.card === held.id)) refuse('that ruling\'s card has been answered already');
      return doWrite({ project, kind: 'card-answer', data: { card: held.id, label, hash, proof, tier: 'lean', ...(text === undefined ? {} : { text }) } }, ctx, { own: true });
    }
    const mayDecide = /^merge-/.test(card) || (ctx.lean === true && /^guardrail-/.test(card));
    if (SIGNED_LABELS.includes(label) && !mayDecide) refuse('a click in the chat can\'t decide that card');
    const data = { question: card, label, hash, ...(commit === undefined ? {} : { commit }), ...(text === undefined ? {} : { text }), proof };
    return doWrite({ project, kind: 'card-answer', data }, ctx, { own: true });
  }

  // --- the helper's own window (design section 6.3, ruling P5-23) ---

  // The step a signed record decides, when it is one the window confirms, else null: Lift STOP, a runbook step or
  // a CI push (an action), Unattended (the confirmation of a level or setting proposing it), or an approval, which
  // is how a guardrail change and a real-user merge are decided.
  // Keep it, on the card about a Lean project's main version moved outside the helper (ruling P5-27 f), is confirmed
  // here too, and so are a Lean undo and Undo it, which are runbook steps (ruling P5-50).
  const ACTION_STEPS = {
    'lift-stop': 'lift-stop', runbook: 'runbook-step', 'ci-push': 'ci-push', 'keep-main': 'keep-main', 'undo-merge': 'runbook-step', 'undo-main': 'runbook-step',
    'keep-control-files': 'guardrail-change', // keeping a feature's files that steer agents as they are (ruling P7-31)
  };
  // The steps the window serves while STOP is on: Lift STOP, and a Lean undo, as the runbook's local steps carry on.
  const UNDER_STOP = ['lift-stop', 'undo-merge', 'undo-main'];
  const servedUnderStop = (deciding) => deciding.filter((d) => d.made.kind === 'action' && UNDER_STOP.includes(d.made.data?.action));
  // What /confirm's `card` is for the Lift STOP card, which has no id in the state.
  const LIFT_STOP_NAME = 'lift-stop';
  function windowStep(project, made) {
    if (made.kind === 'approval') return 'approval';
    if (made.kind === 'action') return Object.hasOwn(ACTION_STEPS, made.data?.action) ? ACTION_STEPS[made.data.action] : null;
    if (made.kind !== 'confirmation') return null;
    const target = listEvents(stateDir(project), { report: () => {} }).find((e) => e.id === made.data?.confirms);
    return ['level', 'setting'].includes(target?.kind) && target.data?.value === 'unattended' ? 'unattended' : null;
  }

  // What a click on `label` in the window would record for `card`: the signed record the same click earns in a
  // hook that signs (prompt-record.js's earned, from the card's own question in the state), when it decides a
  // step the window confirms; else null. A pull request's head is read through this helper's own route.
  async function windowEarned(project, card, label, ctx) {
    const question = card.data?.question;
    if (typeof question !== 'string' || PUT_OFF.includes(label)) return null;
    if (ctx.lean) {
      const lean = await leanEarned(project, card.data, label);
      if (lean !== undefined) return lean;
    }
    const client = { prState: ({ number }) => routes['/pr/state']({ project, number }, ctx) };
    let got;
    try {
      got = await earned({ project, question, label, client, now, left: (p) => p, shownAt: card.at });
    } catch {
      return null;
    }
    if (!got?.made || got.profile) return null;
    const step = windowStep(project, got.made);
    return step === null ? null : { made: got.made, step, lift: got.lift === true };
  }

  // What a click in the window on a Lean card's Approve, Keep it, Undo it or Undo records (scripts/lean/store.js), or
  // null; undefined for any other label. Each card is the helper's own, word for word: its question, options and
  // header equal the card the helper composes from the line's values (ruling P5-50), so a card anyone wrote with the
  // right line but other words is never signed. Approve: the card names a feature's branch and its head in full,
  // and the store's branch is still at that head, so the approval is for that code and no other. Keep it and Undo
  // it: the card names the main version's move, and the record and the store still say so. Undo: the card names a
  // merge on the main version.
  async function leanEarned(project, data, label) {
    const question = data?.question;
    const one = (pattern) => {
      const lines = typeof question === 'string' ? [...question.matchAll(pattern)] : [];
      return lines.length === 1 ? lines[0] : null;
    };
    if (label === 'Approve') {
      const line = one(LEAN_APPROVE);
      if (line === null) return null;
      const [, branch, commit] = line;
      if (!sameCard(data, approvalCard(branch, commit, readLean(project)?.test ?? null))) return null;
      if ((await storeHead({ project, branch, run })) !== commit) return null;
      const made = { kind: 'approval', data: { branch, commit, words: 'Approve', question } };
      return { made, step: 'approval', lift: false };
    }
    if (label === 'Keep it' || label === 'Undo it') {
      const line = one(MAIN_MOVED_LINE);
      if (line === null) return null;
      const [, from, to] = line;
      if (!sameCard(data, mainMovedCard(from, to))) return null;
      if (readLean(project)?.main !== from || (await storeHead({ project, branch: 'main', run })) !== to) return null;
      const action = label === 'Keep it' ? 'keep-main' : 'undo-main';
      const made = { kind: 'action', data: { action, from, to, question, label } };
      return { made, step: ACTION_STEPS[action], lift: false };
    }
    if (label === 'Undo') {
      const line = one(UNDO_LINE);
      if (line === null) return null;
      const [, merge] = line;
      if (!sameCard(data, undoCard(merge))) return null;
      if (!(await mergeOnMain({ project, merge, run }))) return null;
      const made = { kind: 'action', data: { action: 'undo-merge', merge, question, label } };
      return { made, step: ACTION_STEPS['undo-merge'], lift: false };
    }
    return undefined;
  }

  // The card the request names, as the state holds it: there once, still waiting, its data hashing to `hash` (what
  // the caller was shown), with the options a click in the window would decide it by. Refuses otherwise. The Lift
  // STOP card is never in the state (the front desk composes it on each visit, since under STOP nothing is written:
  // ruling F25), so `lift-stop` names the one the helper composes itself, while STOP is on, shown at `shownAt` (now,
  // on the first look): the look after the click passes the time the window opened, so a click on a window shown
  // during one STOP never lifts a later one (earned()'s rule).
  async function windowCard({ project, card, hash }, ctx, { shownAt } = {}) {
    let event;
    if (card === LIFT_STOP_NAME) {
      if (!stopped()) refuse('STOP is not on, so there is nothing to lift');
      event = { at: shownAt ?? now().toISOString(), data: composeCard(LIFT_STOP_CARD).card };
    } else {
      const found = listEvents(stateDir(project), { report: () => {} }).filter((e) => e.kind === 'card' && e.id === card);
      if (found.length !== 1) refuse('that card is not in this project\'s state');
      [event] = found;
      if (dataHash(event.data) !== hash) refuse('that card is not the one shown: its hash differs');
      const { waiting } = await writeViews(project, { now });
      if (!(waiting ?? []).some((w) => w.id === card)) refuse('that card no longer waits for a click');
    }
    const options = (Array.isArray(event.data?.options) ? event.data.options : []).filter((o) => typeof o === 'string');
    const deciding = [];
    for (const label of options) {
      const got = await windowEarned(project, event, label, ctx);
      if (got) deciding.push({ label, ...got });
    }
    if (deciding.length === 0) refuse('that card is not one the window confirms: only Lift STOP, a guardrail change, Unattended, a runbook step, a CI push or an approval');
    return { event, deciding };
  }

  // POST /confirm { project | cwd, card, hash }: the card is looked up in the state (the caller's own text is never
  // shown), or is `lift-stop`, with no hash, for the Lift STOP card the helper composes itself; the window shows its words with its deciding options and Not now, and a deciding click is signed here,
  // with proof `window`, as the record the step already has: an approval, a confirmation or an action. The card is
  // looked at again after the click, so a card decided or changed meanwhile records nothing. A confirmed Lift STOP
  // lifts STOP: the window is the one place a click lifts it on an agent whose hooks only read. Not now, or no click
  // before the window closes, records nothing. Under STOP only the Lift STOP card and a Lean undo are served, with only
  // their undo offered (rulings P5-49 and P5-50). A card
  // in the state gets the plain card-answer beside its signed record, as a hook that signs writes one, so the card
  // no longer waits.
  async function doConfirm({ project, card, hash }, ctx) {
    if (card !== LIFT_STOP_NAME && (typeof card !== 'string' || !RANDOM_UUID.test(card))) refuse('the card must be named by its id, or be lift-stop');
    if (card !== LIFT_STOP_NAME && (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash))) refuse('the card\'s hash must be its sha256, in lower case');
    // Under STOP a card of a project that isn't Lean is refused before it is looked up (no read of the code host);
    // a Lean card is looked at, and only its undo offered.
    if (card !== LIFT_STOP_NAME && stopped() && !ctx.lean) return STOP_REFUSAL;
    const look = () => stateRoute((body) => windowCard(body, ctx))({ project, card, hash }, ctx);
    const shown = await look();
    if (card !== LIFT_STOP_NAME && stopped()) {
      shown.deciding = servedUnderStop(shown.deciding);
      if (shown.deciding.length === 0) return STOP_REFUSAL;
    }
    const lines = String(shown.event.data.question).split(/\r?\n/);
    const header = typeof shown.event.data.header === 'string' && shown.event.data.header !== '' ? shown.event.data.header : null;
    const { choice } = await askWindow({ title: header === null ? 'Wheelhouse' : `Wheelhouse: ${header}`, lines, options: shown.deciding.map((d) => d.label) });
    const picked = shown.deciding.find((d) => d.label === choice);
    if (!picked) return { ok: true, choice: choice === NOT_NOW ? NOT_NOW : null, recorded: false };
    const answer = await stateRoute(async () => {
      const CHANGED = 'that card changed while the window was open, so nothing was recorded';
      let again;
      try {
        again = await windowCard({ project, card, hash }, ctx, { shownAt: shown.event.at });
      } catch {
        refuse(CHANGED);
      }
      const still = again.deciding.find((d) => d.label === picked.label && d.step === picked.step && d.made.kind === picked.made.kind);
      if (!still) refuse(CHANGED);
      if (card !== LIFT_STOP_NAME && stopped() && servedUnderStop([still]).length === 0) return STOP_REFUSAL;
      const event = makeEvent({ kind: still.made.kind, data: { ...still.made.data, proof: 'window' }, now });
      const result = await writeEvent({ project, event, push: statePush(project, ctx), env: ctx.gitEnv, now });
      await freshViews(() => writeViews(project, { now }));
      if (card !== LIFT_STOP_NAME) await doWrite({ project, kind: 'card-answer', data: { card, question: again.event.data.question, label: still.label } }, ctx);
      if (still.lift) liftStop();
      if (event.kind === 'approval' && !ctx.lean) photographApproved(project, event.data?.commit, ctx);
      const action = event.kind === 'action' ? event.data?.action : null;
      const keep = action === 'keep-main' ? { from: event.data.from, to: event.data.to } : null;
      const undo = action === 'undo-merge' ? { merge: event.data.merge } : action === 'undo-main' ? { moved: true } : null;
      return { ...written({ event, result }), choice: still.label, kind: event.kind, step: still.step, recorded: true, keep, undo };
    })({ project, card, hash }, ctx);
    const { keep = null, undo = null, ...said } = answer;
    // Keep it: the record's main version becomes the one the card named, if nothing moved it since. Undo and Undo it:
    // the undo is made now, on the record just signed. Both outside the state's queue, since the store's lock is taken
    // before it by a merge.
    if (keep !== null) return { ...said, kept: await keepMain({ project, ...keep, run, now }) };
    if (undo !== null) return { ...said, undone: await leanAnswer(() => undoMerge({ project, ...undo, now, run, record: leanRecorder(ctx) })) };
    return said;
  }

  // --- a Lean project's git store (scripts/lean/store.js, rulings P5-24 to P5-27) ---

  // How the store records: a plain event written through this helper's state queue, so it takes its turn with
  // every other write. A merge or an undo whose proof is the window's is signed here (ruling P5-24): it is made as
  // doWrite makes a plain event, and signed by this computer before it is written. Gives the event's id.
  const leanRecorder = (ctx) => (project, kind, data, { signed = false } = {}) => oneAtATime(`state:${project}`, async () => {
    await leanState(project, { run });
    if (!signed) return (await doWrite({ project, kind, data }, ctx)).id;
    if (!PLAIN_KINDS.includes(kind) || !data || typeof data !== 'object' || Array.isArray(data)) refuse('only a plain record is signed this way');
    const event = sign(makeEvent({ kind, data, now }));
    await writeEvent({ project, event, push: statePush(project, ctx), env: ctx.gitEnv, now });
    await freshViews(() => writeViews(project, { now }));
    return event.id;
  });
  // The store's answer, or its refusal in the helper's shape with what it adds (`card`, `needs`, `reasons`).
  async function leanAnswer(fn) {
    try {
      return { ok: true, ...(await fn()) };
    } catch (error) {
      if (error instanceof LeanRefusal) return { ok: false, refused: error.message, ...error.extra };
      throw error;
    }
  }
  // POST /lean/status { project | cwd }: how the store stands, raising the card when the main version moved
  // outside the helper. Answered under STOP.
  const doLeanStatus = ({ project }, ctx) => leanAnswer(() => leanStatus({ project, run, now, record: leanRecorder(ctx) }));
  // POST /lean/merge { project | cwd, branch, commit }: the approved commit of `feature/<slug>` merged, after its
  // tests pass. The proofs taken are the chat's own and the window's.
  const doLeanMerge = ({ project, branch, commit }, ctx) => leanAnswer(() => mergeApproved({
    project, branch, commit, now, run, record: leanRecorder(ctx), approvalProofs: [...CHAT_PROOFS, ...SIGNED_LEAN_PROOFS],
  }));
  // POST /lean/undo { project | cwd, merge } or { project | cwd, moved: true }: a merge undone, or the main version's
  // changes made outside the helper undone, each on the director's click.
  const doLeanUndo = ({ project, merge, moved }, ctx) => leanAnswer(() => undoMerge({
    project, merge, moved: moved === true, now, run, record: leanRecorder(ctx),
  }));
  // POST /lean/copy { project | cwd }: the main version and the state's branch pushed to the copy folder.
  const doLeanCopy = ({ project }, ctx) => leanAnswer(() => copyNow({ project, now, run, record: leanRecorder(ctx) }));

  const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
  const TARGET_KEYS = ['v', 'id', 'at', 'computer', 'kind', 'data'];
  // The plain ruling or setting a confirmation carries (`target`): the event a hook made from the
  // director's answer on a setup card that said it records it (rulings R35, R59), confirmed by that
  // same click. The helper makes every other plain event itself, but a confirmation names its
  // event's every field, its time among them, so this one comes whole, and is taken only as the
  // event the signed confirmation names, by its id and its hash, made on this computer.
  function checkTarget(target, event) {
    const plain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
    if (event.kind !== 'confirmation') refuse('only a confirmation carries the event it confirms');
    if (!plain(target) || Object.keys(target).some((k) => !TARGET_KEYS.includes(k)) || target.v !== 1 || !plain(target.data)) refuse('the confirmed event is not a whole plain event');
    if (!CONFIRMABLE_KINDS.includes(target.kind) || target.kind === 'level') refuse('only a ruling or a setting comes with its confirmation');
    if (typeof target.id !== 'string' || !RANDOM_UUID.test(target.id) || typeof target.at !== 'string' || !ISO_TIME.test(target.at)) refuse('the confirmed event needs a random id and its time');
    if (target.computer !== computerId()) refuse('only an event made on this computer comes with its confirmation');
    if (event.data?.confirms !== target.id || event.data?.confirmsHash !== eventHash(target)) refuse('the confirmation does not name the event it carries');
    if (target.kind === 'setting') {
      try { checkSetting(target.data.key, target.data.value, target.data.until); } catch (error) { refuse(error.message); }
    }
  }

  async function doRecord({ project, event, target }, ctx) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) refuse('the record must be an event');
    if (!PROTECTED_KINDS.includes(event.kind)) refuse('only a signed kind is recorded this way');
    if (typeof event.id !== 'string' || typeof event.at !== 'string' || !ISO_TIME.test(event.at)) refuse('the record is not a whole event');
    if (!verify(event, readEnrolled())) refuse('the record is not signed by an enrolled computer');
    if (event.sig.computer !== computerId() || event.computer !== computerId()) refuse('only this computer\'s own signed records are taken');
    if (target !== undefined) checkTarget(target, event);
    const events = listEvents(stateDir(project), { report: () => {} });
    const held = events.filter((e) => e.id === event.id);
    if (held.length > 0 && !held.some((e) => canonicalJson(e) === canonicalJson(event))) refuse('another event in the state carries this record\'s id, so it was not recorded');
    // The confirmed event goes first, once, even when its confirmation is there already: a kept
    // copy sent again finds it there, and a confirmation that reached the state alone gets it.
    if (target !== undefined) {
      const there = events.filter((e) => e.id === target.id);
      if (there.some((e) => canonicalJson(e) !== canonicalJson(target))) refuse('another event in the state carries the confirmed event\'s id, so neither was recorded');
      if (there.length === 0) {
        await writeEvent({ project, event: target, push: statePush(project, ctx), env: ctx.gitEnv, now });
        if (held.length > 0) await freshViews(() => writeViews(project, { now }));
      }
    }
    // The same record again has been taken (a hook sending its kept copy); another
    // event under its id has not, and says so in words a hook does not count as taken.
    if (held.length > 0) refuse('the state already holds an event with that id');
    const result = await writeEvent({ project, event, push: statePush(project, ctx), env: ctx.gitEnv, now });
    await freshViews(() => writeViews(project, { now }));
    // A Lean project has no preview to photograph.
    if (event.kind === 'approval' && !ctx.lean) photographApproved(project, event.data?.commit, ctx);
    return written({ event, result });
  }

  // --- the director's profile (design section 5.5) ---

  // What git gets for the profile's own connection; the profile has no host requests.
  async function profileContext() {
    const { mode, env } = connectionOf(await profileEnvFor());
    const looked = new Map();
    // Before the request's first git call in the profile clone (every profile route's first step).
    await lookOnce({ looked }, profileDir(), '.git', "the director's profile repository");
    return {
      mode,
      env,
      signedOut: false,
      looked,
      gitEnv: companyGit(gitEnvOf(mode, env, profileRemote()?.connection?.host, profileRemote()?.remoteUrl), profileRemote()),
      reach: reachFor(profileRemote()?.remoteUrl),
      secrets: secretsOf(env),
      adapter: async () => refuse('the profile makes no requests of the host'),
    };
  }

  const PROFILE_TRACKING = `refs/remotes/${REMOTE}/${PROFILE_BRANCH}`;
  const inRebase = (dir) => ['rebase-merge', 'rebase-apply'].some((d) => fs.existsSync(path.join(dir, '.git', d)));

  // Brings the profile clone up to date: the branch fetched into its tracking ref, then this
  // computer's commits rebased onto it. A fetched tip holding anything under keys/ is never taken
  // in (ruling R105): it fails closed, saying so. Two computers that back up the same
  // project on the same day each add backups/<project>/<date>.bundle: the same state, so
  // where the rebase stops only on bundles, the remote's copy is taken and this computer's
  // commit of it is dropped. A stop on anything else is abandoned and said.
  async function pullProfile(ctx) {
    const dir = profileDir();
    const env = ctx.gitEnv;
    const fetched = await profileGit(dir, ['fetch', '-q', '--no-tags', REMOTE, `+refs/heads/${PROFILE_BRANCH}:${PROFILE_TRACKING}`], env);
    if (fetched.code !== 0) return { ok: false, why: 'the profile could not be brought up to date from its repository' };
    const keys = await holdsKeys(dir, PROFILE_TRACKING);
    if (keys !== false) return { ok: false, keys: true, why: keys === null ? 'the profile\'s branch could not be read, so nothing was taken from it' : PROFILE_HOLDS_KEYS };
    const pulled = await profileGit(dir, ['rebase', PROFILE_TRACKING], env);
    if (pulled.code === 0) return { ok: true };
    if (!inRebase(dir)) return { ok: false, why: 'the profile could not be brought up to date from its repository' };
    for (let round = 0; round < 100 && inRebase(dir); round++) {
      const listed = await profileGit(dir, ['diff', '--name-only', '--diff-filter=U', '-z']);
      const paths = listed.stdout.split('\0').filter(Boolean);
      if (listed.code !== 0 || paths.length === 0 || !paths.every((p) => BUNDLE_PATH.test(p))) break;
      // During a rebase "ours" is the remote's side.
      for (const p of paths) {
        const taken = await profileGit(dir, ['checkout', '--ours', '--', p]);
        await profileGit(dir, taken.code === 0 ? ['add', '--', p] : ['rm', '-q', '--', p]);
      }
      const nothingLeft = (await profileGit(dir, ['diff', '--cached', '--quiet'])).code === 0;
      await profileGit(dir, nothingLeft ? ['rebase', '--skip'] : ['-c', 'core.editor=true', 'rebase', '--continue'], env);
    }
    if (!inRebase(dir)) return { ok: true };
    await profileGit(dir, ['rebase', '--abort'], env);
    return { ok: false, why: 'the profile here and in its repository differ in a way that needs looking at, so nothing more was pushed' };
  }

  // Pushes the profile, bringing the clone up to date and trying again when the remote
  // has moved on. Never answers that the push was declined without saying why.
  async function pushProfile(ctx) {
    for (let attempt = 0; ; attempt++) {
      const answer = await pushProfileOnce(ctx);
      if (answer.rejected !== 'non-fast-forward') return answer;
      if (attempt === 3) return { ok: false, refused: 'the profile\'s repository kept moving on, so the push did not go through; the next sync tries again' };
      const pulled = await pullProfile(ctx);
      if (!pulled.ok) return { ok: false, refused: pulled.why };
    }
  }

  // Pushes the profile branch straight from the helper's own clone, once every commit the
  // remote lacks has passed the profile's push rules. Never a force-push.
  async function pushProfileOnce(ctx) {
    if (stopped()) return STOP_REFUSAL;
    const dir = profileDir();
    const keyed = keyedFor(ctx);
    const inClone = (args) => keyed('git', args, { cwd: dir });
    const shallow = await inClone(['rev-parse', '--is-shallow-repository']);
    if (shallow.code !== 0) return { ok: false, refused: PUSH_REFUSALS.unchecked };
    if (shallow.stdout.trim() === 'true') return { ok: false, refused: PUSH_REFUSALS.shallow };
    const resolved = await inClone(['rev-parse', '--verify', '-q', `refs/heads/${PROFILE_BRANCH}^{commit}`]);
    const sha = resolved.stdout.trim();
    if (resolved.code !== 0 || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(sha)) return { ok: false, refused: PUSH_REFUSALS.missing };
    const checked = await checkCommits({
      dir, branch: PROFILE_BRANCH, sha, gitRun: keyed, allowed: PROFILE_CHANGE, refused: PUSH_REFUSALS.profile, scan: (file) => file.startsWith('events/'), push: 'profile',
    });
    if (!checked.allowed) return { ok: false, refused: checked.refused };
    if (stopped()) return STOP_REFUSAL;
    const pushed = await inClone(['push', '--no-verify', '--porcelain', REMOTE, `${sha}:refs/heads/${PROFILE_BRANCH}`]);
    if (pushed.code === 0) {
      await unkeyed('git', ['update-ref', PROFILE_TRACKING, sha], { cwd: dir });
      return { ok: true };
    }
    if (pushed.timedOut) return { ok: false, refused: 'the host did not answer the push in time' };
    const line = pushed.stdout.split('\n').find((l) => l.startsWith('!') && l.includes(`refs/heads/${PROFILE_BRANCH}`));
    if (line && /\((?:non-fast-forward|fetch first|failed to update ref|incorrect old value provided)\)/.test(line)) return { ok: false, rejected: 'non-fast-forward' };
    const detail = clean(pushed.stderr, ctx.secrets);
    return { ok: false, refused: `git could not push the profile${detail ? `: ${detail}` : ''}` };
  }
  const profilePush = (ctx) => () => pushProfile(ctx);
  const inProfile = () => ({ dir: profileDir(), branch: PROFILE_BRANCH });

  // Whether the keep rule removed this bundle: the backup keeps the newest BUNDLES_KEPT of
  // a project, so a bundle with that many newer ones beside it is one it pruned.
  function prunedByKeepRule(file) {
    const name = file.split('/').at(-1);
    let names = [];
    try { names = fs.readdirSync(path.join(profileDir(), ...file.split('/').slice(0, -1))); } catch { /* none */ }
    return names.filter((n) => BACKUP_FILE.test(n) && n > name).length >= BUNDLES_KEPT;
  }

  // Commits the new bundles under backups/, and the removal of those the keep rule pruned,
  // so the folder is clean for a pull. A bundle missing for any other reason (a start cut
  // short, a slip) or changed in place is put back from the branch; any other file is left alone.
  async function commitBackups() {
    const dir = profileDir();
    const listed = await profileGit(dir, ['status', '--porcelain=v1', '-z', '-uall', '--', 'backups/']);
    if (listed.code !== 0) refuse('the profile\'s backups could not be read');
    const entries = listed.stdout.split('\0').filter((entry) => BUNDLE_PATH.test(entry.slice(3)));
    const having = (code) => entries.filter((entry) => entry.startsWith(code)).map((entry) => entry.slice(3));
    const deleted = having(' D ');
    const pruned = deleted.filter(prunedByKeepRule);
    const putBack = [...having(' M '), ...deleted.filter((f) => !pruned.includes(f))];
    if (putBack.length > 0 && (await profileGit(dir, ['checkout', '-q', '--', ...putBack])).code !== 0) {
      refuse('the profile\'s backups could not be put back');
    }
    const changed = [...having('?? '), ...pruned];
    if (changed.length === 0) return;
    const committed = (await profileGit(dir, ['add', '-A', '--', ...changed])).code === 0
      && (await profileGit(dir, ['commit', '-q', '-m', 'Back up the state', '--', ...changed])).code === 0;
    if (!committed) {
      await profileGit(dir, ['reset', '-q', '--', ...changed]);
      refuse('the profile\'s backups could not be committed');
    }
  }

  // One at a time: the profile clone is shared by every profile route and the backup.
  const profileRoute = (fn, { clone = true, write = false } = {}) => (body, ctx) => oneAtATime('profile', async () => {
    if (write && stopped()) return STOP_REFUSAL;
    if (clone) await ensureProfileClone({ remote: profileRemote(), env: ctx.gitEnv });
    if (write && stopped()) return STOP_REFUSAL;
    return fn(body, ctx);
  });

  async function doProfileWrite({ kind, data }, ctx) {
    if (kind !== 'setting') refuse('only a setting is written to the profile');
    if (!data || typeof data !== 'object' || Array.isArray(data)) refuse('the event\'s data must be an object');
    try { checkSetting(data.key, data.value, data.until); } catch (error) { refuse(error.message); }
    if (definitionOf(data.key)?.home !== 'profile') refuse(`${data.key} is kept in each project, not in the profile`);
    await commitBackups();
    const event = makeEvent({ kind, data, now });
    const result = await writeEvent({ event, push: profilePush(ctx), env: ctx.gitEnv, ...inProfile(), now });
    await freshViews(() => writeProfileViews({ now }));
    return profileWritten({ event, result });
  }

  // As `written`, and when the event did not reach the profile's repository, how many
  // commits there still lack, so work that is stuck is said plainly.
  async function profileWritten(made) {
    const answer = written(made);
    if (answer.pushed) return answer;
    const ahead = await profileGit(profileDir(), ['rev-list', '--count', `${PROFILE_TRACKING}..HEAD`]);
    const count = Number.parseInt(ahead.stdout.trim(), 10);
    return { ...answer, unpushed: ahead.code === 0 && Number.isInteger(count) ? count : 1 };
  }

  async function doProfileRecord({ event }, ctx) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) refuse('the record must be an event');
    if (event.kind !== 'confirmation') refuse('only a confirmation is recorded in the profile');
    if (typeof event.id !== 'string' || typeof event.at !== 'string' || !ISO_TIME.test(event.at)) refuse('the record is not a whole event');
    if (!verify(event, readEnrolled())) refuse('the record is not signed by an enrolled computer');
    if (event.sig.computer !== computerId() || event.computer !== computerId()) refuse('only this computer\'s own signed records are taken');
    const events = listEvents(profileDir(), { report: () => {} });
    if (events.some((e) => e.id === event.id)) refuse('the profile already holds an event with that id');
    const target = events.find((e) => e.id === event.data?.confirms);
    if (target?.kind !== 'setting' || eventHash(target) !== event.data?.confirmsHash) {
      refuse('the confirmation names something that is not a profile event');
    }
    await commitBackups();
    const result = await writeEvent({ event, push: profilePush(ctx), env: ctx.gitEnv, ...inProfile(), now });
    await freshViews(() => writeProfileViews({ now }));
    return profileWritten({ event, result });
  }

  // The computers' keys the profile holds (ruling R81): the profile's branch fetched into its
  // tracking ref, then each enrolments/<computer>.json read from that fetched tree, never from the
  // working tree, and neither the working tree nor the helper's own branch changed. A file that
  // isn't an enrolment of the computer it is named for is left out. When the fetch fails, what an
  // earlier fetch brought is read, and `fetched` says so. Nothing here is trusted: the session start
  // offers each on a card, and only the director's click there trusts it.
  async function doProfileEnrolments(_body, ctx) {
    const dir = profileDir();
    const fetched = (await profileGit(dir, ['fetch', '-q', '--no-tags', REMOTE, `+refs/heads/${PROFILE_BRANCH}:${PROFILE_TRACKING}`], ctx.gitEnv)).code === 0;
    const listed = await profileGit(dir, ['ls-tree', '-z', '--full-tree', PROFILE_TRACKING, '--', 'enrolments/']);
    if (listed.code !== 0) return { ok: true, fetched, enrolments: [] };
    const enrolments = [];
    for (const entry of listed.stdout.split('\0').filter(Boolean)) {
      if (enrolments.length >= MAX_ENROLMENTS) break;
      const m = /^100644 blob ([0-9a-f]{40}|[0-9a-f]{64})\t(.+)$/s.exec(entry);
      const file = m === null ? null : ENROLMENT_FILE.exec(m[2]);
      if (file === null) continue;
      const size = await profileGit(dir, ['cat-file', '-s', m[1]]);
      if (size.code !== 0 || Number(size.stdout.trim()) > MAX_ENROLMENT_BYTES) continue;
      const blob = await profileGit(dir, ['cat-file', 'blob', m[1]]);
      const found = blob.code === 0 ? enrolmentOf(blob.stdout, file[1]) : null;
      if (found !== null) enrolments.push(found);
    }
    return { ok: true, fetched, enrolments };
  }

  // The answer carries the last push's refusal, when the push rules refused it.
  async function doProfileSync(_body, ctx) {
    await commitBackups();
    // What it can't settle, the push below says; a tip holding keys/ stops the sync here.
    const first = await pullProfile(ctx);
    if (first.keys) return { ok: false, refused: first.why };
    let refused;
    const push = async () => {
      const pushed = await pushProfile(ctx);
      refused = pushed.refused;
      return pushed;
    };
    // Its pull is the profile's own, fenced as above.
    const pull = async () => ({ code: (await pullProfile(ctx)).ok ? 0 : 1 });
    const synced = await syncState({ push, pull, env: ctx.gitEnv, ...inProfile() });
    await freshViews(() => writeProfileViews({ now }));
    return refused === undefined ? { ok: true, ...synced } : { ok: false, ...synced, refused };
  }

  // This week's bundle of the project's state branch, into the profile's backups/. The
  // profile is brought up to date first, so a bundle another computer made today is found
  // and not made again. When the profile's repository can't be reached the bundle is still
  // made here.
  async function doBackup({ project }) {
    const profileCtx = await profileContext();
    await ensureProfileClone({ remote: profileRemote(), env: profileCtx.gitEnv });
    await commitBackups();
    await pullProfile(profileCtx);
    const today = `backups/${project}/${now().toISOString().slice(0, 10)}.bundle`;
    if ((await profileGit(profileDir(), ['cat-file', '-e', `HEAD:${today}`])).code === 0) {
      return { ok: true, file: today, made: false, why: 'The profile already holds today\'s backup of this project' };
    }
    let before = [];
    try { before = fs.readdirSync(path.join(profileDir(), 'backups', project)); } catch { /* none yet */ }
    const file = await writeBackup({ project, now });
    const made = !before.includes(path.basename(file));
    return {
      ok: true,
      file: path.relative(profileDir(), file).replaceAll('\\', '/'),
      made,
      ...(made ? {} : { why: 'A backup of this project from the last seven days is already kept' }),
    };
  }

  // The changed files and the configuration, in the mirror. One at a time per
  // project: the mirror and its refs are shared with pushes.
  function readChanges({ project, number, headSha, defaultBranch }, ctx) {
    return oneAtATime(`mirror:${project}`, async () => {
      const mirror = await mirrorFor(project, ctx);
      return changedPaths({
        mirror, host: recordOf(project).host, number, headSha, defaultBranch, run: keyedFor(ctx), read: [SETTINGS_FILE],
      });
    });
  }

  // Whether a pull request is a pins-only Wheelhouse release (design section 14.4, ruling R132): its
  // branch names the release's commit, its only change is the Wheelhouse marketplace's `ref` in the
  // project's settings, and Wheelhouse's repository, fetched over https into the helper's own
  // mirror, has that tag at that commit, on its default branch, with a release file saying it only
  // moves the pins and passed the lineage job. The helper's own finding, never the caller's.
  // Resolves with `{ matched: false }` for any other pull request, else `{ matched: true, ok, ref,
  // sha, why? }`; anything that can't be read is not pins-only.
  async function isPinsOnlyRelease({ pr, changes }, ctx) {
    const named = RELEASE_BRANCH.exec(typeof pr.headRef === 'string' ? pr.headRef : '');
    if (!named) return { matched: false };
    const sha = named[1];
    const change = changes === null ? null : pinsOnlyChange(changes.paths, changes.files?.[SETTINGS_FILE]);
    if (change === null) return { matched: true, ok: false, why: `it changes more than the Wheelhouse marketplace's ref in ${SETTINGS_FILE}` };
    const checked = await oneAtATime('wheelhouse-release', async () => {
      await lookOnce(ctx, path.join(wheelhouseHome(), 'lineage', 'wheelhouse.git'), 'HEAD', "Wheelhouse's release mirror");
      return checkRelease({
      ref: change.ref, sha, mirror: path.join(wheelhouseHome(), 'lineage', 'wheelhouse.git'), url: wheelhouseRepo, git: (args, options) => gitIn({}, HOST_MS, reachFor(wheelhouseRepo))('git', args, options),
      });
    });
    return checked.ok ? { matched: true, ok: true, ref: change.ref, sha } : { matched: true, ok: false, why: checked.why };
  }

  // Whether the configuration git reads when the fenced runner `fenced` runs in `mirror` sets any
  // key matching `pattern`: 'none', 'some', or 'unreadable'.
  // With `withoutCall`, settings from the call's own environment (`command` scope, where the fence sets
  // `merge.verifySignatures`) are left out; every file scope, the worktree's included, is still read.
  async function configSets(fenced, mirror, pattern, withoutCall = false) {
    const listed = await fenced('git', ['config', ...(withoutCall ? ['--show-scope'] : []), '--name-only', '--get-regexp', pattern], { cwd: mirror, input: '' });
    if (listed.code === 1) return 'none';
    if (listed.code !== 0) return 'unreadable';
    const lines = listed.stdout.split('\n').filter((l) => l.trim() !== '' && !(withoutCall && l.startsWith('command\t')));
    return lines.length === 0 ? 'none' : 'some';
  }

  // Two branches merged in the mirror, to see whether they clash in text
  // (design section 12). Read-only toward the host, so STOP lets it through.
  // Both branches are fetched with the connection's key into fixed working
  // refs; `git merge-tree` then merges them with no checkout and no index.
  // Nothing from either branch can run:
  //   - git reads hooks from two places. Every call here sets core.hooksPath
  //     to the null file, which stops the hooks folder. A hook named in the
  //     configuration (hook.<name>.command) is not stopped by that, so the
  //     request is refused, before any ref is touched, when the configuration
  //     the fetch reads (the connection's) or the mirror's own sets any
  //     hook.* key.
  //   - The merge runs with no system or user configuration and no attributes
  //     from outside the mirror, and the request is refused when the mirror's
  //     own configuration sets any filter.* or merge.* key, so an attribute in
  //     a branch that names a filter or a merge driver finds nothing to run.
  // The working refs are dropped afterwards, whatever happened.
  const TEST_MERGE_REFS = ['refs/wheelhouse/tm/a', 'refs/wheelhouse/tm/b'];
  const CONFIG_REFUSED = {
    some: 'the git configuration names a hook, filter or merge driver, so nothing is merged',
    unreadable: 'the git configuration could not be read, so nothing is merged',
  };
  function doTestMerge({ project, a, b }, ctx) {
    if (!plainBranch(a) || !plainBranch(b)) refuse('the branch name is not valid');
    return oneAtATime(`mirror:${project}`, () => inMirror(project, ctx, async ({ mirror, keyed }) => {
      const plain = (file, args, options = {}) => unkeyed(file, args, { ...options, env: { GIT_ATTR_NOSYSTEM: '1', ...options.env } });
      const local = (args) => plain('git', args, { cwd: mirror, input: '' });
      for (const said of [await configSets(keyed, mirror, '^hook\\.'), await configSets(plain, mirror, '^(filter|merge|hook)\\.', true)]) {
        if (said !== 'none') return { ok: false, refused: CONFIG_REFUSED[said] };
      }
      try {
        for (const ref of TEST_MERGE_REFS) await local([...NO_HOOKS, 'update-ref', '-d', ref]);
        const fetched = await keyed('git', [
          ...NO_HOOKS, 'fetch', '-q', '--no-tags', '--no-recurse-submodules', '--no-write-fetch-head', REMOTE,
          `+refs/heads/${a}:${TEST_MERGE_REFS[0]}`, `+refs/heads/${b}:${TEST_MERGE_REFS[1]}`,
        ], { cwd: mirror, input: '' });
        if (fetched.code !== 0) return { ok: false, refused: 'fetching the branches failed' };
        const merged = await local([
          ...MERGE_ONLY, 'merge-tree', '--write-tree', '--name-only', '-z', '--no-messages', TEST_MERGE_REFS[0], TEST_MERGE_REFS[1],
        ]);
        if (merged.code !== 0 && merged.code !== 1) return { ok: false, refused: 'git could not merge the two branches' };
        const conflicts = merged.code === 0 ? [] : merged.stdout.split('\0').slice(1).filter((name) => name !== '');
        return { ok: true, clean: merged.code === 0, conflicts };
      } finally {
        for (const ref of TEST_MERGE_REFS) await local([...NO_HOOKS, 'update-ref', '-d', ref]);
      }
    }));
  }

  // The project's configuration as the default branch has it, from the mirror: never a
  // working copy an agent can edit. For the watcher, which holds no keys.
  async function doConfig({ project }, ctx) {
    const adapter = await ctx.adapter();
    const defaultBranch = await defaultBranchOf(project, adapter);
    return oneAtATime(`mirror:${project}`, () => inMirror(project, ctx, async ({ must }) => {
      await defaultHistory(must, defaultBranch);
      return { ok: true, config: await baseConfig(must) };
    }));
  }

  // git in the mirror with no key, no system or user configuration and no system attributes.
  const local = (mirror) => (args, options = {}) => unkeyed('git', args, {
    cwd: mirror, input: '', ...options, env: { GIT_ATTR_NOSYSTEM: '1', ...options.env },
  });

  // The checks /test-merge makes, for a merge or a diff in the mirror: no hook in the
  // configuration a keyed fetch reads, and no hook, filter, merge or diff driver in the
  // mirror's own. The refusal, or null.
  async function mirrorRefusal(mirror, keyed) {
    const plain = (file, args, options = {}) => unkeyed(file, args, { ...options, env: { GIT_ATTR_NOSYSTEM: '1', ...options.env } });
    for (const said of [await configSets(keyed, mirror, '^hook\\.'), await configSets(plain, mirror, '^(filter|merge|hook|diff)\\.', true)]) {
      if (said !== 'none') return CONFIG_REFUSED[said];
    }
    return null;
  }

  const prSource = (project, number) => (recordOf(project).host === 'gitlab' ? `refs/merge-requests/${number}/head` : `refs/pull/${number}/head`);

  // Fetches the pull request's head and the default branch into the mirror with the key, and
  // checks the head is the one the host reported. Throws otherwise.
  async function fetchPr({ mirror, keyed, git, number, headSha, defaultBranch, project }) {
    const prRef = `refs/wheelhouse/pr/${number}`;
    const fetched = await keyed('git', [
      ...NO_HOOKS, 'fetch', '-q', '--no-tags', '--no-recurse-submodules', '--no-write-fetch-head', REMOTE,
      `+${prSource(project, number)}:${prRef}`, `+refs/heads/${defaultBranch}:${BASE_REF}`,
    ], { cwd: mirror, input: '' });
    if (fetched.code !== 0) throw new Error('fetching the pull request failed');
    const head = await git([...NO_HOOKS, 'rev-parse', '--verify', '--end-of-options', `${prRef}^{commit}`]);
    if (head.code !== 0 || head.stdout.trim() !== headSha) throw new Error('the fetched head is not the head the host reported');
    return prRef;
  }

  // The facts the gate's carry-over rule needs, read in the mirror (design section 12): whether
  // the default branch's head is an ancestor of the pull request's head, and, for each earlier
  // commit named in `from`, whether what was signed for it still holds for the head. It holds
  // when its patch-id (against its merge base with the default branch) is the head's, and every
  // commit after it on the head's first-parent line is a clean update merge. A commit of the
  // feature's own after it, or an update merge whose resolution changed code, needs the head
  // signed again. With `withConfig`, the default branch's configuration as fetched here too (`config`, undefined
  // when it can't be read). Read-only toward the host. Throws when the mirror cannot say.
  function carryFacts({ project, number, headSha, defaultBranch, from, withConfig = false }, ctx) {
    if (!plainBranch(defaultBranch)) throw new Error('the default branch is not known');
    if (typeof headSha !== 'string' || !FULL_SHA.test(headSha)) throw new Error('the head commit is not known');
    return oneAtATime(`mirror:${project}`, () => inMirror(project, ctx, async ({ mirror, keyed }) => {
      const git = local(mirror);
      const refusal = await mirrorRefusal(mirror, keyed);
      if (refusal) throw new Error(refusal);
      const prRef = `refs/wheelhouse/pr/${number}`;
      try {
        await fetchPr({ mirror, keyed, git, number, headSha, defaultBranch, project });
        const onTop = await git([...NO_HOOKS, 'merge-base', '--is-ancestor', BASE_REF, headSha]);
        if (onTop.code !== 0 && onTop.code !== 1) throw new Error('comparing the branch with the default branch failed');
        let headPatch = null;
        const holds = async (commit) => {
          if (typeof commit !== 'string' || !FULL_SHA.test(commit) || commit === headSha) return false;
          // The commits after `commit` on the head's first-parent line, newest first. Each must be a
          // clean update merge whose first parent is the one before it (the oldest's is `commit`)
          // and whose second parent is from the default branch.
          const after = await git([...NO_HOOKS, 'rev-list', '--first-parent', '--end-of-options', headSha, `^${commit}`, '--']);
          const line = after.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
          if (after.code !== 0 || line.length === 0) return false;
          for (const [i, c] of line.entries()) {
            if (!(await cleanUpdate({ git, commit: c, first: line[i + 1] ?? commit, base: BASE_REF }))) return false;
          }
          headPatch ??= await patchIdOf({ git, base: BASE_REF, head: headSha });
          return headPatch !== '' && (await patchIdOf({ git, base: BASE_REF, head: commit })) === headPatch;
        };
        const out = { upToDate: onTop.code === 0 };
        for (const [name, commit] of Object.entries(from)) out[name] = await holds(commit);
        const configHere = () => baseConfig(async (args, what) => {
          const answer = await git(args);
          if (answer.code !== 0) throw new Error(`${what} failed`);
          return answer.stdout;
        });
        // An approval that still holds is compared on the pages the configuration at the default
        // branch (fetched above) lists: none when it can't be read.
        if (out.approval === true) {
          try {
            out.pages = pagesOf(await configHere());
          } catch {
            out.pages = [];
          }
        }
        if (withConfig) {
          try {
            out.config = await configHere();
          } catch {
            out.config = undefined;
          }
        }
        return out;
      } finally {
        await git([...NO_HOOKS, 'update-ref', '-d', prRef]);
      }
    }));
  }

  // --- screenshots (design section 12.3; front desk plan, Task 12) ---

  // The browser, looked for when pictures are needed. Only a Chrome that is found is kept: with none,
  // or only Edge, whose pictures don't count yet, it is looked for again next time, so a Chrome
  // installed later is used without restarting the helper.
  let chrome = null;
  function browserPath() {
    if (screens.browser !== undefined) return screens.browser;
    if (chrome !== null) return chrome;
    const found = (screens.findBrowser ?? findBrowser)();
    if (stopsAtPicture(found)) chrome = found;
    return found;
  }

  // Set when the helper is closing: photographing and comparing stop after the picture under way,
  // so closing waits for one picture at most, and a comparison cut short answers false.
  let closing = false;

  // How the comparison and the photographing find pictures for one request: the project's cache,
  // each commit's preview from the request's adapter, and the shoot and browser to use.
  function picturesFor(project, ctx) {
    return {
      dir: screensDir(project),
      previewUrl: async (sha) => (await ctx.adapter()).previewUrl(sha),
      shoot: screens.shoot ?? shootPage,
      browser: browserPath(),
      run,
      fetch,
    };
  }

  // Whether every page looks the same at both commits (scripts/screens/compare.js's compareCommits,
  // which photographs only the head: the approved commit's pictures come from the cache written when
  // its approval was recorded, and any missing answers false). No pages, no comparison: false, and
  // no browser is opened. One comparison or photographing at a time per project, so pictures of an
  // approved commit still being taken are in the cache before the gate looks.
  async function pagesLookSame({ project, before, after, pages }, ctx) {
    if (!Array.isArray(pages) || pages.length === 0) return false;
    return oneAtATime(`screens:${project}`, async () => {
      if (closing) return false;
      if (screenshotsMatch) return (await screenshotsMatch({ project, before, after, pages })) === true;
      return (await compareCommits({ before, after, pages, sizes: SCREEN_SIZES, ...picturesFor(project, ctx), keepGoing: () => !closing })) === true;
    });
  }

  // The approved commit's pages, photographed at every size into the cache when its approval is
  // recorded, each with the address it came from. These are the only pictures of it the gate uses:
  // they are there when an update comes, after the host may have taken that commit's preview down.
  // In the background: the answer doesn't wait, and nothing is reported. Nothing when the
  // configuration lists no pages or can't be read, and STOP and closing are read before each picture.
  function photographApproved(project, commit, ctx) {
    if (typeof commit !== 'string' || !FULL_SHA.test(commit)) return;
    oneAtATime(`screens:${project}`, async () => {
      if (stopped() || closing) return;
      const adapter = await ctx.adapter();
      const defaultBranch = await defaultBranchOf(project, adapter);
      const pages = await oneAtATime(`mirror:${project}`, () => inMirror(project, ctx, async ({ must }) => {
        await defaultHistory(must, defaultBranch);
        return pagesOf(await baseConfig(must));
      }));
      if (pages.length === 0 || stopped() || closing) return;
      pruneScreens(screensDir(project));
      await photographCommit({ sha: commit, pages, sizes: SCREEN_SIZES, ...picturesFor(project, ctx), keepGoing: () => !stopped() && !closing });
    }).catch(() => {});
  }

  // The preview of an open pull request's head, for the front desk's "Show me": its address, or
  // null when the pull request isn't open or the host has no successful deployment of its head.
  // Read-only, so STOP lets it through.
  async function doPreview({ project, number }, ctx) {
    if (!Number.isInteger(number) || number < 1) refuse('the pull request number must be a whole number from 1');
    const adapter = await ctx.adapter();
    const pr = await adapter.prState(number);
    if (pr?.state !== 'open' || typeof pr.headSha !== 'string' || !FULL_SHA.test(pr.headSha)) return { ok: true, url: null };
    const url = await adapter.previewUrl(pr.headSha);
    return { ok: true, url: typeof url === 'string' ? url : null };
  }

  // The review and the approval the gate weighs, and whether the branch is up to date. Each is
  // the latest signed record for this pull request, in the carried form when it names an
  // earlier commit and still holds for the head (carryFacts); an approval carries only when the
  // screenshots of the two commits match too, and they are compared only when `compare` says the
  // merge needs the approval. Anything the mirror can't say leaves the branch unknown (null, which
  // the gate refuses with its own reason) and nothing carried. The one rule behind /merge and
  // /pr/carried. With `withConfig`, it gives the default branch's configuration read in the same fetch too
  // (`config`, undefined when it can't be read).
  async function gateRecords({ project, number, headSha, views, adapter, withApproval = true, compare = false, withConfig = false }, ctx) {
    const review = latestFor(views.reviews, number);
    const approval = withApproval ? latestFor(views.approvals, number) : null;
    const from = {
      review: review?.data?.verdict === 'CLEAN' && review.data.commit !== headSha ? review.data.commit : null,
      approval: approval !== null && approval.data?.commit !== headSha ? approval.data?.commit : null,
    };
    let facts = { upToDate: null, review: false, approval: false };
    try {
      const defaultBranch = await defaultBranchOf(project, adapter);
      facts = await carryFacts({ project, number, headSha, defaultBranch, from, withConfig }, ctx);
    } catch (error) {
      if (error instanceof LookRefusal) throw error;
      /* not readable: not known whether it is up to date, and nothing carries */
    }
    let shown = false;
    // With no approval needed, or under STOP, where the gate refuses anyway, nothing is compared
    // or photographed.
    if (compare && facts.approval === true && !stopped()) {
      try { shown = await pagesLookSame({ project, before: from.approval, after: headSha, pages: facts.pages }, ctx); } catch { /* not compared: asked again */ }
    }
    return {
      upToDate: facts.upToDate === null ? null : facts.upToDate === true,
      review: facts.review === true ? { carried: true, record: review } : review,
      approval: shown ? { carried: true, record: approval } : approval,
      ...(withConfig ? { config: facts.config } : {}),
    };
  }

  // Whether the head of an open pull request counts as reviewed, by the gate's own rule, and
  // whether it is up to date: for the watcher, which holds no keys. `earlier` says a verified CLEAN
  // review of an earlier commit of this pull request is on record, so a head that is not reviewed
  // had one that did not carry over (ruling R119). Read-only, so STOP lets it through.
  async function doCarried({ project, number }, ctx) {
    if (!Number.isInteger(number) || number < 1) refuse('the pull request number must be a whole number from 1');
    const adapter = await ctx.adapter();
    const pr = await adapter.prState(number);
    if (pr?.state !== 'open') return { ok: false, refused: `pull request ${number} is not open` };
    const skipped = [];
    const views = buildViews(listEvents(stateDir(project), { report: () => {}, skipped }), readEnrolled(), { damaged: skipped, now });
    const reviews = views.reviews?.[String(number)] ?? {};
    const cleanEarlier = Object.values(reviews).filter((r) => r?.data?.verdict === 'CLEAN' && r.data.commit !== pr.headSha);
    // With no CLEAN review as the latest, nothing counts and nothing can carry: the mirror is not
    // read, so the watcher's poll costs no fetch, and upToDate is not known (false).
    if (latestFor(views.reviews, number)?.data?.verdict !== 'CLEAN') return { ok: true, review: 'none', upToDate: false, earlier: cleanEarlier.length > 0 };
    const found = await gateRecords({ project, number, headSha: pr.headSha, views, adapter, withApproval: false, withConfig: true }, ctx);
    // Only a review of a kind the gate counts for the agent this computer runs (ruling P8-14), from the default
    // branch's configuration as the merge reads it (here from the same fetch, so the poll costs no second one): null,
    // today's rule, counts any kind.
    const kinds = reviewKindsOf(found.config !== undefined ? found.config : await defaultConfig(project, adapter, ctx));
    const counted = (record) => kinds === null || kinds.includes(record?.data?.reviewKind);
    const earlier = cleanEarlier.some(counted);
    const record = found.review?.carried === true ? found.review.record : found.review;
    const own = found.review?.data?.commit === pr.headSha && found.review?.data?.verdict === 'CLEAN';
    const clean = (found.review?.carried === true || own) && counted(record);
    return { ok: true, review: clean ? 'clean' : 'none', upToDate: found.upToDate === true, earlier };
  }

  // --- the signed review in a clean session (rulings P7-14 to P7-18) ---

  // The review module of the agent this computer runs for the project whose default-branch configuration is
  // `config`: `{ module }`, the module or null (an agent whose reviews aren't the helper's), or `{ unknown: true }`
  // when which agent runs here can't be told (the computer's id can't be read while the configuration names an
  // agent per computer, or the name is no agent's).
  function reviewModuleOf(config) {
    let id;
    try {
      id = computerId();
    } catch {
      const agents = config?.agents;
      if (agents !== null && typeof agents === 'object' && !Array.isArray(agents)) return { unknown: true };
    }
    try {
      return { module: reviewModules(agentOfConfig(config, { computerId: id })) };
    } catch {
      return { unknown: true };
    }
  }

  // The default branch's configuration, read by itself in the mirror, or undefined when it can't be read. A refusal
  // of the mirror's settings ends the request, as elsewhere.
  async function defaultConfig(project, adapter, ctx) {
    try {
      const defaultBranch = await defaultBranchOf(project, adapter);
      return await oneAtATime(`mirror:${project}`, () => inMirror(project, ctx, async ({ must }) => {
        await defaultHistory(must, defaultBranch);
        return baseConfig(must);
      }));
    } catch (error) {
      if (error instanceof LookRefusal) throw error;
      return undefined;
    }
  }

  // The review kinds the gate counts (ruling P7-15): null, today's rule, for an agent with no review module; the
  // module's own kinds; none where the agent can't be told or the module can't say.
  function reviewKindsOf(config) {
    const found = reviewModuleOf(config);
    if (found.unknown === true) return [];
    if (found.module === null) return null;
    try {
      const kinds = found.module.kinds();
      return Array.isArray(kinds) ? kinds : [];
    } catch {
      return [];
    }
  }

  // The most of a brief the reviewer is given.
  const BRIEF_BYTES = 64 * 1024;
  // The feature's brief as the state records it: the brief file in the worktree of the feature whose branch is the
  // pull request's head, taken only when its hash is the latest one the state records for that feature. Null
  // otherwise: the reviewer is then told no brief is recorded.
  function recordedBrief(project, headRef) {
    if (typeof headRef !== 'string' || headRef === '') return null;
    const found = new Map();
    const events = listEvents(stateDir(project), { report: () => {} }).filter((e) => e.kind === 'feature').sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    for (const e of events) {
      if (typeof e.data?.work !== 'string') continue;
      const f = found.get(e.data.work) ?? {};
      if (typeof e.data.branch === 'string') f.branch = e.data.branch;
      if (typeof e.data.worktree === 'string') f.worktree = e.data.worktree;
      if (typeof e.data.brief === 'string') f.brief = e.data.brief;
      found.set(e.data.work, f);
    }
    for (const f of found.values()) {
      if (f.branch !== headRef || typeof f.worktree !== 'string' || typeof f.brief !== 'string' || !path.isAbsolute(f.worktree)) continue;
      const text = readCapped(featurePaths(f.worktree).brief, BRIEF_BYTES);
      if (text !== null && briefHash(text) === f.brief) return text;
    }
    return null;
  }

  // The rules files the reviewer is given, read from the default branch's commit in the mirror (BASE_REF), never
  // from the pull request.
  const RULES_FILES = ['CLAUDE.md', 'AGENTS.md'];
  const RULES_BYTES = 256 * 1024;

  // Inside one fetch of the pull request in the mirror (ruling P7-16), `build({ files, read, diff, rules })`, for
  // runReview: each changed path's mode and size at the head (mode null when the change deletes it), a reader of a
  // path's bytes at the head, the diff from the merge base, and the rules files from the default branch. The pull
  // request's ref is removed after.
  function withChange({ project, number, headSha, defaultBranch }, ctx) {
    return (build) => oneAtATime(`mirror:${project}`, () => inMirror(project, ctx, async ({ mirror, keyed }) => {
      const git = local(mirror);
      const refusal = await mirrorRefusal(mirror, keyed);
      if (refusal) throw new Error(refusal);
      const prRef = `refs/wheelhouse/pr/${number}`;
      const must = async (args, what, options = {}) => {
        const answer = await git([...NO_HOOKS, ...args], options);
        if (answer.code !== 0) throw new Error(`${what} failed`);
        return answer.stdout;
      };
      try {
        await fetchPr({ mirror, keyed, git, number, headSha, defaultBranch, project });
        const base = (await must(['merge-base', BASE_REF, headSha], 'finding the merge base')).trim();
        const paths = (await must(['diff', '--name-only', '-z', '--no-renames', base, headSha], 'listing the changed files')).split('\0').filter((p) => p !== '');
        const files = [];
        for (const file of paths) {
          const listed = await must(['--literal-pathspecs', 'ls-tree', '-l', '-z', headSha, '--', file], 'looking for a changed file');
          const entry = /^(\d{6}) (\w+) [0-9a-f]+ +(-|\d+)\t([^\0]*)\0/.exec(listed);
          // Only the entry for this very path counts; any other answer is read as the path being absent at the head.
          files.push(entry && entry[4] === file ? { path: file, mode: entry[1], size: entry[3] === '-' ? null : Number(entry[3]) } : { path: file, mode: null, size: null });
        }
        const read = (file) => must(['cat-file', 'blob', `${headSha}:${file}`], 'reading a changed file', { encoding: 'buffer' });
        const diff = await must(['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', base, headSha], 'working out the diff');
        const rules = [];
        for (const file of RULES_FILES) {
          const listed = await must(['ls-tree', '-l', '-z', BASE_REF, '--', file], 'looking for a rules file');
          const entry = /^100\d{3} blob [0-9a-f]+ +(\d+)\t/.exec(listed);
          if (entry && Number(entry[1]) <= RULES_BYTES) rules.push({ path: file, text: await must(['cat-file', 'blob', `${BASE_REF}:${file}`], 'reading a rules file') });
        }
        return await build({ files, read, diff, rules });
      } finally {
        await git([...NO_HOOKS, 'update-ref', '-d', prRef]);
      }
    }));
  }

  // A plain note about a review, through the state's queue. Nothing is written under STOP.
  async function reviewNote(project, text, ctx) {
    if (stopped()) return;
    try {
      await oneAtATime(`state:${project}`, async () => {
        await ensureStateClone(project, ctx);
        if (stopped()) return;
        await doWrite({ project, kind: 'note', data: { text } }, ctx);
      });
    } catch { /* a note is not worth failing for */ }
  }

  // The review itself, in the background (ruling P7-18): the folder, the session, and the signed `review` record
  // with `reviewKind`, written when the session ran clean, its verdict counts, the head hasn't moved and STOP is
  // off; otherwise a plain note naming the reason.
  async function reviewJob({ project, number, pr, defaultBranch, module }, ctx) {
    const headSha = pr.headSha;
    const short = headSha.slice(0, 7);
    let outcome;
    try {
      const adapter = await ctx.adapter();
      const ci = await adapter.ciState(headSha);
      outcome = await runReview({
        number, sha: headSha, review: module, brief: recordedBrief(project, pr.headRef), ci, stopped,
        withChange: withChange({ project, number, headSha, defaultBranch }, ctx),
      });
      // A STOP raised after the route answered starts no agent, and nothing is written.
      if (outcome.stopped === true) return;
      if (outcome.ok) {
        const still = await adapter.prState(number);
        if (still?.state !== 'open' || still.headSha !== headSha) outcome = { ok: false, why: 'the head moved, or the pull request closed, while it was reviewed' };
      }
    } catch (error) {
      outcome = { ok: false, why: clean(error instanceof Error ? error.message : '', ctx.secrets) || 'the review could not be run' };
    }
    if (!outcome.ok) {
      await reviewNote(project, `${NO_CLEAN_REVIEW(short)}: ${outcome.why}.`, ctx);
      return;
    }
    if (stopped()) return;
    try {
      await oneAtATime(`state:${project}`, async () => {
        await ensureStateClone(project, ctx);
        if (stopped()) return;
        const event = makeEvent({ kind: 'review', data: outcome.data, now });
        await writeEvent({ project, event, push: statePush(project, ctx), env: ctx.gitEnv, now });
        await freshViews(() => writeViews(project, { now }));
      });
    } catch {
      await reviewNote(project, `The clean review of ${short} passed, but its signed record could not be written.`, ctx);
    }
  }

  // The most failed runs of the helper's review a head may have (ruling P8-14).
  const MOST_FAILED_REVIEWS = 3;
  // Why the head `headSha` of pull request `number` gets no further review from the helper (ruling P8-14), or null:
  // a signed `review` record of it, whatever its verdict or kind, or MOST_FAILED_REVIEWS notes of failed runs (the
  // notes reviewJob writes, which begin with NO_CLEAN_REVIEW for the head). So a commit is reviewed once, and a run
  // that fails is tried again only up to the limit: a fix needs a new commit.
  function reviewSpent(project, number, headSha) {
    const events = listEvents(stateDir(project), { report: () => {} });
    const views = buildViews(events, readEnrolled(), { damaged: [], now });
    const short = headSha.slice(0, 7);
    if (views.reviews?.[String(number)]?.[headSha] !== undefined) return `${short} has a signed review already`;
    const failed = events.filter((e) => e.kind === 'note' && typeof e.data?.text === 'string' && e.data.text.startsWith(`${NO_CLEAN_REVIEW(short)}: `));
    return failed.length >= MOST_FAILED_REVIEWS ? `the review of ${short} has failed ${failed.length} times` : null;
  }

  // POST /review/run { project, number } (ruling P7-18): the helper's own reviewer, in a clean session, of the open
  // pull request's head. Refused under STOP (it starts an agent), for an agent whose reviews aren't the helper's,
  // while the agent's clean session isn't switched on, and for a head that has had its review (reviewSpent: one review
  // per commit). One review at a time per project: answered at once with
  // `started`, or `running` when one is under way; the review finishes in the background.
  async function doReviewRun({ project, number }, ctx) {
    if (stopped()) return STOP_REFUSAL;
    if (!Number.isInteger(number) || number < 1) refuse('the pull request number must be a whole number from 1');
    const key = `review:${project}`;
    if (queues.has(key)) return { ok: true, running: true };
    const adapter = await ctx.adapter();
    const pr = await adapter.prState(number);
    if (pr?.state !== 'open') return { ok: false, refused: `pull request ${number} is not open` };
    if (typeof pr.headSha !== 'string' || !/^[0-9a-f]{40}$/.test(pr.headSha)) refuse('the head commit is not known');
    const defaultBranch = await defaultBranchOf(project, adapter);
    const config = await oneAtATime(`mirror:${project}`, () => inMirror(project, ctx, async ({ must }) => {
      await defaultHistory(must, defaultBranch);
      return baseConfig(must);
    }));
    const found = reviewModuleOf(config);
    if (found.unknown === true) return { ok: false, refused: "which agent this project runs on this computer can't be told, so no review is started" };
    if (found.module === null) return { ok: false, refused: "this project's agent reviews in its own session, not the helper's" };
    if (found.module.ready() !== true) return { ok: false, refused: "the helper's clean review session isn't switched on for this agent yet" };
    const spent = reviewSpent(project, number, pr.headSha);
    if (spent !== null) return { ok: false, refused: `${spent}; one review per commit: a fix needs a new commit` };
    if (stopped()) return STOP_REFUSAL;
    if (queues.has(key)) return { ok: true, running: true };
    oneAtATime(key, () => reviewJob({ project, number, pr, defaultBranch, module: found.module }, ctx)).catch(() => {});
    return { ok: true, started: true };
  }

  // Brings an open pull request's branch up to date with the default branch (design section 12):
  // in the mirror, `git merge-tree --write-tree` of the head and the default branch; when clean
  // and the head is behind, a merge commit of the two, pushed to the pull request's branch with
  // the connection's key through the push rules. A CI file arriving from the default branch is
  // not the branch's own change, since the rules compare with the merge base. Refused under STOP,
  // and for any pull request but a feature branch of this repository against the default branch.
  //
  // The merge commit is the same commit each time it is built from the same two parents: Wheelhouse
  // as author and committer, and both dates the later of the parents' committer dates (ruling R118).
  // So when the branch's own changes touch a CI file, the refusal names that commit (`ciPush`)
  // and keeps the pending entry its card needs; once the director clicks it, the next call builds
  // the same commit again and pushes it with their own sign-in, as /push does.
  async function doUpdateBranch({ project, number }, ctx) {
    if (stopped()) return STOP_REFUSAL;
    if (!Number.isInteger(number) || number < 1) refuse('the pull request number must be a whole number from 1');
    if (bypassActive({ now })) return { ok: false, refused: BYPASS_PUSH };
    const adapter = await ctx.adapter();
    const pr = await adapter.prState(number);
    if (pr?.state !== 'open') return { ok: false, refused: `pull request ${number} is not open` };
    if (typeof pr.headSha !== 'string' || !FULL_SHA.test(pr.headSha)) refuse('the head commit is not known');
    const defaultBranch = await defaultBranchOf(project, adapter);
    if (pr.baseRef !== defaultBranch) return { ok: false, refused: UPDATE_REFUSALS.base };
    const spelled = checkRefspec(pr.headRef, defaultBranch);
    if (!spelled.allowed) return { ok: false, refused: spelled.refused };
    const { branch } = spelled;
    if (branch === STATE_BRANCH || branch === LOCK_BRANCH) return { ok: false, refused: PUSH_REFUSALS.ownRequests };
    if (!FEATURE_BRANCH.test(branch)) return { ok: false, refused: UPDATE_REFUSALS.branch };
    if (!(await lockHeld(project, ctx))) return { ok: false, refused: LOCK_REASON };
    const made = await oneAtATime(`mirror:${project}`, () => inMirror(project, ctx, async ({ mirror, keyed }) => {
      const git = local(mirror);
      const refusal = await mirrorRefusal(mirror, keyed);
      if (refusal) return { refused: refusal };
      const prRef = `refs/wheelhouse/pr/${number}`;
      try {
        await fetchPr({ mirror, keyed, git, number, headSha: pr.headSha, defaultBranch, project });
        // A fork's pull request names a branch of the fork: the push would land on this
        // repository's branch of the same name. Only a head that is that branch is brought up to date.
        const listed = await keyed('git', [...NO_HOOKS, 'ls-remote', '--heads', REMOTE, `refs/heads/${branch}`], { cwd: mirror, input: '' });
        if (listed.code !== 0) throw new Error('reading the branch on the host failed');
        if (listed.stdout.trim().split(/\s+/)[0] !== pr.headSha) return { refused: UPDATE_REFUSALS.fork };
        const onTop = await git([...NO_HOOKS, 'merge-base', '--is-ancestor', BASE_REF, pr.headSha]);
        if (onTop.code === 0) return { current: true };
        if (onTop.code !== 1) throw new Error('comparing the branch with the default branch failed');
        const merged = await git([...MERGE_ONLY, 'merge-tree', '--write-tree', '--name-only', '-z', '--no-messages', pr.headSha, BASE_REF]);
        if (merged.code === 1) return { conflicts: merged.stdout.split('\0').slice(1).filter((name) => name !== '') };
        if (merged.code !== 0) throw new Error('git could not merge the default branch in');
        const tree = merged.stdout.split('\0')[0].trim();
        const base = (await git([...NO_HOOKS, 'rev-parse', '--verify', `${BASE_REF}^{commit}`])).stdout.trim();
        const commit = await mergeCommit(git, tree, pr.headSha, base, `Merge ${defaultBranch} into ${branch}`);
        const kept = await git([...NO_HOOKS, 'update-ref', `refs/heads/${branch}`, commit]);
        if (kept.code !== 0) throw new Error('keeping the merge commit failed');
        return { commit, mirror };
      } finally {
        await git([...NO_HOOKS, 'update-ref', '-d', prRef]);
      }
    }));
    if (made.refused) return { ok: false, refused: made.refused };
    if (made.conflicts) return { ok: false, refused: 'the branch conflicts with the default branch', conflicts: made.conflicts };
    if (made.current) return { ok: true, updated: false, head: pr.headSha };
    try {
      const pushed = await pushFrom({ project, branch, source: made.mirror, refspec: branch, defaultBranch, ciGuard: true }, ctx);
      if (pushed.rejected) return { ok: false, refused: 'the branch moved on the host while it was being brought up to date' };
      if (!pushed.ok && pushed.refused === PUSH_REFUSALS.ciFile) {
        // The card for this exact commit, which the next call builds again.
        writePending(project, { branch, sha: made.commit, at: now().toISOString() });
        return { ok: false, refused: pushed.refused, ciPush: { branch, sha: made.commit } };
      }
      if (!pushed.ok) return pushed;
    } finally {
      await oneAtATime(`mirror:${project}`, () => unkeyed('git', ['update-ref', '-d', `refs/heads/${branch}`], { cwd: made.mirror }));
    }
    return { ok: true, updated: true, head: made.commit };
  }

  // A merge commit the helper makes in the mirror, of `tree`, with `first` and `second` as its
  // parents: Wheelhouse as author and committer, and both dates the later of the parents'
  // committer dates, so the same two parents always give the same commit (ruling R118). Its id.
  async function mergeCommit(git, tree, first, second, message) {
    const dated = await git([...NO_HOOKS, 'log', '--no-walk', '--format=%ct', first, second]);
    const seconds = dated.stdout.split('\n').filter((l) => /^\d+$/.test(l.trim())).map(Number);
    if (dated.code !== 0 || seconds.length !== 2) throw new Error('reading the commits\' dates failed');
    const at = `${Math.max(...seconds)} +0000`;
    const commit = await git([...NO_HOOKS, 'commit-tree', '--no-gpg-sign', tree, '-p', first, '-p', second, '-m', message], {
      env: { ...WHEELHOUSE_AUTHOR, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at },
    });
    if (commit.code !== 0 || !FULL_SHA.test(commit.stdout.trim())) throw new Error('making the merge commit failed');
    return commit.stdout.trim();
  }

  async function doMerge(body, ctx) {
    try {
      return await mergeAnswer(body, ctx);
    } finally {
      if (typeof body?.project === 'string') {
        await oneAtATime(`mirror:${body.project}`, () => dropRequestRefs(body.project, ctx));
        tidyAfterAnswer(body.project, ctx);
      }
    }
  }

  // Pulls the project's state clone, and pushes what it holds that the host lacks, as /state/sync
  // does. Whether the pull went through.
  async function stateFresh(project, ctx) {
    await lookAtState(ctx, project); // a refusal ends the request, never a quiet "not fresh"
    try {
      return await oneAtATime(`state:${project}`, async () => (
        (await syncState({ project, push: pushFor(project, ctx), env: ctx.gitEnv })).pulled === true
      ));
    } catch {
      return false;
    }
  }

  async function mergeAnswer(body, ctx) {
    const { project, number } = body;
    if (!Number.isInteger(number) || number < 1) refuse('the pull request number must be a whole number from 1');
    // The state clone and the mirror are looked at before any git runs in either; a refusal answers here.
    await lookAtState(ctx, project);
    await lookAtMirror(ctx, project);
    const adapter = await ctx.adapter();
    const pr = await adapter.prState(number);
    if (pr?.state !== 'open') {
      return { ok: false, refused: `pull request ${number} is not open`, reasons: [`pull request ${number} is not open`], guardrailPaths: [], criticalAreas: [] };
    }
    const headSha = pr.headSha;
    // The restore pull request of the runbook's step 3 needs no review, and under STOP it is the
    // only merge that goes on (Rulings 42 and 47). When it is named like one but a check fails,
    // the answer says which.
    let restoreCheck = { matched: false };
    try {
      restoreCheck = await isRestoreMerge({ project, number, pr }, ctx);
    } catch (error) {
      if (error instanceof LookRefusal) throw error;
      restoreCheck = { matched: RESTORE_BRANCH.test(typeof pr.headRef === 'string' ? pr.headRef : ''), ok: false, why: 'it could not be checked' };
    }
    const restore = restoreCheck.ok === true;
    // The helper works out the guardrail and approval conditions from the
    // changed files; the caller may only raise them. If the files can't be
    // read, the change counts as touching the guardrails.
    let classified = { touchesGuardrails: true, guardrailPaths: [], criticalAreas: [] };
    let readable = true;
    let changes = null;
    try {
      const defaultBranch = await defaultBranchOf(project, adapter);
      changes = await readChanges({ project, number, headSha, defaultBranch }, ctx);
      classified = classifyChange({ paths: changes.paths, config: changes.config });
    } catch (error) {
      if (error instanceof LookRefusal) throw error;
      readable = false;
    }
    // A pins-only Wheelhouse release needs the review but not the director's approval: it lowers
    // that one condition and nothing else (design section 14.4).
    let releaseCheck = { matched: false };
    if (readable && !restore) {
      try {
        releaseCheck = await isPinsOnlyRelease({ pr, changes }, ctx);
      } catch (error) {
        if (error instanceof LookRefusal) throw error;
        releaseCheck = { matched: true, ok: false, why: 'it could not be checked' };
      }
    }
    const pinsOnly = releaseCheck.ok === true;
    // A restore is a release that passed review before; the director's approval stands in for it.
    const touchesGuardrails = (!restore && !pinsOnly && classified.touchesGuardrails) || body.touchesGuardrails === true;
    const found = { guardrailPaths: classified.guardrailPaths, criticalAreas: classified.criticalAreas };
    const release = pinsOnly ? { release: { kind: 'pins-only', ref: releaseCheck.ref, sha: releaseCheck.sha } } : {};
    const ci = await adapter.ciState(headSha);
    // The state clone is brought up to date first, so an incident declared on another computer is
    // seen (Ruling 115); when it can't be, the merge waits, a restore excepted, since the runbook
    // restores the product (step 3) before the state (step 4) (Ruling 116).
    const stateReasons = [];
    if (!(await stateFresh(project, ctx)) && !restore) stateReasons.push(STATE_BEHIND);
    const skipped = [];
    const enrolled = readEnrolled();
    const views = buildViews(listEvents(stateDir(project), { report: () => {}, skipped }), enrolled, { damaged: skipped, now });
    // A damaged event is dropped from the views, and a dropped incident or approval of work reads as
    // nothing to do, so with any damage only a restore goes on (Ruling 114). A reply-code clash is
    // listed with the damage but hides neither, so it doesn't count.
    const clashes = new Set(views.codeClashes);
    if (views.damaged.some((d) => !clashes.has(d)) && !restore) stateReasons.push(STATE_DAMAGED);
    // Work shown first needs the director's approval of the pull request. When the changed files
    // couldn't be read, the change already counts as touching the guardrails.
    const shownFirst = readable && shownFirstNeeded({ views, headRef: pr.headRef, paths: changes.paths, config: changes.config });
    const approvalRequired = body.approvalRequired === true || touchesGuardrails || restore || shownFirst;
    const holdsLock = await lockHeld(project, ctx);
    const { upToDate, review, approval } = await gateRecords({ project, number, headSha, views, adapter, compare: approvalRequired }, ctx);
    // The kinds of review that count for the agent this computer runs, from the default branch's configuration:
    // null, today's rule, unless the agent's review module names them (ruling P7-15). The configuration doesn't
    // depend on the pull request's files, so when those couldn't be read it is read by itself; only when the
    // default branch's configuration itself can't be read does today's rule stand (the approval is then needed
    // anyway, since unreadable changes count as touching the guardrails).
    const reviewKinds = reviewKindsOf(changes?.config ?? await defaultConfig(project, adapter, ctx));
    // STOP and bypass are read last, just before the decision, so one set during the
    // fetches above is seen. The caller may only raise them.
    const decision = gateDecision({
      stop: (stopped() && !restore) || body.stop === true,
      bypass: bypassActive({ now }) || body.bypass === true,
      holdsLock,
      headSha,
      ci,
      // Every merge needs a review; the caller may only add the approval and guardrail conditions.
      reviewRequired: !restore,
      approvalRequired,
      touchesGuardrails,
      review,
      reviewKinds,
      approval,
      enrolled,
      upToDate,
      incident: incidentFor(views, number),
      // The block /pr/open stamped, against this Wheelhouse's own manifest. A verified restore
      // has none: it puts back a release that merged before (Ruling 105).
      provenance: restore ? { ok: true } : bodyProvenance(pr.body, pluginRoot),
    });
    if (!decision.allow || stateReasons.length > 0) {
      const said = restoreCheck.matched && !restore ? [`restore pull request: ${restoreCheck.why}`] : [];
      const reasons = [...said, ...stateReasons, ...(readable ? decision.reasons : [...decision.reasons, UNREADABLE_CHANGES])];
      // Why a release pull request needs the director's approval goes in its own field, not the
      // reasons: it is why the approval is needed, not another condition unmet, so a release
      // lacking only the approval still waits for the click (rulings R117, R148).
      const releaseLine = releaseCheck.matched && !pinsOnly ? `release pull request, so it needs the director's approval: ${releaseCheck.why}` : null;
      // What the director's click can supply, by name, so the foreman can wait for that click
      // rather than ask (ruling R117). The reasons still list every condition that failed.
      const needs = decision.approvalMissing === true ? { needs: { approval: { pr: number, commit: headSha } } } : {};
      return {
        ok: false,
        refused: [...(releaseLine === null ? [] : [releaseLine]), ...reasons].join('; '),
        reasons,
        ...(releaseLine === null ? {} : { releaseApproval: releaseLine }),
        ...needs,
        ...found,
        ...release,
      };
    }
    if (stopped() && !restore) {
      const reasons = [...(restoreCheck.matched ? [`restore pull request: ${restoreCheck.why}`] : []), 'STOP is on'];
      return { ok: false, refused: reasons.join('; '), reasons, ...found };
    }
    const merged = await adapter.merge({ number, sha: headSha });
    if (merged?.unreachable === true) awayLog.set(project, gitlabBaseOf(recordOf(project)));
    else if (merged?.merged === true) awayLog.clear(project);
    // The front desk adds the briefing line for a pins-only release.
    if (merged?.merged === true) return { ok: true, merged: true, sha: headSha, ...found, ...(pinsOnly ? { ...release, briefing: briefingLine(releaseCheck.ref) } : {}) };
    // On GitLab a project with real users is merged by Maintainers only, which refuses this key; the
    // adapter's plain refusal is given its reason and what to do.
    const reason = merged?.reason === NOT_ALLOWED_TO_MERGE && recordOf(project).host === 'gitlab' ? GITLAB_MAINTAINERS_ONLY : merged?.reason;
    return { ok: false, refused: reason || 'the host did not merge the pull request', ...found };
  }

  // Records a CI push the director may be asked about, one entry per branch,
  // for the hook that turns a click into a full commit. Written whole.
  function writePending(project, entry) {
    const file = path.join(stateDir(project), '..', 'ci-pending.json');
    let pending = {};
    try {
      const read = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (read && typeof read === 'object' && !Array.isArray(read)) pending = read;
    } catch { /* none yet, or unreadable: start again */ }
    pending[entry.branch] = entry;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temp, `${JSON.stringify(pending, null, 2)}\n`);
      fs.renameSync(temp, file);
    } catch (error) {
      fs.rmSync(temp, { force: true });
      throw error;
    }
    return { ok: true, line: ciPushLine(entry.branch, entry.sha) };
  }


  // --- the runbook (design section 12.7) ---
  // These routes answer under STOP. Each step but the first needs the director's
  // click on its card: a signed `action` for that step, from this computer.

  // The director's clicks on record for this runbook step, newest first: signed here, no older
  // than `maxAgeMs`, and for the same commit when `sha12` is given.
  function runbookClicks(project, step, { sha12, maxAgeMs = CLICK_MS } = {}) {
    const enrolled = readEnrolled();
    const nowMs = now().getTime();
    return listEvents(stateDir(project), { report: () => {} }).filter((e) => {
      const age = nowMs - Date.parse(e.at);
      return e.kind === 'action' && e.data?.action === 'runbook' && e.data.step === step
        && (sha12 === undefined || e.data.sha === sha12)
        && e.computer === computerId() && e.sig?.computer === computerId() && verify(e, enrolled)
        && age <= maxAgeMs && age >= -60 * 1000;
    }).reverse();
  }
  const runbookClick = (project, step, options) => runbookClicks(project, step, options).length > 0;

  // Uses one click, once: a marker named for the click's event, made exclusively.
  function useClick(project, step) {
    const folder = path.join(stateDir(project), '..', 'runbook-used');
    fs.mkdirSync(folder, { recursive: true });
    for (const e of runbookClicks(project, step)) {
      if (!/^[A-Za-z0-9-]{1,64}$/.test(e.id)) continue;
      try {
        fs.writeFileSync(path.join(folder, e.id), `${now().toISOString()}\n`, { flag: 'wx' });
        return true;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
    return false;
  }
  // A step that uses its click once (steps 2, 4 and 5), and, with no sign-in at all, says so.
  const clicked = (step, fn) => (body, ctx) => (useClick(body.project, step) ? fn(body, ctx) : { ok: false, refused: NEEDS_CLICK });
  // Wraps a runbook route: where the key is gone and the director's sign-in is missing too, a
  // refusal from the host reads as the sign-in refusal.
  const signedIn = (fn) => async (body, ctx) => {
    let answer;
    try {
      answer = await fn(body, ctx);
    } catch (error) {
      if (ctx.signedOut && AUTH_FAILURE.test(error instanceof Error ? error.message : '')) refuse(PUSH_REFUSALS.ciSignIn);
      throw error;
    }
    if (ctx.signedOut && answer?.ok === false && AUTH_FAILURE.test(String(answer.refused ?? ''))) return { ok: false, refused: PUSH_REFUSALS.ciSignIn };
    return answer;
  };

  // A runner for git in the mirror with the connection's key.
  async function inMirror(project, ctx, fn) {
    const mirror = await mirrorFor(project, ctx);
    const keyed = keyedFor(ctx);
    const must = async (args, what) => {
      const answer = await keyed('git', args, { cwd: mirror, input: '' });
      if (answer.code !== 0) throw new Error(ctx.signedOut && AUTH_FAILURE.test(answer.stderr) ? PUSH_REFUSALS.ciSignIn : `${what} failed`);
      return answer.stdout;
    };
    return fn({ mirror, keyed, must });
  }

  // Fetches the default branch into BASE_REF; resolves with its head commit and its first-parent history, newest first.
  async function defaultHistory(must, defaultBranch) {
    if (!plainBranch(defaultBranch)) throw new Error('the default branch is not known');
    await must(['fetch', '-q', '--no-tags', REMOTE, `+refs/heads/${defaultBranch}:${BASE_REF}`], 'fetching the default branch');
    const listed = await must(['rev-list', '--first-parent', BASE_REF], 'reading the default branch\'s history');
    const history = listed.split('\n').map((l) => l.trim()).filter(Boolean);
    return { head: history[0], history };
  }

  // Whether this pull request is the restore of step 3 (Rulings 42, 47): its head branch is
  // wheelhouse-restore-<sha12>; its base is the default branch; the director's step 3 click for
  // that commit is under a day old; the head commit's tree is that release's tree; and the head
  // sits on top of the default branch, so merging gives that tree. Resolves with
  // `{ matched: false }` for any other pull request, else `{ matched: true, ok, why }`.
  async function isRestoreMerge({ project, number, pr }, ctx) {
    const named = RESTORE_BRANCH.exec(typeof pr.headRef === 'string' ? pr.headRef : '');
    if (!named) return { matched: false };
    const no = (why) => ({ matched: true, ok: false, why });
    if (typeof pr.headSha !== 'string' || !/^[0-9a-f]{40,64}$/.test(pr.headSha)) return no('its head is not known');
    const sha12 = named[1];
    if (!runbookClick(project, 3, { sha12, maxAgeMs: RESTORE_MS })) return no('no step 3 click from the last 24 hours names this release');
    const adapter = await ctx.adapter();
    const defaultBranch = await defaultBranchOf(project, adapter);
    if (pr.baseRef !== defaultBranch) return no('its base is not the default branch');
    const source = recordOf(project).host === 'gitlab' ? `refs/merge-requests/${number}/head` : `refs/pull/${number}/head`;
    const prRef = `refs/wheelhouse/pr/${number}`;
    return oneAtATime(`mirror:${project}`, () => inMirror(project, ctx, async ({ must, keyed, mirror }) => {
      try {
        const { history } = await defaultHistory(must, defaultBranch);
        await must(['fetch', '-q', '--no-tags', REMOTE, `+${source}:${prRef}`], 'fetching the pull request');
        const fetched = (await must(['rev-parse', '--verify', '--end-of-options', `${prRef}^{commit}`], 'reading the fetched head')).trim();
        if (fetched !== pr.headSha) return no('its head has moved since the host reported it');
        const target = history.slice(1).find((c) => c.startsWith(sha12));
        if (!target) return no('the release is not an earlier commit of the default branch');
        const [want, have] = await Promise.all([
          must(['rev-parse', '--verify', `${target}^{tree}`], 'reading the release'),
          must(['rev-parse', '--verify', `${pr.headSha}^{tree}`], 'reading the head'),
        ]);
        if (want.trim() !== have.trim()) return no('its files are not the chosen release\'s files');
        const onTop = await keyed('git', ['merge-base', '--is-ancestor', BASE_REF, pr.headSha], { cwd: mirror });
        return onTop.code === 0 ? { matched: true, ok: true } : no('its head is not on top of the default branch');
      } catch (error) {
        return no(error instanceof Error && error.message === PUSH_REFUSALS.ciSignIn ? PUSH_REFUSALS.ciSignIn : 'it could not be checked against the host');
      } finally {
        await keyed('git', ['update-ref', '-d', prRef], { cwd: mirror });
      }
    }));
  }

  const plainAnswer = (text, rest = {}) => ({ ok: true, message: text, ...rest });

  // Step 2: the agents' keys taken away from this computer (scripts/host/cut-access.js, shared with
  // uninstall, ruling R88).
  const doCutAccess = ({ project }) => cutAccess({ record: recordOf(project), fetch });

  // Step 3, the first half: a pull request that puts the product back to an earlier release.
  async function doRestoreMain({ project, sha }, ctx) {
    if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/.test(sha)) refuse('the commit must be given as a full 40-character ID');
    const sha12 = sha.slice(0, 12);
    if (!runbookClick(project, 3, { sha12 })) return { ok: false, refused: NEEDS_CLICK };
    const adapter = await ctx.adapter();
    const defaultBranch = await defaultBranchOf(project, adapter);
    const branch = `${RESTORE_PREFIX}${sha12}`;
    const onGithub = recordOf(project).host === 'github';
    const made = await oneAtATime(`mirror:${project}`, () => inMirror(project, ctx, async ({ mirror, keyed, must }) => {
      const { head, history } = await defaultHistory(must, defaultBranch);
      if (sha === head || !history.includes(sha)) return { refused: NOT_EARLIER };
      if (history.indexOf(sha) > 10) return { refused: NOT_AMONG };
      const tree = (await must(['rev-parse', '--verify', `${sha}^{tree}`], 'reading the release')).trim();
      if (tree === (await must(['rev-parse', '--verify', `${head}^{tree}`], 'reading the default branch')).trim()) {
        return { refused: 'the default branch already holds exactly those files' };
      }
      const commit = await keyed('git', ['commit-tree', tree, '-p', head, '-m', `Put the product back to release ${sha12}`], {
        cwd: mirror, input: '', env: { ...WHEELHOUSE_AUTHOR, GIT_AUTHOR_DATE: now().toISOString(), GIT_COMMITTER_DATE: now().toISOString() },
      });
      if (commit.code !== 0) throw new Error('making the restore commit failed');
      await must(['update-ref', `refs/heads/${branch}`, commit.stdout.trim()], 'keeping the restore commit');
      // A CI file in the change: GitHub's app key may not push one, so the director's own sign-in does.
      let ci = true;
      try {
        const changes = await branchChanges({ mirror, sha: commit.stdout.trim(), defaultBranch, run: keyed });
        ci = touchesCi(changes.paths, changes.config);
      } catch { /* unreadable: counted as a CI change */ }
      return { commit: commit.stdout.trim(), mirror, ci };
    }));
    if (made.refused) return { ok: false, refused: made.refused };
    try {
      const pushed = await pushFrom({
        project, branch, source: made.mirror, refspec: branch, defaultBranch, allowStop: true, asDirector: onGithub && made.ci,
      }, ctx);
      if (!pushed.ok) {
        return { ok: false, refused: pushed.rejected ? `the branch ${branch} is already on the host with other contents: open its pull request, or ask the director to remove the branch` : pushed.refused };
      }
    } finally {
      await unkeyed('git', ['update-ref', '-d', `refs/heads/${branch}`], { cwd: made.mirror });
    }
    const opened = await adapter.openPr({
      head: branch,
      base: defaultBranch,
      title: `Put the product back to release ${sha12}`,
      body: `This puts the files back to exactly what they were at commit ${sha}. The director clicked the runbook's step 3 card for it.`,
    });
    return {
      ok: true, number: opened.number, url: opened.url, branch, head: made.commit,
      message: `Pull request ${opened.number} is open: it puts the files back to release ${sha12}. Next, the director approves it on its card; once CI has passed, the merge follows.${onGithub && made.ci ? ' This release changes CI files, so the branch was pushed with your own sign-in, and the merge will need your own sign-in too.' : ''}`,
    };
  }

  // Step 3, the second half: the merge, through the same gate as any other (it lets STOP pass for this branch only).
  async function doRestoreMerge(body, ctx) {
    const { project, number } = body;
    if (!Number.isInteger(number) || number < 1) refuse('the pull request number must be a whole number from 1');
    const pr = await (await ctx.adapter()).prState(number);
    if (!RESTORE_BRANCH.test(typeof pr?.headRef === 'string' ? pr.headRef : '')) refuse('that pull request is not a restore pull request');
    // On GitHub the app's key may not merge a change to CI files, as it may not push one: the
    // director's own sign-in does, with the same adapter call.
    let ci = false;
    if (recordOf(project).host === 'github' && !ctx.signedOut) {
      try {
        const defaultBranch = await defaultBranchOf(project, await ctx.adapter());
        const changes = await readChanges({ project, number, headSha: pr.headSha, defaultBranch }, ctx);
        ci = touchesCi(changes.paths, changes.config);
      } catch (error) {
        if (error instanceof LookRefusal) throw error;
        ci = true; // unreadable: counted as a CI change
      }
    }
    if (!ci) return doMerge({ project, number }, ctx);
    let own = null;
    const director = {
      ...ctx,
      mode: 'quick',
      env: {},
      gitEnv: companyGit(gitEnvOf('quick', {}, readProject(project)?.host, readProject(project)?.remoteUrl), readProject(project)),
      reach: reachFor(readProject(project)?.remoteUrl),
      signedOut: true,
      adapter: async () => {
        own ??= Promise.resolve(adapterFor(project, { env: {}, envFor: async () => ({}), now }));
        return own;
      },
    };
    try {
      const answer = await doMerge({ project, number }, director);
      if (answer.ok === false && AUTH_FAILURE.test(String(answer.refused ?? ''))) return { ok: false, refused: PUSH_REFUSALS.ciSignIn };
      return answer;
    } catch (error) {
      if (AUTH_FAILURE.test(error instanceof Error ? error.message : '')) return { ok: false, refused: PUSH_REFUSALS.ciSignIn };
      throw error;
    }
  }

  // Step 4: the newest backup's events that the state branch lacks, added back and pushed.
  async function doRestoreState({ project }, ctx) {
    const folder = path.join(profileDir(), 'backups', project);
    let names = [];
    try { names = fs.readdirSync(folder).filter((f) => BACKUP_FILE.test(f)).sort(); } catch { /* none */ }
    if (names.length === 0) return { ok: false, refused: 'there is no backup of this project\'s records on this computer' };
    const bundle = path.join(folder, names.at(-1));
    return oneAtATime(`state:${project}`, async () => {
      await ensureStateClone(project, ctx);
      const dir = stateDir(project);
      // A bundle is a file on this computer, so these steps allow a local path whatever the remote is.
      const plain = (args) => stateGit(dir, args, LOCAL_PATHS);
      if ((await plain(['bundle', 'verify', bundle])).code !== 0) return { ok: false, refused: 'the newest backup could not be verified, so nothing was put back' };
      let fetched = await plain(['fetch', '-q', '--no-tags', bundle, `+refs/heads/${STATE_BRANCH}:${BACKUP_REF}`]);
      if (fetched.code !== 0) fetched = await plain(['fetch', '-q', '--no-tags', bundle, `+refs/remotes/${REMOTE}/${STATE_BRANCH}:${BACKUP_REF}`]);
      if (fetched.code !== 0) return { ok: false, refused: 'the newest backup could not be read, so nothing was put back' };
      try {
        const reached = { ...ctx.gitEnv, ...reachEnv(recordOf(project).remoteUrl) };
        const pulled = await stateGit(dir, ['pull', '--rebase', REMOTE, STATE_BRANCH], reached);
        if (pulled.code !== 0) await stateGit(dir, ['rebase', '--abort'], reached);
        const listedAt = async (rev) => {
          const listed = await plain(['ls-tree', '-r', '-z', '--name-only', rev, '--', 'events/']);
          if (listed.code !== 0) throw new Error('listing the events failed');
          return listed.stdout.split('\0').filter(Boolean);
        };
        const have = new Set(await listedAt('HEAD'));
        const enrolled = readEnrolled();
        const added = [];
        let skipped = 0;
        for (const file of (await listedAt(BACKUP_REF)).filter((f) => !have.has(f))) {
          const read = await plain(['show', `${BACKUP_REF}:${file}`]);
          let event = null;
          try { event = JSON.parse(read.stdout); } catch { /* skipped below */ }
          const sound = read.code === 0 && EVENT_FILE.test(file) && event && typeof event === 'object' && !Array.isArray(event)
            && typeof event.id === 'string' && typeof event.at === 'string' && typeof event.kind === 'string' && typeof event.computer === 'string'
            && (PLAIN_KINDS.includes(event.kind) || PROTECTED_KINDS.includes(event.kind))
            && eventPath(event).replaceAll('\\', '/') === file
            && scanContent(read.stdout).length === 0
            && (!PROTECTED_KINDS.includes(event.kind) || verify(event, enrolled));
          if (!sound) { skipped += 1; continue; }
          const target = path.join(dir, file);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          try { fs.writeFileSync(target, read.stdout, { flag: 'wx' }); } catch { skipped += 1; continue; }
          added.push(file);
        }
        if (added.length === 0) {
          return plainAnswer(`Nothing needed putting back: every event in the newest backup is already on the state branch${skipped ? ` (${skipped} could not be checked and were left out)` : ''}.`, { added: 0, skipped });
        }
        const committed = (await plain(['add', '--', ...added])).code === 0 && (await plain(['commit', '-q', '-m', `Put back ${added.length} events from the backup`])).code === 0;
        if (!committed) {
          await plain(['reset', '-q', '--', ...added]);
          for (const f of added) fs.rmSync(path.join(dir, f), { force: true });
          return { ok: false, refused: 'the events could not be committed, so nothing was put back' };
        }
        const pushed = await pushOwn(project, STATE_BRANCH, ctx, { allowStop: true });
        if (!pushed.ok) {
          return { ok: false, refused: `${added.length} events were put back on this computer, but pushing them failed (${pushed.refused ?? 'the host did not take them'}); the next sync will push them`, added: added.length, skipped };
        }
        return plainAnswer(`Put back ${added.length} events from the newest backup, and pushed them${skipped ? `; ${skipped} could not be checked and were left out` : ''}. Nothing already on the branch was changed.`, { added: added.length, skipped });
      } finally {
        await plain(['update-ref', '-d', BACKUP_REF]);
      }
    });
  }

  // The end of a command's output, with any line that matched the secret scan hidden. The end is
  // cut at a line first, so a long line is never scanned whole and a secret is never cut in half.
  function shown(text) {
    let t = String(text).trim();
    if (t.length > 2 * MOST_OUTPUT) {
      t = t.slice(-2 * MOST_OUTPUT);
      const cut = t.indexOf('\n');
      if (cut >= 0) t = t.slice(cut + 1);
    }
    const lines = t.split(/\r\n|\r|\n/);
    for (const hit of scanText(t)) lines[hit.line - 1] = `[hidden: this line matched ${hit.pattern}]`;
    t = lines.join('\n');
    if (scanContent(t).length > 0) t = '[hidden: the output looked as if it held a secret]';
    return t.length > MOST_OUTPUT ? t.slice(-MOST_OUTPUT) : t;
  }

  // Step 5: the project's own containment command, in a fresh checkout of the default branch.
  function doContain({ project }, ctx) {
    return oneAtATime(`contain:${project}`, async () => {
      const adapter = await ctx.adapter();
      const defaultBranch = await defaultBranchOf(project, adapter);
      const dir = path.join(stateDir(project), '..', 'contain');
      const prepared = await oneAtATime(`mirror:${project}`, () => inMirror(project, ctx, async ({ mirror, must }) => {
        await defaultHistory(must, defaultBranch);
        const { runbook: configured } = await baseConfig(must);
        const contain = configured?.contain;
        if (!contain) return null;
        fs.rmSync(dir, { recursive: true, force: true });
        await unkeyed('git', ['worktree', 'prune'], { cwd: mirror });
        fs.mkdirSync(path.dirname(dir), { recursive: true });
        await must(['worktree', 'add', '-q', '--detach', '--force', dir, BASE_REF], 'checking out the default branch');
        return contain;
      }));
      if (!prepared) return plainAnswer(NO_HARM, { none: true });
      const [file, ...args] = prepared.command;
      let result;
      try {
        result = await run(file, args, { cwd: dir, timeoutMs: CONTAIN_MS, limit: MOST_KEPT, baseEnv: withoutGitVars(process.env) });
      } catch {
        return { ok: false, refused: `the containment command (${prepared.describe}) could not be started` };
      }
      const output = shown(`${result.stdout}${result.stderr ? `\n${result.stderr}` : ''}`);
      if (result.timedOut) return { ok: false, refused: `the containment command (${prepared.describe}) did not finish in ten minutes and was stopped`, output };
      if (result.code !== 0) return { ok: false, refused: `the containment command (${prepared.describe}) failed with exit code ${result.code}`, output };
      return plainAnswer(`Ran the project's containment step: ${prepared.describe}.`, { output });
    });
  }

  // The last ten merges on the default branch, newest first, for the step 3 card. The head itself is
  // left out: putting the product back to it would change nothing.
  async function doCandidates({ project }, ctx) {
    const adapter = await ctx.adapter();
    const defaultBranch = await defaultBranchOf(project, adapter);
    return oneAtATime(`mirror:${project}`, () => inMirror(project, ctx, async ({ must }) => {
      await defaultHistory(must, defaultBranch);
      const listed = await must(['log', '--first-parent', '-n', '11', '--format=%H%x1f%cI%x1f%s', BASE_REF], 'reading the default branch\'s history');
      const candidates = listed.split('\n').filter(Boolean).slice(1).map((line) => {
        const [sha, at, title] = line.split('\x1f');
        return { sha, sha12: sha.slice(0, 12), at: new Date(at).toISOString(), title };
      });
      return { ok: true, candidates };
    }));
  }

  // These routes are not queued: STOP is read at the point their work begins.
  // It is read again after the adapter is ready, right before the host write.
  const writing = (call) => async (body, ctx) => {
    if (stopped()) return STOP_REFUSAL;
    const adapter = await ctx.adapter();
    if (stopped()) return STOP_REFUSAL;
    return { ok: true, result: await call(adapter, body) };
  };
  // What the board's health lines need from the host: whether protection is on ('none' when the
  // plan can't have it) and whether the default branch's head has any checks or pipeline. What the
  // host would not say is 'unknown'.
  async function hostFacts({ project }, ctx) {
    const { host, repo, connection } = recordOf(project);
    // On GitLab the plan and the gaps the key could read come along (the board adds the line for a
    // project with real users, which it knows from the settings).
    let more = {};
    const protection = async () => {
      try {
        const token = ctx.env?.GITLAB_TOKEN;
        const api = host === 'gitlab' ? gitlabApi({ baseUrl: checkBaseUrl(connection.baseUrl ?? DEFAULT_GITLAB), token, fetch }) : undefined;
        const status = await protectionStatus({ host, repo, run, api, env: ctx.env });
        if (host === 'gitlab') more = { plan: status.plan, gaps: status.gaps };
        return status.on ? 'on' : (status.available ? 'unknown' : 'none');
      } catch { return 'unknown'; }
    };
    const ci = async () => {
      try {
        const adapter = await ctx.adapter();
        const branch = await defaultBranchOf(project, adapter);
        const has = await adapter.hasCi(await adapter.branchHead(branch), branch);
        awayLog.clear(project);
        return has ? 'present' : 'none';
      } catch (error) {
        if (error?.code === 'HOST_UNREACHABLE') awayLog.set(project, gitlabBaseOf(recordOf(project)));
        return 'unknown';
      }
    };
    const [onOrNot, checks] = await Promise.all([protection(), ci()]);
    return { ok: true, protection: onOrNot, ci: checks, ...more };
  }
  const pass = (call) => async (body, ctx) => ({ ok: true, result: await call(await ctx.adapter(), body) });
  // Setup's routes act on a folder, not a registered project, and check it themselves. Plan and
  // status answer under STOP; apply is refused. Plan writes under STOP (ruling R19), but only
  // setup's own records: it starts the folder's run when there is none, stamps the card's shownAt
  // and keeps the shown card in setup/shown/. It changes nothing a step lists.
  const setup = setupRoutes({ now, stopped, stopRefusal: STOP_REFUSAL, stepsModule: setupSteps, userHome, spawn, writeSurvey: writeSetupSurvey });
  // The baseline from the private note (scripts/measures/baseline.js): per computer, no project.
  // Under STOP, in a project's folder the STOP guard refuses scripts/measures/cli.js, so the front
  // desk can't reach it; a request that arrives all the same may get its card, but nothing is
  // recorded until STOP is lifted.
  const measures = baselineRoutes({ now, stopped, stopRefusal: STOP_REFUSAL });
  // Uninstall's routes (scripts/setup/uninstall.js): plan and status answer under STOP; apply is
  // refused, and starts the apply's own process only after the director's signed Remove it on the
  // card naming the list the helper works out again (ruling R116). When the list stops the helper,
  // it stops once the apply has finished: after the status answer that says so, or, when no one
  // asks, a while after.
  const uninstall = uninstallRoutes({ now, stopped, userHome, run, spawn, stopHelper: () => { Promise.resolve().then(() => onStop(close)).catch(() => {}); } });
  const routes = {
    ...setup,
    ...measures,
    ...uninstall,
    // A placeholder so the route exists: /stop/set is handled in `handle`, before the project lookup.
    '/stop/set': () => ({ ok: true }),
    '/runbook/cut-access': signedIn(clicked(2, doCutAccess)),
    '/runbook/restore-main': signedIn((body, ctx) => doRestoreMain(body, ctx)),
    '/runbook/restore-merge': signedIn((body, ctx) => oneAtATime(`merge:${body.project}`, () => doRestoreMerge(body, ctx))),
    '/runbook/restore-state': signedIn(clicked(4, doRestoreState)),
    '/runbook/contain': signedIn(clicked(5, doContain)),
    '/runbook/candidates': signedIn(doCandidates),
    '/push': (body, ctx) => oneAtATime(`push:${body.project}`, () => doPush(body, ctx)),
    '/pull': (body, ctx) => doPull(body, ctx),
    '/base/fetch': (body, ctx) => doFetchBase(body, ctx),
    '/merge': (body, ctx) => oneAtATime(`merge:${body.project}`, () => doMerge(body, ctx)),
    '/review/run': async (body, ctx) => {
      try {
        return await doReviewRun(body, ctx);
      } finally {
        tidyAfterAnswer(body.project, ctx);
      }
    },
    '/state/clone': stateRoute(async ({ project }, ctx) => {
      await ensureStateClone(project, ctx);
      return { ok: true };
    }, { clone: false }),
    '/state/write': stateRoute(doWrite, { write: true }),
    '/session/mark': stateRoute(doSessionMark, { write: true }),
    '/cards/chat-click': stateRoute(doChatClick, { write: true }),
    // One window at a time on this computer: a second request waits for the first window to close.
    '/confirm': (body, ctx) => oneAtATime('window', () => doConfirm(body, ctx)),
    // A Lean project's store: one change at a time, by the store's own lock.
    '/lean/status': doLeanStatus,
    '/lean/merge': doLeanMerge,
    '/lean/undo': doLeanUndo,
    '/lean/copy': doLeanCopy,
    '/state/record': signedIn(stateRoute(doRecord)),
    // A Lean project's state has no remote, so there is nothing to pull or push.
    '/state/sync': stateRoute(async ({ project }, ctx) => (ctx.lean ? { ok: true, pulled: 0, unpushed: 0 } : {
      ok: true, ...(await syncState({ project, push: pushFor(project, ctx), env: ctx.gitEnv })),
    })),
    // With `cards`, the card events too, every one the state holds: the board numbers its list
    // from them, and the front desk's `again <n>` must find the board's card n. `stop` says STOP is
    // on, for the front desk in the sandbox, which can't read it, to offer the Lift STOP card. With
    // `review`, the delegation review worked out from the project's events, { due, since, proposals }
    // (ruling F41), for the front desk's `review`, which can't list them. With `answers`, the
    // card-answer events, for the front desk's `views work` to tell a feature the director's Not now
    // holds. Read-only, so STOP lets it through.
    '/state/views': stateRoute(async ({ project, cards, review, answers }) => {
      const views = await writeViews(project, { now });
      const events = cards === true || review === true || answers === true ? listEvents(stateDir(project), { report: () => {} }) : [];
      return {
        ok: true,
        views,
        ...(stopped() ? { stop: true } : {}),
        ...(cards === true ? { cards: events.filter((e) => e.kind === 'card') } : {}),
        ...(answers === true ? { answers: events.filter((e) => e.kind === 'card-answer') } : {}),
        ...(review === true ? { review: delegationReview(events, { now, enrolled: readEnrolled(), views }) } : {}),
      };
    }),
    // The label of a question's verified answer, from the views alone, else null. Read-only, so STOP lets it through.
    '/state/answer': stateRoute(async ({ project, questionId }) => {
      if (typeof questionId !== 'string' || questionId === '') refuse('the question id must be text');
      const { questions } = await writeViews(project, { now });
      const label = Object.hasOwn(questions ?? {}, questionId) ? questions[questionId]?.answer?.label : undefined;
      return { ok: true, answer: typeof label === 'string' ? label : null };
    }),
    '/state/backup': (body, ctx) => oneAtATime('profile', () => stateRoute(doBackup)(body, ctx)),
    '/profile/clone': profileRoute(async (_body, ctx) => ({
      ok: true, ...(await ensureProfileClone({ remote: profileRemote(), env: ctx.gitEnv })),
    }), { clone: false }),
    '/profile/write': profileRoute(doProfileWrite, { write: true }),
    '/profile/record': profileRoute(doProfileRecord),
    '/profile/sync': profileRoute(doProfileSync),
    '/profile/views': profileRoute(async () => ({ ok: true, views: await writeProfileViews({ now }) })),
    '/profile/enrolments': profileRoute(doProfileEnrolments),
    '/lock/take': lockRoute(async ({ project }, ctx) => ({
      ok: true, result: await takeLock({ project, push: pushFor(project, ctx), now, env: ctx.gitEnv }),
    }), { write: true }),
    '/lock/touch': lockRoute(async ({ project }, ctx) => ({
      ok: true, result: await touchLock({ project, push: pushFor(project, ctx), now, env: ctx.gitEnv }),
    }), { write: true }),
    '/lock/read': lockRoute(async ({ project }, ctx) => ({ ok: true, result: await readLock({ project, env: ctx.gitEnv }) })),
    '/ci-push/line': (body) => {
      if (stopped()) return STOP_REFUSAL;
      if (!plainBranch(body.branch)) refuse('the branch name is not valid');
      if (typeof body.sha !== 'string' || !/^[0-9a-f]{40}$/.test(body.sha)) refuse('the commit must be written in full');
      return writePending(body.project, { branch: body.branch, sha: body.sha, at: now().toISOString() });
    },
    '/pr/open': async (body, ctx) => {
      if (stopped()) return STOP_REFUSAL;
      const adapter = await ctx.adapter();
      const defaultBranch = await defaultBranchOf(body.project, adapter);
      // A request that names no base means the default branch, which only the helper reads.
      const base = body.base === undefined ? defaultBranch : body.base;
      if (base !== defaultBranch) return { ok: false, refused: PUSH_REFUSALS.prBase };
      const spelled = checkRefspec(body.head, defaultBranch);
      if (!spelled.allowed) return { ok: false, refused: spelled.refused };
      if (spelled.branch === STATE_BRANCH || spelled.branch === LOCK_BRANCH) return { ok: false, refused: PUSH_REFUSALS.ownRequests };
      const provenance = sessionProvenance({ project: body.project, sessionId: body.session });
      if (provenance === null) return { ok: false, refused: NO_PROVENANCE };
      if (stopped()) return STOP_REFUSAL;
      const text = typeof body.body === 'string' ? stampProvenance(body.body, provenance) : body.body;
      return { ok: true, result: await adapter.openPr({ head: spelled.branch, base, title: body.title, body: text }) };
    },
    // A new body is stamped from the session's provenance, as /pr/open's is; a title alone leaves the body as it is.
    '/pr/update': (request, ctx) => {
      if (stopped()) return STOP_REFUSAL;
      const provenance = sessionProvenance({ project: request.project, sessionId: request.session });
      if (provenance === null) return { ok: false, refused: NO_PROVENANCE };
      return writing((a, { number, title, body }) => a.updatePr({
        number, title, body: typeof body === 'string' ? stampProvenance(body, provenance) : body,
      }))(request, ctx);
    },
    '/pr/state': signedIn(pass((a, { number }) => a.prState(number))),
    '/ci': pass((a, { sha }) => a.ciState(sha)),
    // Read-only, so STOP lets it through.
    '/test-merge': async (body, ctx) => {
      try {
        return await doTestMerge(body, ctx);
      } finally {
        tidyAfterAnswer(body.project, ctx);
      }
    },
    '/pr/update-branch': (body, ctx) => oneAtATime(`merge:${body.project}`, async () => {
      try {
        return await doUpdateBranch(body, ctx);
      } finally {
        await oneAtATime(`mirror:${body.project}`, () => dropRequestRefs(body.project, ctx));
        tidyAfterAnswer(body.project, ctx);
      }
    }),
    // Read-only, so STOP lets it through.
    '/pr/carried': async (body, ctx) => {
      try {
        return await doCarried(body, ctx);
      } finally {
        await oneAtATime(`mirror:${body.project}`, () => dropRequestRefs(body.project, ctx));
        tidyAfterAnswer(body.project, ctx);
      }
    },
    // Read-only, so STOP lets it through.
    '/pr/preview': doPreview,
    // Read-only, so STOP lets it through.
    '/config': async (body, ctx) => {
      try {
        return await doConfig(body, ctx);
      } finally {
        tidyAfterAnswer(body.project, ctx);
      }
    },
    // The block a pull request from this session would be stamped with (ruling R147), for its
    // report: never the transcript's path. Null when the session's provenance is not on this
    // computer. Read-only, so STOP lets it through; `stop` says whether STOP is on, since the
    // report is not stamped then and the session can't read STOP itself in the sandbox.
    '/lineage/provenance': (body) => {
      const provenance = sessionProvenance({ project: body.project, sessionId: body.session });
      return { ok: true, block: provenance === null ? null : provenanceBlock(provenance), stop: stopped() };
    },
    // The foreman's act.js or wake.js (ruling R156), run outside the sandbox as a child process in
    // the project's main checkout, with no key or secret in its environment; it reaches the host
    // and the state through this helper, like any other caller. Answered under STOP: the scripts
    // say their own STOP holds. The answer is the child's exit code and output, scrubbed of the
    // connection's secrets as every answer is.
    // One foreman command at a time per project (final review, I2): act's handled list, its
    // worktrees and the sessions it starts are shared, and a retry sent while the first is still
    // running (the forwarder waits as long as the child runs; the foreman's Bash tool may give up
    // sooner) waits its turn, then finds what the first did. The key is the foreman's own, so it
    // never waits on the state:, merge:, mirror: or push: queues the child's own calls take.
    '/foreman/run': ({ project, script, argv }) => oneAtATime(`foreman:${project}`, async () => {
      const why = foremanRequestRefusal({ script, argv });
      if (why !== null) refuse(why);
      let result;
      try {
        result = await run(process.execPath, [FOREMAN_RUNNER, address, script, ...argv], {
          cwd: recordOf(project).folder, baseEnv: foremanEnv(process.env), timeoutMs: FOREMAN_RUN_MS, limit: FOREMAN_OUTPUT_BYTES,
        });
      } catch {
        return { ok: false, refused: `the foreman's ${script} command could not be started` };
      }
      const stopped = result.timedOut ? `The foreman's ${script} command did not finish in fifteen minutes and was stopped.\n` : '';
      return { ok: true, code: result.timedOut ? 1 : result.code, stdout: result.stdout, stderr: `${result.stderr}${stopped}` };
    }),
    '/host/facts': hostFacts,
    '/survey/again': doSurveyAgain,
    '/survey/carry-on': readyRoute(doCarryOn),
    '/survey/archive': readyRoute(doArchive),
    '/survey/restore': readyRoute(doRestore),
    '/issue/create': writing((a, { title, body, labels }) => a.issue.create({ title, body, labels })),
    '/issue/update': writing((a, { number, body }) => a.issue.update({ number, body })),
    '/issue/list': pass((a, { label }) => a.issue.list({ label })),
  };

  // Waits, too, for work queued after an answer (the mirror's tidy): on Windows a folder
  // a git process is working in can't be removed. Photographing and comparing stop after the
  // picture under way.
  let closed = null;
  function close() {
    closed ??= (async () => {
      closing = true;
      await new Promise((resolve) => {
        server.close(() => {
          if (!pipe) fs.rmSync(address, { force: true });
          resolve();
        });
        server.closeAllConnections?.();
      });
      while (queues.size > 0) await Promise.allSettled([...queues.values()]);
    })();
    return closed;
  }

  async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://helper');
    if (url.pathname === '/health') {
      const away = awayLog.fresh();
      return send(res, 200, { ok: true, ...(PLUGIN_VERSION ? { version: PLUGIN_VERSION } : {}), ...(Object.keys(away).length > 0 ? { away } : {}) });
    }
    const route = Object.hasOwn(routes, url.pathname) ? routes[url.pathname] : null;
    if (!route) {
      req.resume();
      return send(res, 404, { ok: false, refused: 'unknown request' });
    }
    if (req.method !== 'POST') {
      req.resume();
      return send(res, 405, { ok: false, refused: 'requests to the helper are POST' });
    }
    const raw = await readBody(req, res);
    if (raw === null) return undefined;
    let body;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      return send(res, 400, { ok: false, refused: 'the request is not JSON' });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return send(res, 400, { ok: false, refused: 'the request must be a JSON object' });
    }
    if (url.pathname === '/stop/set') {
      // Anyone may set STOP: a false alarm costs only a pause. No route lifts it but /confirm, on the director's click in the helper's own window. `by: 'prompt'` records that
      // the director's STOP word set it, from a hook that only reads (ruling P5-18); anything else is the helper.
      try {
        setStop({ by: body.by === 'prompt' ? 'prompt' : 'helper', now });
        return send(res, 200, { ok: true });
      } catch {
        return send(res, 200, { ok: false, refused: 'STOP could not be recorded' });
      }
    }
    if (url.pathname.startsWith('/setup/') || url.pathname.startsWith('/measures/')) {
      // Setup's routes and the baseline's have no project, so no project's secrets: their answers
      // are cleaned as the other routes' are, without them. A refusal, and each line status gives
      // (a step that did not finish says why, in an installer's own words), get the key-like scrub
      // too. Nothing here is logged: the baseline's figures go back only in the card.
      try {
        onArrive(url.pathname);
        const answer = cleanDeep(await route(body), []);
        if (typeof answer?.refused === 'string') answer.refused = clean(answer.refused, []) || 'the request failed';
        if (Array.isArray(answer?.lines)) answer.lines = answer.lines.map((line) => `${/^\s*/.exec(String(line))[0]}${clean(line, [])}`);
        // The last uninstall on this computer stops the helper, once the answer giving its end has gone.
        if (url.pathname === '/setup/uninstall/status' && answer?.helperStops === true) {
          res.once('finish', () => { Promise.resolve().then(() => onStop(close)).catch(() => {}); });
        }
        return send(res, 200, answer);
      } catch (error) {
        const message = error instanceof SetupRefusal || error instanceof Error ? error.message : '';
        return send(res, 200, { ok: false, refused: clean(message, []) || 'the request failed' });
      }
    }
    let ctx = null;
    try {
      const runbookRoute = url.pathname.startsWith('/runbook/');
      // runbook.js, a feature session's commands and the front desk run inside the sandbox, which
      // cannot read ~/.wheelhouse: they send their folder, and the project is placed here.
      if ((runbookRoute || FOLDER_ROUTES.includes(url.pathname) || PLACED_ROUTES.includes(url.pathname)) && body.cwd !== undefined) body = placed(body);
      // Whether a push was placed by its folder is the helper's to say, never the caller's.
      if (url.pathname === '/push') body = { ...body, byFolder: body.cwd !== undefined };
      // The foreman's commands send their folder, which must be the main checkout (ruling R156).
      if (url.pathname === '/foreman/run') body = { ...body, project: placeMainCheckout(body.folder) };
      // The profile's routes, and the backup into it, wait for setup to name the profile's repository.
      if (NEEDS_PROFILE.includes(url.pathname) && profileRemote() === null) return send(res, 200, PROFILE_NOT_SET_UP);
      if (url.pathname.startsWith('/profile/')) {
        ctx = await profileContext();
      } else {
        const project = checkProject(body.project);
        // A Lean project is served before any connection is made, on its state routes alone.
        if (isLean(project)) {
          if (!LEAN_ROUTES.includes(url.pathname)) refuse(LEAN_NO_HOST);
          ctx = leanContext();
        } else {
          if (url.pathname.startsWith('/lean/')) refuse(LEAN_ONLY);
          ctx = await contextFor(project, { fallBack: runbookRoute || FALL_BACK_ROUTES.includes(url.pathname) });
        }
      }
      onArrive(url.pathname); // for tests: the request is about to enter its queue
      const answer = await route(body, ctx);
      return send(res, 200, cleanDeep(answer, ctx.secrets));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'the request failed';
      // Every merge answer carries what was found in the changed files: nothing, when it failed first.
      const found = url.pathname === '/merge' ? { guardrailPaths: [], criticalAreas: [] } : {};
      return send(res, 200, { ok: false, refused: clean(message, ctx?.secrets ?? []) || 'the request failed', ...found });
    }
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) send(res, 500, { ok: false, refused: 'the helper could not answer' });
    });
  });
  try {
    await new Promise((resolve, reject) => {
      const onError = async (error) => {
        if (error.code !== 'EADDRINUSE') return reject(error);
        // Another helper may have started between the probe and now: ask again,
        // and never remove what it made.
        const again = await probe(address);
        reject(new Error(again === 'helper' ? ALREADY : 'The helper\'s address is in use, so the helper was not started'));
      };
      server.once('error', onError);
      server.listen(address, () => {
        server.off('error', onError);
        resolve();
      });
    });
    if (!pipe) {
      try { fs.chmodSync(address, 0o600); } catch { /* not supported here */ }
    }
  } finally {
    releaseStart();
  }

  return { address, close };
}
