// scripts/setup/uninstall-run.js
// Uninstall's apply in its own process (rulings R87 to R92, R116), started by the helper's
// /setup/uninstall/apply, detached, once the director's Remove it on the card has been checked and
// used:
//   node uninstall-run.js <folder> <hash> <clicked at> <deadline> <user home>
// It acts only for the uninstall it was started for: the folder's progress record
// (scripts/setup/uninstall.js, readProgress) must still name that click and that hash, running. It
// works the list out again with the helper's user home, and goes ahead only when it still has the
// hash the click named. What it said and the pages it gave go into the progress record as it
// finishes, done or stopped, which `uninstall status` reads. It runs on when the helper or Desktop
// goes.
//
// <deadline> is the click's time plus STEP_TIMEOUT_MS. The process checks it against the wall clock
// every TICK_MS (a timer doesn't count the time the computer sleeps); past it, it records itself
// stopped, between two changes if it can, and ends. Started past it, it does nothing.
//
// applyUninstall walks the plan's changes in their order (the phases, newest first within each,
// ruling R89) and marks each change in the journal as it is dealt with (markPutBack: put true when
// put back, false with why when left as it is), straight after it is done, so an uninstall cut short
// resumes with a fresh plan and never puts anything back twice. Anything that fails before the
// trusted-keys list's removal stops it there, with nothing after it done and the run left open: the
// next plan lists what is left, on a new card (after the list, see Resuming below).
// Locked is left first, with the director's password, before anything that removes the project's
// record. The level 4 cards (the asks) are acted on after the keys, and only on a Delete it given
// since the card was last asked (ruling R117): the project's private record is deleted from this
// computer; a repository's settings page is opened for their own Delete (ruling R92). Then the
// settled and kept changes are marked, and last of all each of the folder's open runs is closed
// (closeRun, by uninstall). The answers are read before anything is removed (the trusted-keys list
// that verifies them is among what the last uninstall removes).
//
// Resuming (ruling R122). A push the plan read as never made is looked for on the host first; found
// there, the push is marked as on the host (markOnHost) before uninstall stops, so the next plan
// plans the pull request. A commit never pushed is marked kept as soon as setup's files are put back
// here, so a resume never looks for it again; and once everything before the last phase is done, a
// resume carries on without the project's record (which the last phase removes). The trusted-keys
// list is the first of the plan's last removals and the signing key all but the last (rulings R123,
// R128, R142): a list that could not be removed stops uninstall with the key still trusting it, so
// a resume's click is signed and checked as before. Once the list is removed, a click made in this
// session can't count, so nothing stops uninstall but the run's own close: a removal that fails is
// left and named in what uninstall says, for the director to remove or the next uninstall to take.
// If the close itself fails, status says first to start a new session (which makes and enrols a
// key while the run is open) and then ask again (UNINSTALL_NEW_SESSION).
//
// The archive (plan rulings P5, P6). The plan read the other agent setup's archived instructions
// from the folder's copy of the branch as last fetched; before anything is done, the branch is
// fetched from the host and its archive read again. When it isn't the plan's (a change since this
// folder last fetched, or one it never fetched), the folder's copy of the branch is brought up to
// date (only its refs/remotes/origin/<branch>, by setup's fenced git) and uninstall stops, so the
// next plan, on a new card, is the host's. The pull request's commit then moves each file back from
// the archive by its object on the branch, so its text is as the branch holds it, and takes the
// archive's files out of the index, all by plumbing in the scratch repository.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run as realRun } from '../lib/run.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { wheelhouseHome, projectsDir, archonHome, stateDir } from '../lib/paths.js';
import { folderFree, takeHome } from '../host/local/folder.js';
import { gitRoute, homeDir } from '../host/local/home.js';
import { dropNextMain, identityOf } from '../host/local/merge.js';
import { PLUGIN_SCOPE, pluginAtScope, pluginScopeRemoval } from './engine-parts.js';
import { cancelRuns } from '../engine/stop.js';
import { listEvents } from '../state/events.js';
import { readProject, registeredProjects } from '../lib/projects.js';
import { runClosed } from '../lib/setup-run.js';
import { toolPath } from '../lib/host-tools.js';
import { stopState } from '../lib/stop.js';
import { removeLoginStart } from '../lib/login-start.js';
import { STEP_TIMEOUT_MS } from '../lib/setup-numbers.js';
import { profileRemote } from '../profile/store.js';
import { adapterOf } from '../host/adapter-for.js';
import { deleteKey } from '../host/keys.js';
import { checkBaseUrl, projectPath } from '../host/gitlab-key.js';
import { GITLAB_URL, appKeys, connectionInstallationPage, installationPages, revokeGitlabKey } from '../host/cut-access.js';
import { stopForeman, stopWatcher } from '../foreman/start.js';
import { stopReceiver } from '../telemetry/main.js';

// The build engine's runs cancelled, and what they left running ended by pid, as All stop does (scripts/engine/stop.js).
async function stopEngineRuns() {
  const [{ stopEngine }, { packedArchon }] = await Promise.all([import('../engine/stop.js'), import('../host/helper-main.js')]);
  const got = await stopEngine({ engine: packedArchon(), reason: 'Uninstall' });
  if (got.trouble) return { stopped: false, why: got.trouble };
  if (got.survivors.length > 0 || got.refused.length > 0) return { stopped: false, why: `${got.refused.length + got.survivors.length} of its runs or processes are still going` };
  return { stopped: true };
}

// This project's runs of the build engine cancelled, while other projects stay on it (part 3f, M4): the runs its record
// names, by run id, and what they left running ended by pid. Other projects' runs carry on.
export async function stopProjectRuns(project, { engine, cancel = cancelRuns } = {}) {
  const latest = new Map();
  for (const e of listEvents(stateDir(project), { report: () => {} })) {
    if (e.kind === 'run' && typeof e.data?.runId === 'string') latest.set(e.data.runId, e.data.state);
  }
  const runIds = [...latest].filter(([, state]) => state !== 'ended').map(([id]) => id);
  if (runIds.length === 0) return { stopped: true };
  const got = await cancel({ engine: engine ?? (await import('../host/helper-main.js')).packedArchon(), runIds });
  if (got.refused.length > 0 || got.survivors.length > 0) return { stopped: false, why: `${got.refused.length + got.survivors.length} of its runs or processes are still going` };
  return { stopped: true };
}

// `claude plugin uninstall` of the plugin setup added at user scope, unless it is gone already (the director removed it
// by hand): Claude Code would refuse that, and nothing is left to take back.
export async function removePluginScope(change, run) {
  const scope = { plugin: change.after?.plugin ?? PLUGIN_SCOPE.plugin, scope: change.after?.scope ?? PLUGIN_SCOPE.scope };
  if (typeof change.target === 'string' && !pluginAtScope(path.dirname(path.dirname(change.target)), scope)) return { removed: true, already: true };
  const got = await run('claude', pluginScopeRemoval(change));
  return got.code === 0 ? { removed: true } : { removed: false, why: String(got.stderr || got.stdout || '').trim().slice(0, 200) || 'Claude Code gave no reason' };
}
import { leaveLocked } from '../protection/locked.js';
import { lockedProjects } from '../protection/managed.js';
import { readJournal, markPutBack, markOnHost, closeRun, reverseChange, reverseText } from './journal.js';
import { launchVarState, unsetLaunchVar } from './telemetry.js';
import { putBackOwnApp } from './own-app.js';
import { directorGitEnv, directorGitlabApi, openPage } from './host.js';
import { setupGit, reaching } from './git.js';
import { toolsStatus } from './tools.js';
import { enrolledFile, signingKeyFile } from '../state/signing.js';
import { answersFor, askedRecord } from './clicks.js';
import {
  uninstallPlan, readProgress, writeProgress, describe, shown, hostTarget, samePath, within, keyOf, realOr,
  ASK_STEP, UNINSTALL_CHANGED, HOSTS, DELETE_LABEL, NEVER_PUSHED, PHASES, ARCHIVE, ARCHIVE_MANIFEST, ARCHIVE_BACK, PLAIN_FILE, archiveAt,
  REMOVE_REMOTE,
} from './uninstall.js';
import { canonicalJson } from '../lib/canonical.js';
import { unlockHomesIn } from '../host/local/move.js';

export const TICK_MS = 5 * 1000;

// The branch uninstall's pull request comes from, and its title.
export const UNINSTALL_BRANCH = 'wheelhouse/uninstall';
export const UNINSTALL_TITLE = 'Remove Wheelhouse';
const FOLDER_WAITS = 'your folder has changes of its own, or is on another line, so uninstall stopped with nothing of it touched: save those changes, go back to the main line, and ask for uninstall\'s plan again';
const UNINSTALL_BODY = 'This takes out of the project\'s files what Wheelhouse\'s setup put in: its settings, its configuration, its section of CLAUDE.md and the pinned kits. Once it is merged, Wheelhouse\'s checks no longer guard this project. Branch protection stays on.';
// Added to the body when it puts archived instructions back.
const ARCHIVE_BODY = ` It also moves the other agent setup's instructions out of ${ARCHIVE}/, back where they were.`;
// Setup's own name on uninstall's commit.
const AUTHOR = ['-c', 'user.name=Wheelhouse setup', '-c', 'user.email=setup@wheelhouse.invalid', '-c', 'commit.gpgsign=false'];
const NO_HOOKS = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false'];

// Stops the uninstall where it is, with why.
class Halt extends Error {}
const halt = (why) => { throw new Halt(why); };

// git for uninstall's host work, with the director's own sign-in, in a scratch bare repository of
// setup's own under the Wheelhouse home, removed afterwards: never the director's folder, never the
// project's private record. `use(git)` gets
// `{ ok(args, input?), out(args, input?), must(args, why, input?) }`.
async function withScratchGit({ run, gitPath, env, remoteUrl, index = false }, use) {
  const parent = path.join(wheelhouseHome(), 'setup');
  fs.mkdirSync(parent, { recursive: true });
  const dir = fs.mkdtempSync(path.join(parent, 'uninstall-'));
  try {
    const call = setupGit({ run, gitPath, env: reaching({ GIT_NO_REPLACE_OBJECTS: '1', ...env, ...(index ? { GIT_INDEX_FILE: path.join(dir, 'uninstall.index') } : {}) }, remoteUrl), cwd: dir });
    const git = (args, input) => call([...NO_HOOKS, ...args], input === undefined ? {} : { input });
    const out = async (args, input) => {
      const got = await git(args, input);
      return got.code === 0 ? String(got.stdout).trim() : null;
    };
    const must = async (args, why, input) => {
      const got = await git(args, input);
      if (got.code !== 0) throw new Halt(why);
      return String(got.stdout).trim();
    };
    await must(['init', '-q', '--bare'], 'git could not start a scratch repository for uninstall');
    return await use({ git, out, must });
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch { /* left for the system to clear */ }
  }
}

// The tip of a branch on the host, or null when there is no such branch; throws when the host can't
// be reached.
async function hostTip(git, remoteUrl, branch) {
  const got = await git.must(['ls-remote', '--heads', remoteUrl, `refs/heads/${branch}`], 'the host could not be reached with your sign-in');
  return /^([0-9a-f]{40,64})\t/m.exec(got)?.[1] ?? null;
}

// Deletes a branch on the host while it is at `sha` (any tip when `sha` is null), with the director's
// own sign-in: { put: true } when deleted or gone already, { put: false, why } when it moved.
async function deleteHostBranch(git, remoteUrl, branch, sha) {
  const tip = await hostTip(git, remoteUrl, branch);
  if (tip === null) return { put: true, why: 'gone already' };
  if (sha !== null && tip !== sha) return { put: false, why: 'it moved since setup, so it stays' };
  await git.must(['push', '-q', '--no-verify', `--force-with-lease=refs/heads/${branch}:${tip}`, remoteUrl, `:refs/heads/${branch}`], `the branch ${branch} could not be deleted on the host`);
  return { put: true };
}

// The project's files on `base` as the host holds them, with each in-pull-request entry put back by
// its change's `before` (reverseText): a pin by its key in .claude/settings.json. Gives
// { files: { rel: text | null } changed, left: [{ ids, why, what }] }.
async function putBackOnHost(git, tip, folder, entries) {
  const files = new Map();
  const relOf = (target) => path.relative(folder, target).split(path.sep).join('/');
  const textAt = async (rel) => {
    if (!files.has(rel)) {
      const got = await git.git(['cat-file', 'blob', `${tip}:${rel}`]);
      files.set(rel, { text: got.code === 0 ? String(got.stdout) : null, changed: false });
    }
    return files.get(rel);
  };
  const left = [];
  for (const e of entries) {
    const plugin = e.change.kind === 'process' ? e.change.after?.plugin : null;
    const change = plugin
      ? { id: e.change.id, kind: 'json-key', target: path.join(folder, '.claude', 'settings.json'), key: ['enabledPlugins', plugin], before: null, absent: true, after: true }
      : e.change;
    const rel = relOf(change.target);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      left.push({ ids: e.ids, why: 'not one of the project\'s files', what: rel });
      continue;
    }
    const file = await textAt(rel);
    const got = reverseText(change, file.text);
    if (!got.put) left.push({ ids: e.ids, why: got.why, what: plugin ? `the pinned kit ${String(plugin).split('@')[0]}` : rel });
    else if (got.text !== file.text) files.set(rel, { text: got.text, changed: true });
  }
  return { files: Object.fromEntries([...files].filter(([, f]) => f.changed).map(([rel, f]) => [rel, f.text])), left };
}

// Puts the archive back in the scratch index read from the branch's tip (`found`, archiveAt's):
// each move's plain file at its own path by its object and mode on the branch; then the archive's files
// taken out, all of them when nothing stays in it, otherwise those moved, with its list written
// again naming only what stays. Paths go to git NUL-separated, never quoted or read as patterns.
async function putArchiveBack(git, found, zeros) {
  const { view, manifest } = found;
  // By the mode and object the card's list names (the same as the branch's, checked before), and
  // only as a plain file: never a link or another repository.
  for (const { from, mode, sha } of view.moves) {
    if (!PLAIN_FILE.includes(mode)) throw new Halt(`${from} in ${ARCHIVE}/ is not a plain file, so it was not put back`);
    await git.must(['update-index', '--add', '--cacheinfo', `${mode},${sha},${from}`], `git could not put ${from} back`);
  }
  const stays = view.taken.length > 0;
  const out = stays ? view.moves.map((m) => m.to) : view.folder;
  if (out.length > 0) await git.must(['update-index', '-z', '--index-info'], `git could not take ${ARCHIVE}/ out`, out.map((p) => `0 ${zeros}\t${p}\0`).join(''));
  if (stays) {
    const list = `${JSON.stringify({ ...manifest, moved: manifest.moved.filter((m) => view.taken.includes(m.from)) }, null, 2)}\n`;
    const blob = await git.must(['hash-object', '-w', '--stdin'], `git could not write ${ARCHIVE_MANIFEST}`, list);
    await git.must(['update-index', '--add', '--cacheinfo', `100644,${blob},${ARCHIVE_MANIFEST}`], `git could not write ${ARCHIVE_MANIFEST}`);
  }
}

// What uninstall says of the archive once its pull request is made.
function archiveSays(view) {
  if (view === null) return [];
  if (view.refused !== undefined) return [`${ARCHIVE}/ stays as it is: ${view.refused}.`];
  return [
    ...(view.moves.length > 0 ? [`In it too: ${ARCHIVE_BACK} (${view.moves.map((m) => m.from).join(', ')}).`] : []),
    ...view.taken.map((from) => `Left in ${ARCHIVE}/: ${from}, as its place is taken on the project's main line.`),
    ...view.missing.map((from) => `Not put back: ${from}, as ${ARCHIVE}/ no longer holds it.`),
  ];
}

// The real host work, with the director's own sign-in: git in a scratch repository, the host's tool
// through the adapter, and GitLab's API for a merge request's search.
function hostWork({ platform, run, fetch }) {
  const adapterFor = ({ host, repo, base, folder }) => adapterOf({ host, repo, folder, connection: { baseUrl: base } }, { run });
  return {
    findGit: async () => (await toolsStatus({ platform, run, tools: ['git'] })).git,
    gitEnvFor: ({ host, gitPath, base }) => directorGitEnv({ host, gitPath, platform, base }),
    adapterFor,
    // The open pull request from `branch`, or null.
    async findOpenPr({ host, repo, branch, baseUrl }) {
      if (host === 'local') {
        const found = (await adapterFor({ host, repo }).openRequests()).find((r) => r.branch === branch);
        return found ? { number: found.number, url: null } : null;
      }
      if (host === 'github') {
        const got = await run(toolPath('gh', { platform }), ['pr', 'list', '--repo', repo, `--head=${branch}`, '--state', 'open', '--json', 'number,url'], { env: {} });
        if (got.code !== 0) throw new Halt(`GitHub could not list ${repo}'s pull requests with your sign-in`);
        const found = JSON.parse(String(got.stdout || '[]'))[0];
        return found ? { number: found.number, url: found.url } : null;
      }
      const api = await directorGitlabApi({ run, fetch, baseUrl });
      const got = await api.get(`${projectPath(repo)}/merge_requests?state=opened&source_branch=${encodeURIComponent(branch)}`);
      if (got.status !== 200 || !Array.isArray(got.body)) throw new Halt(`GitLab could not list ${repo}'s merge requests with your sign-in (HTTP ${got.status})`);
      const found = got.body[0];
      return found ? { number: found.iid, url: found.web_url } : null;
    },
    openPage: (url) => openPage(url, { platform, run }).catch(() => null),
  };
}

// Applies an uninstall plan worked out for `folder` (its real path). `ops` replaces parts for tests:
// the stops, leaveLocked, the host work (`findGit`, `gitEnvFor`, `adapterFor`, `findOpenPr`,
// `openPage`), putBackOwnApp's `profile`, revokeGitlabKey. `stopped` reads STOP,
// which halts it between two changes. Gives { ok, lines, pages, helperStops? }, or, when it stopped
// part-way, { ok: false, refused, lines, pages }.
export async function applyUninstall({
  folder, plan, now = () => new Date(), userHome = os.homedir(), platform = process.platform, run = realRun, fetch = globalThis.fetch,
  stopped = () => false, ops = {},
}) {
  const o = {
    stopForeman: (project) => stopForeman(project),
    stopWatcher: (project) => stopWatcher(project),
    stopReceiver: () => stopReceiver(),
    stopEngine: () => stopEngineRuns(),
    stopProjectRuns: (project) => stopProjectRuns(project),
    removePluginScope: (change) => removePluginScope(change, run),
    leaveLocked: (args) => leaveLocked({ ...args, run }),
    putBackOwnApp: (change) => putBackOwnApp(change, ops.profile === undefined ? {} : { profile: ops.profile }),
    revokeGitlabKey: (args) => revokeGitlabKey({ ...args, fetch }),
    ...hostWork({ platform, run, fetch }),
    ...ops,
  };
  const lines = [];
  const pages = [];
  const say = (line) => lines.push(line);
  const page = async (what, url) => {
    pages.push({ what, url });
    await o.openPage(url);
  };
  const journal = readJournal();
  const byId = new Map(journal.runs.flatMap((r) => (Array.isArray(r?.changes) ? r.changes : [])).map((c) => [c.id, c]));
  // Marks changes of the journal as dealt with, straight after (ruling R89).
  const mark = (ids, put, why) => {
    const list = (ids ?? []).filter((id) => byId.has(id));
    if (list.length > 0) markPutBack(list, { put, ...(why ? { why } : {}), now });
  };
  const mine = (r) => typeof r?.folder === 'string' && keyOf(realOr(r.folder)) === keyOf(folder);
  const openRuns = journal.runs.filter((r) => mine(r) && !runClosed(r));
  const record = plan.project === null ? null : readProject(plan.project);
  const hostName = (h) => HOSTS[h] ?? 'this computer';
  // Where the project's repository is reached: the host, or for a project kept here its home, by its path.
  const placeOf = (r) => (r.host === 'local' ? homeDir(plan.project) : r.remoteUrl);
  const route = gitRoute({ run });
  // The answers to the level 4 cards, read now: what verifies them may be removed below. Each
  // counts only if it was given after its card was last asked (ruling R117): an older Delete it
  // belongs to an uninstall that never went ahead.
  const answers = {};
  for (const r of openRuns) {
    for (const [key, answer] of Object.entries(answersFor(r.id))) {
      const [step, id] = [Number(key.slice(0, key.indexOf('.'))), key.slice(key.indexOf('.') + 1)];
      const asked = step === ASK_STEP ? askedRecord(r.id, step, id) : null;
      if (asked !== null && Date.parse(answer.at) >= Date.parse(asked.at)) answers[key] = answer;
    }
  }
  let git = null;
  const gitFor = async (host, remoteUrl, use, index = false, base = undefined) => {
    git ??= await o.findGit();
    if (!git?.ok || typeof git.path !== 'string') halt('git is not on this computer, so uninstall can\'t reach the host');
    return withScratchGit({ run, gitPath: git.path, env: o.gitEnvFor({ host, gitPath: git.path, base }), remoteUrl, index }, use);
  };

  // A push 15a's plan read as not made may have reached the host if setup stopped before it fetched:
  // looked for on the host first, and the list is stale if it is there.
  const neverPushed = plan.keep.filter((k) => k.why === NEVER_PUSHED);
  const unpushed = neverPushed.flatMap((k) => k.ids ?? []).map((id) => byId.get(id)).filter((c) => c?.kind === 'host' && c.after?.action === 'push').at(-1);
  // Everything before the last phase done already: an earlier apply got that far, and may have
  // removed the project's record since (ruling R122).
  const reachedLast = plan.changes.every((e) => e.put === 'stop' || e.phase === 'last');
  // The commit never pushed, marked kept once setup's files are put back here (ruling R122).
  let commitKept = false;
  const keepCommit = () => {
    if (commitKept) return;
    commitKept = true;
    for (const k of neverPushed) mark(k.ids, false, k.why);
  };
  const afterFiles = (entry) => PHASES.indexOf(entry.phase) > PHASES.indexOf('files');
  // The trusted-keys list and the signing key: from the first of them on, nothing stops uninstall,
  // STOP or a removal that fails, but the run's own close (rulings R123, R142). Once the list is gone
  // a Remove it clicked in this session can't count, so a stop there would ask for a click that
  // can't be given: what can't be removed is left, and named.
  const keyFile = (e) => e.put === 'remove' && (samePath(e.target, signingKeyFile()) || samePath(e.target, enrolledFile()));
  const firstKeyFile = plan.changes.findIndex(keyFile);
  let pastKeys = false;

  // The level 4 cards, on Delete it alone.
  const asked = async () => {
    for (const ask of plan.asks) {
      const answer = answers[`${ASK_STEP}.${ask.id}`];
      const named = ask.put === 'delete-record' ? 'this project\'s private record on this computer'
        : ask.put === 'delete-home' ? 'this project\'s private copy on this computer'
        : ask.put === 'delete-engine-history' ? 'Archon\'s run history on this computer' : ask.target.replace(/^(github|gitlab):/, '');
      if (answer?.label !== DELETE_LABEL) {
        mark(ask.ids, false, answer ? 'kept, as its own card said' : 'kept: its own card was not answered Delete it');
        say(`Kept: ${named}${answer ? '' : ', as its own card was not answered'}.`);
        continue;
      }
      if (ask.put === 'delete-record') {
        // Only a project's record folder under projects/ is ever deleted here.
        if (path.basename(ask.target) !== 'record' || !samePath(path.dirname(path.dirname(ask.target)), projectsDir())) halt(`${ask.target} is not a project's private record, so it was not deleted`);
        fs.rmSync(ask.target, { recursive: true, force: true });
        mark(ask.ids, true);
        say('This project\'s private record is deleted from this computer.');
        continue;
      }
      if (ask.put === 'delete-home') {
        // Only a project's home under projects/ is ever deleted here.
        if (path.basename(ask.target) !== 'home.git' || !samePath(path.dirname(path.dirname(ask.target)), projectsDir())) halt(`${ask.target} is not a project's private copy, so it was not deleted`);
        fs.rmSync(ask.target, { recursive: true, force: true });
        mark(ask.ids, true);
        say('This project\'s private copy is deleted from this computer.');
        continue;
      }
      if (ask.put === 'delete-engine-history') {
        // Only the engine's own home is ever deleted here.
        if (!samePath(ask.target, archonHome())) halt(`${ask.target} is not the build engine's run history, so it was not deleted`);
        fs.rmSync(ask.target, { recursive: true, force: true });
        mark(ask.ids, true);
        say('Archon\'s run history is deleted from this computer.');
        continue;
      }
      const h = hostTarget(ask.target);
      const base = h.host === 'gitlab' ? (record?.connection?.baseUrl ?? GITLAB_URL) : null;
      const url = h.host === 'github' ? `https://github.com/${h.repo}/settings` : `${base}/${h.repo}/edit`;
      mark(ask.ids, false, 'left for your own Delete on its settings page');
      say(`${h.repo} is yours to delete: on its settings page (the Danger zone at the bottom), click Delete.`);
      await page(`${h.repo}'s settings page`, url);
    }
  };

  let helperStops = false;
  let askedYet = false;
  let removed = 0;
  // A removal of the list, throwing when it can't be made.
  const removeOne = (entry) => {
    if (entry.put === 'remove' && Array.isArray(entry.except)) {
      // The folder but for the names it keeps, then the folder itself once nothing is left in it.
      if (!within(wheelhouseHome(), entry.target)) halt(`${entry.target} is not Wheelhouse's own, so it was not removed`);
      let names = [];
      try {
        names = fs.readdirSync(entry.target);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      const going = names.filter((n) => !entry.except.includes(n));
      unlockHomesIn(entry.target);
      for (const n of going) fs.rmSync(path.join(entry.target, n), { recursive: true, force: true });
      if (going.length > 0) removed += 1;
      if (names.length > 0 && going.length === names.length) fs.rmdirSync(entry.target);
      mark(entry.ids, true);
      return;
    }
    if (entry.put === 'remove') {
      const recorded = (entry.ids ?? []).some((id) => byId.get(id)?.kind === 'folder' && samePath(byId.get(id).target, entry.target) && typeof byId.get(id).after?.installer === 'string');
      if (!within(wheelhouseHome(), entry.target) && !recorded) halt(`${entry.target} is not Wheelhouse's own, so it was not removed`);
      const there = fs.existsSync(entry.target);
      unlockHomesIn(entry.target);
      fs.rmSync(entry.target, { recursive: true, force: true });
      if (there) removed += 1;
      mark(entry.ids, true);
      return;
    }
    // Left as it is while anything is in it: only an emptied folder of Wheelhouse's goes (R138).
    if (!within(wheelhouseHome(), entry.target)) halt(`${entry.target} is not Wheelhouse's own, so it was not removed`);
    let left = null;
    try {
      left = fs.readdirSync(entry.target);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    try {
      if (left !== null && left.length === 0) fs.rmdirSync(entry.target);
    } catch (error) {
      // Something put in it meanwhile keeps it, as anything in it would.
      if (error?.code !== 'ENOTEMPTY' && error?.code !== 'EEXIST') throw error;
    }
  };
  // The branch's tip on the host, fetched into the scratch repository.
  const fetchBase = async (g, branch) => {
    const fetched = await g.git(['fetch', '-q', '--no-tags', placeOf(record), `+refs/heads/${branch}:refs/fetched/base`]);
    if (fetched.code !== 0) halt(`${branch} on ${hostName(record.host)} could not be read with your sign-in`);
    return g.must(['rev-parse', '--verify', 'refs/fetched/base^{commit}'], `${branch} could not be read`);
  };
  // The archive the plan read, against the host's: when they differ, the folder's copy of the
  // branch is brought up to date, best effort, and uninstall stops for a new card.
  const sameArchive = (found, entry) => canonicalJson(found?.view ?? null) === canonicalJson(entry.archive ?? null);
  const archiveChanged = async (branch) => {
    try {
      const call = setupGit({
        run, gitPath: git.path, cwd: folder,
        env: reaching({ GIT_NO_REPLACE_OBJECTS: '1', ...o.gitEnvFor({ host: record.host, gitPath: git.path, base: record.connection?.baseUrl }) }, placeOf(record)),
      });
      await call(['fetch', '-q', '--no-tags', '--no-write-fetch-head', placeOf(record), `+refs/heads/${branch}:refs/remotes/origin/${branch}`]);
    } catch { /* the next plan reads the folder's copy as it is */ }
    halt(`the archive of the other agent setup's instructions on ${branch} on ${hostName(record.host)} isn't as this folder last saw it, so ${UNINSTALL_CHANGED}`);
  };
  // The folder takes all the home holds. A line that can't come stops uninstall before anything of the folder changes.
  const takeAll = async (branch) => {
    const env = await identityOf(folder, route);
    const got = await takeHome({ project: plan.project, folder, branch, env, git: route });
    if (got.line !== undefined) halt(FOLDER_WAITS);
    return got;
  };
  // The last change of a project kept here: it stands at `sha` on uninstall's own branch in the home. It merges at once, and
  // into the folder.
  const lastChange = async (entry, sha) => {
    const adapter = await o.adapterFor({ host: 'local', repo: record.repo, folder });
    const open = await o.findOpenPr({ host: 'local', repo: record.repo, branch: UNINSTALL_BRANCH });
    if (open !== null) await adapter.updatePr({ number: open.number, title: UNINSTALL_TITLE });
    const { number } = open ?? await adapter.openPr({ head: UNINSTALL_BRANCH, base: entry.branch, title: UNINSTALL_TITLE, body: `${UNINSTALL_BODY}${entry.archive?.moves?.length > 0 ? ARCHIVE_BODY : ''}` });
    const merged = await adapter.merge({ number, sha });
    if (!merged.merged) halt(`setup's files could not be taken out of ${entry.branch} (${merged.reason}); ask for uninstall's plan again`);
    dropNextMain(plan.project);
    const { kept } = await takeAll(entry.branch);
    say(kept === null ? `Setup's files and pins are out of ${entry.branch}, in your folder too.` : `Your folder and the main version changed the same files, so setup's files stay in your folder for now. The main version is kept on the line ${kept}.`);
  };
  const checkArchive = async (entry) => {
    const same = await gitFor(record.host, placeOf(record), async (g) => sameArchive(await archiveAt(g.git, await fetchBase(g, entry.branch)), entry), false, record.connection?.baseUrl);
    if (!same) await archiveChanged(entry.branch);
  };
  try {
    if (unpushed !== undefined && !(record === null && reachedLast)) {
      // Read by ls-remote (ruling R118): no such branch on the host means the push never went up,
      // so uninstall goes on here; only a host that can't be reached stops it.
      if (record === null) halt('the project\'s record is gone, so whether setup\'s commit reached the host can\'t be checked');
      const remoteUrl = placeOf(record);
      const { branch, sha } = unpushed.after;
      const there = await gitFor(record.host, remoteUrl, async (g) => {
        let tip;
        try {
          tip = await hostTip(g, remoteUrl, branch);
        } catch {
          halt(`${hostName(record.host)} could not be reached with your sign-in to see whether setup's commit is on ${branch}, so uninstall did not go on; try again once it can be reached`);
        }
        if (tip === null) return false;
        if (tip === sha) return true;
        const fetched = await g.git(['fetch', '-q', '--no-tags', remoteUrl, `+refs/heads/${branch}:refs/fetched/branch`]);
        if (fetched.code !== 0) halt(`${branch} on ${hostName(record.host)} could not be read with your sign-in, so uninstall did not go on; try again once it can be`);
        return (await g.git(['cat-file', '-e', `${sha}^{commit}`])).code === 0;
      }, false, record.connection?.baseUrl);
      if (there) {
        // Recorded first, so the next plan reads the push as made and plans the pull request.
        markOnHost(unpushed.id, { now });
        halt(`setup's commit is on ${branch} on ${hostName(record.host)} after all, so ${UNINSTALL_CHANGED}`);
      }
    }
    // The archive on the host, before anything is done: the plan's, or uninstall stops here.
    const prEntry = plan.changes.find((e) => e.put === 'pull-request');
    if (prEntry !== undefined && record !== null) await checkArchive(prEntry);
    if (prEntry !== undefined && record?.host === 'local' && !(await folderFree({ folder, branch: prEntry.branch, git: route }))) halt(FOLDER_WAITS);
    for (const [i, entry] of plan.changes.entries()) {
      // Past the project's files, setup's files are put back here: the commit never pushed is kept.
      if (afterFiles(entry)) keepCommit();
      const closing = firstKeyFile !== -1 && i > firstKeyFile;
      if (closing) pastKeys = true;
      if (entry.put !== 'stop' && !closing && stopped()) halt('All stop came on, so uninstall stopped here; once All stop is lifted, ask for uninstall\'s plan again');
      if (closing && ['remove', 'remove-empty'].includes(entry.put)) {
        try {
          removeOne(entry);
        } catch (error) {
          say(`Left: ${shown(entry.target, userHome)}, as it could not be removed (${error?.code ?? (error instanceof Error ? error.message : 'no reason given')}): remove it yourself, or it goes with the next uninstall.`);
        }
        continue;
      }
      if (entry.phase === 'last' && !askedYet) {
        askedYet = true;
        await asked();
      }
      switch (entry.put) {
        case 'stop': {
          if (entry.what === 'helper') {
            helperStops = true;
            say('The host helper stops once this answer is sent.');
            break;
          }
          const got = entry.what === 'receiver' ? await o.stopReceiver()
            : entry.what === 'engine' ? await o.stopEngine()
              : entry.what === 'engine-runs' ? await o.stopProjectRuns(plan.project)
                : await (entry.what === 'foreman' ? o.stopForeman(plan.project) : o.stopWatcher(plan.project));
          const name = {
            engine: 'The build engine\'s runs', 'engine-runs': 'This project\'s runs of the build engine', foreman: 'The Bosun', watcher: 'The watcher', receiver: 'The usage receiver',
          }[entry.what];
          // Runs still going would lose their engine or their worktrees underneath them: nothing else is removed until they stop.
          if ((entry.what === 'engine' || entry.what === 'engine-runs') && !got.stopped) halt(`The build engine's runs did not all stop (${got.why}), so nothing else was removed; ask for uninstall's plan again once they have`);
          say(got.stopped ? `${name} is stopped.` : `${name}: ${got.why}.`);
          break;
        }
        case 'leave-locked': {
          const dir = path.dirname(entry.target);
          const got = await o.leaveLocked({ project: entry.project, platform, now, dir });
          const kept = readProject(entry.project);
          if (kept === null || lockedProjects({ dir }).some((f) => samePath(f, kept.folder))) halt(`Locked was not left (${got?.line ?? 'it did not say why'}), so nothing else was removed`);
          mark(entry.ids, true);
          say(`Locked: ${got.line}.`);
          break;
        }
        case 'bring-up': {
          if (record === null) break;
          const { kept } = await takeAll(entry.branch);
          say(kept === null ? `Your folder holds all of ${entry.branch}.` : `Your folder and the main version changed the same files, so the main version is kept on the line ${kept}.`);
          break;
        }
        case REMOVE_REMOTE: {
          const here = route(entry.target, { reach: 'local', what: 'the project\'s folder' });
          const url = await here.call(['config', '--get', `remote.${entry.name}.url`]);
          if (url.code === 0 && String(url.stdout).trim() === entry.url) await here.must(['remote', 'remove', entry.name], 'The folder\'s git settings could not be changed');
          if (url.code === 0 && String(url.stdout).trim() !== entry.url) mark(entry.ids, false, 'it points somewhere else now, so it stays');
          else mark(entry.ids, true);
          break;
        }
        case 'pull-request': {
          if (record === null) halt('the project\'s record is gone, so the pull request could not be made');
          const inPr = plan.changes.filter((c) => c.put === 'in-pull-request');
          const made = await gitFor(record.host, placeOf(record), async (g) => {
            const tip = await fetchBase(g, entry.branch);
            // Read again with the files: the branch may have moved since the check above.
            const found = await archiveAt(g.git, tip);
            if (!sameArchive(found, entry)) return { stale: true };
            const restoring = found !== null && found.view.refused === undefined;
            const { files, left } = await putBackOnHost(g, tip, folder, inPr);
            if (Object.keys(files).length === 0 && !restoring) return { tip, left, sha: null };
            await g.must(['read-tree', tip], 'git could not read the project\'s files');
            if (restoring) await putArchiveBack(g, found, '0'.repeat(tip.length));
            for (const [rel, text] of Object.entries(files)) {
              // Taken out of the index by a mode of 0, which a repository without a working tree takes.
              if (text === null) await g.must(['update-index', '--index-info'], `git could not take out ${rel}`, `0 ${'0'.repeat(tip.length)}\t${rel}\n`);
              else {
                const blob = await g.must(['hash-object', '-w', '--stdin'], `git could not write ${rel}`, text);
                await g.must(['update-index', '--add', '--cacheinfo', `100644,${blob},${rel}`], `git could not put back ${rel}`);
              }
            }
            const tree = await g.must(['write-tree'], 'git could not make the pull request\'s files');
            const sha = await g.must([...AUTHOR, 'commit-tree', tree, '-p', tip, '-m', UNINSTALL_TITLE], 'git could not make uninstall\'s commit');
            // Wheelhouse's own branch: a retry's commit takes the place of an earlier attempt's.
            await g.must(['push', '-q', '--no-verify', '--force', placeOf(record), `${sha}:refs/heads/${UNINSTALL_BRANCH}`], `uninstall's branch could not be pushed to ${hostName(record.host)} with your sign-in`);
            return { tip, left, sha };
          }, true, record.connection?.baseUrl);
          if (made.stale) await archiveChanged(entry.branch);
          for (const l of made.left) mark(l.ids, false, l.why);
          if (made.sha === null) {
            mark(entry.ids, true, `nothing of setup's is left on ${entry.branch}`);
            say(`Nothing of setup's is left in the project's files on ${entry.branch}, so no pull request is needed.`);
          } else if (record.host === 'local') {
            await lastChange(entry, made.sha);
            mark(entry.ids, true, 'taken out by the last change');
          } else {
            const baseUrl = record.connection?.baseUrl ?? GITLAB_URL;
            const pr = (await o.findOpenPr({ host: record.host, repo: record.repo, branch: UNINSTALL_BRANCH, baseUrl }))
              ?? await (await o.adapterFor({ host: record.host, repo: record.repo, base: record.connection?.baseUrl, folder: record.folder })).openPr({
                head: UNINSTALL_BRANCH, base: entry.branch, title: UNINSTALL_TITLE, body: `${UNINSTALL_BODY}${entry.archive?.moves?.length > 0 ? ARCHIVE_BODY : ''}`,
              });
            mark(entry.ids, true, `taken out by pull request ${pr.number}, for you to merge`);
            say(`Pull request ${pr.number} takes setup's files and pins out of ${entry.branch}: merge it on ${hostName(record.host)}. Once it is merged, Wheelhouse's checks no longer guard this project; protection stays on.`);
            for (const line of archiveSays(entry.archive ?? null)) say(line);
            await page('the pull request', pr.url);
          }
          for (const l of made.left) say(`Left in the project's files: ${l.what}, ${l.why}.`);
          break;
        }
        case 'in-pull-request':
          break; // with its pull request
        case 'close-pull-request': {
          if (record === null) halt('the project\'s record is gone, so the trial pull request could not be closed');
          const adapter = await o.adapterFor({ host: record.host, repo: record.repo, base: record.connection?.baseUrl, folder: record.folder });
          const number = entry.number ?? (await o.findOpenPr({ host: record.host, repo: record.repo, branch: entry.branch, baseUrl: record.connection?.baseUrl ?? GITLAB_URL }))?.number ?? null;
          if (number !== null && (await adapter.prState(number))?.state === 'open') await adapter.closePr(number);
          mark(entry.ids, true);
          say(number === null ? 'The trial pull request is not open.' : `The trial pull request ${number} is closed.`);
          break;
        }
        case 'delete-branch': {
          if (record === null) halt('the project\'s record is gone, so the trial branch could not be deleted');
          // A branch whose commit setup never recorded is left: it can't be told apart from one
          // someone else pushed to.
          if (typeof entry.sha !== 'string') {
            mark(entry.ids, false, 'its commit was never recorded, so it stays');
            say(`The trial branch ${entry.branch} stays: its commit was never recorded.`);
            break;
          }
          const got = await gitFor(record.host, placeOf(record), (g) => deleteHostBranch(g, placeOf(record), entry.branch, entry.sha), false, record.connection?.baseUrl);
          mark(entry.ids, got.put, got.put ? undefined : got.why);
          say(got.put ? `The trial branch ${entry.branch} is deleted.` : `The trial branch ${entry.branch} stays: ${got.why}.`);
          break;
        }
        case 'reverse': {
          const got = reverseChange(entry.change);
          mark(entry.ids, got.put, got.put ? undefined : got.why);
          say(got.put ? `Put back: ${describe(entry.change, userHome)}.` : `Left: ${describe(entry.change, userHome)}, ${got.why}.`);
          break;
        }
        case 'unset-env': {
          const last = byId.get(entry.ids.at(-1));
          const first = byId.get(entry.ids[0]);
          const read = await launchVarState(entry.target, { platform, run });
          if (read.why !== undefined) halt(read.why);
          if (read.value === last?.after) {
            await unsetLaunchVar(entry.target, { platform, run });
            mark(entry.ids, true);
            say(`${entry.target} is taken out of your account's settings.`);
          } else if (read.value === (first?.before ?? null)) mark(entry.ids, true, 'already put back');
          else {
            mark(entry.ids, false, 'changed since setup');
            say(`Left: ${entry.target}, changed since setup.`);
          }
          break;
        }
        case 'put-back-own-app': {
          const got = await o.putBackOwnApp(entry.change);
          if (!got.put && got.why !== 'changed since setup') halt(`your own GitHub App could not be put back in your settings on this computer: ${got.why}`);
          mark(entry.ids, got.put, got.put ? undefined : got.why);
          say(got.put ? 'Your own GitHub App in your settings on this computer is put back as it was; like any of your settings, it takes effect once you Confirm it.' : 'Left: your own GitHub App in your settings on this computer, changed since setup.');
          break;
        }
        case 'delete-key': {
          // On a shared project the installation is the other computers' too: it is left, and no
          // page is given (ruling R124).
          const urls = entry.shared ? [] : installationPages(appKeys());
          deleteKey('github-app');
          mark(entry.ids, true);
          say(entry.shared
            ? 'The GitHub app\'s keys are deleted from this computer. The app stays installed on GitHub, as your other computers use it.'
            : 'The GitHub app\'s keys are deleted from this computer. The app is still installed on GitHub: on its installation page, click Uninstall.');
          for (const url of urls) await page('the app\'s installation page', url);
          break;
        }
        case 'untick-repository': {
          say(`Another project here still uses the GitHub app, so its keys stay: on its installation page, untick ${entry.repo} under repository access, then Save.`);
          await page('the app\'s installation page', connectionInstallationPage(record?.connection));
          break;
        }
        case 'revoke-key': {
          const setUp = byId.get(entry.ids.at(-1));
          const projectId = Number(entry.key.slice('gitlab-project-'.length));
          const repo = setUp?.after?.project ?? record?.repo ?? '';
          const holder = [...registeredProjects().map((p) => p.record), profileRemote()].find((r) => r?.connection?.projectId === projectId);
          const base = checkBaseUrl(holder?.connection?.baseUrl ?? GITLAB_URL);
          const got = await o.revokeGitlabKey({ name: entry.key, projectId, base, repo });
          if (got.found && !got.revoked && got.status !== 401) {
            halt(`GitLab did not revoke the ${entry.pasted ? 'token' : 'project key'}${got.status === null ? ' (it could not be reached)' : ` (HTTP ${got.status})`}, so its file was kept: open ${got.url}, revoke it, then ask for uninstall's plan again`);
          }
          // A key GitLab no longer accepts no longer works anywhere: its file goes too.
          if (got.status === 401) deleteKey(entry.key);
          mark(entry.ids, true, got.found ? undefined : 'no key was kept on this computer');
          say(got.found ? `${entry.line}.` : `No GitLab key was kept on this computer; check ${got.url} for any Wheelhouse made.`);
          break;
        }
        case 'remove':
        case 'remove-empty':
          removeOne(entry);
          break;
        case 'remove-plugin':
          say(`${entry.line}.`);
          break;
        case 'remove-plugin-scope': {
          const got = await o.removePluginScope(entry.change);
          if (!got.removed) halt(`Claude Code didn't remove Wheelhouse from your account (${got.why}), so uninstall stopped here`);
          mark(entry.ids, true);
          say(got.already ? 'Wheelhouse was already removed from Claude Code for your account.' : 'Wheelhouse is removed from Claude Code for your account.');
          break;
        }
        case 'remove-login-start': {
          const got = await removeLoginStart({ run, platform });
          say(got.removed ? 'What starts Wheelhouse\'s helper when you sign in is removed.' : `What starts Wheelhouse's helper when you sign in is not removed: ${got.why}.`);
          break;
        }
        default:
          halt(`uninstall's list holds a change it can't make (${entry.put})`);
      }
    }
    // Past the list's removal, whatever is left is the run's close.
    if (firstKeyFile !== -1) pastKeys = true;
    if (!askedYet) await asked();
    keepCommit();
    for (const d of plan.done) mark(d.ids, true, d.why);
    for (const k of plan.keep) mark(k.ids, false, k.why);
    for (const r of openRuns) closeRun(r.id, { at: now, by: 'uninstall' });
    if (removed > 0) say(`${removed} of Wheelhouse's own folders and files are removed from this computer.`);
    return { ok: true, lines, pages, ...(helperStops ? { helperStops: true } : {}) };
  } catch (error) {
    const why = error instanceof Halt ? error.message : `something went wrong: ${error instanceof Error ? error.message : 'no reason given'}`;
    // Past the trusted-keys list, only the run's close stops it, and a click made in this session
    // can't count: status says first to start a new session (UNINSTALL_NEW_SESSION, ruling R142).
    const next = pastKeys ? '.' : '; ask for uninstall\'s plan again for what is left.';
    return { ok: false, refused: `Uninstall stopped: ${why}. What it did before is marked and is not done again${next}`, lines, pages };
  }
}

// The process's own work: `argv` as above. `deps` replace parts for tests: `now`, `exit`, `tickMs`,
// and applyUninstall's `platform`, `run`, `fetch` and `ops`. Gives the exit code.
export async function runUninstall([folder, hash, clickedAt, deadlineText, userHome], {
  now = () => new Date(), exit = (code) => process.exit(code), tickMs = TICK_MS, platform = process.platform, run = realRun, fetch = globalThis.fetch, ops = {},
} = {}) {
  const clicked = Date.parse(clickedAt);
  const deadline = Date.parse(deadlineText);
  if (typeof folder !== 'string' || !path.isAbsolute(folder) || typeof userHome !== 'string' || !path.isAbsolute(userHome)) return 1;
  if (!Number.isFinite(clicked) || !Number.isFinite(deadline) || deadline > clicked + STEP_TIMEOUT_MS) return 1;
  // This uninstall: the record still names this click and this hash, and is running.
  const mine = (r) => r?.clickedAt === clickedAt && r.hash === hash && r.state === 'running';
  if (!mine(readProgress(folder))) return 1;
  let expired = false;
  const past = () => now().getTime() >= deadline - tickMs;
  // Records how it finished, only while the record is still this uninstall's.
  const finish = (answer) => {
    try {
      const record = readProgress(folder);
      if (!mine(record)) return;
      const { ok, ...rest } = answer;
      writeProgress(folder, { ...record, ...rest, state: ok ? 'done' : 'stopped', finishedAt: now().toISOString() });
    } catch { /* the record could not take it; status says it is stuck once its time is up */ }
  };
  const stop = (refused) => { finish({ ok: false, refused, lines: [], pages: [] }); return 1; };
  if (past()) return stop(`Uninstall stopped: it started more than ${STEP_TIMEOUT_MS / 60000} minutes after the click, so nothing was changed. Ask for uninstall's plan again.`);
  const ticker = setInterval(() => {
    if (!past()) return;
    expired = true;
    stop(`Uninstall stopped: it was still running ${STEP_TIMEOUT_MS / 60000} minutes after the click. What it did before is marked and is not done again; ask for uninstall's plan again for what is left.`);
    clearInterval(ticker);
    exit(1);
  }, tickMs);
  try {
    if (stopState().on) return stop('Uninstall stopped: All stop is on, so nothing was changed. Lift All stop first, then ask for uninstall\'s plan again.');
    const plan = await uninstallPlan({ folder, userHome, platform, run });
    if (plan.hash !== hash) return stop(`Uninstall stopped: ${UNINSTALL_CHANGED}. Nothing was changed.`);
    const done = await applyUninstall({ folder, plan, now, userHome, platform, run, fetch, ops, stopped: () => stopState().on || expired });
    if (expired) return 1;
    finish(done);
    return done.ok ? 0 : 1;
  } catch (error) {
    return stop(`Uninstall stopped: ${(error instanceof Error ? error.message : '') || 'it did not finish'}. Ask for uninstall's plan again for what is left.`);
  } finally {
    clearInterval(ticker);
  }
}

if (startedAsScript(import.meta.url)) {
  let code = 1;
  try {
    code = await runUninstall(process.argv.slice(2));
  } catch { /* nothing to report to: the progress record says what it could */ }
  process.exit(code);
}
