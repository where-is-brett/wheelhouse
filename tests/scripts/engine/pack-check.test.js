// tests/scripts/engine/pack-check.test.js
// The workflow pack's own check and its digest (Archon design, sections 7.1, 7.2 and 12.1): the shipped pack passes,
// and each rule the check holds is shown refusing a pack that breaks it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkPack, packDigest, readWorkflow, nodesOf, PACK_DIR, WHEELHOUSE_PLUGIN } from '../../../scripts/engine/pack-check.js';
import { tempFolder } from '../../helpers/homes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const COPIES = ['codebase-design', 'pr', 'review-standards', 'review-spec', 'frontend-design'];

// A copy of the shipped pack in a scratch folder, with `edit(workflow)` applied to one of its workflows (the quick
// lane's unless `name` says), and `add` ({ name: workflow }) written beside them.
function packWith(edit = () => {}, { prompt, name = 'wheelhouse-quick', add = {} } = {}) {
  const dir = tempFolder('wh-pack-');
  fs.cpSync(PACK_DIR, dir, { recursive: true });
  const write = (title, workflow) => fs.writeFileSync(path.join(dir, `${title}.yaml`), `# engine/archon/pack/${title}.yaml\n${JSON.stringify(workflow, null, 2)}\n`);
  for (const [title, workflow] of Object.entries(add)) write(title, workflow);
  const workflow = readWorkflow(fs.readFileSync(path.join(dir, `${name}.yaml`), 'utf8'));
  edit(workflow);
  write(name, workflow);
  if (prompt) prompt(dir);
  return dir;
}
const node = (workflow, id) => nodesOf(workflow.nodes).find((n) => n.node.id === id).node;
const problems = (dir) => checkPack(dir, { skillCopies: COPIES });

test('the pack sits in the plugin where the check looks', () => {
  assert.equal(PACK_DIR, path.join(ROOT, 'engine', 'archon', 'pack'));
  assert.equal(WHEELHOUSE_PLUGIN, 'wheelhouse@wheelhouse');
});

test('checkPack passes the shipped pack', () => {
  assert.deepEqual(problems(PACK_DIR), []);
  assert.deepEqual(checkPack(PACK_DIR), [], 'with the plugin\'s own copies');
});

const fixMain = () => readWorkflow(fs.readFileSync(path.join(PACK_DIR, 'wheelhouse-fix-main.yaml'), 'utf8'));

test('checkPack accepts wheelhouse-bug, which takes the work input', () => {
  const bug = readWorkflow(fs.readFileSync(path.join(PACK_DIR, 'wheelhouse-bug.yaml'), 'utf8'));
  assert.equal(bug.name, 'wheelhouse-bug');
  assert.equal(bug.inputs.work.required, true);
  assert.deepEqual(problems(PACK_DIR), []);
});

test('checkPack accepts wheelhouse-fix-main, which takes the work input', () => {
  assert.equal(fixMain().name, 'wheelhouse-fix-main');
  assert.equal(fixMain().inputs.work.required, true);
  assert.deepEqual(problems(PACK_DIR), []);
});

test('the fix-main lane has no preview, approval or ready step, and its merge comes after the signed review', () => {
  const ids = fixMain().nodes.map((n) => n.id);
  for (const gone of ['preview', 'approval', 'rejected', 'ready']) assert.equal(ids.includes(gone), false, gone);
  const merge = fixMain().nodes.find((n) => n.id === 'merge');
  assert.match(merge.bash, /scripts\/engine\/merge-fix\.js" --run "\$WORKFLOW_ID" --artefacts "\$ARTIFACTS_DIR"/);
  assert.equal(merge.when, "$sign.output.clean == 'true'");
  assert.ok(ids.indexOf('merge') > ids.indexOf('sign'));
  // After the merge only the lesson, which changes nothing.
  assert.deepEqual(ids.slice(ids.indexOf('merge') + 1), ['lesson', 'lesson-blocked', 'lesson-record']);
});

test('the fix-main lane re-runs the main line first, and builds only when that left it red', () => {
  const nodes = fixMain().nodes;
  const ids = nodes.map((n) => n.id);
  assert.deepEqual(ids.slice(0, 3), ['order', 'rerun', 'implement']);
  assert.match(nodes[1].bash, /scripts\/engine\/fix-rerun\.js" .*--base "\$BASE_BRANCH"/);
  const implement = nodes.find((n) => n.id === 'implement');
  assert.equal(implement.when, "$rerun.output.green == 'false'");
  assert.equal(implement.loop_group.nodes[0].prompt_file, 'prompts/fix-main.md');
  // The same guards as the quick lane before review: tests and agent files.
  for (const id of ['tests', 'controls', 'held', 'sign', 'review-held']) assert.ok(ids.includes(id), id);
});

test('checkPack refuses a Claude step without the Wheelhouse plugin', () => {
  assert.match(problems(packWith((w) => { delete node(w, 'review-spec').plugins; })).join('\n'), /review-spec doesn't name the Wheelhouse plugin/);
  assert.match(problems(packWith((w) => { node(w, 'review-spec').plugins.push('superpowers@claude-plugins-official'); })).join('\n'), /review-spec names a plugin other than Wheelhouse/);
});

test('checkPack refuses a misspelt skill name', () => {
  const found = problems(packWith((w) => { node(w, 'build').skills = ['wheelhouse:codebase-desing']; })).join('\n');
  assert.match(found, /build names the skill wheelhouse:codebase-desing, which matches no copy/);
  assert.match(problems(packWith((w) => { node(w, 'build').skills = ['codebase-design']; })).join('\n'), /names the skill codebase-design without the wheelhouse: prefix/);
});

test('checkPack refuses a loop without max_iterations', () => {
  assert.match(problems(packWith((w) => { delete node(w, 'implement').loop_group.max_iterations; })).join('\n'), /implement is a loop with no max_iterations/);
  const loop = problems(packWith((w) => { w.nodes.push({ id: 'again', depends_on: ['order'], plugins: ['wheelhouse@wheelhouse'], loop: { prompt: 'x', until_bash: 'true', max_iterations: 2 } }); })).join('\n');
  assert.match(loop, /again is a loop step, which Archon runs without its plugins/);
});

test('checkPack refuses a model name', () => {
  assert.match(problems(packWith((w) => { node(w, 'review-spec').model = 'claude-sonnet-4-5'; })).join('\n'), /review-spec names a model/);
  assert.match(problems(packWith(() => {}, { prompt: (dir) => fs.appendFileSync(path.join(dir, 'prompts', 'lesson.md'), '\nUse Opus for this.\n') })).join('\n'), /prompts\/lesson\.md names a model/);
  assert.deepEqual(problems(packWith((w) => { node(w, 'review-spec').model = 'large'; })), [], 'a tier is not a model name');
});

test('checkPack refuses an AI step with no blocked exit', () => {
  assert.match(problems(packWith((w) => { w.nodes = w.nodes.filter((n) => n.id !== 'implement-blocked'); })).join('\n'), /build has no wait for its blocked exit/);
  assert.match(problems(packWith((w) => { delete node(w, 'review-spec').output_format.properties.blocked; })).join('\n'), /review-spec has no blocked field/);
  assert.match(problems(packWith((w) => { w.nodes = w.nodes.filter((n) => n.id !== 'review-spec-blocked'); })).join('\n'), /review-spec has no wait for its blocked exit/);
});

test('checkPack refuses a step that posts a verdict or calls gh outside the broker', () => {
  assert.match(problems(packWith((w) => { node(w, 'open-pr').bash += ' && /opt/homebrew/bin/gh pr merge 1'; })).join('\n'), /open-pr calls a gh other than the broker/);
  assert.match(problems(packWith((w) => { node(w, 'open-pr').bash += ' && gh pr comment 1 --body "<!-- archon-review-report -->"'; })).join('\n'), /open-pr posts a review verdict/);
});

test('checkPack refuses a step that moves the worktree with git before it takes the run\'s overlay out', () => {
  for (const command of ['git rebase origin/main', 'git pull --ff-only', 'git checkout main', 'git merge origin/main', 'git switch other', 'git reset --hard HEAD~1', 'git stash', 'git -C . rebase main', 'git -c core.editor=true rebase main', 'git --no-pager rebase main', 'git restore .']) {
    assert.match(problems(packWith((w) => { node(w, 'open-pr').bash = `${command} && ${node(w, 'open-pr').bash}`; })).join('\n'), /open-pr moves the worktree with git/, command);
  }
  const released = 'node "$WHEELHOUSE_ROOT/scripts/engine/order-copy.js" --release && git rebase origin/main';
  assert.deepEqual(problems(packWith((w) => { node(w, 'open-pr').bash = `${released} && ${node(w, 'open-pr').bash}`; })), []);
  // A release after the move is too late.
  assert.match(problems(packWith((w) => { node(w, 'open-pr').bash = `git rebase origin/main && node "$WHEELHOUSE_ROOT/scripts/engine/order-copy.js" --release`; })).join('\n'), /open-pr moves the worktree with git/);
  // Reading git is no move.
  assert.deepEqual(problems(packWith((w) => { node(w, 'open-pr').bash = `git log --oneline && git diff HEAD~1 && git merge-base HEAD main && ${node(w, 'open-pr').bash}`; })), []);
});

test('checkPack reads a long run of git options at once', () => {
  const options = '-c '.repeat(200);
  const dir = packWith((w) => { node(w, 'open-pr').bash = `git ${options}x && ${node(w, 'open-pr').bash}`; });
  const check = `import { checkPack } from ${JSON.stringify(pathToFileURL(path.join(ROOT, 'scripts', 'engine', 'pack-check.js')).href)}; checkPack(${JSON.stringify(dir)}, { skillCopies: ${JSON.stringify(COPIES)} });`;
  const got = spawnSync(process.execPath, ['--input-type=module', '-e', check], { timeout: 20000, encoding: 'utf8' });
  assert.equal(got.signal, null, 'the check did not finish in time');
  assert.equal(got.status, 0, got.stderr);
});

test('checkPack refuses a prompt without the shared rules', () => {
  const found = problems(packWith(() => {}, { prompt: (dir) => {
    const file = path.join(dir, 'prompts', 'review-spec.md');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('{{rules}}', ''));
  } })).join('\n');
  assert.match(found, /prompts\/review-spec\.md doesn't include the shared rules/);
  const rules = problems(packWith(() => {}, { prompt: (dir) => fs.writeFileSync(path.join(dir, 'prompts', 'rules.md'), '<!-- engine/archon/pack/prompts/rules.md -->\nBe kind.\n') })).join('\n');
  assert.match(rules, /rules\.md lacks the no-person line/);
  assert.match(rules, /rules\.md lacks the loop line/);
});

test('checkPack refuses a step of a workflow that names no work input', () => {
  assert.match(problems(packWith((w) => { delete w.inputs; })).join('\n'), /wheelhouse-quick doesn't take the work input/);
});

test('packDigest changes when one prompt changes', () => {
  const dir = packWith();
  const before = packDigest(dir);
  assert.match(before, /^[0-9a-f]{64}$/);
  assert.equal(packDigest(dir), before, 'the same files give the same digest');
  fs.appendFileSync(path.join(dir, 'prompts', 'review-spec.md'), '\nOne more line.\n');
  assert.notEqual(packDigest(dir), before);
});

// A lane that fans a task block out over a list, and the block, whose one AI step's blocked exit the lane waits on
// after the fan-out.
const blocked = { type: 'boolean' };
const trialBlock = () => ({
  name: 'wheelhouse-trial-task',
  description: 'One task',
  inputs: { task: { required: true, description: 'The task' } },
  returns: 'record',
  nodes: [
    { id: 'build', plugins: [WHEELHOUSE_PLUGIN], prompt_file: 'prompts/implement.md', output_format: { type: 'object', properties: { summary: { type: 'string' }, blocked }, required: ['summary', 'blocked'] } },
    { id: 'record', depends_on: ['build'], bash: 'echo "{}"' },
  ],
});
const trialLane = () => ({
  name: 'wheelhouse-trial',
  description: 'A trial lane',
  inputs: { work: { required: true, description: 'The work' } },
  nodes: [
    { id: 'tasks', bash: 'echo \'["1"]\'' },
    { id: 'each', depends_on: ['tasks'], include: 'wheelhouse-trial-task', fan_out: { items: '$tasks.output', as: 'task', max_parallel: 1 } },
    { id: 'tasks-done', depends_on: ['each'], bash: 'records=$each.output; echo "{}"', output_format: { type: 'object', properties: { blocked }, required: ['blocked'] } },
    { id: 'tasks-blocked', depends_on: ['tasks-done'], when: "$tasks-done.output.blocked == 'true'", wait: { attention: 'q', form: 'select', options: [] } },
  ],
});
const withTrial = (edit = () => {}, block = trialBlock()) => packWith(edit, { name: 'wheelhouse-trial', add: { 'wheelhouse-trial': trialLane(), 'wheelhouse-trial-task': block } });

test('checkPack passes a lane whose task block\'s blocked exit is waited on after the fan-out', () => {
  assert.deepEqual(problems(withTrial()), []);
});

test('checkPack refuses a task block whose blocked exit no lane waits on', () => {
  const found = problems(withTrial((w) => { w.nodes = w.nodes.filter((n) => n.id !== 'tasks-blocked'); })).join('\n');
  assert.match(found, /build has no wait for its blocked exit/);
});

test('checkPack refuses a lane whose wait after the fan-out isn\'t on the blocked flag', () => {
  const found = problems(withTrial((w) => { w.nodes[3].when = "$tasks-done.output.clean == 'false'"; })).join('\n');
  assert.match(found, /build has no wait for its blocked exit/);
});

test('checkPack refuses a lane whose step after the fan-out doesn\'t read the fan-out\'s output', () => {
  const found = problems(withTrial((w) => { w.nodes[2].bash = 'cat "$ARTIFACTS_DIR/blocked.json"'; })).join('\n');
  assert.match(found, /build has no wait for its blocked exit/);
});

test('checkPack refuses an include of a workflow not in the pack', () => {
  assert.match(problems(withTrial((w) => { w.nodes[1].include = 'wheelhouse-nothing'; })).join('\n'), /each includes wheelhouse-nothing, which isn't in the pack/);
});

test('checkPack refuses a fan-out of a block that runs more than one task at a time', () => {
  assert.match(problems(withTrial((w) => { w.nodes[1].fan_out.max_parallel = 2; })).join('\n'), /each runs its block's instances side by side/);
});
