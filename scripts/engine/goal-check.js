// scripts/engine/goal-check.js
// A goal's checks (unattended goals design, sections 4.1 and 8). `goalCheckHost` is the helper's: asked for a check, it
// lists what to run from the sheet, runs it on the main line in a folder of its own with no model, and signs the result
// from the engine's record of an installed pack, so a run's own word counts for nothing. Nothing starts one but a
// caller's ask: `before` is the baseline the First Mate asks for (plan, choice 10), and `last` the end of the goal. A
// run that can't start or give a result leaves a record saying so, which reads as no pass. What it is asked is kept in
// `file`, so a helper started again picks up the run.
// Run as a script it is the step of `wheelhouse-goal-check`: it asks the helper for the order by the run's id and prints
// each check's result for the helper to read.
//   node scripts/engine/goal-check.js --run <run id> --artefacts <folder>
import fs from 'node:fs';
import path from 'node:path';
import { run as defaultRun } from '../lib/run.js';
import { helperClient } from '../host/helper-client.js';
import { withTicket } from './ticket.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { CHECK_MS, runArg, runDoneChecks, shell } from './done-check.js';
import { readSlices } from './feature.js';
import { checkSheet, sheetHash, signedSheetOf } from './goal.js';
import { GOAL_CHECK_HOURS, GOAL_CHECK_LANE, GOAL_CHECK_UNKNOWN_MINUTES, GOAL_WORK } from './goal-limits.js';
import { checkKey } from './order.js';

// The pack's one step, whose output is the result.
export const GOAL_STEP = 'checks';
const WHEN = ['before', 'last'];
const GOING = ['running', 'pending'];
const STOPPED = ['failed', 'cancelled'];
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

const merged = (views, work) => views?.reports?.[work]?.data?.outcome === 'merged';

// A merged piece's own checks: the sheet's list for it, a feature's slices, or the project's tests, as its run's order had.
function checksOfPiece({ line, views, testCommand, designOf }) {
  if (Array.isArray(line.done)) return line.done;
  if (views?.work?.[line.work]?.work?.data?.lane === 'feature') return readSlices(designOf(line.work)?.text).slices.flatMap((slice) => slice.done);
  return typeof testCommand === 'string' ? [{ command: testCommand, expect: 0 }] : [];
}

// Every check of a run, once each, in order: the sheet's own, and last of all each merged piece's. `sheet` is the signed
// sheet, so a narrowing can't take a piece that broke late out of sight. Throws on a feature whose design can't be read.
export function checksOfGoal({ sheet, when, views, testCommand, designOf = () => null }) {
  const pieces = when === 'last' ? sheet.pieces.filter((line) => merged(views, line.work)) : [];
  const seen = new Map();
  for (const check of [...sheet.done, ...pieces.flatMap((line) => checksOfPiece({ line, views, testCommand, designOf }))]) seen.set(checkKey(check), check);
  return [...seen.values()];
}

// The step's output as results for `order.done`, one each and in order, or null for anything else: the helper signs
// only what it asked.
export function resultsOf(text, order) {
  let said;
  try { said = JSON.parse(text); } catch { return null; }
  const given = said?.results;
  if (!Array.isArray(given) || given.length !== order.done.length) return null;
  const results = [];
  for (const [i, check] of order.done.entries()) {
    const result = given[i];
    if (!isPlain(result) || !isPlain(result.check) || checkKey(result.check) !== checkKey(check) || typeof result.ok !== 'boolean') return null;
    results.push({ check, ok: result.ok, ...(result.unrun === true ? { unrun: true } : {}) });
  }
  return results;
}

const passed = (results) => results.some((r) => r.ok === true) && results.every((r) => r.ok === true || r.walked === true);

// goalCheckHost({ file, write, engine, now, stopped, trusted, readViews, events, config, designOf, signedClean, folderAt, startRun })
//   -> { start({ goal, when, head? }), tick(), workOf(run id) }.
// - `write(kind, data)` a signed record; `engine` { inspect, outputs, act }; `trusted(record)` whether a run's pack is the
//   installed one; `readViews()` the project's views; `events()` its records;
// - `config()` { testCommand, prepare? }; `designOf(work)` a feature's approved design, { text }, or null;
// - `signedClean(head)` whether the project's own signed check passed clean at `head`;
// - `folderAt(head)` { ok, folder, head } or a refusal, its `head` the main line's when none is given;
// - `startRun({ order, folder })` { ok, runId } or a refusal.
export function goalCheckHost({ file, write, engine, now = () => new Date(), stopped = () => false, trusted = () => false, readViews = () => ({}), events = () => [], config = () => ({}), designOf = () => null, signedClean = async () => false, folderAt, startRun }) {
  const state = (() => {
    try {
      const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
      return isPlain(kept?.runs) ? kept : { runs: {} };
    } catch {
      return { runs: {} };
    }
  })();
  const keep = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, file);
  };

  const sign = ({ goal, hash, when, head }, results, said) => write('goal-check', {
    goal, hash, when, head, results, ok: said === undefined && passed(results), ...(said === undefined ? {} : { said }),
  });
  // Says the check didn't run, on the record, and to the caller.
  async function refuse(run, said) {
    try { await sign(run, [], said); } catch { /* the caller is told, and asks again */ }
    return { ok: false, refused: said };
  }

  // The sheet a check of `goal` runs: the latest recorded before it starts, the signed one last of all.
  function sheetFor(goal, when) {
    const views = readViews() ?? {};
    const signed = views.goals?.[goal];
    if (when === 'before') {
      if (signed !== undefined) return { refused: `The goal ${goal} was started, so it has no baseline to take` };
      const sheet = events().filter((e) => e.kind === 'goal' && e.data?.id === goal).at(-1)?.data.sheet;
      if (sheet === undefined) return { refused: `There is no sheet for the goal ${goal}` };
      const problem = checkSheet(sheet, { now: now() });
      return problem === null ? { sheet, hash: sheetHash(sheet), views } : { refused: problem };
    }
    const sheet = signed === undefined ? null : signedSheetOf(events(), goal, signed.hash);
    return sheet === null ? { refused: `The goal ${goal} isn't signed, so it has no last check` } : { sheet, hash: signed.hash, views };
  }

  async function begin({ goal, when, head = null }) {
    const found = sheetFor(goal, when);
    if (found.refused) return { ok: false, refused: found.refused };
    const { sheet, hash, views } = found;
    const under = Object.entries(state.runs).find(([, r]) => r.goal === goal && r.hash === hash && r.when === when);
    if (under) return { ok: true, runId: under[0], head: under[1].head };

    const run = { goal, hash, when, head };
    const { testCommand = null, prepare = null } = config() ?? {};
    let list;
    try { list = checksOfGoal({ sheet, when, views, testCommand, designOf }); } catch (error) { return refuse(run, `The checks of a piece couldn't be listed: ${error.message}`); }
    if (list.some((check) => check.test !== undefined) && typeof testCommand !== 'string') return refuse(run, 'A test check needs the project\'s test command, and this project has none yet');
    let place;
    try { place = await folderAt(head); } catch (error) { place = { ok: false, refused: error instanceof Error ? error.message : null }; }
    if (place?.ok !== true) return refuse(run, place?.refused ?? 'The folder for the goal\'s checks couldn\'t be made');
    run.head = place.head;

    // A page was walked at its piece, and the project's signed check stands for the test command, so neither runs here.
    const isTests = (check) => check.command === testCommand && check.expect === 0;
    const clean = list.some(isTests) && await Promise.resolve().then(() => signedClean(run.head)).catch(() => false) === true;
    const listed = list.flatMap((check) => (check.page !== undefined ? [{ check, ok: null, walked: true }] : clean && isTests(check) ? [{ check, ok: true, signed: true }] : []));
    const done = list.filter((check) => check.page === undefined && !(clean && isTests(check)));
    if (done.length === 0) {
      try { await sign(run, listed); } catch { return { ok: false, refused: 'The result of the goal\'s checks couldn\'t be written' }; }
      return { ok: true, runId: null, head: run.head };
    }

    const order = { v: 1, work: GOAL_WORK, lane: GOAL_CHECK_LANE, ...run, done, listed, testCommand, prepare };
    const got = await Promise.resolve().then(() => startRun({ order, folder: place.folder })).catch(() => null);
    if (got?.ok !== true || typeof got.runId !== 'string') return refuse(run, got?.refused ?? 'The goal\'s checks didn\'t start');
    state.runs[got.runId] = { ...run, done, listed, started: now().getTime() };
    keep();
    return { ok: true, runId: got.runId, head: run.head };
  }

  // One ask at a time, so a second can't start a run beside the first.
  let asking = Promise.resolve();
  function start({ goal, when, head } = {}) {
    if (!WHEN.includes(when)) return Promise.resolve({ ok: false, refused: 'A goal\'s checks run before it or last' });
    if (stopped()) return Promise.resolve({ ok: false, refused: 'All stop is on, so no check runs' });
    const going = asking.then(() => begin({ goal, when, head }));
    asking = going.catch(() => {});
    return going;
  }

  async function finish(runId, entry, results, said) {
    await sign(entry, [...entry.listed, ...results], said);
    delete state.runs[runId];
    keep();
  }

  const cancel = (runId, reason) => Promise.resolve().then(() => engine.act(runId, { cancel: { reason } })).catch(() => {});

  // One look at a run under way. A write that fails leaves it for the next look.
  async function look(runId, entry) {
    const age = now().getTime() - entry.started;
    const record = await Promise.resolve().then(() => engine.inspect(runId)).catch(() => null);
    const status = record?.status ?? 'unknown';
    if (status === 'unknown' || record?.unread === true) {
      if (age < GOAL_CHECK_UNKNOWN_MINUTES * MINUTE_MS) return;
      await cancel(runId, 'the engine lost sight of the goal\'s checks');
      await finish(runId, entry, [], 'The engine lost sight of the check run');
      return;
    }
    if (GOING.includes(status)) {
      if (age < GOAL_CHECK_HOURS * HOUR_MS) return;
      await cancel(runId, 'the goal\'s checks went past their limit');
      await finish(runId, entry, [], `The checks took longer than ${GOAL_CHECK_HOURS} hours`);
      return;
    }
    // No step here asks anything, so a run that stops to ask has lost its way.
    if (status === 'paused') {
      await cancel(runId, 'the goal\'s checks stopped');
      await finish(runId, entry, [], 'The check run stopped part of the way');
      return;
    }
    if (STOPPED.includes(status) || STOPPED.includes(record.outcome)) {
      await finish(runId, entry, [], `The check run ${record.outcome === 'cancelled' || status === 'cancelled' ? 'was stopped' : 'failed'}`);
      return;
    }
    const outputs = await Promise.resolve().then(() => engine.outputs(runId)).catch(() => null);
    const isOurs = await Promise.resolve().then(() => trusted(record)).catch(() => false);
    const results = isOurs === true && outputs ? resultsOf(outputs[GOAL_STEP], entry) : null;
    if (results === null) await finish(runId, entry, [], 'The check run gave no result that could be signed');
    else await finish(runId, entry, results);
  }

  let looking = null;
  function tick() {
    looking ??= (async () => {
      for (const [runId, entry] of Object.entries(state.runs)) await look(runId, entry).catch(() => {});
    })().finally(() => { looking = null; });
    return looking;
  }

  return {
    start,
    tick,
    // The run under its own work, on no piece and in no lane a `run` record takes.
    workOf: (runId) => (Object.hasOwn(state.runs, runId) ? { work: GOAL_WORK, lane: null, branch: null } : null),
  };
}

// What the step does with its order: readies the folder, runs the checks and prints each result. A check that fails is a
// result, so the step ends well; only a step that couldn't give one fails the run.
export async function runStep(order, { cwd, run = defaultRun, out, platform = process.platform }) {
  const unrun = order.done.map((check) => ({ check, ok: false, unrun: true }));
  const print = (results) => out(JSON.stringify({ results }));
  if (typeof order.prepare === 'string' && order.prepare !== '') {
    const { file, args, windowsVerbatimArguments } = shell(order.prepare, platform);
    let ready;
    try { ready = await run(file, args, { cwd, timeoutMs: CHECK_MS, windowsVerbatimArguments, limit: 256 * 1024 }); } catch { ready = null; }
    if (ready === null || ready.timedOut || ready.code !== 0) {
      print(unrun);
      return 0;
    }
  }
  const results = await runDoneChecks(order, { cwd, run, platform });
  print(results.map(({ check, ok, unrun: never }) => ({ check, ok, ...(never === true ? { unrun: true } : {}) })));
  return 0;
}

export async function main(argv = process.argv.slice(2), { client: given = helperClient({ timeout: 30000 }), cwd = process.cwd(), out = (line) => process.stdout.write(`${line}\n`), run, platform } = {}) {
  const client = withTicket(given, argv);
  const runId = runArg(argv);
  if (!runId) {
    out('usage: node scripts/engine/goal-check.js --run <run id> --artefacts <folder>');
    return 2;
  }
  const answer = await client.engine.order({ runId });
  if (answer?.ok !== true || answer.order?.lane !== GOAL_CHECK_LANE) {
    out(`fail: ${answer?.refused ?? 'the helper gave no goal check for this run'}`);
    return 1;
  }
  return runStep(answer.order, { cwd, run, out, platform });
}

if (startedAsScript(import.meta.url)) process.exitCode = await main();
