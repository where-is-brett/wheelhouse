// scripts/eval/engine-world.js
// The world an engine scenario plays in (Archon design, section 18): a home of its own in a temporary folder, one
// project registered on the engine with its record open and this computer's key enrolled, the real helper started on
// it with the engine the run names, and nothing reaching a host tool. A scenario seeds records, ticks the helper's
// dispatcher and card router, signs the director's answers as their click does, and reads what was written. Only the
// fake engine is here; the counted evaluation's Archon comes later.
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startHelper } from '../host/helper.js';
import { run as realRun } from '../lib/run.js';
import { helperAddress, stateDir } from '../lib/paths.js';
import { writeProject } from '../lib/projects.js';
import { setStop, liftStop } from '../lib/stop.js';
import { openProjectRecord } from '../state/record.js';
import { dataHash, eventPath, listEvents, makeEvent } from '../state/events.js';
import { makeSigningKey, enrol, ownKey } from '../state/signing.js';
import { buildViews } from '../state/views.js';
import { fakeEngine } from '../engine/fake.js';
import { engineDirOf } from '../engine/routes.js';

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

// openWorld({ engine, recordings, now, host, spawn, adapt, seed }) -> the world, on the project's default settings. `now`
// is a function the scenario may move on; `host` the code host's stand-in the helper reads (its adapter), which the
// scenario may change. For tests: `spawn` stands in for the helper's processes (a wake by default), `adapt(engine)`
// adds to the fake engine, and `seed(world)` writes records before the helper starts.
export async function openWorld({ engine: kind = 'fake', recordings = {}, now = () => new Date(), host = {}, spawn = () => fakeChild(), adapt = (e) => e, seed = () => {} } = {}) {
  if (!ENGINES.includes(kind)) throw new Error(`An engine scenario runs on ${ENGINES.join(', ')}, not ${kind}`);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-ew-'));
  const home = path.join(root, 'h');
  const folder = path.join(root, 'project');
  const artefacts = path.join(root, 'art');
  for (const dir of [home, folder, artefacts]) fs.mkdirSync(dir, { recursive: true });
  // A project whose tests run with `npm test`, so its work can have a done check.
  fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name: 'p', scripts: { test: 'node --test' } }));
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  const hostCalls = [];
  const engine = adapt(fakeEngine({ recordings, artefacts, now: () => now().toISOString() }));
  let helper = null;
  const records = (kind) => listEvents(stateDir(PROJECT), { report: () => {} }).filter((e) => kind === undefined || e.kind === kind);
  const own = () => { const k = ownKey(); return k ? [{ computer: k.computer, publicKey: k.publicKey }] : []; };

  const world = {
    engine, home, folder, artefacts, hostCalls, host,
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
    writeProject(PROJECT, { folder, remoteUrl: 'https://example.invalid/o/p.git', host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' } });
    await openProjectRecord(PROJECT);
    await seed(world);
    helper = await startHelper({
      run: noHostTools(hostCalls), address: helperAddress({ home }), adapterFor: async () => host, envFor: async () => ({}), now,
      spawn, engineFor: () => engine, dispatchMs: 60 * 60 * 1000, stopPollMs: 50,
      // The fake engine reads no fetch mirror.
      refreshMirror: async () => ({ ok: true }),
    });
  } catch (error) {
    await world.close();
    throw error;
  }
  return world;
}

// The wake process: a stand-in that runs nothing.
function fakeChild() {
  const child = new EventEmitter();
  child.pid = 7000;
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
// { recordings?, startAt?, host?(), play(world, { now, at }) -> { pass, why } }; `at(iso)` moves the world's clock, and
// `host()` gives the code host's stand-in for this play.
export async function runEngineScenario({ scenario, engine = 'fake' }) {
  // The world's clock starts at the scenario's time and runs on with the real one, so records keep their order;
  // `at` moves it.
  const clock = { base: Date.parse(scenario.engine.startAt ?? '2026-10-29T09:00:00.000Z'), from: Date.now() };
  const now = () => new Date(clock.base + (Date.now() - clock.from));
  const world = await openWorld({ engine, recordings: scenario.engine.recordings ?? {}, now, host: typeof scenario.engine.host === 'function' ? scenario.engine.host() : {} });
  try {
    const got = await scenario.engine.play(world, { now, at: (iso) => { clock.base = Date.parse(iso); clock.from = Date.now(); } });
    if (world.hostCalls.length > 0) return { pass: false, why: `a host tool was called: ${world.hostCalls.join('; ')}` };
    return got;
  } finally {
    await world.close();
  }
}
