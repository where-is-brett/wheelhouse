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
import { openPicker, readyToSubmit, HIGHLIGHTED } from './stand-in.js';
import { PIECES, WAVES, P5_SPARE, F2_ANSWER } from './requests.js';
import { SESSION_PREFIX, frontDeskCommand } from './tmux.js';
import { STEPS as LOG, SETUP_DONE, OWN_BRANCH } from './signals.js';
import { auditModels } from './audit.js';
import { STARTS_UNAPPROVED } from '../../scripts/foreman/queue.js';
import { installCommand, removeCommands } from './stage-plugin.js';
import { reviewCard, stepsPage, writeTryMe, reviewAsDecision, answerLetter } from './review-card.js';

const MINUTE = 60 * 1000;
const DESK = 'desk';
const SETUP = 'setup';
const WHY_WAIT_MS = 100 * 1000 + 20 * 1000;
const WAVE_WAIT_MS = { 2: 90 * MINUTE, 3: 150 * MINUTE, 4: 90 * MINUTE };
const SPARE_BRANCH = 'trial/spare-bug';
const SETUP_WAIT_MS = 45 * MINUTE;
// Setup's skill gives this line in prose, so the session words it its own way: "setup needs one new session on this
// folder", "the last safety checks need one new session in this folder: close this session, start a new one here".
export const NEW_SESSION = /needs? one new session|new session (?:on|in) this folder|start a new (?:one|session) (?:here|in this folder|on this folder)/i;
const TRUST_PROMPT = /trust the files in this folder|do you trust|trust this folder/i;
// The trust prompt's highlighted choice. Its first choice is "No, exit", so Enter alone ends the session.
const TRUST_YES = /❯\s*(?:\d+\.\s*)?Yes, I trust this folder/;
const pieceOf = (id) => PIECES.find((p) => p.id === id);

export class Stop extends Error {}

// --- the trial's own Wheelhouse home ---

const holds = (outer, inner) => {
  const rel = path.relative(outer, inner);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};
export const realWheelhouseHome = () => path.resolve(os.homedir(), '.wheelhouse');

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
  stopWheelhouse: async () => [],
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
const tmuxName = (name) => `${SESSION_PREFIX}${name}`;
function endSession(ctx, name) {
  ctx.live?.delete(name);
  ctx.io.tmux.kill(name);
}
function mustBeAlive(ctx) {
  if (!ctx.live?.size) return;
  const up = new Set(ctx.io.tmux.list());
  for (const name of ctx.live) {
    if (!up.has(tmuxName(name))) throw new Stop(`the ${name} session ended by itself (tmux ${tmuxName(name)} is gone)`);
  }
}

// One look at the project: events become log entries, open cards get the director's stand-in answer, and F3b fires when armed.
async function tick(ctx) {
  const { io, state } = ctx;
  mustBeAlive(ctx);
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
  }
  const open = new Set();
  let features = 0;
  for (const e of events.filter((x) => x.kind === 'run')) {
    const key = e.data?.runId ?? e.id;
    if (e.data?.state === 'started') { open.add(key); if (e.data.lane === 'feature') features += 1; } else open.delete(key);
  }
  if (open.size > 0 && state.pace !== `${open.size},${features}`) {
    state.pace = `${open.size},${features}`;
    await note(ctx, LOG.pace, `building ${open.size}, feature ${features}`);
  }
  await linkLateWork(ctx, events);
  // P4's decisions are the live decision script's own (s9), so the stand-in leaves them to it.
  const skipWork = [state.pieces.P4?.change].filter((w) => typeof w === 'string');
  await io.host.answerCards({ project: ctx.projectName, tmux: io.tmux, events, session: ctx.session ?? DESK, skipWork });
  await staleDeskPicker(ctx);
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

async function waitMerged(ctx, count, wave) {
  const ok = await waitFor(async () => {
    await tick(ctx);
    return (await mergedPulls(ctx)).length >= count;
  }, { io: ctx.io, timeoutMs: WAVE_WAIT_MS[wave] ?? 60 * MINUTE });
  if (!ok) throw new Stop(`fewer than ${count} pull requests merged in time for wave ${wave}`);
}

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

// Types a piece's request, answers intake's visibility question for P8, and notes which work event it became.
// Text typed while a picker is open goes into the picker, not the chat, so the stand-in answers the picker first. After
// the wait it is typed anyway, and the wait is noted.
async function deskFree(ctx) {
  const { io } = ctx;
  const open = () => { const pane = io.tmux.capture(DESK); return openPicker(pane) !== null || readyToSubmit(pane); };
  if (!open()) return;
  const free = await waitFor(async () => { await tick(ctx); return !open(); }, { io, timeoutMs: 10 * MINUTE, everyMs: 10000 });
  if (!free) await note(ctx, LOG.health, 'a picker stayed open in the front desk for 10 minutes; typing anyway');
}

// The stand-in director's reply when a request is met with questions in the chat and no card: what a director who takes
// every recommendation would say.
export const FOLLOW_UP = 'Go with what you recommend on each question, and take it to a card.';

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
    if (id === 'P8' && !answered && /nobody sees|anyone see|visible/i.test(pane)) { answered = true; io.tmux.type(DESK, F2_ANSWER); }
    still = pane === last ? still + 1 : 0;
    last = pane;
    // The desk has finished its reply, made no work, opened no picker, and asked something: the stand-in answers once.
    if (!followed && id !== 'P8' && still >= 2 && io.clock.now() - started >= 2 * MINUTE && openPicker(pane) === null && /\?/.test(newLines(before, pane))) {
      followed = true;
      io.tmux.type(DESK, FOLLOW_UP);
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
  await ghDo(ctx, ['pr', 'create', '--head', SPARE_BRANCH, '--base', 'main', '--title', 'Plant the spare bug for the trial', '--body', 'The trial plants this bug for piece P5.']);
  await ghDo(ctx, ['pr', 'merge', SPARE_BRANCH, '--squash', '--admin']);
  state.p5 = 'spare';
  await note(ctx, 'plant', 'spare bug merged; P5 will use the spare request');
}

// --- the steps ---

const piecesTyped = (wave) => async (ctx) => typeWave(ctx, wave);
const needsGo = true;

async function desk(ctx, name, extraEnv = {}) {
  const { io } = ctx;
  const { command, env } = frontDeskCommand({ claude: ctx.claude });
  // The trial's own Wheelhouse home and Claude config folder go in explicitly: the session starts with `env -i`, and the helper it
  // wakes (and so every feature session) takes its environment from this one.
  const own = { WHEELHOUSE_HOME: ctx.env.WHEELHOUSE_HOME, ...(ctx.env.HAIKU_TRIAL_CONFIG_DIR ? { CLAUDE_CONFIG_DIR: ctx.env.HAIKU_TRIAL_CONFIG_DIR } : {}) };
  io.tmux.start({ name, cwd: ctx.projectDir, command, env: { ...env, ...own, ...extraEnv } });
  (ctx.live ??= new Set()).add(name);
  await note(ctx, name === DESK ? 'front-desk' : name, `started tmux session ${SESSION_PREFIX}${name}`, { detail: { tmux: `${SESSION_PREFIX}${name}` } });
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
  mustBeAlive(ctx);
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
    throw new Stop(`the ${name} session's picker "${question}" never highlighted ${first.recommended === -1 ? 'its first option' : 'its recommended option'}`);
  }
  const label = first.options[target].replace(HIGHLIGHTED, '').replace(/^\s*\d+\.\s*/, '').trim();
  io.tmux.keys(name, 'Enter');
  await note(ctx, name === DESK ? 'front-desk' : name, `answered the picker "${question}": ${label}`);
  await io.clock.sleep(3000);
  return true;
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

async function pieceEnv(ctx, id) {
  const piece = ctx.state.pieces[id]?.change ?? id.toLowerCase();
  let got;
  const found = await waitFor(async () => {
    try { got = await ctx.io.faults.featureEnvOf({ project: ctx.projectDir, piece }); return true; } catch { await tick(ctx); return false; }
  }, { io: ctx.io, timeoutMs: 40 * MINUTE });
  if (!found) throw new Stop(`no running feature session names ${id}`);
  return got;
}

const directorAsk = async (ctx, text) => {
  const answer = await ctx.io.ask(text);
  await note(ctx, 'director', `${text} -> ${answer}`);
  return answer;
};

// After a wave's merges: one transcript on another model fails the whole run (spec section 4.3), so it is found now, not at the end.
const auditStep = (wave, smoke = true) => ({
  id: `w${wave}-audit`, wave, smoke,
  async run(ctx, io) {
    const models = auditModels(io.host.findTranscripts({ project: ctx.projectName, dir: ctx.projectDir }));
    await note(ctx, `w${wave}-audit`, models.clean ? 'every assistant turn so far ran on Haiku' : `offenders: ${JSON.stringify(models.offenders.map((o) => `${o.role} ${o.model} x${o.count}`))}`);
    if (!models.clean) throw new Stop(`a session ran on another model: ${models.offenders.map((o) => `${o.role} (${o.model})`).join(', ')}`);
  },
});

const s9 = (n, run) => ({ id: `s9-${n}`, wave: 4, smoke: [1, 2, 4].includes(n), run });

export const STEPS = [
  { id: 'stage', wave: 1, smoke: true, async run(ctx, io) { ctx.state.stage = await io.host.stage({ out: ctx.folder }); await note(ctx, 'stage', 'plugin staged without this kit or the tests'); } },
  {
    id: 'create-repo', wave: 1, smoke: true, needsGo,
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
    id: 'install', wave: 1, smoke: true, needsGo,
    asks: () => 'Install the staged plugin into Claude Code and use Haiku for the trial? Answer go.',
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
    id: 'seed', wave: 1, smoke: true,
    async run(ctx, io) {
      const made = await io.host.makeProject({ dir: ctx.projectDir });
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
    id: 'setup-s0', wave: 1, smoke: true,
    async run(ctx, io) {
      let restarted = false;
      const start = async () => {
        await desk(ctx, SETUP, { WHEELHOUSE_SETUP_MODEL: 'haiku' });
        io.tmux.type(SETUP, restarted ? 'carry on with setup' : '/wheelhouse:setup');
      };
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
        if (SETUP_DONE.test(pane) && openPicker(pane) === null) return true;
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
      ctx.state.panes.setup.push(io.tmux.capture(SETUP));
      await note(ctx, LOG.health, done ? 'pass' : 'fail: setup did not finish in time');
      ctx.state.config = await io.host.readConfig({ dir: ctx.projectDir });
      endSession(ctx, SETUP);
      if (!done) throw new Stop('setup did not finish');
    },
  },
  {
    id: 'front-desk', wave: 1, smoke: true,
    async run(ctx, io) {
      await desk(ctx, DESK);
      const on = await io.host.typedRepliesOn({ project: ctx.projectName });
      await note(ctx, 'front-desk', `typed replies on: ${on}`);
      ctx.state.ntfyTopic = `haiku-trial-${ctx.date}-${Math.floor(io.clock.now() / 1000) % 100000}`;
      await say(ctx, `alerts ntfy ${ctx.state.ntfyTopic}`);
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
      if (!found) throw new Stop("P1's branch never got a first commit");
      // P1 may not run as a feature session (intake can size it smaller); the fault is then noted as not exercised and
      // the run goes on.
      const killed = await io.faults.f3KillFeature({ project: ctx.projectDir, piece }).catch((error) => ({ error: error.message }));
      await note(ctx, LOG.fault('F3'), killed?.error ? `not exercised: ${killed.error}` : `killed P1's feature session ${JSON.stringify(killed)}`);
    },
  },
  {
    id: 'w2-merge-wait', wave: 2, smoke: true,
    async run(ctx) { await waitMerged(ctx, 3, 2); await spareBugCheck(ctx); },
  },
  auditStep(2),
  { id: 'w3-type', wave: 3, smoke: false, run: piecesTyped(3) },
  {
    id: 'f1', wave: 3, smoke: false,
    async run(ctx, io) {
      const env = await pieceEnv(ctx, 'P3');
      ctx.state.faults.F1 = await io.faults.f1WrongShape(env);
      await note(ctx, LOG.fault('F1'), `F1 exit ${ctx.state.faults.F1.code}, sentBack ${ctx.state.faults.F1.sentBack}`);
    },
  },
  {
    id: 'f1b', wave: 3, smoke: false,
    async run(ctx, io) {
      const got = await io.faults.f1bStuck(await pieceEnv(ctx, 'P3'));
      ctx.state.faults.F1b = { ...got };
      await note(ctx, LOG.fault('F1b'), `stuck at try ${got.stuckAt}`);
    },
  },
  {
    id: 'f1c', wave: 3, smoke: false,
    async run(ctx, io) {
      const got = await io.faults.f1cDirectorKind(await pieceEnv(ctx, 'P3'));
      ctx.state.faults.F1c = got;
      await note(ctx, LOG.fault('F1c'), `refused with code ${got.code}`);
    },
  },
  {
    id: 'f6-stop', wave: 3, smoke: false,
    async run(ctx, io) {
      ctx.state.stopAt = io.clock.now();
      await io.faults.f6AllStop(io.tmux);
      await io.clock.sleep(10000);
      await note(ctx, LOG.stopSet, 'All stop typed', { detail: { at: ctx.state.stopAt } });
      await note(ctx, LOG.fault('F6'), 'All stop set');
    },
  },
  {
    id: 'f6-undo', wave: 3, smoke: false,
    async run(ctx, io) {
      const sha = await p6Sha(ctx);
      await io.faults.undoTyped(io.tmux, sha);
      await io.clock.sleep(20000);
      await note(ctx, 'f6-undo', `undo typed under All stop: ${io.tmux.capture(DESK).split('\n').filter((l) => /All stop is on/.test(l)).join(' ') || 'no refusal text seen'}`);
    },
  },
  {
    id: 'f6-wait-5m', wave: 3, smoke: false,
    async run(ctx, io) {
      const until = (ctx.state.stopAt ?? io.clock.now()) + 5 * MINUTE;
      await waitFor(async () => { await tick(ctx); return io.clock.now() >= until; }, { io, timeoutMs: 6 * MINUTE });
      ctx.state.panes['front-desk'].push(io.tmux.capture(DESK));
      await note(ctx, 'f6-wait-5m', 'five minutes with no new start allowed');
    },
  },
  {
    id: 'f6-lift', wave: 3, smoke: false, director: true,
    async run(ctx, io) {
      await io.faults.liftTyped(io.tmux);
      const lifted = await waitFor(async () => {
        await tick(ctx);
        return (await io.host.events({ project: ctx.projectName })).some((e) => e.kind === 'action' && e.data?.action === 'lift-stop');
      }, { io, timeoutMs: 2 * MINUTE });
      if (!lifted) await directorAsk(ctx, 'Lift All stop in the helper window, then answer done.');
      await note(ctx, 'f6-lift', 'All stop lifted');
    },
  },
  {
    id: 'f5a-undo-p6', wave: 3, smoke: false, director: true,
    async run(ctx, io) {
      await io.faults.undoTyped(io.tmux, await p6Sha(ctx));
      await directorAsk(ctx, "Approve the undo of piece P6's merge in the helper window (the first of two), then answer done.");
      await waitFor(async () => { await tick(ctx); return (await ghPulls(ctx)).some((p) => /^wheelhouse\/undo-/.test(p.head?.ref ?? '') && p.merged_at); }, { io, timeoutMs: 20 * MINUTE });
      await note(ctx, LOG.fault('F5a'), 'undo of P6 approved; waited for the take-back merge');
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
      const got = await io.faults.decisionFallback(env);
      await note(ctx, 'fallback', `P4 raised no decision; the runner raised one: ${JSON.stringify(got)}`);
      await io.clock.sleep(30000);
    }
    try {
      const env = await io.faults.featureEnvOf({ project: ctx.projectDir, piece: ctx.state.pieces.P4?.change ?? 'p4' });
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
    id: 'f5b-undo-p2', wave: 4, smoke: false, director: true,
    async run(ctx, io) {
      const pulls = await ghPulls(ctx);
      const p2 = pullOf(pulls, ctx.state.pieces.P2?.change ?? 'categor');
      await io.faults.undoTyped(io.tmux, p2?.merge_commit_sha ?? 'unknown');
      await directorAsk(ctx, "Approve the undo of piece P2's merge in the helper window (the second of two), then answer done. It should clash.");
      await note(ctx, LOG.fault('F5b'), `undo of P2 approved; reply: ${io.tmux.capture(DESK).split('\n').filter((l) => /clashes with later work/.test(l)).join(' ') || 'no clash text seen'}`);
    },
  },
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
      io.results.writeSummary({ file, date: ctx.date, rows: ctx.state.rows ?? [], score: ctx.state.score, audit: ctx.state.audit, usage });
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
      if (!Number.isInteger(decisionN)) throw new Stop('decision 3 has no number, so the review steps cannot point at it');
      const stepsFile = path.join(ctx.folder, 'steps.md');
      fs.writeFileSync(stepsFile, stepsPage({ decisionN }));
      const tryMe = writeTryMe(ctx.folder);
      const card = reviewCard({ project: ctx.repoName, date: ctx.date, decisionN, stepsUrl: stepsFile, score: ctx.state.score, rows: ctx.state.rows });
      fs.writeFileSync(path.join(ctx.folder, 'review-card.json'), `${JSON.stringify(card, null, 2)}\n`);
      // The card goes through the front desk as a decision, so it reads as it will on a phone; the terminal is the fallback.
      let answer = null;
      const env = ctx.state.p4env;
      const raised = env && fs.existsSync(env.cwd ?? '') ? await io.faults.reviewDecision({ ...env, card: reviewAsDecision(card, { stepsUrl: stepsFile }) }) : { code: null, stdout: 'no environment' };
      if (raised.code === 0) {
        const askedAt = io.clock.now();
        io.log?.(`The review card is in the chat as a decision. Try the tracker (statement: ${tryMe}), then answer there with its number and A, B or C.`);
        await waitFor(async () => {
          await tick(ctx);
          const found = (await io.host.events({ project: ctx.projectName })).filter((e) => e.kind === 'decision-answer' && Date.parse(e.at) >= askedAt - 1000 && answerLetter(e.data?.label) !== null && e.data?.n === decisionN + 1).pop(); // the card follows decision 3 in the numbering
          answer = found ? answerLetter(found.data.label) : null;
          return answer !== null;
        }, { io, timeoutMs: 120 * MINUTE, everyMs: 30000 });
      } else {
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
  return (pullOf(pulls, ctx.state.pieces.P6?.change) ?? pullOf(pulls, 'node 24'))?.merge_commit_sha ?? 'unknown';
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
  if (pieces.P8) pieces.P8.gate = await io.host.readGate({ change: pieces.P8.change, project: ctx.projectName });
  const mainCi = await io.host.readMain({ dir: ctx.projectDir, file: '.github/workflows/ci.yml' });
  const config = state.config ?? (await io.host.readConfig({ dir: ctx.projectDir }));
  const full = await io.signals.gatherContext({
    project: ctx.projectName, gh: io.gh, runLog: readLog(ctx.logFile).filter((e) => e.done !== true), panes: state.panes, transcripts, pieces,
    scores: state.score, previews: ctx.preview, config, ntfy: state.ntfy, faults: state.faults,
    branches: state.branches, mainCi, digestAt: state.digestAt, projectName: ctx.repoName,
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
  const rows = io.signals.checkAll(full, { smoke: ctx.smoke });
  return state.p5 === 'not-covered'
    ? rows.map((r) => (r.id === 6 ? { ...r, pass: null, evidence: `not covered: ${state.p5Why}` } : r))
    : rows;
}

// --- planning and running ---

export function planRun({ mode = 'full' } = {}) {
  return mode === 'smoke' ? STEPS.filter((s) => s.smoke) : STEPS.filter((s) => s.smokeOnly !== true);
}

const lastDone = (file) => readLog(file).filter((e) => e.done === true).map((e) => e.step).filter((id) => STEPS.some((s) => s.id === id)).pop();

function contextFor({ mode, io, folder, date, env }) {
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
    mode, io, env, folder, date, state, stateFile, smoke: mode === 'smoke', repoName, owner,
    repoSlug: `${owner}/${repoName}`, remote: `https://github.com/${owner}/${repoName}.git`,
    projectDir: path.join(folder, 'project'), projectName, logFile: path.join(folder, 'run-log.jsonl'),
    claude: env.HAIKU_TRIAL_CLAUDE ?? 'claude', preview: env.HAIKU_TRIAL_PREVIEW ?? 'none',
  };
}

export async function run({ mode = 'full', io: given, from, until, folder, date, env = process.env } = {}) {
  const problem = homeProblem(env);
  if (problem) return { done: [], stoppedAt: 'wheelhouse-home', why: problem };
  const io = { ...given, host: { ...NOTHING, ...(given.host ?? {}) } };
  const day = date ?? new Date(io.clock.now()).toISOString().slice(0, 10);
  const where = folder ?? io.results.runFolder(day);
  fs.mkdirSync(where, { recursive: true });
  const ctx = contextFor({ mode, io, folder: where, date: day, env });
  io.host.useRepo(ctx.repoSlug);
  const plan = planRun({ mode });
  let start = 0;
  if (from === 'auto') {
    const at = plan.findIndex((s) => s.id === lastDone(ctx.logFile));
    start = at < 0 ? 0 : at + 1;
  } else if (from) {
    start = plan.findIndex((s) => s.id === from);
    if (start < 0) throw new Error(`No step called ${from} in the ${mode} plan`);
  }
  // Before anything is created: a tunnel preview needs cloudflared.
  if (ctx.preview === 'tunnel' && plan.slice(start).some((s) => s.id === 'create-preview') && !(await io.host.hasCommand('cloudflared'))) {
    return { done: [], stoppedAt: 'create-preview', why: 'HAIKU_TRIAL_PREVIEW is tunnel but cloudflared is not installed. Install it (brew install cloudflared) or use vercel or none. Nothing was created.' };
  }
  const done = [];
  for (const step of plan.slice(start)) {
    try {
      if (step.needsGo) {
        if (!ctx.owner) throw new Stop('HAIKU_TRIAL_GH_OWNER is not set');
        const answer = await io.ask(step.asks?.(ctx) ?? `Go ahead with ${step.id}? Answer go.`);
        if (String(answer).trim().toLowerCase() !== 'go') {
          await note(ctx, step.id, `stopped: the answer was "${answer}", not go`);
          return { done, stoppedAt: step.id, why: 'waiting for the director\'s go' };
        }
      }
      io.log?.(`step ${step.id}`);
      ctx.directorStep = step.director === true;
      await step.run(ctx, io);
    } catch (error) {
      await note(ctx, step.id, `stopped: ${error.message}`);
      fs.writeFileSync(ctx.stateFile, `${JSON.stringify(ctx.state, null, 2)}\n`);
      return { done, stoppedAt: step.id, why: error.message };
    }
    await appendJsonl(ctx.logFile, { at: iso(ctx), step: step.id, note: 'done', done: true });
    fs.writeFileSync(ctx.stateFile, `${JSON.stringify(ctx.state, null, 2)}\n`);
    done.push(step.id);
    if (until === step.id) break;
  }
  return { done };
}

// Stops what this run started, as its log records it, and nothing else. It deletes nothing.
export async function restore({ folder, io }) {
  const stopped = [];
  const entries = readLog(path.join(folder, 'run-log.jsonl'));
  const names = new Set(entries.flatMap((e) => [].concat(e.detail?.tmux ?? [])).filter((n) => String(n).startsWith(SESSION_PREFIX)));
  const pids = new Set(entries.flatMap((e) => [e.detail?.productPid, e.detail?.tunnelPid]).filter((p) => Number.isInteger(p)));
  const live = new Set(io.tmux.list());
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
  for (const what of (await io.host.stopWheelhouse?.()) ?? []) stopped.push(what);
  return { stopped };
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

const USAGE = 'usage: node probes/haiku-trial/runner.js full | smoke | restore | plan [--from <step>] [--out <folder>] [--until <step>] [--date <label>]\n  --date <label> (or HAIKU_TRIAL_DATE) names the run: YYYY-MM-DD with an optional -suffix such as 2026-11-08-b';

function parseArgs(argv) {
  const out = { command: argv[0], from: undefined, folder: undefined, until: undefined, date: undefined };
  for (let i = 1; i < argv.length; i += 1) {
    if (argv[i] === '--from') out.from = argv[(i += 1)];
    else if (argv[i] === '--out') out.folder = argv[(i += 1)];
    else if (argv[i] === '--until') out.until = argv[(i += 1)];
    else if (argv[i] === '--date') out.date = argv[(i += 1)] ?? '';
  }
  return out;
}

export async function main(argv, { print = console.log, buildIo, env = process.env } = {}) {
  const args = parseArgs(argv);
  let label;
  try {
    label = runLabel({ arg: args.date, env });
  } catch (error) {
    print(error.message);
    print(USAGE);
    return 2;
  }
  if (args.command === 'plan') {
    for (const mode of ['full', 'smoke']) {
      print(`${mode}: ${planRun({ mode }).map((s) => `${s.id}${s.needsGo ? '*' : ''}${s.director ? '+' : ''}`).join(' ')}`);
    }
    print('* waits for the director\'s go, + needs the director');
    if (label !== undefined) print(`run ${label}: repository ${env.HAIKU_TRIAL_GH_OWNER ?? '<owner>'}/haiku-trial-${label}, folder ${args.folder ?? runFolder(label)}`);
    return 0;
  }
  if (!['full', 'smoke', 'restore'].includes(args.command)) {
    print(USAGE);
    return 2;
  }
  const io = await buildIo(env);
  const folder = args.folder ?? io.results.runFolder(label ?? new Date(io.clock.now()).toISOString().slice(0, 10));
  // Everything Wheelhouse keeps follows WHEELHOUSE_HOME: set it to the trial's own folder before anything reads it, and refuse the real one.
  const home = trialHome({ folder, env });
  const given = { ...env, WHEELHOUSE_HOME: home };
  process.env.WHEELHOUSE_HOME = home;
  const problem = homeProblem(given);
  if (problem) { print(JSON.stringify({ stoppedAt: 'wheelhouse-home', why: problem })); return 1; }
  fs.mkdirSync(home, { recursive: true });
  if (args.command === 'restore') {
    print(JSON.stringify(await restore({ folder, io })));
    return 0;
  }
  const result = await run({ mode: args.command, io, from: args.from ?? 'auto', until: args.until, folder, date: label, env: given });
  print(JSON.stringify(result));
  return result.stoppedAt ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { buildRealIo } = await import('./host.js');
  process.exitCode = await main(process.argv.slice(2), { buildIo: buildRealIo });
}
