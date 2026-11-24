// scripts/agents/copilot/hook-timing.js
// Phase timings for the Copilot hook entry, to see where a hook run spends its time. Off unless the marker file
// `hook-timing` exists in the Wheelhouse home (`touch ~/.wheelhouse/hook-timing` to turn it on, delete it to turn it off);
// with no marker the cost of a run is one existsSync. When on, one JSON line per run is appended to
// `logs/hook-timing.jsonl` in the same home, and the file starts over past about 1 MB.
//
// A line holds the event, the tool name (preToolUse and postToolUse only), the process id, the process's start offset
// (how long the process had run when this module was read: `startedAgoMs` from performance.timeOrigin against Date.now,
// and `uptimeMs` from process.uptime()), the stdin byte count and whether stdin was a terminal, and `phases`: milliseconds
// from entry (this module's own start, the first thing the entry loads) at each phase, in the order they happen. It never
// holds the input, a tool's arguments, a path, an environment value, a token or a helper's body.
//
// Timing never changes a hook's answer or exit code: every call here catches its own errors.
import fs from 'node:fs';
import path from 'node:path';
import { wheelhouseHome } from '../../lib/paths.js';

export const MARKER = 'hook-timing';
export const LOG_FILE = 'hook-timing.jsonl';
export const LOG_CAP_BYTES = 1024 * 1024;
// The phases, in the order a run reaches them.
export const PHASES = Object.freeze(['modulesLoaded', 'stdinBegun', 'stdinEnded', 'projectRead', 'helperBegun', 'helperEnded', 'answerWritten', 'exit']);

const ENTERED = performance.now();
const STARTED_AGO_MS = Date.now() - performance.timeOrigin;
const UPTIME_MS = process.uptime() * 1000;

const NONE = Object.freeze({
  on: false,
  mark() {},
  note() {},
  counted: (stream) => stream,
  flush() {},
});

const tenths = (ms) => Math.round(ms * 10) / 10;
const nameOf = (value) => (typeof value === 'string' && /^[\w.:-]{1,80}$/.test(value) ? value : undefined);

// The recorder for one run of `event`: a recorder that does nothing when there is no marker. `home` is for tests.
export function startTiming(event, { home } = {}) {
  let folder;
  try {
    folder = home ?? wheelhouseHome();
    if (!fs.existsSync(path.join(folder, MARKER))) return NONE;
  } catch {
    return NONE;
  }
  const phases = {};
  const facts = { stdinBytes: 0, stdinTty: null, tool: undefined, helper: undefined };
  const safely = (fn) => (...args) => {
    try {
      return fn(...args);
    } catch {
      return undefined;
    }
  };
  return {
    on: true,
    // Records the first time `phase` is reached.
    mark: safely((phase) => {
      if (PHASES.includes(phase) && phases[phase] === undefined) phases[phase] = tenths(performance.now() - ENTERED);
    }),
    // Records a fact: `tool` (a name), `stdinTty`, or `helper` ('ok' or 'failed').
    note: safely((key, value) => {
      if (key === 'tool') facts.tool = nameOf(value);
      else if (key === 'stdinTty') facts.stdinTty = value === true;
      else if (key === 'helper') facts.helper = value === 'ok' ? 'ok' : 'failed';
    }),
    // The stream, counting the bytes it gives.
    counted: (stream) => (async function* counting() {
      for await (const chunk of stream) {
        try {
          facts.stdinBytes += Buffer.byteLength(chunk);
        } catch {
          // not counted
        }
        yield chunk;
      }
    }()),
    // Appends the line. Called once, after the last phase.
    flush: safely(() => {
      const ordered = {};
      for (const phase of PHASES) if (phases[phase] !== undefined) ordered[phase] = phases[phase];
      const line = {
        event: nameOf(event) ?? 'unknown',
        ...(facts.tool === undefined ? {} : { tool: facts.tool }),
        pid: process.pid,
        startedAgoMs: tenths(STARTED_AGO_MS),
        uptimeMs: tenths(UPTIME_MS),
        stdinBytes: facts.stdinBytes,
        stdinTty: facts.stdinTty,
        ...(facts.helper === undefined ? {} : { helper: facts.helper }),
        phases: ordered,
      };
      const file = path.join(folder, 'logs', LOG_FILE);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      let over = false;
      try {
        over = fs.statSync(file).size > LOG_CAP_BYTES;
      } catch {
        // no file yet
      }
      (over ? fs.writeFileSync : fs.appendFileSync)(file, `${JSON.stringify(line)}\n`);
    }),
  };
}
