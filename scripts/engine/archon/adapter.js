// scripts/engine/archon/adapter.js
// The engine interface (contract.js) over Archon's command line (spec 6.3). Every command goes through archonCli, so
// it runs with archonEnv; tests hand in a stand-in `cli`, `streamer` and `run`, and nothing real is started.
//
//   start      archon workflow run <workflow> --detach --workflow-source <pack> --config <file> --branch <b>
//              --input work=<id> --model <binding>…   (only the work's id: the order itself never goes on the line, spec 7.4)
//   watch      archon workflow attention --all --json          (the queue once: the backstop's read)
//   follow     archon workflow attention --watch --json --all --after <cursor>
//   act        archon workflow answer <run> --occurrence <o> --choose <c> --text <w> --json;
//              archon workflow cancel <run> --json; archon workflow resume <run> --detach --json  (never abandon, spec 12.2)
//   inspect    archon workflow get <run> --verbose --json
//   outputs    archon workflow get <run> --verbose --events --json
//   stopAll    archon workflow status --all --json, and workflow get <run> --verbose --json for each known run it left out,
//              then cancel each running, pending or paused run   (stop.js ends what is left)
//   health     the launcher and the patch on disk; archon version; bun --version; archon ai tier list --json;
//              archon telemetry status
//   wake       archon workflow wake --watch --json   (wakeCommand: the continuation host starts and supervises it)
import fs from 'node:fs';
import { archonCli, archonCommand } from './cli.js';
import { roomCommand } from '../room.js';
import { ARCHON_SOURCE, BUN_PIN, CANCEL_PATCH_MARK, CLI_PATCH_MARK, PATCH_MARK, enginePaths, launcherText } from './build.js';
import { normaliseAsk, askOccurrence } from './asks.js';
import { readRecord, readOutputs, readTaskReviews } from './record.js';
import { readyWorkItem } from './work-item.js';
import { PACK_FORMS, COPILOT_SUFFIX, PROVIDER as COPILOT } from './copilot-pack.js';
import { checkRequests as meterCheck, readGitHubFigure, requestsFile as accountFile } from './copilot-meter.js';
import { readAccountModels, requestRates } from '../../agents/copilot/column.js';
import { engineHomeProblem } from '../../agents/copilot/engine-home.js';
import { copilotCliInstalled, copilotCliPaths } from './copilot-cli.js';
import { signInOf } from '../../../adapters/copilot/sessions.js';
import { brokerProblem } from '../parts.js';
import path from 'node:path';
import { engineDir, archonHome, projectSlug } from '../../lib/paths.js';
import { run as defaultRun } from '../../lib/run.js';

// The pack's workflow for each lane (spec 7.2); the merge lane is Archon's own queue, as it ships.
export const LANE_WORKFLOWS = Object.freeze({
  quick: 'wheelhouse-quick',
  small: 'wheelhouse-small',
  slice: 'wheelhouse-slice',
  feature: 'wheelhouse-feature',
  bug: 'wheelhouse-bug',
  'fix-main': 'wheelhouse-fix-main',
  merge: 'archon-merge-queue',
  reader: 'wheelhouse-reader',
});
const MERGE_QUEUE = LANE_WORKFLOWS.merge;
const READER = LANE_WORKFLOWS.reader;

// The forms of the pack this engine's runs may start, beside the pack's own (pack-build.js): a Copilot project's twins.
export const ENGINE_PACK_FORMS = PACK_FORMS;

// The run's message when work carries on after a cancel: a cancelled run can't be resumed (check 78), so a fresh run
// starts on the same branch, over what the last one left, and every step runs again.
export const CARRY_ON = "Carry on from what's there.";

const TIERS = ['small', 'medium', 'large'];
// The statuses of a run that hasn't ended.
const LIVE = ['running', 'pending', 'paused'];
const START_MS = 120000;
// Archon keeps a run's start to the second.
const START_CLOCK_MS = 2000;
const CALL_MS = 60000;

// The routing table's column in force as Archon `--model` values (spec 7.6): `bindings` is
// { tiers: { small|medium|large: model }, aliases: { name or @name: model } }, giving ['large=…', '@implementer=…'].
// A model is one word (a model id, a provider-prefixed id, a tier or another @alias). Throws on a bad binding.
export function bindingsFor(bindings) {
  const out = [];
  const model = (value, name) => {
    if (typeof value !== 'string' || !/^\S+$/.test(value)) throw new Error(`The model for ${name} must be one word, with no spaces`);
    return value;
  };
  for (const [tier, value] of Object.entries(bindings?.tiers ?? {})) {
    if (!TIERS.includes(tier)) throw new Error(`${tier} isn't a tier (small, medium or large)`);
    out.push(`${tier}=${model(value, tier)}`);
  }
  for (const [alias, value] of Object.entries(bindings?.aliases ?? {})) {
    const name = alias.replace(/^@/, '');
    if (!/^[A-Za-z0-9][\w-]*$/.test(name)) throw new Error(`${alias} isn't a name a step's model can go by`);
    out.push(`@${name}=${model(value, `@${name}`)}`);
  }
  return out;
}

const onCopilot = (model) => new RegExp(`^${COPILOT}(?:[:/]|$)`, 'i').test(String(model));

// The workflow a run starts: the lane's own, or its Copilot twin (copilot-pack.js) when the run's models are all on
// Copilot. A Copilot run binds every tier, since a tier left unbound falls back to Claude's own model; a run whose
// models are on more than one provider is refused. { workflow } or { refused }.
export function workflowFor(workflow, bindings) {
  const models = [...Object.values(bindings?.tiers ?? {}), ...Object.values(bindings?.aliases ?? {})];
  const copilot = models.filter(onCopilot);
  if (workflow === MERGE_QUEUE || copilot.length === 0) return { workflow };
  if (copilot.length !== models.length) return { refused: 'A run\'s models must all be on one provider, and these are on more than one' };
  if (!TIERS.every((tier) => onCopilot(bindings.tiers?.[tier]))) return { refused: 'A run on Copilot binds every tier (small, medium and large), so none falls back to another provider' };
  return { workflow: `${workflow}${COPILOT_SUFFIX}` };
}

// The cursor rule of the attention stream (check 78, Archon's Operate page): a bookmark or the end of the snapshot
// is saved at once; any other line saves the cursor of the line before it, once a line with a different cursor
// arrives, since one event can send two lines at one cursor and resuming after it skips both. `see(line)` gives
// the cursor that is now safe to save, or null.
export function cursorKeeper() {
  let pending = null;
  return {
    see(line) {
      if (typeof line?.cursor !== 'string' || !line.cursor) return null;
      if (line.type === 'bookmark' || line.type === 'ready') {
        pending = null;
        return line.cursor;
      }
      const safe = pending !== null && pending !== line.cursor ? pending : null;
      pending = line.cursor;
      return safe;
    },
  };
}

// How much of a long-running command's output is kept beside the lines read from it.
export const STREAM_KEEP_BYTES = 64 * 1024;

// Lines of a long-running Archon command's standard output as they come, through archonCli's onStdout; only the
// newest STREAM_KEEP_BYTES of its output is kept while it runs. Ending the read (a `break`, or `signal`) stops it.
export function archonStreamer({ cli = archonCli } = {}) {
  return (args, { signal } = {}) => (async function* lines() {
    const stop = new AbortController();
    const signals = signal ? AbortSignal.any([signal, stop.signal]) : stop.signal;
    const queue = [];
    let buffer = '';
    let done = false;
    let wake = null;
    const nudge = () => { const w = wake; wake = null; w?.(); };
    const finished = Promise.resolve(cli(args, {
      signal: signals,
      limit: STREAM_KEEP_BYTES,
      onStdout: (chunk) => {
        buffer += chunk;
        const parts = buffer.split(/\r?\n/);
        buffer = parts.pop();
        queue.push(...parts);
        nudge();
      },
    })).catch(() => null).finally(() => {
      if (buffer) queue.push(buffer);
      buffer = '';
      done = true;
      nudge();
    });
    try {
      for (;;) {
        if (queue.length > 0) yield queue.shift();
        else if (done) break;
        else await new Promise((resolve) => { wake = resolve; });
      }
    } finally {
      if (!done) stop.abort();
      await finished;
    }
  })();
}

const parseLine = (text) => {
  try {
    const line = JSON.parse(text);
    return line && typeof line === 'object' && typeof line.type === 'string' ? line : null;
  } catch {
    return null;
  }
};

const refusedWith = (refused) => ({ ok: false, refused });

// The segments of `folder` below `base`, or null when it isn't strictly inside it.
function below(folder, base) {
  const relative = path.relative(base, folder);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative.split(path.sep);
}

// A run's folder for All stop to look in, or null: only a worktree, under Archon's own
// <home>/workspaces/<owner>/<repo>/worktrees/ or strictly inside a configured worktree base (`worktree.path`, spec
// 6.3), and never that base or the project folder itself, where the director's own processes work.
function worktreeOf(folder, { home, worktreeBases }) {
  if (typeof folder !== 'string' || !path.isAbsolute(folder)) return null;
  const inHome = below(folder, path.join(home, 'workspaces'));
  if (inHome && inHome.length >= 4 && inHome[2] === 'worktrees') return folder;
  return worktreeBases.some((base) => typeof base === 'string' && path.isAbsolute(base) && below(folder, base)) ? folder : null;
}

// Archon's refusal as plain words for the core.
function refusal(action, result) {
  const error = String(result?.json?.error ?? result?.stderr ?? '').trim();
  if (/already resolved|no longer paused|already answered|awaiting occurrence|not awaiting an answer|\b409\b/i.test(error)) {
    return 'That ask was already answered or has moved on';
  }
  if (/Cannot resume run with status 'cancelled'/.test(error)) {
    return "A cancelled run can't be resumed; carrying on starts a fresh run on the same branch instead";
  }
  if (/Cannot cancel run with status/.test(error)) return "The run isn't running, so there is nothing to cancel";
  return `The engine refused to ${action}${error ? ` (${error.split('\n')[0]})` : ''}`;
}

// `cli` is archonCli or a stand-in; `streamer(args, { signal })` gives a long command's lines (archonStreamer);
// `run` runs Bun's version check; `pins` are the pinned Archon and Bun (build.js); `now` gives the time; `home` is
// ARCHON_HOME and `worktreeBases` the absolute folders the config's `worktree.path` places worktrees in.
// Why a Copilot step can't start in `engine`, or null. Copilot steps have no sandbox, so its guards, registered as the
// CLI's own hooks in its clean home, are what stand: with the program or the home missing or stale, the CLI would run
// from the director's own Copilot home, with none of them.
export function copilotEngineProblem(engine) {
  if (!copilotCliInstalled(engine)) return 'Copilot\'s command-line program isn\'t in the build engine\'s folder, so no Copilot step can start';
  let resolver = '';
  try { resolver = fs.readFileSync(enginePaths(engine).cliResolver, 'utf8'); } catch { /* read as unpatched */ }
  if (!resolver.includes(CLI_PATCH_MARK)) return 'The build engine was built before Wheelhouse\'s Copilot patch, so its Copilot steps would run without the pinned program and its guards; setup builds the engine again';
  return engineHomeProblem({ engine });
}

export function archonAdapter({
  cli = archonCli, streamer, run = defaultRun, packDir, configFile, engine = engineDir(), home = archonHome(), worktreeBases = [],
  pins = { archon: ARCHON_SOURCE, bun: BUN_PIN }, now = () => new Date().toISOString(),
  copilotProblem = () => copilotEngineProblem(engine),
} = {}) {
  const stream = streamer ?? archonStreamer({ cli });
  const answered = new Set();
  // The id of the ask open on each run, for a resolved line that names no occurrence (a usage limit's).
  const open = new Map();

  function asked(item) {
    const ask = normaliseAsk(item, { now });
    open.set(ask.runId, ask.id);
    return ask;
  }

  // The EngineEvents one stream line stands for; a bookmark, the end of the snapshot and the other lines only move
  // the cursor or carry nothing the core reads.
  function eventsOf(line) {
    if (line.type === 'attention' && line.item) return [asked(line.item)];
    if (line.type === 'resolved') {
      const id = line.occurrence ? `${line.runId}:${line.occurrence}` : open.get(line.runId) ?? `${line.runId}:waiting`;
      if (open.get(line.runId) === id) open.delete(line.runId);
      return [{ type: 'ask-resolved', runId: line.runId, at: line.answeredAt ?? now(), id, answered: line.reason === 'answered' }];
    }
    if (line.type === 'terminal') {
      open.delete(line.runId);
      const outcome = line.status === 'completed' ? (line.outcome === 'failed' ? 'failed' : 'completed') : line.status;
      return [{ type: 'run-ended', runId: line.runId, at: now(), outcome: String(outcome ?? 'ended'), branch: null, pr: null, failedAt: line.cause?.node ?? null }];
    }
    if (line.type === 'owner_lost') {
      return [{
        type: 'ask', runId: line.runId, at: now(), id: `${line.runId}:owner-lost`, kind: 'trouble', level: 3, work: null,
        recommend: 'stop', labels: {}, options: [], context: {}, card: true,
        reason: "The process running this work stopped before it finished, and the engine can't carry the work on by itself. Stopping the work is the safe choice.",
      }];
    }
    return [];
  }

  async function answer(runId, { ask, choice, words } = {}) {
    if (answered.has(ask)) return refusedWith('That ask has already been answered');
    const occurrence = askOccurrence(runId, ask);
    if (!occurrence) return refusedWith("That ask isn't one of this run's that takes an answer");
    if (choice === undefined && !words) return refusedWith('An answer needs a choice or some words');
    const args = ['workflow', 'answer', runId, '--occurrence', occurrence];
    if (choice !== undefined) args.push('--choose', String(choice));
    if (words) args.push('--text', String(words));
    const result = await cli(args, { json: true, timeout: CALL_MS });
    if (result.json?.ok === true) {
      answered.add(ask);
      return { ok: true };
    }
    const said = refusal('take the answer', result);
    if (said.startsWith('That ask was already')) answered.add(ask);
    // No answer from Archon at all (a timeout, a database it couldn't open): the answer is tried again, never dropped.
    if (!result.json) return { ...refusedWith(said), unreachable: true };
    return refusedWith(said);
  }

  return {
    name: 'archon',
    // Copilot's plan counts each prompt sent (checks 74 and 79): a run routed to it uses the monthly requests. Its
    // count isn't confirmed against GitHub's own figure yet (check 79's Copilot half), so no such run starts.
    countsRequests: (routing = {}) => [...Object.values(routing.tiers ?? {}), ...Object.values(routing.aliases ?? {})].some(onCopilot),
    requestsConfirmed: false,
    // The count of this month's requests the cap reads (copilot-meter.js): GitHub's own, checked once a day against
    // the meter's estimate. `estimate()` is the meter's count, `kept` what the last check kept, `run` runs `gh` with
    // the director's own sign-in. Not one of the interface's methods: only a provider that counts requests has it.
    checkRequests({ estimate, kept = null, run: ghRun = run, now: at = new Date() } = {}) {
      return meterCheck({ read: () => readGitHubFigure({ run: ghRun }), estimate, kept, now: at });
    },
    // The file that count is kept in: one for the account signed in to the engine's clean home.
    requestsFile() {
      let signIn = null;
      try { signIn = signInOf(copilotCliPaths(engine).home); } catch { /* the account can't be told */ }
      return accountFile(engine, signIn);
    },
    // The agent whose steps a run with these models takes, when its steps read Wheelhouse's own skill copies rather
    // than the kits the session start checks, or null. Its hold is re-checked where the run starts (routes.js).
    stepAgent: (bindings) => (workflowFor('wheelhouse-quick', bindings).workflow?.endsWith(COPILOT_SUFFIX) ? 'copilot' : null),
    words: {
      requestsHeld: 'Some work is set to use Copilot, and every Copilot prompt uses your plan\'s monthly requests (about 200 a month), since your plan has no free model. The cap is 0, so no Copilot runs until you allow some.',
    },

    // The continuation host's process (spec 6.3): it carries an answered run on. Given to the host to start, with
    // archonEnv as its whole environment.
    // The engine room's console (scripts/engine/room.js): `archon serve` on this computer only.
    roomCommand() {
      return roomCommand({ engine, home });
    },

    wakeCommand() {
      return archonCommand(['workflow', 'wake', '--watch', '--json'], { engine });
    },

    // Whether a process, by its command as `ps` lists it, is Archon's: the pinned Bun or the launcher under the
    // engine's folder (the launcher run by sh, before its exec, too). All stop ends only a run owner that is.
    ownsProcess(command) {
      if (typeof command !== 'string') return false;
      const { bunBin, launcher } = enginePaths(engine);
      const starts = (program, text) => text === program || text.startsWith(`${program} `);
      const program = command.replace(/^(\/bin\/)?sh /, '');
      return starts(bunBin, command) || starts(launcher, program);
    },

    async health() {
      const findings = [];
      // The patch fails closed: a release binary, or a source build without the patch, starts Claude steps in bypass
      // mode with no sandbox (build.js).
      const p = enginePaths(engine);
      const read = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };
      if (read(p.launcher) !== launcherText(engine) || !read(p.provider)?.includes(PATCH_MARK)) {
        findings.push("Archon isn't Wheelhouse's patched build from source, so its steps would run without the sandbox; no run starts until the engine is built again");
      } else if (!read(p.cancelOperation)?.includes(CANCEL_PATCH_MARK)) {
        findings.push("Archon was built before Wheelhouse's latest patch for cancelling runs, so All stop and the caps might not reach a run waiting at an ask or one that lost its process; no run starts until the engine is built again");
      }
      const version = await cli(['version'], { timeout: CALL_MS });
      const got = /Archon CLI (v\S+)/.exec(version.stdout ?? '')?.[1];
      if (version.code !== 0 || !got) findings.push("Archon didn't say which version it is; it may not be installed");
      else if (got !== pins.archon.tag) findings.push(`Archon is at ${got}, not the pinned ${pins.archon.tag}`);
      let bun;
      try { bun = await run(enginePaths(engine).bunBin, ['--version'], { timeoutMs: CALL_MS }); } catch { bun = { code: -1, stdout: '' }; }
      const bunVersion = String(bun.stdout ?? '').trim();
      if (bun.code !== 0) findings.push(`The pinned Bun (${pins.bun.version}) isn't in the engine's folder`);
      else if (bunVersion !== pins.bun.version) findings.push(`Bun is at ${bunVersion || 'an unknown version'}, not the pinned ${pins.bun.version}`);
      // Archon has no `provider list`; a source build carries its providers, so what matters is that Claude runs the steps.
      const tiers = await cli(['ai', 'tier', 'list'], { json: true, timeout: CALL_MS });
      if (tiers.json?.defaultAssistant !== 'claude') findings.push("Archon isn't set to run its steps with Claude");
      // Telemetry fails closed: anything but a plain "disabled" is a finding.
      const telemetry = await cli(['telemetry', 'status'], { timeout: CALL_MS });
      if (telemetry.code !== 0 || !/^Telemetry:\s+disabled\b/m.test(telemetry.stdout ?? '')) {
        findings.push("Archon's usage reporting is on, or it couldn't say; no run starts until it is off");
      }
      const broker = brokerProblem(engine);
      if (broker) findings.push(broker);
      return { ok: findings.length === 0, findings };
    },

    // `order`: { work, lane, branch?, project?, bindings?, carryOn?, repo? }, `repo` ({ host, path }) for the merge
    // queue. Only the work's id goes to Archon: a run's first step asks the helper for the order by it (spec 7.4).
    async start(order = {}) {
      const workflow = LANE_WORKFLOWS[order.lane];
      if (!workflow) return refusedWith(`There is no engine workflow for the ${order.lane ?? '(unnamed)'} lane`);
      const broker = brokerProblem(engine, { gone: true });
      if (broker) return refusedWith(broker);
      if (!packDir || !configFile) return refusedWith("The engine's pack or its settings file isn't known, so nothing can start");
      if (workflow !== MERGE_QUEUE && !order.work) return refusedWith('A run needs the id of its work');
      if (workflow === READER && !(order.card && order.project)) return refusedWith('A reader needs its card and its folder');
      // Archon's merge queue reads the repository it merges in from its inputs, and fails its first step without them.
      if (workflow === MERGE_QUEUE && !(typeof order.repo?.host === 'string' && order.repo.host && typeof order.repo?.path === 'string' && order.repo.path)) {
        return refusedWith('The merge queue needs the repository it merges in');
      }
      if (order.carryOn && !order.branch) return refusedWith('Carrying on needs the branch the work was on');
      let models;
      try { models = bindingsFor(order.bindings); } catch (error) { return refusedWith(error.message); }
      const chosen = workflowFor(workflow, order.bindings);
      if (chosen.refused) return refusedWith(chosen.refused);
      if (chosen.workflow.endsWith(COPILOT_SUFFIX)) {
        const problem = copilotProblem();
        if (problem) return refusedWith(problem);
      }
      const args = ['workflow', 'run', chosen.workflow];
      if (order.carryOn) args.push(CARRY_ON);
      args.push('--detach', '--workflow-source', packDir, '--config', configFile);
      if (order.project) args.push('--cwd', order.project);
      // The merge queue runs in Wheelhouse's own checkout of the project (queue-folder.js), which Archon would refuse
      // as a second clone of a registered remote: it is bound to the project the runs registered, which Archon names
      // after the fetch mirror, mirrors/<project>, and works in place there (check 81).
      if (workflow === MERGE_QUEUE && order.project) {
        const [owner, name] = order.repo.path.split('/');
        if (!owner || !name) return refusedWith('The merge queue needs the repository it merges in');
        args.push('--project', `mirrors/${projectSlug(owner, name)}`);
      }
      // A reader runs in place in a folder of its own, which Archon holds as a folder project: no git and no worktree.
      if (workflow === READER) args.push('--folder', '--input', `card=${order.card}`);
      else if (order.branch) args.push('--branch', order.branch);
      if (workflow === MERGE_QUEUE) args.push('--input', `repo_host=${order.repo.host}`, '--input', `repo_path=${order.repo.path}`);
      else if (workflow !== READER) args.push('--input', `work=${order.work}`);
      for (const binding of models) args.push('--model', binding);
      // Not started in the project (--cwd names it), so Bun reads nothing of the project's own.
      const result = await cli(args, { json: true, timeout: START_MS });
      if (result.json?.ok === true && typeof result.json.runId === 'string') {
        return { ok: true, runId: result.json.runId, branch: result.json.branch ?? order.branch ?? null };
      }
      const error = String(result.json?.error ?? result.stderr ?? '').trim().split('\n')[0];
      const said = refusedWith(`The engine didn't start the run${error ? ` (${error})` : ''}`);
      // Only the engine's own refusal is one. No reply in time, a command that died or words that can't be read may have
      // left a run begun all the same (check 85).
      return result.json?.ok === false && result.timedOut !== true && result.stopped !== true ? said : { ...said, uncertain: true };
    },

    // The live run of `work` begun since `since`, for a start that may have happened: { runId }, null for none, undefined
    // when it can't say. Check 85: a timed-out start can leave a `pending` run with no branch or path, so a run is told by
    // the `work` input every start gives, kept in its metadata. A pending run showing no input, or two matches, can't be
    // told. Asked on a later tick, since `status --all` leaves out a run under about a second old. Not one of the
    // interface's methods.
    async liveRunOf({ work, since } = {}) {
      const from = Date.parse(since);
      if (typeof work !== 'string' || !Number.isFinite(from)) return undefined;
      const listed = await cli(['workflow', 'status', '--all'], { json: true, timeout: CALL_MS });
      if (!Array.isArray(listed.json?.runs)) return undefined;
      const fresh = listed.json.runs.filter((r) => ![MERGE_QUEUE, READER].includes(r.workflow_name) && LIVE.includes(r.status) && Date.parse(r.started_at) >= from - START_CLOCK_MS);
      if (fresh.some((r) => typeof r.metadata?.inputs?.work !== 'string' && r.status === 'pending')) return undefined;
      const ours = fresh.filter((r) => r.metadata?.inputs?.work === work);
      if (ours.length > 1) return undefined;
      return ours.length === 1 ? { runId: ours[0].id } : null;
    },

    // The open asks, read once. The queue read has no cursor, so the one given comes back as it was.
    async watch(cursor) {
      const result = await cli(['workflow', 'attention', '--all'], { json: true, timeout: CALL_MS });
      const items = Array.isArray(result.json?.items) ? result.json.items : [];
      return { events: items.map(asked), cursor: cursor ?? null };
    },

    // The stream's events from `cursor` until the stream ends; `onCursor(cursor)` is told each cursor it is now safe
    // to keep, by cursorKeeper's rule. A cursor the engine doesn't know starts the stream once more without one:
    // the snapshot brings back every open ask.
    async *follow(cursor, { onCursor = () => {}, signal } = {}) {
      let after = cursor ?? null;
      for (let tries = 0; tries < 2; tries += 1) {
        const keeper = cursorKeeper();
        let unknownCursor = false;
        const args = ['workflow', 'attention', '--watch', '--json', '--all', ...(after ? ['--after', after] : [])];
        for await (const text of stream(args, { signal })) {
          const line = parseLine(text);
          if (!line) continue;
          if (line.type === 'error') {
            unknownCursor = line.error === 'cursor_invalid';
            break;
          }
          const safe = keeper.see(line);
          if (safe) onCursor(safe);
          for (const event of eventsOf(line)) yield event;
        }
        if (!unknownCursor || !after) return;
        after = null;
      }
    },

    async act(runId, action = {}) {
      if (action.answer) return answer(runId, action.answer);
      if (action.cancel) {
        const result = await cli(['workflow', 'cancel', runId], { json: true, timeout: CALL_MS });
        return result.json?.ok === true ? { ok: true } : refusedWith(refusal('cancel the run', result));
      }
      if (action.resume) {
        const result = await cli(['workflow', 'resume', runId, '--detach'], { json: true, timeout: CALL_MS });
        return result.json?.ok === true ? { ok: true } : refusedWith(refusal('resume the run', result));
      }
      return refusedWith('Nothing to do: give an answer, a cancel or a resume');
    },

    // The run's record (record.js), with `ownerPid`, the process that owns the run, and `folder`, the worktree it
    // works in (worktreeOf, or null); status 'unknown' when Archon has no such run, and with `unread` too when it gave no
    // answer at all, which says nothing of the run.
    async inspect(runId) {
      const result = await cli(['workflow', 'get', runId, '--verbose'], { json: true, timeout: CALL_MS });
      const json = result.code === 0 && result.json?.ok !== false ? result.json : null;
      return { ...readRecord(json, { rates: requestRates(readAccountModels(engine)) }), folder: worktreeOf(json?.working_path, { home, worktreeBases }), ...(result.json ? {} : { unread: true }) };
    },

    // Each finished step's whole output, by its id (record.js), for the helper to sign a review from Archon's own
    // record; none when Archon has no such run. Not one of the interface's methods: only this engine has step outputs.
    async outputs(runId) {
      const result = await cli(['workflow', 'get', runId, '--verbose', '--events'], { json: true, timeout: CALL_MS });
      return readOutputs(result.code === 0 && result.json?.ok !== false ? result.json : null);
    },

    // What the merge queue's paused run asked, from its record step's output, which holds the pull request, the head and
    // each choice's effect as the queue will act on them: { pr, head, merge }, `merge` being the id of the choice that
    // merges, or null. Null when it asked nothing about a pull request. Not one of the interface's methods.
    async mergeAsked(runId) {
      const result = await cli(['workflow', 'get', runId, '--verbose', '--events'], { json: true, timeout: CALL_MS });
      let asked = null;
      try { asked = JSON.parse(readOutputs(result.code === 0 && result.json?.ok !== false ? result.json : null).record ?? 'null')?.asked ?? null; } catch { return null; }
      if (asked?.by !== 'pr' || !Number.isInteger(asked.pr?.number) || typeof asked.head !== 'string') return null;
      const choices = Array.isArray(asked.attention?.choices) ? asked.attention.choices : [];
      const chosen = (effect) => choices.find((c) => c?.effect === effect)?.id ?? null;
      return { pr: asked.pr.number, head: asked.head, merge: chosen('merge'), park: chosen('park') };
    },

    // Each task's last review in a slice's run, { [task]: output }, from Archon's own record, or null when it has no
    // such run. Not one of the interface's methods.
    async taskReviews(runId) {
      const result = await cli(['workflow', 'get', runId, '--verbose', '--events'], { json: true, timeout: CALL_MS });
      return result.code === 0 && result.json?.ok !== false ? readTaskReviews(result.json) : null;
    },

    // The merge-queue runs live in a project's queue folder, whoever started them: Archon's ruling step can start one
    // the helper never hears of, and it runs in the same folder. Their ids, or null when the engine can't list its runs,
    // which says nothing about what is live. Not one of the interface's methods.
    async queueRuns({ folder } = {}) {
      const listed = await cli(['workflow', 'status', '--all'], { json: true, timeout: CALL_MS });
      if (!Array.isArray(listed.json?.runs)) return null;
      const inFolder = (where) => typeof where === 'string' && (where === folder || below(where, folder) !== null);
      return listed.json.runs.filter((r) => r.workflow_name === MERGE_QUEUE && LIVE.includes(r.status) && inFolder(r.working_path)).map((r) => r.id);
    },

    // The run's artefacts folder, where Archon's $ARTIFACTS_DIR puts what its steps write:
    // <home>/workspaces/mirrors/<owner>__<name>/artifacts/runs/<run>. A project in git alone has no owner, so `repo` is its
    // name, and the mirror its own name gives: mirrors/<project>. Null for a run id or repository that isn't a plain name.
    // A folder project's are under workspaces/_folder/<folder's name>. Not one of the interface's methods: the helper
    // copies a run's preview from here.
    artefactsOf(runId, repo, { folder } = {}) {
      const parts = typeof repo === 'string' ? repo.split('/') : [];
      const plain = (name) => typeof name === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(name) && !/^\.+$/.test(name);
      if (folder) return plain(runId) && plain(path.basename(folder)) ? path.join(home, 'workspaces', '_folder', path.basename(folder), 'artifacts', 'runs', runId) : null;
      if (!plain(runId) || parts.length < 1 || parts.length > 2 || !parts.every(plain)) return null;
      // Archon names the workspace after the project's remote, which is its fetch mirror (env.js): mirrors/<project>.
      return path.join(home, 'workspaces', 'mirrors', parts.length === 1 ? parts[0] : projectSlug(parts[0], parts[1]), 'artifacts', 'runs', runId);
    },

    // Hands a pull request to Archon's merge queue (check 76; ruling 9 of part 3b): writes its `work/<n>` document in
    // the project's state store, marked ready, over whatever revision is there. `item`: { project (its folder), repo,
    // pr, url, runId, at }. Not one of the interface's methods: only this engine has a merge queue.
    // Takes a run's worktree and branch out of the project's folder. Archon refuses a squashed branch whatever fetch came
    // first, and `--force` asks nothing about what it removes, so the helper looks before calling this (check 83).
    async complete({ folder, branch } = {}) {
      const result = await cli(['complete', '--force', branch], { cwd: folder, timeout: CALL_MS });
      return result.code === 0 ? { ok: true } : refusedWith(refusal('clean up the run', result));
    },

    async handOver({ project, repo, pr, url, runId, at = now() } = {}) {
      if (!project || !Number.isInteger(pr) || pr < 1) return refusedWith('A hand-over needs the project and the pull request');
      const name = `work/${pr}`;
      const current = await cli(['state', 'get', name], { json: true, cwd: project, timeout: CALL_MS });
      const revision = Number.isInteger(current.json?.revision) ? current.json.revision : 0;
      // The queue passes over an item whose repository isn't { host, path }, and says nothing (check 90).
      let host = null;
      try { host = new URL(url).hostname; } catch { return refusedWith('A hand-over needs the pull request\'s address'); }
      const value = readyWorkItem({ repo: { host, path: repo }, pr, url, at, runId });
      const put = await cli(['state', 'put', name, '--if-revision', String(revision)], { json: true, cwd: project, input: JSON.stringify(value), timeout: CALL_MS });
      if (put.code === 0 && put.json?.ok !== false) return { ok: true };
      return refusedWith(refusal('take the pull request into its merge queue', put));
    },

    // Cancels every running run, every pending one (just started with --detach) and every paused one, whose worktree
    // the cancel keeps (paused-run-cancel.patch). A child run is cancelled with its parent. A run whose cancel is
    // refused is a survivor, but a paused one is listed in `paused`: it is doing nothing, and only an engine built
    // without the patch refuses it. `beforeCancel(runs)` is awaited with those runs, [{ id, folder }]
    // (the worktree each works in, or null: worktreeOf), before any is cancelled, so All stop can take each run's
    // process tree while it is still whole (check 78). `known` are the runs the helper started and hasn't seen end:
    // `status --all` doesn't list a run started under about a second ago, so each one it left out is read by itself.
    async stopAll(_reason, { beforeCancel, known = [] } = {}) {
      const listed = await cli(['workflow', 'status', '--all'], { json: true, timeout: CALL_MS });
      if (!Array.isArray(listed.json?.runs)) {
        return { cancelled: [], survivors: [], paused: [], trouble: "The engine couldn't list its runs, so none was cancelled" };
      }
      const rows = [...listed.json.runs];
      const seen = new Set(rows.map((r) => r.id));
      for (const id of new Set(known)) {
        if (typeof id !== 'string' || seen.has(id)) continue;
        const got = await cli(['workflow', 'get', id, '--verbose'], { json: true, timeout: CALL_MS });
        if (got.code === 0 && got.json?.ok !== false && got.json?.id === id) rows.push(got.json);
      }
      const going = rows.filter((r) => LIVE.includes(r.status));
      const ids = new Set(going.map((r) => r.id));
      if (beforeCancel) {
        const runs = going.map((r) => ({ id: r.id, folder: worktreeOf(r.working_path, { home, worktreeBases }) }));
        try { await beforeCancel(runs); } catch { /* the cancel goes ahead all the same */ }
      }
      const cancelled = [];
      const survivors = [];
      const paused = [];
      for (const runRow of going.filter((r) => !r.parent_run_id || !ids.has(r.parent_run_id))) {
        const result = await cli(['workflow', 'cancel', runRow.id], { json: true, timeout: CALL_MS });
        (result.json?.ok === true ? cancelled : runRow.status === 'paused' ? paused : survivors).push(runRow.id);
      }
      return { cancelled, survivors, paused };
    },
  };
}
