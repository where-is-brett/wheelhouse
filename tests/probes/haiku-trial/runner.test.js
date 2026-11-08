// tests/probes/haiku-trial/runner.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { STEPS, planRun, run, restore, waitFor, main, withoutChrome } from '../../../probes/haiku-trial/runner.js';
import { P5_SPARE } from '../../../probes/haiku-trial/requests.js';

const ENV = { WHEELHOUSE_HOME: process.env.WHEELHOUSE_HOME, HAIKU_TRIAL_GH_OWNER: 'trial-owner', HAIKU_TRIAL_CLAUDE: '/bin/claude', HAIKU_TRIAL_PREVIEW: 'none' };
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
      start: (x) => rec('tmux.start', x), type: (name, text) => rec('tmux.type', name, text), keys: (name, ...keys) => rec('tmux.keys', name, ...keys), capture: (name) => (over.capture ? over.capture(name) : ''),
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
      mainParseAmount: async () => over.read ?? { ok: true, amount: over.amount ?? 40 },
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
  const got = await run({ mode: 'smoke', io, folder: scratch(t), date: "2026-11-08", env: { WHEELHOUSE_HOME: ENV.WHEELHOUSE_HOME } });
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
  assert.deepEqual(got.done, ['w2-merge-wait', 'w2-audit', 'w3-type']);
  assert.ok(readLog(folder).some((e) => /planted bug already gone/.test(e.note)));
  assert.ok(io.timeline.some((e) => e.kind === 'spare'));
  assert.ok(io.timeline.some((e) => e.kind === 'gh' && e.args[0][0] === 'pr' && e.args[0][1] === 'merge' && e.args[0].includes('--admin')), 'the spare branch merges by gh, past the pending check');
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
  assert.deepEqual(io.timeline.filter((e) => e.kind === 'kill').map((e) => e.args[0]), [-4242], 'the whole process group, not only the leader');
  assert.deepEqual(got.stopped, ['haiku-trial-desk', 'pid 4242']);
  assert.deepEqual(fs.readdirSync(folder).sort(), before, 'nothing is deleted');
});

test('the smoke plan waits for P4 to merge and the full plan has no smoke-only step', () => {
  const smoke = ids('smoke');
  assert.ok(smoke.indexOf('s9-4') < smoke.indexOf('w4-smoke-merge') && smoke.indexOf('w4-smoke-merge') < smoke.indexOf('score'));
  assert.equal(ids('full').includes('w4-smoke-merge'), false);
  for (const wave of [2, 3, 4]) assert.ok(ids('full').includes(`w${wave}-audit`), `w${wave}-audit`);
  assert.ok(ids('full').indexOf('w2-merge-wait') < ids('full').indexOf('w2-audit'));
});

test('an audit step stops the run on a session that ran on another model, and passes otherwise', async (t) => {
  const bad = fakeIo({ host: { findTranscripts: () => [{ file: '/none.jsonl', role: 'feature', session: 's' }] } });
  const dir = scratch(t);
  fs.writeFileSync(path.join(dir, 'x.jsonl'), `${JSON.stringify({ type: 'assistant', message: { model: 'other-model', content: [] } })}\n`);
  bad.host.findTranscripts = () => [{ file: path.join(dir, 'x.jsonl'), role: 'feature', session: 's' }];
  const got = await run({ mode: 'full', io: bad, from: 'w3-audit', until: 'w3-audit', folder: scratch(t), date: '2026-11-08', env: ENV });
  assert.equal(got.stoppedAt, 'w3-audit');
  assert.match(got.why, /feature \(other-model\)/);
  const clean = await run({ mode: 'full', io: fakeIo(), from: 'w3-audit', until: 'w3-audit', folder: scratch(t), date: '2026-11-08', env: ENV });
  assert.deepEqual(clean.done, ['w3-audit']);
});

test('work-ready is read from a quick or bug work not shown first and from a signed approve-work, never from a work-ready event', async (t) => {
  const folder = scratch(t);
  const events = [
    { id: 'e1', at: '2026-11-08T09:01:00Z', kind: 'work', data: { id: 'quick-ci', lane: 'quick', visible: false } },
    { id: 'e2', at: '2026-11-08T09:02:00Z', kind: 'work', data: { id: 'import', lane: 'feature', visible: true } },
    { id: 'e3', at: '2026-11-08T09:03:00Z', kind: 'action', data: { action: 'approve-work', work: 'import' }, sig: { value: 'v' } },
    { id: 'e4', at: '2026-11-08T09:04:00Z', kind: 'action', data: { action: 'approve-work', work: 'unsigned' } },
    { id: 'e5', at: '2026-11-08T09:05:00Z', kind: 'work-ready', data: { work: 'not-a-record' } },
  ];
  const io = fakeIo({ gh: threeMerged, host: { events: async () => events } });
  await run({ mode: 'full', io, from: 'w2-merge-wait', until: 'w2-merge-wait', folder, date: '2026-11-08', env: ENV });
  const ready = readLog(folder).filter((e) => e.step === 'work-ready').map((e) => [e.work, e.at]);
  assert.deepEqual(ready, [['quick-ci', '2026-11-08T09:01:00Z'], ['import', '2026-11-08T09:03:00Z']]);
});

test('setup answers its cards through the setup session, ends on the engine wording and restarts once when it asks for a new session', async (t) => {
  const folder = scratch(t);
  let phase = 0;
  const cards = [{ id: 'c1', kind: 'card', data: { kind: 'setup', options: [{ label: 'Go ahead' }] } }];
  const answered = [];
  const io = fakeIo({
    capture: (name) => {
      if (name !== 'haiku-trial-setup' && name !== 'setup') return '';
      phase += 1;
      if (phase < 3) return 'Do you trust the files in this folder?';
      if (phase < 5) return 'Last safety checks need one new session on this folder.';
      if (phase < 7) return 'working';
      return 'Every step is done.';
    },
    host: { events: async () => cards, answerCards: async (x) => { answered.push(x.session); return 1; }, readConfig: async () => ({ routing: {} }) },
  });
  const got = await run({ mode: 'smoke', io, from: 'setup-s0', until: 'setup-s0', folder, date: '2026-11-08', env: ENV });
  assert.deepEqual(got.done, ['setup-s0'], got.why);
  assert.ok(answered.length > 0 && answered.every((x) => x === 'setup'), 'setup cards are answered in the setup session');
  assert.ok(io.timeline.some((e) => e.kind === 'tmux.keys' && e.args.includes('Enter')), 'the folder-trust prompt is answered');
  assert.equal(io.timeline.filter((e) => e.kind === 'tmux.start').length, 2, 'one restart');
  assert.deepEqual(io.timeline.filter((e) => e.kind === 'tmux.type').map((e) => e.args[1]), ['/wheelhouse:setup', 'carry on with setup']);
  assert.ok(readLog(folder).some((e) => e.step === 'health' && e.note === 'pass'));
});

test('setup that never finishes stops the run', async (t) => {
  const io = fakeIo({ capture: () => 'still working' });
  const got = await run({ mode: 'smoke', io, from: 'setup-s0', until: 'setup-s0', folder: scratch(t), date: '2026-11-08', env: ENV });
  assert.equal(got.stoppedAt, 'setup-s0');
  assert.match(got.why, /setup did not finish/);
});

test('the digest is due at the start of a minute', async (t) => {
  const folder = scratch(t);
  const io = fakeIo({ host: { setDigest: async () => ({ ok: true }) }, capture: () => 'Daily digest, 8 November' });
  io.clock.sleep = async (ms) => { io.timeline.push({ kind: 'sleep', args: [ms], at: 0 }); };
  await run({ mode: 'full', io, from: 'digest', until: 'digest', folder, date: '2026-11-08', env: ENV });
  const state = JSON.parse(fs.readFileSync(path.join(folder, 'state.json'), 'utf8'));
  assert.equal(new Date(state.digestAt).getUTCSeconds(), 0);
  assert.equal(new Date(state.digestAt).getUTCMilliseconds(), 0);
});

test('the score step installs what the builders added, and says when it cannot', async (t) => {
  const folder = scratch(t);
  const ok = fakeIo({ host: { installDeps: async () => ({ ok: true, command: 'npm ci' }) } });
  await run({ mode: 'full', io: ok, from: 'score', until: 'score', folder, date: '2026-11-08', env: ENV });
  assert.ok(readLog(folder).some((e) => e.step === 'score' && /dependencies: installed/.test(e.note)));
  const folder2 = scratch(t);
  const bad = fakeIo({ host: { installDeps: async () => ({ ok: false, why: 'npm ci failed: no lockfile' }) } });
  await run({ mode: 'full', io: bad, from: 'score', until: 'score', folder: folder2, date: '2026-11-08', env: ENV });
  const state = JSON.parse(fs.readFileSync(path.join(folder2, 'state.json'), 'utf8'));
  assert.match(state.score.why.join(' '), /not installed|no lockfile/);
});

test('decision 3 is raised in P4\'s saved environment and its number comes from the record', async (t) => {
  const folder = scratch(t);
  const worktree = scratch(t);
  fs.writeFileSync(path.join(folder, 'state.json'), JSON.stringify({ p4env: { env: { A: 'b' }, cwd: worktree } }));
  const raised = [];
  const io = fakeIo({ host: { nextDecisionNumber: async () => 3 } });
  io.faults.thirdDecision = (env) => { raised.push(env); return { code: 0, stdout: 'q-1' }; };
  const got = await run({ mode: 'full', io, from: 'raise-decision-3', until: 'raise-decision-3', folder, date: '2026-11-08', env: ENV });
  assert.deepEqual(got.done, ['raise-decision-3']);
  assert.equal(raised[0].cwd, worktree);
  assert.equal(JSON.parse(fs.readFileSync(path.join(folder, 'state.json'), 'utf8')).decisionN, 3);
  const lost = await run({ mode: 'full', io: fakeIo(), from: 'raise-decision-3', until: 'raise-decision-3', folder: scratch(t), date: '2026-11-08', env: ENV });
  assert.equal(lost.stoppedAt, 'raise-decision-3');
});

test('the review card goes through the front desk as a decision and takes the letter from the typed answer', async (t) => {
  const folder = scratch(t);
  const worktree = scratch(t);
  fs.writeFileSync(path.join(folder, 'state.json'), JSON.stringify({ decisionN: 3, p4env: { env: {}, cwd: worktree }, score: { total: 90, pass: true }, rows: [] }));
  const cards = [];
  const io = fakeIo({ host: { events: async () => [{ id: 'a1', at: new Date(T0 + 60000).toISOString(), kind: 'decision-answer', data: { n: 4, label: 'b' } }] } });
  io.faults.reviewDecision = (x) => { cards.push(x.card); return { code: 0, stdout: '' }; };
  const got = await run({ mode: 'full', io, from: 'review-card', until: 'review-card', folder, date: '2026-11-08', env: ENV });
  assert.deepEqual(got.done, ['review-card'], got.why);
  assert.equal(cards[0].options.length, 3);
  assert.equal(io.timeline.some((e) => e.kind === 'ask'), false, 'nothing is asked in the terminal');
  assert.ok(readLog(folder).some((e) => /the director answered B/.test(e.note ?? '')));
});

test('the terminal fallback asks again until the answer is A, B or C', async (t) => {
  const folder = scratch(t);
  fs.writeFileSync(path.join(folder, 'state.json'), JSON.stringify({ decisionN: 3, score: { total: 90, pass: true }, rows: [] }));
  const answers = ['maybe', '', 'c'];
  const io = fakeIo();
  io.ask = async (text) => { io.timeline.push({ kind: 'ask', args: [text], at: 0 }); return answers.shift(); };
  const got = await run({ mode: 'full', io, from: 'review-card', until: 'review-card', folder, date: '2026-11-08', env: ENV });
  assert.deepEqual(got.done, ['review-card']);
  assert.equal(io.timeline.filter((e) => e.kind === 'ask').length, 3);
  assert.ok(readLog(folder).some((e) => /the director answered C/.test(e.note ?? '')));
});

test('the front desk reply drops terminal furniture', () => {
  const text = ['Here is the answer to your question about the month.', '✻ Thinking… (12s · esc to interrupt)', '╭──────╮', '> ', '⏵⏵ bypass permissions on'].join('\n');
  assert.equal(withoutChrome(text), 'Here is the answer to your question about the month.');
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

test('a gh failure on repo create stops the run and logs no success', async (t) => {
  const folder = scratch(t);
  const io = fakeIo({ gh: (args) => { if (args[0] === 'repo') throw new Error('name taken'); return null; } });
  const got = await run({ mode: 'smoke', io, from: 'create-repo', until: 'create-repo', folder, date: '2026-11-08', env: ENV });
  assert.equal(got.stoppedAt, 'create-repo');
  assert.match(got.why, /name taken/);
  assert.equal(readLog(folder).some((e) => /^created /.test(e.note ?? '')), false);
});

test('a failed pr merge stops the run and P5 is not switched to the spare bug', async (t) => {
  const folder = scratch(t);
  const io = fakeIo({ amount: -40, gh: (args) => (args[0] === 'pr' && args[1] === 'merge' ? { ok: false, why: 'checks failing' } : threeMerged(args)) });
  const got = await run({ mode: 'full', io, from: 'w2-merge-wait', until: 'w3-type', folder, date: '2026-11-08', env: ENV });
  assert.equal(got.stoppedAt, 'w2-merge-wait');
  assert.match(got.why, /checks failing/);
  assert.equal(io.timeline.some((e) => e.kind === 'tmux.type' && e.args[1].includes(P5_SPARE)), false);
  assert.notEqual(JSON.parse(fs.readFileSync(path.join(folder, 'state.json'), 'utf8')).p5, 'spare');
});

test('an unreadable main is logged and is not taken for a planted bug', async (t) => {
  const folder = scratch(t);
  const io = fakeIo({ read: { ok: false, why: 'git fetch failed' }, gh: threeMerged });
  const got = await run({ mode: 'full', io, from: 'w2-merge-wait', until: 'w2-merge-wait', folder, date: '2026-11-08', env: ENV });
  assert.deepEqual(got.done, ['w2-merge-wait']);
  assert.ok(readLog(folder).some((e) => /could not read main's parseAmount: git fetch failed/.test(e.note)));
  assert.equal(io.timeline.some((e) => e.kind === 'spare'), false);
});

test('F3b fires during the typed replies, not later', async (t) => {
  const folder = scratch(t);
  fs.writeFileSync(path.join(folder, 'state.json'), JSON.stringify({ f3bArmed: true, pieces: { P4: { change: 'p4' } } }));
  const io = fakeIo({ gh: () => [{ number: 9, merged_at: '2026-11-08T10:00:00Z', head: { ref: 'feature/p4' } }] });
  let killed = 0;
  io.faults.f3bKillForeman = async () => { killed += 1; io.timeline.push({ kind: 'f3b', args: [], at: io.clock.now() }); return { pid: 2 }; };
  const got = await run({ mode: 'full', io, from: 's9-4', until: 's9-4', folder, date: '2026-11-08', env: ENV });
  assert.deepEqual(got.done, ['s9-4']);
  assert.equal(killed, 1);
  const typed = io.timeline.find((e) => e.kind === 'tmux.type');
  assert.ok(io.timeline.find((e) => e.kind === 'f3b').at - typed.at <= 15000, 'within the first look after the reply');
});
