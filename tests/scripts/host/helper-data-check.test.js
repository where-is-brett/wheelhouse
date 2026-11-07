// tests/scripts/host/helper-data-check.test.js
// /data/check with a real remote and an injected runner: the folder, the sandbox settings, the data-work classification and the
// merge base; and /pr/open, which refuses data work whose body has no data section (design section 7).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import { run as realRun } from '../../../scripts/lib/run.js';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { openTestRecord } from '../../helpers/record-fixture.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { makeBareRemote, g, LOCAL_PATHS } from '../../helpers/git-fixture.js';
import { as, shortHome, tempFolder, testAddress } from '../../helpers/homes.js';
import { writeSessionProvenance } from '../../helpers/provenance.js';
import { DATA_HEADING } from '../../../scripts/proof/note.js';
import { stopDataRuns } from '../../../scripts/checks/data-run.js';

// No host tool runs for real, and the log stays empty.
const hostLog = [];
const hostGuard = guardedRun(realRun, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

const COMMAND = 'node tools/print-tables.js';
const CONFIG = {
  v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [],
  checks: { prepare: 'npm ci' }, dataCheck: { command: COMMAND, paths: ['warehouse/**/*.ddl'] },
};
const snap = (rows) => ({ tables: [{ name: 'boats', rows, sample: [{ key: 'w-tide-1', values: { status: 'new' } }] }] });

function write(dir, files) {
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
}

// A remote whose main holds the configuration; main moves on after the branches were cut, so the merge base is not main's tip.
async function remote() {
  const host = await makeBareRemote({ repo: 'o/p' });
  const work = tempFolder('wh-work-');
  await g(work, 'init', '-q', '-b', 'main');
  write(work, { 'README.md': 'r\n', '.claude/wheelhouse.json': JSON.stringify(CONFIG) });
  await g(work, 'add', '-A');
  await g(work, 'commit', '-q', '-m', 'Base');
  await g(work, 'remote', 'add', 'origin', host.url);
  await g(work, 'push', '-q', 'origin', 'main');
  const base = await g(work, 'rev-parse', 'HEAD');
  const branch = async (name, files) => {
    await g(work, 'checkout', '-q', '-b', name, 'main');
    write(work, files);
    await g(work, 'add', '-A');
    await g(work, 'commit', '-q', '-m', name);
    await g(work, 'push', '-q', 'origin', name);
    return g(work, 'rev-parse', 'HEAD');
  };
  const head = await branch('feature/w-tide-1', { 'db/migrations/001_boats.sql': 'create table boats;\n', 'src/pages/tides/index.tsx': 'x\n' });
  const other = await branch('feature/w-tide-2', { 'src/lib/tides.ts': 'x\n' });
  const own = await branch('feature/w-tide-3', { 'warehouse/boats.ddl': 'x\n' });
  await g(work, 'checkout', '-q', 'main');
  write(work, { 'CHANGELOG.md': 'later\n' });
  await g(work, 'add', '-A');
  await g(work, 'commit', '-q', '-m', 'Main moves on');
  await g(work, 'push', '-q', 'origin', 'main');
  return { host, base, head, other, own };
}

async function withHelper(fn) {
  const r = await remote();
  const home = shortHome();
  const runs = [];
  const adapterCalls = [];
  const control = { result: 'passed', tail: 'no', hold: null, after: null };
  try {
    return await as(home, async () => {
      writeProject('o__p', {
        folder: os.tmpdir(), remoteUrl: r.host.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' },
      });
      const { computer, publicKey } = makeSigningKey();
      enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
      await openTestRecord({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: r.host.url });
      writeSessionProvenance('o__p', 'sess-1');
      const adapter = { defaultBranch: async () => 'main', openPr: async (args) => { adapterCalls.push(args); return { number: 7 }; } };
      const check = async (args) => {
        runs.push(args);
        if (control.hold) await control.hold(args);
        if (control.after) control.after();
        if (control.result !== 'passed') return { result: control.result, tail: control.tail };
        return { result: 'passed', tail: `Preparing...\n${JSON.stringify(snap(args.commit === r.base ? 3 : 4))}\n` };
      };
      const helper = await startHelper({ run: hostGuard, address: testAddress(home), adapterFor: async () => adapter, envFor: async () => ({}), check });
      try {
        return await fn({ client: helperClient({ address: helper.address }), address: helper.address, r, runs, adapterCalls, control });
      } finally {
        await helper.close();
      }
    });
  } finally {
    r.host.cleanup();
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test('/data/check runs the command at the merge base and the head, in its own folder, once each, with the project\'s prepare step', async () => {
  await withHelper(async ({ client, r, runs }) => {
    const got = await client.dataCheck({ project: 'o__p', branch: 'feature/w-tide-1' });
    assert.equal(got.ok, true, JSON.stringify(got));
    assert.equal(got.dataWork, true, 'a migration is data work');
    assert.deepEqual(got.changes.map((c) => c.path).sort(), ['db/migrations/001_boats.sql', 'src/pages/tides/index.tsx']);
    assert.equal(got.ran, true);
    assert.equal(got.route, 'test');
    assert.deepEqual(got.before, snap(3));
    assert.deepEqual(got.after, snap(4));
    // The merge base is where the branch was cut, not main's tip, which moved on.
    assert.deepEqual(runs.map((x) => x.commit), [r.base, r.head]);
    for (const run of runs) {
      assert.equal(run.work, 'data-feature/w-tide-1');
      assert.equal(run.main, false);
      assert.deepEqual(run.settings, { testCommand: COMMAND, prepare: 'npm ci', minutes: 5, network: false, once: true });
      assert.ok(run.signal instanceof AbortSignal, 'All stop reaches it');
      await g(run.source, 'cat-file', '-e', run.commit);
    }
  });
});

test('/data/check classifies by the default places and by the project\'s own paths, and says so for a change that is not data work', async () => {
  await withHelper(async ({ client }) => {
    const other = await client.dataCheck({ project: 'o__p', branch: 'feature/w-tide-2' });
    assert.equal(other.dataWork, false);
    const own = await client.dataCheck({ project: 'o__p', branch: 'feature/w-tide-3' });
    assert.equal(own.dataWork, true, 'warehouse/**/*.ddl is named in the project\'s dataCheck paths');
    const missing = await client.dataCheck({ project: 'o__p', branch: 'feature/w-tide-9' });
    assert.deepEqual(missing, { ok: false, refused: 'the branch is not on the host yet' });
  });
});

test('/data/check gives a failing command as no comparison with its why, and runs nothing twice', async () => {
  await withHelper(async ({ client, runs, control }) => {
    control.result = 'failed';
    const failed = await client.dataCheck({ project: 'o__p', branch: 'feature/w-tide-1' });
    assert.equal(failed.ok, true);
    assert.equal(failed.dataWork, true);
    assert.equal(failed.ran, false);
    assert.equal(failed.failed, true);
    assert.match(failed.why, /could not be run: it failed/);
    assert.equal(failed.tail, 'no', 'the end of its output is given');
    assert.equal(runs.length, 1, 'the base run failed, so the head was not run, and nothing was repeated');
    control.result = 'timed-out';
    assert.match((await client.dataCheck({ project: 'o__p', branch: 'feature/w-tide-1' })).why, /ran out of time/);
    control.result = 'could-not-run';
    assert.match((await client.dataCheck({ project: 'o__p', branch: 'feature/w-tide-1' })).why, /could not run/);
  });
});

test('/pr/open refuses data work whose body has no data section, and opens it with one', async () => {
  await withHelper(async ({ client, adapterCalls }) => {
    const open = (branch, body) => client.openPr({ project: 'o__p', head: branch, title: 't', body, session: 'sess-1' });
    const refused = await open('feature/w-tide-1', 'Shipped it.');
    assert.equal(refused.ok, false);
    assert.match(refused.refused, /data work \(db\/migrations\/001_boats\.sql\)/);
    assert.equal(adapterCalls.length, 0, 'the host is not asked');
    assert.equal((await open('feature/w-tide-1', `## What changed\n\nx\n\n## ${DATA_HEADING}\n\nNo comparison was made.\n`)).ok, true);
    // A change that is not data work, and a branch the helper can't read, are not held up here.
    assert.equal((await open('feature/w-tide-2', 'Shipped it.')).ok, true);
    assert.equal((await open('feature/w-tide-9', 'Shipped it.')).ok, true);
    assert.equal(adapterCalls.length, 3);
  });
});

test('/data/check runs nothing for a change that is not data work, unless the report declares data', async () => {
  await withHelper(async ({ client, runs }) => {
    const plain = await client.dataCheck({ project: 'o__p', branch: 'feature/w-tide-2' });
    assert.deepEqual([plain.ok, plain.dataWork, plain.ran, plain.why], [true, false, false, 'this change is not data work']);
    assert.equal(runs.length, 0, 'no prepare and no run, and no turn taken');
    const declared = await client.dataCheck({ project: 'o__p', branch: 'feature/w-tide-2', declared: true });
    assert.equal(declared.ran, true);
    assert.equal(runs.length, 2);
  });
});

test('a failing command gives the last ten lines of its output, capped, with backticks neutralised', async () => {
  await withHelper(async ({ client, control }) => {
    control.result = 'failed';
    control.tail = `${Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n')}\nerror in \`boats\``;
    const got = await client.dataCheck({ project: 'o__p', branch: 'feature/w-tide-1' });
    assert.equal(got.failed, true);
    assert.ok(got.tail.startsWith('line 21 | '), got.tail);
    assert.ok(got.tail.endsWith("error in 'boats'"));
    assert.equal(got.tail.split(' | ').length, 10);
    control.tail = 'x'.repeat(5000);
    assert.ok((await client.dataCheck({ project: 'o__p', branch: 'feature/w-tide-1' })).tail.length <= 600);
  });
});

test('the tail of a failing command hides any line that looks like a secret, since it goes into the pull request body', async () => {
  await withHelper(async ({ client, control }) => {
    control.result = 'failed';
    control.tail = `connecting\ntoken ghp_${'a'.repeat(36)}\nerror: no database`;
    const got = await client.dataCheck({ project: 'o__p', branch: 'feature/w-tide-1' });
    assert.equal(got.failed, true);
    assert.doesNotMatch(JSON.stringify(got), /ghp_a/);
    assert.match(got.tail, /hidden/);
    assert.ok(got.tail.endsWith('error: no database'), got.tail);
  });
});

test('a run All stop ends part way comes back as stopped, not as a failed command', async () => {
  await withHelper(async ({ client, control }) => {
    control.result = 'could-not-run';
    control.after = () => stopDataRuns('o__p');
    const got = await client.dataCheck({ project: 'o__p', branch: 'feature/w-tide-1' });
    assert.deepEqual(got, { ok: false, refused: 'All stop is on' });
  });
});

test('/pr/open answers at once while a data run of the project is under way', async () => {
  await withHelper(async ({ client, runs, control, adapterCalls }) => {
    let release;
    // Held for the first run only: the head's run then goes straight through.
    control.hold = () => { control.hold = null; return new Promise((resolve) => { release = resolve; }); };
    const slow = client.dataCheck({ project: 'o__p', branch: 'feature/w-tide-1' });
    for (let i = 0; i < 400 && runs.length === 0; i += 1) await new Promise((resolve) => { setTimeout(resolve, 25); });
    assert.equal(runs.length, 1, 'the data run is under way');
    const quick = (value) => Promise.race([value, new Promise((resolve) => { setTimeout(() => resolve('waited'), 5000); })]);
    const open = (branch, body) => client.openPr({ project: 'o__p', head: branch, title: 't', body, session: 'sess-1' });
    assert.equal((await quick(open('feature/w-tide-2', 'Shipped it.'))).ok, true, 'another branch\'s pull request');
    const refused = await quick(open('feature/w-tide-1', 'Shipped it.'));
    assert.equal(refused.ok, false, 'a data pull request is judged, not held up');
    assert.match(refused.refused, /Add "data"/);
    assert.equal(adapterCalls.length, 1);
    release();
    assert.equal((await slow).ran, true);
  });
});

test('a data run is ended when the caller gives up on it', async () => {
  await withHelper(async ({ address, runs, control }) => {
    let signal = null;
    control.hold = (args) => new Promise((resolve) => { signal = args.signal; args.signal.addEventListener('abort', resolve, { once: true }); });
    const impatient = helperClient({ address, timeout: 4000 });
    const got = await impatient.dataCheck({ project: 'o__p', branch: 'feature/w-tide-1' });
    assert.match(got.refused, /did not answer in time/);
    for (let i = 0; i < 200 && !signal?.aborted; i += 1) await new Promise((resolve) => { setTimeout(resolve, 25); });
    assert.equal(runs.length >= 1, true);
    assert.equal(signal.aborted, true, 'the helper ended the run when the connection closed');
  });
});
