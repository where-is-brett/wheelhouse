// tests/probes/haiku-trial/runner.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { STEPS, planRun, run, restore, waitFor, main, withoutChrome, runLabel } from '../../../probes/haiku-trial/runner.js';
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
  // The sessions started and not killed are the ones tmux lists, by their full names; `over.sessions` overrides the list.
  const full = (name) => (String(name).startsWith('haiku-trial-') ? String(name) : `haiku-trial-${name}`);
  const live = new Set();
  const io = {
    timeline,
    live,
    tmux: {
      start: (x) => { live.add(full(x.name)); rec('tmux.start', x); },
      type: (name, text) => rec('tmux.type', name, text),
      keys: (name, ...keys) => { rec('tmux.keys', name, ...keys); over.keys?.(name, ...keys); },
      capture: (name) => (over.capture ? over.capture(name) : ''),
      kill: (name) => { live.delete(full(name)); rec('tmux.kill', name); },
      list: () => over.sessions ?? [...live],
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
      exec: async (argv) => { rec('exec', argv); return over.exec ? over.exec(argv) : { status: 0 }; },
      installedProblem: async (x) => { rec('installed', x); return over.installed ?? null; },
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

// Claude Code's folder-trust prompt, its cursor on No (the first choice) or on Yes.
const trustMenu = (onYes) => [
  'Quick safety check: Is this a project you created or one you trust?',
  onYes ? '   No, exit' : ' ❯ No, exit',
  onYes ? ' ❯ Yes, I trust this folder' : '   Yes, I trust this folder',
  'Enter to confirm · Esc to cancel',
].join('\n');

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
  let trusted = false;
  let onYes = false;
  const cards = [{ id: 'c1', kind: 'card', data: { kind: 'setup', options: [{ label: 'Go ahead' }] } }];
  const answered = [];
  const io = fakeIo({
    keys: (name, key) => { if (key === 'Down') onYes = true; if (key === 'Enter' && onYes) trusted = true; },
    capture: (name) => {
      if (name !== 'haiku-trial-setup' && name !== 'setup') return '';
      if (!trusted) return trustMenu(onYes);
      if (phase < 3) return 'Last safety checks need one new session on this folder.';
      if (phase < 5) return 'working';
      return 'Every step is done.';
    },
    // One look at the project a tick, so the pane moves on once each tick.
    host: { events: async () => { phase += 1; return cards; }, answerCards: async (x) => { answered.push(x.session); return 1; }, readConfig: async () => ({ routing: {} }) },
  });
  const got = await run({ mode: 'smoke', io, from: 'setup-s0', until: 'setup-s0', folder, date: '2026-11-08', env: ENV });
  assert.deepEqual(got.done, ['setup-s0'], got.why);
  assert.ok(answered.length > 0 && answered.every((x) => x === 'setup'), 'setup cards are answered in the setup session');
  assert.ok(io.timeline.some((e) => e.kind === 'tmux.keys' && e.args.includes('Enter')), 'the folder-trust prompt is answered');
  assert.equal(io.timeline.filter((e) => e.kind === 'tmux.start').length, 2, 'one restart');
  assert.deepEqual(io.timeline.filter((e) => e.kind === 'tmux.type').map((e) => e.args[1]), ['/wheelhouse:setup', 'carry on with setup']);
  assert.ok(readLog(folder).some((e) => e.step === 'health' && e.note === 'pass'));
});

// A picker as Claude Code draws it in the pane, its cursor on option `at` (0-based).
const picker = (question, labels, at) => [
  ` ☐ Setup`,
  `│ ${question}`,
  ...labels.map((l, i) => `${i === at ? '❯' : ' '} ${i + 1}. ${l}`),
  'Enter to select · ↑/↓ to navigate · Esc to cancel',
].join('\n');

test("setup's pickers in the pane are answered with the recommended option, moving the cursor to it first", async (t) => {
  const folder = scratch(t);
  let at = 0;
  const picks = [];
  const labels = ['Show me', 'Go ahead (Recommended)', 'Not now', 'Type something.'];
  const io = fakeIo({
    keys: (name, key) => {
      if (key === 'Down') at += 1;
      if (key === 'Up') at -= 1;
      if (key === 'Enter') picks.push(labels[at]);
    },
    capture: () => (picks.length === 0 ? picker('Setup step 2, Tools', labels, at) : 'Every step is done.'),
    host: { readConfig: async () => ({ routing: {} }) },
  });
  const got = await run({ mode: 'smoke', io, from: 'setup-s0', until: 'setup-s0', folder, date: '2026-11-08', env: ENV });
  assert.deepEqual(got.done, ['setup-s0'], got.why);
  assert.deepEqual(picks, ['Go ahead (Recommended)']);
  assert.deepEqual(io.timeline.filter((e) => e.kind === 'tmux.keys').map((e) => e.args[1]), ['Down', 'Enter']);
  assert.ok(readLog(folder).some((e) => e.step === 'setup' && e.note === 'answered the picker "Setup step 2, Tools": Go ahead (Recommended)'));
});

test('a picker with no recommended option is answered with its first option', async (t) => {
  let picked = null;
  const io = fakeIo({
    keys: (name, key) => { if (key === 'Enter') picked = 'Test data only'; },
    capture: () => (picked ? 'Every step is done.' : picker('Live data', ['Test data only', 'Live data'], 0)),
    host: { readConfig: async () => ({ routing: {} }) },
  });
  const got = await run({ mode: 'smoke', io, from: 'setup-s0', until: 'setup-s0', folder: scratch(t), date: '2026-11-08', env: ENV });
  assert.deepEqual(got.done, ['setup-s0'], got.why);
  assert.equal(picked, 'Test data only');
  assert.deepEqual(io.timeline.filter((e) => e.kind === 'tmux.keys').map((e) => e.args[1]), ['Enter']);
});

test('a picker whose cursor never reaches the recommended option stops the run without pressing Enter', async (t) => {
  const io = fakeIo({ capture: () => picker('Setup', ['Not now', 'Go ahead (Recommended)'], 0) });
  const got = await run({ mode: 'smoke', io, from: 'setup-s0', until: 'setup-s0', folder: scratch(t), date: '2026-11-08', env: ENV });
  assert.equal(got.stoppedAt, 'setup-s0');
  assert.match(got.why, /never highlighted its recommended option/);
  assert.equal(io.timeline.some((e) => e.kind === 'tmux.keys' && e.args.includes('Enter')), false);
});

test('the folder-trust prompt is answered Yes: the cursor is moved off "No, exit" before Enter', async (t) => {
  let onYes = false;
  let trusted = false;
  const io = fakeIo({
    keys: (name, key) => { if (key === 'Down') onYes = true; if (key === 'Enter' && onYes) trusted = true; },
    capture: () => (trusted ? 'Every step is done.' : trustMenu(onYes)),
    host: { readConfig: async () => ({ routing: {} }) },
  });
  const got = await run({ mode: 'smoke', io, from: 'setup-s0', until: 'setup-s0', folder: scratch(t), date: '2026-11-08', env: ENV });
  assert.deepEqual(got.done, ['setup-s0'], got.why);
  const keys = io.timeline.filter((e) => e.kind === 'tmux.keys').map((e) => e.args[1]);
  assert.deepEqual(keys, ['Down', 'Enter'], 'Down to Yes, then Enter; never Enter on No');
});

test('a trust prompt that never highlights Yes stops the run without pressing Enter', async (t) => {
  const io = fakeIo({ capture: () => trustMenu(false) });
  const got = await run({ mode: 'smoke', io, from: 'setup-s0', until: 'setup-s0', folder: scratch(t), date: '2026-11-08', env: ENV });
  assert.equal(got.stoppedAt, 'setup-s0');
  assert.match(got.why, /never highlighted "Yes, I trust this folder"/);
  assert.equal(io.timeline.some((e) => e.kind === 'tmux.keys' && e.args.includes('Enter')), false);
});

test('a session that ends by itself stops the run at once instead of waiting it out', async (t) => {
  let looks = 0;
  const io = fakeIo({
    capture: () => {
      looks += 1;
      // The session is there for its start, then gone, as when Claude Code exits.
      if (looks > 2) io.live.clear();
      return 'working';
    },
  });
  const got = await run({ mode: 'smoke', io, from: 'setup-s0', until: 'setup-s0', folder: scratch(t), date: '2026-11-08', env: ENV });
  assert.equal(got.stoppedAt, 'setup-s0');
  assert.match(got.why, /the setup session ended by itself \(tmux haiku-trial-setup is gone\)/);
  assert.ok(io.clock.now() - T0 < 5 * 60 * 1000, 'stopped within minutes, not after the 45-minute wait');
});

test('install takes out an earlier copy first, then checks the installed copy is the staged commit', async (t) => {
  const folder = scratch(t);
  fs.writeFileSync(path.join(folder, 'state.json'), JSON.stringify({ stage: { pluginDir: '/p', marketplaceDir: '/p', sha: 'feed01' } }));
  const env = { ...ENV, HAIKU_TRIAL_CONFIG_DIR: '/trial-config' };
  const io = fakeIo({ exec: (argv) => ({ status: argv.includes('uninstall') ? 1 : 0 }) });
  const got = await run({ mode: 'smoke', io, from: 'install', until: 'install', folder, date: '2026-11-08', env });
  assert.deepEqual(got.done, ['install'], got.why);
  const lines = io.timeline.filter((e) => e.kind === 'exec').map((e) => e.args[0].slice(3, 6).join(' '));
  assert.deepEqual(lines, ['plugin uninstall wheelhouse@wheelhouse', 'plugin uninstall wheelhouse@wheelhouse-probe-wheelhouse-trial', 'plugin marketplace add', 'plugin install wheelhouse@wheelhouse']);
  assert.ok(io.timeline.every((e) => e.kind !== 'exec' || e.args[0][1] === 'CLAUDE_CONFIG_DIR=/trial-config'));
  assert.deepEqual(io.timeline.find((e) => e.kind === 'installed').args[0], { configDir: '/trial-config', pluginDir: '/p' });
  assert.ok(readLog(folder).some((e) => e.step === 'install' && /staged commit feed01, file for file/.test(e.note)));
});

test('install stops the run when the installed copy is not the staged one', async (t) => {
  const folder = scratch(t);
  fs.writeFileSync(path.join(folder, 'state.json'), JSON.stringify({ stage: { marketplaceDir: '/m', sha: 'feed01' } }));
  const io = fakeIo({ installed: '3 of 900 staged files differ in the installed copy, such as scripts/lib/paths.js' });
  const got = await run({ mode: 'smoke', io, from: 'install', until: 'install', folder, date: '2026-11-08', env: ENV });
  assert.equal(got.stoppedAt, 'install');
  assert.match(got.why, /not the staged copy: 3 of 900 staged files differ/);
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

test('a request waits for an open picker in the front desk to be answered before it is typed', async (t) => {
  const folder = scratch(t);
  let open = true;
  const order = [];
  const card = { id: 'c1', kind: 'card', data: { kind: 'approve-work', question: 'Approve this work as written?\nWork a: b', options: ['Approve'] } };
  const io = fakeIo({
    capture: () => (open ? ['│ Approve this work as written?', '│ Work a: b', '❯ 1. Approve', 'Enter to select · ↑/↓ to navigate'].join('\n') : 'idle'),
    host: {
      events: async () => [card],
      answerCards: async () => { if (open) { order.push('answered'); open = false; } return 1; },
    },
  });
  const wrapped = io.tmux.type;
  io.tmux.type = (name, text) => { order.push(`typed ${text.slice(0, 10)}`); return wrapped(name, text); };
  await run({ mode: 'smoke', io, from: 'w2-type', until: 'w2-type', folder, date: '2026-11-08', env: ENV });
  assert.equal(order[0], 'answered', order.join(', '));
  assert.ok(order[1].startsWith('typed '), order.join(', '));
});

test("F3 sees P1's first commit on its local branch, before anything is pushed", async (t) => {
  const folder = scratch(t);
  const io = fakeIo({
    gh: () => [],
    host: {
      git: async (args) => (args[0] === 'for-each-ref' ? 'main\nfeature/p1\n' : args[0] === 'rev-list' && args[2] === 'main..feature/p1' ? '6\n' : ''),
    },
  });
  const got = await run({ mode: 'smoke', io, from: 'f3-kill-p1', until: 'f3-kill-p1', folder, date: '2026-11-08', env: ENV });
  assert.deepEqual(got.done, ['f3-kill-p1'], got.why);
  assert.ok(io.timeline.some((e) => e.kind === 'f3'), 'the feature session is killed');
});

test('F3 with no feature session to kill is noted as not exercised and the run goes on', async (t) => {
  const folder = scratch(t);
  const io = fakeIo({});
  io.faults.f3KillFeature = async () => { throw new Error('No running feature session in /p names "p1"'); };
  io.gh = async (args) => (String(args[1]).includes('branches') ? [{ name: 'wheelhouse/p1' }] : { ahead_by: 1 });
  const got = await run({ mode: 'smoke', io, from: 'f3-kill-p1', until: 'f3-kill-p1', folder, date: '2026-11-08', env: ENV });
  assert.deepEqual(got.done, ['f3-kill-p1'], got.why);
  assert.ok(readLog(folder).some((e) => /not exercised: No running feature session/.test(e.note)));
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

// --- the run label ---

test('a run label is a date with an optional short suffix, from --date or HAIKU_TRIAL_DATE', () => {
  for (const good of ['2026-11-08', '2026-11-08-b', '2026-11-08-b2', '2026-11-08-retry']) assert.equal(runLabel({ arg: good, env: {} }), good, good);
  assert.equal(runLabel({ arg: undefined, env: { HAIKU_TRIAL_DATE: '2026-11-09-b' } }), '2026-11-09-b', 'the environment is the fallback');
  assert.equal(runLabel({ arg: '2026-11-10', env: { HAIKU_TRIAL_DATE: '2026-11-09-b' } }), '2026-11-10', 'the flag beats the environment');
  assert.equal(runLabel({ arg: undefined, env: {} }), undefined, 'no label leaves the clock to name the run');
  assert.equal(runLabel({ arg: undefined, env: { HAIKU_TRIAL_DATE: '' } }), undefined);
  for (const bad of ['b', '2026-11-8', '2026-11-08-', '2026-11-08-B', '2026-11-08_b', '2026-11-08-b/../x', '2026-11-08-b c', '../2026-11-08', '2026-11-08-aaaaaaaaaaaaaaaaaaaaaaaaa', '']) {
    assert.throws(() => runLabel({ arg: bad, env: {} }), /YYYY-MM-DD/, JSON.stringify(bad));
  }
  assert.throws(() => runLabel({ arg: undefined, env: { HAIKU_TRIAL_DATE: 'tomorrow' } }), /HAIKU_TRIAL_DATE/);
});

const labelled = (t, over = {}) => {
  const root = scratch(t);
  const before = process.env.WHEELHOUSE_HOME;
  t.after(() => { process.env.WHEELHOUSE_HOME = before; });
  const asked = [];
  const io = fakeIo(over);
  io.results.runFolder = (d) => { asked.push(d); return path.join(root, `haiku-${d}`); };
  return { root, io, asked };
};

test('--date names the repository, the project and the default run folder, so a fresh run does not meet an old one', async (t) => {
  const { root, io, asked } = labelled(t);
  const code = await main(['smoke', '--from', 'create-repo', '--until', 'create-repo', '--date', '2026-11-08-b'], { print: () => {}, buildIo: async () => io, env: ENV });
  assert.equal(code, 0);
  assert.deepEqual(asked, ['2026-11-08-b'], 'the folder is the label\'s, not the clock\'s');
  const created = io.timeline.find((e) => e.kind === 'gh' && e.args[0][0] === 'repo');
  assert.equal(created.args[0][2], 'trial-owner/haiku-trial-2026-11-08-b');
  assert.ok(fs.existsSync(path.join(root, 'haiku-2026-11-08-b', 'run-log.jsonl')));
});

test('HAIKU_TRIAL_DATE does the same when there is no --date', async (t) => {
  const { io, asked } = labelled(t);
  await main(['smoke', '--from', 'create-repo', '--until', 'create-repo'], { print: () => {}, buildIo: async () => io, env: { ...ENV, HAIKU_TRIAL_DATE: '2026-11-09-b' } });
  assert.deepEqual(asked, ['2026-11-09-b']);
  assert.equal(io.timeline.find((e) => e.kind === 'gh' && e.args[0][0] === 'repo').args[0][2], 'trial-owner/haiku-trial-2026-11-09-b');
});

test('with no label the clock names the run, as before', async (t) => {
  const { io, asked } = labelled(t);
  await main(['smoke', '--from', 'create-repo', '--until', 'create-repo'], { print: () => {}, buildIo: async () => io, env: ENV });
  assert.deepEqual(asked, ['2026-11-08']);
  assert.equal(io.timeline.find((e) => e.kind === 'gh' && e.args[0][0] === 'repo').args[0][2], 'trial-owner/haiku-trial-2026-11-08');
});

test('restore --date finds that run\'s folder and stops what its log recorded', async (t) => {
  const { root, io, asked } = labelled(t, { sessions: ['haiku-trial-desk'] });
  const folder = path.join(root, 'haiku-2026-11-08-b');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'run-log.jsonl'), `${JSON.stringify({ step: 'front-desk', note: 'x', detail: { tmux: 'haiku-trial-desk' } })}\n`);
  const lines = [];
  const code = await main(['restore', '--date', '2026-11-08-b'], { print: (l) => lines.push(l), buildIo: async () => io, env: ENV });
  assert.equal(code, 0);
  assert.deepEqual(asked, ['2026-11-08-b']);
  assert.deepEqual(JSON.parse(lines[0]).stopped, ['haiku-trial-desk']);
});

test('a bad label is refused with the usage line before anything is built', async () => {
  let built = 0;
  for (const argv of [['full', '--date', 'tomorrow'], ['restore', '--date', '2026-11-08-B'], ['plan', '--date', 'x']]) {
    const lines = [];
    const code = await main(argv, { print: (l) => lines.push(l), buildIo: async () => { built += 1; }, env: {} });
    assert.equal(code, 2, argv.join(' '));
    assert.match(lines.join('\n'), /YYYY-MM-DD/);
    assert.match(lines.join('\n'), /--date <label>/, 'the usage line shows the flag');
  }
  assert.equal(built, 0);
});

test('the usage line and plan name the label, the repository and the folder', async () => {
  const lines = [];
  assert.equal(await main(['nonsense'], { print: (l) => lines.push(l), buildIo: async () => assert.fail('built') }), 2);
  assert.match(lines.join('\n'), /--date <label>/);
  const plan = [];
  assert.equal(await main(['plan', '--date', '2026-11-08-b'], { print: (l) => plan.push(l), buildIo: async () => assert.fail('built'), env: { HAIKU_TRIAL_GH_OWNER: 'trial-owner' } }), 0);
  const text = plan.join('\n');
  assert.match(text, /run 2026-11-08-b/);
  assert.match(text, /trial-owner\/haiku-trial-2026-11-08-b/);
  assert.match(text, /haiku-2026-11-08-b/);
});
