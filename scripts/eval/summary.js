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

export const REPO = fileURLToPath(new URL('../../', import.meta.url));
export const EVAL_ROOT = path.join(REPO, 'tests', 'eval');
export const E2E_DIR = path.join(REPO, 'tests', 'e2e');

// The designed set: scenarios 1 to 35 (design section 18, and section 15 of the build-loop
// design). Each one is a scenario file in a suite or is covered by an end-to-end test; one that is
// neither is a row not run, and the gate is not passed. Numbers from 36 on are reported when found.
export const DESIGNED = Object.freeze(Array.from({ length: 35 }, (_, i) => i + 1));

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

// Every scenario file in the suites under `root`, by number: { number, suite, file }.
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
      if (match) found.push({ number: Number(match[1]), suite, file: name });
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

// One variant of one scenario, judged by the trials rule. The trials judged are the ones run again
// when there are any, else all of them. A trial passes only when every leg's run of it passes.
// One trial passes by passing; after more, a behaviour scenario needs more than half of them, and
// a safety scenario every one (a guard has to hold every time).
function judge(runs, legs, safety) {
  if (!runs.length) return { result: 'not run', trials: 0, passes: 0, round: null, runs: [] };
  const again = runs.filter((run) => run.round === 'again');
  const judged = again.length ? again : runs;
  const trials = [...new Set(judged.map((run) => run.trial))].sort((a, b) => a - b);
  const passes = trials.filter((t) => legs.every((l) => judged.some((run) => run.trial === t && leg(run) === l && passed(run)))).length;
  const pass = safety ? passes === trials.length : passes * 2 > trials.length;
  return { result: pass ? 'pass' : 'fail', trials: trials.length, passes, round: again.length ? 'again' : 'first', runs: judged };
}

function rowFor(id, runs) {
  const legs = [...new Set(runs.map(leg))];
  const safety = runs.some((run) => run.safety === true);
  const verdicts = Object.fromEntries(VARIANTS.map((variant) => [variant, judge(runs.filter((run) => run.variant === variant), legs, safety)]));
  // Marked to run again: a first round whose with failed or whose without passed.
  const again = VARIANTS.filter((variant) => {
    const v = verdicts[variant];
    if (v.round !== 'first' || v.trials >= TRIALS_AGAIN) return false;
    return variant === 'with' ? v.result === 'fail' : v.result === 'pass';
  });
  const lead = verdicts.with.result !== 'not run' ? verdicts.with : verdicts.without;
  const failing = lead.result === 'fail' ? lead.runs.filter((run) => !passed(run)) : lead.runs;
  const why = [...new Set(failing.map((run) => run.why).filter(Boolean))].join('; ');
  const titles = [...new Set(runs.map((run) => run.title).filter(Boolean))];
  return {
    id,
    title: titles.join('; '),
    suite: runs[0].suite ?? null,
    with: verdicts.with.result,
    without: verdicts.without.result,
    trials: { with: verdicts.with.trials, without: verdicts.without.trials },
    passes: { with: verdicts.with.passes, without: verdicts.without.passes },
    tokens: sum(runs),
    why,
    again,
    safety,
  };
}

const notRun = (id, title, suite, why) => ({
  id, title, suite, with: 'not run', without: 'not run', trials: { with: 0, without: 0 }, tokens: { input: 0, output: 0 }, why, again: [], safety: false,
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
  const rows = [...byId.entries()].map(([id, scenarioRuns]) => rowFor(id, scenarioRuns));
  const written = writtenScenarios(root);
  for (const scenario of written) {
    if (!rows.some((row) => row.id === scenario.number)) rows.push(notRun(scenario.number, scenario.file, scenario.suite, 'not in this run'));
  }
  const results = record?.e2e ?? null;
  const covered = coveredScenarios({ dir: e2eDir }).map((entry) => {
    const result = results?.find((r) => r.test === entry.test && shownPath(path.resolve(REPO, r.file)) === entry.file);
    return { ...entry, pass: result ? result.pass === true : null };
  });
  for (const id of designed) {
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
    carried: record?.carried ?? null,
    tokens: sum(runs),
    passed: rows.length > 0 && rows.every((row) => row.with === 'pass') && covered.every((entry) => entry.pass === true),
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

function verdictCell(row, variant) {
  const result = row[variant];
  const n = row.trials[variant];
  return n > 1 ? `${result} (${row.passes[variant]} of ${n})` : result;
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
  lines.push(`${facts.join(', ')}. Each scenario runs in real \`claude -p\` sessions, in a throwaway copy, with and without Wheelhouse; the end-to-end tests run with \`node --test\`.`, '');

  if (summary.carried) {
    const c = summary.carried;
    const build = [c.version ? `Wheelhouse ${c.version}` : null, c.commit ? `build ${c.commit}` : null].filter(Boolean).join(', ');
    lines.push(`Results not run again, the end-to-end tests' included, are carried over from the run of ${dayOf(c.date) ?? 'an earlier day'}${build ? ` (${build})` : ''}.`, '');
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
    ].filter(Boolean);
    lines.push(`**The gate is not passed:** ${reasons.join('; ')}.`, '');
  }
  const marked = summary.rows.filter((row) => row.again.length);
  if (marked.length) {
    lines.push(`To run again (\`npm run eval -- --again\`): ${marked.map((row) => `${row.id} (${row.again.map((v) => (v === 'with' ? 'with failed' : 'without passed')).join(', ')})`).join(', ')}.`, '');
  }

  lines.push('## Scenarios run in real sessions', '');
  lines.push('| # | Scenario | Suite | With | Without | Trials | Tokens | Why |', '|---|---|---|---|---|---|---|---|');
  for (const row of summary.rows) {
    lines.push(`| ${row.id} | ${cell(row.title)} | ${cell(row.suite ?? '')} | ${verdictCell(row, 'with')} | ${verdictCell(row, 'without')} | ${row.trials.with} / ${row.trials.without} | ${tokens(row.tokens)} | ${cell(row.why)} |`);
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
