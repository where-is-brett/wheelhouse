// tests/probes/haiku-trial/runner.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { STEPS, planRun, run, restore, waitFor, main } from '../../../probes/haiku-trial/runner.js';
import { P5_SPARE } from '../../../probes/haiku-trial/requests.js';

const ENV = { HAIKU_TRIAL_GH_OWNER: 'trial-owner', HAIKU_TRIAL_CLAUDE: '/bin/claude', HAIKU_TRIAL_PREVIEW: 'none' };
const T0 = Date.parse('2026-11-08T09:00:00Z');

function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haiku-runner-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A fake io that records every call on one timeline and starts, finds and sleeps for nothing real.
function fakeIo(over = {}) {
  let now = T0;
  const timeline = [];
  const rec = (kind, ...args) => timeline.push({ kind, args, at: now });
  const io = {
    timeline,
    tmux: {
      start: (x) => rec('tmux.start', x), type: (name, text) => rec('tmux.type', name, text), keys: () => {}, capture: () => '',
      kill: (name) => rec('tmux.kill', name), list: () => over.sessions ?? [],
    },
    gh: async (args) => { rec('gh', args); return over.gh ? over.gh(args) : null; },
    clock: { now: () => now, sleep: async (ms) => { now += ms; } },
    signals: { checkAll: () => [], gatherContext: async () => ({}) },
    faults: {
      featureEnvOf: async () => ({ env: {}, cwd: '/w' }),
      f3KillFeature: async (x) => { rec('f3', x); return { pid: 1 }; },
      f3bKillForeman: async () => ({ pid: 2 }),
      f1WrongShape: () => ({ code: 2, sentBack: true }), f1bStuck: () => ({ tries: [], stuckAt: 3 }), f1cDirectorKind: () => ({ code: 1, text: '' }),
      f6AllStop: (tmux) => rec('f6.stop'), undoTyped: (tmux, sha) => rec('undo', sha), liftTyped: () => rec('f6.lift'),
      decisionFallback: () => ({}), secondDecision: () => ({ code: 0 }),
    },
    score: { scoreAll: async () => ({ total: 0, parts: {} }) },
    results: { runFolder: (d) => `/unused/${d}`, writeRaw: () => {}, writeSummary: () => {} },
    ask: async (text) => { rec('ask', text); return over.answer ?? 'go'; },
    log: () => {},
    kill: (pid, signal) => rec('kill', pid, signal),
    host: {
      stage: async () => ({ pluginDir: '/p', marketplaceDir: '/m' }),
      exec: async () => ({ status: 0 }),
      makeProject: async () => ({ sha: 'abc' }),
      git: async () => '',
      applySpareBug: (dir) => { rec('spare', dir); return over.spare ?? { applied: true }; },
      mainParseAmount: async () => over.amount ?? 40,
      cloneMain: async ({ dir }) => dir,
      commitAndPush: async () => ({}),
      ...(over.host ?? {}),
    },
  };
  return io;
}

const withLog = (folder, steps) => fs.writeFileSync(path.join(folder, 'run-log.jsonl'), steps.map((step) => JSON.stringify({ at: '2026-11-08T09:00:00.000Z', step, note: 'done', done: true })).join('\n') + '\n');
const readLog = (folder) => fs.readFileSync(path.join(folder, 'run-log.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const ids = (mode) => planRun({ mode }).map((s) => s.id);

test('full plan follows the waves', () => {
  const all = ids('full');
  assert.equal(new Set(all).size, all.length, 'each id is unique');
  const last = (wave) => Math.max(...STEPS.map((s, i) => (s.wave === wave ? i : -1)));
  const first = (wave) => Math.min(...STEPS.map((s, i) => (s.wave === wave ? i : Infinity)));
  for (let w = 1; w < 6; w += 1) assert.ok(last(w) < first(w + 1), `wave ${w} ends before wave ${w + 1}`);
  for (const id of all.filter((i) => i.startsWith('w2-'))) for (const later of all.filter((i) => i.startsWith('w3-'))) assert.ok(all.indexOf(id) < all.indexOf(later));
  assert.ok(all.indexOf('f6-lift') < all.indexOf('f5a-undo-p6'));
  assert.ok(all.indexOf('w2-merge-wait') < all.indexOf('w3-type'));
  assert.deepEqual(STEPS.filter((s) => s.needsGo).map((s) => s.id), ['create-repo', 'create-preview', 'install']);
  assert.deepEqual(STEPS.filter((s) => s.director).map((s) => s.id).sort(), ['create-preview', 'f5a-undo-p6', 'f5b-undo-p2', 'f6-lift', 'review-card']);
});

test('smoke plan is section 14', () => {
  const smoke = ids('smoke');
  for (const id of ['setup-s0', 'w2-type', 'f3-kill-p1', 's9-1', 's9-2', 's9-4', 'score']) assert.ok(smoke.includes(id), id);
  for (const id of ['f1', 'f6-stop', 'f5a-undo-p6', 's9-5', 'w5-midnight', 'review-card']) assert.equal(smoke.includes(id), false, id);
});

test('steps that create things wait for go', async (t) => {
  const folder = scratch(t);
  const io = fakeIo({ answer: 'not yet' });
  const got = await run({ mode: 'smoke', io, folder, date: '2026-11-08', env: ENV });
  assert.equal(got.stoppedAt, 'create-repo');
  assert.deepEqual(got.done, ['stage']);
  assert.equal(io.timeline.some((e) => e.kind === 'gh' && e.args[0].includes('repo') && e.args[0].includes('create')), false);
});

test('a missing GitHub owner stops before anything is asked', async (t) => {
  const io = fakeIo();
  const got = await run({ mode: 'smoke', io, folder: scratch(t), date: '2026-11-08', env: {} });
  assert.equal(got.stoppedAt, 'create-repo');
  assert.match(got.why, /HAIKU_TRIAL_GH_OWNER/);
  assert.equal(io.timeline.some((e) => e.kind === 'ask'), false);
});

test('a run resumes after the last logged step', async (t) => {
  const folder = scratch(t);
  withLog(folder, ['stage', 'create-repo', 'create-preview', 'install', 'seed', 'setup-s0', 'front-desk', 'w2-type']);
  const io = fakeIo({ gh: (args) => (args[1].includes('/branches') ? [{ name: 'wheelhouse/feature-p1' }] : { ahead_by: 1 }) });
  const got = await run({ mode: 'full', io, from: 'auto', until: 'f3-kill-p1', folder, date: '2026-11-08', env: ENV });
  assert.deepEqual(got.done, ['f3-kill-p1']);
});

test("f3 fires only after P1's first commit", async (t) => {
  const folder = scratch(t);
  let compares = 0;
  const io = fakeIo({
    gh: (args) => {
      if (args[1].includes('/branches')) return [{ name: 'wheelhouse/feature-p1' }];
      compares += 1;
      return { ahead_by: compares >= 3 ? 1 : 0 };
    },
  });
  const got = await run({ mode: 'full', io, from: 'f3-kill-p1', until: 'f3-kill-p1', folder, date: '2026-11-08', env: ENV });
  assert.deepEqual(got.done, ['f3-kill-p1']);
  const kills = io.timeline.filter((e) => e.kind === 'f3');
  assert.equal(kills.length, 1);
  assert.equal(io.timeline.filter((e) => e.kind === 'gh' && e.args[0][1].includes('/compare/')).length, 3);
  assert.ok(io.timeline.indexOf(kills[0]) > io.timeline.map((e) => e.kind === 'gh' && e.args[0][1].includes('/compare/')).lastIndexOf(true));
});

const threeMerged = (args) => (args[1].startsWith('repos/{owner}/{repo}/pulls') ? [1, 2, 3].map((n) => ({ number: n, merged_at: '2026-11-08T10:00:00Z', head: { ref: `feature/w${n}` } })) : null);

test('a planted bug already gone switches P5 to the spare bug', async (t) => {
  const folder = scratch(t);
  const io = fakeIo({ amount: -40, gh: threeMerged });
  const got = await run({ mode: 'full', io, from: 'w2-merge-wait', until: 'w3-type', folder, date: '2026-11-08', env: ENV });
  assert.deepEqual(got.done, ['w2-merge-wait', 'w3-type']);
  assert.ok(readLog(folder).some((e) => /planted bug fixed early/.test(e.note)));
  assert.ok(io.timeline.some((e) => e.kind === 'spare'));
  assert.ok(io.timeline.some((e) => e.kind === 'gh' && e.args[0][0] === 'pr' && e.args[0][1] === 'merge'), 'the spare branch merges by gh');
  const typed = io.timeline.filter((e) => e.kind === 'tmux.type').map((e) => e.args[1]);
  assert.ok(typed.some((x) => x.includes(P5_SPARE)));
  assert.equal(typed.some((x) => x.includes('A $40 refund')), false);
});

test('without the early fix P5 keeps its own text and no spare is applied', async (t) => {
  const folder = scratch(t);
  const io = fakeIo({ amount: 40, gh: threeMerged });
  await run({ mode: 'full', io, from: 'w2-merge-wait', until: 'w3-type', folder, date: '2026-11-08', env: ENV });
  assert.equal(io.timeline.some((e) => e.kind === 'spare'), false);
  assert.ok(io.timeline.filter((e) => e.kind === 'tmux.type').some((e) => e.args[1].includes('A $40 refund')));
});

test('spare bug that cannot apply marks P5 not covered', async (t) => {
  const folder = scratch(t);
  const io = fakeIo({ amount: -40, gh: threeMerged, spare: { applied: false, why: 'nothing in src/ uses monthOf' } });
  await run({ mode: 'full', io, from: 'w2-merge-wait', until: 'w3-type', folder, date: '2026-11-08', env: ENV });
  assert.ok(readLog(folder).some((e) => /P5 not covered: nothing in src\/ uses monthOf/.test(e.note)));
  const typed = io.timeline.filter((e) => e.kind === 'tmux.type').map((e) => e.args[1]);
  assert.equal(typed.some((x) => x.includes(P5_SPARE) || x.includes('A $40 refund')), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(folder, 'state.json'), 'utf8')).p5, 'not-covered');
});

test('f6 waits five minutes with no new start', async (t) => {
  const folder = scratch(t);
  const io = fakeIo();
  const got = await run({ mode: 'full', io, from: 'f6-stop', until: 'f6-lift', folder, date: '2026-11-08', env: ENV });
  assert.deepEqual(got.done, ['f6-stop', 'f6-undo', 'f6-wait-5m', 'f6-lift']);
  const stop = io.timeline.find((e) => e.kind === 'f6.stop');
  const lift = io.timeline.find((e) => e.kind === 'f6.lift');
  assert.ok(lift.at - stop.at >= 300000, `${lift.at - stop.at} ms between stop and lift`);
});

test('waitFor uses the injected clock and gives up at the timeout', async () => {
  const io = fakeIo();
  assert.equal(await waitFor(async () => false, { io, timeoutMs: 60000, everyMs: 15000 }), false);
  assert.equal(io.clock.now() - T0, 60000);
  assert.equal(await waitFor(async () => true, { io, timeoutMs: 1 }), true);
});

test('restore stops only what the run recorded', async (t) => {
  const folder = scratch(t);
  fs.writeFileSync(path.join(folder, 'run-log.jsonl'), [
    { step: 'front-desk', note: 'x', detail: { tmux: 'haiku-trial-desk' } },
    { step: 'tunnel', note: 'x', detail: { productPid: 4242 } },
  ].map((e) => JSON.stringify(e)).join('\n') + '\n');
  const io = fakeIo({ sessions: ['haiku-trial-desk', 'other-session'] });
  const before = fs.readdirSync(folder).sort();
  const got = await restore({ folder, io });
  assert.deepEqual(io.timeline.filter((e) => e.kind === 'tmux.kill').map((e) => e.args[0]), ['haiku-trial-desk']);
  assert.deepEqual(io.timeline.filter((e) => e.kind === 'kill').map((e) => e.args[0]), [4242]);
  assert.deepEqual(got.stopped, ['haiku-trial-desk', 'pid 4242']);
  assert.deepEqual(fs.readdirSync(folder).sort(), before, 'nothing is deleted');
});

test('plan prints steps and calls nothing', async () => {
  const lines = [];
  let built = 0;
  const code = await main(['plan'], { print: (l) => lines.push(l), buildIo: async () => { built += 1; } });
  assert.equal(code, 0);
  assert.equal(built, 0);
  assert.match(lines[0], /^full: stage create-repo\*/);
  assert.match(lines.join('\n'), /smoke: .*setup-s0/);
});
