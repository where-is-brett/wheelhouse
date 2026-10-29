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
//   stopAll    archon workflow status --all --json, then cancel each running or pending run   (stop.js ends what is left)
//   health     the launcher and the patch on disk; archon version; bun --version; archon ai tier list --json;
//              archon telemetry status
//   wake       archon workflow wake --watch --json   (wakeCommand: the continuation host starts and supervises it)
import fs from 'node:fs';
import { archonCli, archonCommand } from './cli.js';
import { ARCHON_SOURCE, BUN_PIN, PATCH_MARK, enginePaths, launcherText } from './build.js';
import { normaliseAsk, askOccurrence } from './asks.js';
import { readRecord, readOutputs } from './record.js';
import { readyWorkItem } from './work-item.js';
import path from 'node:path';
import { engineDir, archonHome } from '../../lib/paths.js';
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
});
const MERGE_QUEUE = LANE_WORKFLOWS.merge;

// The run's message when work carries on after a cancel: a cancelled run can't be resumed (check 78), so a fresh run
// starts on the same branch, over what the last one left, and every step runs again.
export const CARRY_ON = "Carry on from what's there.";

const TIERS = ['small', 'medium', 'large'];
const START_MS = 120000;
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
export function archonAdapter({
  cli = archonCli, streamer, run = defaultRun, packDir, configFile, engine = engineDir(), home = archonHome(), worktreeBases = [],
  pins = { archon: ARCHON_SOURCE, bun: BUN_PIN }, now = () => new Date().toISOString(),
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
    return refusedWith(said);
  }

  return {
    name: 'archon',

    // The continuation host's process (spec 6.3): it carries an answered run on. Given to the host to start, with
    // archonEnv as its whole environment.
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
      return { ok: findings.length === 0, findings };
    },

    // `order`: { work, lane, branch?, project?, bindings?, carryOn? }. Only the work's id goes to Archon: a run's
    // first step asks the helper for the order by it (spec 7.4).
    async start(order = {}) {
      const workflow = LANE_WORKFLOWS[order.lane];
      if (!workflow) return refusedWith(`There is no engine workflow for the ${order.lane ?? '(unnamed)'} lane`);
      if (!packDir || !configFile) return refusedWith("The engine's pack or its settings file isn't known, so nothing can start");
      if (workflow !== MERGE_QUEUE && !order.work) return refusedWith('A run needs the id of its work');
      if (order.carryOn && !order.branch) return refusedWith('Carrying on needs the branch the work was on');
      let models;
      try { models = bindingsFor(order.bindings); } catch (error) { return refusedWith(error.message); }
      const args = ['workflow', 'run', workflow];
      if (order.carryOn) args.push(CARRY_ON);
      args.push('--detach', '--workflow-source', packDir, '--config', configFile);
      if (order.project) args.push('--cwd', order.project);
      if (order.branch) args.push('--branch', order.branch);
      if (workflow !== MERGE_QUEUE) args.push('--input', `work=${order.work}`);
      for (const binding of models) args.push('--model', binding);
      // Not started in the project (--cwd names it), so Bun reads nothing of the project's own.
      const result = await cli(args, { json: true, timeout: START_MS });
      if (result.json?.ok === true && typeof result.json.runId === 'string') {
        return { ok: true, runId: result.json.runId, branch: result.json.branch ?? order.branch ?? null };
      }
      const error = String(result.json?.error ?? result.stderr ?? '').trim().split('\n')[0];
      return refusedWith(`The engine didn't start the run${error ? ` (${error})` : ''}`);
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

    // The run's record (record.js), with `ownerPid`, the process that owns the run; status 'unknown' when Archon
    // has no such run.
    async inspect(runId) {
      const result = await cli(['workflow', 'get', runId, '--verbose'], { json: true, timeout: CALL_MS });
      return readRecord(result.code === 0 && result.json?.ok !== false ? result.json : null);
    },

    // Each finished step's whole output, by its id (record.js), for the helper to sign a review from Archon's own
    // record; none when Archon has no such run. Not one of the interface's methods: only this engine has step outputs.
    async outputs(runId) {
      const result = await cli(['workflow', 'get', runId, '--verbose', '--events'], { json: true, timeout: CALL_MS });
      return readOutputs(result.code === 0 && result.json?.ok !== false ? result.json : null);
    },

    // The run's artefacts folder, where Archon's $ARTIFACTS_DIR puts what its steps write:
    // <home>/workspaces/<owner>/<name>/artifacts/runs/<run>. Null for a run id or repository that isn't a plain name.
    // Not one of the interface's methods: the helper copies a run's preview from here.
    artefactsOf(runId, repo) {
      const parts = typeof repo === 'string' ? repo.split('/') : [];
      const plain = (name) => typeof name === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(name) && !/^\.+$/.test(name);
      if (!plain(runId) || parts.length !== 2 || !parts.every(plain)) return null;
      return path.join(home, 'workspaces', parts[0], parts[1], 'artifacts', 'runs', runId);
    },

    // Hands a pull request to Archon's merge queue (check 76; ruling 9 of part 3b): writes its `work/<n>` document in
    // the project's state store, marked ready, over whatever revision is there. `item`: { project (its folder), repo,
    // pr, url, runId, at }. Not one of the interface's methods: only this engine has a merge queue.
    async handOver({ project, repo, pr, url, runId, at = now() } = {}) {
      if (!project || !Number.isInteger(pr) || pr < 1) return refusedWith('A hand-over needs the project and the pull request');
      const name = `work/${pr}`;
      const current = await cli(['state', 'get', name], { json: true, cwd: project, timeout: CALL_MS });
      const revision = Number.isInteger(current.json?.revision) ? current.json.revision : 0;
      const value = readyWorkItem({ repo, pr, url, at, runId });
      const put = await cli(['state', 'put', name, '--if-revision', String(revision)], { json: true, cwd: project, input: JSON.stringify(value), timeout: CALL_MS });
      if (put.code === 0 && put.json?.ok !== false) return { ok: true };
      return refusedWith(refusal('take the pull request into its merge queue', put));
    },

    // Cancels every running run, and every pending one (just started with --detach). A child run is cancelled with
    // its parent; a paused run is doing nothing and Archon cancels only running ones, so it is listed in `paused`. A
    // run whose cancel is refused is a survivor. `beforeCancel(runs)` is awaited with those runs, [{ id, folder }]
    // (the worktree each works in, or null: worktreeOf), before any is cancelled, so All stop can take each run's
    // process tree while it is still whole (check 78).
    async stopAll(_reason, { beforeCancel } = {}) {
      const listed = await cli(['workflow', 'status', '--all'], { json: true, timeout: CALL_MS });
      if (!Array.isArray(listed.json?.runs)) {
        return { cancelled: [], survivors: [], paused: [], trouble: "The engine couldn't list its runs, so none was cancelled" };
      }
      const running = listed.json.runs.filter((r) => r.status === 'running' || r.status === 'pending');
      const ids = new Set(running.map((r) => r.id));
      if (beforeCancel) {
        const runs = running.map((r) => ({ id: r.id, folder: worktreeOf(r.working_path, { home, worktreeBases }) }));
        try { await beforeCancel(runs); } catch { /* the cancel goes ahead all the same */ }
      }
      const cancelled = [];
      const survivors = [];
      for (const runRow of running.filter((r) => !r.parent_run_id || !ids.has(r.parent_run_id))) {
        const result = await cli(['workflow', 'cancel', runRow.id], { json: true, timeout: CALL_MS });
        (result.json?.ok === true ? cancelled : survivors).push(runRow.id);
      }
      const paused = listed.json.runs.filter((r) => r.status === 'paused').map((r) => r.id);
      return { cancelled, survivors, paused };
    },
  };
}
