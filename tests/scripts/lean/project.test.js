// tests/scripts/lean/project.test.js
// A Lean project on this computer (ruling P5-9): registered in lean.json, never project.json, found
// by its folder, with a state repository of its own that is never pushed, served by the helper
// before any host connection is made. A Claude Code project's record and routes stay as they were.
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { guardedRun, standInTools } from '../../helpers/host-stand-ins.js';
import { as, shortHome, testAddress } from '../../helpers/homes.js';
import { waitLongerOnTheHelper } from '../../helpers/until.js';
import { run } from '../../../scripts/lib/run.js';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { readProject, writeProject, projectForFolder, registeredProjects } from '../../../scripts/lib/projects.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { listEvents, makeEvent } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { lookRefusalLine } from '../../../scripts/lib/safe-git.js';
import { registerLean, readLean, registeredLeanProjects, LEAN_NO_HOST, LEAN_FOLDER } from '../../../scripts/lean/project.js';

// No real gh, glab, copilot or curl runs: the PATH finds the stand-ins first, and the helper's own
// runs go through a guard whose log stays empty.
const shims = standInTools();
const hostLog = [];
const hostGuard = guardedRun(run, { log: hostLog });
// Checked after each test: the stand-ins' folder goes with the file's other temporary folders.
afterEach(() => {
  assert.deepEqual(hostLog, [], 'no host tool ran through the helper');
  assert.deepEqual(shims.calls(), [], 'no host tool ran from the PATH');
});
after(() => shims.restore());

waitLongerOnTheHelper();

const PROJECT = 'shop';
const T0 = new Date('2026-10-23T01:00:00.000Z');

// A computer with a home of its own, an enrolled signing key and a project folder.
function computer() {
  const home = shortHome();
  const folder = path.join(home, 'work', 'shop');
  fs.mkdirSync(path.join(folder, 'src'), { recursive: true });
  return { home, folder, as: (fn) => as(home, fn) };
}

// A helper whose connection must never be asked for: a Lean project has none. It runs in this
// process, so the computer's home stays set until it is closed (one computer at a time).
async function helperOn(c, { envFor, adapterFor } = {}) {
  const asked = { env: [], adapter: [] };
  let tick = 0;
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = c.home;
  const helper = await c.as(() => startHelper({
    run: hostGuard,
    address: testAddress(c.home),
    envFor: envFor ?? (async (project) => { asked.env.push(project); throw new Error('no connection on this computer'); }),
    adapterFor: adapterFor ?? (async (project) => { asked.adapter.push(project); throw new Error('no adapter on this computer'); }),
    now: () => new Date(T0.getTime() + 1000 * (tick += 1)),
  }));
  return {
    asked,
    client: helperClient({ address: helper.address }),
    close: async () => {
      await c.as(() => helper.close());
      if (before === undefined) delete process.env.WHEELHOUSE_HOME;
      else process.env.WHEELHOUSE_HOME = before;
      fs.rmSync(c.home, { recursive: true, force: true });
    },
  };
}

const git = (dir, args) => run('git', args, { cwd: dir, env: { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });

test('a Lean project is found by its folder and has no project.json', async () => {
  const c = computer();
  await c.as(() => {
    const record = registerLean({ project: PROJECT, folder: c.folder, now: () => T0 });
    assert.deepEqual(record, {
      folder: c.folder, store: null, copy: null, test: null, identity: null, registeredAt: '2026-10-23T01:00:00.000Z',
    });
    const dir = path.join(c.home, 'projects', PROJECT);
    assert.equal(fs.existsSync(path.join(dir, 'lean.json')), true);
    assert.equal(fs.existsSync(path.join(dir, 'project.json')), false);
    assert.deepEqual(readLean(PROJECT), record);

    // Found from the folder and from inside it, as the hooks place a folder.
    const real = fs.realpathSync.native(c.folder);
    for (const where of [real, path.join(real, 'src')]) {
      assert.deepEqual(projectForFolder(where), { project: PROJECT, record: { folder: c.folder }, lean: true });
    }
    assert.equal(projectForFolder(path.join(c.home, 'work')), null);

    // Registering again keeps the record and its time; another folder for the same project is refused.
    assert.deepEqual(registerLean({ project: PROJECT, folder: c.folder, now: () => new Date('2026-10-24T00:00:00.000Z') }), record);
    const other = path.join(c.home, 'work', 'other');
    fs.mkdirSync(other);
    assert.throws(() => registerLean({ project: PROJECT, folder: other }), /registered for another folder/);
    // The same folder can't be a second project, and a relative or missing folder is refused.
    assert.throws(() => registerLean({ project: 'shop-two', folder: c.folder }), /already registered/);
    assert.throws(() => registerLean({ project: 'shop-two', folder: 'work/shop' }), /full path/);
    assert.throws(() => registerLean({ project: 'shop-two', folder: path.join(c.home, 'nowhere') }), /does not exist/);
    assert.throws(() => registerLean({ project: '../x', folder: other }), /folder name/);
  });
  fs.rmSync(c.home, { recursive: true, force: true });
});

test('readLean gives null for a damaged record, and the record\'s known fields are checked', async () => {
  const c = computer();
  await c.as(() => {
    registerLean({ project: PROJECT, folder: c.folder, now: () => T0 });
    const file = path.join(c.home, 'projects', PROJECT, 'lean.json');
    const good = JSON.parse(fs.readFileSync(file, 'utf8'));
    const bad = [
      { ...good, folder: 'relative' },
      { ...good, registeredAt: 'yesterday' },
      { ...good, store: 3 },
      { ...good, identity: { name: 'Ann' } },
      { ...good, test: '' },
    ];
    for (const record of bad) {
      fs.writeFileSync(file, JSON.stringify(record));
      assert.equal(readLean(PROJECT), null, JSON.stringify(record));
      assert.equal(projectForFolder(c.folder), null);
    }
    fs.writeFileSync(file, '{ not json');
    assert.equal(readLean(PROJECT), null);
    // A field no task has added yet is not carried.
    fs.writeFileSync(file, JSON.stringify({ ...good, identity: { name: 'Ann', email: 'ann@example.com' }, later: 1 }));
    assert.deepEqual(readLean(PROJECT), { ...good, identity: { name: 'Ann', email: 'ann@example.com' } });
  });
  fs.rmSync(c.home, { recursive: true, force: true });
});

test('readProject gives null for a Lean project, so host routes refuse it', async () => {
  const c = computer();
  await c.as(() => registerLean({ project: PROJECT, folder: c.folder, now: () => T0 }));
  const h = await helperOn(c);
  try {
    await c.as(() => {
      assert.equal(readProject(PROJECT), null);
      assert.deepEqual(registeredProjects(), []);
    });
    const merged = await h.client.merge({ project: PROJECT, number: 1 });
    assert.equal(merged.ok, false);
    assert.equal(merged.refused, LEAN_NO_HOST);
    assert.deepEqual(h.asked, { env: [], adapter: [] }, 'no connection or adapter was asked for');
  } finally {
    await h.close();
  }
});

test('a Lean project\'s state is a local repository that is never pushed', async () => {
  const c = computer();
  await c.as(() => registerLean({ project: PROJECT, folder: c.folder, now: () => T0 }));
  const h = await helperOn(c);
  try {
    const first = await h.client.state.write({ project: PROJECT, kind: 'note', data: { text: 'first' } });
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(first.pushed, false);
    const second = await h.client.state.write({ cwd: path.join(c.folder, 'src'), kind: 'note', data: { text: 'second' } });
    assert.equal(second.ok, true, JSON.stringify(second));

    const dir = await c.as(() => stateDir(PROJECT));
    assert.equal(fs.existsSync(path.join(dir, '.git')), true);
    assert.equal((await git(dir, ['remote'])).stdout.trim(), '', 'the state has no remote to push to');
    assert.equal((await git(dir, ['symbolic-ref', '--short', 'HEAD'])).stdout.trim(), 'record');
    const log = (await git(dir, ['log', '--format=%s%x09%an'])).stdout.trim().split('\n');
    assert.deepEqual(log, [`note ${second.id}\tWheelhouse`, `note ${first.id}\tWheelhouse`, 'Start the record\tWheelhouse']);
    assert.equal((await git(dir, ['status', '--porcelain'])).stdout, '');

    // Sync has nothing to pull or push.
    assert.deepEqual(await h.client.state.sync({ project: PROJECT }), { ok: true, pulled: 0, unpushed: 0 });
    // A state folder that holds a repository with a remote is not a Lean project's own, and is left alone.
    await git(dir, ['remote', 'add', 'origin', path.join(c.home, 'elsewhere.git')]);
    const refused = await h.client.state.write({ project: PROJECT, kind: 'note', data: { text: 'third' } });
    assert.equal(refused.ok, false);
    assert.match(refused.refused, /left alone/);
    assert.deepEqual(h.asked, { env: [], adapter: [] });
  } finally {
    await h.close();
  }
});

test('state/write and state/views work for a Lean project with no connection', async () => {
  const c = computer();
  await c.as(() => {
    registerLean({ project: PROJECT, folder: c.folder, now: () => T0 });
    enrol({ ...makeSigningKey(), enrolledAt: '2026-10-23T00:00:00.000Z' });
  });
  const h = await helperOn(c);
  try {
    const card = await h.client.state.write({ project: PROJECT, kind: 'card', data: { question: 'Pick a colour?', header: 'Colour', options: ['Blue', 'Green'], kind: 'question', level: 3 } });
    assert.equal(card.ok, true, JSON.stringify(card));
    const views = await h.client.state.views({ cwd: c.folder, cards: true });
    assert.equal(views.ok, true, JSON.stringify(views));
    assert.equal(typeof views.views, 'object');
    assert.deepEqual(views.cards.map((e) => e.id), [card.id]);
    const answer = await h.client.state.answer({ cwd: c.folder, questionId: card.id });
    assert.deepEqual(answer, { ok: true, answer: null });

    // A signed record of this computer's is taken, as for any project.
    const event = await c.as(() => makeEvent({ kind: 'approval', data: { pr: 1, commit: 'a'.repeat(40) }, now: () => T0 }));
    const recorded = await h.client.state.record({ project: PROJECT, event });
    assert.equal(recorded.ok, true, JSON.stringify(recorded));
    const ids = await c.as(() => listEvents(stateDir(PROJECT), { report: () => {} }).map((e) => e.id));
    assert.deepEqual(ids.sort(), [card.id, event.id].sort());

    // STOP holds a Lean write back, and reading carries on.
    assert.equal((await h.client.stop({})).ok, true);
    assert.deepEqual(await h.client.state.write({ project: PROJECT, kind: 'note', data: { text: 'later' } }), { ok: false, refused: 'STOP is on' });
    const read = await h.client.state.views({ project: PROJECT });
    assert.equal(read.ok, true);
    assert.equal(read.stop, true);
    assert.deepEqual(h.asked, { env: [], adapter: [] }, 'no connection or adapter was asked for');
  } finally {
    await h.close();
  }
});

test('a host route for a Lean project refuses and names why', async () => {
  const c = computer();
  await c.as(() => registerLean({ project: PROJECT, folder: c.folder, now: () => T0 }));
  const h = await helperOn(c);
  try {
    const asks = [
      ['/push', h.client.push({ cwd: c.folder, dir: c.folder, refspec: 'feature/a' })],
      ['/pull', h.client.pull({ project: PROJECT, dir: c.folder, branch: 'feature/a' })],
      ['/pr/open', h.client.openPr({ cwd: c.folder, head: 'feature/a', title: 't', body: 'b', session: 's' })],
      ['/pr/state', h.client.prState({ project: PROJECT, number: 1 })],
      ['/ci', h.client.ci({ project: PROJECT, sha: 'a'.repeat(40) })],
      ['/config', h.client.config({ cwd: c.folder })],
      ['/host/facts', h.client.host.facts({ project: PROJECT })],
      ['/state/clone', h.client.state.clone({ project: PROJECT })],
      ['/state/backup', h.client.state.backup({ project: PROJECT })],
      ['/lock/take', h.client.lock.take({ project: PROJECT })],
      ['/runbook/candidates', h.client.runbook.candidates({ cwd: c.folder })],
      ['/foreman/run', h.client.foreman.run({ folder: c.folder, script: 'act', argv: [] })],
      ['/ci-push/line', h.client.ciPushLine({ project: PROJECT, branch: 'main', sha: 'a'.repeat(40) })],
    ];
    for (const [route, asked] of asks) {
      const answer = await asked;
      assert.equal(answer.ok, false, route);
      // The profile's backup waits for the profile first, as it does for every project.
      if (route === '/state/backup') assert.match(String(answer.why), /profile/, route);
      else assert.equal(answer.refused, LEAN_NO_HOST, route);
    }
    assert.deepEqual(h.asked, { env: [], adapter: [] }, 'no connection or adapter was asked for');
    // Nothing was made for a host: no mirror, no lock, no state clone with a remote.
    const dir = await c.as(() => path.join(c.home, 'projects', PROJECT));
    assert.deepEqual(fs.readdirSync(dir).sort(), ['lean.json']);
  } finally {
    await h.close();
  }
});

test('a Lean state folder that holds files but no repository is kept, and the write refused', async () => {
  const c = computer();
  await c.as(() => registerLean({ project: PROJECT, folder: c.folder, now: () => T0 }));
  const h = await helperOn(c);
  try {
    const dir = await c.as(() => stateDir(PROJECT));
    const kept = path.join(dir, 'events', '2026', '10', 'approval.json');
    fs.mkdirSync(path.dirname(kept), { recursive: true });
    fs.writeFileSync(kept, '{"kind":"approval"}\n');
    for (const ask of [
      () => h.client.state.write({ project: PROJECT, kind: 'note', data: { text: 'x' } }),
      () => h.client.state.views({ project: PROJECT }),
    ]) {
      const answer = await ask();
      assert.equal(answer.ok, false);
      assert.match(answer.refused, /holds files but no repository, so it was left alone/);
    }
    assert.equal(fs.readFileSync(kept, 'utf8'), '{"kind":"approval"}\n');
    assert.equal(fs.existsSync(path.join(dir, '.git')), false);
    // An empty folder is made into the repository.
    fs.rmSync(path.join(dir, 'events'), { recursive: true });
    assert.equal((await h.client.state.write({ project: PROJECT, kind: 'note', data: { text: 'x' } })).ok, true);
  } finally {
    await h.close();
  }
});

test('setup and uninstall, asked in a Lean folder, refuse with one plain line and change nothing', async () => {
  const c = computer();
  await c.as(() => {
    registerLean({ project: PROJECT, folder: c.folder, now: () => T0 });
    assert.deepEqual(registeredLeanProjects(), [{ project: PROJECT, record: readLean(PROJECT) }]);
  });
  const h = await helperOn(c);
  try {
    for (const folder of [c.folder, path.join(c.folder, 'src')]) {
      const asks = [
        h.client.setup.plan({ folder, step: 1 }),
        h.client.setup.apply({ folder, step: 1, hash: 'a'.repeat(64) }),
        h.client.setup.status({ folder }),
        h.client.setup.health({ folder, lines: [] }),
        h.client.setup.uninstall.plan({ folder }),
        h.client.setup.uninstall.apply({ folder, hash: 'a'.repeat(64) }),
        h.client.setup.uninstall.status({ folder }),
      ];
      for (const answer of await Promise.all(asks)) assert.deepEqual(answer, { ok: false, refused: LEAN_FOLDER });
    }
    assert.deepEqual(fs.readdirSync(path.join(c.home, 'projects')), [PROJECT]);
    assert.deepEqual(fs.readdirSync(path.join(c.home, 'projects', PROJECT)), ['lean.json']);
    assert.equal(fs.existsSync(path.join(c.home, 'setup')), false, 'no setup journal was started');
  } finally {
    await h.close();
  }
});

test('a refused look at a Lean project\'s state is worded for Lean, and nothing is written', async () => {
  const c = computer();
  await c.as(() => registerLean({ project: PROJECT, folder: c.folder, now: () => T0 }));
  const h = await helperOn(c);
  try {
    assert.equal((await h.client.state.write({ project: PROJECT, kind: 'note', data: { text: 'first' } })).ok, true);
    const dir = await c.as(() => stateDir(PROJECT));
    await git(dir, ['config', 'core.fsmonitor', 'false']);
    const refused = await h.client.state.write({ project: PROJECT, kind: 'note', data: { text: 'second' } });
    assert.equal(refused.ok, false);
    assert.equal(refused.refused, lookRefusalLine('lean', { keys: ['core.fsmonitor'] }, { what: 'the Lean project\'s private record' }));
    assert.equal((await git(dir, ['rev-list', '--count', 'HEAD'])).stdout.trim(), '2');
  } finally {
    await h.close();
  }
});

test('a Claude Code project\'s record and routes are unchanged', async () => {
  const c = computer();
  const record = {
    folder: c.folder, remoteUrl: 'https://github.com/o/shop.git', host: 'github', repo: 'o/shop',
    connection: { host: 'github', mode: 'quick', project: 'o/shop' },
  };
  await c.as(() => {
    writeProject(PROJECT, record);
    // A lean.json beside project.json is not read: the host's record wins.
    fs.writeFileSync(path.join(c.home, 'projects', PROJECT, 'lean.json'), JSON.stringify({
      folder: c.folder, store: null, copy: null, test: null, identity: null, registeredAt: '2026-10-23T01:00:00.000Z',
    }));
    assert.deepEqual(projectForFolder(c.folder), { project: PROJECT, record });
    assert.deepEqual(readProject(PROJECT), record);
    assert.deepEqual(registeredProjects(), [{ project: PROJECT, record }]);
    assert.throws(() => registerLean({ project: PROJECT, folder: c.folder }), /code host/);
  });
  const h = await helperOn(c);
  try {
    // The request goes to the connection first, as before: here it has none, and says so.
    for (const ask of [
      () => h.client.state.views({ project: PROJECT }),
      () => h.client.state.write({ project: PROJECT, kind: 'note', data: { text: 'x' } }),
      () => h.client.merge({ project: PROJECT, number: 1 }),
    ]) {
      const answer = await ask();
      assert.equal(answer.ok, false);
      assert.equal(answer.refused, 'no connection on this computer');
    }
    assert.deepEqual(h.asked.env, [PROJECT, PROJECT, PROJECT]);
    assert.equal(fs.existsSync(await c.as(() => stateDir(PROJECT))), false, 'no Lean state was made for it');
  } finally {
    await h.close();
  }
});
