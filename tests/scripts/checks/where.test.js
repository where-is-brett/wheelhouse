// tests/scripts/checks/where.test.js
// Where a project's checks run (spec 4.1), worked out and never asked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rulesNameOurs, whereChecks, stuckHostChecks } from '../../../scripts/checks/where.js';

const own = { name: 'wheelhouse/checks', state: 'success', startedAt: null, app: 'me' };
const job = { name: 'build', state: 'success', startedAt: '2026-10-31T01:00:00Z', app: 'github-actions' };

test('with no CI, checks run here', () => {
  assert.equal(whereChecks({ host: 'github', contexts: [], hasWorkflows: false }), 'here');
});

test('with only our own status, checks stay here', () => {
  assert.equal(whereChecks({ host: 'github', contexts: [own], hasWorkflows: false }), 'here');
});

test('a hosted project with a workflow reads host', () => {
  assert.equal(whereChecks({ host: 'github', contexts: [], hasWorkflows: true }), 'host');
  assert.equal(whereChecks({ host: 'github', contexts: [own], hasWorkflows: true }), 'host');
});

test('a context from anything else reads host', () => {
  assert.equal(whereChecks({ host: 'github', contexts: [own, job], hasWorkflows: false }), 'host');
});

test('checks.where fixes the answer', () => {
  assert.equal(whereChecks({ setting: 'here', host: 'github', contexts: [job], hasWorkflows: true }), 'here');
  assert.equal(whereChecks({ setting: 'host', host: 'github', contexts: [], hasWorkflows: false }), 'host');
});

test('a local project reads here', () => {
  assert.equal(whereChecks({ host: 'local', contexts: [], hasWorkflows: true }), 'here');
});

test('while the rules still name our check, the runner keeps reporting, whatever else reports', () => {
  assert.equal(whereChecks({ host: 'github', contexts: [own, job], hasWorkflows: true, required: ['wheelhouse/checks'] }), 'here');
  assert.equal(whereChecks({ setting: 'host', host: 'github', contexts: [job], hasWorkflows: true, required: ['ci', 'wheelhouse/checks'] }), 'here');
});

test('rules that no longer name our check leave the checks with the host', () => {
  assert.equal(whereChecks({ host: 'github', contexts: [job], hasWorkflows: true, required: ['ci'], recorded: ['wheelhouse/checks'] }), 'host');
});

test('what setup recorded answers when the host can\'t be read', () => {
  assert.equal(whereChecks({ host: 'github', contexts: [job], hasWorkflows: true, required: null, recorded: ['wheelhouse/checks'] }), 'here');
  assert.equal(whereChecks({ host: 'github', contexts: [job], hasWorkflows: true, required: null, recorded: ['ci'] }), 'host');
});

test('neither the host nor setup can tell: no answer of its own, and the card says so', () => {
  assert.equal(rulesNameOurs({ required: null, recorded: null }), null);
  assert.equal(rulesNameOurs({ required: [], recorded: null }), false);
  assert.equal(rulesNameOurs({ required: ['wheelhouse/checks'], recorded: null }), true);
  assert.equal(whereChecks({ host: 'github', contexts: [job], hasWorkflows: true, required: null, recorded: null }), 'host');
});

test('the director\'s Keep reporting holds the checks here', () => {
  assert.equal(whereChecks({ host: 'github', contexts: [job], hasWorkflows: true, required: null, recorded: null, keepReporting: true }), 'here');
});

const T0 = '2026-10-31T01:00:00.000Z';
const at = (minutes) => new Date(Date.parse(T0) + minutes * 60000).toISOString();
const queued = { name: 'build', state: 'queued', startedAt: null, app: 'github-actions' };
const waited = (head, minutes, contexts = [queued]) => ({ head, contexts, firstSeen: T0, readAt: at(minutes) });

test('one stuck head is nothing and two are stuck', () => {
  assert.equal(stuckHostChecks([waited('a', 45)]), false);
  assert.equal(stuckHostChecks([waited('a', 45), waited('b', 31)]), true);
});

test('a head queued for under 30 minutes is not stuck', () => {
  assert.equal(stuckHostChecks([waited('a', 45), waited('b', 29)]), false);
});

test('a failure with no job having run is stuck at once', () => {
  const failed = [{ name: 'build', state: 'failure', startedAt: null, app: 'github-actions' }];
  assert.equal(stuckHostChecks([waited('a', 0, failed), waited('b', 0, failed)]), true);
});

test('a job that ran is never stuck, whatever it answered', () => {
  const ran = [{ name: 'build', state: 'failure', startedAt: T0, app: 'github-actions' }];
  const going = [{ name: 'build', state: 'running', startedAt: T0, app: 'github-actions' }];
  assert.equal(stuckHostChecks([waited('a', 90, ran), waited('b', 90, going)]), false);
});

test('a check from another app that never reports counts as stuck', () => {
  const quiet = [{ name: 'scanner', state: 'pending', startedAt: null, app: 'someone' }];
  assert.equal(stuckHostChecks([waited('a', 40, quiet), waited('b', 40, quiet)]), true);
});

test('our own status is never what is stuck', () => {
  const ours = [{ ...own, state: 'pending' }];
  assert.equal(stuckHostChecks([waited('a', 90, ours), waited('b', 90, ours)]), false);
});

test('a project in git alone checks here, whatever its setting says', () => {
  assert.equal(whereChecks({ setting: 'host', host: 'local' }), 'here');
});
