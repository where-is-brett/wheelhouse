// tests/scripts/feature/brief-asking.test.js
// What the brief and the override say about asking: build on the recommendation, stop only before a step that can't be
// undone, and the pull request waits on the decision (design section 6.4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderBrief } from '../../../scripts/feature/brief.js';
import { LANES } from '../../../scripts/lib/build-loop.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const pluginRoot = path.join(path.sep, 'plugins', 'wheelhouse');
const fields = (lane) => ({
  v: 1, work: 'login-page', lane, version: 1, goal: 'Let people sign in', done: ['Sign in works'], appetite: { sessions: 2, tokens: 400000 },
  rulings: [], routing: {}, shownFirst: false, plan: 'docs/plans/login.md', slices: 2,
});
const render = (lane) => renderBrief({ fields: fields(lane), pluginRoot });
const override = fs.readFileSync(path.join(root, 'templates', 'brief', 'override.md'), 'utf8');
const rule3 = override.split('\n').find((l) => l.startsWith('**3.'));

test('the brief tells the session to build on its recommendation and stop only before migrating real data, deleting, spending money or going live', () => {
  for (const lane of LANES) {
    const text = render(lane);
    assert.match(text, /build on your recommendation/i, lane);
    assert.match(text, /on your own branch, behind a feature switch or behind a clean seam/, lane);
    assert.match(text, /do the parts that don't depend on the answer/i, lane);
    assert.match(text, /stop only before a step that can't be undone: migrating real data, deleting anything, spending money, or going live/i, lane);
    assert.match(text, /never merge what depends on the answer/i, lane);
    assert.match(text, /marked as waiting on the decision/, lane);
  }
});

test('the brief says ask no longer pauses, and wait-for is for a step that cannot be undone with nothing else to do', () => {
  const text = render('feature');
  assert.doesNotMatch(text, /After you ask, stop work on that matter and end your turn/);
  assert.match(text, /node "[^"]*cli\.js" wait-for <questionId>/);
  assert.match(text, /Only `wait-for` sets the waiting phase and gives your slot up: asking does not/);
  assert.match(text, /answer <questionId> --applied/);
  assert.match(text, /rework/);
});

test('override rule 3 says a level 3 or 4 matter is asked, and the work goes on to the step that cannot be undone', () => {
  assert.ok(rule3, 'rule 3 is there');
  assert.match(rule3, /question for the director/);
  assert.match(rule3, /build on your recommendation/i);
  assert.match(rule3, /migrating real data, deleting anything, spending money, or going live/);
  assert.doesNotMatch(rule3, /you pause on it/);
  for (const lane of LANES) assert.ok(render(lane).includes(rule3), `${lane}: the brief carries rule 3 whole`);
});
