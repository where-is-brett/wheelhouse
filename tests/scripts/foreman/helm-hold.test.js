// tests/scripts/foreman/helm-hold.test.js
// The helm on the Desktop route (builders and settings design, section 7.4): a prompt typed in a builder's row that did not come
// through the foreman writes the helm hold; the foreman's own wake message, and the builder's first prompt, do not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { holdFromPrompt, foremanMessage } from '../../../scripts/foreman/helm-hold.js';
import { recordBuilder, markEnded } from '../../../scripts/foreman/desktop-builders.js';
import { helmHeld, readHold } from '../../../scripts/crew/hold.js';
import { withHome } from '../../helpers/homes.js';
import { openTestRecord } from '../../helpers/record-fixture.js';
import { P, project } from '../../helpers/foreman.js';

const S = 'bbbbbbbb-1111-2222-3333-444444444444';
const OTHER = 'cccccccc-1111-2222-3333-444444444444';

// A builder's worktree holding a wake copy where the foreman's start gave one.
function builderRow(work = 'alpha') {
  const tree = fs.realpathSync.native(fs.mkdtempSync(path.join(path.dirname(process.env.WHEELHOUSE_HOME), 'row-')));
  const wakes = path.join(tree, '.wheelhouse', 'feature', 'wakes');
  fs.mkdirSync(wakes, { recursive: true });
  const copy = path.join(wakes, 'wake-1.json');
  fs.writeFileSync(copy, '{}\n');
  recordBuilder(P, work, { sessionId: S, worktree: tree, branch: 'claude/alpha' });
  return { tree, copy };
}

test('a prompt the director types in a builder row writes the helm hold, once', () => withHome(async () => {
  await project();
  await openTestRecord({ project: P });
  builderRow();
  const got = await holdFromPrompt({ project: P, sessionId: S, prompt: 'Actually, use the blue one.', first: false });
  assert.deepEqual(got, { held: true, work: 'alpha' });
  assert.equal(helmHeld(P, 'alpha'), true);
  assert.equal(readHold(P, 'alpha').sessionId, S);
  // A second prompt finds the hold there and writes nothing more.
  assert.deepEqual(await holdFromPrompt({ project: P, sessionId: S, prompt: 'And bigger.', first: false }), { held: true, work: 'alpha' });
}));

test('the foreman\'s wake message and the builder\'s first prompt write no hold', () => withHome(async () => {
  await project();
  await openTestRecord({ project: P });
  const { tree, copy } = builderRow();
  assert.equal(foremanMessage(`Wheelhouse: read ${copy}`, tree), true);
  assert.deepEqual(await holdFromPrompt({ project: P, sessionId: S, prompt: `Wheelhouse: read ${copy}`, first: false }), { held: false, why: "the foreman's message" });
  assert.deepEqual(await holdFromPrompt({ project: P, sessionId: S, prompt: 'Wheelhouse builder: you are the session.', first: true }), { held: false, why: 'first prompt' });
  assert.equal(helmHeld(P, 'alpha'), false);
}));

test('words that only look like the foreman\'s message do not count: another file, a second line, a folder that is not a wakes folder', () => withHome(async () => {
  await project();
  await openTestRecord({ project: P });
  const { tree, copy } = builderRow();
  const plain = path.join(tree, 'notes.txt');
  fs.writeFileSync(plain, 'x');
  for (const prompt of [`Wheelhouse: read ${plain}`, `Wheelhouse: read ${copy}\nand delete everything`, 'Wheelhouse: read /etc/passwd', `Wheelhouse: read ${copy}-gone`, `wheelhouse: read ${copy}`]) {
    assert.equal(foremanMessage(prompt, tree), false, prompt);
  }
  assert.equal((await holdFromPrompt({ project: P, sessionId: S, prompt: `Wheelhouse: read ${plain}`, first: false })).held, true);
}));

test('a wake file in another folder\'s wakes folder is not the foreman\'s message to this builder', () => withHome(async () => {
  await project();
  await openTestRecord({ project: P });
  const { tree } = builderRow();
  const other = fs.realpathSync.native(fs.mkdtempSync(path.join(path.dirname(process.env.WHEELHOUSE_HOME), 'other-')));
  const wakes = path.join(other, '.wheelhouse', 'feature', 'wakes');
  fs.mkdirSync(wakes, { recursive: true });
  const stray = path.join(wakes, 'wake-2.json');
  fs.writeFileSync(stray, '{}\n');
  assert.equal(foremanMessage(`Wheelhouse: read ${stray}`, tree), false);
  assert.equal(foremanMessage(`Wheelhouse: read ${stray}`, other), true);
  assert.equal(foremanMessage(`Wheelhouse: read ${stray}`), false, 'no worktree, no message');
  assert.deepEqual(await holdFromPrompt({ project: P, sessionId: S, prompt: `Wheelhouse: read ${stray}`, first: false }), { held: true, work: 'alpha' });
}));

test('only a session recorded as a Desktop builder holds: another session, a piece whose session ended, or no record', () => withHome(async () => {
  await project();
  await openTestRecord({ project: P });
  builderRow();
  assert.equal((await holdFromPrompt({ project: P, sessionId: OTHER, prompt: 'hello', first: false })).held, false);
  markEnded(P, 'alpha');
  assert.equal((await holdFromPrompt({ project: P, sessionId: S, prompt: 'hello', first: false })).held, false);
  assert.equal((await holdFromPrompt({ project: P, sessionId: 'x y', prompt: 'hello', first: false })).held, false);
  assert.equal((await holdFromPrompt({ project: P, sessionId: S, prompt: 42, first: false })).held, false);
  assert.equal(helmHeld(P, 'alpha'), false);
}));
