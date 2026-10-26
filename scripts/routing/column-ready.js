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

// The levels a readiness run is made for. Thorough runs on Balanced's models and is always ready. The premium model's
// pass (PREMIUM_LEVEL) is made here too, on Thorough's column with the premium model for design and critical work at
// `high` (design section 14.6, "What the Yes starts"), and only a run made for it may name the premium model.
export const READY_LEVELS = Object.freeze(['lean', 'lightest']);
export const PREMIUM_LEVEL = 'premium';
export const RUN_LEVELS = Object.freeze([...READY_LEVELS, PREMIUM_LEVEL]);
export const PINS_VARIABLE = 'WHEELHOUSE_EVAL_PINS';
// The feature-session scenarios of the bar, by the name their records carry: 27's is its bug leg, its main one.
export const BAR = Object.freeze(['20', '21', '22', '23', '27', '33', '34']);
export const BAR_TRIALS = 3;
// The pins a level's column runs on: the premium pass adds the premium model's.
const PIN_NAMES = Object.freeze(['mostCapable', 'midSized']);
const PREMIUM_PINS = Object.freeze([...PIN_NAMES, 'premium']);
const pinNamesOf = (level) => (level === PREMIUM_LEVEL ? PREMIUM_PINS : PIN_NAMES);

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const levelWord = (level) => (level === PREMIUM_LEVEL ? 'the premium model' : level[0].toUpperCase() + level.slice(1));

// The pins from the shell: { mostCapable, midSized }, each a model name, and nothing else; for the premium pass
// `premium` too. Throws in plain words.
export function pinsFrom(env = process.env, level = 'lean') {
  const names = pinNamesOf(level);
  const usage = level === PREMIUM_LEVEL
    ? `The premium model's run needs ${PINS_VARIABLE} set in the shell: a JSON object naming the three models, {"mostCapable":"<model>","midSized":"<model>","premium":"<model>"}.`
    : `A level's run needs ${PINS_VARIABLE} set in the shell: a JSON object naming the two models, {"mostCapable":"<model>","midSized":"<model>"}.`;
  const text = env[PINS_VARIABLE];
  if (typeof text !== 'string' || text.trim() === '') throw new Error(usage);
  let pins;
  try {
    pins = JSON.parse(text);
  } catch {
    throw new Error(`${PINS_VARIABLE} is not JSON. ${usage}`);
  }
  if (!isPlain(pins) || Object.keys(pins).length !== names.length || !names.every((name) => isModelName(pins[name]))) {
    throw new Error(`${PINS_VARIABLE} must name exactly ${level === PREMIUM_LEVEL ? 'the most capable, the mid-sized and the premium model' : 'the most capable and the mid-sized model'}, each a model name, and nothing else. ${usage}`);
  }
  if (level === PREMIUM_LEVEL && (pins.premium === pins.mostCapable || pins.premium === pins.midSized)) throw new Error(`${PINS_VARIABLE} names the premium model as another class's. ${usage}`);
  return Object.fromEntries(names.map((name) => [name, pins[name]]));
}

// Whether `a` and `b` name the same pins for `level`'s run (the most capable and mid-sized models; the premium's too
// for the premium pass).
export const samePins = (a, b, level = 'lean') => isPlain(a) && isPlain(b) && pinNamesOf(level).every((name) => typeof a[name] === 'string' && a[name] === b[name]);

// The routing a level's run starts each feature session with, as the waker would at that level with the level ready
// (resolveRouting): its roles' models, efforts and fallbacks. The premium pass's is Thorough's with the premium model
// in use, as the waker would give it once ready with paid credits allowed: the only billing under which it runs today.
// Throws for any other level.
export function levelRouting({ level, pins }) {
  if (!RUN_LEVELS.includes(level)) throw new Error(`A level's run is made for Lean, Lightest or the premium model only, not ${JSON.stringify(level)}`);
  if (!pinNamesOf(level).every((name) => isModelName(pins?.[name]))) throw new Error(`A level's run needs ${level === PREMIUM_LEVEL ? 'all three' : 'both'} pins, each a model name`);
  if (level === PREMIUM_LEVEL) {
    const routing = resolveRouting({ config: { tiers: { pins: { mostCapable: pins.mostCapable, midSized: pins.midSized, premium: pins.premium } } }, level: 'thorough', ready: ['thorough', 'premium'], premium: 'paid-too' });
    if (routing.roles.feature?.model !== pins.premium) throw new Error('The premium model could not be resolved on those pins');
    return routing;
  }
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

// The plugin's commit a run record says its run was made on (run.js's `commit`, the first twelve characters).
const COMMIT = /^[0-9a-f]{7,40}$/;

// Every trial of the bar at `level` on `pins` that a run record names, in the order run: { name, scenario, trial,
// pass, handled, why, sha256, run, commit }. A run record of another level or other pins is passed over, and so is
// one that names no commit: a counted run is one commit of the plugin, so a trial of no known commit counts for nothing.
// The premium pass's runs count only for the director's Yes they were made under (`yes`, its premium setting's id,
// which the run record names), so a failure under one Yes never counts against the next, and with `premiumOnly` only
// the premium pin is matched, so the configuration's other two pins moving can't hide a failure.
function barTrials(evals, level, pins, { yes = null, premiumOnly = false } = {}) {
  const premium = level === PREMIUM_LEVEL;
  if (premium && (typeof yes !== 'string' || yes === '')) return [];
  const same = (given) => (premium && premiumOnly ? isPlain(given) && given.premium === pins.premium : samePins(given, pins, level));
  const runs = path.join(evals, 'runs');
  let names = [];
  try {
    names = fs.readdirSync(runs).filter((n) => n.endsWith('.json')).sort();
  } catch { /* no runs yet */ }
  const found = [];
  for (const runName of names) {
    const record = readJson(path.join(runs, runName))?.json;
    if (!isPlain(record) || record.level !== level || !same(record.pins) || !Array.isArray(record.runs)) continue;
    if (premium && record.yes !== yes) continue;
    if (typeof record.commit !== 'string' || !COMMIT.test(record.commit)) continue;
    for (const entry of record.runs) {
      if (!isPlain(entry) || entry.variant !== 'with' || entry.level !== level || !same(entry.pins)) continue;
      const scenario = entry.leg ? `${entry.id}-${entry.leg}` : String(entry.id);
      if (!BAR.includes(scenario)) continue;
      found.push({
        name: recordName(evals, entry.file), scenario, trial: entry.trial, pass: entry.pass === true, handled: entry.handled !== false,
        why: typeof entry.why === 'string' ? entry.why : '', sha256: entry.sha256 ?? null, run: runName, commit: record.commit, pins: entry.pins,
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
  if (!samePins(r.pins, pins, level)) return 'its record ran on other pins';
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
  if (level !== PREMIUM_LEVEL && typeof premium === 'string' && premium !== '') {
    const named = [r.model, r.fallback, init?.model, ...(Array.isArray(r.models) ? r.models : []), ...(Array.isArray(r.subagents) ? r.subagents.map((s) => s?.model) : []),
      ...Object.keys(result?.modelUsage ?? {})];
    if (named.some((m) => sameModel(m, premium))) return 'it names the premium model';
  }
  return null;
}

const trialWord = (t) => (Number.isInteger(t.trial) ? `trial ${t.trial}` : 'a trial');

// The bar judged on the trials of one commit: { gaps, records }. A handled failure among them is a gap, however many
// passed beside it; each scenario needs BAR_TRIALS trials that stand (trialProblem). With `offered` (the names a caller
// gives), only those count, each must stand, and every one that stands is recorded; without, the first BAR_TRIALS of
// each scenario are.
function judgeCommit({ evals, trials, level, pins, premium, offered }) {
  const gaps = [];
  const records = [];
  for (const scenario of BAR) {
    const own = trials.filter((t) => t.scenario === scenario);
    for (const t of own.filter((x) => x.handled && !x.pass)) gaps.push(`scenario ${scenario} ${trialWord(t)} failed${t.why ? ` (${t.why})` : ''}`);
    const standing = [];
    for (const t of own.filter((x) => x.pass && (offered === null || offered.has(x.name)))) {
      if (standing.some((x) => x.name === t.name)) continue;
      const problem = trialProblem({ evals, ...t, level, pins, premium });
      if (problem === null) standing.push(t);
      else gaps.push(`scenario ${scenario} ${trialWord(t)} doesn't stand: ${problem}`);
    }
    if (standing.length < BAR_TRIALS) {
      const lacking = BAR_TRIALS - standing.length;
      gaps.push(`scenario ${scenario}: ${standing.length} of ${BAR_TRIALS} passing trials, ${lacking} ${lacking === 1 ? 'trial is' : 'trials are'} missing`);
    }
    records.push(...(offered === null ? standing.slice(0, BAR_TRIALS) : standing).map((t) => t.name));
  }
  if (offered !== null) {
    for (const name of offered) if (!records.includes(name)) gaps.push(`${name} is not a passing trial of the bar`);
  }
  return { gaps, records };
}

// The handled failures of the premium model's evaluation under the director's Yes `yes`, on any build, each in plain
// words ("scenario 22 trial 1 failed"), at most `most`: what a failed evaluation names. Only the premium pin is
// matched, so a run on other pins for the other two classes still counts. None when there are no runs. Each failure is
// read from its own record, which must be the one its run saved and say it is that trial and failed, on that premium
// model: a run record's word alone counts for nothing.
export function barFailures({ evals, pins, yes, most = 10 }) {
  if (!isModelName(pins?.premium)) return [];
  return barTrials(evals, PREMIUM_LEVEL, pins, { yes, premiumOnly: true })
    .filter((t) => t.handled && !t.pass && failedRecord(evals, t, PREMIUM_LEVEL, pins))
    .slice(0, most).map((t) => `scenario ${t.scenario} ${trialWord(t)} failed`);
}

// Whether a trial's record stands as a handled failure of its scenario at `level` on `pins`.
function failedRecord(evals, t, level, pins) {
  const match = RECORD_NAME.exec(t.name ?? '');
  if (!match) return false;
  const read = readJson(path.join(evals, ...t.name.split('/')));
  if (read === null || typeof t.sha256 !== 'string' || fileHash(read.text) !== t.sha256 || !isPlain(read.json)) return false;
  const r = read.json;
  const own = r.leg ? `${r.id}-${r.leg}` : String(r.id);
  return own === t.scenario && r.variant === 'with' && r.level === level && isPlain(r.pins) && r.pins.premium === pins.premium && r.pass === false && r.handled !== false;
}

// Whether `level` is ready on `pins` by the records under `evals`: { ok, commit, records, gaps }. One counted run is
// one commit of the plugin: the level is ready when, for one commit, every scenario of the bar has BAR_TRIALS passing
// `with` trials at that level on those pins, and no trial of the bar failed there. Trials of two commits never add
// up, and a failure on one commit doesn't block another's full pass. The newest commit that passes is taken; when none
// does, `gaps` are the newest commit's, in plain words, each scenario and trial that failed or is missing. A trial
// that wasn't handled (the session never took its prompt in hand, or stopped short with nothing seen wrong) is
// neither a pass nor a failure: it may be run again, as the harness's own gate lets it. `given`, when passed, is the
// list of names a caller says stand: all from one commit, each a passing trial of the bar that stands, and only those
// count and are recorded.
// For the premium pass, `yes` is the director's Yes the runs were made under: only those count.
export function readiness({ evals, level, pins, premium = null, given = null, yes = null }) {
  const no = (gaps) => ({ ok: false, commit: null, records: [], gaps });
  if (!RUN_LEVELS.includes(level)) return no([`${JSON.stringify(level)} isn't a level a readiness run is made for: Lean, Lightest or the premium model`]);
  if (!pinNamesOf(level).every((n) => isModelName(pins?.[n]))) return no([`the pins are not ${level === PREMIUM_LEVEL ? 'three' : 'two'} model names`]);
  if (given !== null && (!Array.isArray(given) || !given.every((n) => typeof n === 'string'))) return no(['the records are not a list of names']);
  const trials = barTrials(evals, level, pins, { yes });
  // The commits, by their latest run, oldest first.
  const commits = [...new Set([...trials].reverse().map((t) => t.commit))].reverse();
  const judged = (commit, offered) => {
    const { gaps, records } = judgeCommit({ evals, trials: trials.filter((t) => t.commit === commit), level, pins, premium, offered });
    return gaps.length === 0 ? { ok: true, commit, records, gaps: [] } : { ...no(gaps), commit };
  };
  if (given !== null) {
    const offered = new Set(given);
    const gaps = [];
    for (const name of offered) if (!trials.some((t) => t.name === name)) gaps.push(`${name} is not a trial any run at ${levelWord(level)} on these pins saved`);
    const from = [...new Set(trials.filter((t) => offered.has(t.name)).map((t) => t.commit))];
    if (from.length > 1) gaps.push(`the records come from more than one build of the plugin (${from.join(', ')}): a counted run is one build`);
    if (gaps.length > 0) return no(gaps);
    if (from.length === 0) return no(['the records are not named']);
    return judged(from[0], offered);
  }
  if (commits.length === 0) return no(judgeCommit({ evals, trials: [], level, pins, premium, offered: null }).gaps);
  for (const commit of [...commits].reverse()) {
    const found = judged(commit, null);
    if (found.ok) return found;
  }
  return judged(commits.at(-1), null);
}
