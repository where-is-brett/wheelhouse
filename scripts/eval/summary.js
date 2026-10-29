// scripts/eval/summary.js
// One report for a whole evaluation run (design section 18): every scenario as one row, with and
// without Wheelhouse; the scenarios end-to-end tests cover, by their tests; the Wheelhouse version
// the run used; the run's tokens; and whether the gate before an install is passed. Read from a
// run record (scripts/eval/run.js writes one for each run) and from the files in the suites and
// the end-to-end tests, never from a session.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRIALS_AGAIN } from '../lib/measure-numbers.js';
import { agentOfConfig } from '../agents/names.js';

export const REPO = fileURLToPath(new URL('../../', import.meta.url));
export const EVAL_ROOT = path.join(REPO, 'tests', 'eval');
export const E2E_DIR = path.join(REPO, 'tests', 'e2e');

// The designed set: scenarios 1 to 35 (design section 18, and section 15 of the build-loop
// design) and the engine's, 42 to 55 (Archon design, section 18). Each one is a scenario file in a
// suite or is covered by an end-to-end test; one that is neither is a row not run, and the gate is
// not passed. The other numbers (the mod's and an agent's own) are reported when found.
export const DESIGNED = Object.freeze([...Array.from({ length: 35 }, (_, i) => i + 1), ...Array.from({ length: 14 }, (_, i) => i + 42)]);

const VARIANTS = ['with', 'without'];
// A scenario's file in a suite: its number, a dash and a name (`27-bug-route.js`).
export const SCENARIO_FILE = /^(\d+)-.+\.js$/;
const COVERS = /^\s*\/\/ scenario (\d+)\b/;
const TEST_CALL = /^\s*test\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/;

// A file as the report names it: from the repository's root when it is inside it.
export function shownPath(file) {
  const relative = path.relative(REPO, file);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) return relative.split(path.sep).join('/');
  return file;
}

const unescape = (text) => text.replace(/\\(.)/g, (_, c) => ({ n: '\n', t: '\t', r: '\r' }[c] ?? c));

// The end-to-end tests that cover a scenario: each `test(...)` with a `// scenario <n>` comment on
// the line straight above it, in the test files of `dir`. In number order, then file and line.
export function coveredScenarios({ dir = E2E_DIR } = {}) {
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((name) => name.endsWith('.test.js')).sort();
  } catch {
    return [];
  }
  const found = [];
  for (const name of names) {
    const file = path.join(dir, name);
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const covers = COVERS.exec(line);
      const call = covers && TEST_CALL.exec(lines[i + 1] ?? '');
      if (call) found.push({ id: Number(covers[1]), test: unescape(call[2]), file: shownPath(file), line: i });
    });
  }
  found.sort((a, b) => a.id - b.id || a.file.localeCompare(b.file) || a.line - b.line);
  return found.map(({ id, test, file }) => ({ id, test, file }));
}

// The agent a run that names none runs on: the one a project with no agent named runs on.
export const DEFAULT_AGENT = agentOfConfig(null);

// The agents a scenario file declares it runs on (its module's `agents: ['…']`), read from its text so
// the file need not be loaded, or null when it declares none (it runs on every agent). run.js checks
// it against the module whenever it loads one.
export function declaredAgents(file) {
  const found = /^\s*agents:\s*\[([^\]]*)\]/m.exec(fs.readFileSync(file, 'utf8'));
  return found === null ? null : [...found[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

// Whether a scenario declaring `agents` (declaredAgents) runs on `agent`.
export const runsOnAgent = (agents, agent) => agents === null || agents.includes(agent);

// The leg a scenario file declares (its module's `leg: '<name>'`), read from its text so the
// file need not be loaded; null for a scenario's main leg.
export function declaredLeg(file) {
  try {
    return /^\s*leg:\s*['"]([a-z]+)['"]/m.exec(fs.readFileSync(file, 'utf8'))?.[1] ?? null;
  } catch {
    return null;
  }
}

// Every scenario file in the suites under `root`, by number: { number, suite, file, leg }.
function writtenScenarios(root) {
  const found = [];
  let suites = [];
  try {
    suites = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch {
    return found;
  }
  for (const suite of suites) {
    for (const name of fs.readdirSync(path.join(root, suite)).sort()) {
      const match = SCENARIO_FILE.exec(name);
      if (match) found.push({ number: Number(match[1]), suite, file: name, agents: declaredAgents(path.join(root, suite, name)), leg: declaredLeg(path.join(root, suite, name)) });
    }
  }
  return found;
}

const leg = (run) => run.leg ?? null;
const passed = (run) => run.pass === true && run.handled !== false;
const sum = (runs) => runs.reduce((total, run) => ({
  input: total.input + (run.usage?.input ?? 0),
  output: total.output + (run.usage?.output ?? 0),
}), { input: 0, output: 0 });

// The trial numbers among `runs`, and how many of them passed: a trial passes only when every
// leg's run of it passes.
function tally(runs, legs) {
  const trials = [...new Set(runs.map((run) => run.trial))].sort((a, b) => a - b);
  const passes = trials.filter((t) => legs.every((l) => runs.some((run) => run.trial === t && leg(run) === l && passed(run)))).length;
  return { trials, passes };
}

// One trial passes by passing; after more, a behaviour scenario needs more than half of them, and
// a safety scenario every one (a guard has to hold every time).
const verdictOf = ({ trials, passes }, safety) => ((safety ? passes === trials.length : passes * 2 > trials.length) ? 'pass' : 'fail');

// Whether a trial failed only through runs that were not handled (a crash, a session that did
// nothing, a trial that could not run): it showed nothing about what the scenario tests.
function unhandledOnly(runs, trial) {
  const failing = runs.filter((run) => run.trial === trial && !passed(run));
  return failing.length > 0 && failing.every((run) => run.handled === false);
}

// One variant of one scenario, judged by the trials rule. Without a round run again, every trial
// is judged. With one, a behaviour scenario is judged on the trials run again; a safety scenario
// on those and on every first-round trial that was handled, so a guard that failed once never
// passes (ruling E21). A round run again counts its whole trials (every leg run, or a failure
// shown); one with fewer than TRIALS_AGAIN of them stopped short and never passes (ruling E25).
// `first` is the first round on its own, for the report.
function judge(runs, legs, safety) {
  if (!runs.length) return { result: 'not run', trials: 0, passes: 0, round: null, runs: [], first: null, short: false, done: 0 };
  const firstRuns = runs.filter((run) => run.round !== 'again');
  const againRuns = runs.filter((run) => run.round === 'again');
  const firstTally = tally(firstRuns, legs);
  const failingFirst = firstTally.trials.filter((t) => !legs.every((l) => firstRuns.some((run) => run.trial === t && leg(run) === l && passed(run))));
  const first = firstRuns.length ? {
    trials: firstTally.trials.length,
    passes: firstTally.passes,
    result: verdictOf(firstTally, safety),
    // Every first-round trial that failed showed nothing: each failed only through runs not handled.
    unhandled: failingFirst.length > 0 && failingFirst.every((t) => unhandledOnly(firstRuns, t)),
  } : null;
  let judged = runs;
  let done = 0;
  if (againRuns.length) {
    const whole = (t) => legs.every((l) => againRuns.some((run) => run.trial === t && leg(run) === l))
      || againRuns.some((run) => run.trial === t && !passed(run) && run.handled !== false);
    const doneRuns = againRuns.filter((run) => whole(run.trial));
    done = new Set(doneRuns.map((run) => run.trial)).size;
    const kept = safety ? firstRuns.filter((run) => !unhandledOnly(firstRuns, run.trial)) : [];
    judged = [...kept, ...doneRuns];
  }
  const short = againRuns.length > 0 && done < TRIALS_AGAIN;
  const counted = tally(judged, legs);
  return {
    result: short ? 'fail' : verdictOf(counted, safety),
    trials: counted.trials.length,
    passes: counted.passes,
    round: againRuns.length ? 'again' : 'first',
    runs: judged,
    first,
    short,
    done,
  };
}

const reasons = (runs) => [...new Set(runs.map((run) => run.why).filter(Boolean))].join('; ');

// `fileLegs` are the legs the scenario's files declare: a leg there that never ran in a variant
// fails that variant's every trial, so a run cut short between legs never passes.
function rowFor(id, allRuns, fileLegs = []) {
  // A trial recorded `notRun` (a scenario that needs the sandbox, on Windows: ruling E30) is
  // neither a pass nor a failure: it is left out of every verdict, never run again, and its
  // variant reads `not run` with its reason.
  const runs = allRuns.filter((run) => !run.notRun);
  const notRunWhy = Object.fromEntries(VARIANTS.map((variant) => [variant, allRuns.find((run) => run.variant === variant && run.notRun)?.notRun ?? null]));
  const legs = [...new Set([...(runs.length ? runs : allRuns).map(leg), ...fileLegs])];
  const safety = allRuns.some((run) => run.safety === true);
  const verdicts = Object.fromEntries(VARIANTS.map((variant) => [variant, judge(runs.filter((run) => run.variant === variant), legs, safety)]));
  // Marked to run again: a first round whose with failed or whose without passed, for
  // TRIALS_AGAIN trials; or a round run again that stopped short, for the trials it lacks. A safety
  // scenario's with that failed in a handled trial can never pass, so it is not run again.
  const toRun = Object.fromEntries(VARIANTS.map((variant) => {
    const v = verdicts[variant];
    if (v.round === 'again') return [variant, v.short ? TRIALS_AGAIN - v.done : 0];
    if (v.round !== 'first' || v.trials >= TRIALS_AGAIN) return [variant, 0];
    const marked = variant === 'with' ? v.result === 'fail' && (!safety || v.first.unhandled) : v.result === 'pass';
    return [variant, marked ? TRIALS_AGAIN : 0];
  }));
  const again = VARIANTS.filter((variant) => toRun[variant] > 0);
  const lead = verdicts.with.result !== 'not run' ? verdicts.with : verdicts.without;
  const failing = lead.result === 'fail' ? lead.runs.filter((run) => !passed(run)) : lead.runs;
  const parts = [];
  // A round run again: the first round's reasons when it failed, then the round's own.
  if (lead.round === 'again' && lead.first?.result === 'fail') {
    const variant = lead === verdicts.with ? 'with' : 'without';
    const firstFailing = runs.filter((run) => run.variant === variant && run.round !== 'again' && !passed(run));
    parts.push(`first round: ${reasons(firstFailing)}`);
  }
  const own = reasons(failing.filter((run) => lead.round !== 'again' || run.round === 'again'));
  if (own) parts.push(own);
  if (lead.short) parts.push(`the round run again stopped at ${lead.done} of ${TRIALS_AGAIN}`);
  for (const variant of VARIANTS) {
    const ran = runs.filter((run) => run.variant === variant);
    if (!ran.length) continue;
    for (const l of legs) if (l !== null && !ran.some((run) => leg(run) === l)) parts.push(`${variant}: leg ${l} did not run`);
    if (legs.includes(null) && !ran.some((run) => leg(run) === null)) parts.push(`${variant}: the main leg did not run`);
  }
  for (const variant of VARIANTS) {
    if (verdicts[variant].result === 'not run' && notRunWhy[variant]) parts.push(`${variant}: not run (${notRunWhy[variant]})`);
  }
  const titles = [...new Set(allRuns.map((run) => run.title).filter(Boolean))];
  return {
    id,
    title: titles.join('; '),
    suite: allRuns[0].suite ?? null,
    notRun: notRunWhy,
    with: verdicts.with.result,
    without: verdicts.without.result,
    trials: { with: verdicts.with.trials, without: verdicts.without.trials },
    passes: { with: verdicts.with.passes, without: verdicts.without.passes },
    first: { with: verdicts.with.round === 'again' ? verdicts.with.first : null, without: verdicts.without.round === 'again' ? verdicts.without.first : null },
    toRun,
    tokens: sum(allRuns),
    why: parts.join('; '),
    again,
    safety,
    // On real Archon (`--engine archon`): 'real' when every trial played on the engine, 'recorded' when every one
    // played its recording, 'mixed' otherwise; null on any other run.
    played: playedOf(allRuns),
  };
}

function playedOf(runs) {
  const kinds = [...new Set(runs.map((run) => run.played).filter(Boolean))];
  if (kinds.length === 0) return null;
  return kinds.length === 1 ? kinds[0] : 'mixed';
}

const notRun = (id, title, suite, why) => ({
  id,
  title,
  suite,
  notRun: { with: null, without: null },
  with: 'not run',
  without: 'not run',
  trials: { with: 0, without: 0 },
  passes: { with: 0, without: 0 },
  first: { with: null, without: null },
  toRun: { with: 0, without: 0 },
  tokens: { input: 0, output: 0 },
  why,
  again: [],
  safety: false,
  played: null,
});

// The report of the run record `record` (see scripts/eval/run.js). `root` holds the suites and
// `e2eDir` the end-to-end tests; `designed` is the set every report must account for.
// `passed` only when every row's with passes and every end-to-end test that covers a scenario
// passed in this run.
export function summarise(record, { root = EVAL_ROOT, e2eDir = E2E_DIR, designed = DESIGNED } = {}) {
  const runs = record?.runs ?? [];
  const byId = new Map();
  for (const run of runs) {
    if (!byId.has(run.id)) byId.set(run.id, []);
    byId.get(run.id).push(run);
  }
  // The scenarios that don't run on the run's agent (`agents`) are no rows of its report; those that
  // name it are among the designed set it must account for.
  const agent = typeof record?.agent === 'string' ? record.agent : DEFAULT_AGENT;
  const all = writtenScenarios(root);
  const written = all.filter((scenario) => runsOnAgent(scenario.agents, agent));
  const named = typeof record?.agent === 'string' ? all.filter((scenario) => scenario.agents?.includes(agent)).map((scenario) => scenario.number) : [];
  designed = [...new Set([...designed, ...named])];
  const legsOf = (id) => [...new Set(written.filter((scenario) => scenario.number === id).map((scenario) => scenario.leg))];
  const rows = [...byId.entries()].map(([id, scenarioRuns]) => rowFor(id, scenarioRuns, legsOf(id)));
  // A run on the build engine (`--engine`) accounts only for the engine's scenarios it ran, and runs no end-to-end test.
  const engine = typeof record?.engine === 'string' ? record.engine : null;
  for (const scenario of engine ? [] : written) {
    if (!rows.some((row) => row.id === scenario.number)) rows.push(notRun(scenario.number, scenario.file, scenario.suite, 'not in this run'));
  }
  const results = record?.e2e ?? null;
  const covered = (engine ? [] : coveredScenarios({ dir: e2eDir })).map((entry) => {
    // Every result of that name in that file (a name used twice must pass both times).
    const found = (results ?? []).filter((r) => r.test === entry.test && shownPath(path.resolve(REPO, r.file)) === entry.file);
    return { ...entry, pass: found.length ? found.every((r) => r.pass === true) : null };
  });
  for (const id of engine ? [] : designed) {
    if (!rows.some((row) => row.id === id) && !covered.some((entry) => entry.id === id)) rows.push(notRun(id, '', null, 'not written'));
  }
  rows.sort((a, b) => a.id - b.id);
  return {
    rows,
    covered,
    version: record?.version ?? null,
    commit: record?.commit ?? null,
    at: record?.at ?? null,
    // The day the run's results are filed under (the computer's own date), else the day it began.
    date: record?.date ?? (typeof record?.at === 'string' ? record.at.slice(0, 10) : null),
    how: record?.how ?? null,
    agent: typeof record?.agent === 'string' ? record.agent : null,
    engine,
    carried: record?.carried ?? null,
    tokens: sum(runs),
    // A run cut short (no `finished` in its record) never passes, whatever it holds (ruling E25).
    finished: Boolean(record?.finished),
    passed: Boolean(record?.finished) && rows.length > 0 && rows.every((row) => row.with === 'pass') && covered.every((entry) => entry.pass === true),
  };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// A day as `YYYY-MM-DD` written out: 20 October 2026.
const dayOf = (date) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '');
  return match ? `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}` : null;
};
const grouped = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const tokens = (usage) => `${grouped(usage.input)} in / ${grouped(usage.output)} out`;
const cell = (text) => String(text ?? '').replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// A variant's verdict, with its count after more than one trial and, when a round was run again,
// how the first round went: `pass (3 of 3; first trial failed)`.
function verdictCell(row, variant) {
  const result = row[variant];
  if (result === 'not run' && row.notRun?.[variant]) return `not run (${row.notRun[variant]})`;
  const n = row.trials[variant];
  const notes = n > 1 ? [`${row.passes[variant]} of ${n}`] : [];
  const first = row.first?.[variant];
  if (first) {
    const what = first.result === 'pass' ? 'passed' : first.unhandled ? 'not handled' : 'failed';
    notes.push(first.trials === 1 ? `first trial ${what}` : `first round ${what}, ${first.passes} of ${first.trials}`);
  }
  return notes.length ? `${result} (${notes.join('; ')})` : result;
}

// The report as Markdown, for docs/evals/README.md: the date, the Wheelhouse version and the
// build, the gate, one row per scenario, the end-to-end tests that cover the rest, and the run's
// tokens on a line of their own.
export function summaryText(summary) {
  const lines = ['<!-- docs/evals/README.md -->', '', '# The evaluation', ''];
  const day = dayOf(summary.date);
  const facts = [
    day ? `Run on ${day}` : 'Run',
    `on Wheelhouse ${summary.version ?? '(version unknown)'}`,
    summary.commit ? `build ${summary.commit}` : null,
  ].filter(Boolean);
  const sessions = summary.agent ? `sessions of the ${summary.agent} agent, through its adapter's runner` : '`claude -p` sessions';
  if (summary.engine) lines.push(`${facts.join(', ')}. Each of the build engine's scenarios plays in a world of its own with the real helper, on ${summary.engine === 'archon' ? 'real Archon' : `the ${summary.engine} engine`}; no session runs.`, '');
  else lines.push(`${facts.join(', ')}. Each scenario runs in real ${sessions}, in a throwaway copy, with and without Wheelhouse; the end-to-end tests run with \`node --test\`.`, '');

  if (summary.carried) {
    const c = summary.carried;
    const build = [c.version ? `Wheelhouse ${c.version}` : null, c.commit ? `build ${c.commit}` : null].filter(Boolean).join(', ');
    lines.push(`Results not run again, the end-to-end tests' included, are carried over from the run of ${dayOf(c.date) ?? 'an earlier day'}${build ? ` (${build})` : ''}.`, '');
    if (c.commit && summary.commit && c.commit !== summary.commit) {
      lines.push(`**Two builds:** the carried results come from build ${c.commit}, the trials run again from build ${summary.commit}.`, '');
    }
  }
  const failing = summary.rows.filter((row) => row.with === 'fail');
  const missing = summary.rows.filter((row) => row.with === 'not run');
  const e2eShort = summary.covered.filter((entry) => entry.pass !== true);
  if (summary.passed) {
    lines.push('**The gate is passed:** every scenario passed with Wheelhouse, and every end-to-end test that covers one passed.', '');
  } else {
    const reasons = [
      failing.length ? `${plural(failing.length, 'scenario fails', 'scenarios fail')} with Wheelhouse (${failing.map((row) => row.id).join(', ')})` : null,
      missing.length ? `${plural(missing.length, 'scenario was', 'scenarios were')} not run (${missing.map((row) => row.id).join(', ')})` : null,
      e2eShort.length ? `${plural(e2eShort.length, 'end-to-end test', 'end-to-end tests')} did not pass or did not run` : null,
      !summary.rows.length ? 'no scenario is in the run' : null,
      !summary.finished ? 'the run did not finish' : null,
    ].filter(Boolean);
    lines.push(`**The gate is not passed:** ${reasons.join('; ')}.`, '');
  }
  if (summary.engine === 'archon') {
    const ids = (kind) => summary.rows.filter((row) => row.played === kind).map((row) => row.id);
    const [real, recorded, mixed] = [ids('real'), ids('recorded'), ids('mixed')];
    lines.push(`On real Archon. **Played for real:** ${real.length ? real.join(', ') : 'none'}. **Recorded** (their recording played on the fake engine, since a real step can't be made to give it on cue): ${recorded.length ? recorded.join(', ') : 'none'}.${mixed.length ? ` Some trials real and some recorded: ${mixed.join(', ')}.` : ''}`, '');
  }
  const skipped = summary.rows.filter((row) => row.notRun?.with || row.notRun?.without);
  if (skipped.length) {
    const why = [...new Set(skipped.flatMap((row) => [row.notRun.with, row.notRun.without]).filter(Boolean))].join('; ');
    lines.push(`Not run on this computer (${why}): ${skipped.map((row) => row.id).join(', ')}. The gate is taken on the Mac.`, '');
  }
  const marked = summary.rows.filter((row) => row.again.length);
  if (marked.length) {
    lines.push(`To run again (\`npm run eval -- --again\`): ${marked.map((row) => `${row.id} (${row.again.map((v) => (v === 'with' ? 'with failed' : 'without passed')).join(', ')})`).join(', ')}.`, '');
  }

  const same = summary.rows.filter((row) => row.without === 'pass');
  if (same.length) lines.push(`Passed without Wheelhouse too, so Wheelhouse makes no difference there: ${same.map((row) => row.id).join(', ')}.`, '');

  lines.push('## Scenarios run in real sessions', '');
  lines.push('| # | Scenario | Suite | With | Without | Trials | Tokens | Why |', '|---|---|---|---|---|---|---|---|');
  for (const row of summary.rows) {
    const played = row.played ? ` (${row.played})` : '';
    lines.push(`| ${row.id} | ${cell(row.title)} | ${cell(row.suite ?? '')} | ${verdictCell(row, 'with')}${played} | ${verdictCell(row, 'without')} | ${row.trials.with} / ${row.trials.without} | ${tokens(row.tokens)} | ${cell(row.why)} |`);
  }
  lines.push('');

  lines.push('## Scenarios covered by end-to-end tests', '');
  if (summary.covered.length) {
    lines.push('| # | Test | File | Result |', '|---|---|---|---|');
    for (const entry of summary.covered) {
      const result = entry.pass === null ? 'not run' : entry.pass ? 'pass' : 'fail';
      lines.push(`| ${entry.id} | ${cell(entry.test)} | ${cell(entry.file)} | ${result} |`);
    }
  } else {
    lines.push('None found.');
  }
  lines.push('');
  lines.push(`**Tokens for the whole run:** ${tokens(summary.tokens)}.`, '');
  return lines.join('\n');
}
