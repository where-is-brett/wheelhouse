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
export function prNumber(pr) {
  if (Number.isInteger(pr) && pr > 0) return pr;
  const found = /(\d+)\/?$/.exec(typeof pr === 'string' ? pr : '');
  return found ? Number(found[1]) : undefined;
}
// The record's data with the fields that have no value left out.
const present = (data) => Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined && value !== null));

// startEngineHost({ engine, spawn, write, cursorFile, ... }) -> { stop(), check(), processes(), onAsk(fn) }.
// - `write(kind, data)` records a `run` or `ask`; a write that throws is tried again the next time the event is seen.
// - `workOf(runId)` -> { work, lane, branch? } | null: the work a run is for, from the project's own `run` records,
//   which the run's start wrote. A run this host doesn't know (another project's, on the same engine) is written
//   nothing, whatever an event's labels say; a label only cross-checks, and one naming other work is said, not written.
// - `resumes(runId)` how many times the record has the run resumed, so a resumed run's ending is written under that number;
//   `over(runId)` whether the record has the run's current leg ended, by any hand. A late answer writes nothing over one.
//   `settling(runId)` whether the record has the run resumed too lately to tell from the engine whether that leg has ended.
// - `onAsk(event)` is told each new ask once it is written: the card router's hook (part 3c).
// - `wake: false` keeps only the stream, for a second project on the same engine; `held()` true (All stop) ends the
//   wake process and starts none until it is false again.
// - `now()` gives a Date; `restartMs`, `stuckMs` and `backstopMs` are for tests.
export function startEngineHost({
  engine, spawn, write, cursorFile, now = () => new Date(), backstopMs = BACKSTOP_MS, stuckMs = STUCK_MS, restartMs = RESTART_MS,
  wake = true, held = () => false, workOf = () => null, resumes = () => 0, over = () => false, settling = () => false, prOf = () => null, onAsk = () => {}, onTrouble = () => {},
} = {}) {
  if (!engine || typeof engine.follow !== 'function') throw new Error('The continuation host needs an engine that can be followed');
  const saved = readCursorFile(cursorFile);
  let cursor = saved.cursor;
  const written = new Set(saved.written);
  // The writes under way, by key, so the stream and the backstop bringing one event at once write it once.
  const writing = new Map();
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

  // The project's own run, or null. An event whose label names other work than the record is said and left.
  const known = (event) => {
    let found = null;
    try { found = workOf(event.runId); } catch { found = null; }
    if (!found || !isText(found.work)) return null;
    const label = event.work ?? event.labels?.work;
    if (isText(label) && label !== found.work) {
      trouble(`The engine's run ${event.runId} says it is for ${label}, but the record has it for ${found.work}; nothing was written`);
      return null;
    }
    return found;
  };

  // Writes `data` once under `key`: 'now' to the caller whose write it is, 'before' when it was written earlier or by
  // a caller whose write was under way, false when the write failed.
  async function once(key, kind, data) {
    if (written.has(key)) return 'before';
    const going = writing.get(key);
    if (going) return (await going) ? 'before' : false;
    const attempt = (async () => {
      try {
        await write(kind, data);
      } catch (error) {
        trouble(`A ${kind} record from the engine wasn't written: ${error instanceof Error ? error.message : 'unknown'}`);
        return false;
      }
      written.add(key);
      keep();
      return true;
    })();
    writing.set(key, attempt);
    try {
      return (await attempt) ? 'now' : false;
    } finally {
      writing.delete(key);
    }
  }

  // The record's word on a run, read safely: neither can hold up the stream.
  const resumesNow = (runId) => {
    try {
      const n = resumes(runId);
      return Number.isInteger(n) && n > 0 ? n : 0;
    } catch { return 0; }
  };
  const overNow = (runId) => {
    try { return over(runId) === true; } catch { return false; }
  };
  const settlingNow = (runId) => {
    try { return settling(runId) === true; } catch { return false; }
  };
  const endKey = (runId, resume) => `run:${runId}:ended:${resume > 0 ? resume : ''}`;

  async function runState(event, state, extra = {}) {
    const run = known(event);
    if (!run || !isText(run.lane)) return undefined;
    // A leg that has ended stays ended: only a resume, which the runner writes, brings a run back.
    if (state !== 'ended' && (written.has(endKey(event.runId, resumesNow(event.runId))) || overNow(event.runId))) return undefined;
    const key = `run:${event.runId}:${state}:${extra.key ?? ''}`;
    delete extra.key;
    return once(key, 'run', present({
      work: run.work, lane: run.lane, engine: engine.name ?? 'engine', runId: event.runId, state,
      branch: extra.branch ?? run.branch, pr: prNumber(extra.pr) ?? (state === 'ended' ? prNumber(prOf(event.runId)) : undefined), outcome: extra.outcome,
      resume: extra.resume, failure: extra.failure, step: extra.step,
    }));
  }

  // A `run-ended` is a report, not the state (check 93): the stream can replay an old one once the run has resumed, or even
  // finished. So each line is handled once, by its cursor, a run the engine reads as going wrote no ending here, and what is
  // written is what the engine reads now. An engine that can't be read leaves the event's word, since an ending mustn't be lost.
  async function ended(event) {
    const line = isText(event.cursor) ? `ended:${event.cursor}` : null;
    if (line && written.has(line)) return;
    let record = null;
    try { record = (await engine.inspect?.(event.runId)) ?? null; } catch { record = null; }
    const unread = record === null || record.unread === true;
    if (!unread && (record.status === 'running' || record.status === 'paused')) {
      if (line) { written.add(line); keep(); }
      return;
    }
    // A resume is detached, so the engine reads as over for a moment after it, and a line from before it can come only now.
    // Neither ends a leg just begun: the runner's look at the run writes an ending that is real.
    if (settlingNow(event.runId)) {
      if (line) { written.add(line); keep(); }
      return;
    }
    const resume = resumesNow(event.runId);
    const outcome = (!unread && isText(record.outcome) ? record.outcome : null) ?? (isText(event.outcome) ? event.outcome : undefined);
    const failure = outcome === 'failed' ? [unread ? null : record.failure, event.failure, 'other'].find(isText) : undefined;
    const step = outcome === 'failed' ? [unread ? null : record.failedStep, event.failedAt].find(isText) : undefined;
    // A resumed leg the runner has already ended, on its look at the run.
    const done = resume > 0 && overNow(event.runId) ? 'before' : await runState(event, 'ended', {
      key: resume > 0 ? resume : undefined, resume: resume > 0 ? resume : undefined, branch: event.branch ?? undefined, pr: event.pr, outcome, failure, step,
    });
    if (line && done !== false) { written.add(line); keep(); }
  }

  async function handle(event) {
    if (!event || typeof event !== 'object') return;
    // A run's start is recorded by what started it (the record is how a run is known), so the host writes nothing for it.
    if (event.type === 'ask') {
      if (resolved.has(event.id)) return;
      const work = known(event)?.work;
      if (!isText(work)) return;
      const done = await once(`ask:${event.id}`, 'ask', present({
        id: event.id, runId: event.runId, work, kind: event.kind,
        // An ask that gives no level comes at level 3, as one nobody recognises does (spec 8.1).
        level: [1, 2, 3, 4].includes(event.level) ? event.level : 3,
        options: (event.options ?? []).map((o) => present({ id: o.id, label: o.label })),
        topic: isText(event.topic) ? event.topic : undefined,
        recommend: isText(event.recommend) ? event.recommend : undefined,
        preview: isText(event.preview) || (event.preview && typeof event.preview === 'object') ? event.preview : undefined,
        setLine: isText(event.setLine) ? event.setLine : undefined,
        resetAt: isText(event.resetAt) ? event.resetAt : undefined,
      }));
      if (done) await runState(event, 'paused', { key: event.id });
      if (done === 'now') {
        try { listener(event); } catch { /* the hook's trouble is its own */ }
      }
    } else if (event.type === 'ask-resolved') {
      resolved.add(event.id);
      await runState(event, 'started', { key: event.id });
    } else if (event.type === 'run-ended') {
      await ended(event);
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
