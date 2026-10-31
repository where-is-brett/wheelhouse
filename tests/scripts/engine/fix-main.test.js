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

import { fixOrder, fixDecision } from '../../../scripts/engine/fix-main.js';

const INCIDENT = { id: 'red-main-0123456789', what: 'red', kind: 'red-main', suspect: 41, work: 'fix-main-red-main-0123456789', fixes: [] };
const record = (runId, state, extra = {}) => ({ at: '2026-10-30T10:00:00.000Z', data: { work: INCIDENT.work, lane: 'fix-main', engine: 'fake', runId, state, ...extra } });
const decide = (over = {}) => fixDecision({ incident: INCIDENT, runs: [], green: false, stop: false, stopped: [], merged: [], kept: {}, ...over });

test('fixOrder gives a level-1 fix-main order naming the incident', () => {
  const order = fixOrder(INCIDENT, { config: { testCommand: 'npm test', routing: {} }, settings: {} });
  assert.equal(order.lane, 'fix-main');
  assert.equal(order.work, INCIDENT.work);
  assert.equal(order.level, 1);
  assert.equal(order.incident, INCIDENT.id);
  assert.match(order.goal, /main line's checks pass again/);
  assert.deepEqual(order.done, [{ command: 'npm test', expect: 0 }]);
  assert.deepEqual(order.protectedFiles, []);
  assert.equal(order.showFirst, false);
  assert.deepEqual(order.caps, { minutes: 30, tokens: 2000000 });
});

test('fixOrder with revert names the suspect', () => {
  assert.match(fixOrder(INCIDENT, { config: { testCommand: 'npm test' }, revert: true }).goal, /Undo pull request #41/);
  assert.throws(() => fixOrder({ ...INCIDENT, suspect: null }, { config: { testCommand: 'npm test' }, revert: true }), /suspect/);
});

test('fixDecision: no open red-main incident is nothing to do', () => {
  assert.deepEqual(decide({ incident: null }), { act: 'none' });
});

test('fixDecision: green checks close the incident, whatever the runs', () => {
  assert.deepEqual(decide({ green: true }), { act: 'close' });
  assert.deepEqual(decide({ green: true, runs: [record('r1', 'started')] }), { act: 'close' });
});

test('fixDecision: under All stop nothing starts', () => {
  assert.deepEqual(decide({ stop: true }), { act: 'wait', why: 'stop' });
});

test('fixDecision: no run yet starts the first', () => {
  assert.deepEqual(decide(), { act: 'start', revert: false });
  assert.deepEqual(decide({ green: null }), { act: 'start', revert: false }, 'an unknown main line is still red until it reads green');
});

test('fixDecision: a run under way waits', () => {
  assert.deepEqual(decide({ runs: [record('r1', 'started')] }), { act: 'wait', why: 'running' });
  assert.deepEqual(decide({ runs: [record('r1', 'started'), record('r1', 'paused')] }), { act: 'wait', why: 'running' });
});

test('fixDecision: a run All stop cancelled is carried on, once, on its branch', () => {
  const runs = [record('r1', 'started', { branch: 'wh/fix' }), record('r1', 'ended', { outcome: 'cancelled' })];
  assert.deepEqual(decide({ runs, stopped: ['r1'] }), { act: 'start', carryOn: true, branch: 'wh/fix', after: 'r1' });
  assert.deepEqual(decide({ runs, stopped: ['r1'], kept: { carried: ['r1'] } }), { act: 'card', run: 'r1', why: 'cancelled' });
});

test('fixDecision: a run that ended without a merge while main is red brings the card once', () => {
  const runs = [record('r1', 'started'), record('r1', 'ended', { outcome: 'failed' })];
  assert.deepEqual(decide({ runs }), { act: 'card', run: 'r1', why: 'failed' });
  assert.deepEqual(decide({ runs, kept: { carded: ['r1'] } }), { act: 'wait', why: 'card' });
  // A cap's cancel is a run that didn't fix it.
  assert.deepEqual(decide({ runs: [record('r1', 'ended', { outcome: 'cancelled' })] }), { act: 'card', run: 'r1', why: 'cancelled' });
});

test('fixDecision: a merged fix waits for the main line to read green, and brings the card if it reads red', () => {
  const runs = [record('r1', 'ended', { outcome: 'completed' })];
  assert.deepEqual(decide({ runs, merged: ['r1'], green: null }), { act: 'wait', why: 'merged' });
  assert.deepEqual(decide({ runs, merged: ['r1'], green: false }), { act: 'card', run: 'r1', why: 'still-red' });
  // Not merged, and the main line can't be read: no card on an unknown.
  assert.deepEqual(decide({ runs, green: null }), { act: 'wait', why: 'unknown' });
});

test('fixDecision: an answer to the card starts the next attempt', () => {
  const runs = [record('r1', 'ended', { outcome: 'failed' })];
  assert.deepEqual(decide({ runs, kept: { carded: ['r1'], next: { revert: true } } }), { act: 'start', revert: true });
  assert.deepEqual(decide({ runs, kept: { carded: ['r1'], next: { revert: false } } }), { act: 'start', revert: false });
});

import { weakensChecks } from '../../../scripts/engine/fix-main.js';

const CONFIG = { ciFiles: [], criticalAreas: [], plugin: false };
const cleanTests = { clean: true, findings: '' };

test('a deleted test weakens the checks, from the run\'s own tests step', () => {
  const got = weakensChecks({ paths: ['src/a.js'], config: CONFIG, tests: { clean: false, findings: 'deletes the test tests/a.test.js' } });
  assert.equal(got.length, 1);
  assert.match(got[0], /deletes the test tests\/a\.test\.js/);
});

test('a missing tests step weakens the checks', () => {
  assert.match(weakensChecks({ paths: ['src/a.js'], config: CONFIG, tests: null })[0], /tests step/);
});

test('changes to CI, .archon policy, agent control files and coverage settings weaken the checks', () => {
  for (const file of ['.github/workflows/ci.yml', '.archon/sdlc/policy/maintainers.json', 'CLAUDE.md', '.claude/settings.json', 'vitest.config.ts', '.nycrc']) {
    const got = weakensChecks({ paths: ['src/a.js', file], config: CONFIG, tests: cleanTests });
    assert.equal(got.length, 1, file);
    assert.match(got[0], new RegExp(file.replace(/[.]/g, '\\.')));
  }
  // The project's own CI files and critical-area checks count too.
  assert.equal(weakensChecks({ paths: ['ops/pipeline.yml'], config: { ...CONFIG, ciFiles: ['ops/**'] }, tests: cleanTests }).length, 1);
});

test('a change to source only does not weaken the checks', () => {
  assert.deepEqual(weakensChecks({ paths: ['src/a.js', 'tests/a.test.js'], config: CONFIG, tests: cleanTests }), []);
});

test('changes to the files that hold the test command or its thresholds weaken the checks', () => {
  for (const file of ['package.json', 'web/package.json', 'pyproject.toml', 'setup.cfg', 'Makefile', 'tsconfig.json', 'tsconfig.build.json']) {
    const got = weakensChecks({ paths: ['src/a.js', file], config: CONFIG, tests: cleanTests });
    assert.equal(got.length, 1, file);
    assert.match(got[0], new RegExp(file.replace(/[.]/g, '\\.')));
  }
});

test('the same commit opens one incident, with the merged change as its suspect', () => {
  const commit = 'a'.repeat(40);
  const incident = redMainIncident({ commit, suspect: 7 });
  assert.equal(redMainIncident({ commit, suspect: 7 }).id, incident.id);
  assert.notEqual(redMainIncident({ commit: 'b'.repeat(40) }).id, incident.id);
  assert.equal(incident.suspect, 7);
  assert.equal(incident.kind, RED_MAIN);
});
