// scripts/eval/run.js
// Runs evaluation scenarios from the suites under tests/eval/ (one folder each:
// build-loop, front-desk, main, mod, real-use and any added later) in real
// headless Claude Code sessions. Each run is a real session that costs tokens,
// so it is run on purpose, never from `npm test`.
// Usage: npm run eval -- <id…> [--variant with|without] [--trials n] [--agent <name>]
//        npm run eval -- --all | --suite <name> [--variant with|without] [--trials n] [--agent <name>]
//        npm run eval -- --again
// A scenario is a file `<number>-<name>.js` in a suite; anything else there is
// not one. A number names one scenario in one suite. A scenario whose pass has
// more than one leg has a file per leg in its suite, each named `<number>-…`;
// its number runs every leg, and `<number>-<leg>` (27-route) runs that leg
// alone, its records named `<number>-<leg>-<variant>-<n>.json`.
// Writes <home>/.wheelhouse-evals/<date>/<id>-<variant>-<n>.json for each run,
// and prints `<id> <variant>: pass|fail (<why>) <tokens>`. Each invocation also
// writes a run record, <home>/.wheelhouse-evals/runs/<time>.json, naming every
// trial it ran, its result and its file. `--all` runs every scenario in every
// suite in number order and the end-to-end tests that cover the rest; `--again`
// reads the latest run record and runs TRIALS_AGAIN more trials of each
// scenario it marked, only in the variant that marked it. After either, the
// report (scripts/eval/summary.js) is printed and kept beside the run record,
// as <time>.md. The build loop's scenarios (20 to 35) are in tests/eval/build-loop/,
// the front desk's (1 to 19) in tests/eval/front-desk/ and the mod's (36 and 37) in
// tests/eval/mod/, a file's number read without its leading zero (01-…).
// `--agent <name>` runs the sessions on that agent, through its adapter's evaluation runner
// (adapterFor(name).evalRunner.run); without it they run through runSession, as they always have.
// A scenario whose `agents` lists the agents it runs on is left out of a run on any other (no
// `agents`: it runs on every agent), never imported, and no row of its report; only its own variants
// run. A scenario named on the command line that is not run, or not in the one variant asked for,
// makes the run fail. A run on a named agent counts the scenarios that agent names as its own among
// the designed set its report accounts for.
// A scenario with `needsSandbox: true` (15 and 18) is checked after its set-up and before its
// prompt, in both variants (checkSandbox): the session's settings keep it in the sandbox and a probe
// session can't read a file the sandbox denies, else the trial is `fail (no sandbox)` and not
// handled. On Windows such a trial is not run: `not run (no sandbox, check 10)`.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, runScenario, runSession, scenarioName, sessionSettings, today, totalUsageOf } from './harness.js';
import { adapterFor } from '../agents/index.js';
import { callsOf } from './feature-project.js';
import { DEFAULT_AGENT, DESIGNED, E2E_DIR, EVAL_ROOT, REPO, SCENARIO_FILE, coveredScenarios, declaredAgents, runsOnAgent, shownPath, summarise, summaryText } from './summary.js';
import { run as runProgram } from '../lib/run.js';
import { startedAsScript } from '../lib/started-as-script.js';

export { EVAL_ROOT };

// The longest the end-to-end tests may take, each file.
const E2E_TIMEOUT_MS = 30 * 60 * 1000;

// ----------------------------------------------------------- finding scenarios

// The suites under `root`: its folders, by name.
export function suitesIn(root = EVAL_ROOT) {
  try {
    return fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch {
    return [];
  }
}

// Every scenario file under `root`, in number order, then suite and name: { number, suite, file }.
function scenarioFiles(root) {
  const found = [];
  for (const suite of suitesIn(root)) {
    for (const name of fs.readdirSync(path.join(root, suite)).sort()) {
      const match = SCENARIO_FILE.exec(name);
      if (match) found.push({ number: Number(match[1]), suite, file: path.join(root, suite, name) });
    }
  }
  return found.sort((a, b) => a.number - b.number || a.suite.localeCompare(b.suite) || a.file.localeCompare(b.file));
}

// The files of scenario `number`, all in one suite; a number in two suites is refused.
function filesOfNumber(number, root, shown) {
  const files = scenarioFiles(root).filter((entry) => entry.number === number);
  if (!files.length) throw new Error(`No scenario ${shown} in ${path.relative(process.cwd(), root) || root}`);
  const suites = [...new Set(files.map((entry) => entry.suite))];
  if (suites.length > 1) throw new Error(`Scenario ${number} is in two suites: ${suites.join(', ')}`);
  return files.map((entry) => entry.file);
}

// The leg a scenario file declares (its module's `leg: '<name>'`), read from its text so the
// file need not be loaded to be found; loadScenarios checks it against the module.
function declaredLeg(file) {
  return /^\s*leg:\s*['"]([a-z]+)['"]/m.exec(fs.readFileSync(file, 'utf8'))?.[1] ?? null;
}

function parseId(id) {
  const match = /^(\d+)(?:-([a-z]+))?$/.exec(String(id));
  if (!match) throw new Error(`No scenario ${id}: a scenario is named by its number, or a number and a leg (27-route)`);
  return { number: Number(match[1]), leg: match[2] ?? null };
}

// Every file of the scenario `id` names, in name order: each leg's of a number, or the one leg's
// file of a leg id (27-route).
export function findScenarioFiles(id, { root = EVAL_ROOT } = {}) {
  const { number, leg } = parseId(id);
  const files = filesOfNumber(number, root, id);
  if (leg === null) return files;
  const own = files.filter((file) => declaredLeg(file) === leg);
  if (!own.length) throw new Error(`No scenario ${id}: scenario ${number} has no leg ${leg}`);
  return own;
}

// The one file of scenario `id` in tests/eval/*/: the file of a leg id, or a number's first leg.
export function findScenario(id, { root = EVAL_ROOT } = {}) {
  return findScenarioFiles(id, { root })[0];
}

// Every leg of scenario `id` (a number), or the one leg `id` names (27-route), with its file and
// suite, in file order. With `agent`, only the files that declare they run on it (declaredAgents)
// are loaded; the others are never imported.
async function loadEntries(id, { root = EVAL_ROOT, agent = null } = {}) {
  const { leg } = parseId(id);
  const entries = [];
  for (const file of findScenarioFiles(id, { root })) {
    const declared = declaredAgents(file);
    if (agent !== null && !runsOnAgent(declared, agent)) continue;
    const scenario = (await import(pathToFileURL(file).href)).default;
    // The agents read from the text must be the module's own, or a file could be passed over wrongly.
    if (JSON.stringify(declared) !== JSON.stringify(Array.isArray(scenario?.agents) ? scenario.agents : null)) {
      throw new Error(`${path.basename(file)} declares its agents in a form that can't be read from its text: write \`agents: ['…']\` on a line of its own`);
    }
    if (leg !== null && scenario?.leg !== leg) throw new Error(`${file} does not export leg ${leg} of scenario ${id}`);
    // A file copied from another and left with its id would join that scenario's row.
    const number = Number(SCENARIO_FILE.exec(path.basename(file))[1]);
    if (scenario?.id !== number) throw new Error(`${path.basename(file)} says it is scenario ${scenario?.id}, but its file is numbered ${number}`);
    entries.push({ scenario, file, suite: path.basename(path.dirname(file)) });
  }
  return entries;
}

// Every leg of scenario `id` (a number), or the one leg `id` names (27-route), in file order.
export async function loadScenarios(id, options = {}) {
  return (await loadEntries(id, options)).map((entry) => entry.scenario);
}

// The scenario a number names (its first leg, when it has more than one).
export async function loadScenario(id, options = {}) {
  return (await loadScenarios(id, options))[0];
}

// Every scenario number in the suites under `root` (or in one suite), in number order. A number
// in two suites is refused before anything runs.
function numbersIn(root, suite = null) {
  const files = scenarioFiles(root);
  const numbers = [...new Set(files.filter((entry) => suite === null || entry.suite === suite).map((entry) => entry.number))];
  for (const number of numbers) filesOfNumber(number, root, number);
  return numbers;
}

// ------------------------------------------------------------ end-to-end tests

// Every test in a `node --test --test-reporter=tap` report, a test inside a `describe` (indented)
// included: { test, pass, skipped?, nested? }. A skipped test is no pass.
export function parseTap(text) {
  const results = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^(\s*)(not )?ok \d+ - ((?:\\.|[^\\])*?)(?: # (SKIP|TODO)\b.*)?$/.exec(line);
    if (!match) continue;
    const test = match[3].replace(/\\(.)/g, (_, c) => ({ n: '\n', t: '\t', r: '\r' }[c] ?? c));
    const skipped = match[4] !== undefined;
    results.push({ test, pass: !match[2] && !skipped, ...(skipped ? { skipped: true } : {}), ...(match[1] ? { nested: true } : {}) });
  }
  return results;
}

// Runs each end-to-end test file in its own `node --test`, as `npm test` runs it, and reads each
// top-level test's result: { file, test, pass }. A file that could not run gives no results, so
// its tests read as not run.
export async function runEndToEnd(files, { cwd = REPO } = {}) {
  const results = [];
  for (const file of files) {
    const answer = await runProgram(process.execPath, ['--test', '--test-reporter=tap', '--test-timeout=480000', path.resolve(cwd, file)], {
      cwd, input: '', timeoutMs: E2E_TIMEOUT_MS,
    });
    for (const result of parseTap(answer.stdout)) results.push({ file, test: result.test, pass: result.pass, ...(result.nested ? { nested: true } : {}) });
  }
  return results;
}

// ---------------------------------------------------------------- run records

function pluginVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(REPO, '.claude-plugin', 'plugin.json'), 'utf8')).version ?? null;
  } catch {
    return null;
  }
}

async function buildCommit() {
  try {
    const answer = await runProgram('git', ['rev-parse', 'HEAD'], { cwd: REPO, input: '' });
    return answer.code === 0 ? answer.stdout.trim().slice(0, 12) : null;
  } catch {
    return null;
  }
}

const runsDir = (home) => path.join(home, '.wheelhouse-evals', 'runs');
const stampOf = (at) => at.toISOString().replace(/[:.]/g, '-');

// The run record --again reads: the newest whose run was --all or --again, else the newest of
// any kind; or null. { file, record, newer }: `newer` is the newest record of another kind made
// after it (a check of one scenario between --all and --again, say), or null.
export function latestRunRecord(home = os.homedir()) {
  let names = [];
  try {
    names = fs.readdirSync(runsDir(home)).filter((name) => name.endsWith('.json')).sort();
  } catch {
    return null;
  }
  if (!names.length) return null;
  const read = (name) => {
    const file = path.join(runsDir(home), name);
    try {
      return { file, record: JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch {
      return null;
    }
  };
  const records = names.map(read).filter(Boolean);
  if (!records.length) return null;
  const whole = records.findLast((r) => r.record.how === 'all' || r.record.how === 'again');
  const chosen = whole ?? records.at(-1);
  const newer = records.at(-1) === chosen ? null : records.at(-1).file;
  return { ...chosen, newer };
}

// The highest trial already numbered for `name` in `variant`: in the run record's trials, and in
// the day's folder, so a trial run again writes over nothing.
function lastTrial(home, date, name, variant, runs) {
  let last = 0;
  for (const run of runs) {
    if (scenarioName(run) === name && run.variant === variant) last = Math.max(last, run.trial);
  }
  const pattern = new RegExp(`^${name.replace(/[-]/g, '\\-')}-${variant}-(\\d+)\\.json$`);
  try {
    for (const file of fs.readdirSync(path.join(home, '.wheelhouse-evals', date))) {
      const match = pattern.exec(file);
      if (match) last = Math.max(last, Number(match[1]));
    }
  } catch { /* no runs yet that day */ }
  return last;
}

// ------------------------------------------------------------------ the sandbox

// What a trial is recorded as when the sandbox its scenario needs (`needsSandbox: true`) is not
// there, and what a Windows trial of such a scenario is recorded as (check 10: the sandbox does
// not run on native Windows). A guard that held only because nothing was sandboxed proves nothing
// (Review Focus 4, rulings E29 and E30).
export const NO_SANDBOX = 'no sandbox';
export const NOT_RUN_NO_SANDBOX = 'no sandbox, check 10';

const parsedFile = (file) => {
  try {
    return { settings: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (error) {
    return error?.code === 'ENOENT' ? { settings: null } : { problem: `${path.basename(file)} cannot be read` };
  }
};

// Why the settings a session would run under do not keep it in the sandbox, or []: the settings
// runSession will pass (sessionSettings) must switch the sandbox on and allow no command outside
// it, and neither of the scratch project's own settings files may undo that.
export function sandboxSettingsProblems({ dir, context = {} }) {
  const problems = [];
  let own;
  try {
    own = sessionSettings({ socket: context.helper?.address ?? null, readable: context.readable ?? [], writable: context.writable ?? [] });
  } catch (error) {
    return [`the session's settings cannot be made: ${error.message}`];
  }
  if (own.sandbox?.enabled !== true) problems.push('the session\'s settings do not switch the sandbox on');
  if (own.sandbox?.allowUnsandboxedCommands !== false) problems.push('the session\'s settings do not forbid commands outside the sandbox');
  for (const name of ['settings.json', 'settings.local.json']) {
    const { settings, problem } = parsedFile(path.join(dir, '.claude', name));
    if (problem) problems.push(`the project's ${problem}`);
    if (settings?.sandbox?.enabled === false) problems.push(`the project's ${name} switches the sandbox off`);
    if (settings?.sandbox?.allowUnsandboxedCommands === true) problems.push(`the project's ${name} lets a command run outside the sandbox`);
  }
  return problems;
}

const evalsFolder = () => path.join(os.homedir(), '.wheelhouse-evals');
const insideFolder = (folder, file) => {
  const relative = path.relative(folder, file);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

// What an operating-system refusal of a read looks like in a command's output. A refusal by a
// permission prompt or a rule says something else, and shows nothing of the sandbox.
export const OS_REFUSAL = /operation not permitted|permission denied|EPERM|EACCES|not permitted/i;

// The probe: a fresh 32-hex canary in a file under the evaluations folder, which the session's
// sandbox keeps commands from reading (EVAL_DENY_READ), and beside it, in a folder the sandbox
// leaves readable, a control file with a second fresh value. A short session through `runner` with
// the settings the scenario's own session gets is asked to `cat` both, one command each. Resolves
// with { ran, controlRead, refused, leaked, usage }: whether the session ran the `cat` of the
// canary file, whether the control `cat` ran and printed its value (so a command can run and show
// a file at all), whether the canary file's `cat` failed with an operating-system refusal (not a
// prompt or a rule), and whether the canary is in the events. Never reads the real ~/.wheelhouse.
// `denied` is the folder the sandbox denies, for tests.
export async function sandboxProbe({ dir, scenario, context = {}, home = os.homedir(), runner = runSession, denied = evalsFolder(), random = () => crypto.randomBytes(16).toString('hex') }) {
  const canary = random();
  const control = random();
  const evals = path.join(home, '.wheelhouse-evals');
  fs.mkdirSync(evals, { recursive: true });
  const folder = fs.mkdtempSync(path.join(evals, 'probe-'));
  const readable = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-probe-'));
  const file = path.join(folder, 'canary.txt');
  const controlFile = path.join(readable, 'control.txt');
  try {
    // The sandbox denies the real evaluations folder; one anywhere else proves nothing.
    if (!insideFolder(denied, file)) return { ran: false, controlRead: false, refused: false, leaked: false, usage: { input: 0, output: 0 }, unusable: 'the probe file is not under the evaluations folder the sandbox denies' };
    fs.writeFileSync(file, `${canary}\n`);
    fs.writeFileSync(controlFile, `${control}\n`);
    const ran = await runner({
      dir,
      prompt: `Run these two commands, one at a time, and tell me what each prints: cat "${controlFile}" and then cat "${file}"`,
      pluginDirs: [],
      permissionMode: 'acceptEdits',
      ...(scenario.model ? { model: scenario.model } : {}),
      maxTurns: 6,
      ...(context.env ? { env: context.env } : {}),
      ...(typeof context.helper?.address === 'string' ? { socket: context.helper.address } : {}),
      ...(context.readable ? { readable: context.readable } : {}),
      ...(context.writable ? { writable: context.writable } : {}),
      timeoutMs: 5 * 60 * 1000,
    });
    const events = ran.events ?? [];
    const calls = callsOf(events).filter((call) => call.name === 'Bash');
    const catOf = (name) => calls.find((call) => String(call.input.command ?? '').includes(name));
    const probeCall = catOf(file);
    const controlCall = catOf(controlFile);
    return {
      ran: probeCall !== undefined,
      controlRead: controlCall?.result != null && controlCall.result.isError !== true && controlCall.result.text.includes(control),
      refused: probeCall?.result != null && probeCall.result.isError === true && OS_REFUSAL.test(probeCall.result.text),
      leaked: JSON.stringify(events).includes(canary),
      usage: totalUsageOf(events),
    };
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
    fs.rmSync(readable, { recursive: true, force: true });
  }
}

// The check for a scenario that needs the sandbox (ruling E29), made after its set-up and before
// its prompt, in both variants: the effective settings keep the session in the sandbox, and a probe
// session can't read a file the sandbox denies. Resolves with null when both hold, or with { why,
// usage, evidence } for a trial recorded `fail (no sandbox)` that was not handled. `probe` is
// injectable, so a test starts no session.
export async function checkSandbox({ scenario, variant, dir, context = {}, runner = runSession, home = os.homedir() }, { probe = sandboxProbe } = {}) {
  const problems = sandboxSettingsProblems({ dir, context });
  if (problems.length > 0) {
    return { why: `${NO_SANDBOX}: ${problems.join('; ')}`, usage: { input: 0, output: 0 }, evidence: { settings: problems } };
  }
  const found = await probe({ scenario, variant, dir, context, runner, home });
  const reasons = [];
  if (found.unusable) reasons.push(found.unusable);
  else if (found.ran !== true) reasons.push('the probe session did not run the command');
  else {
    if (found.controlRead !== true) reasons.push('the probe could not read its control file, so a refusal would show nothing');
    if (found.refused !== true) reasons.push('the probe\'s cat of the denied file was not refused by the operating system');
  }
  if (found.leaked === true) reasons.push('a command read a file the sandbox should deny: the probe\'s canary is in its events');
  if (reasons.length > 0) return { why: `${NO_SANDBOX}: ${reasons.join('; ')}`, usage: found.usage ?? { input: 0, output: 0 }, evidence: { probe: { ran: found.ran === true, controlRead: found.controlRead === true, refused: found.refused === true, leaked: found.leaked === true } } };
  return null;
}

// The `beforePrompt` runScenario is given for scenarios that need the sandbox.
export const sandboxGate = ({ probe } = {}) => (args) => checkSandbox(args, probe ? { probe } : {});

// ------------------------------------------------------------------- the run

// Runs what `argv` asks for. `root` holds the suites, `home` the evaluations folder, `run` runs one
// trial (runScenario), `endToEnd` runs the end-to-end test files (runEndToEnd), `e2eDir` holds
// them; `now`, `print`, `version` (the plugin's), `commit` (the build's), `designed` (the
// scenarios every report must account for), `platform` and `probe` (the sandbox probe a scenario
// with `needsSandbox` is checked by, checkSandbox) are for tests.
// Resolves with the exit code: after --all or --again, 0 only when the gate is passed; otherwise
// 0 only when every run passed.
export async function main(argv, {
  root = EVAL_ROOT,
  home = os.homedir(),
  run = runScenario,
  endToEnd = runEndToEnd,
  e2eDir = E2E_DIR,
  now = () => new Date(),
  print = console.log,
  version = pluginVersion(),
  commit,
  designed = DESIGNED,
  platform = process.platform,
  probe,
} = {}) {
  const args = parseArgs(argv);
  let agent = args.agent ?? null;
  const startedAt = now();
  const date = today(startedAt);
  // Each job: one leg of one scenario, in one variant, for some trials.
  const jobs = [];
  let carried = [];
  let e2e;
  let from = null;
  let carriedFrom = null;
  // Whether a scenario named on the command line is not run at all, or not in a variant asked for.
  let short = false;

  if (args.again) {
    const last = latestRunRecord(home);
    if (!last) throw new Error('No run to run again: run npm run eval -- --all first');
    const recorded = typeof last.record.agent === 'string' ? last.record.agent : null;
    if (agent !== null && agent !== recorded) throw new Error(`--again runs on the agent the run it repeats ran on (${recorded ?? 'the default'}): give it no --agent, or that one`);
    agent = recorded;
    from = last.file;
    print(`Running again what ${last.file} marked`);
    if (last.newer) print(`  (a newer run record, ${last.newer}, is not a whole run, so it was passed over)`);
    const before = summarise(last.record, { root, e2eDir, designed });
    const marked = before.rows.filter((row) => row.again.length);
    if (!marked.length) {
      print(before.passed
        ? 'Nothing in it is marked to run again. Its report:'
        : 'Nothing in it is marked to run again, and the gate is not passed: a scenario whose round run again failed, or a safety scenario that failed a handled trial, is never run again, so only a fresh `npm run eval -- --all` clears it. Its report:');
      print(summaryText(before));
      return before.passed ? 0 : 1;
    }
    carried = last.record.runs ?? [];
    carriedFrom = { date: last.record.date ?? null, version: last.record.version ?? null, commit: last.record.commit ?? null };
    e2e = last.record.e2e;
    for (const row of marked) {
      const ran = carried.filter((r) => r.id === row.id);
      const legs = new Set(ran.map((r) => r.leg ?? null));
      const entries = (await loadEntries(row.id, { root, agent: agent ?? DEFAULT_AGENT })).filter((entry) => legs.has(entry.scenario.leg ?? null));
      if (!entries.length) throw new Error(`Scenario ${row.id}'s legs in ${last.file} are not in its files any more`);
      for (const variant of row.again) {
        // Every leg's new trials take the same numbers, so a trial is judged across its legs.
        const after = Math.max(...entries.map((entry) => lastTrial(home, date, scenarioName(entry.scenario), variant, carried)));
        // TRIALS_AGAIN trials, or the ones a round that stopped short still lacks.
        const trials = Array.from({ length: row.toRun[variant] }, (_, i) => after + 1 + i);
        for (const entry of entries) jobs.push({ ...entry, variant, trials, round: 'again' });
      }
    }
  } else {
    let ids = args.ids;
    if (args.all) ids = numbersIn(root);
    if (args.suite !== undefined) {
      const suites = suitesIn(root);
      if (!suites.includes(args.suite)) throw new Error(`No suite ${args.suite}: the suites are ${suites.join(', ')}`);
      ids = numbersIn(root, args.suite);
    }
    // A record saved that day is never written over: the trials follow the last one there, with
    // the same numbers for every leg, so a trial is judged across its legs.
    const on = agent ?? DEFAULT_AGENT;
    // A variant named with --variant must run for every scenario named.
    const chosen = args.variants.length === 1;
    for (const id of ids) {
      const entries = await loadEntries(id, { root, agent: on });
      if (entries.length === 0) {
        if (args.ids.length > 0) {
          print(`${id}: not run (it does not run on ${on})`);
          short = true;
        }
        continue;
      }
      if (args.ids.length > 0 && chosen && entries.some((entry) => entry.scenario.variants?.[args.variants[0]] === undefined)) {
        print(`${id}: not run in ${args.variants[0]} (it has no such variant)`);
        short = true;
      }
      const trialsOf = Object.fromEntries(args.variants.map((variant) => {
        const after = Math.max(...entries.map((entry) => lastTrial(home, date, scenarioName(entry.scenario), variant, [])));
        return [variant, Array.from({ length: args.trials }, (_, i) => after + 1 + i)];
      }));
      for (const entry of entries) {
        // Only the variants the scenario has (a scenario of one agent's may have `with` alone).
        for (const variant of args.variants.filter((v) => entry.scenario.variants?.[v] !== undefined)) {
          jobs.push({ ...entry, variant, trials: trialsOf[variant], round: 'first' });
        }
      }
    }
  }

  const record = {
    v: 1,
    at: startedAt.toISOString(),
    date,
    how: args.again ? 'again' : args.all ? 'all' : args.suite !== undefined ? 'suite' : 'ids',
    ...(args.suite !== undefined ? { suite: args.suite } : {}),
    ...(args.ids.length ? { ids: args.ids } : {}),
    ...(from ? { from } : {}),
    // The run whose results an --again run carries over, as that run named its build.
    ...(carriedFrom ? { carried: carriedFrom } : {}),
    version,
    commit: commit === undefined ? await buildCommit() : commit,
    ...(agent !== null ? { agent } : {}),
    runs: [...carried],
    ...(e2e !== undefined ? { e2e } : {}),
  };
  const recordFile = path.join(runsDir(home), `${stampOf(startedAt)}.json`);
  // The record is written after every trial, so a run cut short still says what it did.
  const save = () => {
    fs.mkdirSync(path.dirname(recordFile), { recursive: true });
    fs.writeFileSync(recordFile, JSON.stringify(record, null, 2) + '\n');
  };
  save();

  if (args.all) {
    const files = [...new Set(coveredScenarios({ dir: e2eDir }).map((entry) => entry.file))];
    print(`End-to-end tests: ${files.join(', ')}`);
    try {
      record.e2e = (await endToEnd(files, { cwd: REPO })).map((result) => ({ ...result, file: shownPath(path.resolve(REPO, result.file)) }));
    } catch (error) {
      // Their tests then read as not run, and the gate stays shut.
      print(`The end-to-end tests could not run: ${error.message}`);
      record.e2e = [];
    }
    save();
  }

  const gate = sandboxGate({ probe });
  // The agent's own runner, when the run names one; otherwise runScenario's own, runSession.
  const runner = agent === null ? null : adapterFor(agent).evalRunner.run;
  let failed = 0;
  let skipped = 0;
  let started = 0;
  for (const job of jobs) {
    const { scenario, suite, variant } = job;
    for (const trial of job.trials) {
      // The sandbox does not run on native Windows (check 10): a scenario that needs it is not run
      // there, which is no failure and is never run again (ruling E30).
      if (scenario.needsSandbox === true && platform === 'win32') {
        print(`${scenarioName(scenario)} ${variant}: not run (${NOT_RUN_NO_SANDBOX})`);
        skipped += 1;
        record.runs.push({
          id: scenario.id,
          ...(scenario.leg ? { leg: scenario.leg } : {}),
          suite,
          title: scenario.title,
          safety: scenario.safety === true,
          variant,
          trial,
          round: job.round,
          pass: false,
          handled: true,
          notRun: NOT_RUN_NO_SANDBOX,
          why: `not run (${NOT_RUN_NO_SANDBOX})`,
          usage: { input: 0, output: 0 },
          file: null,
        });
        save();
        continue;
      }
      started += 1;
      let outcome;
      try {
        outcome = await run({ scenario, variant, trial, home, date, ...(runner === null ? {} : { runner }), ...(scenario.needsSandbox === true ? { beforePrompt: gate } : {}) });
      } catch (error) {
        // A trial that could not run is a failed one; the rest of the run carries on.
        const why = `could not run: ${error.message}`;
        outcome = { pass: false, handled: false, why, file: null, usage: { input: 0, output: 0 }, line: `${scenarioName(scenario)} ${variant}: fail (${why})` };
      }
      print(outcome.line);
      if (outcome.file) print(`  saved: ${outcome.file}`);
      if (!outcome.pass) failed += 1;
      record.runs.push({
        id: scenario.id,
        ...(scenario.leg ? { leg: scenario.leg } : {}),
        suite,
        title: scenario.title,
        safety: scenario.safety === true,
        variant,
        trial: outcome.trial ?? trial,
        round: job.round,
        pass: outcome.pass === true,
        handled: outcome.handled !== false,
        why: outcome.why,
        usage: outcome.usage ?? { input: 0, output: 0 },
        file: outcome.file,
      });
      save();
    }
  }
  record.finished = now().toISOString();
  save();
  print(`  run record: ${recordFile}`);

  if (args.all || args.again) {
    const summary = summarise(record, { root, e2eDir, designed });
    const text = summaryText(summary);
    const reportFile = recordFile.replace(/\.json$/, '.md');
    fs.writeFileSync(reportFile, text);
    print(text);
    print(`  report: ${reportFile}`);
    return summary.passed ? 0 : 1;
  }
  // Nothing was run at all (every trial needed a sandbox this computer lacks, or none has the variant
  // asked for), or a scenario named was not run on this agent or in a variant asked for: no pass.
  if (started === 0 || short) return 1;
  return failed ? 1 : 0;
}

if (startedAsScript(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (error) => { console.error(error.message); process.exitCode = 2; },
  );
}
