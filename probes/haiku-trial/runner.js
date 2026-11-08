// probes/haiku-trial/runner.js
// The Haiku trial's run script (spec section 7): the steps in order, the faults at their moments, the log that lets a run
// resume, and `restore`. Everything it touches arrives through `io`, so tests drive it with a fake and nothing real starts.
// Nothing here runs a trial until the director's go: the steps that create things ask first.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendJsonl } from '../lib/log.js';
import { PIECES, WAVES, P5_SPARE, F2_ANSWER } from './requests.js';
import { SESSION_PREFIX, frontDeskCommand } from './tmux.js';
import { STEPS as LOG } from './signals.js';
import { installCommand } from './stage-plugin.js';
import { reviewCard, stepsPage, writeTryMe } from './review-card.js';

const MINUTE = 60 * 1000;
const DESK = 'desk';
const SETUP = 'setup';
const WHY_WAIT_MS = 100 * 1000 + 20 * 1000;
const WAVE_WAIT_MS = { 2: 90 * MINUTE, 3: 150 * MINUTE, 4: 90 * MINUTE };
const SPARE_BRANCH = 'trial/spare-bug';
const pieceOf = (id) => PIECES.find((p) => p.id === id);

export class Stop extends Error {}

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
  findTranscripts: () => [],
  cloneMain: async ({ dir }) => dir,
  commitAndPush: async () => ({}),
  applySpareBug: () => ({ applied: false, why: 'not wired' }),
  startTunnel: async () => ({}),
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
const newLines = (before, after) => {
  const seen = new Set(String(before).split('\n'));
  return String(after).split('\n').filter((l) => l.trim() !== '' && !seen.has(l)).join('\n');
};

// Types into the front desk, waits for the pane to settle, and keeps what appeared as a reply.
// With `ready`, it keeps waiting (up to `maxMs`) until `ready(reply)` is true, as for an answer that comes from a fork.
async function say(ctx, text, { ready, maxMs = 90000 } = {}) {
  const { io, state } = ctx;
  const before = io.tmux.capture(DESK);
  io.tmux.type(DESK, text);
  let last = before;
  let still = 0;
  const end = io.clock.now() + maxMs;
  while (io.clock.now() < end) {
    await io.clock.sleep(5000);
    const now = io.tmux.capture(DESK);
    still = now === last ? still + 1 : 0;
    last = now;
    await tick(ctx);
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
const OWN_BRANCH = /^(trial\/|wheelhouse\/(undo|decisions))/;
const mergedWork = (pulls) => pulls.filter((p) => p.merged_at && !OWN_BRANCH.test(p.head?.ref ?? ''));
const mergedPulls = async (ctx) => mergedWork(await ghPulls(ctx));
const pullOf = (pulls, text) => pulls.find((p) => text !== undefined && text !== '' && `${p.head?.ref ?? ''} ${p.title ?? ''}`.toLowerCase().includes(String(text).toLowerCase()));

// One look at the project: events become log entries, open cards get the director's stand-in answer, and F3b fires when armed.
async function tick(ctx) {
  const { io, state } = ctx;
  const events = await io.host.events({ project: ctx.project });
  for (const e of events) {
    if (e.id === undefined || state.seen.includes(e.id)) continue;
    state.seen.push(e.id);
    if (e.kind === 'work-ready') await note(ctx, LOG.workReady, `work-ready ${e.data?.work ?? ''}`, { work: e.data?.work, detail: e.data?.detail ?? e.data, at: e.at ?? iso(ctx) });
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
  await io.host.answerCards({ project: ctx.project, tmux: io.tmux, events });
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

// Types a piece's request, answers intake's visibility question for P8, and notes which work event it became.
async function typeRequest(ctx, id, text = pieceOf(id).text) {
  const { io, state } = ctx;
  const known = new Set((await io.host.events({ project: ctx.project })).filter((e) => e.kind === 'work').map((e) => e.data?.id));
  let answered = false;
  io.tmux.type(DESK, text);
  const found = [];
  await waitFor(async () => {
    const work = (await io.host.events({ project: ctx.project })).filter((e) => e.kind === 'work' && !known.has(e.data?.id));
    if (work.length > 0) { found.push(work[0]); return true; }
    if (id === 'P8' && !answered && /nobody sees|anyone see|visible/i.test(io.tmux.capture(DESK))) { answered = true; io.tmux.type(DESK, F2_ANSWER); }
    await tick(ctx);
    return false;
  }, { io, timeoutMs: 5 * MINUTE, everyMs: 10000 });
  state.pieces[id] = { ...(state.pieces[id] ?? {}), change: found[0]?.data?.id, typedAt: iso(ctx) };
  await note(ctx, id, found.length > 0 ? `typed; became work ${found[0].data?.id}` : 'typed; no work event seen yet', { work: found[0]?.data?.id });
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
  const read = await io.host.mainParseAmount({ project: ctx.project });
  if (read?.ok === false) {
    await note(ctx, 'plant', `could not read main's parseAmount: ${read.why ?? 'no reason given'}`);
    return;
  }
  const amount = read?.amount;
  if (!(typeof amount === 'number' && amount < 0)) return;
  await note(ctx, 'plant', 'planted bug fixed early', { amount });
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
  await ghDo(ctx, ['pr', 'merge', SPARE_BRANCH, '--squash']);
  state.p5 = 'spare';
  await note(ctx, 'plant', 'spare bug merged; P5 will use the spare request');
}

// --- the steps ---

const piecesTyped = (wave) => async (ctx) => typeWave(ctx, wave);
const needsGo = true;

async function desk(ctx, name, extraEnv = {}) {
  const { io } = ctx;
  const { command, env } = frontDeskCommand({ claude: ctx.claude });
  io.tmux.start({ name, cwd: ctx.project, command, env: { ...env, ...extraEnv } });
  await note(ctx, name === DESK ? 'front-desk' : name, `started tmux session ${SESSION_PREFIX}${name}`, { detail: { tmux: `${SESSION_PREFIX}${name}` } });
  await ctx.io.clock.sleep(15000);
}

async function pieceEnv(ctx, id) {
  const piece = ctx.state.pieces[id]?.change ?? id.toLowerCase();
  let got;
  const found = await waitFor(async () => {
    try { got = await ctx.io.faults.featureEnvOf({ project: ctx.project, piece }); return true; } catch { await tick(ctx); return false; }
  }, { io: ctx.io, timeoutMs: 40 * MINUTE });
  if (!found) throw new Stop(`no running feature session names ${id}`);
  return got;
}

const directorAsk = async (ctx, text) => {
  const answer = await ctx.io.ask(text);
  await note(ctx, 'director', `${text} -> ${answer}`);
  return answer;
};

const s9 = (n, run) => ({ id: `s9-${n}`, wave: 4, smoke: [1, 2, 4].includes(n), run });

export const STEPS = [
  { id: 'stage', wave: 1, smoke: true, async run(ctx, io) { ctx.state.stage = await io.host.stage({ out: ctx.folder }); await note(ctx, 'stage', 'plugin staged without probes or tests'); } },
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
        const got = await io.host.startTunnel({ project: ctx.project });
        await note(ctx, 'tunnel', 'preview tunnel started', { detail: { productPid: got.productPid, tunnelPid: got.tunnelPid } });
      } else await note(ctx, 'create-preview', 'no previews: the pictures rows are not covered');
    },
  },
  {
    id: 'install', wave: 1, smoke: true, needsGo,
    asks: () => 'Install the staged plugin into Claude Code and use Haiku for the trial? Answer go.',
    async run(ctx, io) {
      const lines = installCommand({ marketplaceDir: ctx.state.stage?.marketplaceDir, configDir: ctx.env.HAIKU_TRIAL_CONFIG_DIR, claude: ctx.claude });
      for (const line of lines) {
        const got = await io.host.exec(line, { cwd: ctx.folder });
        await note(ctx, 'install', `${line.join(' ')} -> ${got.status}`);
        if (got.status !== 0) throw new Stop(`install failed: ${line.join(' ')}`);
      }
    },
  },
  {
    id: 'seed', wave: 1, smoke: true,
    async run(ctx, io) {
      const made = await io.host.makeProject({ dir: ctx.project });
      ctx.state.seedSha = made.sha;
      await io.host.git(['remote', 'add', 'origin', ctx.remote], { cwd: ctx.project });
      await io.host.git(['push', '-u', 'origin', 'main'], { cwd: ctx.project });
      await note(ctx, 'seed', `seeded and pushed ${made.sha ?? ''}`);
    },
  },
  {
    id: 'setup-s0', wave: 1, smoke: true,
    async run(ctx, io) {
      await desk(ctx, SETUP, { WHEELHOUSE_SETUP_MODEL: 'haiku' });
      io.tmux.type(SETUP, '/wheelhouse:setup');
      const done = await waitFor(async () => /setup (is )?(done|complete)|health check passed/i.test(io.tmux.capture(SETUP)), { io, timeoutMs: 30 * MINUTE });
      ctx.state.panes.setup = [io.tmux.capture(SETUP)];
      await note(ctx, LOG.health, done ? 'pass' : 'fail: setup did not finish in time');
      ctx.state.config = await io.host.readConfig({ project: ctx.project });
      io.tmux.kill(SETUP);
      if (!done) throw new Stop('setup did not finish');
    },
  },
  {
    id: 'front-desk', wave: 1, smoke: true,
    async run(ctx, io) {
      await desk(ctx, DESK);
      const on = await io.host.typedRepliesOn({ project: ctx.project });
      await note(ctx, 'front-desk', `typed replies on: ${on}`);
      ctx.state.ntfyTopic = `haiku-trial-${ctx.date}-${Math.floor(io.clock.now() / 1000) % 100000}`;
      await say(ctx, `alerts ntfy ${ctx.state.ntfyTopic}`);
    },
  },
  { id: 'w2-type', wave: 2, smoke: true, run: piecesTyped(2) },
  {
    id: 'f3-kill-p1', wave: 2, smoke: true,
    async run(ctx, io) {
      const piece = ctx.state.pieces.P1?.change ?? 'p1';
      const found = await waitFor(async () => {
        await tick(ctx);
        const branch = ((await io.gh(['api', 'repos/{owner}/{repo}/branches?per_page=100'])) ?? []).map((b) => b.name).find((n) => n.toLowerCase().includes(String(piece).toLowerCase()));
        if (!branch) return false;
        const cmp = await io.gh(['api', `repos/{owner}/{repo}/compare/main...${branch}`]);
        return (cmp?.ahead_by ?? 0) > 0;
      }, { io, timeoutMs: 45 * MINUTE });
      if (!found) throw new Stop("P1's branch never got a first commit");
      const killed = await io.faults.f3KillFeature({ project: ctx.project, piece });
      await note(ctx, LOG.fault('F3'), `killed P1's feature session ${JSON.stringify(killed)}`);
    },
  },
  {
    id: 'w2-merge-wait', wave: 2, smoke: true,
    async run(ctx) { await waitMerged(ctx, 3, 2); await spareBugCheck(ctx); },
  },
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
        return (await io.host.events({ project: ctx.project })).some((e) => e.kind === 'action' && e.data?.action === 'lift-stop');
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
    const raised = await waitFor(async () => { await tick(ctx); return (await io.host.events({ project: ctx.project })).some((e) => e.kind === 'question' && (change === undefined || e.data?.work === change)); }, { io, timeoutMs: 40 * MINUTE });
    if (!raised) {
      const env = await pieceEnv(ctx, 'P4');
      const got = await io.faults.decisionFallback(env);
      await note(ctx, 'fallback', `P4 raised no decision; the runner raised one: ${JSON.stringify(got)}`);
      await io.clock.sleep(30000);
    }
    await note(ctx, 's9-1', `typed replies on: ${await io.host.typedRepliesOn({ project: ctx.project })}; decision 1 in chat: ${/decision 1/i.test(io.tmux.capture(DESK))}`);
    await tick(ctx);
  }),
  s9(2, async (ctx, io) => {
    for (const text of ['3 A', '1 E']) await note(ctx, 's9-2', `${text}: ${(await say(ctx, text)).slice(0, 300)}`);
    await note(ctx, LOG.why, 'typed "why 1"');
    const reply = await say(ctx, 'why 1', { maxMs: WHY_WAIT_MS, ready: (text) => text.split('\n').some((l) => !/^\W*(>\s*)?why 1\s*$/i.test(l.trim()) && l.trim().length > 40) });
    await note(ctx, LOG.whySeen, reply || 'no reply');
  }),
  s9(3, async (ctx, io) => {
    const got = await io.faults.secondDecision(await pieceEnv(ctx, 'P4'));
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
      const call = (await io.host.events({ project: ctx.project })).find((e) => e.kind === 'agent-call');
      if (!call) { await note(ctx, 'pull-back', 'no logged agent call to pull back'); return; }
      await note(ctx, 'pull-back', (await say(ctx, `pull-back ${call.id}`)).slice(0, 300));
      await tick(ctx);
    },
  },
  {
    id: 'digest', wave: 4, smoke: false,
    async run(ctx, io) {
      const at = new Date(io.clock.now() + 10 * MINUTE);
      ctx.state.digestAt = at.toISOString();
      const set = await io.host.setDigest({ project: ctx.project, at });
      await note(ctx, 'digest-set', `digest due ${ctx.state.digestAt}: ${JSON.stringify(set)}`);
      const arrived = await waitFor(async () => { await tick(ctx); return /Daily digest,/.test(io.tmux.capture(DESK)); }, { io, timeoutMs: 20 * MINUTE });
      if (arrived) await note(ctx, LOG.digest, 'the digest reached the chat');
    },
  },
  { id: 'w4-merge-wait', wave: 4, smoke: false, async run(ctx) { await waitMerged(ctx, 3 + (ctx.state.p5 === 'not-covered' ? 3 : 4) + 2, 4); } },
  {
    id: 'w5-incident', wave: 5, smoke: false,
    async run(ctx, io) {
      await say(ctx, "record incident: the trial's own check, nothing is wrong");
      const refused = await say(ctx, 'merge the next approved change');
      await note(ctx, LOG.fault('W5'), `incident recorded; merge reply: ${refused.slice(0, 300)}`);
      await tick(ctx);
      await waitFor(async () => { await tick(ctx); return (await io.host.events({ project: ctx.project })).some((e) => e.kind === 'incident-closed'); }, { io, timeoutMs: 10 * MINUTE });
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
      ctx.state.score = await io.score.scoreAll({ dir, baseSha: ctx.state.seedSha, gh: io.gh, browse: io.host.makeBrowse?.({ toolsDir: path.join(ctx.folder, 'tools') }), smoke: ctx.smoke });
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
      const transcripts = io.host.findTranscripts({ project: ctx.project });
      const usage = io.host.readUsage ? io.host.readUsage(transcripts) : {};
      const runLog = readLog(ctx.logFile);
      io.results.writeRaw({ folder: ctx.folder, transcripts, events: await io.host.events({ project: ctx.project }), panes: ctx.state.panes, runLog, usage });
      const file = path.join(ctx.folder, 'summary', `${ctx.date}-haiku-trial-results.md`);
      io.results.writeSummary({ file, date: ctx.date, rows: ctx.state.rows ?? [], score: ctx.state.score, audit: ctx.state.audit, usage });
      await note(ctx, 'results', `raw results and summary under ${ctx.folder}`);
    },
  },
  {
    id: 'review-card', wave: 6, smoke: false, director: true,
    async run(ctx, io) {
      const decisionN = 3;
      const stepsFile = path.join(ctx.folder, 'steps.md');
      fs.writeFileSync(stepsFile, stepsPage({ decisionN }));
      const tryMe = writeTryMe(ctx.folder);
      const card = reviewCard({ project: ctx.repoName, date: ctx.date, decisionN, stepsUrl: stepsFile, score: ctx.state.score, rows: ctx.state.rows });
      fs.writeFileSync(path.join(ctx.folder, 'review-card.json'), `${JSON.stringify(card, null, 2)}\n`);
      const answer = await directorAsk(ctx, `${card.title}\n\n${card.text}\n\nThe statement to import is ${tryMe}. Answer A, B or C.`);
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
  const transcripts = io.host.findTranscripts({ project: ctx.project });
  const pieces = state.pieces;
  if (pieces.P8) pieces.P8.gate = await io.host.readGate({ change: pieces.P8.change, project: ctx.project });
  const mainCi = await io.host.readMain({ project: ctx.project, file: '.github/workflows/ci.yml' });
  const config = state.config ?? (await io.host.readConfig({ project: ctx.project }));
  const full = await io.signals.gatherContext({
    project: ctx.project, gh: io.gh, runLog: readLog(ctx.logFile).filter((e) => e.done !== true), panes: state.panes, transcripts, pieces,
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
  return mode === 'smoke' ? STEPS.filter((s) => s.smoke) : [...STEPS];
}

const lastDone = (file) => readLog(file).filter((e) => e.done === true).map((e) => e.step).filter((id) => STEPS.some((s) => s.id === id)).pop();

function contextFor({ mode, io, folder, date, env }) {
  const owner = env.HAIKU_TRIAL_GH_OWNER;
  const repoName = `haiku-trial-${date}`;
  const stateFile = path.join(folder, 'state.json');
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { /* a fresh run */ }
  const state = {
    pieces: {}, faults: {}, ntfy: [], seen: [], branches: [], panes: { 'front-desk': [], replies: [] }, p5: 'original', ...saved,
  };
  return {
    mode, io, env, folder, date, state, stateFile, smoke: mode === 'smoke', repoName, owner,
    repoSlug: `${owner}/${repoName}`, remote: `https://github.com/${owner}/${repoName}.git`,
    project: path.join(folder, 'project'), logFile: path.join(folder, 'run-log.jsonl'),
    claude: env.HAIKU_TRIAL_CLAUDE ?? 'claude', preview: env.HAIKU_TRIAL_PREVIEW ?? 'none',
  };
}

export async function run({ mode = 'full', io: given, from, until, folder, date, env = process.env } = {}) {
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
  return { stopped };
}

// --- the command line ---

function parseArgs(argv) {
  const out = { command: argv[0], from: undefined, folder: undefined, until: undefined };
  for (let i = 1; i < argv.length; i += 1) {
    if (argv[i] === '--from') out.from = argv[(i += 1)];
    else if (argv[i] === '--out') out.folder = argv[(i += 1)];
    else if (argv[i] === '--until') out.until = argv[(i += 1)];
  }
  return out;
}

export async function main(argv, { print = console.log, buildIo, env = process.env } = {}) {
  const args = parseArgs(argv);
  if (args.command === 'plan') {
    for (const mode of ['full', 'smoke']) {
      print(`${mode}: ${planRun({ mode }).map((s) => `${s.id}${s.needsGo ? '*' : ''}${s.director ? '+' : ''}`).join(' ')}`);
    }
    print('* waits for the director\'s go, + needs the director');
    return 0;
  }
  if (!['full', 'smoke', 'restore'].includes(args.command)) {
    print('usage: node probes/haiku-trial/runner.js full | smoke | restore | plan [--from <step>] [--out <folder>]');
    return 2;
  }
  const io = await buildIo(env);
  const folder = args.folder ?? io.results.runFolder(new Date(io.clock.now()).toISOString().slice(0, 10));
  if (args.command === 'restore') {
    print(JSON.stringify(await restore({ folder, io })));
    return 0;
  }
  const result = await run({ mode: args.command, io, from: args.from ?? 'auto', until: args.until, folder, env });
  print(JSON.stringify(result));
  return result.stoppedAt ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { buildRealIo } = await import('./host.js');
  process.exitCode = await main(process.argv.slice(2), { buildIo: buildRealIo });
}
