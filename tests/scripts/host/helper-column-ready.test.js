// tests/scripts/host/helper-column-ready.test.js
// The helper's record of a Thoroughness level ready (design section 14.6, "Where ready lives"): only the helper writes
// a column-ready record, and only after reading and checking the evaluation's records itself.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { stateDir, stopFile } from '../../../scripts/lib/paths.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { run } from '../../../scripts/lib/run.js';
import { openTestRecord } from '../../helpers/record-fixture.js';
import { listEvents } from '../../../scripts/state/events.js';
import { readyColumns } from '../../../scripts/state/views.js';
import { readConfig } from '../../../scripts/gate/guardrails.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { readiness } from '../../../scripts/routing/column-ready.js';
import { makeBareRemote, LOCAL_PATHS } from '../../helpers/git-fixture.js';
import { as, shortHome, testAddress, tempFolder } from '../../helpers/homes.js';
import { barRun, PINS } from '../../helpers/ready-records.js';

const hostLog = [];
const hostGuard = guardedRun(run, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

const adapter = { defaultBranch: async () => 'main' };

// A computer with the project set up, its state cloned, its configuration pinning `pins`, and an evaluations folder.
async function computer({ pins = { ...PINS, premium: 'model-best' } } = {}) {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const home = shortHome();
  const folder = tempFolder('wh-project-');
  fs.mkdirSync(path.join(folder, '.claude'));
  const config = { v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [], tiers: { pins } };
  fs.writeFileSync(path.join(folder, '.claude', 'wheelhouse.json'), JSON.stringify(config));
  const evals = tempFolder('wh-evals-');
  await as(home, async () => {
    writeProject('o__p', { folder, remoteUrl: remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' } });
    const { computer: id, publicKey } = makeSigningKey();
    enrol({ computer: id, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    await openTestRecord({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url });
  });
  const withHelper = (fn) => as(home, async () => {
    const helper = await startHelper({ run: hostGuard, address: testAddress(home), adapterFor: async () => adapter, envFor: async () => ({}), evalsFolder: evals });
    try { return await fn(helperClient({ address: helper.address })); } finally { await helper.close(); }
  });
  const readies = () => as(home, () => listEvents(stateDir('o__p'), { report: () => {} }).filter((e) => e.kind === 'column-ready'));
  return { home, evals, folder, config, withHelper, readies, cleanup: () => remote.cleanup() };
}

test('the helper records a level ready on a full set of the bar\'s records, and the level then counts', async () => {
  const c = await computer();
  try {
    barRun(c.evals, { level: 'lean' });
    const { records } = readiness({ evals: c.evals, level: 'lean', pins: PINS });
    await c.withHelper(async (client) => {
      const answer = await client.state.columnReady({ project: 'o__p', column: 'lean', pins: PINS, records });
      assert.equal(answer.ok, true, answer.refused);
      const [event] = await c.readies();
      assert.equal(event.id, answer.id);
      assert.deepEqual(event.data, { column: 'lean', pins: PINS, records, commit: 'abc123def456' });
      const views = await client.state.views({ project: 'o__p' });
      assert.deepEqual(readyColumns(views.views.columnsReady, readConfig(JSON.stringify(c.config))), ['lean']);
    });
  } finally { c.cleanup(); }
});

test('the helper refuses anything short of the bar, says why, and writes nothing', async () => {
  const c = await computer();
  try {
    barRun(c.evals, { level: 'lean', fail: (s, t) => s === '22' && t === 1 });
    barRun(c.evals, { level: 'lean', at: '2026-10-25T09:00:00.000Z', only: ['22'], from: 4, trials: 1 });
    barRun(c.evals, { level: 'lightest', at: '2026-10-25T10:00:00.000Z', from: 10 });
    const passing = (level) => fs.readdirSync(path.join(c.evals, '2026-10-25')).map((n) => `2026-10-25/${n}`)
      .filter((n) => JSON.parse(fs.readFileSync(path.join(c.evals, n), 'utf8')).level === level && n !== '2026-10-25/22-with-1.json');
    await c.withHelper(async (client) => {
      const ask = (body) => client.state.columnReady({ project: 'o__p', column: 'lean', pins: PINS, records: passing('lean'), ...body });
      const cases = [
        // A failed trial, though the caller leaves it out and names a later pass in its place.
        [{}, /scenario 22 trial 1 failed/],
        // Not Lean or Lightest.
        [{ column: 'thorough' }, /only Lean, Lightest or the premium model/],
        // The premium model's pass needs the premium pin the state holds, never the configuration's.
        [{ column: 'premium' }, /the premium model has no pin/],
        // Pins that aren't the configuration's now.
        [{ pins: { ...PINS, midSized: 'model-other' } }, /pins are not/],
        [{ pins: { ...PINS, premium: 'model-best' } }, /pins are not/],
        // Another level's records.
        [{ records: passing('lightest') }, /is not a trial any run at Lean on these pins saved/],
        [{ records: [] }, /not named/],
      ];
      for (const [body, why] of cases) {
        const answer = await ask(body);
        assert.equal(answer.ok, false, JSON.stringify(body));
        assert.match(answer.refused, why);
      }
      // Lightest's own set stands, on its own records.
      const lightest = await client.state.columnReady({ project: 'o__p', column: 'lightest', pins: PINS, records: passing('lightest') });
      assert.equal(lightest.ok, true, lightest.refused);
      assert.deepEqual((await c.readies()).map((e) => e.data.column), ['lightest']);
    });
  } finally { c.cleanup(); }
});

test('a forged record is caught by the helper\'s own read', async () => {
  const c = await computer();
  try {
    barRun(c.evals, { level: 'lean', record: (r, s, t) => (s === '33' && t === 2 ? { ...r, subagents: [{ type: 'wheelhouse:builder', model: 'model-best' }] } : r) });
    // Without the premium pin to look for, the records would pass: the helper takes it from the configuration.
    assert.equal(readiness({ evals: c.evals, level: 'lean', pins: PINS }).ok, true);
    const names = fs.readdirSync(path.join(c.evals, '2026-10-25')).map((n) => `2026-10-25/${n}`);
    // A record flipped to a pass after its run saved it.
    const file = path.join(c.evals, '2026-10-25', '20-with-1.json');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('"why": "stand-in pass"', '"why": "edited"'));
    await c.withHelper(async (client) => {
      const answer = await client.state.columnReady({ project: 'o__p', column: 'lean', pins: PINS, records: names });
      assert.equal(answer.ok, false);
      assert.match(answer.refused, /scenario 33 trial 2 doesn't stand: it names the premium model/);
      assert.match(answer.refused, /scenario 20 trial 1 doesn't stand: its record is not the one its run saved/);
      assert.deepEqual(await c.readies(), []);
    });
  } finally { c.cleanup(); }
});

test('no caller writes a column-ready record, and the helper writes none under STOP', async () => {
  const c = await computer();
  try {
    barRun(c.evals, { level: 'lean' });
    const { records } = readiness({ evals: c.evals, level: 'lean', pins: PINS });
    await c.withHelper(async (client) => {
      const forged = await client.state.write({ project: 'o__p', kind: 'column-ready', data: { column: 'lean', pins: PINS, records } });
      assert.equal(forged.ok, false);
      assert.match(forged.refused, /only the helper/);
      fs.writeFileSync(stopFile(), '');
      const stopped = await client.state.columnReady({ project: 'o__p', column: 'lean', pins: PINS, records });
      assert.equal(stopped.ok, false);
      assert.match(stopped.refused, /All stop/);
      assert.deepEqual(await c.readies(), []);
    });
  } finally { c.cleanup(); }
});
