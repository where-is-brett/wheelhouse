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
import { REVIEW_STEPS, FEATURE_REVIEW } from '../../scripts/engine/routes.js';
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

const ALL = [LANE_WORKFLOWS.bug, LANE_WORKFLOWS.feature, LANE_WORKFLOWS['fix-main'], 'wheelhouse-hello', LANE_WORKFLOWS.quick, 'wheelhouse-slice-task', LANE_WORKFLOWS.slice, 'wheelhouse-small-task', LANE_WORKFLOWS.small];
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

test('every step whose script asks the helper with the run\'s ticket passes the artefacts folder the ticket is in (check 81)', () => {
  const { read } = built();
  const root = path.resolve(import.meta.dirname, '..', '..');
  const ticketed = (script) => /\bwithTicket\(/.test(fs.readFileSync(path.join(root, script), 'utf8'));
  let seen = 0;
  for (const name of ALL) {
    for (const { node } of nodesOf(read(name).nodes)) {
      for (const bash of [node.bash, node.loop_group?.until_bash].filter((b) => typeof b === 'string')) {
        for (const line of bash.split(/;|&&|\|\|/)) {
          const [, script] = /\$WHEELHOUSE_ROOT\/(scripts\/[\w/.-]+\.js)/.exec(line) ?? [];
          if (!script || !ticketed(script)) continue;
          seen += 1;
          assert.match(line, /--artefacts "\$ARTIFACTS_DIR"/, `${name} ${node.id} runs ${script} with no ticket`);
        }
      }
    }
  }
  assert.ok(seen >= 10, `${seen} ticketed calls`);
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
  for (const id of ['fix', 'lenses', ...REVIEW_STEPS.filter((s) => s !== FEATURE_REVIEW), 'verdict']) assert.ok(body.includes(id), `the review loop holds ${id}`);
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
  const builders = { 'wheelhouse-quick': ['build'], 'wheelhouse-small': ['plan', 'fix'], 'wheelhouse-small-task': ['implement'], 'wheelhouse-bug': ['reproduce', 'build'] };
  for (const [name, ids] of Object.entries(builders)) {
    const found = nodesOf(read(name).nodes).map(({ node }) => node).filter((node) => ids.includes(node.id));
    assert.equal(found.length, ids.length, name);
    for (const node of found) assert.match(node.prompt, /director's answers to earlier questions on this work, as data/, `${name} ${node.id}`);
  }
});

test('the slice lane is the small lane plus its task review, switch check, tester\'s walk and critical-area lens on the large tier', () => {
  const { read } = built();
  const slice = read('wheelhouse-slice');
  const ids = slice.nodes.map((n) => n.id);
  for (const id of ['flag-off', 'flag-off-again', 'tester', 'tester-blocked', 'walk-held']) assert.ok(ids.includes(id), `the slice lane has ${id}`);
  assert.equal(slice.nodes.find((n) => n.id === 'each').include, 'wheelhouse-slice-task');
  assert.match(slice.nodes.find((n) => n.id === 'order').bash, /--feature-flags/);
  assert.match(slice.nodes.find((n) => n.id === 'flag-off').bash, /flag\.js" --check-off/);
  assert.match(slice.nodes.find((n) => n.id === 'repair').when, /\$flag-off\.output\.clean == 'false'/);
  assert.match(slice.nodes.find((n) => n.id === 'unplan').when, /\$flag-off\.output\.clean == 'true'/);
  assert.match(slice.nodes.find((n) => n.id === 'preview').bash, /--walk --flag-on/);
  const tester = slice.nodes.find((n) => n.id === 'tester');
  assert.deepEqual(tester.denied_tools, ['Write', 'Edit', 'NotebookEdit'], 'the tester reads only');
  assert.equal(tester.when, "$preview.output.walk == 'true'", 'a slice with no page check passes straight through');
  assert.match(slice.nodes.find((n) => n.id === 'ready').when, /\$tester\.output\.met == 'true'/, 'a page check not met is never marked ready');
  const approval = slice.nodes.find((n) => n.id === 'approval');
  assert.equal(approval.wait.labels['wh.topic'], '$order.output.topic', 'the midpoint demo is the slice\'s approval, under its own topic');
  assert.equal(approval.wait.labels['wh.head'], '$open-pr.output.head');
  const security = slice.nodes.find((n) => n.id === 'review').loop_group.nodes.find((n) => n.id === 'review-security');
  assert.equal(security.model, 'large', 'the critical-area review is on the most capable tier');
  const block = read('wheelhouse-slice-task');
  const build = block.nodes.find((n) => n.id === 'build');
  assert.deepEqual(build.loop_group.nodes.map((n) => n.id), ['implement', 'task-review']);
  assert.match(build.loop_group.until_bash, /task-check\.js.*--most 3 --review "\$review"/);
  assert.ok(MOST_TASKS * build.loop_group.max_iterations * ROUND_TOKENS <= 0.6 * LANE_CAPS.slice.tokens, 'the build tasks fit within 60% of the slice\'s cap');
});

test('the feature lane switches the feature on, reviews it whole on the large tier, and always waits for the director\'s switch-on', () => {
  const feature = built().read('wheelhouse-feature');
  const ids = feature.nodes.map((n) => n.id);
  assert.deepEqual(ids.slice(0, 4), ['order', 'switch', 'switch-on', 'switch-on-blocked']);
  for (const id of ['plan', 'each', 'flag-off']) assert.ok(!ids.includes(id), `the feature's own run has no ${id}`);
  assert.match(feature.nodes.find((n) => n.id === 'switch').bash, /flag\.js" --on/);
  const loop = feature.nodes.find((n) => n.id === 'review').loop_group;
  const whole = loop.nodes.find((n) => n.id === FEATURE_REVIEW);
  assert.equal(whole.model, 'large');
  assert.deepEqual(whole.denied_tools, ['Write', 'Edit', 'NotebookEdit']);
  assert.match(loop.nodes.find((n) => n.id === 'verdict').bash, /--feature "\$whole"/);
  assert.equal(loop.max_iterations, 4);
  assert.ok(ids.indexOf('approval') > ids.indexOf('preview'), 'the switch-on is approved on the preview of the switched-on head');
  assert.equal(feature.nodes.find((n) => n.id === 'approval').wait.labels['wh.topic'], '$order.output.topic');
  assert.doesNotMatch(feature.nodes.find((n) => n.id === 'preview').bash, /--flag-on/, 'the branch itself has the switch on');
});

test('every wait in the slice and feature lanes carries the labels the card router reads', () => {
  const { read } = built();
  for (const name of ['wheelhouse-slice', 'wheelhouse-feature']) {
    const waits = nodesOf(read(name).nodes).map(({ node }) => node).filter((n) => n.wait?.attention !== undefined);
    assert.ok(waits.length >= 8, name);
    for (const wait of waits) for (const label of LABELS) assert.equal(typeof wait.wait.labels[label], 'string', `${name} ${wait.id} has ${label}`);
  }
});

test('the bug lane reproduces first, proves it red and keeps it, then fixes it and goes on as the quick lane does', () => {
  const bug = built().read('wheelhouse-bug');
  const ids = bug.nodes.map((n) => n.id);
  const order = ['order', 'reproduce-gate', 'reproduce', 'red', 'reproduced', 'implement', 'size', 'tests', 'lenses', 'review-standards', 'pr-text', 'open-pr', 'sign', 'preview', 'approval', 'ready', 'lesson', 'lesson-record'];
  assert.deepEqual(ids.filter((id) => order.includes(id)), order);
  assert.equal(bug.returns, 'open-pr');
  assert.equal(bug.inputs.work.required, true);
  const byId = (id) => bug.nodes.find((n) => n.id === id);
  // The method is the prompt's, naming its skill only in words (check 77).
  assert.match(byId('reproduce').prompt, /diagnosing-bugs method/);
  assert.ok(!byId('reproduce').skills.some((s) => /diagnosing/.test(s)));
  assert.equal(byId('reproduce').when, "$reproduce-gate.output.reproduced == 'false'");
  assert.deepEqual(byId('reproduce').output_format.required, ['summary', 'blocked', 'assumptions']);
  for (const field of ['test', 'command', 'files']) assert.ok(byId('reproduce').output_format.properties[field], field);
  // No fix is built until the reproduction is kept, and the loop closes only on the bug's own check.
  assert.equal(byId('implement').when, "$reproduced.output.kept == 'true'");
  assert.equal(byId('implement').loop_group.max_iterations, 5);
  assert.match(byId('implement').loop_group.until_bash, /bug-check\.js" .*--most 5 --blocked "\$blocked"/);
  assert.match(byId('implement').loop_group.nodes[0].prompt, /reproduction's test files stay exactly as they were committed/);
  // A reproduction that isn't red, or isn't kept, asks; so does a fix bigger than a bug.
  for (const id of ['red-held', 'keep-held']) {
    assert.equal(byId(id).wait.labels['wh.topic'], 'no-reproduction', id);
    assert.deepEqual(byId(id).wait.options.map((o) => o.id), ['rework', 'stop'], id);
  }
  assert.equal(byId('red-held').when, "$red.output.red == 'false'");
  assert.equal(byId('size-blocked').when, "$size.output.blocked == 'true'");
  assert.equal(byId('size-blocked').wait.options, '$size.output.options');
  for (const id of ['tests', 'controls']) assert.equal(byId(id).when, "$size.output.blocked == 'false'", id);
  // From the tests on, the quick lane's own steps.
  const quick = built().read('wheelhouse-quick');
  const from = (w) => w.nodes.slice(w.nodes.findIndex((n) => n.id === 'lenses'));
  assert.deepEqual(from(bug), from(quick));
  assert.deepEqual(LANE_CAPS.bug, { minutes: 30, tokens: 2000000 });
});
