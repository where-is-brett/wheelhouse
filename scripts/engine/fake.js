// scripts/engine/fake.js
// An engine for tests: it plays back recorded EngineEvents (JSON lines, see tests/fixtures/engine) and runs nothing.
// A run plays until an ask, holds there until the ask is answered, then plays on. Every start and act is kept in
// `calls`. Cancelling, or stopAll, ends a running run with the outcome 'cancelled'; stopAll leaves a paused one
// paused, as Archon does. A run started with `order.ownerPid` (a test's) reports it from inspect, as a real engine
// reports the process that owns the run.
import fs from 'node:fs';
import path from 'node:path';
import { checkEvent } from './contract.js';

// The events in a recording's text, one JSON object a line. Blank lines are skipped; a line that isn't a
// well-formed event stops the read with the line's number.
export function readRecording(text) {
  const events = [];
  String(text).split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    let event;
    try { event = JSON.parse(line); } catch { throw new Error(`Recording line ${index + 1} isn't JSON`); }
    const problem = checkEvent(event);
    if (problem) throw new Error(`Recording line ${index + 1}: ${problem}`);
    events.push(event);
  });
  return events;
}

// Every `<name>.jsonl` in `dir`, as { name: events }.
export function loadRecordings(dir) {
  const recordings = {};
  for (const file of fs.readdirSync(dir).sort()) {
    if (file.endsWith('.jsonl')) recordings[path.basename(file, '.jsonl')] = readRecording(fs.readFileSync(path.join(dir, file), 'utf8'));
  }
  return recordings;
}

// `recordings` is { name: events }; an order picks one with `order.recording` (the only one, when there is one).
export function fakeEngine({ recordings = {}, now = () => new Date().toISOString() } = {}) {
  const stream = [];
  const runs = new Map();
  const calls = [];
  const answered = new Set();

  // Moves a run's recorded events onto the stream, up to and including the next ask. A run started with
  // `order.running` stops short of its first ask instead, and stays running there (a step under way).
  function play(run) {
    while (run.pending.length > 0 && !run.open) {
      if (run.holding && run.pending[0].type === 'ask') return;
      const event = { ...run.pending.shift(), runId: run.id };
      stream.push(event);
      if (event.type === 'ask') run.open = event;
      if (event.type === 'run-ended') { run.pending.length = 0; run.ended = event; }
    }
  }

  function end(run, outcome, extra = {}) {
    run.pending.length = 0;
    run.open = null;
    run.ended = { type: 'run-ended', runId: run.id, at: now(), outcome, branch: run.branch ?? null, pr: run.pr ?? null, ...extra };
    stream.push(run.ended);
  }

  return {
    name: 'fake',
    calls,

    // The continuation host's process: a stand-in, which a test's own `spawn` is handed and never runs.
    wakeCommand() { return { command: 'fake-engine-wake', args: ['--watch'], env: {} }; },

    // Whether a listed process is the engine's own: a test's processes whose command starts with `fake-engine`.
    ownsProcess(command) { return typeof command === 'string' && command.startsWith('fake-engine'); },

    health() { return { ok: true, findings: [] }; },

    start(order = {}) {
      calls.push({ call: 'start', order });
      const names = Object.keys(recordings);
      const name = order.recording ?? (names.length === 1 ? names[0] : undefined);
      if (!name || !recordings[name]) return { ok: false, refused: `There is no recording named ${name ?? '(none given)'}` };
      const id = `fake-${runs.size + 1}-${name}`;
      const run = { id, pending: recordings[name].map((e) => ({ ...e })), open: null, ended: null, branch: null, pr: null, steps: [], ownerPid: order.ownerPid ?? null, folder: order.folder ?? null, holding: order.running === true };
      runs.set(id, run);
      play(run);
      return { ok: true, runId: id };
    },

    watch(cursor) {
      const from = Number.parseInt(cursor ?? '0', 10);
      const start = Number.isInteger(from) && from >= 0 ? Math.min(from, stream.length) : 0;
      return { events: stream.slice(start), cursor: String(stream.length) };
    },

    // Yields what is on the stream after `cursor` and then finishes; a real engine's keeps waiting. `onCursor` is told
    // the cursor after each event once the caller has taken it, so a caller that keeps it resumes after that event.
    async *follow(cursor, { onCursor = () => {} } = {}) {
      const { events, cursor: end } = this.watch(cursor);
      const from = Number(end) - events.length;
      for (const [index, event] of events.entries()) {
        yield event;
        onCursor(String(from + index + 1));
      }
    },

    act(runId, action = {}) {
      calls.push({ call: 'act', runId, action });
      const run = runs.get(runId);
      if (!run) return { ok: false, refused: `There is no run ${runId}` };
      if (action.cancel) {
        if (run.ended) return { ok: false, refused: 'The run has already ended' };
        end(run, 'cancelled', { reason: action.cancel.reason ?? null });
        return { ok: true };
      }
      if (action.resume) return run.ended ? { ok: false, refused: 'The run has already ended' } : { ok: true };
      const answer = action.answer;
      if (!answer) return { ok: false, refused: 'Nothing to do: give an answer, a cancel or a resume' };
      if (answered.has(`${runId}:${answer.ask}`)) return { ok: false, refused: 'That ask has already been answered' };
      if (!run.open || run.open.id !== answer.ask) return { ok: false, refused: 'That ask is not waiting for an answer' };
      if (answer.choice !== undefined && !run.open.options.some((o) => o.id === answer.choice)) {
        return { ok: false, refused: `${answer.choice} is not one of the options` };
      }
      if (answer.choice === undefined && !answer.words) return { ok: false, refused: 'An answer needs a choice or some words' };
      answered.add(`${runId}:${answer.ask}`);
      const ask = run.open;
      run.open = null;
      const next = run.pending[0];
      const recorded = next?.type === 'ask-resolved' && next.id === ask.id ? run.pending.shift() : {};
      stream.push({ ...recorded, type: 'ask-resolved', runId, at: recorded.at ?? now(), id: ask.id, choice: answer.choice ?? null, words: answer.words ?? null });
      play(run);
      return { ok: true };
    },

    inspect(runId) {
      const run = runs.get(runId);
      if (!run) return { status: 'unknown', steps: [], branch: null, pr: null, digest: 'No such run' };
      const mine = stream.filter((e) => e.runId === runId);
      const steps = mine.filter((e) => e.type === 'step-finished').map((e) => ({
        id: e.step, role: e.role, provider: e.provider ?? null, model: e.model ?? null,
        tokens: e.spend.tokens, dollars: e.spend.dollars, minutes: e.minutes ?? null, source: e.spend.source,
      }));
      const started = mine.find((e) => e.type === 'run-started');
      const status = run.ended ? 'ended' : run.open ? 'paused' : 'running';
      return {
        status,
        ownerPid: run.ownerPid,
        steps,
        branch: run.ended?.branch ?? started?.branch ?? null,
        pr: run.ended?.pr ?? null,
        digest: `${steps.length} step${steps.length === 1 ? '' : 's'} finished; ${run.ended ? `ended: ${run.ended.outcome}` : status}`,
      };
    },

    // Cancels every running run, as Archon does: a run paused at an ask isn't cancelled, and is listed in `paused`.
    // `beforeCancel(runs)` is awaited with the running runs first, [{ id, folder }] (a test's `order.folder`).
    async stopAll(reason, { beforeCancel } = {}) {
      calls.push({ call: 'stopAll', reason });
      const live = [...runs.values()].filter((run) => !run.ended);
      const running = live.filter((run) => !run.open);
      if (beforeCancel) await beforeCancel(running.map((run) => ({ id: run.id, folder: run.folder })));
      for (const run of running) end(run, 'cancelled', { reason: reason ?? null });
      return { cancelled: running.map((run) => run.id), survivors: [], paused: live.filter((run) => run.open).map((run) => run.id) };
    },
  };
}
