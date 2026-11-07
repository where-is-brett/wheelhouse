// scripts/update/routes.js
// The helper's update routes (update design, sections 4, 6 and 15), which scripts/update/cli.js asks from the session's sandbox:
//   /update/plan    the Update card and a hash of the plan it shows, or the one line when there is nothing to ask
//   /update/apply   starts the plan last shown, in a process of its own (scripts/update/run.js); never under All stop, never
//                   from a feature session, never for a hash that is not the plan last shown, never while an update runs,
//                   and never without the director's click: a verified, signed `update-click` action of this computer's own key,
//                   made after the plan was shown, naming its hash, both releases and whether it is an update or a put-back.
//                   An agent's own `plan` then `apply` therefore starts nothing.
//   /update/status  how the update stands, in lines, and the cards waiting for the director
//   /update/answer  relays an answer and signs nothing. Not now on the Update card keeps the declined release, but only after the
//                   director's signed click on that card with Not now. For a card
//                   the update raised (the approval of a release, the old helper's) it only checks that the prompt record or
//                   the helper's window signed the director's click, and wakes the job if it has stopped.
// Every look at the outside world is a seam, so a test starts no process and reaches no network.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn as nodeSpawn } from 'node:child_process';
import { caEnv } from '../host/company-ca.js';
import { canonicalJson } from '../lib/canonical.js';
import { compareVersions } from '../lib/versions.js';
import { jobFolder, stateDir, wheelhouseHome } from '../lib/paths.js';
import { projectForFolder } from '../lib/projects.js';
import { run as realRun } from '../lib/run.js';
import { listEvents } from '../state/events.js';
import { readEnrolled, verify } from '../state/signing.js';
import { claudeHome as claudeHomeDir } from '../lineage/manifest.js';
import { retiredInstalls } from './install.js';
import { accountCatalogue } from './account-settings.js';
import { runningVersion } from './board.js';
import { releaseKind, updateMirror } from './change.js';
import { decline } from './declined.js';
import { signedAnswer } from './finish.js';
import { helperCardFor, releaseCard, updateCard } from './cards.js';
import { openJournal, updateLockHeld } from './journal.js';
import { makePlan, partWay } from './plan.js';
import { checkTarget, fetchTag, listReleases } from './release.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUN_SCRIPT = path.join(PLUGIN_ROOT, 'scripts', 'update', 'run.js');

export const STOP_FIRST = 'Lift All stop first.';
export const UNDER_WAY = 'An update is already under way on this computer.';
export const NOT_SET_UP = 'Wheelhouse isn\'t set up on this folder, so there is nothing to update here. Set Wheelhouse up first.';
export const FEATURE_REFUSAL = 'Updating Wheelhouse is the director\'s own command: run it in the project\'s main folder, not in a feature session.';
export const LEAN_REFUSAL = 'This project runs at Lean, which updates by its own skill; ask for "update Wheelhouse" in the agent\'s chat.';
export const NOT_THE_PLAN = 'That is not the plan on the card last shown. Ask for the plan again.';
export const NO_SUCH_CARD = 'No card of the update has that name.';
export const NOT_CLICKED = 'The director has not clicked Update on the card for this plan, so nothing was started. Show the card and wait for the click.';
export const NOT_CLICKED_NOT_NOW = 'The director has not clicked Not now on the card for this plan, so nothing was recorded.';
export const NOT_SIGNED = 'That answer was not recorded by the card\'s own click, so nothing was done. Click the option on the card itself.';

const HASH = /^[0-9a-f]{64}$/;
const TAG = /^v\d+\.\d+\.\d+(?:-[A-Za-z0-9][A-Za-z0-9.-]{0,40})?$/;
const FULL_SHA = /^[0-9a-f]{40}$/;

class UpdateRefusal extends Error {}
const refuse = (why) => { throw new UpdateRefusal(why); };

const onlyFields = (body, fields) => {
  if (Object.keys(body).some((k) => !fields.includes(k))) refuse(`this request takes only ${fields.join(', ')}`);
};

const readJson = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
};

const realOf = (folder) => {
  try { return fs.realpathSync.native(folder); } catch { return null; }
};

// The project this folder is the main checkout of. A feature session's folder is a worktree inside it, which is refused,
// and so is a folder in no project or in a Lean project. The folder is the caller's own account of where it runs: the helper
// is reached over a local socket from a sandbox and has no way to tell which session is calling, so (as for the foreman's
// commands) a caller that names another folder is believed. What stops a feature session starting an update is therefore not
// this check but the director's signed click, which only the card shown in the director's own session earns.
function placeProject(folder) {
  if (typeof folder !== 'string' || !path.isAbsolute(folder)) refuse('the folder must be a full path');
  const real = realOf(folder);
  if (real === null) refuse('the folder was not found');
  const found = projectForFolder(real);
  if (!found) refuse(NOT_SET_UP);
  if (found.lean) refuse(LEAN_REFUSAL);
  const main = realOf(found.record.folder);
  const same = (a, b) => (process.platform === 'win32' || process.platform === 'darwin' ? a.toLowerCase() === b.toLowerCase() : a === b);
  if (main === null || !same(main, real)) refuse(FEATURE_REFUSAL);
  return { project: found.project, folder: main };
}

const planFile = (project) => path.join(openJournal(project).folder, 'plan.json');
const finishFile = (project) => path.join(openJournal(project).folder, 'finish.json');

function writeAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temp, file);
}

const hashOf = (project, plan) => crypto.createHash('sha256').update(canonicalJson({ project, plan })).digest('hex');

// The release the computer's Wheelhouse will be, as Claude Code's version floors need it: a line when this computer is below
// a floor the release names, else null.
export function floorLine({ nodeFloor, claudeFloor, nodeVersion = process.versions.node, claude = null }) {
  if (typeof nodeFloor === 'string' && compareVersions(nodeVersion, nodeFloor) === -1) {
    return `This release needs Node.js ${nodeFloor} or newer, and this computer has ${nodeVersion}. Install the newer Node.js from nodejs.org, then run /wheelhouse:update again.`;
  }
  if (typeof claudeFloor === 'string' && typeof claude === 'string' && compareVersions(claude, claudeFloor) === -1) {
    return `This release needs Claude Code ${claudeFloor} or newer, and this computer has ${claude}. Update Claude Code first, then run /wheelhouse:update again.`;
  }
  return null;
}

// The default for whether the director's click on a raised card was signed: a verified action of this computer's own key, in
// the project's state, for that card. An approval counts when it names the commit the card was named for.
export function signedByDefault({ project, card, label }) {
  const events = listEvents(stateDir(project), { report: () => {} });
  const enrolled = readEnrolled();
  if (/^update-helper-/.test(card)) return signedAnswer({ events, enrolled, card, options: [label] }) === label;
  const named = /^release-([0-9a-f]{40})$/.exec(card);
  if (named && label === 'Approve') {
    return events.some((e) => e?.kind === 'action' && e.data?.action === 'approve-release' && e.data.commit === named[1] && e.data.label === 'Approve' && verify(e, enrolled));
  }
  return false;
}

// Whether the director clicked `label` on the Update card for the plan last shown: a verified action of this computer's own
// key in the project's state, naming the plan's hash, both releases and the kind of move, and made after the plan was shown, so
// a click on another plan's card, or on an earlier showing of this one, is no click for it.
export function clickWasMade({ events, enrolled, stored, label }) {
  const plan = stored?.plan;
  if (!plan || typeof stored.at !== 'string' || !Array.isArray(events)) return false;
  return events.some((e) => e?.kind === 'action'
    && e.data?.action === 'update-click'
    && e.data.hash === stored.hash
    && e.data.from === plan.from
    && e.data.to === plan.to
    && e.data.put === plan.put
    && e.data.label === label
    && typeof e.at === 'string' && e.at > stored.at
    && verify(e, enrolled));
}
export function clickedByDefault({ project, stored, label }) {
  return clickWasMade({ events: listEvents(stateDir(project), { report: () => {} }), enrolled: readEnrolled(), stored, label });
}

// The steps' lines, in the voice of the main design: one line for each thing done, then what the running step waits for.
function milestones(steps, tag) {
  const lines = [];
  if (steps.checks?.state === 'done') lines.push(`Checked Wheelhouse ${tag}.`);
  const change = steps.change;
  if (change?.state === 'done') {
    const d = change.data ?? {};
    if (d.skipped === 'before-step-7') lines.push('This project does not name Wheelhouse in its settings yet, so only this computer moves.');
    else if (d.skipped === 'merged') lines.push(`This project already names ${tag}.`);
    else lines.push(`The change naming ${tag}${Number.isInteger(d.pr) ? ` (#${d.pr})` : ''} is open${d.approval === 'card' ? ', and waits for your approval' : ', and waits for its review'}.`);
  }
  if (steps.merged?.state === 'done' && steps.merged.data?.merged === true) lines.push(`The change naming ${tag} is merged.`);
  if (steps.idle?.state === 'done') lines.push('No work is in progress, so the install can go ahead.');
  if (steps.installs?.state === 'done') lines.push(`Wheelhouse ${tag} is installed on this computer.`);
  return lines;
}

export function updateRoutes({
  now = () => new Date(), stopped = () => false, updateHeld = updateLockHeld, from = runningVersion, userHome = os.homedir(),
  run = realRun, spawn = nodeSpawn, list, fetch, check, kind, locked, requirements, claudeVersion = async () => null, signed = signedByDefault, clicked = clickedByDefault,
  startRunner, account, retired,
} = {}) {
  const listing = list ?? (() => listReleases({ run }));
  const fetching = fetch ?? ((tag) => fetchTag({ ref: tag, run, mirror: updateMirror() }));
  const checking = check ?? (({ tag, sha }) => checkTarget({ tag, sha, run, mirror: updateMirror() }));
  const kindOf = kind ?? ((tag) => releaseKind({ tag, run }));
  const lockedBy = locked ?? (async ({ to }) => lockedFacts({ to, userHome }));
  const starting = new Set();

  const start = startRunner ?? (({ project, folder }) => {
    const child = spawn(process.execPath, [RUN_SCRIPT, project, folder], {
      cwd: jobFolder(), detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, ...caEnv(wheelhouseHome()) },
    });
    child?.on?.('error', () => {});
    child?.unref?.();
  });

  async function plan(body) {
    onlyFields(body, ['folder', 'tag']);
    const { project, folder } = placeProject(body.folder);
    if (body.tag !== undefined && (typeof body.tag !== 'string' || !TAG.test(body.tag))) refuse('the release must be named by a tag, such as v0.2.8');
    if (stopped()) return { ok: true, lines: [STOP_FIRST] };
    const journal = openJournal(project);
    const claude = await Promise.resolve().then(() => claudeVersion()).catch(() => null);
    const made = await makePlan({
      tag: body.tag ?? null,
      from: from(),
      journal: journal.read(),
      held: updateHeld(),
      list: listing,
      fetch: fetching,
      check: checking,
      kind: kindOf,
      requirements: (floors) => (requirements ?? floorLine)({ ...floors, claude }),
      account: account ?? (() => accountCatalogue({ claudeHome: claudeHomeDir() })),
      locked: lockedBy,
    });
    if (made.plan === undefined) return { ok: true, lines: made.lines };
    const removes = (retired ?? ((where) => retiredInstalls({ claudeHome: claudeHomeDir(), ...where })))({ projectDir: folder });
    const planned = removes.length > 0 ? { ...made.plan, removes } : made.plan;
    const hash = hashOf(project, planned);
    const card = updateCard({ ...planned, hash });
    writeAtomic(planFile(project), { hash, project, folder, at: now().toISOString(), plan: planned, card });
    return { ok: true, hash, card, lines: made.lines };
  }
  async function apply(body) {
    if (stopped()) return { ok: false, refused: STOP_FIRST };
    onlyFields(body, ['folder', 'hash']);
    const { project, folder } = placeProject(body.folder);
    if (typeof body.hash !== 'string' || !HASH.test(body.hash)) refuse('the hash must be the full hash of the plan on the card');
    const stored = readJson(planFile(project));
    if (stored?.hash !== body.hash || stored.project !== project) refuse(NOT_THE_PLAN);
    if (starting.has(project) || updateHeld()) refuse(UNDER_WAY);
    if (stored.used === true) refuse(NOT_THE_PLAN);
    if (!clicked({ project, stored, label: 'Update' })) refuse(NOT_CLICKED);
    starting.add(project);
    try {
      if (stopped()) return { ok: false, refused: STOP_FIRST };
      // A click starts one update: the plan is spent, and a later apply needs a new plan and a new click.
      writeAtomic(planFile(project), { ...stored, used: true });
      start({ project, folder });
    } finally {
      // The runner takes the lock itself; a second apply in the next moments is refused by the lock if it has started.
      setTimeout(() => starting.delete(project), 1500).unref?.();
    }
    return { ok: true, started: true, lines: [`Updating Wheelhouse to ${stored.plan.to}.`] };
  }

  async function status(body) {
    onlyFields(body, ['folder']);
    const { project } = placeProject(body.folder);
    const journal = openJournal(project);
    const read = journal.read();
    if (read.newer) return { ok: true, state: 'stopped', lines: ['This update was started by a newer Wheelhouse. Carry on with the newer Wheelhouse.'] };
    const steps = read.steps;
    const begun = Object.values(steps).some((s) => s.state !== 'todo');
    if (!begun) return { ok: true, state: 'none', lines: ['No update is under way on this computer.'] };
    const tag = steps.checks?.data?.tag ?? 'the new release';
    if (steps.done?.state === 'done') {
      return { ok: true, state: 'done', lines: [typeof steps.done.data?.line === 'string' ? steps.done.data.line : `Wheelhouse ${tag} is installed. Start a new session on this folder to use it.`] };
    }
    const held = updateHeld();
    const failed = Object.values(steps).find((s) => s.state === 'failed');
    const running = Object.values(steps).find((s) => s.state === 'running');
    const lines = [`${steps.checks?.data?.put === 'undo' ? 'Putting Wheelhouse back to' : 'Updating Wheelhouse to'} ${tag}.`, ...milestones(steps, tag)];
    let state = 'running';
    if (failed) {
      state = 'stopped';
      lines.push(`The update to ${tag} stopped: ${failed.data?.line ?? 'a step did not finish'}`, 'Type /wheelhouse:update to carry on.');
    } else if (!held) {
      state = 'stopped';
      lines.push(`The update to ${tag} is not running.`, 'Type /wheelhouse:update to carry on.');
    } else if (typeof running?.data?.line === 'string') {
      lines.push(running.data.line);
    }
    const asks = [];
    const card = steps.change?.data?.card;
    if (steps.change?.state === 'done' && card && steps.merged?.state !== 'done' && FULL_SHA.test(card.commit ?? '')
      && !signed({ project, card: `release-${card.commit}`, label: 'Approve' })) {
      asks.push({ id: `release-${card.commit}`, card: releaseCard({ previous: card.previous, release: card.release, commit: card.commit }).question });
    }
    const helper = readJson(finishFile(project))?.handover?.waiting?.card;
    if (helper && typeof helper.id === 'string' && Array.isArray(helper.options) && steps.finish?.state !== 'done'
      && !helper.options.some((label) => signed({ project, card: helper.id, label }))) {
      asks.push({ id: helper.id, card: helperCardFor(helper).question });
    }
    return { ok: true, state, lines, ...(asks.length > 0 ? { asks } : {}) };
  }

  async function answer(body) {
    onlyFields(body, ['folder', 'card', 'label']);
    const { project, folder } = placeProject(body.folder);
    if (typeof body.card !== 'string' || typeof body.label !== 'string') refuse(NO_SUCH_CARD);
    const stored = readJson(planFile(project));
    // The Update card is named by its plan's hash. Its Not now keeps the release declined; nothing is signed.
    if (HASH.test(body.card)) {
      if (stored?.hash !== body.card || body.label !== 'Not now') refuse(NO_SUCH_CARD);
      if (!clicked({ project, stored, label: 'Not now' })) refuse(NOT_CLICKED_NOT_NOW);
      if (stored.plan.put === 'release' && stored.plan.carryOn !== true) decline(project, stored.plan.to);
      return { ok: true, recorded: true, lines: [`Understood. Nothing changes, and ${stored.plan.to} won't be announced again.`] };
    }
    // The cards the update raised: the director's click was signed by the prompt record or the window, or there is no answer.
    const journal = openJournal(project).read();
    const raisedApproval = journal.steps?.change?.data?.card;
    const helper = readJson(finishFile(project))?.handover?.waiting?.card;
    const known = (helper && helper.id === body.card && helper.options?.includes(body.label))
      || (raisedApproval && body.card === `release-${raisedApproval.commit}` && ['Approve', 'Not now'].includes(body.label));
    if (!known) refuse(NO_SUCH_CARD);
    if (body.label === 'Not now') return { ok: true, recorded: false, lines: ['Nothing was installed. The update waits for your approval.'] };
    if (!signed({ project, card: body.card, label: body.label })) refuse(NOT_SIGNED);
    const waking = !updateHeld() && partWay(journal) !== null;
    if (waking && !starting.has(project)) start({ project, folder });
    return { ok: true, recorded: true, lines: [waking ? 'Carrying on with the update.' : 'Your answer is recorded.'] };
  }

  const guarded = (fn) => async (body) => {
    try {
      return await fn(body);
    } catch (error) {
      if (error instanceof UpdateRefusal) return { ok: false, refused: error.message };
      throw error;
    }
  };

  return {
    '/update/plan': guarded(plan),
    '/update/apply': guarded(apply),
    '/update/status': guarded(status),
    '/update/answer': guarded(answer),
  };
}

// Locked on this computer, and the other Locked projects still on an older release than the one offered. Reads files only;
// anything it can't read is "no Locked".
async function lockedFacts({ to, userHome }) {
  try {
    const { lockedProjects, managedDir } = await import('../protection/managed.js');
    const { ownFile } = await import('../protection/locked.js');
    const { registeredProjects } = await import('../lib/projects.js');
    const { projectRef } = await import('./board.js');
    const dir = managedDir();
    const list = lockedProjects({ dir });
    if (list.length === 0 || !ownFile(dir)) return { locked: false, others: [] };
    const norm = (f) => String(f).replace(/\\/g, '/').toLowerCase();
    const others = registeredProjects()
      .filter((p) => list.some((f) => norm(f) === norm(p.record.folder)))
      .filter((p) => { const ref = projectRef(p.record.folder); return ref !== null && compareVersions(ref, to) === -1; })
      .map((p) => path.basename(p.record.folder));
    return { locked: true, others, home: userHome };
  } catch {
    return { locked: false, others: [] };
  }
}
