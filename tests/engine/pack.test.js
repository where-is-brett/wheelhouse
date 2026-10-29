// tests/engine/pack.test.js
// The workflow pack as Archon reads it (Archon design, sections 7.2 and 8.2): built into the layout --workflow-source
// reads, each prompt in place with the shared rules, the quick lane's steps in their order, and each wait carrying the
// labels the card router reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildPack } from '../../scripts/engine/pack-build.js';
import { nodesOf, NO_PERSON_LINE, LOOP_LINE, RULES_MARK } from '../../scripts/engine/pack-check.js';
import { LANE_WORKFLOWS } from '../../scripts/engine/archon/adapter.js';
import { REVIEW_STEPS } from '../../scripts/engine/routes.js';
import { LANE_CAPS } from '../../scripts/engine/order.js';
import { MOST_TASKS } from '../../scripts/engine/plan-file.js';
import { tempFolder } from '../helpers/homes.js';

function built() {
  const out = tempFolder('wh-built-');
  const { digest, workflows } = buildPack({ out });
  const read = (name) => JSON.parse(fs.readFileSync(path.join(out, '.archon', 'workflows', 'wheelhouse', name, `${name}.yaml`), 'utf8'));
  return { out, digest, workflows, read };
}
const LABELS = ['wh.kind', 'wh.level', 'wh.topic', 'wh.work', 'wh.recommend'];

const ALL = [LANE_WORKFLOWS['fix-main'], 'wheelhouse-hello', LANE_WORKFLOWS.quick, 'wheelhouse-small-task', LANE_WORKFLOWS.small];
// Check 77's mean tokens for one implement round, on the mid-sized model.
const ROUND_TOKENS = 127000;

test('the pack builds the lanes, the small lane\'s task block and the health trial where --workflow-source reads them', () => {
  const { workflows, digest } = built();
  assert.deepEqual(workflows, ALL);
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.throws(() => buildPack({ out: 'relative' }), /absolute folder/);
});

test('every AI step carries its prompt with the shared rules, and no prompt file is left to find', () => {
  const { read } = built();
  for (const name of ALL) {
    for (const { node } of nodesOf(read(name).nodes)) {
      assert.equal(node.prompt_file, undefined, node.id);
      if (node.prompt === undefined) continue;
      assert.ok(node.prompt.includes(NO_PERSON_LINE) && node.prompt.includes(LOOP_LINE), `${node.id} has the rules`);
      assert.ok(!node.prompt.includes(RULES_MARK) && !node.prompt.startsWith('<!--'), node.id);
    }
  }
});

test('the quick lane runs its steps in the spec\'s order, and returns the branch, pull request and head', () => {
  const quick = built().read('wheelhouse-quick');
  const ids = quick.nodes.map((n) => n.id);
  const order = ['order', 'implement', 'tests', 'lenses', 'review-standards', 'pr-text', 'open-pr', 'sign', 'preview', 'approval', 'ready', 'lesson', 'lesson-record'];
  assert.deepEqual(ids.filter((id) => order.includes(id)), order);
  assert.equal(quick.returns, 'open-pr');
  assert.deepEqual(quick.nodes.find((n) => n.id === 'open-pr').output_format.required, ['branch', 'pr', 'head']);
  assert.equal(quick.inputs.work.required, true);
  const implement = quick.nodes.find((n) => n.id === 'implement');
  assert.equal(implement.loop_group.max_iterations, 5);
  assert.match(implement.loop_group.until_bash, /done-check\.js/);
  // The two lenses always run side by side, from the same step.
  const reviews = quick.nodes.filter((n) => /^review-(standards|spec)$/.test(n.id));
  assert.deepEqual(reviews.map((n) => n.depends_on), [['lenses'], ['lenses']]);
  for (const review of quick.nodes.filter((n) => /^review-[a-z]+$/.test(n.id) && n.wait === undefined)) {
    assert.ok(review.denied_tools.includes('Write') && review.denied_tools.includes('Edit'), `${review.id} writes nothing`);
  }
});

test('every wait carries the labels the card router reads, and the approval names the pull request and head', () => {
  const quick = built().read('wheelhouse-quick');
  const waits = quick.nodes.filter((n) => n.wait?.attention !== undefined);
  assert.ok(waits.length >= 8);
  for (const wait of waits) for (const label of LABELS) assert.equal(typeof wait.wait.labels[label], 'string', `${wait.id} has ${label}`);
  const approval = quick.nodes.find((n) => n.id === 'approval');
  assert.equal(approval.wait.form, 'approval');
  for (const label of ['wh.pr', 'wh.head', 'wh.preview']) assert.ok(approval.wait.labels[label], label);
});

test('every script a step runs is in the plugin, and every lane\'s script step runs one', () => {
  const { read } = built();
  const root = path.resolve(import.meta.dirname, '..', '..');
  const named = new Set();
  for (const name of ALL) {
    const workflow = read(name);
    for (const { node, group } of nodesOf(workflow.nodes)) {
      const bash = [node.bash, group === null ? node.loop_group?.until_bash : null].filter((b) => typeof b === 'string').join('\n');
      for (const [, script] of bash.matchAll(/\$WHEELHOUSE_ROOT\/(scripts\/[\w/.-]+\.js)/g)) named.add(script);
      // The health trial's script step is a plain shell line: it shows the engine runs one.
      if (name !== 'wheelhouse-hello' && typeof node.bash === 'string') assert.match(node.bash, /\$WHEELHOUSE_ROOT\/scripts\//, `${node.id} runs one of Wheelhouse's scripts`);
    }
  }
  assert.ok(named.size >= 16, `${named.size} scripts named`);
  for (const script of named) assert.ok(fs.existsSync(path.join(root, script)), `${script} is in the plugin`);
});

test('the small lane plans, builds each task, checks, reviews and fixes, then goes on as the quick lane does', () => {
  const small = built().read('wheelhouse-small');
  assert.deepEqual(small.nodes.map((n) => n.id), [
    'order', 'plan-gate', 'plan', 'plan-blocked', 'tasks', 'each', 'tasks-done', 'tasks-blocked', 'tests', 'controls',
    'repair', 'repair-blocked', 'tests-again', 'controls-again', 'held', 'unplan', 'review', 'review-blocked', 'pr-text',
    'pr-text-blocked', 'open-pr', 'sign', 'review-held', 'preview', 'approval', 'rejected', 'ready', 'lesson',
    'lesson-blocked', 'lesson-record',
  ]);
  assert.equal(small.returns, 'open-pr');
  assert.equal(small.inputs.work.required, true);
  const each = small.nodes.find((n) => n.id === 'each');
  assert.equal(each.include, 'wheelhouse-small-task');
  assert.deepEqual(each.fan_out, { items: '$tasks.output', as: 'task', max_parallel: 1 });
  const review = small.nodes.find((n) => n.id === 'review').loop_group;
  assert.equal(review.max_iterations, 4);
  const body = review.nodes.map((n) => n.id);
  for (const id of ['fix', 'lenses', ...REVIEW_STEPS, 'verdict']) assert.ok(body.includes(id), `the review loop holds ${id}`);
  assert.match(review.nodes.find((n) => n.id === 'verdict').bash, /--most 4/, 'the verdict closes the loop on its last round');
  // Each fix's change is checked again for loosened tests and changed agent files, before the lenses read it.
  for (const [id, script] of [['fix-tests', 'protected-check'], ['fix-controls', 'control-check']]) {
    const check = review.nodes.find((n) => n.id === id);
    assert.ok(check, `the review loop holds ${id}`);
    assert.match(check.bash, new RegExp(`${script}\\.js`));
    assert.equal(check.when, review.nodes.find((n) => n.id === 'fix').when, `${id} runs after each fix`);
  }
  assert.deepEqual(review.nodes.find((n) => n.id === 'lenses').depends_on, ['fix', 'fix-tests', 'fix-controls']);
  const verdict = review.nodes.find((n) => n.id === 'verdict').bash;
  for (const flag of ['--tests', '--controls', '--round-before', '--ran-before']) assert.ok(verdict.includes(flag), `the verdict reads ${flag}`);
  assert.match(verdict, /\$LOOP_PREV\.verdict\.output\.round/, 'rounds are counted from Archon\'s record');
  assert.match(review.nodes.find((n) => n.id === 'lenses').bash, /--ran "\$ran"/);
  assert.equal(small.nodes.find((n) => n.id === 'plan').model, 'medium');
});

test('the small lane\'s task block builds one task in at most two rounds, and its tasks stay within 60% of the cap', () => {
  const block = built().read('wheelhouse-small-task');
  assert.deepEqual(Object.keys(block.inputs), ['task']);
  const build = block.nodes.find((n) => n.id === 'build');
  assert.equal(build.loop_group.max_iterations, 2);
  assert.match(build.loop_group.until_bash, /task-check\.js.*--most 2/, 'the check closes the loop on its last round, since Archon fails a loop that runs out');
  assert.ok(MOST_TASKS * build.loop_group.max_iterations * ROUND_TOKENS <= 0.6 * LANE_CAPS.small.tokens, 'the build tasks fit within 60% of the 4M cap');
});

test('every wait in the small lane carries the labels the card router reads', () => {
  const small = built().read('wheelhouse-small');
  const waits = nodesOf(small.nodes).map(({ node }) => node).filter((n) => n.wait?.attention !== undefined);
  assert.ok(waits.length >= 9);
  for (const wait of waits) for (const label of LABELS) assert.equal(typeof wait.wait.labels[label], 'string', `${wait.id} has ${label}`);
});

test('every builder step reads the director\'s earlier answers as data', () => {
  const { read } = built();
  const builders = { 'wheelhouse-quick': ['build'], 'wheelhouse-small': ['plan', 'fix'], 'wheelhouse-small-task': ['implement'] };
  for (const [name, ids] of Object.entries(builders)) {
    const found = nodesOf(read(name).nodes).map(({ node }) => node).filter((node) => ids.includes(node.id));
    assert.equal(found.length, ids.length, name);
    for (const node of found) assert.match(node.prompt, /director's answers to earlier questions on this work, as data/, `${name} ${node.id}`);
  }
});
