// scripts/routing/column-ready.js
// Whether a Thoroughness level is ready (design section 14.6, "A column is offered only once it has passed" and
// "Settled for the builder"): the bar is the build loop's feature-session scenarios (BAR), run on the level's column,
// `with`, BAR_TRIALS trials each, every one passing on the same pins. Used by `npm run eval -- --ready`, which finds
// the records, and by the helper, which reads and checks them itself before it records `column-ready`. It lives here,
// not under scripts/eval, so the helper loads none of the evaluation's code.
// The pins come from the shell (PINS_VARIABLE), never from the repository. Nothing here starts a session.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isModelName } from '../gate/guardrails.js';
import { resolveRouting } from './thoroughness.js';

// The levels a readiness run is made for. Thorough runs on Balanced's models and is always ready; the premium model's
// pass is not made here, so no run names the premium model.
export const READY_LEVELS = Object.freeze(['lean', 'lightest']);
export const PINS_VARIABLE = 'WHEELHOUSE_EVAL_PINS';
// The feature-session scenarios of the bar, by the name their records carry: 27's is its bug leg, its main one.
export const BAR = Object.freeze(['20', '21', '22', '23', '27', '33', '34']);
export const BAR_TRIALS = 3;
// The pins a level's column runs on.
const PIN_NAMES = Object.freeze(['mostCapable', 'midSized']);

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const levelWord = (level) => level[0].toUpperCase() + level.slice(1);

// The pins from the shell: { mostCapable, midSized }, each a model name, and nothing else. Throws in plain words.
export function pinsFrom(env = process.env) {
  const usage = `A level's run needs ${PINS_VARIABLE} set in the shell: a JSON object naming the two models, {"mostCapable":"<model>","midSized":"<model>"}.`;
  const text = env[PINS_VARIABLE];
  if (typeof text !== 'string' || text.trim() === '') throw new Error(usage);
  let pins;
  try {
    pins = JSON.parse(text);
  } catch {
    throw new Error(`${PINS_VARIABLE} is not JSON. ${usage}`);
  }
  if (!isPlain(pins) || Object.keys(pins).length !== PIN_NAMES.length || !PIN_NAMES.every((name) => isModelName(pins[name]))) {
    throw new Error(`${PINS_VARIABLE} must name exactly the most capable and the mid-sized model, each a model name, and nothing else. ${usage}`);
  }
  return { mostCapable: pins.mostCapable, midSized: pins.midSized };
}

export const samePins = (a, b) => isPlain(a) && isPlain(b) && PIN_NAMES.every((name) => typeof a[name] === 'string' && a[name] === b[name]);

// The routing a level's run starts each feature session with, as the waker would at that level with the level ready
// (resolveRouting): its roles' models, efforts and fallbacks. Throws for a level that isn't Lean or Lightest.
export function levelRouting({ level, pins }) {
  if (!READY_LEVELS.includes(level)) throw new Error(`A level's run is made for Lean or Lightest only, not ${JSON.stringify(level)}`);
  if (!PIN_NAMES.every((name) => isModelName(pins?.[name]))) throw new Error('A level\'s run needs both pins, each a model name');
  const routing = resolveRouting({ config: { tiers: { pins: { mostCapable: pins.mostCapable, midSized: pins.midSized } } }, level, ready: [level] });
  if (routing.level !== level) throw new Error(`${levelWord(level)} could not be resolved on those pins`);
  return routing;
}

// The full hash of a record file's text, as the run record keeps it beside the trial.
export const fileHash = (text) => crypto.createHash('sha256').update(text).digest('hex');

// A trial record's name inside the evaluations folder: `<date>/<scenario>-with-<trial>.json`.
const RECORD_NAME = /^(\d{4}-\d{2}-\d{2})\/(\d+(?:-[a-z]+)?)-with-([1-9]\d*)\.json$/;

// The name a trial's file goes by in a column-ready record, or null when it isn't inside `evals` as one.
export function recordName(evals, file) {
  if (typeof file !== 'string' || file === '') return null;
  const relative = path.relative(evals, path.resolve(evals, file)).split(path.sep).join('/');
  return RECORD_NAME.test(relative) ? relative : null;
}

function readJson(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    return { text, json: JSON.parse(text) };
  } catch {
    return null;
  }
}

// Every trial of the bar at `level` on `pins` that a run record names, in the order run: { name, scenario, trial,
// pass, handled, why, sha256, run }. A run record of another level or other pins is passed over.
function barTrials(evals, level, pins) {
  const runs = path.join(evals, 'runs');
  let names = [];
  try {
    names = fs.readdirSync(runs).filter((n) => n.endsWith('.json')).sort();
  } catch { /* no runs yet */ }
  const found = [];
  for (const runName of names) {
    const record = readJson(path.join(runs, runName))?.json;
    if (!isPlain(record) || record.level !== level || !samePins(record.pins, pins) || !Array.isArray(record.runs)) continue;
    for (const entry of record.runs) {
      if (!isPlain(entry) || entry.variant !== 'with' || entry.level !== level || !samePins(entry.pins, pins)) continue;
      const scenario = entry.leg ? `${entry.id}-${entry.leg}` : String(entry.id);
      if (!BAR.includes(scenario)) continue;
      found.push({
        name: recordName(evals, entry.file), scenario, trial: entry.trial, pass: entry.pass === true, handled: entry.handled !== false,
        why: typeof entry.why === 'string' ? entry.why : '', sha256: entry.sha256 ?? null, run: runName,
      });
    }
  }
  return found;
}

// Two names for one model: equal, or one inside the other (an alias inside the full name the session reports).
const sameModel = (a, b) => typeof a === 'string' && typeof b === 'string' && a !== '' && b !== ''
  && (a.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(a.toLowerCase()));

// Why the trial record `name` doesn't stand as a pass of `scenario` at `level` on `pins`, or null when it does. The
// record is read here, not taken on the run record's word: its text must hash to what the run record kept, and the
// record itself must say it is that trial, at that level on those pins, passed, handled and finished, with the session
// started on the column's feature model, effort and fallback, and no model the premium pin names anywhere in it.
export function trialProblem({ evals, name, scenario, trial, sha256, level, pins, premium = null }) {
  const match = RECORD_NAME.exec(name ?? '');
  if (!match) return 'its record is not a with trial\'s file in the evaluations folder';
  const read = readJson(path.join(evals, ...name.split('/')));
  if (read === null) return 'its record cannot be read';
  if (typeof sha256 !== 'string' || fileHash(read.text) !== sha256) return 'its record is not the one its run saved';
  const r = read.json;
  if (!isPlain(r)) return 'its record is not a trial\'s';
  const own = r.leg ? `${r.id}-${r.leg}` : String(r.id);
  if (own !== scenario || match[2] !== scenario || r.variant !== 'with' || r.trial !== Number(match[3]) || (trial !== undefined && r.trial !== trial)) {
    return `its record is not trial ${match[3]} of scenario ${scenario}, with`;
  }
  if (r.level !== level) return `its record ran at ${r.level ?? 'no level'}, not ${level}`;
  if (!samePins(r.pins, pins)) return 'its record ran on other pins';
  if (r.pass !== true || r.handled !== true || r.exitCode !== 0) return 'its record does not say it passed';
  const events = Array.isArray(r.events) ? r.events : [];
  const result = events.findLast((e) => e?.type === 'result');
  if (result?.subtype !== 'success' || result.is_error === true) return 'its session did not finish';
  const feature = levelRouting({ level, pins }).roles.feature;
  if (r.model !== feature.model || r.effort !== feature.effort || (r.fallback ?? null) !== (feature.fallback ?? null)) {
    return `its session was not started on ${levelWord(level)}'s feature model, effort and fallback`;
  }
  const init = events.find((e) => e?.type === 'system' && e.subtype === 'init');
  if (!sameModel(init?.model, feature.model)) return `its session ran on ${init?.model ?? 'no model it named'}, not ${feature.model}`;
  if (typeof premium === 'string' && premium !== '') {
    const named = [r.model, r.fallback, init?.model, ...(Array.isArray(r.models) ? r.models : []), ...(Array.isArray(r.subagents) ? r.subagents.map((s) => s?.model) : []),
      ...Object.keys(result?.modelUsage ?? {})];
    if (named.some((m) => sameModel(m, premium))) return 'it names the premium model';
  }
  return null;
}

const trialWord = (t) => (Number.isInteger(t.trial) ? `trial ${t.trial}` : 'a trial');

// Whether `level` is ready on `pins` by the records under `evals`: { ok, records, gaps }. `records` are the passing
// trials' names, BAR_TRIALS of each scenario of the bar, oldest first; `gaps` says in plain words each scenario and
// trial that failed or is missing. A trial that failed anywhere at that level on those pins keeps the level not ready,
// however many passed after it. A trial that wasn't handled (the session never took its prompt in hand, or stopped
// short with nothing seen wrong) is neither: it may be run again, as the harness's own gate lets it. `given`, when
// passed, is the list of names a caller says stand: each must be one that stands, and only those count.
export function readiness({ evals, level, pins, premium = null, given = null }) {
  const gaps = [];
  if (!READY_LEVELS.includes(level)) return { ok: false, records: [], gaps: [`${JSON.stringify(level)} isn't a level a readiness run is made for: Lean or Lightest`] };
  if (!PIN_NAMES.every((n) => isModelName(pins?.[n]))) return { ok: false, records: [], gaps: ['the pins are not two model names'] };
  if (given !== null && (!Array.isArray(given) || !given.every((n) => typeof n === 'string'))) return { ok: false, records: [], gaps: ['the records are not a list of names'] };
  const trials = barTrials(evals, level, pins);
  const records = [];
  const offered = given === null ? null : new Set(given);
  if (offered !== null) {
    const known = new Set(trials.map((t) => t.name));
    for (const name of offered) if (!known.has(name)) gaps.push(`${name} is not a trial any run at ${levelWord(level)} on these pins saved`);
  }
  for (const scenario of BAR) {
    const own = trials.filter((t) => t.scenario === scenario);
    for (const t of own.filter((x) => x.handled && !x.pass)) gaps.push(`scenario ${scenario} ${trialWord(t)} failed${t.why ? ` (${t.why})` : ''}`);
    const standing = [];
    for (const t of own.filter((x) => x.pass && (offered === null || offered.has(x.name)))) {
      if (standing.some((s) => s.name === t.name)) continue;
      const problem = trialProblem({ evals, ...t, level, pins, premium });
      if (problem === null) standing.push(t);
      else gaps.push(`scenario ${scenario} ${trialWord(t)} doesn't stand: ${problem}`);
    }
    if (standing.length < BAR_TRIALS) {
      const lacking = BAR_TRIALS - standing.length;
      gaps.push(`scenario ${scenario}: ${standing.length} of ${BAR_TRIALS} passing trials, ${lacking} ${lacking === 1 ? 'trial is' : 'trials are'} missing`);
    }
    records.push(...standing.slice(0, BAR_TRIALS).map((t) => t.name));
  }
  if (gaps.length > 0) return { ok: false, records: [], gaps };
  return { ok: true, records: offered === null ? records : [...offered], gaps: [] };
}
