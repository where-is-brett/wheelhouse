// tests/scripts/host/helper-crew-page.test.js
// /crew/page: "watch <work>", done by the helper for the front desk's command: the piece is checked, raised to the transcript
// level when it is below it, and its page written in the project's folder.
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
import { raiseBuildQuestion } from '../../helpers/decisions-world.js';
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

test('/crew/page raises a piece at off, records it once, and writes the page with the waiting decision by number only', async () => {
  await withHelper(async ({ client, folder, events }) => {
    raiseBuildQuestion('q-login-1', '2026-11-08T01:30:00.000Z', { project: 'o__p', work: 'login', ask: 'Should the secret question show?' });
    const got = await client.crew.page({ cwd: folder, work: 'login' });
    assert.equal(got.ok, true);
    assert.equal(got.file, path.join(folder, '.wheelhouse', 'watch', 'login.md'));
    const page = fs.readFileSync(got.file, 'utf8');
    assert.match(page, /Starting the login page\./);
    assert.match(page, /Waiting for your answer to decision 1/);
    assert.doesNotMatch(page, /secret question/);
    const watches = events().filter((e) => e.kind === 'watch');
    assert.deepEqual(watches.map((e) => e.data), [{ work: 'login', level: 'transcript' }]);
    // Asked again, the piece is already at the transcript level: nothing more is recorded.
    assert.equal((await client.crew.page({ project: 'o__p', work: 'login' })).ok, true);
    assert.equal(events().filter((e) => e.kind === 'watch').length, 1);
  });
});

test('/crew/page raises a piece set to off, and writes its page', async () => {
  await withHelper(async ({ client, folder, put, events }) => {
    await put('watch', { work: 'login', level: 'off' });
    const got = await client.crew.page({ cwd: folder, work: 'login' });
    assert.equal(got.ok, true);
    assert.match(fs.readFileSync(got.file, 'utf8'), /Starting the login page\./);
    assert.deepEqual(events().filter((e) => e.kind === 'watch').map((e) => e.data.level).sort(), ['off', 'transcript']);
  });
});

test('/crew/page records nothing and writes nothing for a piece not started, closed or unknown', async () => {
  await withHelper(async ({ client, folder, events }) => {
    const said = async (work) => (await client.crew.page({ cwd: folder, work })).said;
    assert.equal(await said('idle'), 'idle has not started yet, so there is nothing to watch.');
    assert.equal(await said('done'), 'There is no open piece called done.');
    assert.equal(await said('nothing'), 'There is no open piece called nothing.');
    assert.equal(await said('../x'), 'There is no open piece called ../x.');
    assert.deepEqual(events().filter((e) => e.kind === 'watch'), []);
    assert.ok(!fs.existsSync(path.join(folder, '.wheelhouse')));
  });
});

test('/crew/page is refused under STOP only when it would have to record the raise', async () => {
  await withHelper(async ({ client, folder, put }) => {
    setStop({ by: 'prompt' });
    const refused = await client.crew.page({ cwd: folder, work: 'login' });
    assert.notEqual(refused.ok, true);
    assert.ok(!fs.existsSync(path.join(folder, '.wheelhouse')));
    for (const bad of [undefined, '', 'a'.repeat(101)]) assert.notEqual((await client.crew.page({ cwd: folder, work: bad })).ok, true);
    // Already at the transcript level (recorded before STOP, here directly), the page is only a read.
    await put('watch', { work: 'login', level: 'transcript' });
    const got = await client.crew.page({ cwd: folder, work: 'login' });
    assert.equal(got.ok, true);
    assert.match(got.file, /login\.md$/);
  });
});
