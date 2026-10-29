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
import { tempFolder } from '../helpers/homes.js';

function built() {
  const out = tempFolder('wh-built-');
  const { digest, workflows } = buildPack({ out });
  const read = (name) => JSON.parse(fs.readFileSync(path.join(out, '.archon', 'workflows', 'wheelhouse', name, `${name}.yaml`), 'utf8'));
  return { out, digest, workflows, read };
}
const LABELS = ['wh.kind', 'wh.level', 'wh.topic', 'wh.work', 'wh.recommend'];

test('the pack builds the quick lane and the health trial where --workflow-source reads them', () => {
  const { workflows, digest } = built();
  assert.deepEqual(workflows, ['wheelhouse-hello', LANE_WORKFLOWS.quick]);
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.throws(() => buildPack({ out: 'relative' }), /absolute folder/);
});

test('every AI step carries its prompt with the shared rules, and no prompt file is left to find', () => {
  const { read } = built();
  for (const name of ['wheelhouse-hello', 'wheelhouse-quick']) {
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
  for (const name of ['wheelhouse-hello', 'wheelhouse-quick']) {
    const workflow = read(name);
    for (const { node, group } of nodesOf(workflow.nodes)) {
      const bash = [node.bash, group === null ? node.loop_group?.until_bash : null].filter((b) => typeof b === 'string').join('\n');
      for (const [, script] of bash.matchAll(/\$WHEELHOUSE_ROOT\/(scripts\/[\w/.-]+\.js)/g)) named.add(script);
      // The health trial's script step is a plain shell line: it shows the engine runs one.
      if (name !== 'wheelhouse-hello' && typeof node.bash === 'string') assert.match(node.bash, /\$WHEELHOUSE_ROOT\/scripts\//, `${node.id} runs one of Wheelhouse's scripts`);
    }
  }
  assert.ok(named.size >= 10, `${named.size} scripts named`);
  for (const script of named) assert.ok(fs.existsSync(path.join(root, script)), `${script} is in the plugin`);
});
