// scripts/eval/archon-world.js
// The counted evaluation's world on real Archon (Archon design, section 18), beside the fake engine's (engine-world.js),
// chosen by `npm run eval -- … --engine archon`. It is the fake world's shape (a home of its own in a temporary folder,
// one project registered with its record open and this computer's key enrolled, the real helper on it, the code host
// stood in), with the engine installed as setup installs it (archon-engine.js):
//   - Archon built from source at its pin with Wheelhouse's patch (build.js), once, into a cache outside ~/.wheelhouse
//     (WHEELHOUSE_EVAL_ARCHON, by default ~/.wheelhouse-evals/engine), and reused by every world after;
//   - each world's engine folder (<home>/engine) holding the cache's Bun and source by link, its own launcher and Bun
//     config, the broker's launcher and the pack built from this checkout, so the adapter's health check reads it as an
//     install; Archon's home is the world's own, beside its home and inside its folder (archonHome);
//   - Archon's home settings naming Claude as the assistant that runs its steps, which its health check reads;
//   - every Archon command run with archonEnv: usage reporting off, the broker the only gh, the patch's permission mode;
//   - the project a throwaway git repository whose remote is a bare repository beside it, at <root>/o/p, so the
//     record names it o/p, and nothing reaches GitHub. The repository itself is at <root>/mirrors/o__p.git and the
//     project's own git reads <root>/o/p as that address, as setup's fetch-mirror rule does for a GitHub address, so
//     Archon names its workspace mirrors/o__p, where the adapter looks for a run's artefacts;
//   - the skill kits setup pins installed for the project at project scope, so a step's session start isn't held, and
//     taken back when the world closes, or by the next world when a run was killed first (sweepWorldInstalls). These
//     are entries in Claude Code's record of installs, ~/.claude/plugins/installed_plugins.json;
//   - the project's lock taken on that remote, so the broker comes to its real rules;
//   - the real gh stood in: a call the broker lets through is kept in `forwarded` and answered, never run.
// Every step is bound to one cheap model (WHEELHOUSE_EVAL_MODEL, by default haiku), so a real step costs cents. Claude
// Code is the one at ~/.local/bin/claude unless WHEELHOUSE_EVAL_CLAUDE names another. A world ends by cancelling every
// run left, then removing its folder; the sessions' transcripts Claude Code keeps under ~/.claude/projects stay.
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startHelper } from '../host/helper.js';
import { ENGINE_CONFIG } from '../host/helper-main.js';
import { run as realRun } from '../lib/run.js';
import { safeGit } from '../lib/safe-git.js';
import { helperAddress, stateDir, archonHome, projectSlug } from '../lib/paths.js';
import { writeProject } from '../lib/projects.js';
import { setStop, liftStop } from '../lib/stop.js';
import { openProjectRecord } from '../state/record.js';
import { dataHash, eventPath, listEvents, makeEvent } from '../state/events.js';
import { makeSigningKey, enrol, ownKey } from '../state/signing.js';
import { takeLock } from '../state/lock.js';
import { buildViews } from '../state/views.js';
import { engineDirOf } from '../engine/routes.js';
import { archonAdapter } from '../engine/archon/adapter.js';
import { archonCli } from '../engine/archon/cli.js';
import { archonEnv } from '../engine/archon/env.js';
import { writeArchonSettings } from '../engine/archon/build.js';
import { PROJECT, until } from './engine-world.js';
import { standInTools } from './stand-in-tools.js';
import { engineCache, prepareEngine, linkEngine } from './archon-engine.js';
import { OWNER_FILE, sweepWorldInstalls, worldKits } from './world-kits.js';

export { engineCache, prepareEngine, cacheBuilt, linkEngine } from './archon-engine.js';
export { KITS, sweepWorldInstalls } from './world-kits.js';

export const REPO = 'o/p';
export const WORKTREES = '.wheelhouse/worktrees';

// The throwaway project: a git repository on `main` with a bare remote at <root>/o/p, a test script, Archon's project
// settings (worktrees inside the folder, kept out of git) and a .env for the guards' trial to be refused.
// `beforeCommit()` runs once the files are there and before the first commit, as setup's own steps do.
async function makeProject({ root, folder, git, beforeCommit = async () => {} }) {
  const remote = path.join(root, ...REPO.split('/'));
  const mirror = path.join(root, 'mirrors', `${projectSlug(...REPO.split('/'))}.git`);
  fs.mkdirSync(mirror, { recursive: true });
  fs.mkdirSync(path.dirname(remote), { recursive: true });
  fs.symlinkSync(mirror, remote, 'dir');
  const must = async (args, cwd) => {
    const got = await git(args, cwd);
    if (got.code !== 0) throw new Error(`git ${args[0]} failed in the evaluation's project: ${String(got.stderr).trim()}`);
  };
  await must(['init', '-q', '--bare', '-b', 'main'], mirror);
  fs.writeFileSync(path.join(folder, 'package.json'), `${JSON.stringify({ name: 'p', private: true, scripts: { test: 'node --test' } }, null, 2)}\n`);
  fs.writeFileSync(path.join(folder, 'README.md'), '# p\n\nA page for the evaluation.\n');
  fs.writeFileSync(path.join(folder, '.gitignore'), '.wheelhouse/\n.env\n');
  fs.mkdirSync(path.join(folder, '.archon'), { recursive: true });
  fs.writeFileSync(path.join(folder, '.archon', 'config.yaml'), `# .archon/config.yaml\nworktree:\n  path: ${WORKTREES}\n`);
  fs.writeFileSync(path.join(folder, '.env'), 'EVAL_ONLY=not-a-secret\n');
  await must(['init', '-q', '-b', 'main'], folder);
  await must(['config', `url.${mirror}.insteadOf`, remote], folder);
  await beforeCommit();
  const commit = ['-c', 'user.name=Evaluation', '-c', 'user.email=eval@example.invalid', 'commit', '-q', '-m', 'Start'];
  for (const args of [['add', '-A'], commit, ['remote', 'add', 'origin', remote], ['push', '-q', 'origin', 'main']]) await must(args, folder);
  return remote;
}

// The code host's stand-in the helper reads: a default branch, and nothing else to say.
const standInHost = () => ({ defaultBranch: async () => 'main' });

// The wake process: a stand-in that runs nothing. No real play answers an ask, so none needs carrying on.
function idleChild() {
  const child = new EventEmitter();
  // No pid: All stop ends the processes the continuation host started, by pid, and a made-up one could be another
  // program's on this computer.
  child.pid = null;
  child.kill = () => { setImmediate(() => child.emit('exit', null, 'SIGTERM')); return true; };
  return child;
}

// openArchonWorld({ now, cache, cli, model, claudeBin, claudeConfig, bunRun }) -> the world. `cli` runs Archon (archonCli;
// tests give a stand-in), `model` is the one model every tier is bound to, `claudeBin` the Claude Code that runs Archon's
// steps, `claudeConfig` its settings folder, where its record of installs is, and `bunRun` what runs Bun's version check.
export async function openArchonWorld({
  now = () => new Date(), cache = engineCache(), cli = archonCli, model = process.env.WHEELHOUSE_EVAL_MODEL || 'haiku',
  claudeBin = process.env.WHEELHOUSE_EVAL_CLAUDE || path.join(os.homedir(), '.local', 'bin', 'claude'), bunRun = realRun,
  claudeConfig = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'),
} = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-aw-')));
  const home = path.join(root, 'h');
  const folder = path.join(root, 'project');
  const engineFolder = path.join(home, 'engine');
  for (const dir of [home, folder]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(root, OWNER_FILE), `${process.pid}\n`);
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  // <root>/h-engine: inside the world's folder, so it goes with it.
  const engineHome = archonHome();
  const forwarded = [];
  const hostCalls = [];
  const calls = [];
  let helper = null;
  let engine = null;
  let paths = null;
  const records = (kind) => listEvents(stateDir(PROJECT), { report: () => {} }).filter((e) => kind === undefined || e.kind === kind);
  const own = () => { const k = ownKey(); return k ? [{ computer: k.computer, publicKey: k.publicKey }] : []; };
  // The fence alone, reaching folders on this computer: the project and its remote are the world's own, made here, and
  // nothing in them runs hooks or filters.
  const git = (args, cwd) => safeGit({ cwd, reach: 'local', look: 'never', timeoutMs: 60000 })(args);
  // The kits installed for the project, to take back at the end.
  const kits = worldKits({ claudeBin, folder });
  // Every Archon command in this world: the world's engine folder, its Archon home, its Claude Code.
  const archon = (args, options = {}) => cli(args, { ...options, engine: engineFolder, home: engineHome, claudeBin });

  const world = {
    real: true, home, folder, root, forwarded, hostCalls, host: standInHost(),
    get engine() { return engine; },
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
    starts: () => calls.filter((c) => c.call === 'start'),
    acts: () => calls.filter((c) => c.call === 'act'),
    // The ids of the runs Archon started, oldest first.
    runs: () => calls.filter((c) => c.call === 'start' && c.got?.ok === true).map((c) => c.got.runId),
    orders() {
      const dir = path.join(engineDirOf(stateDir(PROJECT)), 'orders');
      const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith('.json')) : [];
      return names.map((n) => ({ runId: n.slice(0, -5), ...JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')) }));
    },
    // A run's state as Archon has it: running, paused, completed, failed or cancelled (unknown for no such run).
    async status(runId) {
      const record = await engine.inspect(runId);
      return record.outcome ?? record.status;
    },
    // A run's artefacts folder, where its steps (and an agent in them) can write.
    artefactsOf: (runId) => engine.artefactsOf(runId, REPO),
    // The broker's launcher run as Archon's steps run gh: with archonEnv, from `cwd` (a folder of the project's).
    broker: (argv, { cwd = folder, input = '' } = {}) => realRun(paths.broker, argv, {
      cwd, input, baseEnv: {}, env: archonEnv({ engine: engineFolder, home: engineHome, claudeBin }), timeoutMs: 120000,
    }),
    // The helper's own client, as a run's step calls its routes.
    async client() {
      const { helperClient } = await import('../host/helper-client.js');
      return helperClient({ timeout: 120000 });
    },
    // Runs `wheelhouse-hello` (setup's health trial): a script step and one cheap Claude step that tries to read the
    // project's .env. { ok, why }.
    async prove({ ms = 5 * 60 * 1000, every = 2000 } = {}) {
      const health = await engine.health();
      if (!health.ok) return { ok: false, why: `the engine isn't sound: ${health.findings.join('; ')}` };
      const started = await archon(['workflow', 'run', 'wheelhouse-hello', '--detach', '--workflow-source', paths.packDir, '--config', ENGINE_CONFIG, '--cwd', folder], { json: true, timeout: 120000 });
      const runId = started.json?.ok === true ? started.json.runId : null;
      if (typeof runId !== 'string') return { ok: false, why: `the health trial didn't start: ${String(started.json?.error ?? started.stderr ?? '').trim().split('\n')[0]}` };
      const ended = await until(async () => (await engine.inspect(runId)).outcome, { ms, every });
      if (ended !== 'completed') return { ok: false, why: `the health trial ${ended ? `ended ${ended}` : 'didn\'t finish in time'}${await world.trouble(runId)}` };
      let guarded;
      try { guarded = JSON.parse((await engine.outputs(runId)).guarded ?? 'null'); } catch { guarded = null; }
      if (guarded?.refused !== true) return { ok: false, why: `the health trial's step read the project's .env: the guards didn't hold${await world.trouble(runId)}` };
      return { ok: true, why: 'the patched engine is at its pins with usage reporting off, and its Claude step was refused the .env' };
    },
    // The question a paused run waits on, as Archon's queue of asks has it, or null.
    async asking(runId) {
      const open = (await engine.watch(null).catch(() => ({ events: [] }))).events.find((e) => e.runId === runId);
      return open ? String(open.context?.question ?? open.reason ?? open.kind ?? 'an ask') : null;
    },
    // What Archon's record says went wrong in a run, as `: <its error>; <the last refusal a step was given>`, or ''.
    async trouble(runId) {
      const got = await archon(['workflow', 'get', runId, '--verbose', '--events'], { json: true, timeout: 120000 }).catch(() => null);
      const events = Array.isArray(got?.json?.events) ? got.json.events : [];
      const line = (text) => String(text ?? '').trim().split('\n')[0].slice(0, 300);
      const failed = events.filter((e) => e?.event_type === 'workflow_failed').at(-1)?.data?.error ?? got?.json?.terminal_record?.error;
      // The first step that failed, with its own error: the run's error names it but doesn't say why.
      const node = events.find((e) => e?.event_type === 'node_failed');
      const step = node ? `${node.step_name ?? 'a step'} said: ${node.data?.error ?? node.data?.node_output ?? 'nothing'}` : null;
      const refusal = events.map((e) => e?.data?.event).filter((e) => e?.type === 'tool_call_update' && e.status === 'failed' && /hook error|denied|not permitted/i.test(String(e.output))).at(-1)?.output;
      const said = [failed, step].filter(Boolean).map(line).join('; ');
      const told = refusal ? `the step was told: ${line(refusal)}` : '';
      const parts = [said, told].filter(Boolean);
      return parts.length > 0 ? `: ${parts.join('; ')}` : '';
    },
    async close() {
      try {
        if (engine) await engine.stopAll('the evaluation world closes').catch(() => null);
        await helper?.close();
        // The kits' project-scope installs name the world's folder in Claude Code's record of installs: taken back.
        await kits.remove();
      } finally {
        if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
        // Archon's cancelled steps may still be leaving their folders, so the removal is tried again for a while; a folder
        // that still won't go is named, never a failure of the scenario played in it.
        try {
          fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
        } catch {
          // A cancelled step's hooks and Archon's database finish writing a few seconds after: tried once more then.
          setTimeout(() => {
            try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch (error) {
              process.stderr.write(`The evaluation world's folder ${root} was left behind: ${error.message}\n`);
            }
          }, 15000).unref();
        }
      }
    },
  };

  try {
    paths = linkEngine({ cache, engine: engineFolder });
    // Archon's own settings: Claude runs its steps. Its `ai tier list` names no assistant without this line, and the
    // adapter's health check refuses an engine that doesn't say Claude.
    writeArchonSettings(engineHome);
    const remote = await makeProject({
      root, folder, git,
      beforeCommit: async () => {
        // An earlier world's installs that a killed run never took back go first.
        for (const { kit, projectPath } of await sweepWorldInstalls({ claudeBin, configDir: claudeConfig })) process.stderr.write(`Took back ${kit}, which an earlier evaluation world left installed for ${projectPath}\n`);
        await kits.install();
      },
    });
    const adapter = archonAdapter({
      cli: archon, run: bunRun, packDir: paths.packDir, configFile: ENGINE_CONFIG, engine: engineFolder, home: engineHome,
      worktreeBases: [path.join(folder, WORKTREES)],
    });
    // The adapter as the helper sees it, with its starts and acts kept, and every tier bound to the one cheap model.
    const tiers = { small: model, medium: model, large: model };
    engine = {
      ...adapter,
      async start(order) {
        const got = await adapter.start({ ...order, bindings: { ...(order.bindings ?? {}), tiers } });
        calls.push({ call: 'start', order, got });
        return got;
      },
      async act(runId, action) {
        calls.push({ call: 'act', runId, action });
        return adapter.act(runId, action);
      },
    };
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: now().toISOString() });
    writeProject(PROJECT, { folder, remoteUrl: remote, host: 'github', repo: REPO, connection: { host: 'github', mode: 'quick', project: REPO } });
    await openProjectRecord(PROJECT);
    const push = async (dir, branch) => {
      const got = await git(['push', '-q', 'origin', `${branch}:${branch}`], dir);
      if (got.code === 0) return { ok: true };
      return /non-fast-forward|fetch first|rejected/.test(got.stderr) ? { ok: false, rejected: 'non-fast-forward' } : { ok: false };
    };
    // The remote is a folder on this computer, which the state's git fence reaches only when told (as the helper is).
    const lock = await takeLock({ project: PROJECT, push, now, env: { GIT_ALLOW_PROTOCOL: 'https:file' } });
    if (!lock.taken) throw new Error('The evaluation world could not take its project\'s lock');
    helper = await startHelper({
      run: standInTools({ forwarded, refused: hostCalls }), address: helperAddress({ home }), adapterFor: async () => world.host, envFor: async () => ({}), now,
      spawn: () => idleChild(), engineFor: () => engine, dispatchMs: 60 * 60 * 1000, stopPollMs: 200,
    });
  } catch (error) {
    await world.close();
    throw error;
  }
  return world;
}

// The health trial's result, once per evaluation run: every real scenario after a failed trial fails with its reason.
let proof = null;
export function resetProof() { proof = null; }

// Plays one scenario's real play in a world of its own: { pass, why }. The engine is built first if it isn't, and
// proved once. `open` and `prepare` are for tests.
export async function runRealScenario({ scenario, open = openArchonWorld, prepare = prepareEngine, log = (line) => process.stderr.write(`${line}\n`) }) {
  const cache = await prepare({ log });
  if (proof === null) {
    const world = await open({ cache });
    try { proof = await world.prove(); } catch (error) { proof = { ok: false, why: `the health trial could not run: ${error.message}` }; } finally { await world.close(); }
  }
  if (!proof.ok) return { pass: false, why: `not played: ${proof.why}` };
  const world = await open({ cache });
  try {
    const got = await scenario.engine.real(world, { until: (fn, o) => until(fn, { ms: 6 * 60 * 1000, every: 1000, ...o }) });
    if (world.hostCalls.length > 0) return { pass: false, why: `a host tool was called: ${world.hostCalls.join('; ')}` };
    return got;
  } finally {
    await world.close();
  }
}
