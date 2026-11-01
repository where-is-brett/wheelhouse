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
//   - the real gh stood in: a call the broker lets through is kept in `forwarded` and answered, never run;
//   - with a `place` (places.js), a project whose checks run on this computer under the real sandbox: on the stand-in host
//     with no Actions, or kept in a home here with the real local adapter, its only remote the path to the engine's mirror.
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
import { runCost } from '../engine/spend.js';
import { archonConfigText } from '../setup/engine-parts.js';
import { FOLDER_REMOTE } from '../host/local/folder.js';
import { PROJECT, until } from './engine-world.js';
import { TINY_GOAL, keepHere, noActionsHost, placeAdapter, placeFiles, placeVerbs, writeFiles } from './places.js';
import { standInTools } from './stand-in-tools.js';
import { engineCache, prepareEngine, linkEngine } from './archon-engine.js';
import { OWNER_FILE, sweepWorldInstalls, worldKits, worldPlaces } from './world-kits.js';
import { sweepWorldPlugins, worldPlugin } from './world-plugin.js';

export { engineCache, prepareEngine, cacheBuilt, linkEngine } from './archon-engine.js';
export { KITS, sweepWorldInstalls } from './world-kits.js';

export const REPO = 'o/p';
export const WORKTREES = '.wheelhouse/worktrees';
// How long a real quick run may take to reach its pull request, every step on the one cheap model.
const LANE_MS = 20 * 60 * 1000;

// The throwaway project: a git repository on `main` with a bare remote at <root>/o/p, a test script, Archon's project
// settings (worktrees inside the folder, kept out of git) and a .env for the guards' trial to be refused.
// `beforeCommit()` runs once the files are there and before the first commit, as setup's own steps do. A `place` adds the
// files it needs and `files`; in git alone there is no remote at all, and Archon is told of the folder's.
async function makeProject({ root, folder, git, place = null, files = {}, beforeCommit = async () => {} }) {
  const mirror = path.join(root, 'mirrors', `${projectSlug(...REPO.split('/'))}.git`);
  const remote = path.join(root, ...REPO.split('/'));
  fs.mkdirSync(mirror, { recursive: true });
  fs.mkdirSync(path.dirname(remote), { recursive: true });
  fs.symlinkSync(mirror, remote, 'dir');
  const must = async (args, cwd) => {
    const got = await git(args, cwd);
    if (got.code !== 0) throw new Error(`git ${args[0]} failed in the evaluation's project: ${String(got.stderr).trim()}`);
  };
  const local = place === 'git-alone';
  if (!local) await must(['init', '-q', '--bare', '-b', 'main'], mirror);
  fs.writeFileSync(path.join(folder, 'package.json'), `${JSON.stringify({ name: 'p', private: true, scripts: { test: 'node --test' } }, null, 2)}\n`);
  fs.writeFileSync(path.join(folder, 'README.md'), '# p\n\nA page for the evaluation.\n');
  fs.writeFileSync(path.join(folder, '.gitignore'), '.wheelhouse/\n.env\n');
  fs.mkdirSync(path.join(folder, '.archon'), { recursive: true });
  fs.writeFileSync(path.join(folder, '.archon', 'config.yaml'), local ? archonConfigText({ remote: FOLDER_REMOTE, baseBranch: 'main' }) : `# .archon/config.yaml\nworktree:\n  path: ${WORKTREES}\n`);
  fs.writeFileSync(path.join(folder, '.env'), 'EVAL_ONLY=not-a-secret\n');
  if (place) writeFiles(folder, placeFiles(files));
  await must(['init', '-q', '-b', 'main'], folder);
  if (!place) await must(['config', `url.${mirror}.insteadOf`, remote], folder);
  await beforeCommit();
  const commit = ['-c', 'user.name=Evaluation', '-c', 'user.email=eval@example.invalid', 'commit', '-q', '-m', 'Start'];
  // In a place a run pushes, and the helper refuses a folder whose own settings redirect git, so the folder's remote is the
  // repository's own path, which gives Archon the same name; the record keeps the address that names it o/p.
  for (const args of [['add', '-A'], commit, ...(local ? [] : [['remote', 'add', 'origin', place ? mirror : remote], ['push', '-q', 'origin', 'main']])]) await must(args, folder);
  return { remote, mirror };
}

// The code host's stand-in the helper reads: a default branch, and nothing else to say.
// A project whose checks report on the host, so a merge in the world goes by the review and the approval.
const standInHost = () => ({
  defaultBranch: async () => 'main',
  branchHead: async () => null,
  checkContexts: async () => [{ name: 'ci', state: 'success', startedAt: '2026-10-31T00:00:00.000Z' }],
  requiredChecks: async () => [],
});

// The wake process: a stand-in that runs nothing. No real play answers an ask, so none needs carrying on.
function idleChild() {
  const child = new EventEmitter();
  // No pid: All stop ends the processes the continuation host started, by pid, and a made-up one could be another
  // program's on this computer.
  child.pid = null;
  child.kill = () => { setImmediate(() => child.emit('exit', null, 'SIGTERM')); return true; };
  return child;
}

// openArchonWorld({ now, cache, cli, model, claudeBin, claudeConfig, bunRun, place, files }) -> the world. `cli` runs Archon
// (archonCli; tests give a stand-in), `model` is the one model every tier is bound to, `claudeBin` the Claude Code that runs
// Archon's steps, `claudeConfig` its settings folder, where its record of installs is, `bunRun` what runs Bun's version
// check, and `place` and `files` where the project is kept and what it adds (places.js).
export async function openArchonWorld({
  place = null, files = {}, now = () => new Date(), cache = engineCache(), cli = archonCli, model = process.env.WHEELHOUSE_EVAL_MODEL || 'haiku',
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
  // The health trial's runs, which the helper never started, so the world's spend counts them too.
  const trialRuns = [];
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
  // This checkout's Wheelhouse, which every step names in place of the installed release (world-plugin.js).
  const plugin = worldPlugin({ claudeBin, folder, root, configDir: claudeConfig });
  // Every Archon command in this world: the world's engine folder, its Archon home, its Claude Code.
  const archon = (args, options = {}) => cli(args, { ...options, engine: engineFolder, home: engineHome, claudeBin });

  const world = {
    // `model`: the one model every tier is bound to.
    real: true, home, folder, root, forwarded, hostCalls, host: standInHost(), model,
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
    // Whether the steps ran this checkout's Wheelhouse: { ok, why } (world-plugin.js).
    pluginCheck: () => plugin.check(),
    // The plugins Claude Code has on for a session started in `cwd`, by its own list (the one Archon reads), or null
    // when the list can't be had.
    async pluginsOn(cwd) {
      const listed = await realRun(claudeBin, ['plugin', 'list', '--json'], { cwd, timeoutMs: 60000 });
      let all;
      try { all = JSON.parse(listed.stdout); } catch { return null; }
      return listed.code === 0 && Array.isArray(all) ? [...new Set(all.filter((p) => p?.enabled === true).map((p) => p.id))] : null;
    },
    stop: () => setStop({ by: 'prompt', now }),
    lift: () => liftStop(),
    starts: () => calls.filter((c) => c.call === 'start'),
    acts: () => calls.filter((c) => c.call === 'act'),
    // The ids of the runs Archon started, oldest first.
    runs: () => calls.filter((c) => c.call === 'start' && c.got?.ok === true).map((c) => c.got.runId),
    // The tokens the world's runs spent, the health trial's among them, as Archon's records give each step's:
    // { input, output }, with cache reads and writes in the input, where the provider's figure already holds them, as a
    // session's tokens are counted. A step whose
    // kinds of token aren't known counts its whole figure as input.
    async spend() {
      const total = { input: 0, output: 0 };
      for (const runId of [...trialRuns, ...world.runs()]) {
        let cost;
        try { cost = runCost(await engine.inspect(runId)); } catch { continue; }
        if (cost.kinds) {
          total.input += cost.kinds.input ?? 0;
          total.output += cost.kinds.output ?? 0;
        } else total.input += cost.tokens;
      }
      return total;
    },
    orders() {
      const dir = path.join(engineDirOf(stateDir(PROJECT)), 'orders');
      const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith('.json')) : [];
      return names.map((n) => ({ runId: n.slice(0, -5), ...JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')) }));
    },
    // The real quick run of `work`, from its work order to its pull request with its reviews signed and, with `ready`, the
    // change marked ready: { runId, pr, head }. Ticked meanwhile, as the helper's dispatcher ticks. A run that stops short
    // says why.
    async lane(work, { title = TINY_GOAL, ready = true, ms = LANE_MS } = {}) {
      world.put('work', { id: work, title, lane: 'quick', visible: false, dependsOn: [] });
      const got = await until(async () => {
        await world.tick();
        const started = world.starts().find((s) => s.order.work === work);
        if (started && started.got?.ok !== true) throw new Error(`the run didn't start: ${started.got?.refused}`);
        const runId = started?.got?.runId;
        if (!runId) return null;
        const record = await engine.inspect(runId);
        let opened = null;
        try { opened = JSON.parse((await engine.outputs(runId))['open-pr'] ?? 'null'); } catch { /* not yet */ }
        const signed = opened && world.records('review').some((r) => r.data.commit === opened.head);
        if (signed && (!ready || world.readyOf(opened.pr))) return { runId, pr: opened.pr, head: opened.head };
        const status = record.outcome ?? record.status;
        if (status === 'paused') throw new Error(`the run stopped to ask: ${await world.asking(runId)}`);
        if (['failed', 'cancelled'].includes(status)) throw new Error(`the run ${status}${await world.trouble(runId)}`);
        return null;
      }, { ms, every: 2000 });
      if (!got) throw new Error(`the run of ${work} didn't reach its pull request in time`);
      return got;
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
      if (typeof runId === 'string') trialRuns.push(runId);
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
        await plugin.remove();
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
    paths = linkEngine({ cache, engine: engineFolder, plugin: plugin.id });
    // Archon's own settings: Claude runs its steps. Its `ai tier list` names no assistant without this line, and the
    // adapter's health check refuses an engine that doesn't say Claude.
    writeArchonSettings(engineHome);
    const { remote, mirror } = await makeProject({
      root, folder, git, place, files,
      beforeCommit: async () => {
        // An earlier world's installs that a killed run never took back go first.
        for (const { kit, projectPath } of await sweepWorldInstalls({ claudeBin, configDir: claudeConfig })) process.stderr.write(`Took back ${kit}, which an earlier evaluation world left installed for ${projectPath}\n`);
        for (const { what, where } of await sweepWorldPlugins({ claudeBin, configDir: claudeConfig, ...worldPlaces() })) process.stderr.write(`Took back ${what}, which an earlier evaluation world left at ${where}\n`);
        await kits.install();
        await plugin.install();
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
    if (place === 'git-alone') writeProject(PROJECT, { folder, remoteUrl: null, host: 'local', repo: `local/${PROJECT}`, connection: { host: 'local', mode: 'none', project: `local/${PROJECT}` } });
    else writeProject(PROJECT, { folder, remoteUrl: remote, host: 'github', repo: REPO, connection: { host: 'github', mode: 'quick', project: REPO } });
    await openProjectRecord(PROJECT);
    if (place === 'git-alone') await keepHere({ project: PROJECT, folder });
    if (place === 'no-ci') world.host = noActionsHost(mirror);
    if (place) placeVerbs(world, { project: PROJECT });
    const push = async (dir, branch) => {
      const got = await git(['push', '-q', 'origin', `${branch}:${branch}`], dir);
      if (got.code === 0) return { ok: true };
      return /non-fast-forward|fetch first|rejected/.test(got.stderr) ? { ok: false, rejected: 'non-fast-forward' } : { ok: false };
    };
    // The remote is a folder on this computer, which the state's git fence reaches only when told (as the helper is).
    if (place !== 'git-alone') {
      const lock = await takeLock({ project: PROJECT, push, now, env: { GIT_ALLOW_PROTOCOL: 'https:file' } });
      if (!lock.taken) throw new Error('The evaluation world could not take its project\'s lock');
    }
    const tools = standInTools({ forwarded, refused: hostCalls });
    helper = await startHelper({
      run: tools, address: helperAddress({ home }), adapterFor: place ? placeAdapter({ world, run: tools }) : async () => world.host, envFor: async () => ({}), now,
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

// Whether the world's steps ran this checkout's Wheelhouse; a world that can't say didn't.
async function ranThisCheckout(world) {
  if (typeof world.pluginCheck !== 'function') return { ok: false, why: 'the world can\'t say which Wheelhouse its steps ran' };
  try { return await world.pluginCheck(); } catch (error) { return { ok: false, why: `which Wheelhouse the steps ran couldn't be read: ${error.message}` }; }
}

// Plays one scenario's real play in a world of its own: { pass, why }. The engine is built first if it isn't, and
// proved once. `open` and `prepare` are for tests.
// A pass counts only when the steps ran this checkout's Wheelhouse, and so does the health trial.
export async function runRealScenario({ scenario, open = openArchonWorld, prepare = prepareEngine, log = (line) => process.stderr.write(`${line}\n`) }) {
  const cache = await prepare({ log });
  // The tokens the play's steps spent, by Archon's records, the health trial's too the one time it runs.
  const usage = { input: 0, output: 0 };
  const count = async (world) => {
    try {
      const spent = await world.spend?.();
      usage.input += spent?.input ?? 0;
      usage.output += spent?.output ?? 0;
    } catch { /* a world that can't say spent nothing it can count */ }
  };
  if (proof === null) {
    const world = await open({ cache });
    try {
      proof = await world.prove();
      if (proof.ok) {
        const ran = await ranThisCheckout(world);
        if (!ran.ok) proof = { ok: false, why: `the health trial didn't count: ${ran.why}` };
      }
    } catch (error) { proof = { ok: false, why: `the health trial could not run: ${error.message}` }; } finally {
      await count(world);
      await world.close();
    }
  }
  if (!proof.ok) return { pass: false, why: `not played: ${proof.why}`, usage };
  const { place, files } = scenario.engine;
  const world = await open({ cache, ...(place ? { place } : {}), ...(files ? { files } : {}) });
  try {
    const got = await scenario.engine.real(world, { until: (fn, o) => until(fn, { ms: 6 * 60 * 1000, every: 1000, ...o }) });
    if (world.hostCalls.length > 0) return { pass: false, why: `a host tool was called: ${world.hostCalls.join('; ')}`, usage };
    // A pass on another release's guards proves nothing about this checkout.
    const ran = got?.pass === true ? await ranThisCheckout(world) : { ok: true };
    return ran.ok ? { ...got, usage } : { pass: false, why: `not counted: ${ran.why}`, usage };
  } finally {
    // Counted even when the play throws; the returned usage is the same object, so it carries this world's spend.
    await count(world);
    await world.close();
  }
}
