// probes/haiku-trial/runner.js
// The Haiku trial's run script (spec section 7): the steps in order, the faults at their moments, the log that lets a run
// resume, and `restore`. Everything it touches arrives through `io`, so tests drive it with a fake and nothing real starts.
// Nothing here runs a trial until the director's go: the steps that create things ask first.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendJsonl } from '../lib/log.js';
import { projectSlug } from '../../scripts/lib/paths.js';
import { runFolder } from './results.js';
import { openPicker, readyToSubmit, deskBusy, HIGHLIGHTED, PICKED } from './stand-in.js';
import { PIECES, WAVES, P5_SPARE, F2_ANSWER, P6_FILE } from './requests.js';
import { SESSION_PREFIX, sessionName, sessionPrefix, frontDeskCommand } from './tmux.js';
import { STEPS as LOG, SETUP_DONE, setupJournalDone, OWN_BRANCH } from './signals.js';
import { STEPS as SETUP_STEPS } from '../../scripts/setup/steps.js';
import { auditModels } from './audit.js';
import { parseModel, DEFAULT_MODEL, MODELS } from './models.js';
import { STARTS_UNAPPROVED } from '../../scripts/foreman/queue.js';
import { installCommand, removeCommands } from './stage-plugin.js';
import { pointsFor, snapshotsDir, listSnapshots, readMeta, restoreLocal } from './snapshot.js';
import { WAVE_WAIT_MS, placeClicks, parseWindow, windowState, estimate, directorNote, minutesFor } from './sittings.js';
import { snapshotGh, rebuildGithub } from './github-snapshot.js';
import { reviewCard, stepsPage, writeTryMe, reviewAsDecision, answerLetter } from './review-card.js';

const MINUTE = 60 * 1000;
const DESK = 'desk';
const SETUP = 'setup';
const WHY_WAIT_MS = 100 * 1000 + 20 * 1000;
const SPARE_BRANCH = 'trial/spare-bug';
const SETUP_WAIT_MS = 45 * MINUTE;
// `alerts ntfy` waits two minutes for the click, so the desk is given a little longer to say how it went.
const NTFY_WAIT_MS = 150 * 1000;
const NOT_CLICKED = /did not click|nothing was changed|refused/i;
const NO_CHANNEL = /no channels?|nothing (?:is )?(?:set up|kept)|none (?:is |are )?set up/i;
// Setup's skill gives this line in prose, so the session words it its own way: "setup needs one new session on this
// folder", "the last safety checks need one new session in this folder: close this session, start a new one here".
export const NEW_SESSION = /needs? one new session|new session (?:on|in) this folder|start a new (?:one|session) (?:here|in this folder|on this folder)/i;
const TRUST_PROMPT = /trust the files in this folder|do you trust|trust this folder/i;
// The trust prompt's highlighted choice. Its first choice is "No, exit", so Enter alone ends the session.
const TRUST_YES = /❯\s*(?:\d+\.\s*)?Yes, I trust this folder/;
const pieceOf = (id) => PIECES.find((p) => p.id === id);

export class Stop extends Error {}
// A stop that ends the run whichever step raised it (the owner check).
class HardStop extends Stop {}

// --- the trial's own Wheelhouse home ---

const holds = (outer, inner) => {
  const rel = path.relative(outer, inner);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};
// The trial's setup journal, or null when it is missing, half written or not JSON: then setup is not known to be done.
export function readSetupJournal(home) {
  if (!home) return null;
  try { return JSON.parse(fs.readFileSync(path.join(home, 'setup', 'journal.json'), 'utf8')); } catch { return null; }
}
export const realWheelhouseHome =() => path.resolve(os.homedir(), '.wheelhouse');

// Where the trial keeps Wheelhouse's records, helper and engine state: its own folder, never the director's.
export function trialHome({ folder, env }) {
  return path.resolve(env.HAIKU_TRIAL_WHEELHOUSE_HOME || path.join(folder, 'wheelhouse-home'));
}

// Why the trial must not run in this environment, or null. The records, events and helper socket all follow WHEELHOUSE_HOME, and
// the in-process readers read the process's own, so the two must be the same folder and neither the real one.
export function homeProblem(env, processEnv = process.env) {
  if (!env.WHEELHOUSE_HOME) return 'WHEELHOUSE_HOME is not set, so the trial would use the real Wheelhouse home';
  const home = path.resolve(env.WHEELHOUSE_HOME);
  const real = realWheelhouseHome();
  if (holds(real, home) || holds(home, real)) return `WHEELHOUSE_HOME (${home}) is, or holds, the real Wheelhouse home (${real})`;
  if (!processEnv.WHEELHOUSE_HOME || path.resolve(processEnv.WHEELHOUSE_HOME) !== home) return 'WHEELHOUSE_HOME differs between the runner and its process, so some reads would reach another home';
  return null;
}

// What `io.host` does when a run hands it nothing: nothing happens and nothing is found.
const NOTHING = {
  events: async () => [],
  answerCards: async () => 0,
  readNtfy: async () => [],
  readConfig: async () => null,
  readMain: async () => null,
  readGate: async () => null,
  mainParseAmount: async () => ({ ok: false, why: 'not wired' }),
  setDigest: async () => ({ ok: false, why: 'not wired' }),
  typedRepliesOn: async () => null,
  nextDecisionNumber: async () => null,
  installDeps: async () => ({ ok: true, skipped: true }),
  findTranscripts: () => [],
  cloneMain: async ({ dir }) => dir,
  commitAndPush: async () => ({}),
  applySpareBug: () => ({ applied: false, why: 'not wired' }),
  startTunnel: async () => ({}),
  hasCommand: async () => true,
  stopWheelhouse: async () => ({ stopped: [], kept: [] }),
  installedProblem: async () => 'not wired',
  useRepo: () => {},
};

// --- waiting, logging, talking to the front desk ---

export async function waitFor(predicate, { io, timeoutMs, everyMs = 15000 }) {
  const end = io.clock.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return true;
    if (io.clock.now() >= end) return false;
    await io.clock.sleep(everyMs);
  }
}

const iso = (ctx) => new Date(ctx.io.clock.now()).toISOString();
const note = (ctx, step, text, extra = {}) => appendJsonl(ctx.logFile, { at: iso(ctx), step, note: text, ...extra });
// A fault the run went past: kept in the state, so the summary lists it, and written to the log.
async function addFinding(ctx, step, what, extra = {}) {
  (ctx.state.findings ??= []).push({ step, what, at: iso(ctx), ...extra });
  await note(ctx, step, `finding: ${what}`);
}
// The terminal's own furniture: spinners and their hints, boxes, the prompt line and the mode line.
const CHROME = [/esc to interrupt/i, /\(\d+s\b.*(tokens|thinking)/i, /^\s*[✻✽✶✳✢·✦*]\s+\S.*…/, /^\s*[─━│╭╮╰╯┌┐└┘├┤]/, /\? for shortcuts/i,
  /shift\+tab|bypass permissions|auto-accept|accept edits/i, /^\s*>\s*$/, /^\s*[⏵⏸]/];
export const withoutChrome = (text) => String(text).split('\n').filter((l) => !CHROME.some((re) => re.test(l))).join('\n');
const newLines = (before, after) => {
  const seen = new Set(String(before).split('\n'));
  return withoutChrome(String(after).split('\n').filter((l) => l.trim() !== '' && !seen.has(l)).join('\n'));
};

// Types into the front desk, waits for the pane to settle, and keeps what appeared as a reply.
// With `ready`, it keeps waiting (up to `maxMs`) until `ready(reply)` is true, as for an answer that comes from a fork.
async function say(ctx, text, { ready, maxMs = 90000 } = {}) {
  const { io, state } = ctx;
  await deskFree(ctx);
  const before = io.tmux.capture(DESK);
  io.tmux.type(DESK, text);
  let last = before;
  let still = 0;
  const end = io.clock.now() + maxMs;
  ctx.readyAt = undefined;
  while (io.clock.now() < end) {
    await io.clock.sleep(5000);
    const now = io.tmux.capture(DESK);
    still = now === last ? still + 1 : 0;
    last = now;
    await tick(ctx);
    // The moment a reply first qualified, not the moment the pane settled.
    if (ready !== undefined && ctx.readyAt === undefined && ready(newLines(before, last))) ctx.readyAt = io.clock.now();
    if (still >= 2 && (ready === undefined || ready(newLines(before, last)))) break;
  }
  const reply = newLines(before, last);
  if (reply !== '') state.panes.replies.push(reply);
  state.panes['front-desk'].push(last);
  return reply;
}

// A call that creates or merges something. A failure stops the run; it is never logged as done.
async function ghDo(ctx, args) {
  let got;
  try {
    got = await ctx.io.gh(args);
  } catch (error) {
    throw new Stop(`gh ${args.slice(0, 2).join(' ')} failed: ${error.message}`);
  }
  if (got?.ok === false) throw new Stop(`gh ${args.slice(0, 2).join(' ')} failed: ${got.why ?? 'no reason given'}`);
  return got;
}

async function ghPulls(ctx) {
  return (await ctx.io.gh(['api', 'repos/{owner}/{repo}/pulls?state=all&per_page=100'])) ?? [];
}
const mergedWork = (pulls) => pulls.filter((p) => p.merged_at && !OWN_BRANCH.test(p.head?.ref ?? ''));
const mergedPulls = async (ctx) => mergedWork(await ghPulls(ctx));
const pullOf = (pulls, text) => pulls.find((p) => text !== undefined && text !== '' && `${p.head?.ref ?? ''} ${p.title ?? ''}`.toLowerCase().includes(String(text).toLowerCase()));

// The tmux sessions this run started and has not ended itself. One that is gone ended by itself (a crash, or a prompt answered
// the wrong way), and nothing the run waits for can come from it, so the run stops.
const tmuxName = (ctx, name) => sessionName(ctx.label, name);
function endSession(ctx, name) {
  ctx.live?.delete(name);
  ctx.io.tmux.kill(name);
}
// The front desk that ends is opened again once in a wave, as a director would, and noted as a finding; a second loss in the
// same wave stops the run, as does any other session. `restart: false` is for the desk's own start, which must not recurse.
async function mustBeAlive(ctx, { restart = true } = {}) {
  if (!ctx.live?.size) return;
  const up = new Set(ctx.io.tmux.list());
  for (const name of [...ctx.live]) {
    if (up.has(tmuxName(ctx, name))) continue;
    const gone = `the ${name} session ended by itself (tmux ${tmuxName(ctx, name)} is gone)`;
    const wave = ctx.wave ?? 0;
    const restarts = ((ctx.state.deskRestarts ??= {})[wave] ??= 0);
    if (!restart || name !== DESK || restarts >= 1) throw new HardStop(gone);
    ctx.state.deskRestarts[wave] = restarts + 1;
    ctx.live.delete(name);
    await addFinding(ctx, 'front-desk', `${gone}; started again`);
    await desk(ctx, DESK);
  }
}

// The feature record steps in which the work's session is running (planned, paused and closed are not).
const FEATURE_RUNNING = ['started', 'building'];

// One look at the project: events become log entries, open cards get the director's stand-in answer, and F3b fires when armed.
async function tick(ctx) {
  const { io, state } = ctx;
  await mustBeAlive(ctx);
  const events = await io.host.events({ project: ctx.projectName });
  for (const e of events) {
    if (e.id === undefined || state.seen.includes(e.id)) continue;
    state.seen.push(e.id);
    // The watcher's work-ready is never written to the log, so it is read from the records it is made from: a quick or bug work
    // that is not shown first, and a signed approve-work.
    const ready = e.kind === 'work' && STARTS_UNAPPROVED.includes(e.data?.lane) && e.data?.visible === false ? e.data.id
      : e.kind === 'action' && e.data?.action === 'approve-work' && (e.verified === true || e.sig) ? e.data.work : null;
    if (typeof ready === 'string') await note(ctx, LOG.workReady, `work-ready ${ready}`, { work: ready, at: e.at ?? iso(ctx) });
    if (e.kind === 'run' && e.data?.state === 'started') await note(ctx, LOG.start, `started ${e.data.work ?? ''}`, { work: e.data.work, at: e.at ?? iso(ctx) });
    // The front desk's own layout keeps a feature's session in its feature record, not in a run record: a session starts when
    // its record says started or building.
    if (e.kind === 'feature' && FEATURE_RUNNING.includes(e.data?.step)) await note(ctx, LOG.start, `started ${e.data.work ?? ''}`, { work: e.data.work, at: e.at ?? iso(ctx) });
  }
  const open = new Set();
  let features = 0;
  for (const e of events.filter((x) => x.kind === 'run')) {
    const key = e.data?.runId ?? e.id;
    if (e.data?.state === 'started') { open.add(key); if (e.data.lane === 'feature') features += 1; } else open.delete(key);
  }
  // A feature work counts while its latest record says its session is running.
  const running = new Set();
  for (const e of events.filter((x) => x.kind === 'feature' && typeof x.data?.work === 'string')) {
    if (FEATURE_RUNNING.includes(e.data.step)) running.add(e.data.work); else running.delete(e.data.work);
  }
  const building = open.size + running.size;
  const lanes = features + running.size;
  if (building > 0 && state.pace !== `${building},${lanes}`) {
    state.pace = `${building},${lanes}`;
    await note(ctx, LOG.pace, `building ${building}, feature ${lanes}`);
  }
  await linkLateWork(ctx, events);
  // P4's decisions are the live decision script's own (s9), so the stand-in leaves them to it.
  const skipWork = [state.pieces.P4?.change].filter((w) => typeof w === 'string');
  await io.host.answerCards({ project: ctx.projectName, tmux: io.tmux, events, session: ctx.session ?? DESK, skipWork });
  await staleDeskPicker(ctx);
  await checkIn(ctx, events);
  if (state.ntfyTopic) {
    for (const m of await io.host.readNtfy({ topic: state.ntfyTopic })) if (!state.ntfy.some((x) => x.at === m.at && x.text === m.text)) state.ntfy.push(m);
  }
  if (state.f3bArmed && !state.f3bDone) {
    const p4 = pullOf(await ghPulls(ctx), state.pieces.P4?.change ?? 'p4');
    if (p4?.merged_at) {
      state.f3bDone = true;
      const killed = await io.faults.f3bKillForeman({}).catch((error) => ({ error: error.message }));
      await note(ctx, LOG.fault('F3b'), `foreman killed after P4 merged: ${JSON.stringify(killed)}`);
    }
  }
}

// The works whose sessions are running now, from the record, as `tick` reads it.
function runningWorks(events) {
  const open = new Map();
  for (const e of events.filter((x) => x.kind === 'run')) {
    const key = e.data?.runId ?? e.id;
    if (e.data?.state === 'started') open.set(key, e.data.work ?? key); else open.delete(key);
  }
  const running = new Set();
  for (const e of events.filter((x) => x.kind === 'feature' && typeof x.data?.work === 'string')) {
    if (FEATURE_RUNNING.includes(e.data.step)) running.add(e.data.work); else running.delete(e.data.work);
  }
  return [...new Set([...open.values(), ...running])];
}

// A snapshot at a step boundary (spec section 3.2). An `after-` point first waits up to ten minutes for no session to be running;
// a `before-` point is taken at once. A snapshot that fails is a finding and never a stop.
const writeState = (ctx) => fs.writeFileSync(ctx.stateFile, `${JSON.stringify(ctx.state, null, 2)}\n`);
async function snapshotAt(ctx, { point, step }) {
  const { io } = ctx;
  if (!io.snapshot?.take) return;
  try {
    let running = runningWorks(await io.host.events({ project: ctx.projectName }));
    if (point.startsWith('after-') && running.length > 0) {
      await waitFor(async () => { await tick(ctx); running = runningWorks(await io.host.events({ project: ctx.projectName })); return running.length === 0; }, { io, timeoutMs: 10 * MINUTE, everyMs: 30000 });
    }
    writeState(ctx);
    const meta = { label: ctx.label, mode: ctx.mode, sittings: ctx.state.sittings, point, step, at: iso(ctx), attempt: ctx.state.resumedFrom?.attempt ?? 1, pluginSha: ctx.state.stage?.sha, quiet: running.length === 0, running };
    const configDir = ctx.env.HAIKU_TRIAL_CONFIG_DIR;
    const transcripts = io.host.findTranscripts({ project: ctx.projectName, dir: ctx.projectDir }).map((t) => t.file).filter((f) => typeof f === 'string');
    const got = await io.snapshot.take({ label: ctx.label, point, folder: ctx.folder, configDir, transcripts, meta, seedSha: ctx.state.seedSha });
    await note(ctx, `snapshot-${point}`, `snapshot ${got?.name ?? point}${meta.quiet ? '' : ` (not quiet: ${running.join(', ')} still running)`}`);
  } catch (error) {
    await addFinding(ctx, `snapshot-${point}`, `snapshot ${point} failed: ${error.message}`);
  }
}

// Waits for `count` merged pull requests, less what an earlier wave fell short by. A shortfall is noted and kept in
// `state.shortfall` (as the total still missing), so the wave's evidence still comes and later waits ask for that many fewer.
async function waitMerged(ctx, count, wave) {
  const target = mergesBy(ctx, count);
  const ok = await waitFor(async () => {
    await tick(ctx);
    return (await mergedPulls(ctx)).length >= target;
  }, { io: ctx.io, timeoutMs: WAVE_WAIT_MS[wave] ?? 60 * MINUTE });
  if (ok) return target;
  const merged = (await mergedPulls(ctx)).length;
  ctx.state.shortfall = Math.max(0, count - merged);
  await note(ctx, `w${wave}-merge-wait`, `missed: ${merged} of ${count} pull requests merged in time for wave ${wave}; the run goes on and later waits ask for ${ctx.state.shortfall} fewer`);
  if (wave > 2) await addFinding(ctx, `w${wave}-merge-wait`, `fewer than ${count} pull requests merged in time for wave ${wave} (${merged} did)`);
  return merged;
}
// What a wait asks for: the count it would, less what an earlier wave fell short by.
const mergesBy = (ctx, count) => Math.max(0, count - (ctx.state.shortfall ?? 0));

// Whether a branch in the project's own folder that names the piece has a commit of its own. A build commits in its
// worktree and pushes only when it opens its pull request, so GitHub sees the first commit late or not at all.
async function localCommit(ctx, piece) {
  try {
    const refs = String(await ctx.io.host.git(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], { cwd: ctx.projectDir }));
    const branch = refs.split('\n').map((l) => l.trim()).find((n) => n !== '' && n.toLowerCase().includes(String(piece).toLowerCase()));
    if (!branch) return false;
    return Number(String(await ctx.io.host.git(['rev-list', '--count', `main..${branch}`], { cwd: ctx.projectDir })).trim()) > 0;
  } catch {
    return false;
  }
}

// Text typed while a picker is open goes into the picker, and text typed while the desk is working lands in a reply being
// written or is lost. So before anything is typed to the front desk it waits for no picker, no submit page and no
// spinner, seen twice a few seconds apart. After ten minutes it types anyway, and the wait is noted.
const DESK_CALM_MS = 3000;
async function deskFree(ctx) {
  const { io } = ctx;
  const taken = () => { const pane = io.tmux.capture(DESK); return openPicker(pane) !== null || readyToSubmit(pane) || deskBusy(pane); };
  const calm = async () => {
    if (taken()) return false;
    await io.clock.sleep(DESK_CALM_MS);
    return !taken();
  };
  if (await calm()) return;
  const free = await waitFor(async () => { await tick(ctx); return calm(); }, { io, timeoutMs: 10 * MINUTE, everyMs: 10000 });
  if (!free) await note(ctx, LOG.health, 'the front desk stayed busy or had a picker open for 10 minutes; typing anyway');
}

// Types to the front desk once it is free.
async function typeToDesk(ctx, text) {
  await deskFree(ctx);
  ctx.io.tmux.type(DESK, text);
}

// The stand-in director's reply when a request is met with questions in the chat and no card: what a director who takes
// every recommendation would say.
export const FOLLOW_UP = 'Go with what you recommend on each question, and take it to a card.';

// Types a piece's request, answers intake's visibility question for P8, and notes which work event it became.
async function typeRequest(ctx, id, text = pieceOf(id).text) {
  const { io, state } = ctx;
  await deskFree(ctx);
  const known = new Set((await io.host.events({ project: ctx.projectName })).filter((e) => e.kind === 'work').map((e) => e.data?.id));
  let answered = false;
  let followed = false;
  const before = io.tmux.capture(DESK);
  state.pieces[id] = { ...(state.pieces[id] ?? {}), typedFrom: iso(ctx) };
  io.tmux.type(DESK, text);
  const started = io.clock.now();
  let last = '';
  let still = 0;
  const found = [];
  await waitFor(async () => {
    const work = (await io.host.events({ project: ctx.projectName })).filter((e) => e.kind === 'work' && !known.has(e.data?.id));
    if (work.length > 0) { found.push(work[0]); return true; }
    const pane = io.tmux.capture(DESK);
    if (id === 'P8' && !answered && /nobody sees|anyone see|visible/i.test(pane)) { answered = true; await typeToDesk(ctx, F2_ANSWER); }
    still = pane === last ? still + 1 : 0;
    last = pane;
    // The desk has finished its reply, made no work, opened no picker, and asked something: the stand-in answers once.
    if (!followed && id !== 'P8' && still >= 2 && io.clock.now() - started >= 2 * MINUTE && openPicker(pane) === null && /\?/.test(newLines(before, pane))) {
      followed = true;
      await typeToDesk(ctx, FOLLOW_UP);
      await note(ctx, id, `the desk asked questions and made no work; the stand-in answered: ${FOLLOW_UP}`);
    }
    await tick(ctx);
    return false;
  }, { io, timeoutMs: 10 * MINUTE, everyMs: 10000 });
  state.pieces[id] = { ...state.pieces[id], change: found[0]?.data?.id, typedAt: iso(ctx) };
  await note(ctx, id, found.length > 0 ? `typed; became work ${found[0].data?.id}` : 'typed; no work event seen yet', { work: found[0]?.data?.id });
}

// A piece whose work was not seen while it was typed is linked to the first work made after it was typed that no other
// piece has, in the order the pieces were typed.
async function linkLateWork(ctx, events) {
  const { state } = ctx;
  const waiting = Object.entries(state.pieces).filter(([, p]) => p.typedAt && !p.change && p.typedFrom).sort(([, a], [, b]) => (a.typedFrom < b.typedFrom ? -1 : 1));
  if (waiting.length === 0) return;
  const claimed = new Set(Object.values(state.pieces).map((p) => p.change).filter(Boolean));
  for (const [id, piece] of waiting) {
    const work = events.find((e) => e.kind === 'work' && typeof e.data?.id === 'string' && !claimed.has(e.data.id) && String(e.at ?? '') >= piece.typedFrom);
    if (!work) continue;
    piece.change = work.data.id;
    claimed.add(work.data.id);
    await note(ctx, id, `became work ${work.data.id} later`, { work: work.data.id });
  }
}

async function typeWave(ctx, wave, { only } = {}) {
  for (const id of WAVES[wave]) {
    if (only && !only.includes(id)) continue;
    if (id === 'P5' && ctx.state.p5 === 'not-covered') continue;
    await typeRequest(ctx, id, id === 'P5' && ctx.state.p5 === 'spare' ? P5_SPARE : undefined);
  }
}

// --- the planted bug, gone before P5 ---

async function spareBugCheck(ctx) {
  const { io, state, folder } = ctx;
  const read = await io.host.mainParseAmount({ dir: ctx.projectDir });
  if (read?.ok === false) {
    await note(ctx, 'plant', `could not read main's parseAmount: ${read.why ?? 'no reason given'}`);
    return;
  }
  const amount = read?.amount;
  if (!(typeof amount === 'number' && amount < 0)) return;
  await note(ctx, 'plant', 'planted bug already gone', { amount });
  const dir = path.join(folder, 'spare');
  await io.host.cloneMain({ url: ctx.remote, dir, branch: SPARE_BRANCH });
  const got = io.host.applySpareBug(dir);
  if (got.applied !== true) {
    state.p5 = 'not-covered';
    state.p5Why = got.why ?? 'the spare bug could not be applied';
    await note(ctx, 'plant', `P5 not covered: ${state.p5Why}`);
    return;
  }
  await io.host.commitAndPush({ dir, branch: SPARE_BRANCH, message: 'Plant the spare bug for the trial' });
  // A pull request that cannot be made or merged leaves the planted bug in doubt, so P5 is not covered and the run goes on.
  try {
    await ghDo(ctx, ['pr', 'create', '--head', SPARE_BRANCH, '--base', 'main', '--title', 'Plant the spare bug for the trial', '--body', 'The trial plants this bug for piece P5.']);
    await ghDo(ctx, ['pr', 'merge', SPARE_BRANCH, '--squash', '--admin']);
  } catch (error) {
    state.p5 = 'not-covered';
    state.p5Why = `the spare bug's pull request failed: ${error.message}`;
    await note(ctx, 'plant', `P5 not covered: ${state.p5Why}`);
    await addFinding(ctx, 'w2-merge-wait', state.p5Why);
    return;
  }
  state.p5 = 'spare';
  await note(ctx, 'plant', 'spare bug merged; P5 will use the spare request');
}

// --- the steps ---

const piecesTyped = (wave) => async (ctx) => typeWave(ctx, wave);
const needsGo = true;

// The model's name as a person reads it: Haiku, Sonnet.
const modelName = (ctx) => { const m = ctx.model ?? DEFAULT_MODEL; return m[0].toUpperCase() + m.slice(1); };

async function desk(ctx, name, extraEnv = {}) {
  const { io } = ctx;
  const { command, env } = frontDeskCommand({ claude: ctx.claude, model: ctx.model });
  // The trial's own Wheelhouse home and Claude config folder go in explicitly: the session starts with `env -i`, and the helper it
  // wakes (and so every feature session) takes its environment from this one.
  const own = { WHEELHOUSE_HOME: ctx.env.WHEELHOUSE_HOME, ...(ctx.env.HAIKU_TRIAL_CONFIG_DIR ? { CLAUDE_CONFIG_DIR: ctx.env.HAIKU_TRIAL_CONFIG_DIR } : {}) };
  io.tmux.start({ name, cwd: ctx.projectDir, command, env: { ...env, ...own, ...extraEnv } });
  (ctx.live ??= new Set()).add(name);
  await note(ctx, name === DESK ? 'front-desk' : name, `started tmux session ${tmuxName(ctx, name)}`, { detail: { tmux: tmuxName(ctx, name) } });
  await ctx.io.clock.sleep(15000);
  // A fresh folder asks to be trusted before anything else. Its first choice is "No, exit", so Yes is chosen by moving down to it
  // and seeing it highlighted before Enter.
  for (let i = 0; i < 3 && TRUST_PROMPT.test(io.tmux.capture(name)); i += 1) {
    let onYes = TRUST_YES.test(io.tmux.capture(name));
    for (let down = 0; down < 3 && !onYes; down += 1) {
      io.tmux.keys(name, 'Down');
      await ctx.io.clock.sleep(1000);
      onYes = TRUST_YES.test(io.tmux.capture(name));
    }
    if (!onYes) throw new Stop(`the ${name} session's folder-trust prompt never highlighted "Yes, I trust this folder"`);
    io.tmux.keys(name, 'Enter');
    await note(ctx, name === DESK ? 'front-desk' : name, 'answered the folder-trust prompt: Yes, I trust this folder');
    await ctx.io.clock.sleep(5000);
  }
  await mustBeAlive(ctx, { restart: false });
}

// The stand-in director's answer to the picker open in a session's pane: the recommended option, or the first when none
// is marked. The cursor is moved to it and seen there before Enter. Returns whether a picker was answered.
async function answerPicker(ctx, name) {
  const { io } = ctx;
  const look = () => openPicker(io.tmux.capture(name));
  const first = look();
  if (first === null) return false;
  const target = first.recommended === -1 ? 0 : first.recommended;
  const question = (first.question.split('\n').find((l) => l.replace(/[│\s]/g, '') !== '') ?? '').replace(/[☐│]/g, '').trim().slice(0, 160);
  for (let moves = 0; moves < first.options.length; moves += 1) {
    const now = look();
    const index = now?.options.findIndex((l) => HIGHLIGHTED.test(l)) ?? -1;
    if (index === target) break;
    io.tmux.keys(name, index < target ? 'Down' : 'Up');
    await io.clock.sleep(500);
  }
  const chosen = look()?.options.findIndex((l) => HIGHLIGHTED.test(l));
  if (chosen !== target) {
    const why = `the ${name} session's picker "${question}" never highlighted ${first.recommended === -1 ? 'its first option' : 'its recommended option'}`;
    // Setup has its own time limit and stops on this; elsewhere the picker is noted once and the run goes on.
    if (ctx.inSetup) throw new Stop(why);
    const missed = (ctx.state.pickersMissed ??= []);
    if (!missed.includes(question)) {
      missed.push(question);
      await addFinding(ctx, name === DESK ? 'front-desk' : name, why);
    }
    return false;
  }
  const label = first.options[target].replace(HIGHLIGHTED, '').replace(/^\s*\d+\.\s*/, '').trim();
  io.tmux.keys(name, 'Enter');
  await note(ctx, name === DESK ? 'front-desk' : name, `answered the picker "${question}": ${label}`);
  await io.clock.sleep(3000);
  return true;
}

// The stand-in director checks in, as a director does now and then: the desk shows waiting cards and decisions when the
// director writes to it, so with the desk idle a while and something waiting in the record, it asks, at most every ten
// minutes. Never during a step that is the director's own.
export const CHECK_IN = 'Anything waiting for me?';
const CHECK_IN_IDLE_MS = 3 * MINUTE;
const CHECK_IN_EVERY_MS = 10 * MINUTE;
export function waitingInRecord(events) {
  // A card-answer names the card's question text (`{question, label, where}`); a record that names the card's id is read too.
  const answers = events.filter((e) => e.kind === 'card-answer');
  const answeredCards = new Set(answers.map((e) => e.data?.card).filter((c) => typeof c === 'string'));
  const answeredAsked = new Set(answers.map((e) => e.data?.question).filter((q) => typeof q === 'string' && q !== ''));
  const answeredQuestions = new Set(events.filter((e) => e.kind === 'action' && e.data?.action === 'answer').map((e) => e.data?.questionId));
  const cards = events.filter((e) => e.kind === 'card' && PICKED.includes(e.data?.kind) && !answeredCards.has(e.id) && !answeredAsked.has(e.data?.question));
  const questions = events.filter((e) => e.kind === 'question' && typeof e.data?.id === 'string' && !answeredQuestions.has(e.data.id));
  // A visible work waits for the director's approval from the moment of intake, before any card is raised for it: the desk
  // may not have raised one at all, and the stand-in would never see a card to answer.
  const approved = new Set(events.filter((e) => e.kind === 'action' && e.data?.action === 'approve-work').map((e) => e.data?.work));
  const carded = events.filter((e) => e.kind === 'card' && e.data?.kind === 'approve-work').map((e) => JSON.stringify(e.data));
  const unseen = events.filter((e) => e.kind === 'work' && e.data?.visible === true && typeof e.data.id === 'string'
    && !approved.has(e.data.id) && !carded.some((c) => c.includes(e.data.id)));
  // A click the merge gate waits for (a gate-asks record) waits from the moment it is recorded: the desk makes its card only
  // when it next runs, so until a card stands for it, or the click or the work's report is on record, it counts here.
  const after = (e, g) => Date.parse(e.at ?? '') >= Date.parse(g.at ?? '');
  const asks = events.filter((g) => g.kind === 'gate-asks' && typeof g.data?.work === 'string' && !events.some((e) => after(e, g) && (
    (e.kind === 'card' && e.data?.kind === g.data.ask && JSON.stringify(e.data).includes(Number.isInteger(g.data.pr) ? `#${g.data.pr}` : g.data.work))
    || (e.kind === 'approval' && Number.isInteger(g.data.pr) && e.data?.pr === g.data.pr)
    || (e.kind === 'report' && e.data?.work === g.data.work))));
  return cards.length + questions.length + unseen.length + asks.length;
}
async function checkIn(ctx, events) {
  const { io, state } = ctx;
  if (ctx.directorStep || (ctx.session ?? DESK) !== DESK) { ctx.deskIdle = undefined; return; }
  const pane = io.tmux.capture(DESK);
  if (pane === '' || openPicker(pane) !== null || deskBusy(pane)) { ctx.deskIdle = undefined; return; }
  if (ctx.deskIdle?.pane !== pane) { ctx.deskIdle = { pane, since: io.clock.now() }; return; }
  if (io.clock.now() - ctx.deskIdle.since < CHECK_IN_IDLE_MS) return;
  if (state.checkedInAt !== undefined && io.clock.now() - state.checkedInAt < CHECK_IN_EVERY_MS) return;
  const waiting = waitingInRecord(events);
  if (waiting === 0) return;
  state.checkedInAt = io.clock.now();
  ctx.deskIdle = undefined;
  io.tmux.type(DESK, CHECK_IN);
  await note(ctx, 'front-desk', `the desk was idle with ${waiting} waiting in the record; the stand-in checked in: ${CHECK_IN}`);
}

// A picker in the front desk that no card in the record stands for (setup's last card when setup carries on in the desk,
// or a question of the desk's own) gets the stand-in's answer once it has stayed open for a while. Never during a step
// that is the director's own.
const STALE_PICKER_MS = 3 * MINUTE;
async function staleDeskPicker(ctx) {
  const { io } = ctx;
  if (ctx.directorStep || (ctx.session ?? DESK) !== DESK) { ctx.deskPicker = undefined; return; }
  const picker = openPicker(io.tmux.capture(DESK));
  if (picker === null) { ctx.deskPicker = undefined; return; }
  if (ctx.deskPicker?.question !== picker.question) { ctx.deskPicker = { question: picker.question, since: io.clock.now() }; return; }
  if (io.clock.now() - ctx.deskPicker.since < STALE_PICKER_MS) return;
  ctx.deskPicker = undefined;
  await answerPicker(ctx, DESK);
}

// The saved environment of a piece's feature session, or null when none is found. Once none was found, later looks are one
// look each, with no wait, so F1b, F1c and the later P4 steps do not wait another 40 minutes; a session that turns up is still found.
async function pieceEnv(ctx, id) {
  const piece = ctx.state.pieces[id]?.change ?? id.toLowerCase();
  let got;
  const noSession = (ctx.state.noSession ??= {});
  const found = await waitFor(async () => {
    try { got = await ctx.io.faults.featureEnvOf({ project: ctx.projectDir, name: ctx.projectName, piece }); return true; } catch (error) {
      // Only a session not found yet is worth waiting for; any other error is the runner's own and stops it at once.
      if (!/^No running feature session/.test(error?.message ?? '')) throw error;
      await tick(ctx);
      return false;
    }
  }, { io: ctx.io, timeoutMs: noSession[id] ? 0 : 40 * MINUTE });
  if (!found) {
    noSession[id] = true;
    await note(ctx, id, `no running feature session names ${id}`);
    return null;
  }
  delete noSession[id];
  return got;
}
const noSessionWhy = (id) => `no running feature session names ${id}`;

const directorAsk = async (ctx, text) => {
  const answer = await ctx.io.ask(text);
  await note(ctx, 'director', `${text} -> ${answer}`);
  return answer;
};

// After a wave's merges: one transcript on another model fails the whole run (spec section 4.3), so it is found now, not at the end.
const auditStep = (wave, smoke = true) => ({
  id: `w${wave}-audit`, wave, smoke,
  async run(ctx, io) {
    const models = auditModels(io.host.findTranscripts({ project: ctx.projectName, dir: ctx.projectDir }), { model: ctx.model });
    await note(ctx, `w${wave}-audit`, models.clean ? `every assistant turn so far ran on ${modelName(ctx)}` : `offenders: ${JSON.stringify(models.offenders.map((o) => `${o.role} ${o.model} x${o.count}`))}`);
    // The run can no longer pass, but it goes on finding faults.
    if (!models.clean) await addFinding(ctx, `w${wave}-audit`, `a session ran on another model: ${models.offenders.map((o) => `${o.role} (${o.model})`).join(', ')}`, { claimLost: 'model audit' });
  },
});

// A fault step that could not run: the rows read this as not covered, with the reason.
async function notExercised(ctx, id, why) {
  ctx.state.faults[id] = { ...(ctx.state.faults[id] ?? {}), notExercised: why };
  await note(ctx, LOG.fault(id), `not exercised: ${why}`);
}

// --- the director's sittings (spec 2026-11-13, section 5) ---

const CLICK_WAIT_MS = 15 * MINUTE;
const sittingId = (n) => `sitting-${n}`;
const eventsOf = (ctx) => ctx.io.host.events({ project: ctx.projectName });
const isAction = (e, ...actions) => e.kind === 'action' && actions.includes(e.data?.action);
// An event made at or after `since` (one with no readable time counts: a record without a time cannot be told from a later one).
const notBefore = (e, since) => !(Date.parse(e.at) < since);

// Whether All stop was typed in this run and no signed lift followed it.
const stopIsOn = async (ctx) => {
  const { stopAt } = ctx.state;
  if (stopAt === undefined) return false;
  return !(await eventsOf(ctx)).some((e) => isAction(e, 'lift-stop') && notBefore(e, stopAt - 1000));
};

// Waits for the director's signed lift. If it does not come it is a finding, and the one terminal ask of the sitting follows: All
// stop holds every merge and start until it is lifted, so nothing else goes on before that ask is answered.
async function liftWatch(ctx, io, n) {
  const lifted = async () => (await stopIsOn(ctx)) === false;
  if (await waitFor(async () => { await tick(ctx); return lifted(); }, { io, timeoutMs: CLICK_WAIT_MS })) {
    await note(ctx, 'f6-lift', 'All stop lifted');
    return true;
  }
  await addFinding(ctx, sittingId(n), `the director's click did not come in sitting ${n}: lifting All stop`);
  ctx.state.liftAskedIn = n;
  await directorAsk(ctx, 'All stop is still on: lift it in the helper window when you can, then answer done.');
  if (!(await lifted())) return false;
  await note(ctx, 'f6-lift', 'All stop lifted');
  return true;
}

// Before any click is waited for: a stop that is on (typed by an F6 that then failed, or by an earlier attempt) is lifted first.
async function liftIfStopped(ctx, io, n) {
  if (ctx.state.liftAskedIn === n || !(await stopIsOn(ctx))) return;
  await deskFree(ctx);
  await io.faults.liftTyped(io.tmux);
  await liftWatch(ctx, io, n);
}

// What a later commit on main touched among P6's files: an undo of P6 that clashes is the kit's fault, not Wheelhouse's, so the
// finding is made before the undo is typed.
async function undoClash(ctx, sha, n) {
  if (sha === 'unknown') return;
  const git = (args) => ctx.io.host.git(args, { cwd: ctx.projectDir });
  try { await git(['fetch', 'origin', 'main']); } catch { /* the local main is what there is */ }
  let log;
  try { log = String(await git(['log', `${sha}..origin/main`, '--name-only', '--format=commit %h %s'])); } catch {
    try { log = String(await git(['log', `${sha}..main`, '--name-only', '--format=commit %h %s'])); } catch { return; }
  }
  let commit = '';
  for (const line of log.split('\n').map((l) => l.trim()).filter(Boolean)) {
    if (line.startsWith('commit ')) { commit = line.slice(7).split(' ')[0]; continue; }
    if (line === P6_FILE) { await addFinding(ctx, sittingId(n), `F5a will clash: ${commit} touched ${line}`); return; }
  }
}

// The director's signed answer to an undo card: an undo of that merge, or Keep it, made after the undo was typed.
const sameSha = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length >= 7 && b.length >= 7 && (a.startsWith(b) || b.startsWith(a));
const undoAnswered = (ctx, sha, since) => async () => {
  await tick(ctx);
  return (await eventsOf(ctx)).some((e) => notBefore(e, since) && (
    (isAction(e, 'undo-merge') && (sha === 'unknown' || sameSha(e.data?.merge, sha))) || isAction(e, 'keep-main')));
};

const clickSteps = {
  // F6: All stop typed, an undo refused under it, five minutes, then the lift (the director's click).
  async F6(ctx, io, { n }) {
    await deskFree(ctx);
    const at = io.clock.now();
    await io.faults.f6AllStop(io.tmux);
    ctx.state.stopAt = at;
    await io.clock.sleep(10000);
    await note(ctx, LOG.stopSet, 'All stop typed', { detail: { at } });
    await note(ctx, LOG.fault('F6'), 'All stop set');
    const sha = await p6Sha(ctx);
    await deskFree(ctx);
    await io.faults.undoTyped(io.tmux, sha);
    await io.clock.sleep(20000);
    await note(ctx, 'f6-undo', `undo typed under All stop: ${io.tmux.capture(DESK).split('\n').filter((l) => /All stop is on/.test(l)).join(' ') || 'no refusal text seen'}`);
    const until = at + 5 * MINUTE;
    await waitFor(async () => { await tick(ctx); return io.clock.now() >= until; }, { io, timeoutMs: 6 * MINUTE });
    ctx.state.panes['front-desk'].push(io.tmux.capture(DESK));
    await note(ctx, 'f6-wait-5m', 'five minutes with no new start allowed');
    await deskFree(ctx);
    await io.faults.liftTyped(io.tmux);
    io.log?.('Click Lift All stop in the helper window.');
    await liftWatch(ctx, io, n);
  },
  // F5a: the undo of P6, approved by the director's signed click.
  async F5a(ctx, io, { n }) {
    const sha = await p6Sha(ctx);
    await undoClash(ctx, sha, n);
    await deskFree(ctx);
    const typedAt = io.clock.now();
    await io.faults.undoTyped(io.tmux, sha);
    io.log?.("Click Approve on the undo of piece P6's merge in the helper window (the first of two).");
    if (!(await waitFor(undoAnswered(ctx, sha, typedAt), { io, timeoutMs: CLICK_WAIT_MS }))) {
      await addFinding(ctx, sittingId(n), `the director's click did not come in sitting ${n}: the undo of P6`);
      return;
    }
    await waitFor(async () => { await tick(ctx); return (await ghPulls(ctx)).some((p) => /^wheelhouse\/undo-/.test(p.head?.ref ?? '') && p.merged_at); }, { io, timeoutMs: 20 * MINUTE });
    await note(ctx, LOG.fault('F5a'), 'undo of P6 approved; waited for the take-back merge');
  },
  // F5b: the undo of P2, which clashes with later work; the director's click is the answer to its card.
  async F5b(ctx, io, { n }) {
    const p2 = pullOf(await ghPulls(ctx), ctx.state.pieces.P2?.change ?? 'categor');
    const sha = p2?.merge_commit_sha ?? 'unknown';
    await deskFree(ctx);
    const typedAt = io.clock.now();
    await io.faults.undoTyped(io.tmux, sha);
    io.log?.("Click Approve on the undo of piece P2's merge in the helper window (the second of two). It should clash.");
    if (!(await waitFor(undoAnswered(ctx, sha, typedAt), { io, timeoutMs: CLICK_WAIT_MS }))) {
      await addFinding(ctx, sittingId(n), `the director's click did not come in sitting ${n}: the undo of P2`);
      return;
    }
    await note(ctx, LOG.fault('F5b'), `undo of P2 approved; reply: ${io.tmux.capture(DESK).split('\n').filter((l) => /clashes with later work/.test(l)).join(' ') || 'no clash text seen'}`);
  },
};

// Minutes after midnight (of the day the run began) in local time, as `windowState` reads them.
const localMinutes = (ctx) => (ctx.io.clock.now() - ctx.windowOrigin) / MINUTE;

// The start of a sitting: asks once, or (with windows) waits for the director's window. False when the sitting is skipped.
async function sittingStart(ctx, io, { n, clicks, windows }) {
  if (windows.length === 0) {
    const text = `Sitting ${n}: ${clicks.length} click${clicks.length === 1 ? '' : 's'} in the helper window, about ${minutesFor(clicks.length)} minutes. Answer ready when you are at the screen.`;
    await directorAsk(ctx, text);
    return true;
  }
  let state = windowState(windows, localMinutes(ctx));
  if (state === 'before') {
    await note(ctx, sittingId(n), 'waiting for the director\'s window; builds carry on meanwhile');
    await waitFor(async () => { await tick(ctx); state = windowState(windows, localMinutes(ctx)); return state !== 'before'; }, { io, timeoutMs: 48 * 60 * MINUTE, everyMs: MINUTE });
  }
  if (state === 'past') {
    await addFinding(ctx, sittingId(n), `skipped: every window had gone when sitting ${n} came, so its clicks (${clicks.join(', ')}) were not covered`);
    return false;
  }
  return true;
}

// One step that does the typed parts of every click in a sitting and waits for the director's clicks together. A click that fails or
// does not come is a finding and never a stop; the stop that a failed F6 may have left on is lifted before the next click.
const WAVE_OF_POINT = { w3: 3, w4: 4, end: 5 };
function sittingStep({ n, point, after, clicks }, windows) {
  return {
    id: sittingId(n), wave: WAVE_OF_POINT[point], smoke: false, director: true, after, n, clicks,
    async run(ctx, io) {
      if (!(await sittingStart(ctx, io, { n, clicks, windows }))) return;
      await liftIfStopped(ctx, io, n);
      for (const click of clicks) {
        try {
          await clickSteps[click](ctx, io, { n });
        } catch (error) {
          if (error instanceof HardStop) throw error;
          await addFinding(ctx, sittingId(n), `${click}: ${error.message}`);
        }
        await liftIfStopped(ctx, io, n);
      }
    },
  };
}

const s9 = (n, run) => ({ id: `s9-${n}`, wave: 4, smoke: [1, 2, 4].includes(n), run });

export const STEPS = [
  { id: 'stage', wave: 1, smoke: true, foundation: true, async run(ctx, io) { ctx.state.stage = await io.host.stage({ out: ctx.folder }); await note(ctx, 'stage', 'plugin staged without this kit or the tests'); } },
  {
    id: 'create-repo', wave: 1, smoke: true, foundation: true, needsGo,
    asks: (ctx) => `Create the public GitHub repository ${ctx.repoSlug}? Answer go.`,
    async run(ctx, io) { await ghDo(ctx, ['repo', 'create', ctx.repoSlug, '--public', '--description', 'A throwaway project for the Haiku trial']); await note(ctx, 'create-repo', `created ${ctx.repoSlug}`); },
  },
  {
    id: 'create-preview', wave: 1, smoke: false, needsGo, director: true,
    asks: (ctx) => `Set up previews (${ctx.preview})? Answer go.`,
    async run(ctx, io) {
      if (ctx.preview === 'vercel') await directorAsk(ctx, `Connect Vercel to ${ctx.repoSlug} with Deployment Protection off for previews, then answer done.`);
      else if (ctx.preview === 'tunnel') {
        // The tunnel serves the product from the project's folder, which the seed step makes, so it starts there.
        ctx.state.tunnelWanted = true;
        await note(ctx, 'create-preview', 'previews by tunnel: it starts once the project is seeded');
      } else await note(ctx, 'create-preview', 'no previews: the pictures rows are not covered');
    },
  },
  {
    id: 'install', wave: 1, smoke: true, foundation: true, needsGo,
    asks: (ctx) => `Install the staged plugin into Claude Code and use ${modelName(ctx)} for the trial? Answer go.`,
    async run(ctx, io) {
      const configDir = ctx.env.HAIKU_TRIAL_CONFIG_DIR;
      // A copy an earlier run installed is taken out first: an install of the same version keeps it as it is.
      for (const remove of removeCommands({ configDir, claude: ctx.claude })) {
        const gone = await io.host.exec(remove, { cwd: ctx.folder });
        await note(ctx, 'install', `${remove.join(' ')} -> ${gone.status} (fails when nothing was installed)`);
      }
      const lines = installCommand({ marketplaceDir: ctx.state.stage?.marketplaceDir, configDir, claude: ctx.claude });
      for (const line of lines) {
        const got = await io.host.exec(line, { cwd: ctx.folder });
        await note(ctx, 'install', `${line.join(' ')} -> ${got.status}`);
        if (got.status !== 0) throw new Stop(`install failed: ${line.join(' ')}`);
      }
      const { pluginDir, sha } = ctx.state.stage ?? {};
      const problem = await io.host.installedProblem({ configDir, pluginDir });
      if (problem) throw new Stop(`the installed plugin is not the staged copy: ${problem}`);
      await note(ctx, 'install', `the installed copy matches the staged commit ${sha}, file for file`);
    },
  },
  {
    id: 'seed', wave: 1, smoke: true, foundation: true,
    async run(ctx, io) {
      const made = await io.host.makeProject({ dir: ctx.projectDir, model: ctx.model });
      ctx.state.seedSha = made.sha;
      await io.host.git(['remote', 'add', 'origin', ctx.remote], { cwd: ctx.projectDir });
      await io.host.git(['push', '-u', 'origin', 'main'], { cwd: ctx.projectDir });
      await note(ctx, 'seed', `seeded and pushed ${made.sha ?? ''}`);
      if (ctx.state.tunnelWanted) {
        const got = await io.host.startTunnel({ dir: ctx.projectDir });
        await note(ctx, 'tunnel', 'preview tunnel started', { detail: { productPid: got.productPid, tunnelPid: got.tunnelPid } });
      }
    },
  },
  {
    id: 'setup-s0', wave: 1, smoke: true, foundation: true,
    async run(ctx, io) {
      let restarted = false;
      const start = async () => {
        await desk(ctx, SETUP, { WHEELHOUSE_SETUP_MODEL: ctx.model });
        io.tmux.type(SETUP, restarted ? 'carry on with setup' : '/wheelhouse:setup');
      };
      ctx.inSetup = true;
      await start();
      ctx.session = SETUP;
      ctx.state.panes.setup = [];
      // The stand-in director answers setup's cards as they come, in the record and in the pane; when setup says it needs a new session, the session is started again once.
      const done = await waitFor(async () => {
        await tick(ctx);
        // Setup asks its cards as pickers in the pane: the project has no record to hold them yet.
        await answerPicker(ctx, SETUP);
        const pane = io.tmux.capture(SETUP);
        // The engine's last words also open the phone card, so setup is done only once no picker is open.
        if (openPicker(pane) === null) {
          if (SETUP_DONE.test(pane)) { ctx.state.setupEndedBy = 'the engine\'s words in the pane'; return true; }
          // The pane shows the engine's words only if the model repeats them exactly, so the journal is the other signal.
          if (setupJournalDone(readSetupJournal(ctx.env.WHEELHOUSE_HOME), ctx.projectDir, SETUP_STEPS.map((s) => s.n))) {
            ctx.state.setupEndedBy = 'the setup journal, every step done';
            return true;
          }
        }
        if (!restarted && NEW_SESSION.test(pane)) {
          ctx.state.panes.setup.push(pane);
          endSession(ctx, SETUP);
          restarted = true;
          await note(ctx, LOG.health, 'setup asked for a new session; started it again');
          await start();
        }
        return false;
      }, { io, timeoutMs: SETUP_WAIT_MS });
      ctx.session = undefined;
      ctx.inSetup = false;
      ctx.state.panes.setup.push(io.tmux.capture(SETUP));
      await note(ctx, LOG.health, done ? 'pass' : 'fail: setup did not finish in time');
      if (done) await note(ctx, LOG.health, `setup ended on ${ctx.state.setupEndedBy}`);
      ctx.state.config = await io.host.readConfig({ dir: ctx.projectDir });
      endSession(ctx, SETUP);
      if (!done) throw new Stop('setup did not finish');
    },
  },
  {
    id: 'front-desk', wave: 1, smoke: true, foundation: true,
    async run(ctx, io) {
      await desk(ctx, DESK);
      const on = await io.host.typedRepliesOn({ project: ctx.projectName });
      await note(ctx, 'front-desk', `typed replies on: ${on}`);
    },
  },
  // The director's own click, asked for early and out loud: `alerts ntfy` opens a window in the helper that waits two minutes
  // for a Yes and saves nothing without one, and the alerts also have to be switched on under Notifications. Left to the
  // moment it was typed, it blocked the desk's turn with no one watching and the next piece was typed into it.
  {
    id: 'ntfy', wave: 1, smoke: false, director: true,
    async run(ctx, io) {
      ctx.state.ntfyTopic = `haiku-trial-${ctx.date}-${Math.floor(io.clock.now() / 1000) % 100000}`;
      await directorAsk(ctx, 'Phone alerts need your click. Watch for a window titled "Wheelhouse: phone alerts" in the next minute or two and click Yes in it, then switch ntfy on under Notifications in the front desk. Answer ready, and the runner asks for the window now.');
      const reply = await say(ctx, `alerts ntfy ${ctx.state.ntfyTopic}`, { maxMs: NTFY_WAIT_MS });
      const status = await say(ctx, 'alerts status');
      ctx.state.ntfySetUp = !NOT_CLICKED.test(reply) && /ntfy/i.test(status) && !NO_CHANNEL.test(status);
      await note(ctx, 'ntfy', ctx.state.ntfySetUp ? 'ntfy is set up (switch it on under Notifications for alerts to go)' : 'ntfy was not set up: row 43 is not covered', { reply: reply.slice(0, 300), status: status.slice(0, 300) });
    },
  },
  { id: 'w2-type', wave: 2, smoke: true, run: piecesTyped(2) },
  {
    id: 'f3-kill-p1', wave: 2, smoke: true,
    async run(ctx, io) {
      // P1's work can be linked during the wait (linkLateWork), so its name is read at each look.
      const pieceNow = () => ctx.state.pieces.P1?.change ?? 'p1';
      let piece = pieceNow();
      const found = await waitFor(async () => {
        await tick(ctx);
        piece = pieceNow();
        if (await localCommit(ctx, piece)) return true;
        const branch = ((await io.gh(['api', 'repos/{owner}/{repo}/branches?per_page=100'])) ?? []).map((b) => b.name).find((n) => n.toLowerCase().includes(String(piece).toLowerCase()));
        if (!branch) return false;
        const cmp = await io.gh(['api', `repos/{owner}/{repo}/compare/main...${branch}`]);
        return (cmp?.ahead_by ?? 0) > 0;
      }, { io, timeoutMs: 45 * MINUTE });
      // No first commit is evidence about Wheelhouse or the model, not a reason to end the run: the fault is noted as not
      // exercised and the later waves still run.
      if (!found) { await note(ctx, LOG.fault('F3'), "not exercised: P1's branch never got a first commit"); return; }
      // P1 may not run as a feature session (intake can size it smaller); the fault is then noted as not exercised and
      // the run goes on.
      const killed = await io.faults.f3KillFeature({ project: ctx.projectDir, name: ctx.projectName, piece }).catch((error) => ({ error: error.message }));
      await note(ctx, LOG.fault('F3'), killed?.error ? `not exercised: ${killed.error}` : `killed P1's feature session ${JSON.stringify(killed)}`);
    },
  },
  {
    id: 'w2-merge-wait', wave: 2, smoke: true,
    async run(ctx) {
      await waitMerged(ctx, 3, 2);
      await spareBugCheck(ctx);
    },
  },
  auditStep(2),
  { id: 'w3-type', wave: 3, smoke: false, run: piecesTyped(3) },
  {
    id: 'f1', wave: 3, smoke: false,
    async run(ctx, io) {
      const env = await pieceEnv(ctx, 'P3');
      if (!env) { await notExercised(ctx, 'F1', noSessionWhy('P3')); return; }
      ctx.state.faults.F1 = await io.faults.f1WrongShape(env);
      await note(ctx, LOG.fault('F1'), `F1 exit ${ctx.state.faults.F1.code}, sentBack ${ctx.state.faults.F1.sentBack}`);
    },
  },
  {
    id: 'f1b', wave: 3, smoke: false, needs: ['f1'],
    async run(ctx, io) {
      const env = await pieceEnv(ctx, 'P3');
      if (!env) { await notExercised(ctx, 'F1b', noSessionWhy('P3')); return; }
      const got = await io.faults.f1bStuck(env);
      ctx.state.faults.F1b = { ...got };
      await note(ctx, LOG.fault('F1b'), `stuck at try ${got.stuckAt}`);
    },
  },
  {
    id: 'f1c', wave: 3, smoke: false, needs: ['f1'],
    async run(ctx, io) {
      const env = await pieceEnv(ctx, 'P3');
      if (!env) { await notExercised(ctx, 'F1c', noSessionWhy('P3')); return; }
      const got = await io.faults.f1cDirectorKind(env);
      ctx.state.faults.F1c = got;
      await note(ctx, LOG.fault('F1c'), `refused with code ${got.code}`);
    },
  },
  { id: 'w3-merge-wait', wave: 3, smoke: false, async run(ctx) { await waitMerged(ctx, 3 + (ctx.state.p5 === 'not-covered' ? 3 : 4), 3); } },
  auditStep(3, false),
  { id: 'w4-type', wave: 4, smoke: true, async run(ctx) { await typeWave(ctx, 4, ctx.smoke ? { only: ['P4'] } : {}); } },
  {
    id: 'f4-check', wave: 4, smoke: false,
    async run(ctx, io) {
      const wait = /waits: its plan touches src\/pages\/month\.js, which .* is changing/;
      let seen = '';
      await waitFor(async () => { await tick(ctx); seen = io.tmux.capture(DESK).split('\n').find((l) => wait.test(l)) ?? ''; return seen !== ''; }, { io, timeoutMs: 30 * MINUTE });
      await note(ctx, LOG.fault('F4'), seen || 'the wait text was not seen');
    },
  },
  {
    id: 'f3b-kill-foreman', wave: 4, smoke: false,
    async run(ctx) { ctx.state.f3bArmed = true; await note(ctx, 'f3b-arm', 'the foreman is killed in the first look after P4 merges'); },
  },
  s9(1, async (ctx, io) => {
    const change = ctx.state.pieces.P4?.change;
    const raised = await waitFor(async () => { await tick(ctx); return (await io.host.events({ project: ctx.projectName })).some((e) => e.kind === 'question' && (change === undefined || e.data?.work === change)); }, { io, timeoutMs: 40 * MINUTE });
    if (!raised) {
      const env = await pieceEnv(ctx, 'P4');
      if (env) {
        const got = await io.faults.decisionFallback(env);
        await note(ctx, 'fallback', `P4 raised no decision; the runner raised one: ${JSON.stringify(got)}`);
        await io.clock.sleep(30000);
      } else await notExercised(ctx, 's9', 'P4 raised no decision and has no running session to raise one in');
    }
    try {
      const env = await io.faults.featureEnvOf({ project: ctx.projectDir, name: ctx.projectName, piece: ctx.state.pieces.P4?.change ?? 'p4' });
      const natural = io.faults.naturalSendBacks?.(env);
      if (Number.isInteger(natural)) ctx.state.faults.F1 = { ...(ctx.state.faults.F1 ?? {}), naturalSendBacks: natural };
    } catch { /* no running P4 session to read */ }
    await note(ctx, 's9-1', `typed replies on: ${await io.host.typedRepliesOn({ project: ctx.projectName })}; decision 1 in chat: ${/decision 1/i.test(io.tmux.capture(DESK))}`);
    await tick(ctx);
  }),
  s9(2, async (ctx, io) => {
    for (const text of ['3 A', '1 E']) await note(ctx, 's9-2', `${text}: ${(await say(ctx, text)).slice(0, 300)}`);
    await note(ctx, LOG.why, 'typed "why 1"');
    const reply = await say(ctx, 'why 1', { maxMs: WHY_WAIT_MS, ready: (text) => text.split('\n').some((l) => !/^\W*(>\s*)?why 1\s*$/i.test(l.trim()) && l.trim().length > 40) });
    await note(ctx, LOG.whySeen, reply || 'no reply', ctx.readyAt === undefined ? {} : { at: new Date(ctx.readyAt).toISOString() });
  }),
  s9(3, async (ctx, io) => {
    const env = await pieceEnv(ctx, 'P4');
    if (!env) { await notExercised(ctx, 's9', noSessionWhy('P4')); return; }
    ctx.state.p4env = env;
    const got = await io.faults.secondDecision(env);
    await note(ctx, 's9-3', `second decision raised, code ${got.code}`);
    await io.clock.sleep(20000);
    await note(ctx, 's9-3', `a bare A: ${(await say(ctx, 'A')).slice(0, 300)}`);
  }),
  s9(4, async (ctx) => { await note(ctx, 's9-4', `1 B: ${(await say(ctx, '1 B')).slice(0, 300)}`); }),
  s9(5, async (ctx) => { await note(ctx, 's9-5', `2 B private: ${(await say(ctx, '2 B private')).slice(0, 300)}`); }),
  s9(6, async (ctx) => { await note(ctx, 's9-6', `1 A again: ${(await say(ctx, '1 A')).slice(0, 300)}`); }),
  {
    id: 'pull-back', wave: 4, smoke: false,
    async run(ctx, io) {
      const call = (await io.host.events({ project: ctx.projectName })).find((e) => e.kind === 'agent-call');
      if (!call) { await note(ctx, 'pull-back', 'no logged agent call to pull back'); return; }
      await note(ctx, 'pull-back', (await say(ctx, `pull-back ${call.id}`)).slice(0, 300));
      await tick(ctx);
    },
  },
  {
    id: 'digest', wave: 4, smoke: false,
    async run(ctx, io) {
      const at = new Date(io.clock.now() + 10 * MINUTE);
      at.setSeconds(0, 0); // the setting is a minute, and the digest is due when that minute starts
      ctx.state.digestAt = at.toISOString();
      await deskFree(ctx);
      const set = await io.host.setDigest({ project: ctx.projectName, at });
      await note(ctx, 'digest-set', `digest due ${ctx.state.digestAt}: ${JSON.stringify(set)}`);
      const arrived = await waitFor(async () => { await tick(ctx); return /Daily digest,/.test(io.tmux.capture(DESK)); }, { io, timeoutMs: 20 * MINUTE });
      if (arrived) await note(ctx, LOG.digest, 'the digest reached the chat');
    },
  },
  // A smoke run starts only P4 in this wave, so only P4 has to merge before it is scored.
  { id: 'w4-smoke-merge', wave: 4, smoke: true, smokeOnly: true, async run(ctx) { await waitMerged(ctx, 4, 4); } },
  { id: 'w4-merge-wait', wave: 4, smoke: false, async run(ctx) { await waitMerged(ctx, 3 + (ctx.state.p5 === 'not-covered' ? 3 : 4) + 2, 4); } },
  auditStep(4),
  {
    id: 'w5-incident', wave: 5, smoke: false,
    async run(ctx, io) {
      await say(ctx, "record incident: the trial's own check, nothing is wrong");
      const refused = await say(ctx, 'merge the next approved change');
      await note(ctx, LOG.fault('W5'), `incident recorded; merge reply: ${refused.slice(0, 300)}`);
      await tick(ctx);
      await waitFor(async () => { await tick(ctx); return (await io.host.events({ project: ctx.projectName })).some((e) => e.kind === 'incident-closed'); }, { io, timeoutMs: 10 * MINUTE });
    },
  },
  {
    id: 'w5-midnight', wave: 5, smoke: false,
    async run(ctx, io) {
      const midnight = new Date(io.clock.now());
      midnight.setHours(24, 5, 0, 0);
      await waitFor(async () => io.clock.now() >= midnight.getTime(), { io, timeoutMs: 26 * 60 * MINUTE, everyMs: 5 * MINUTE });
      ctx.state.branches = ((await io.gh(['api', 'repos/{owner}/{repo}/branches?per_page=100'])) ?? []).map((b) => b.name);
      await note(ctx, 'w5-midnight', `after midnight; ${ctx.state.branches.length} branches`);
    },
  },
  {
    id: 'score', wave: 6, smoke: true,
    async run(ctx, io) {
      const dir = path.join(ctx.folder, 'score');
      await io.host.cloneMain({ url: ctx.remote, dir });
      // The builders may have added dependencies; without them the product does not start and the score collapses.
      const installed = await io.host.installDeps({ dir });
      await note(ctx, 'score', installed.skipped ? 'no dependencies to install' : `dependencies: ${installed.ok ? 'installed' : `not installed (${installed.why ?? 'no reason given'})`}`);
      ctx.state.score = await io.score.scoreAll({ dir, baseSha: ctx.state.seedSha, gh: io.gh, browse: io.host.makeBrowse?.({ toolsDir: path.join(ctx.folder, 'tools') }), smoke: ctx.smoke });
      if (installed.ok === false) ctx.state.score = { ...ctx.state.score, why: [...(ctx.state.score.why ?? []), `dependencies were not installed: ${installed.why ?? 'no reason given'}`] };
      await note(ctx, 'score', `score ${ctx.state.score.total}`);
    },
  },
  {
    id: 'signals', wave: 6, smoke: true,
    async run(ctx, io) {
      ctx.state.rows = await gatherAndCheck(ctx, io);
      await note(ctx, 'signals', `${ctx.state.rows.filter((r) => r.pass === true).length} of ${ctx.state.rows.length} rows passed`);
    },
  },
  {
    id: 'results', wave: 6, smoke: true,
    async run(ctx, io) {
      const transcripts = io.host.findTranscripts({ project: ctx.projectName, dir: ctx.projectDir });
      const usage = io.host.readUsage ? io.host.readUsage(transcripts) : {};
      const runLog = readLog(ctx.logFile);
      io.results.writeRaw({ folder: ctx.folder, transcripts, events: await io.host.events({ project: ctx.projectName }), panes: ctx.state.panes, runLog, usage });
      const file = path.join(ctx.folder, 'summary', `${ctx.date}-haiku-trial-results.md`);
      const findings = ctx.state.findings ?? [];
      const claimLost = findings.find((f) => f.claimLost)?.claimLost;
      io.results.writeSummary({ file, date: ctx.date, rows: ctx.state.rows ?? [], score: ctx.state.score, audit: ctx.state.audit, usage, model: ctx.model, findings, claimLost, resumedFrom: ctx.state.resumedFrom });
      await note(ctx, 'results', `raw results and summary under ${ctx.folder}`);
    },
  },
  {
    id: 'raise-decision-3', wave: 6, smoke: false,
    async run(ctx, io) {
      const env = ctx.state.p4env;
      if (!env || !fs.existsSync(env.cwd ?? '')) throw new Stop("no environment for P4 to raise decision 3 in: its worktree is gone, so run the typed-reply check by hand");
      const n = await io.host.nextDecisionNumber({ project: ctx.projectName });
      const got = await io.faults.thirdDecision(env);
      if (got.code !== 0) throw new Stop(`decision 3 was not raised: ${String(got.stdout).trim().slice(0, 300)}`);
      ctx.state.decisionN = Number.isInteger(n) ? n : null;
      await note(ctx, 'decision-3', `raised as decision ${n ?? 'unknown'}`);
    },
  },
  {
    id: 'review-card', wave: 6, smoke: false, director: true,
    async run(ctx, io) {
      const decisionN = ctx.state.decisionN;
      // With no decision 3 the card is still shown, without the typed-answer step, and that row is not covered.
      const typed = Number.isInteger(decisionN);
      if (!typed) await note(ctx, 'review-card', 'typed answer not covered: decision 3 has no number, so the card is shown without the typed-answer step');
      const stepsFile = path.join(ctx.folder, 'steps.md');
      fs.writeFileSync(stepsFile, stepsPage({ decisionN }));
      const tryMe = writeTryMe(ctx.folder);
      const card = reviewCard({ project: ctx.repoName, date: ctx.date, decisionN, stepsUrl: stepsFile, score: ctx.state.score, rows: ctx.state.rows });
      fs.writeFileSync(path.join(ctx.folder, 'review-card.json'), `${JSON.stringify(card, null, 2)}\n`);
      // The card goes through the front desk as a decision, so it reads as it will on a phone; the terminal is the fallback.
      let answer = null;
      const env = ctx.state.p4env;
      const raised = typed && env && fs.existsSync(env.cwd ?? '') ? await io.faults.reviewDecision({ ...env, card: reviewAsDecision(card, { stepsUrl: stepsFile }) }) : { code: null, stdout: 'no environment' };
      if (raised.code === 0) {
        const askedAt = io.clock.now();
        io.log?.(`The review card is in the chat as a decision. Try the tracker (statement: ${tryMe}), then answer there with its number and A, B or C.`);
        await waitFor(async () => {
          await tick(ctx);
          const found = (await io.host.events({ project: ctx.projectName })).filter((e) => e.kind === 'decision-answer' && Date.parse(e.at) >= askedAt - 1000 && answerLetter(e.data?.label) !== null && e.data?.n === decisionN + 1).pop(); // the card follows decision 3 in the numbering
          answer = found ? answerLetter(found.data.label) : null;
          return answer !== null;
        }, { io, timeoutMs: 120 * MINUTE, everyMs: 30000 });
      } else if (typed) {
        await note(ctx, 'review-card', `the card could not be raised as a decision (${String(raised.stdout).trim().slice(0, 200)}); asking in the terminal`);
      }
      while (answer === null) {
        answer = answerLetter(await directorAsk(ctx, `${card.title}\n\n${card.text}\n\nThe statement to import is ${tryMe}. Answer A, B or C.`));
      }
      await note(ctx, 'review-card', `the director answered ${answer}`);
    },
  },
];

async function p6Sha(ctx) {
  const pulls = await ghPulls(ctx);
  return (pullOf(pulls, ctx.state.pieces.P6?.change) ?? pullOf(pulls, 'money-edge'))?.merge_commit_sha ?? 'unknown';
}

const readLog = (file) => {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
};

// Builds the context the rows read, adds what only the runner can know, and runs them.
async function gatherAndCheck(ctx, io) {
  const { state } = ctx;
  const transcripts = io.host.findTranscripts({ project: ctx.projectName, dir: ctx.projectDir });
  const pieces = state.pieces;
  if (pieces.P8) pieces.P8.gate = await io.host.readGate({ change: pieces.P8.change, project: ctx.projectName, gh: io.gh });
  // A file that is absent and a read that failed both come back null, so package.json is read too: it is always on main.
  const mainFiles = {};
  for (const file of ['package.json', P6_FILE]) mainFiles[file] = await io.host.readMain({ dir: ctx.projectDir, file });
  const config = state.config ?? (await io.host.readConfig({ dir: ctx.projectDir }));
  const full = await io.signals.gatherContext({
    project: ctx.projectName, gh: io.gh, runLog: readLog(ctx.logFile).filter((e) => e.done !== true), panes: state.panes, transcripts, pieces,
    scores: state.score, previews: ctx.preview, config, ntfy: state.ntfy, ntfySetUp: state.ntfySetUp, faults: state.faults,
    branches: state.branches, mainFiles, model: ctx.model, digestAt: state.digestAt, projectName: ctx.repoName,
  });
  for (const [id, piece] of Object.entries(pieces)) {
    piece.prs = piece.change ? (full.prs ?? []).filter((p) => `${p.head} ${p.title}`.toLowerCase().includes(String(piece.change).toLowerCase())).map((p) => p.number) : [];
    const first = (full.prs ?? []).find((p) => p.number === piece.prs[0])?.commits?.[0]?.sha;
    if (id === 'P5' && first) {
      const status = await io.gh(['api', `repos/{owner}/{repo}/commits/${first}/status`]);
      if (typeof status?.state === 'string') piece.redAtFirstCommit = status.state === 'failure';
    }
  }
  state.audit = full.audit;
  full.findings = state.findings ?? [];
  const rows = io.signals.checkAll(full, { smoke: ctx.smoke });
  return state.p5 === 'not-covered'
    ? rows.map((r) => (r.id === 6 ? { ...r, pass: null, evidence: `not covered: ${state.p5Why}` } : r))
    : rows;
}

// --- planning and running ---

// The steps of a run. A full run gets a sitting step after each `SITTING_POINTS` step its sittings name (`--sitting`, `w4` by default);
// a smoke run has none.
export function planRun({ mode = 'full', sittings = ['w4'], windows = [] } = {}) {
  if (mode === 'smoke') return STEPS.filter((s) => s.smoke);
  const after = new Map(placeClicks(sittings).map((p) => [p.after, sittingStep(p, windows)]));
  return STEPS.filter((s) => s.smokeOnly !== true).flatMap((s) => (after.has(s.id) ? [s, after.get(s.id)] : [s]));
}

const lastDone = (file, plan) => readLog(file).filter((e) => e.done === true).map((e) => e.step).filter((id) => plan.some((s) => s.id === id)).pop();
const sittingsIn = (plan) => plan.filter((s) => s.clicks !== undefined);

// director.md (spec section 5.3): the sittings still to come, when each is likely and how long it takes. It is written at the start
// of a run, at the end of each wave and on a resume, and its first line goes to the log.
async function writeDirectorNote(ctx, plan, at) {
  try {
    const ahead = plan.slice(at);
    const sittings = sittingsIn(ahead);
    const now = ctx.io.clock.now();
    const estimates = sittings.map((s) => estimate({ remaining: ahead.slice(0, ahead.indexOf(s)).filter((x) => x.clicks === undefined).map((x) => x.id), now }));
    const text = directorNote({ sittings, estimates, windows: ctx.state.windows ?? [], now });
    fs.writeFileSync(path.join(ctx.folder, 'director.md'), text);
    ctx.io.log?.(`director.md: ${text.split('\n').find((l) => l.startsWith('- '))?.replace(/\*\*/g, '') ?? 'no sitting still to come'}`);
  } catch (error) {
    await note(ctx, 'director-note', `could not write director.md: ${error.message}`);
  }
}

function contextFor({ mode, io, folder, date, label, env }) {
  const owner = env.HAIKU_TRIAL_GH_OWNER;
  const repoName = `haiku-trial-${date}`;
  const projectName = projectSlug(owner ?? 'unset', repoName);
  const stateFile = path.join(folder, 'state.json');
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { /* a fresh run */ }
  const state = {
    pieces: {}, faults: {}, ntfy: [], seen: [], branches: [], panes: { 'front-desk': [], replies: [] }, p5: 'original', ...saved,
  };
  return {
    mode, io, env, folder, date, label, state, stateFile, smoke: mode === 'smoke', repoName, owner,
    repoSlug: `${owner}/${repoName}`, remote: `https://github.com/${owner}/${repoName}.git`,
    projectDir: path.join(folder, 'project'), projectName, logFile: path.join(folder, 'run-log.jsonl'),
    claude: env.HAIKU_TRIAL_CLAUDE ?? 'claude', preview: env.HAIKU_TRIAL_PREVIEW ?? 'none',
  };
}

export async function run({ mode = 'full', io: given, from, until, folder, date, model, env = process.env, goGiven = false, sittings, windows } = {}) {
  const label = date;
  const problem = homeProblem(env);
  if (problem) return { done: [], stoppedAt: 'wheelhouse-home', why: problem };
  let io = { ...given, host: { ...NOTHING, ...(given.host ?? {}) } };
  const day = date ?? new Date(io.clock.now()).toISOString().slice(0, 10);
  const where = folder ?? io.results.runFolder(day);
  fs.mkdirSync(where, { recursive: true });
  const ctx = contextFor({ mode, io, folder: where, date: day, label, env });
  // A run resumed from a snapshot reads GitHub as it was at the snapshot, plus what is new (spec section 3.5).
  const resumed = ctx.state.resumedFrom;
  if (resumed) {
    const capture = await io.snapshot?.readCapture?.({ label, snapshot: resumed.snapshot });
    if (capture) {
      io = { ...io, gh: snapshotGh(io.gh, { capture, maxNumber: resumed.maxNumber, reopened: resumed.reopened, since: resumed.since }) };
      ctx.io = io;
    }
  }
  // The project and every session it starts are pinned to one model, so a resume keeps the model the run began on.
  const asked = model === undefined ? undefined : parseModel(model);
  const began = ctx.state.model;
  if (began !== undefined && asked !== undefined && began !== asked) {
    return { done: [], stoppedAt: 'model', why: `this run began on ${began}, so --model ${asked} would put the rest on another model. Start a new run with its own --date to use ${asked}.` };
  }
  ctx.model = began ?? asked ?? DEFAULT_MODEL;
  ctx.state.model = ctx.model;
  io.host.useRepo(ctx.repoSlug);
  // The sittings and windows a run began with are kept in its state, so a later `--from auto` or a resume goes on with the same plan.
  ctx.state.sittings = sittings ?? ctx.state.sittings ?? ['w4'];
  ctx.state.windows = windows ?? ctx.state.windows ?? [];
  const now = new Date(io.clock.now());
  ctx.windowOrigin = now.setHours(0, 0, 0, 0);
  const plan = planRun({ mode, sittings: ctx.state.sittings, windows: ctx.state.windows });
  let start = 0;
  if (from === 'auto') {
    const at = plan.findIndex((s) => s.id === lastDone(ctx.logFile, plan));
    start = at < 0 ? 0 : at + 1;
  } else if (from) {
    start = plan.findIndex((s) => s.id === from);
    if (start < 0) throw new Error(`No step called ${from} in the ${mode} plan`);
  }
  // Before anything is created: a tunnel preview needs cloudflared.
  if (ctx.preview === 'tunnel' && plan.slice(start).some((s) => s.id === 'create-preview') && !(await io.host.hasCommand('cloudflared'))) {
    return { done: [], stoppedAt: 'create-preview', why: 'HAIKU_TRIAL_PREVIEW is tunnel but cloudflared is not installed. Install it (brew install cloudflared) or use vercel or none. Nothing was created.' };
  }
  const points = pointsFor(mode, sittingsIn(plan).map((s) => s.n));
  const done = [];
  const failed = [];
  const skipped = [];
  const result = (extra = {}) => ({ done, findings: ctx.state.findings ?? [], failed, skipped, ...extra });
  await writeDirectorNote(ctx, plan, start);
  for (const [index, step] of plan.entries()) {
    if (index < start) continue;
    const unmet = (step.needs ?? []).find((id) => failed.includes(id) || skipped.includes(id));
    if (unmet !== undefined) {
      const what = `skipped: needs ${unmet}, which failed`;
      ctx.state.findings = (ctx.state.findings ?? []).filter((f) => f.step !== step.id);
      await addFinding(ctx, step.id, what);
      await appendJsonl(ctx.logFile, { at: iso(ctx), step: step.id, note: what, done: true, outcome: 'skipped' });
      fs.writeFileSync(ctx.stateFile, `${JSON.stringify(ctx.state, null, 2)}\n`);
      skipped.push(step.id);
      if (until === step.id) break;
      continue;
    }
    try {
      if (step.needsGo && !goGiven) {
        if (!ctx.owner) throw new HardStop('HAIKU_TRIAL_GH_OWNER is not set');
        const answer = await io.ask(step.asks?.(ctx) ?? `Go ahead with ${step.id}? Answer go.`);
        if (String(answer).trim().toLowerCase() !== 'go') {
          await note(ctx, step.id, `stopped: the answer was "${answer}", not go`);
          return result({ stoppedAt: step.id, why: 'waiting for the director\'s go' });
        }
      }
      io.log?.(`step ${step.id}`);
      ctx.directorStep = step.director === true;
      ctx.wave = step.wave;
      // A step run again replaces what it found before.
      ctx.state.findings = (ctx.state.findings ?? []).filter((f) => f.step !== step.id);
      for (const p of points.filter((x) => x.before === step.id && x.point !== ctx.state.resumedFrom?.point)) await snapshotAt(ctx, { point: p.point, step: step.id });
      await step.run(ctx, io);
    } catch (error) {
      if (step.foundation === true || error instanceof HardStop) {
        await note(ctx, step.id, `stopped: ${error.message}`);
        fs.writeFileSync(ctx.stateFile, `${JSON.stringify(ctx.state, null, 2)}\n`);
        return result({ stoppedAt: step.id, why: error.message });
      }
      await addFinding(ctx, step.id, error.message);
      await appendJsonl(ctx.logFile, { at: iso(ctx), step: step.id, note: `failed: ${error.message}`, done: true, outcome: 'failed' });
      fs.writeFileSync(ctx.stateFile, `${JSON.stringify(ctx.state, null, 2)}\n`);
      failed.push(step.id);
      if (until === step.id) break;
      continue;
    }
    await appendJsonl(ctx.logFile, { at: iso(ctx), step: step.id, note: 'done', done: true });
    fs.writeFileSync(ctx.stateFile, `${JSON.stringify(ctx.state, null, 2)}\n`);
    done.push(step.id);
    for (const p of points.filter((x) => x.after === step.id)) await snapshotAt(ctx, { point: p.point, step: step.id });
    if (until === step.id) break;
    if (plan[index + 1] && plan[index + 1].wave > step.wave) await writeDirectorNote(ctx, plan, index + 1);
  }
  return result();
}

// --- resume ---

// The step a resume goes on from: the step itself for a `before-` point, the one after it for an `after-` point.
function stepAfterPoint(meta) {
  const plan = planRun({ mode: meta.mode ?? 'full', sittings: meta.sittings }).map((s) => s.id);
  if (meta.point?.startsWith('before-')) return plan.includes(meta.step) ? meta.step : undefined;
  const at = plan.indexOf(meta.step);
  return at < 0 ? undefined : plan[at + 1];
}

const readAttempts = (dir) => readLog(path.join(dir, 'attempts.jsonl'));

// Starts a run again from a snapshot, as a new attempt of the same label (spec 2026-11-13, section 3.4). The attempt that was
// there is moved aside, nothing is deleted. `base` is where snapshots are kept (tests give a folder of their own).
export async function resume({ folder, label, snapshot, io: given, keepPlugin = false, configDir, env = process.env, until, base }) {
  const stop = (why) => ({ done: [], stoppedAt: 'resume', why });
  const io = { ...given, host: { ...NOTHING, ...(given.host ?? {}) } };
  const dir = snapshotsDir(label, base);
  const dest = path.join(dir, snapshot);
  // Check: nothing is touched yet.
  const meta = readMeta(dest);
  if (!meta) return stop(`no snapshot ${snapshot} for ${label}. Snapshots: ${listSnapshots(dir).map((s) => s.name).join(', ') || 'none'}`);
  if (meta.label !== label) return stop(`snapshot ${snapshot} is for ${meta.label}, not ${label}`);
  const owner = env.HAIKU_TRIAL_GH_OWNER;
  if (!owner) return stop('HAIKU_TRIAL_GH_OWNER is not set');
  if (!(await io.gh(['api', 'user']))) return stop('gh is not signed in');
  if (!io.github) return stop('this host cannot rebuild the repository');
  const first = stepAfterPoint(meta);
  if (first === undefined) return stop(`snapshot ${snapshot} has no step to go on from`);
  // A run that is going on is never touched: its sessions must be stopped first (`restore`).
  const alive = io.tmux.list({ all: true }).filter((name) => name.startsWith(sessionPrefix(label)));
  if (alive.length > 0) return stop(`the sessions of ${label} are still running (${alive.join(', ')}). Stop them with restore, then resume`);

  const repoName = `haiku-trial-${label}`;
  const slug = `${owner}/${repoName}`;
  const n = readAttempts(dir).length + 1;
  const plugin = keepPlugin ? `the plugin staged in the snapshot (${meta.pluginSha ?? 'unknown'})` : `the plugin staged from this checkout (${(await io.host.checkoutSha?.()) ?? 'unknown'})`;
  // One go for everything outward; any other answer leaves everything as it was.
  const answer = await io.ask(`Resume ${label} from ${snapshot}: rename the repository ${repoName} to ${repoName}-a${n}, create a fresh public ${repoName} from the snapshot, install ${plugin} and spend tokens. Answer go.`);
  if (String(answer).trim().toLowerCase() !== 'go') return stop(`the answer was "${answer}", not go`);

  io.host.useRepo(slug);
  await restore({ folder, io, force: true });
  // Move the attempt aside: its folder, its transcripts and its repository.
  const aside = `${folder}-a${n}`;
  const projectName = projectSlug(owner, repoName);
  const projects = path.join(configDir ?? path.join(os.homedir(), '.claude'), 'projects');
  for (const t of io.host.findTranscripts({ project: projectName, dir: path.join(folder, 'project') })) {
    const rel = path.relative(projects, t.file);
    if (rel.startsWith('..') || path.isAbsolute(rel) || !fs.existsSync(t.file)) continue;
    const to = path.join(aside, 'transcripts-moved', rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(t.file, to);
    fs.rmSync(t.file);
  }
  if (fs.existsSync(folder)) fs.renameSync(folder, aside);
  try { await io.github.rename({ slug, to: `${repoName}-a${n}` }); } catch (error) { return stop(`the repository could not be renamed: ${error.message}`); }
  try {
    restoreLocal({ dest, folder, configDir });
  } catch (error) { return stop(`the snapshot could not be put back: ${error.message}`); }

  let reopened;
  try {
    const open = (() => { try { return JSON.parse(fs.readFileSync(path.join(dest, 'github', 'open.json'), 'utf8')); } catch { return []; } })();
    ({ reopened } = await rebuildGithub({ github: io.github, slug, src: path.join(dest, 'github'), maxNumber: meta.maxNumber ?? 0, open, attempt: n, snapshot, sleep: (ms) => io.clock.sleep(ms) }));
  } catch (error) { return stop(`the fresh repository could not be rebuilt: ${error.message}`); }

  const stateFile = path.join(folder, 'state.json');
  const setState = (change) => {
    let state = {};
    try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { /* none */ }
    fs.writeFileSync(stateFile, `${JSON.stringify(change(state), null, 2)}\n`);
  };
  const resumedFrom = { snapshot, point: meta.point, attempt: n + 1, pluginBefore: meta.pluginSha, pluginNow: meta.pluginSha, maxNumber: meta.maxNumber ?? 0, quiet: meta.quiet, running: meta.running ?? [], reopened, since: meta.at };
  setState((state) => ({ ...state, resumedFrom }));
  await appendJsonl(path.join(dir, 'attempts.jsonl'), { n, at: new Date(io.clock.now()).toISOString(), snapshot, aside, repository: `${repoName}-a${n}` });

  // Go on: the plugin again (unless it is kept), a fresh front desk, then the steps from the point.
  const mode = meta.mode ?? 'full';
  const segments = [...(keepPlugin ? [] : ['stage']), 'install', 'front-desk'];
  if (!keepPlugin) fs.rmSync(path.join(folder, 'plugin'), { recursive: true, force: true });
  const done = [];
  for (const id of segments) {
    const got = await run({ mode, io, from: id, until: id, folder, date: label, env, goGiven: true });
    done.push(...got.done);
    if (got.stoppedAt) return { ...got, done };
    if (id === 'stage') {
      let sha = meta.pluginSha;
      try { sha = JSON.parse(fs.readFileSync(stateFile, 'utf8')).stage?.sha ?? sha; } catch { /* keep the old */ }
      setState((state) => ({ ...state, resumedFrom: { ...state.resumedFrom, pluginNow: sha } }));
    }
  }
  const got = await run({ mode, io, from: first, until, folder, date: label, env, goGiven: true });
  return { ...got, done: [...done, ...got.done] };
}

// Stops what this run started, as its log records it, and nothing else. It deletes nothing.
// Wheelhouse's own side (the helper, watchers and foremen) is kept while a feature session is still running, since stopping
// it takes its records and its way to open a pull request with it; `force` stops it anyway.
export async function restore({ folder, io, force = false }) {
  const stopped = [];
  let kept = [];
  const entries = readLog(path.join(folder, 'run-log.jsonl'));
  const names = new Set(entries.flatMap((e) => [].concat(e.detail?.tmux ?? [])).filter((n) => String(n).startsWith(SESSION_PREFIX)));
  const pids = new Set(entries.flatMap((e) => [e.detail?.productPid, e.detail?.tunnelPid]).filter((p) => Number.isInteger(p)));
  const live = new Set(io.tmux.list({ all: true }));
  for (const name of names) {
    if (!live.has(name)) continue;
    io.tmux.kill(name);
    stopped.push(name);
  }
  for (const pid of pids) {
    // Each was started in its own process group, so the whole group goes; a pid that is no group's leader goes alone.
    try {
      io.kill(-pid, 'SIGTERM');
      stopped.push(`pid ${pid}`);
    } catch {
      try {
        io.kill(pid, 'SIGTERM');
        stopped.push(`pid ${pid}`);
      } catch { /* already gone */ }
    }
  }
  const wheelhouse = (await io.host.stopWheelhouse?.({ force })) ?? [];
  if (Array.isArray(wheelhouse)) stopped.push(...wheelhouse);
  else {
    stopped.push(...(wheelhouse.stopped ?? []));
    kept = wheelhouse.kept ?? [];
  }
  return { stopped, kept };
}

// --- the command line ---

// A run's label names its repository (`haiku-trial-<label>`), its project, its folder, its ntfy topic and its summary file, so it is
// kept to a date with an optional short lowercase suffix (`2026-11-08-b`). The flag wins over HAIKU_TRIAL_DATE; neither leaves
// the clock to name the run.
const LABEL = /^\d{4}-\d{2}-\d{2}(-[a-z0-9]{1,20})?$/;
export function runLabel({ arg, env = process.env } = {}) {
  const fromFlag = arg !== undefined;
  const given = fromFlag ? arg : env.HAIKU_TRIAL_DATE;
  if (given === undefined || (!fromFlag && given === '')) return undefined;
  if (typeof given !== 'string' || !LABEL.test(given)) {
    throw new Error(`${fromFlag ? '--date' : 'HAIKU_TRIAL_DATE'} must be YYYY-MM-DD with an optional -suffix of lowercase letters and digits (for example 2026-11-08-b), not "${given}"`);
  }
  return given;
}

const USAGE = 'usage: node probes/haiku-trial/runner.js full | smoke | restore | resume | plan [--from <step>] [--out <folder>] [--until <step>] [--date <label>] [--model <haiku|sonnet>] [--force]\n  --model <haiku|sonnet> runs the whole trial on that model (haiku by default); one sonnet run tells kit faults from model faults\n  --force (restore) stops the helper, watchers and foremen even while a feature session is still running\n  resume --date <label> --snapshot <nn-point> [--keep-plugin] starts the run again from a snapshot, as a new attempt\n  --sitting <w3|w4|end> (repeatable) puts the clicks of the director in a sitting after that point; w4 alone by default\n  --window <HH:MM-HH:MM> (repeatable, local time) holds a sitting to a window of the director\n  --date <label> (or HAIKU_TRIAL_DATE) names the run: YYYY-MM-DD with an optional -suffix such as 2026-11-08-b';

function parseArgs(argv) {
  const out = { command: argv[0], from: undefined, folder: undefined, until: undefined, date: undefined };
  for (let i = 1; i < argv.length; i += 1) {
    if (argv[i] === '--from') out.from = argv[(i += 1)];
    else if (argv[i] === '--out') out.folder = argv[(i += 1)];
    else if (argv[i] === '--until') out.until = argv[(i += 1)];
    else if (argv[i] === '--date') out.date = argv[(i += 1)] ?? '';
    else if (argv[i] === '--model') out.model = argv[(i += 1)] ?? '';
    else if (argv[i] === '--force') out.force = true;
    else if (argv[i] === '--snapshot') out.snapshot = argv[(i += 1)] ?? '';
    else if (argv[i] === '--keep-plugin') out.keepPlugin = true;
    else if (argv[i] === '--sitting') (out.sittings ??= []).push(argv[(i += 1)] ?? '');
    else if (argv[i] === '--window') (out.windows ??= []).push(argv[(i += 1)] ?? '');
  }
  return out;
}

export async function main(argv, { print = console.log, buildIo, env = process.env } = {}) {
  const args = parseArgs(argv);
  let label;
  try {
    if (args.model !== undefined) parseModel(args.model);
    label = runLabel({ arg: args.date, env });
  } catch (error) {
    print(error.message);
    print(USAGE);
    return 2;
  }
  let windows;
  try {
    if (args.sittings) placeClicks(args.sittings);
    if (args.windows) windows = args.windows.map(parseWindow);
  } catch (error) {
    print(error.message);
    print(USAGE);
    return 2;
  }
  if (args.command === 'plan') {
    for (const mode of ['full', 'smoke']) {
      const steps = planRun({ mode, sittings: args.sittings, windows });
      const sittings = sittingsIn(steps);
      const points = pointsFor(mode, sittings.map((x) => x.n));
      const marked = (id) => points.some((p) => (p.before ?? p.after) === id);
      print(`${mode}: ${steps.map((x) => `${x.id}${x.needsGo ? '*' : ''}${x.director ? '+' : ''}${marked(x.id) ? '#' : ''}`).join(' ')}`);
      print(`snapshots: ${points.map((p) => p.point).join(' ')}`);
      print(`sittings: ${sittings.length === 0 ? 'none' : sittings.map((x) => `${x.id} after ${x.after} (${x.clicks.join(', ')})`).join(', ')}`);
    }
    print('* waits for the director\'s go, + needs the director, # snapshot point');
    if (label !== undefined) print(`run ${label}: repository ${env.HAIKU_TRIAL_GH_OWNER ?? '<owner>'}/haiku-trial-${label}, folder ${args.folder ?? runFolder(label)}`);
    return 0;
  }
  if (!['full', 'smoke', 'restore', 'resume'].includes(args.command)) {
    print(USAGE);
    return 2;
  }
  const io = await buildIo(env, label);
  const folder = args.folder ?? io.results.runFolder(label ?? new Date(io.clock.now()).toISOString().slice(0, 10));
  // Everything Wheelhouse keeps follows WHEELHOUSE_HOME: set it to the trial's own folder before anything reads it, and refuse the real one.
  const home = trialHome({ folder, env });
  const given = { ...env, WHEELHOUSE_HOME: home };
  process.env.WHEELHOUSE_HOME = home;
  const problem = homeProblem(given);
  if (problem) { print(JSON.stringify({ stoppedAt: 'wheelhouse-home', why: problem })); return 1; }
  fs.mkdirSync(home, { recursive: true });
  if (args.command === 'restore') {
    print(JSON.stringify(await restore({ folder, io, force: args.force === true })));
    return 0;
  }
  if (args.command === 'resume') {
    if (label === undefined) { print('resume needs --date <label>'); print(USAGE); return 2; }
    if (!args.snapshot) {
      const known = listSnapshots(snapshotsDir(label));
      print(known.length === 0 ? `no snapshots for ${label}` : `snapshots for ${label}:\n${known.map((x) => `  ${x.name}  (${x.meta?.at ?? 'no time'}${x.meta?.quiet === false ? ', not quiet' : ''})`).join('\n')}`);
      print('resume needs --snapshot <nn-point>');
      return 2;
    }
    const result = await resume({ folder, label, snapshot: args.snapshot, io, keepPlugin: args.keepPlugin === true, configDir: env.HAIKU_TRIAL_CONFIG_DIR || undefined, env: given, until: args.until });
    print(JSON.stringify(result));
    return result.stoppedAt || (result.findings ?? []).length > 0 ? 1 : 0;
  }
  const result = await run({ mode: args.command, io, from: args.from ?? 'auto', until: args.until, folder, date: label, model: args.model, env: given, sittings: args.sittings, windows });
  print(JSON.stringify(result));
  return result.stoppedAt || (result.findings ?? []).length > 0 ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { buildRealIo } = await import('./host.js');
  process.exitCode = await main(process.argv.slice(2), { buildIo: buildRealIo });
}
