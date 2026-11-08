// tests/scripts/host/helper-crew-helm.test.js
// /crew/helm: the director's words about a piece's helm, done by the helper for the front desk's command: the hold, its records
// and the stop are made here, and a window without the First Mate's seat is refused.
import { test, after } from 'node:test';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import { run as realRun } from '../../../scripts/lib/run.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { listEvents, makeEvent, writeEvent } from '../../../scripts/state/events.js';
import { openTestRecord } from '../../helpers/record-fixture.js';
import { holdFile } from '../../../scripts/crew/hold.js';
import { seatFile } from '../../../scripts/lib/first-mate-seat.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { sessionFile } from '../../../scripts/watcher/waker.js';
import { setStop } from '../../../scripts/lib/stop.js';
import { as, shortHome, tempFolder, testAddress } from '../../helpers/homes.js';

// No host tool runs for real: the helper's runs go through this, and the log stays empty.
const hostLog = [];
const hostGuard = guardedRun(realRun, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

let beat = 0;
const tick = () => new Date(Date.UTC(2026, 10, 8, 2, 0, beat++));
const step = (text) => `${JSON.stringify({ type: 'assistant', timestamp: '2026-11-08T01:00:00Z', message: { content: [{ type: 'text', text }] } })}\n`;

// A project with a helper running, and pieces: `login` building (session s1 with one said line), `idle` with work and no
// feature yet, `done` closed. `fn` gets { client, folder, put, events }.
async function withHelper(fn) {
  const home = shortHome();
  const configDir = tempFolder('wh-claude-');
  const savedConfig = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = configDir;
  try {
    await as(home, async () => {
      const folder = path.join(tempFolder('wh-crew-'), 'shop');
      fs.mkdirSync(path.join(folder, '.git'), { recursive: true });
      writeProject('o__p', { folder, remoteUrl: 'https://example.test/o/p.git', host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' } });
      await openTestRecord({ project: 'o__p' });
      const put = (kind, data) => writeEvent({ project: 'o__p', event: makeEvent({ kind, data, now: tick }), now: tick });
      for (const id of ['login', 'idle', 'done']) await put('work', { id, title: id, lane: 'small', visible: false, dependsOn: [] });
      await put('feature', { work: 'login', step: 'building' });
      await put('feature', { work: 'done', step: 'closed' });
      fs.mkdirSync(path.join(configDir, 'projects', 'a'), { recursive: true });
      fs.writeFileSync(path.join(configDir, 'projects', 'a', 's1.jsonl'), step('Starting the login page. More later.'));
      const kept = sessionFile('o__p', 'login');
      fs.mkdirSync(path.dirname(kept), { recursive: true });
      fs.writeFileSync(kept, JSON.stringify({ sessionId: 's1', worktree: folder }));
      const helper = await startHelper({ run: hostGuard, address: testAddress(home), adapterFor: async () => ({}), envFor: async () => ({}) });
      try {
        await fn({ client: helperClient({ address: helper.address }), folder, put, events: () => listEvents(stateDir('o__p'), { report: () => {} }) });
      } finally {
        await helper.close();
      }
    });
  } finally {
    if (savedConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = savedConfig;
  }
}


const OPEN = ['login is ready for you now. Run this to open it:', '```bash', 'node <plugin root>/scripts/crew/helm.js open login', '```'];

test('/crew/helm take holds the piece, records it and answers the command', async () => {
  await withHelper(async ({ client, folder, events }) => {
    const got = await client.crew.helm({ cwd: folder, work: 'login', action: 'take' });
    assert.equal(got.ok, true, got.refused);
    assert.deepEqual(got.lines, OPEN);
    assert.ok(fs.existsSync(holdFile('o__p', 'login')));
    assert.equal(events().filter((e) => e.kind === 'helm' && e.data.work === 'login').length, 1);
    const again = await client.crew.helm({ cwd: folder, work: 'login', action: 'take' });
    assert.equal(again.ok, false);
    assert.match(again.refused, /already at the helm/);
  });
});

test('/crew/helm steer holds a piece from its start, and back lets it go', async () => {
  await withHelper(async ({ client, folder, events }) => {
    const steered = await client.crew.helm({ cwd: folder, work: 'idle', action: 'steer' });
    assert.equal(steered.ok, true, steered.refused);
    assert.equal(events().find((e) => e.kind === 'helm' && e.data.work === 'idle').data.fromStart, true);
    const back = await client.crew.helm({ cwd: folder, work: 'idle', action: 'back' });
    assert.equal(back.ok, true, back.refused);
    assert.deepEqual(back.lines, ['idle is back with the crew.']);
    assert.equal(fs.existsSync(holdFile('o__p', 'idle')), false);
    assert.equal(events().filter((e) => e.kind === 'helm-ended').length, 1);
  });
});

test('/crew/helm now ends nothing for a piece not held, and refuses a bad action or name', async () => {
  await withHelper(async ({ client, folder }) => {
    assert.match((await client.crew.helm({ cwd: folder, work: 'login', action: 'now' })).refused, /not at the helm/);
    await client.crew.helm({ cwd: folder, work: 'login', action: 'take' });
    assert.match((await client.crew.helm({ cwd: folder, work: 'login', action: 'now' })).refused, /no run/);
    for (const bad of [{ action: 'drive', work: 'login' }, { action: 'take', work: '' }, { action: 'take', work: 'a'.repeat(101) }]) {
      assert.notEqual((await client.crew.helm({ cwd: folder, ...bad })).ok, true);
    }
  });
});

test('/crew/helm refuses a session that does not hold the seat, and takes one that does', async () => {
  await withHelper(async ({ client, folder }) => {
    const at = new Date().toISOString();
    fs.mkdirSync(path.dirname(seatFile('o__p')), { recursive: true });
    fs.writeFileSync(seatFile('o__p'), JSON.stringify({ session: 'seat-holder', pid: null, pidStart: null, folder, since: at, seenAt: at }));
    const other = await client.crew.helm({ cwd: folder, work: 'login', action: 'take', session: 'someone-else' });
    assert.equal(other.ok, false);
    assert.match(other.refused, /seat/);
    assert.equal(fs.existsSync(holdFile('o__p', 'login')), false);
    const holder = await client.crew.helm({ cwd: folder, work: 'login', action: 'take', session: 'seat-holder' });
    assert.equal(holder.ok, true, holder.refused);
  });
});

test('/crew/helm is refused under STOP and leaves no hold', async () => {
  await withHelper(async ({ client, folder }) => {
    setStop({ by: 'prompt' });
    assert.notEqual((await client.crew.helm({ cwd: folder, work: 'login', action: 'take' })).ok, true);
    assert.equal(fs.existsSync(holdFile('o__p', 'login')), false);
  });
});
