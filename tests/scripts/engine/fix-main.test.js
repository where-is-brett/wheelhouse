// tests/scripts/engine/fix-main.test.js
// The rules for a red main line (Archon design, section 7.7): the incident a red main line's hold opens, the fix's
// work and order, what the dispatcher does about it each tick, and what would make the main line green by weakening
// its checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RED_MAIN, FIX_LANE, redMainIncident, openRedMain, suspectOf } from '../../../scripts/engine/fix-main.js';

const ASK = { id: '2c4e6a8b:1e2d3c4b', runId: '2c4e6a8b', opens: 'red-main', suspect: 41, line: 'The main line is red.' };

test('the red main line\'s ask opens a red-main incident naming the suspect', () => {
  const incident = redMainIncident(ASK);
  assert.match(incident.id, /^red-main-[0-9a-f]{10}$/);
  assert.equal(incident.kind, RED_MAIN);
  assert.equal(incident.suspect, 41);
  assert.equal(incident.work, `${FIX_LANE}-${incident.id}`);
  assert.match(incident.what, /main line/);
  assert.equal(redMainIncident(ASK).id, incident.id, 'the same ask gives the same incident');
  assert.notEqual(redMainIncident({ ...ASK, id: 'other:ask' }).id, incident.id);
  assert.equal(redMainIncident({ ...ASK, suspect: null }).suspect, null);
});

test('suspectOf reads "#12", "PR 12" and "pull request 12", and gives null for none', () => {
  assert.equal(suspectOf('main CI is red since PR 41 merged.'), 41);
  assert.equal(suspectOf('Broken by #12, it seems'), 12);
  assert.equal(suspectOf('pull request 7 is the suspect'), 7);
  assert.equal(suspectOf('the default branch is red'), null);
  assert.equal(suspectOf(undefined), null);
  assert.equal(suspectOf('#0 is no pull request'), null);
});

test('openRedMain gives the open red-main incident, or null', () => {
  assert.equal(openRedMain({}), null);
  assert.equal(openRedMain({ incidents: { open: [{ id: 'bad-total', what: 'x', fixes: [] }] } }), null);
  const red = { id: 'red-main-0123456789', what: 'x', fixes: [], kind: 'red-main', work: 'fix-main-red-main-0123456789' };
  assert.deepEqual(openRedMain({ incidents: { open: [{ id: 'bad-total', what: 'x', fixes: [] }, red] } }), red);
});
