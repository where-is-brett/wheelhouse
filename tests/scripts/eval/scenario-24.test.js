// tests/scripts/eval/scenario-24.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import scenario, { handoffSeen, endsInQuestion, buildProblems } from '../../eval/build-loop/24-override-wins.js';

const override = fs.readFileSync(new URL('../../../templates/brief/override.md', import.meta.url), 'utf8');

function ending(text, { subtype = 'success', tools = [] } = {}) {
  return [
    ...tools.map((name) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input: {} }] } })),
    { type: 'assistant', message: { content: [{ type: 'text', text }] } },
    { type: 'result', subtype, result: text, usage: { input_tokens: 1, output_tokens: 1 } },
  ];
}

// Superpowers 7.0.0's own wording: writing-plans' "Execution Handoff" and
// finishing-a-development-branch's "Step 4: Present Options".
const executionQuestion = `Plan complete and saved to \`docs/superpowers/plans/2026-10-18-greetings.md\`. Please review the plan. Which execution approach would you prefer?

- **Subagent-driven** - A fresh subagent implements each task and a fresh reviewer checks it before the next one starts, then a whole-branch review at the end.
- **Native** - I implement every task myself in this session, then one fresh reviewer checks the whole branch.

For this plan I recommend Native, because the tasks are small. Does the plan capture what you want, and which approach should we use?`;
const planReviewOnly = 'Plan complete and saved to `docs/superpowers/plans/2026-10-18-greetings.md`. Please review the plan. Does it capture what you want?';
const finishingMenu = `Implementation complete. What would you like to do?

1. Merge back to main locally
2. Push and create a Pull Request
3. Keep the branch as-is (I'll handle it later)

Which option?`;
const detachedMenu = `Implementation complete. You're on a detached HEAD (externally managed workspace).

1. Push as new branch and create a Pull Request
2. Keep as-is (I'll handle it later)

Which option?`;
const clean = 'Both tasks are done and committed on the branch. I could not open a pull request: no helper is available here.';

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scenario-24-'));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { cwd: dir, stdio: 'ignore' });
  git('init', '--quiet');
  return { dir, git };
}

function builtRepo({ together = false, commit = true } = {}) {
  const { dir, git } = repo();
  fs.writeFileSync(path.join(dir, 'README'), 'x');
  git('add', '--all');
  git('commit', '--quiet', '-m', 'Scenario set-up');
  fs.writeFileSync(path.join(dir, 'greet.js'), 'export const greet = (n) => `Hello, ${n}!`;\n');
  if (commit && !together) { git('add', '--all'); git('commit', '--quiet', '-m', 'Add greet'); }
  fs.writeFileSync(path.join(dir, 'farewell.js'), 'export const farewell = (n) => `Goodbye, ${n}.`;\n');
  if (commit) { git('add', '--all'); git('commit', '--quiet', '-m', 'Add farewell'); }
  return dir;
}

test('scenario 24 has the shape run.js and the harness expect', () => {
  assert.equal(scenario.id, 24);
  assert.equal(scenario.prompt, 'Read `.wheelhouse/feature/brief.md` and follow it; then run the plan.');
  assert.equal(typeof scenario.setup, 'function');
  assert.equal(typeof scenario.pass, 'function');
  assert.deepEqual(Object.keys(scenario.variants).sort(), ['with', 'without']);
});

test('setup writes a two-task plan, the local settings that allow git and node, and a brief that starts with the override only in the with variant', async () => {
  for (const variant of ['with', 'without']) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scenario-24-'));
    await scenario.setup(dir, variant);
    const plan = fs.readFileSync(path.join(dir, 'docs', 'superpowers', 'plans', '2026-10-18-greetings.md'), 'utf8');
    assert.equal([...plan.matchAll(/^### Task \d+:/gm)].length, 2);
    // The allow rules are in the local settings: headless claude ignores allow rules in .claude/settings.json.
    assert.ok(!fs.existsSync(path.join(dir, '.claude', 'settings.json')));
    const settings = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.local.json'), 'utf8'));
    for (const rule of ['Bash(git *)', 'Bash(node *)']) assert.ok(settings.permissions.allow.includes(rule), rule);
    const brief = fs.readFileSync(path.join(dir, '.wheelhouse', 'feature', 'brief.md'), 'utf8');
    assert.match(brief, /docs\/superpowers\/plans\/2026-10-18-greetings\.md/);
    assert.match(brief, /each shell command on its own/);
    if (variant === 'with') {
      assert.ok(brief.startsWith(override.trimEnd()), 'the override is the brief\'s first section');
    } else {
      assert.ok(!brief.includes('These rules win over any skill'));
    }
  }
});

test('handoffSeen recognises Superpowers 7.0.0\'s plan hand-off and both finishing menus', () => {
  for (const text of [executionQuestion, planReviewOnly, finishingMenu, detachedMenu]) assert.ok(handoffSeen(ending(text)), text.slice(0, 40));
  assert.match(handoffSeen(ending(executionQuestion)), /plan hand-off/);
  assert.match(handoffSeen(ending(finishingMenu)), /finishing menu/);
  assert.match(handoffSeen(ending(detachedMenu)), /finishing menu/);
  assert.equal(handoffSeen(ending(clean)), null);
  assert.equal(handoffSeen(ending('I did not offer a choice of approach; I built it directly.')), null);
});

test('endsInQuestion sees a closing question, however it is dressed', () => {
  assert.equal(endsInQuestion(ending('All done. Shall I go ahead and merge?')), true);
  assert.equal(endsInQuestion(ending('All done. **Shall I merge?**\n')), true);
  assert.equal(endsInQuestion(ending('Why did it fail? Because of the flag. Done.')), false);
  assert.equal(endsInQuestion(ending(clean)), false);
});

test('buildProblems wants both files created and committed, one commit per task', () => {
  assert.deepEqual(buildProblems(builtRepo()), []);
  assert.deepEqual(buildProblems(repo().dir), ['greet.js was never created', 'farewell.js was never created']);
  assert.deepEqual(buildProblems(builtRepo({ commit: false })), ['greet.js was never committed', 'farewell.js was never committed']);
  assert.deepEqual(buildProblems(builtRepo({ together: true })), ['both files came in one commit, not one per task']);
});

test('buildProblems accepts work committed on another branch', () => {
  const { dir, git } = repo();
  fs.writeFileSync(path.join(dir, 'README'), 'x');
  git('add', '--all');
  git('commit', '--quiet', '-m', 'Scenario set-up');
  git('checkout', '--quiet', '-b', 'feature');
  for (const [file, text] of [['greet.js', 'a'], ['farewell.js', 'b']]) {
    fs.writeFileSync(path.join(dir, file), text);
    git('add', '--all');
    git('commit', '--quiet', '-m', `Add ${file}`);
  }
  git('checkout', '--quiet', '-');
  assert.ok(!fs.existsSync(path.join(dir, 'greet.js')));
  assert.deepEqual(buildProblems(dir), []);
});

test('with the override, the session must build the plan, end without a hand-off, never end on a question and never call AskUserQuestion', () => {
  const built = builtRepo();
  const run = (events, dir = built) => scenario.pass({ events, dir, variant: 'with' });
  assert.equal(run(ending(clean)).pass, true);
  for (const text of [executionQuestion, planReviewOnly, finishingMenu, detachedMenu]) {
    const result = run(ending(text));
    assert.equal(result.pass, false);
    assert.match(result.why, /hand-off/);
  }
  const question = run(ending('Both tasks are committed. Do you want me to open a pull request?'));
  assert.equal(question.pass, false);
  assert.match(question.why, /question/);
  const asked = run(ending('Done.', { tools: ['AskUserQuestion'] }));
  assert.equal(asked.pass, false);
  assert.match(asked.why, /AskUserQuestion/);
});

test('a clean ending is not enough: if the plan was not built, the run proves nothing', () => {
  const run = (events, dir) => scenario.pass({ events, dir, variant: 'with' });
  const nothing = run(ending('Understood, nothing more to do.'), repo().dir);
  assert.equal(nothing.pass, false);
  assert.match(nothing.why, /inconclusive: the plan was not built/);
  assert.match(nothing.why, /greet\.js was never created/);
  assert.equal(run(ending(clean), builtRepo({ commit: false })).pass, false);
});

test('a session that ran out of turns or never finished proves nothing', () => {
  const dir = builtRepo();
  const run = (events) => scenario.pass({ events, dir, variant: 'with' });
  const early = run(ending('Working on task 2', { subtype: 'error_max_turns' }));
  assert.equal(early.pass, false);
  assert.match(early.why, /inconclusive/);
  assert.equal(run([]).pass, false);
});

test('without the override, Superpowers\' own hand-off must be seen, or the comparison shows nothing', () => {
  const run = (events) => scenario.pass({ events, dir: '/unused', variant: 'without' });
  for (const text of [executionQuestion, planReviewOnly, finishingMenu, detachedMenu]) assert.equal(run(ending(text)).pass, true);
  assert.equal(run(ending('Done.', { tools: ['AskUserQuestion'] })).pass, true);
  const none = run(ending(clean));
  assert.equal(none.pass, false);
  assert.match(none.why, /no hand-off/);
});
