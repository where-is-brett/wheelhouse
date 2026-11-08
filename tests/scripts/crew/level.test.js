// tests/scripts/crew/level.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { stateDir } from '../../../scripts/lib/paths.js';
import { makeEvent } from '../../../scripts/state/events.js';
import { buildViews } from '../../../scripts/state/views.js';
import { LEVELS, watchCrewIn, levelFor, levelOf } from '../../../scripts/crew/level.js';

const steps = { watchCrew: { value: 'steps' } };
const open = (...ids) => Object.fromEntries(ids.map((id) => [id, { data: { step: 'building' } }]));
let tick = 0;
const ev = (kind, data) => makeEvent({ kind, data, now: () => new Date(Date.UTC(2026, 10, 8, 0, 0, tick++)) });
const viewsOf = (...events) => buildViews(events, []);

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
  const views = viewsOf(
    ev('feature', { work: 'login', step: 'building' }),
    ev('watch', { work: 'login', level: 'off' }),
    ev('feature', { work: 'login', step: 'closed' }),
  );
  assert.equal(levelFor(views, steps, 'login'), 'steps');
});

test('level: work closed and queued again drops the old choice, and a new choice counts', () => {
  const closed = [
    ev('feature', { work: 'login', step: 'building' }),
    ev('watch', { work: 'login', level: 'off' }),
    ev('feature', { work: 'login', step: 'closed' }),
    ev('feature', { work: 'login', step: 'started' }),
  ];
  assert.equal(levelFor(viewsOf(...closed), steps, 'login'), 'steps');
  assert.equal(levelFor(viewsOf(...closed, ev('watch', { work: 'login', level: 'transcript' })), steps, 'login'), 'transcript');
});

test('level: a real open piece keeps its choice', () => {
  const views = viewsOf(ev('feature', { work: 'login', step: 'building' }), ev('watch', { work: 'login', level: 'off' }));
  assert.equal(levelFor(views, steps, 'login'), 'off');
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

// A state path that exists but is not a folder can't be read, and a value that can't be read counts as off.
test('level: a state path that is a file, not a folder, gives off', () => {
  const project = 'level-file-project';
  fs.mkdirSync(path.dirname(stateDir(project)), { recursive: true });
  fs.writeFileSync(stateDir(project), 'not a folder');
  assert.equal(levelOf(project, 'login', { now: () => new Date() }), 'off');
});
