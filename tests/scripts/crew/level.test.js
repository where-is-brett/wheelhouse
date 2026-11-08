// tests/scripts/crew/level.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { stateDir } from '../../../scripts/lib/paths.js';
import { LEVELS, watchCrewIn, levelFor, levelOf } from '../../../scripts/crew/level.js';

const steps = { watchCrew: { value: 'steps' } };
const open = (...ids) => Object.fromEntries(ids.map((id) => [id, { step: 'building' }]));

test('level: the levels are off, steps and transcript', () => {
  assert.deepEqual(LEVELS, ['off', 'steps', 'transcript']);
});

test('level: an unreadable value counts as off', () => {
  assert.equal(watchCrewIn({ watchCrew: { value: 'loud' } }), 'off');
  assert.equal(watchCrewIn(null), 'off');
  assert.equal(watchCrewIn({}), 'off');
  assert.equal(watchCrewIn({ watchCrew: { value: 'transcript' } }), 'transcript');
});

test("level: a piece's own choice beats the project", () => {
  const views = { features: open('login'), watch: { login: 'off' } };
  assert.equal(levelFor(views, steps, 'login'), 'off');
  assert.equal(levelFor(views, steps, 'other'), 'steps');
});

test('level: the choice ends when the piece closes', () => {
  const views = { features: { login: { step: 'closed' } }, watch: { login: 'off' } };
  assert.equal(levelFor(views, steps, 'login'), 'steps');
});

test('level: a missing watch view is no override', () => {
  assert.equal(levelFor({ features: open('login') }, steps, 'login'), 'steps');
  assert.equal(levelFor({}, steps, 'login'), 'steps');
});

test('level: a choice that is not a level is ignored', () => {
  assert.equal(levelFor({ features: open('login'), watch: { login: 'loud' } }, steps, 'login'), 'steps');
});

test('level: the Bosun follows the project only', () => {
  const views = { features: open('foreman'), watch: { foreman: 'transcript' } };
  assert.equal(levelFor(views, steps, 'foreman'), 'steps');
});

test('level: a records error gives off', () => {
  assert.equal(levelOf(null, 'login', { now: () => new Date() }), 'off');
  assert.equal(levelOf('../not a project', 'login', { now: () => new Date() }), 'off');
});

test('level: a project with no records takes the default', () => {
  assert.equal(levelOf('level-test-project', 'login', { now: () => new Date() }), 'steps');
});

// The records layer reads a record path that is not a folder as no records (listEvents never throws on it), so the
// level is the project default, not off; `off` is for a records error that does throw.
test('level: a state path that is a file, not a folder, reads as no records', () => {
  const project = 'level-file-project';
  fs.mkdirSync(path.dirname(stateDir(project)), { recursive: true });
  fs.writeFileSync(stateDir(project), 'not a folder');
  assert.equal(levelOf(project, 'login', { now: () => new Date() }), 'steps');
});
