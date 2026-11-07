// tests/scripts/host/helper-data-route.test.js
// Which data a piece's before-and-after runs on: test data unless the director approved the real route (design section 7).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import { run as realRun } from '../../../scripts/lib/run.js';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { setStop } from '../../../scripts/lib/stop.js';
import { openTestRecord } from '../../helpers/record-fixture.js';
import { makeBareRemote, LOCAL_PATHS } from '../../helpers/git-fixture.js';
import { as, shortHome, testAddress } from '../../helpers/homes.js';
import { REFUSED, dataComparison, routeApproved } from '../../../scripts/host/data-route.js';
import { PLAIN_KINDS, PROTECTED_KINDS, makeEvent } from '../../../scripts/state/events.js';
import { readConfig } from '../../../scripts/gate/guardrails.js';

// No host tool runs for real, and the log stays empty.
const hostLog = [];
const hostGuard = guardedRun(realRun, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const COMMAND = 'node tools/print-tables.js';
const snap = (rows) => ({ tables: [{ name: 'boats', rows, sample: [] }] });
const config = (route) => ({ dataCheck: { command: COMMAND, ...(route === undefined ? {} : { route }) } });
const approval = (command = COMMAND) => ({ kind: 'data-route-approved', data: { command } });

const runner = (label, log) => async (commit, command) => {
  log.push({ label, commit, command });
  return snap(commit === BASE ? 3 : 4);
};

test('with no approved route the data runs on test data and the note says so', async () => {
  const log = [];
  const test_ = await dataComparison({ config: config(), runTest: runner('test', log), runReal: runner('real', log), base: BASE, head: HEAD });
  assert.deepEqual(test_, { ran: true, route: 'test', before: snap(3), after: snap(4) });
  assert.deepEqual(log.map((l) => [l.label, l.commit]), [['test', BASE], ['test', HEAD]]);
  // A project that asks for the real route and has no approval runs on test data, and is told why.
  const asked = await dataComparison({ config: config('real'), approvals: [], runTest: runner('test', log), runReal: runner('real', log), base: BASE, head: HEAD });
  assert.equal(asked.route, 'test');
  assert.equal(asked.realRefused, REFUSED.unapproved);
  assert.equal(log.filter((l) => l.label === 'real').length, 0, 'the real route never ran');
  // No data command at all: nothing runs.
  assert.deepEqual(await dataComparison({ config: {}, runTest: runner('test', log), base: BASE, head: HEAD }), { ran: false, why: 'this project names no data command' });
});

test('the real route is refused without a signed approval', async () => {
  const log = [];
  for (const approvals of [[], [approval('node tools/other.js')], [{ kind: 'note', data: { command: COMMAND } }], undefined]) {
    const got = await dataComparison({ config: config('real'), approvals, runTest: runner('test', log), runReal: runner('real', log), base: BASE, head: HEAD });
    assert.equal(got.route, 'test');
    assert.equal(got.realRefused, REFUSED.unapproved);
  }
  assert.equal(log.filter((l) => l.label === 'real').length, 0);
  assert.equal(routeApproved({ approvals: [approval()], command: COMMAND }), true);
  assert.equal(routeApproved({ approvals: [approval()], command: `${COMMAND} --all` }), false);
  // The approval is a signed kind: an agent has no way to make one through the plain writer.
  assert.ok(PROTECTED_KINDS.includes('data-route-approved'), 'it is a signed kind');
  assert.ok(!PLAIN_KINDS.includes('data-route-approved'), 'and no plain one');
  assert.throws(() => makeEvent({ kind: 'data-route-approved', data: { command: COMMAND, extra: 1 } }), /only the command/);
  assert.throws(() => makeEvent({ kind: 'data-route-approved', data: { command: 'a\nb' } }), /one line/);
});

test('the real route runs only the approved command, through the helper', async () => {
  const log = [];
  const ok = await dataComparison({ config: config('real'), approvals: [approval()], runTest: runner('test', log), runReal: runner('real', log), base: BASE, head: HEAD });
  assert.equal(ok.route, 'real');
  assert.equal('realRefused' in ok, false);
  assert.deepEqual(log, [{ label: 'real', commit: BASE, command: COMMAND }, { label: 'real', commit: HEAD, command: COMMAND }]);
  // The default branch's command changed since the approval: the approval is for the old one, so it is test data.
  const changed = await dataComparison({
    config: { dataCheck: { command: `${COMMAND} --everything`, route: 'real' } }, approvals: [approval()], runTest: runner('test', log), runReal: runner('real', log), base: BASE, head: HEAD,
  });
  assert.equal(changed.route, 'test');
  // Approved, but this computer has no read-only access set up: refused in plain words, test data.
  const noAccess = await dataComparison({ config: config('real'), approvals: [approval()], runTest: runner('test', log), base: BASE, head: HEAD });
  assert.equal(noAccess.route, 'test');
  assert.equal(noAccess.realRefused, REFUSED.noAccess);
});

test('a command that fails gives no comparison, in plain words', async () => {
  const got = await dataComparison({ config: config(), runTest: async () => { throw new Error('the sandbox could not start'); }, base: BASE, head: HEAD });
  assert.equal(got.ran, false);
  assert.match(got.why, /could not be run: the sandbox could not start/);
});

test('the configuration reads the data command and its route, and refuses a route that is neither', () => {
  const read = (dataCheck) => readConfig(JSON.stringify({ v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [], dataCheck }));
  assert.equal(read({ command: COMMAND }).dataCheck.command, COMMAND);
  assert.equal(read({ command: COMMAND, route: 'real' }).dataCheck.route, 'real');
  for (const bad of [{ command: COMMAND, route: 'live' }, { command: '' }, { route: 'test' }, { command: COMMAND, writes: true }, { command: 'a\nb' }]) {
    assert.throws(() => read(bad), /./, JSON.stringify(bad));
  }
});

test('/data/check is refused under STOP, and for a branch that is not a feature\'s', async () => {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const home = shortHome();
  try {
    await as(home, async () => {
      writeProject('o__p', {
        folder: os.tmpdir(), remoteUrl: remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' },
      });
      await openTestRecord({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url });
      const helper = await startHelper({ run: hostGuard, address: testAddress(process.env.WHEELHOUSE_HOME), adapterFor: async () => ({ defaultBranch: async () => 'main' }), envFor: async () => ({}) });
      try {
        const client = helperClient({ address: helper.address });
        const refused = await client.dataCheck({ project: 'o__p', branch: 'main' });
        assert.equal(refused.ok, false);
        assert.match(refused.refused, /feature branch/);
        setStop({ by: 'prompt', now: () => new Date('2026-11-08T01:00:00.000Z') });
        assert.deepEqual(await client.dataCheck({ project: 'o__p', branch: 'feature/w-tide-1' }), { ok: false, refused: 'All stop is on' });
      } finally {
        await helper.close();
      }
    });
  } finally {
    remote.cleanup();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
