// scripts/engine/host.js
// The continuation host (spec 6.3), which the helper supervises: one wake process, which carries answered runs on, and
// one follow of the engine's event stream, each started again when it ends. From the stream it writes `run` and `ask`
// records; the stream's cursor and the keys of what it wrote are kept in `cursorFile`, so a host started again picks
// up where the last left off and writes nothing twice (check 78: reconnect with the saved cursor, expect the open asks
// again in the snapshot, write each by its stable id). Every `backstopMs` it reads the open asks once and writes any
// the stream missed. It knows only the engine interface (contract.js), never an engine's own words.
import fs from 'node:fs';
import path from 'node:path';

export const BACKSTOP_MS = 15 * 1000;
// A stream that says nothing for this long, not even a bookmark, is taken as stuck and started again (check 78).
export const STUCK_MS = 60 * 1000;
export const RESTART_MS = 2 * 1000;
// How many written keys are kept beside the cursor: far more than the asks open at once.
export const KEPT_KEYS = 2000;
export const WAKE_NAME = "the engine's continuation process";

// The cursor file: { cursor, written }, with a cursor of null and nothing written when there is none or it can't be read.
export function readCursorFile(file) {
  try {
    const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      cursor: typeof kept?.cursor === 'string' && kept.cursor !== '' ? kept.cursor : null,
      written: Array.isArray(kept?.written) ? kept.written.filter((k) => typeof k === 'string') : [],
    };
  } catch {
    return { cursor: null, written: [] };
  }
}

// Written whole: a temporary file beside it, then a rename.
function saveCursorFile(file, { cursor, written }) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify({ cursor, written }, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

const isText = (value) => typeof value === 'string' && value !== '';
// A pull request's number, from a number or the end of its address.
function prNumber(pr) {
  if (Number.isInteger(pr) && pr > 0) return pr;
  const found = /(\d+)\/?$/.exec(typeof pr === 'string' ? pr : '');
  return found ? Number(found[1]) : undefined;
}
// The record's data with the fields that have no value left out.
const present = (data) => Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined && value !== null));

// startEngineHost({ engine, spawn, write, cursorFile, ... }) -> { stop(), check(), processes(), onAsk(fn) }.
// - `write(kind, data)` records a `run` or `ask`; a write that throws is tried again the next time the event is seen.
// - `workOf(runId)` -> { work, lane, branch? } | null: the work a run is for, from the record. A run this host doesn't
//   know (another project's, on the same engine) is written nothing.
// - `onAsk(event)` is told each new ask once it is written: the card router's hook (part 3c).
// - `wake: false` keeps only the stream, for a second project on the same engine; `held()` true (All stop) ends the
//   wake process and starts none until it is false again.
// - `now()` gives a Date; `restartMs`, `stuckMs` and `backstopMs` are for tests.
export function startEngineHost({
  engine, spawn, write, cursorFile, now = () => new Date(), backstopMs = BACKSTOP_MS, stuckMs = STUCK_MS, restartMs = RESTART_MS,
  wake = true, held = () => false, workOf = () => null, onAsk = () => {}, onTrouble = () => {},
} = {}) {
  if (!engine || typeof engine.follow !== 'function') throw new Error('The continuation host needs an engine that can be followed');
  const saved = readCursorFile(cursorFile);
  let cursor = saved.cursor;
  const written = new Set(saved.written);
  const runs = new Map();
  const resolved = new Set();
  let listener = onAsk;
  let stopped = false;
  const started = [];
  let wakeChild = null;
  let following = null;
  const timers = new Set();
  // The stream's waits before it starts again, ended at once by stop().
  const pauses = new Set();

  const later = (fn, ms) => {
    const timer = setTimeout(() => { timers.delete(timer); fn(); }, ms);
    timer.unref?.();
    timers.add(timer);
    return timer;
  };
  const trouble = (why) => { try { onTrouble(why); } catch { /* only said */ } };

  function keep() {
    try {
      saveCursorFile(cursorFile, { cursor, written: [...written].slice(-KEPT_KEYS) });
    } catch (error) {
      trouble(`The engine's cursor couldn't be kept: ${error instanceof Error ? error.message : 'unknown'}`);
    }
  }

  const known = (runId) => {
    const own = runs.get(runId);
    if (own) return own;
    try {
      const found = workOf(runId);
      return found && isText(found.work) ? found : null;
    } catch {
      return null;
    }
  };

  // Writes `data` once under `key`; true when it is written now or was before.
  async function once(key, kind, data) {
    if (written.has(key)) return true;
    try {
      await write(kind, data);
    } catch (error) {
      trouble(`A ${kind} record from the engine wasn't written: ${error instanceof Error ? error.message : 'unknown'}`);
      return false;
    }
    written.add(key);
    keep();
    return true;
  }

  async function runState(event, state, extra = {}) {
    const run = known(event.runId);
    if (!run || !isText(run.lane)) return;
    const key = `run:${event.runId}:${state}:${extra.key ?? ''}`;
    delete extra.key;
    await once(key, 'run', present({
      work: run.work, lane: run.lane, engine: engine.name ?? 'engine', runId: event.runId, state,
      branch: extra.branch ?? run.branch, pr: prNumber(extra.pr), outcome: extra.outcome,
    }));
  }

  async function handle(event) {
    if (!event || typeof event !== 'object') return;
    if (event.type === 'run-started') {
      if (isText(event.work) && isText(event.lane)) runs.set(event.runId, { work: event.work, lane: event.lane, branch: event.branch ?? null });
      await runState(event, 'started');
    } else if (event.type === 'ask') {
      if (resolved.has(event.id)) return;
      const work = event.work ?? event.labels?.work ?? known(event.runId)?.work;
      if (!isText(work)) return;
      const fresh = !written.has(`ask:${event.id}`);
      const done = await once(`ask:${event.id}`, 'ask', present({
        id: event.id, runId: event.runId, work, kind: event.kind,
        // An ask that gives no level comes at level 3, as one nobody recognises does (spec 8.1).
        level: [1, 2, 3, 4].includes(event.level) ? event.level : 3,
        options: (event.options ?? []).map((o) => present({ id: o.id, label: o.label })),
        topic: isText(event.topic) ? event.topic : undefined,
        recommend: isText(event.recommend) ? event.recommend : undefined,
        preview: isText(event.preview) || (event.preview && typeof event.preview === 'object') ? event.preview : undefined,
        setLine: isText(event.setLine) ? event.setLine : undefined,
      }));
      if (done) await runState(event, 'paused', { key: event.id });
      if (done && fresh) {
        try { listener(event); } catch { /* the hook's trouble is its own */ }
      }
    } else if (event.type === 'ask-resolved') {
      resolved.add(event.id);
      await runState(event, 'started', { key: event.id });
    } else if (event.type === 'run-ended') {
      await runState(event, 'ended', { branch: event.branch ?? undefined, pr: event.pr, outcome: isText(event.outcome) ? event.outcome : undefined });
    }
  }

  // --- the wake process ---
  function startWake() {
    if (stopped || !wake || wakeChild || held()) return;
    let command;
    let child;
    try {
      command = engine.wakeCommand();
      child = spawn(command.command, command.args, { env: command.env, stdio: 'ignore', detached: process.platform !== 'win32', windowsHide: true });
    } catch (error) {
      trouble(`The engine's continuation process couldn't be started: ${error instanceof Error ? error.message : 'unknown'}`);
      later(tend, restartMs);
      return;
    }
    const entry = { pid: child.pid, name: WAKE_NAME, command: [command.command, ...command.args].join(' '), startedAt: now().toISOString(), ended: false };
    started.push(entry);
    wakeChild = child;
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      entry.ended = true;
      if (wakeChild === child) wakeChild = null;
      if (!stopped) later(tend, restartMs);
    };
    child.once('exit', end);
    child.once('error', end);
    child.unref?.();
  }

  function endWake() {
    const child = wakeChild;
    if (!child) return;
    try { child.kill('SIGTERM'); } catch { /* it has gone */ }
  }

  // Brings the wake process in line with the hold: ended while held, started when not. Run again every restartMs.
  function tend() {
    if (stopped) return;
    if (held()) endWake();
    else startWake();
  }
  function watchHold() {
    if (stopped) return;
    tend();
    later(watchHold, restartMs);
  }

  // --- the stream ---
  async function follow() {
    while (!stopped) {
      const controller = new AbortController();
      following = controller;
      let quiet = null;
      const alive = () => {
        if (quiet) clearTimeout(quiet);
        quiet = setTimeout(() => controller.abort(), stuckMs);
        quiet.unref?.();
      };
      alive();
      try {
        const stream = engine.follow(cursor, {
          signal: controller.signal,
          onCursor: (next) => {
            alive();
            if (isText(next) && next !== cursor) {
              cursor = next;
              keep();
            }
          },
        });
        for await (const event of stream) {
          alive();
          await handle(event);
          if (stopped || controller.signal.aborted) break;
        }
      } catch (error) {
        if (!controller.signal.aborted) trouble(`The engine's stream stopped: ${error instanceof Error ? error.message : 'unknown'}`);
      } finally {
        if (quiet) clearTimeout(quiet);
      }
      if (stopped) break;
      await new Promise((resolve) => {
        pauses.add(resolve);
        later(() => { pauses.delete(resolve); resolve(); }, restartMs);
      });
    }
  }

  // --- the backstop: the open asks, read once ---
  async function backstop() {
    if (stopped || typeof engine.watch !== 'function') return;
    try {
      const { events = [] } = (await engine.watch(null)) ?? {};
      for (const event of events) if (event?.type === 'ask-resolved') resolved.add(event.id);
      for (const event of events) if (event?.type === 'ask' && !stopped) await handle(event);
    } catch (error) {
      trouble(`The engine's open asks couldn't be read: ${error instanceof Error ? error.message : 'unknown'}`);
    }
    if (!stopped) later(backstop, backstopMs);
  }

  watchHold();
  const followed = follow();
  later(backstop, backstopMs);

  return {
    // Ends the wake process and the stream, and starts nothing more.
    async stop() {
      stopped = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      for (const resolve of pauses) resolve();
      pauses.clear();
      endWake();
      following?.abort();
      await followed;
    },
    // Looks at the hold now (the helper calls it once All stop is set), rather than at the next turn.
    check() { tend(); },
    // The processes this host started that haven't ended, each with its pid, name and start time.
    processes() {
      return started.filter((p) => !p.ended && !stopped).map(({ pid, name, command, startedAt }) => ({ pid, name, command, startedAt }));
    },
    onAsk(fn) { listener = typeof fn === 'function' ? fn : () => {}; },
  };
}
