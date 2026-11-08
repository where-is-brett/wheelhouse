// tests/probes/haiku-trial/host-contract.test.js
// The runner against the real host's record readers. The fakes in runner.test.js accept any `project`, which is how the first
// live smoke run stopped on setup: the runner handed Wheelhouse's record readers the project's folder where they want the
// project's name. Here the real entries read a real record in this test's own WHEELHOUSE_HOME, so a mix-up fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from '../../../probes/haiku-trial/runner.js';
import { buildRealIo } from '../../../probes/haiku-trial/host.js';
import { gatherContext } from '../../../probes/haiku-trial/signals.js';
import { stateDir, wheelhouseHome } from '../../../scripts/lib/paths.js';
import { reliabilityFile } from '../../../scripts/watcher/reliability.js';

const DATE = '2026-11-08';
const NAME = `trial-owner__haiku-trial-${DATE}`;
const T0 = Date.parse(`${DATE}T09:00:00Z`);

function scratch(t) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'haiku-contract-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// The trial's project record, in the Wheelhouse home this test process runs under.
function seedRecord(t, events) {
  const dir = path.join(stateDir(NAME), 'events');
  fs.mkdirSync(dir, { recursive: true });
  t.after(() => fs.rmSync(path.dirname(stateDir(NAME)), { recursive: true, force: true }));
  for (const e of events) fs.writeFileSync(path.join(dir, `${e.id}.json`), JSON.stringify(e));
}

function ioWith(real, { capture = () => '', over = {} } = {}) {
  let now = T0;
  const started = [];
  const raw = [];
  const answered = [];
  const io = {
    started, raw, answered,
    // tmux lists the sessions started and not killed, by their full names, as the real one does.
    tmux: {
      start: (x) => started.push(x), type: () => {}, keys: () => {}, capture,
      kill: (name) => { const at = started.findIndex((x) => x.name === name); if (at >= 0) started.splice(at, 1); },
      list: () => started.map((x) => `haiku-trial-${x.name}`),
    },
    gh: async () => null,
    clock: { now: () => now, sleep: async (ms) => { now += ms; } },
    signals: { checkAll: () => [], gatherContext },
    faults: {},
    score: { scoreAll: async () => ({ total: 0, parts: {} }) },
    results: { runFolder: () => '/unused', writeRaw: (x) => raw.push(x), writeSummary: () => {} },
    ask: async () => 'go',
    log: () => {},
    kill: () => {},
    host: {
      events: real.events,
      readConfig: real.readConfig,
      typedRepliesOn: real.typedRepliesOn,
      nextDecisionNumber: real.nextDecisionNumber,
      findTranscripts: real.findTranscripts,
      answerCards: async ({ events }) => { answered.push(...events.map((e) => e.id)); return 0; },
      ...over,
    },
  };
  return io;
}

test('setup and the front desk read the trial project\'s record through the real host', async (t) => {
  seedRecord(t, [{ id: 'e1', at: `${DATE}T09:00:01Z`, kind: 'card', data: { kind: 'setup', options: [{ label: 'Go ahead' }] } }]);
  const folder = scratch(t);
  const io = ioWith(buildRealIo().host, { capture: (name) => (name === 'setup' ? 'Every step is done.' : '') });
  const env = { HAIKU_TRIAL_GH_OWNER: 'trial-owner', HAIKU_TRIAL_CLAUDE: '/bin/claude', WHEELHOUSE_HOME: wheelhouseHome() };
  const got = await run({ mode: 'smoke', io, from: 'setup-s0', until: 'front-desk', folder, date: DATE, env });
  assert.deepEqual(got.done, ['setup-s0', 'front-desk'], got.why);
  assert.ok(io.answered.includes('e1'), 'the card in the project\'s record reached the stand-in director');
});

test('the results and signals steps read the transcripts, the record and the incidents of the trial project', async (t) => {
  seedRecord(t, [{ id: 'e2', at: `${DATE}T09:00:02Z`, kind: 'note', data: {} }]);
  const folder = scratch(t);
  const configDir = path.join(folder, 'claude-config');
  const sessions = path.join(configDir, 'projects', 'trial');
  fs.mkdirSync(sessions, { recursive: true });
  fs.writeFileSync(path.join(sessions, 's1.jsonl'), `${JSON.stringify({ type: 'user', cwd: path.join(folder, 'project') })}\n`);
  const incident = { kind: 'lost', project: NAME, work: 'p1', at: `${DATE}T09:00:03Z` };
  fs.appendFileSync(reliabilityFile(), `${JSON.stringify(incident)}\n`);
  t.after(() => fs.rmSync(reliabilityFile(), { force: true }));

  const io = ioWith(buildRealIo({ ...process.env, HAIKU_TRIAL_CONFIG_DIR: configDir }).host);
  let context;
  io.signals.gatherContext = async (x) => { context = await gatherContext(x); return context; };
  const env = { HAIKU_TRIAL_GH_OWNER: 'trial-owner', HAIKU_TRIAL_CLAUDE: '/bin/claude', HAIKU_TRIAL_CONFIG_DIR: configDir, WHEELHOUSE_HOME: wheelhouseHome() };
  const got = await run({ mode: 'smoke', io, from: 'signals', until: 'results', folder, date: DATE, env });
  assert.deepEqual(got.done, ['signals', 'results'], got.why);
  assert.deepEqual(context.events.map((e) => e.id), ['e2']);
  assert.deepEqual(context.incidents.map((i) => i.work), ['p1'], 'incidents are kept by the project\'s name');
  assert.deepEqual(io.raw[0].transcripts.map((x) => x.session), ['s1'], 'transcripts come from HAIKU_TRIAL_CONFIG_DIR');
  assert.deepEqual(io.raw[0].events.map((e) => e.id), ['e2']);
});

test('the real host refuses a folder where it wants the project\'s name, and a name where it wants a folder', async () => {
  const { host } = buildRealIo();
  const folder = path.join(os.tmpdir(), 'trial', 'project');
  await assert.rejects(host.events({ project: folder }), /project's name/);
  await assert.rejects(host.typedRepliesOn({ project: folder }), /project's name/);
  await assert.rejects(host.nextDecisionNumber({ project: folder }), /project's name/);
  await assert.rejects(host.readConfig({ dir: NAME }), /folder/);
  assert.throws(() => host.findTranscripts({ project: folder, dir: folder }), /project's name/);
  assert.throws(() => host.findTranscripts({ project: NAME, dir: NAME }), /folder/);
});

// --- the trial's own Wheelhouse home ---

import { homeProblem, trialHome, restore, main } from '../../../probes/haiku-trial/runner.js';

const own = process.env.WHEELHOUSE_HOME;

test('the trial refuses the real Wheelhouse home, one inside it, one that holds it, and a missing or split home', () => {
  const real = path.join(os.homedir(), '.wheelhouse');
  for (const bad of [real, path.join(real, 'trial'), os.homedir()]) {
    assert.match(homeProblem({ WHEELHOUSE_HOME: bad }, { WHEELHOUSE_HOME: bad }), /real Wheelhouse home/, bad);
  }
  assert.match(homeProblem({}, { WHEELHOUSE_HOME: own }), /not set/);
  assert.match(homeProblem({ WHEELHOUSE_HOME: own }, { WHEELHOUSE_HOME: `${own}-other` }), /differs/);
  assert.equal(homeProblem({ WHEELHOUSE_HOME: own }, { WHEELHOUSE_HOME: own }), null);
});

test('the trial home is under the run folder unless HAIKU_TRIAL_WHEELHOUSE_HOME names one', () => {
  assert.equal(trialHome({ folder: '/x/run', env: {} }), '/x/run/wheelhouse-home');
  assert.equal(trialHome({ folder: '/x/run', env: { HAIKU_TRIAL_WHEELHOUSE_HOME: '/y/home' } }), '/y/home');
});

test('main sets WHEELHOUSE_HOME to the trial home for restore and refuses the real one', async (t) => {
  const folder = scratch(t);
  const before = process.env.WHEELHOUSE_HOME;
  t.after(() => { process.env.WHEELHOUSE_HOME = before; });
  const stopped = [];
  const io = { results: { runFolder: () => folder }, clock: { now: () => T0 }, tmux: { list: () => [] }, host: { stopWheelhouse: async () => { stopped.push(process.env.WHEELHOUSE_HOME); return ['helper pid 9']; } }, kill: () => {} };
  const lines = [];
  const code = await main(['restore', '--out', folder], { print: (l) => lines.push(l), buildIo: async () => io, env: {} });
  assert.equal(code, 0);
  assert.deepEqual(stopped, [path.join(folder, 'wheelhouse-home')]);
  assert.deepEqual(JSON.parse(lines[0]).stopped, ['helper pid 9']);
  const refused = [];
  const bad = await main(['restore', '--out', folder], { print: (l) => refused.push(l), buildIo: async () => io, env: { HAIKU_TRIAL_WHEELHOUSE_HOME: path.join(os.homedir(), '.wheelhouse') } });
  assert.equal(bad, 1);
  assert.match(refused[0], /real Wheelhouse home/);
  assert.equal(stopped.length, 1, 'nothing was stopped under the real home');
});

test('every desk session starts with the trial home and config folder', async (t) => {
  const folder = scratch(t);
  const starts = [];
  const io = ioWith(buildRealIo().host, { capture: (n) => (n === 'setup' ? 'Every step is done.' : '') });
  const start = io.tmux.start;
  io.tmux.start = (x) => { starts.push(x); start(x); };
  const env = { HAIKU_TRIAL_GH_OWNER: 'trial-owner', HAIKU_TRIAL_CLAUDE: '/bin/claude', HAIKU_TRIAL_CONFIG_DIR: '/cfg', WHEELHOUSE_HOME: wheelhouseHome() };
  await run({ mode: 'smoke', io, from: 'setup-s0', until: 'front-desk', folder, date: DATE, env });
  assert.equal(starts.length, 2);
  for (const s of starts) assert.deepEqual([s.env.WHEELHOUSE_HOME, s.env.CLAUDE_CONFIG_DIR], [wheelhouseHome(), '/cfg']);
});

test('a tunnel preview stops before anything is created when cloudflared is missing', async (t) => {
  const io = ioWith(buildRealIo().host, { over: { hasCommand: async (n) => n !== 'cloudflared' } });
  const env = { HAIKU_TRIAL_GH_OWNER: 'trial-owner', HAIKU_TRIAL_PREVIEW: 'tunnel', WHEELHOUSE_HOME: wheelhouseHome() };
  const got = await run({ mode: 'full', io, folder: scratch(t), date: DATE, env });
  assert.equal(got.stoppedAt, 'create-preview');
  assert.deepEqual(got.done, []);
  assert.match(got.why, /cloudflared/);
  assert.equal(io.started.length, 0);
});
