// tests/scripts/feature/brief.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderBrief, amendBrief, implementLines } from '../../../scripts/feature/brief.js';
import { parseBrief, briefHash } from '../../../scripts/feature/files.js';
import { LANES } from '../../../scripts/lib/build-loop.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const pluginRoot = path.join(path.sep, 'plugins', 'wheelhouse');

const FIVE_LINES = [
  'Implement the work described by the user in the spec or tickets.',
  'Use /tdd where possible, at pre-agreed seams.',
  'Run typechecking regularly, single test files regularly, and the full test suite once at the end.',
  'Once done, use /code-review to review the work.',
  'Commit your work to the current branch.',
].join('\n\n');

const fields = (lane = 'feature') => ({
  v: 1,
  work: 'login-page',
  lane,
  version: 1,
  goal: 'Let people sign in',
  done: ['Sign in works', 'A wrong password is refused'],
  appetite: { sessions: 2, tokens: 400000 },
  rulings: [{ id: 'r-1', words: 'Use the existing session store' }],
  routing: { builder: 'model-a', reviewer: 'model-b', reviewerCritical: 'model-c', tester: 'model-d', mechanical: 'model-e' },
  shownFirst: false,
  plan: 'docs/plans/login.md',
  slices: 2,
});

const render = (lane, extra = {}) => renderBrief({ fields: { ...fields(lane), ...extra }, pluginRoot });

// The template files, less their path comment.
const template = (...parts) => fs.readFileSync(path.join(root, 'templates', 'brief', ...parts), 'utf8').replace(/^<!--[^\n]*-->\r?\n(\r?\n)?/, '');
const overrideText = () => template('override.md').trim();

// Everything after the override: the brief's own text.
const afterOverride = (text) => text.slice(text.indexOf(overrideText()) + overrideText().length);

const skillsIn = (text) => [...new Set(text.match(/\b(?:superpowers|mattpocock-skills):[a-z-]+/g) ?? [])].sort();

test('every brief carries the override whole, before any lane text', () => {
  for (const lane of LANES) {
    const text = render(lane);
    const { body } = parseBrief(text);
    assert.ok(body.trimStart().startsWith(overrideText()), `${lane}: the override opens the text after the JSON block`);
    assert.ok(text.indexOf(overrideText()) < text.indexOf('# Your lane'), `${lane}: before the lane section`);
    assert.ok(text.indexOf(overrideText()) < text.indexOf('# The goal'), `${lane}: before the goal`);
  }
});

test('each lane names the skills section 5.1 gives it, and no others', () => {
  const every = ['mattpocock-skills:resolving-merge-conflicts', 'superpowers:verification-before-completion'];
  const review = ['superpowers:receiving-code-review', 'superpowers:requesting-code-review'];
  const allowed = {
    quick: [...every, 'mattpocock-skills:code-review', 'mattpocock-skills:tdd'],
    small: [...every, ...review, 'superpowers:executing-plans', 'superpowers:test-driven-development', 'superpowers:using-git-worktrees', 'superpowers:writing-plans'],
    feature: [
      ...every, 'superpowers:receiving-code-review',
      'superpowers:dispatching-parallel-agents', 'superpowers:subagent-driven-development', 'superpowers:systematic-debugging',
      'superpowers:test-driven-development', 'superpowers:using-git-worktrees', 'superpowers:writing-plans',
    ],
    bug: [...every, 'mattpocock-skills:code-review', 'mattpocock-skills:tdd', 'superpowers:systematic-debugging'],
  };
  for (const lane of LANES) {
    // The lane's text, with the override (which names skills unprefixed) cut out.
    const named = skillsIn(afterOverride(render(lane)));
    assert.deepEqual(named, [...allowed[lane]].sort(), lane);
  }
  // The lanes' own gaps, spelled out.
  assert.ok(!skillsIn(afterOverride(render('small'))).includes('superpowers:subagent-driven-development'));
  assert.ok(!skillsIn(afterOverride(render('quick'))).includes('superpowers:writing-plans'));
  assert.match(render('small'), /superpowers:using-git-worktrees[\s\S]*superpowers:writing-plans[\s\S]*superpowers:executing-plans/);
  assert.match(render('small'), /ask --kind extra-plan --plan/);
  assert.match(render('feature'), /wheelhouse:tester/);
  assert.match(render('feature'), /600 lines/);
});

test('the quick brief carries the five lines byte for byte', () => {
  const text = render('quick');
  assert.ok(text.includes(FIVE_LINES), 'the five lines, each its own paragraph');
  assert.equal(implementLines(), FIVE_LINES);
  assert.ok(text.indexOf('mattpocock-skills:tdd') < text.indexOf('mattpocock-skills:code-review'), 'tdd is started before code-review');
  assert.doesNotMatch(text, /implement:(begin|end)/, 'the markers are not in the brief');
  assert.doesNotMatch(afterOverride(text), /superpowers:(writing-plans|executing-plans)/, 'no plan');

  // The installed copy, line endings evened, is accepted; any other text is refused.
  assert.ok(renderBrief({ fields: fields('quick'), pluginRoot, implementText: `${FIVE_LINES}\n` }).includes(FIVE_LINES));
  assert.ok(renderBrief({ fields: fields('quick'), pluginRoot, implementText: `\n${FIVE_LINES.replace(/\n/g, '\r\n')}\r\n` }).includes(FIVE_LINES));
  assert.throws(() => renderBrief({ fields: fields('quick'), pluginRoot, implementText: FIVE_LINES.replace('regularly,', 'often,') }), /\/implement/);
  assert.throws(() => renderBrief({ fields: fields('quick'), pluginRoot, implementText: `${FIVE_LINES}\n\nPush it.` }), /\/implement/);
});

test("the bug brief starts systematic-debugging and never Matt's diagnosing-bugs", () => {
  for (const lane of LANES) assert.doesNotMatch(render(lane), /diagnosing-bugs/, lane);
  const text = render('bug');
  assert.match(text, /superpowers:systematic-debugging/);
  assert.match(text, /with `ask` that says what is missing/, 'cannot reproduce goes to ask');
  assert.match(text, /`blocked`/, 'works as designed reports blocked');
  assert.match(text, /`partial`/, 'a bigger cause reports partial');
  assert.ok(text.includes(FIVE_LINES), 'a one-step cause carries on with the quick lane loop');
  assert.match(text, /regression test/);
});

test('no brief tells the session to use AskUserQuestion, merge, or wait for a menu', () => {
  for (const lane of LANES) {
    const rest = afterOverride(render(lane));
    for (const line of rest.split('\n')) {
      if (/AskUserQuestion/.test(line)) assert.match(line, /\b[Nn]ever\b/, `${lane}: ${line}`);
      // A skill's name (resolving-merge-conflicts) is not an instruction to merge.
      if (/\bmerge\b/i.test(line.replace(/[a-z-]+:[a-z-]+/g, ''))) assert.match(line, /\b[Nn]ever\b|\bdo not\b|\bdon't\b|\bnot\b/, `${lane}: ${line}`);
      if (/\bmenu\b/i.test(line)) assert.match(line, /\b[Nn]o\b|\b[Nn]ever\b|\bnot\b/, `${lane}: ${line}`);
      assert.doesNotMatch(line, /finishing-a-development-branch/, lane);
    }
    assert.match(rest, /AskUserQuestion/, `${lane}: says plainly not to use it`);
    assert.match(rest, /node "[^"]*cli\.js" ask /, `${lane}: how to ask`);
    assert.match(rest, /node "[^"]*cli\.js" open-pr --title/, `${lane}: how to open the pull request`);
    assert.match(rest, /node "[^"]*cli\.js" report/, `${lane}: how to report`);
  }
});

test('the commands carry the real plugin root', () => {
  const text = render('small');
  assert.ok(text.includes(`node "${path.join(pluginRoot, 'scripts', 'feature', 'cli.js')}" ask`));
  assert.doesNotMatch(text, /\{\{|\}\}/, 'no placeholder is left');
  assert.throws(() => renderBrief({ fields: fields(), pluginRoot: 'a"b' }), /plugin root/);
  assert.throws(() => renderBrief({ fields: fields(), pluginRoot: '' }), /plugin root/);
});

test('models come only from the routing given', () => {
  const text = render('feature');
  for (const model of ['model-a', 'model-b', 'model-c', 'model-d', 'model-e']) assert.ok(text.includes(model), model);
  assert.match(text, /wheelhouse:builder/);
  assert.match(text, /wheelhouse:reviewer/);
  assert.match(text, /wheelhouse:tester/);

  // A role with no model, or no routing at all, uses the session's own default.
  const bare = renderBrief({ fields: { ...fields('feature'), routing: { builder: 'model-a' } }, pluginRoot });
  assert.ok(bare.includes('model-a'));
  for (const model of ['model-b', 'model-c', 'model-d', 'model-e']) assert.ok(!bare.includes(model), model);
  assert.match(bare, /session's own default/);
  const none = renderBrief({ fields: { ...fields('quick'), routing: {} }, pluginRoot });
  assert.ok(!/model-/.test(none));
  assert.match(none, /session's own default/);

  // No model name sits in a template.
  for (const file of ['brief.md', 'override.md', 'lanes/quick.md', 'lanes/small.md', 'lanes/feature.md', 'lanes/bug.md']) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'templates', 'brief', file), 'utf8'), /\b(opus|sonnet|haiku|fable|gpt|claude-\d)/i, file);
  }
});

test('the goal, the done contract, the appetite and the rulings are in the brief', () => {
  const text = render('small');
  assert.match(text, /Let people sign in/);
  assert.match(text, /1\. Sign in works\n2\. A wrong password is refused/);
  assert.match(text, /turn each line into a test before any code/i);
  assert.match(text, /2 sessions/);
  assert.match(text, /400000 tokens/);
  assert.match(text, /r-1: Use the existing session store/);
  assert.match(text, /docs\/plans\/login\.md/);
  const none = renderBrief({ fields: { ...fields('small'), rulings: [], plan: undefined, slices: undefined }, pluginRoot });
  assert.match(none, /No rulings apply/);
  // The JSON block is valid and unchanged by rendering.
  assert.deepEqual(parseBrief(text).fields, fields('small'));
  assert.throws(() => renderBrief({ fields: { ...fields(), lane: 'huge' }, pluginRoot }), /can't be read/);
});

test('an amended brief says what changed and has a new hash', () => {
  const original = render('feature');
  const now = '2026-10-19T03:04:05.000Z';
  const amended = amendBrief(original, { change: 'The director wants sign in by email only', now });
  const { fields: after, body } = parseBrief(amended);
  assert.equal(after.version, 2);
  assert.deepEqual({ ...after, version: 1 }, parseBrief(original).fields);
  assert.match(body.trimStart(), /^# What changed\n\n- 19 October 2026 \(version 2\): The director wants sign in by email only\n/);
  assert.ok(body.includes(overrideText()), 'the override is still whole');
  assert.ok(body.indexOf('# What changed') < body.indexOf(overrideText()));
  assert.notEqual(briefHash(amended), briefHash(original));

  // A second amendment adds to the same section, newest first.
  const again = amendBrief(amended, { change: 'Drop the second slice', now: '2026-10-20T00:00:00Z' });
  const second = parseBrief(again);
  assert.equal(second.fields.version, 3);
  assert.equal(second.body.match(/# What changed/g).length, 1);
  assert.match(second.body, /# What changed\n\n- 20 October 2026 \(version 3\): Drop the second slice\n- 19 October 2026 \(version 2\): The director wants sign in by email only\n/);

  assert.throws(() => amendBrief('not a brief', { change: 'x', now }), /can't be read/);
  assert.throws(() => amendBrief(original, { change: '', now }), /change/);
  assert.throws(() => amendBrief(original, { change: 'x', now: 'yesterday' }), /time/);
});
