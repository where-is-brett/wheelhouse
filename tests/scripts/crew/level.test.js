// tests/scripts/crew/level.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
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
