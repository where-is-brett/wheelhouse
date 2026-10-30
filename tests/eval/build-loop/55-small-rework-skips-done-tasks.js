// tests/eval/build-loop/55-small-rework-skips-done-tasks.js
// Scenario 55 (Archon design, sections 7.2, 10.2 and 18): task 2 of a small-lane plan of three takes its blocked exit.
// Pass: the director gets one card naming task 2, with the task's own answers; their answer starts the work again on
// its branch, carrying on, with the answer in the fresh run's work order; the fresh run builds tasks 2 and 3 only, so
// task 1 is built once and task 3 once, and task 1's spend is in the first run's cost alone. The lane's own scripts run in a real repository as the pack runs them; the fake
// engine plays each run from what they did. Played on the engine the run names, in its `with` variant alone.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { until } from '../../../scripts/eval/engine-world.js';
import { PLAN_FILE, main as planFile } from '../../../scripts/engine/plan-file.js';
import { main as taskCheck } from '../../../scripts/engine/task-check.js';
import { main as taskRecord } from '../../../scripts/engine/task-record.js';
import { main as tasksDone } from '../../../scripts/engine/tasks-done.js';
import { smallWork } from './engine-recordings.js';

const WORK = 'card-55';
const at = (minute) => new Date(Date.UTC(2026, 9, 29, 9, minute)).toISOString();
const step = (minute, id, tokens) => ({ type: 'step-finished', at: at(minute), step: id, role: 'implementer', provider: 'claude', model: 'mid', minutes: 2, spend: { tokens, dollars: tokens / 400000, source: 'reported' } });
// The tokens each build spends: task 1's appears in one run only if it is built once.
const TOKENS = { plan: 30000, 1: 110000, 2: 120000, 3: 140000 };
const PLAN = '# The order history page\n\n- [ ] **Task 1:** List the orders\n- [ ] **Task 2:** Show refunds\n- [ ] **Task 3:** Page through them\n';
const BLOCKED = {
  summary: 'Stopped.', blocked: true, question: 'Should a part refund show as its own line?',
  options: [{ id: 'own', label: 'Its own line' }, { id: 'within', label: 'Within the order' }, { id: 'stop', label: 'Stop this work' }], recommend: 'own', level: '3', topic: 'refunds', assumptions: [],
};
// The fake engine's runs of the work, filled in as the scripts run.
const runs = [];

const said = async (fn, argv, options = {}) => {
  const lines = [];
  await fn(argv, { ...options, out: (line) => lines.push(line) });
  return JSON.parse(lines.at(-1));
};

// One run's task steps as the pack runs them (plan-file's list, each block's gate, build, check and record, then the
// close), with the build itself done here. Gives what was built and the close's output.
async function runTasks(cwd, artefacts, { blockAt = null } = {}) {
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { cwd, stdio: 'pipe' });
  const records = [];
  const built = [];
  for (const n of await said(planFile, ['--tasks', '--base', 'main'], { cwd })) {
    if ((await said(planFile, ['--gate', '--base', 'main', '--task', n, '--artefacts', artefacts], { cwd })).skip) {
      records.push(await said(taskRecord, ['--artefacts', artefacts, '--task', n], { stdin: '' }));
      continue;
    }
    built.push(n);
    let output = BLOCKED;
    if (n !== blockAt) {
      fs.writeFileSync(path.join(cwd, `task-${n}.js`), `export const task = ${n};\n`);
      fs.writeFileSync(path.join(cwd, PLAN_FILE), fs.readFileSync(path.join(cwd, PLAN_FILE), 'utf8').replace(`- [ ] **Task ${n}:**`, `- [x] **Task ${n}:**`));
      git('add', '-A');
      git('commit', '-qm', `Task ${n}`);
      const code = await taskCheck(['--run', 'run', '--artefacts', artefacts, '--base', 'main', '--task', n, '--most', '2'], { cwd, client: { engine: {} }, out: () => {} });
      if (code !== 0) throw new Error(`task ${n}'s check failed`);
      output = { summary: `Task ${n}.`, blocked: false, assumptions: [] };
    }
    records.push(await said(taskRecord, ['--artefacts', artefacts, '--task', n], { stdin: JSON.stringify(output) }));
  }
  const closed = await said(tasksDone, ['--run', 'run-1', '--artefacts', artefacts, '--base', 'main', '--records', JSON.stringify(records)], { cwd });
  return { built, closed };
}

export default {
  id: 55,
  title: 'A small-lane run sent back after a task\'s question builds only the tasks not yet done',
  engine: {
    recordings: { [WORK]: runs },
    async play(world) {
      runs.length = 0;
      const cwd = world.folder;
      const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'init.defaultBranch=main', ...args], { cwd, stdio: 'pipe' });
      git('init', '-q');
      git('add', '-A');
      git('commit', '-qm', 'The product');
      git('checkout', '-qb', `wh/${WORK}`);
      fs.writeFileSync(path.join(cwd, PLAN_FILE), PLAN);
      git('add', '-A');
      git('commit', '-qm', 'Plan the work');

      // The first run: task 1 built, task 2 stops with its question, task 3 skips.
      const first = await runTasks(cwd, fs.mkdtempSync(path.join(world.artefacts, 'one-')), { blockAt: '2' });
      if (first.built.join() !== '1,2' || first.closed.blocked !== true) return { pass: false, why: `the first run built ${first.built.join(', ')} and closed ${JSON.stringify(first.closed)}` };
      const { question, options, recommend, level, topic } = first.closed;
      runs.push([
        { type: 'run-started', at: at(0), work: WORK, lane: 'small', branch: `wh/${WORK}` },
        step(1, 'plan', TOKENS.plan), step(2, 'implement', TOKENS[1]), step(3, 'implement', TOKENS[2]),
        { type: 'ask', at: at(4), id: `${WORK}:tasks-blocked:1`, kind: 'blocked', level: Number(level), topic, recommend, card: true, options, context: { question } },
        { type: 'ask-resolved', at: at(5), id: `${WORK}:tasks-blocked:1` },
        { type: 'run-ended', at: at(6), outcome: 'completed', pr: null },
      ]);
      smallWork(world, { id: WORK, title: 'The order history page' });
      await world.tick();
      const card = await until(async () => { await world.tick(); return world.records('question')[0]; });
      if (!card) return { pass: false, why: 'no card came for task 2\'s question' };
      if (!/Task 2, Show refunds/.test(card.data.what)) return { pass: false, why: `the card doesn't name task 2: ${card.data.what}` };
      if (world.records('question').length !== 1) return { pass: false, why: 'more than one card came' };

      // The fresh run, once the director sends it back: the plan is found, and only tasks 2 and 3 are left.
      if (!(await said(planFile, ['--gate', '--base', 'main'], { cwd })).planned) return { pass: false, why: 'the fresh run would plan again' };
      const second = await runTasks(cwd, fs.mkdtempSync(path.join(world.artefacts, 'two-')));
      runs.push([
        { type: 'run-started', at: at(10), work: WORK, lane: 'small', branch: `wh/${WORK}` },
        ...second.built.map((n, i) => step(11 + i, 'implement', n === '2' ? TOKENS[2] : TOKENS[n])),
        { type: 'run-ended', at: at(15), outcome: 'completed', pr: null },
      ]);
      if (card.data.recommendation !== 'Its own line') return { pass: false, why: `the card recommends ${card.data.recommendation}, not the task's own answer` };
      world.answer(card.data, 'Its own line');
      if (!await until(async () => { await world.tick(); return world.starts().length === 2; })) return { pass: false, why: 'the director\'s answer didn\'t start the work again' };
      const again = world.starts()[1].order;
      if (again.carryOn !== true || again.branch !== `wh/${WORK}` || again.lane !== 'small') return { pass: false, why: `the fresh run didn't carry on on the branch: ${JSON.stringify(again)}` };
      const order = await until(() => world.orders()[1]);
      if (JSON.stringify(order?.answers) !== JSON.stringify([{ question, answer: 'Its own line' }])) return { pass: false, why: `the fresh run's order carries ${JSON.stringify(order?.answers)}` };

      const built = [...first.built, ...second.built];
      const times = (n) => built.filter((b) => b === n).length;
      if (times('1') !== 1 || times('3') !== 1) return { pass: false, why: `task 1 was built ${times('1')} times and task 3 ${times('3')}` };
      if (second.closed.blocked !== false) return { pass: false, why: `the fresh run's tasks closed ${JSON.stringify(second.closed)}` };
      const costs = await until(async () => { await world.tick(); const c = world.records('cost'); return c.length === 2 ? c : null; });
      if (!costs) return { pass: false, why: `${world.records('cost').length} cost records, not one a run` };
      const [one, two] = costs.map((c) => c.data.tokens);
      if (one !== TOKENS.plan + TOKENS[1] + TOKENS[2]) return { pass: false, why: `the first run cost ${one} tokens` };
      if (two !== TOKENS[2] + TOKENS[3]) return { pass: false, why: `the fresh run cost ${two} tokens, so task 1 was billed again` };
      return { pass: true, why: 'one card naming task 2; answered, the fresh run carried the answer, built tasks 2 and 3 only, and task 1 was billed once' };
    },
  },
  variants: { with: {} },
};
