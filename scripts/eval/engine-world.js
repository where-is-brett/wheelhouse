// scripts/eval/engine-world.js
// The world an engine scenario plays in (Archon design, section 18): a home of its own in a temporary folder, one
// project registered on the engine with its record open and this computer's key enrolled, the real helper started on
// it with the engine the run names, and nothing reaching a host tool. A scenario seeds records, ticks the helper's
// dispatcher and card router, signs the director's answers as their click does, and reads what was written. A scenario's
// `place` (places.js) gives the project real git: a stand-in host with no Actions, or a folder with no host; a check there
// is stood in, since a real one needs the Mac's sandbox. The counted evaluation's real Archon has its own world
// (archon-world.js).
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startHelper } from '../host/helper.js';
import { run as realRun } from '../lib/run.js';
import { engineDir, helperAddress, stateDir } from '../lib/paths.js';
import { writeProject } from '../lib/projects.js';
import { setStop, liftStop } from '../lib/stop.js';
import { openProjectRecord } from '../state/record.js';
import { dataHash, eventPath, listEvents, makeEvent } from '../state/events.js';
import { makeSigningKey, enrol, ownKey } from '../state/signing.js';
import { buildViews } from '../state/views.js';
import { fakeEngine } from '../engine/fake.js';
import { buildPack } from '../engine/pack-build.js';
import { engineDirOf } from '../engine/routes.js';
import { withTicket } from '../engine/ticket.js';
import { commandDigest } from '../checks/record.js';
import { helperClient } from '../host/helper-client.js';
import { homeDir } from '../host/local/home.js';
import { EVAL_LINE, OUT_OF_ORDER, PLACES, TEST_COMMAND, keepHere, must, noActionsHost, placeAdapter, placeFiles, placeVerbs, writeFiles } from './places.js';
import { standInTools } from './stand-in-tools.js';

export const ENGINES = Object.freeze(['fake']);
export const PROJECT = 'o__p';

// The tools an engine scenario may run: git and Node.js. Any other (an agent, the code host's tool, a network fetch,
// the system's) is refused and kept, so the scenario can say so.
const LOCAL_TOOLS = Object.freeze(['git', 'node']);
function noHostTools(log) {
  return (file, args = [], options) => {
    const name = String(file).split(/[\\/]/).pop().replace(/\.(exe|cmd|bat|com)$/i, '').toLowerCase();
    if (LOCAL_TOOLS.includes(name)) return realRun(file, args, options);
    log.push([name, ...args].join(' '));
    return Promise.resolve({ code: 1, stdout: '', stderr: `${name} is not run in an engine scenario` });
  };
}

// A place's project in the fake world: its folder and history, and its record, a host's or the home's. { host }.
async function makePlace({ place, root, folder, files }) {
  writeFiles(folder, { ...placeFiles(files), '.gitignore': '.wheelhouse/\n' });
  await must(['init', '-q', '-b', 'main'], folder);
  await must(['add', '-A'], folder);
  await must(['-c', 'user.name=Evaluation', '-c', 'user.email=eval@example.invalid', 'commit', '-q', '-m', 'Start'], folder);
  if (place === 'git-alone') {
    writeProject(PROJECT, { folder, remoteUrl: null, host: 'local', repo: `local/${PROJECT}`, connection: { host: 'local', mode: 'none', project: `local/${PROJECT}` } });
    return { host: {} };
  }
  const bare = path.join(root, 'o', 'p.git');
  fs.mkdirSync(bare, { recursive: true });
  await must(['init', '-q', '--bare', '-b', 'main'], bare);
  await must(['remote', 'add', 'origin', bare], folder);
  await must(['push', '-q', 'origin', 'main'], folder);
  writeProject(PROJECT, { folder, remoteUrl: bare, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' } });
  return { host: noActionsHost(bare), bare };
}

// The check in a place, stood in: `says({ page, main })` gives its word for README.md as the commit has it. By default the
// tests' own rule. `from()` is the repository that holds the commit.
const standInCheck = ({ says, from }) => async ({ commit, main }) => {
  const page = await must(['show', `${commit}:README.md`], from());
  return { commit, command: commandDigest(TEST_COMMAND), result: says({ page, main: main === true }), minutes: 0, tail: 'The page test failed.', ...(main ? { clean: true } : {}) };
};
const inOrder = ({ page }) => (page.includes(OUT_OF_ORDER) ? 'failed' : 'passed');
const REVIEW_CLEAN = JSON.stringify({ verdict: 'CLEAN', findings: [], summary: 'Read it.', blocked: false, assumptions: [] });

// openWorld({ engine, recordings, now, host, spawn, adapt, seed, place, files, says }) -> the world, on the project's default
// settings. `now` is a function the scenario may move on; `host` the code host's stand-in the helper reads (its adapter),
// which the scenario may change. `place` (places.js) gives the project real git, with `files` added and the check's word
// from `says`. For tests: `spawn` stands in for the helper's processes (a wake by default), `adapt(engine)` adds to the
// fake engine, and `seed(world)` writes records before the helper starts.
export async function openWorld({ engine: kind = 'fake', recordings = {}, now = () => new Date(), host = {}, spawn = () => fakeChild(), adapt = (e) => e, seed = () => {}, place = null, files = {}, says = inOrder } = {}) {
  if (!ENGINES.includes(kind)) throw new Error(`An engine scenario runs on ${ENGINES.join(', ')}, not ${kind}`);
  if (place !== null && !PLACES.includes(place)) throw new Error(`A scenario's place is one of ${PLACES.join(', ')}, not ${place}`);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-ew-'));
  const home = path.join(root, 'h');
  const folder = path.join(root, 'project');
  const artefacts = path.join(root, 'art');
  for (const dir of [home, folder, artefacts]) fs.mkdirSync(dir, { recursive: true });
  const frozen = path.join(root, 'frozen');
  // A project whose tests run with `npm test`, so its work can have a done check.
  if (!place) fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name: 'p', scripts: { test: 'node --test' } }));
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  const hostCalls = [];
  const engine = adapt(fakeEngine({ recordings, artefacts, now: () => now().toISOString(), ...(place ? { source: frozen } : {}) }));
  let helper = null;
  let client = null;
  const forwarded = [];
  const records = (kind) => listEvents(stateDir(PROJECT), { report: () => {} }).filter((e) => kind === undefined || e.kind === kind);
  const own = () => { const k = ownKey(); return k ? [{ computer: k.computer, publicKey: k.publicKey }] : []; };

  const world = {
    engine, home, folder, artefacts, hostCalls, forwarded, host,
    // A record in the project's history, as the First Mate or the director's click writes it.
    put(kind, data, { unsigned = false } = {}) {
      const event = makeEvent({ kind, data, now });
      const { sig, ...bare } = event;
      const file = path.join(stateDir(PROJECT), eventPath(event));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify(unsigned ? bare : event, null, 2)}\n`);
      return event;
    },
    records,
    views: () => buildViews(records(), own(), { now }),
    // The director's click on a question card's option, signed with this computer's key.
    answer(question, label) {
      return world.put('action', { action: 'answer', question: 'the card as shown', questionId: question.id, questionHash: dataHash(question), label });
    },
    tick: () => helper.engine.tick(),
    stop: () => setStop({ by: 'prompt', now }),
    lift: () => liftStop(),
    starts: () => engine.calls.filter((c) => c.call === 'start'),
    acts: () => engine.calls.filter((c) => c.call === 'act'),
    // The run's steps, in a place: its change committed in a worktree, its pull request opened through the helper, its
    // reviews read CLEAN and signed, and, with `ready`, the change marked ready: { runId, pr, head }. `line` is what it adds
    // to README.md.
    async lane(work, { line = EVAL_LINE, title = 'The sale banner', ready = true } = {}) {
      world.put('work', { id: work, title, lane: 'quick', visible: false, dependsOn: [] });
      await world.tick();
      const runId = await until(() => engine.liveRunOf({ work })?.runId);
      if (!runId) throw new Error(`no run started for ${work}`);
      const branch = `wh/${work}`;
      const worktree = path.join(folder, '.wheelhouse', 'worktrees', branch.replaceAll('/', '-'));
      if (!fs.existsSync(worktree)) await must(['worktree', 'add', '-q', '-b', branch, worktree], folder);
      fs.appendFileSync(path.join(worktree, 'README.md'), `\n${line}\n`);
      await must(['-c', 'user.name=Run', '-c', 'user.email=run@example.invalid', 'commit', '-q', '-am', 'A change'], worktree);
      const head = await must(['rev-parse', 'HEAD'], worktree);
      const ticketed = withTicket(client, ['--artefacts', engine.artefactsOf(runId)]);
      for (const step of ['review-standards', 'review-spec']) engine.setOutput(runId, step, REVIEW_CLEAN);
      engine.setOutput(runId, 'lenses', JSON.stringify({ security: false, design: false, head, clean: true }));
      const opened = await ticketed.engine.openPr({ runId, cwd: worktree, title, body: 'A change.' });
      if (opened?.ok !== true) throw new Error(`the pull request wasn't opened: ${opened?.refused}`);
      engine.setOutput(runId, 'open-pr', JSON.stringify({ branch: opened.branch, pr: opened.pr, head }));
      for (const step of ['review-standards', 'review-spec']) {
        const signed = await ticketed.engine.review({ runId, step });
        if (signed?.ok !== true) throw new Error(`${step} wasn't signed: ${signed?.refused}`);
      }
      if (ready) {
        const marked = await ticketed.engine.ready({ runId });
        if (marked?.ok !== true) throw new Error(`the change wasn't marked ready: ${marked?.refused}`);
      }
      return { runId, pr: opened.pr, head };
    },
    // The mark-ready step of a run that `lane` took as far as its reviews: the helper's answer.
    markReady: (work) => {
      const runId = engine.liveRunOf({ work })?.runId;
      return withTicket(client, ['--artefacts', engine.artefactsOf(runId)]).engine.ready({ runId });
    },
    // `gh` as a run's step calls it, through the broker: { code, stdout, stderr }.
    broker: (argv, { cwd = folder } = {}) => client.broker.gh({ argv, cwd }),
    // A run's areas, as the tool guard asks the helper for them.
    areas: (args) => client.engine.areas(args),
    // The work orders the helper kept for the runs it started, oldest run first: what a run's steps are served.
    orders() {
      const dir = path.join(engineDirOf(stateDir(PROJECT)), 'orders');
      const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith('.json')) : [];
      return names.map((n) => ({ runId: n.slice(0, -5), ...JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')) }))
        .sort((a, b) => a.runId.localeCompare(b.runId, 'en', { numeric: true }));
    },
    async close() {
      try { await helper?.close(); } finally {
        if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  };

  try {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: now().toISOString() });
    let bare = null;
    if (place) {
      const made = await makePlace({ place, root, folder, files });
      bare = made.bare ?? null;
      world.host = made.host;
    } else {
      writeProject(PROJECT, { folder, remoteUrl: 'https://example.invalid/o/p.git', host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' } });
    }
    await openProjectRecord(PROJECT);
    if (place === 'git-alone') await keepHere({ project: PROJECT, folder });
    await seed(world);
    if (place) {
      placeVerbs(world, { project: PROJECT });
      buildPack({ out: path.join(engineDir(), 'pack') });
      buildPack({ out: path.join(frozen, 'project') });
      // Asked of the check each time: a project's commits are in its host or its home.
      const from = () => bare ?? homeDir(PROJECT);
      const tools = standInTools({ forwarded, refused: hostCalls });
      helper = await startHelper({
        run: tools, address: helperAddress({ home }), adapterFor: placeAdapter({ world, run: tools }), envFor: async () => ({}), now,
        spawn, engineFor: () => engine, dispatchMs: 60 * 60 * 1000, stopPollMs: 50, check: standInCheck({ says, from }),
      });
      client = helperClient({ address: helper.address });
      if (place === 'no-ci') {
        const taken = await client.lock.take({ project: PROJECT });
        if (taken?.ok !== true) throw new Error(`The evaluation world could not take its project's lock: ${taken?.refused}`);
      }
    } else {
      helper = await startHelper({
        run: noHostTools(hostCalls), address: helperAddress({ home }), adapterFor: async () => host, envFor: async () => ({}), now,
        spawn, engineFor: () => engine, dispatchMs: 60 * 60 * 1000, stopPollMs: 50,
        // The fake engine reads no fetch mirror, so the merge queue runs in the project's folder.
        refreshMirror: async () => ({ ok: true }),
        queueFolder: async () => ({ ok: true, folder }),
      });
    }
  } catch (error) {
    await world.close();
    throw error;
  }
  return world;
}

// The wake process: a stand-in that runs nothing.
function fakeChild() {
  const child = new EventEmitter();
  // No pid: All stop ends the processes the continuation host started, by pid, and a made-up one could be another
  // program's on this computer.
  child.pid = null;
  child.kill = () => { setImmediate(() => child.emit('exit', null, 'SIGTERM')); return true; };
  return child;
}

// Waits for `fn` to give something, a short while at most.
export async function until(fn, { ms = 8000, every = 25 } = {}) {
  const end = Date.now() + ms;
  for (;;) {
    const got = await fn();
    if (got) return got;
    if (Date.now() > end) return null;
    await new Promise((resolve) => setTimeout(resolve, every));
  }
}

// Plays one engine scenario in its world and judges it: { pass, why }. A scenario's `engine` is
// { recordings?, startAt?, host?(), place?, files?, says?, play(world, { now, at }) -> { pass, why } }; `at(iso)` moves the
// world's clock, `host()` gives the code host's stand-in for this play, and `place` puts its project there. On `archon`, a scenario with `engine.real(world, { until })`
// plays that on real Archon (archon-world.js); any other plays its recording on the fake engine, and either says which
// in `played`: 'real' or 'recorded'.
export async function runEngineScenario({ scenario, engine = 'fake' }) {
  if (engine === 'archon') {
    if (typeof scenario.engine.real === 'function') return { ...(await (await import('./archon-world.js')).runRealScenario({ scenario })), played: 'real' };
    return { ...(await runEngineScenario({ scenario })), played: 'recorded' };
  }
  // The world's clock starts at the scenario's time and runs on with the real one, so records keep their order;
  // `at` moves it.
  const clock = { base: Date.parse(scenario.engine.startAt ?? '2026-10-29T09:00:00.000Z'), from: Date.now() };
  const now = () => new Date(clock.base + (Date.now() - clock.from));
  // A scenario's `adapt(engine)` makes the fake engine the adapter it plays (another agent's run's, say), and its `seed(world)`
  // writes what the project holds before the helper starts.
  const world = await openWorld({
    engine, recordings: scenario.engine.recordings ?? {}, now, host: typeof scenario.engine.host === 'function' ? scenario.engine.host() : {},
    ...(typeof scenario.engine.adapt === 'function' ? { adapt: scenario.engine.adapt } : {}),
    ...(typeof scenario.engine.seed === 'function' ? { seed: scenario.engine.seed } : {}),
    ...(scenario.engine.place ? { place: scenario.engine.place } : {}),
    ...(scenario.engine.files ? { files: scenario.engine.files } : {}),
    ...(scenario.engine.says ? { says: scenario.engine.says } : {}),
  });
  try {
    const got = await scenario.engine.play(world, { now, at: (iso) => { clock.base = Date.parse(iso); clock.from = Date.now(); } });
    if (world.hostCalls.length > 0) return { pass: false, why: `a host tool was called: ${world.hostCalls.join('; ')}` };
    return got;
  } finally {
    await world.close();
  }
}
