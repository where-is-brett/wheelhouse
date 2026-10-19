// tests/scripts/board/health.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { healthLines, readHostFacts, QUICK_LINE } from '../../../scripts/board/health.js';
import { WINDOWS_LINE, UNATTENDED_LINE, GUARDED_LINE, LOCKED_UNATTENDED_LINE } from '../../../scripts/lib/platform-lines.js';
import { FREE_PLAN_LINE } from '../../../scripts/host/protection.js';
import { NO_HELPER } from '../../../scripts/hooks/session-start.js';
import { computerId, stateDir } from '../../../scripts/lib/paths.js';
import { HOST_FACTS_MAX_AGE_MS } from '../../../scripts/lib/core-numbers.js';
import { as, shortHome, testAddress } from '../../helpers/homes.js';

// This computer's ID is made and kept in the home, so the tests that read it use their own.
process.env.WHEELHOUSE_HOME = shortHome();

const NO_CI = 'This project has no CI, so nothing can merge';
const LOCKED_ELSEWHERE = 'Another computer holds this project, so this one is read-only';
const NO_PROFILE = 'Your profile isn\'t backed up off this computer yet';
const REAL_USERS = 'This project has real users: Locked would protect it more';

// Everything fine: only the level line.
const calm = {
  record: { connection: { mode: 'narrow' } },
  locked: false,
  stop: { on: false },
  lock: null,
  helperUp: true,
  facts: { protection: 'on', ci: 'present' },
  renewal: { due: false },
  profile: { remoteUrl: 'https://example.invalid/p.git' },
  platform: 'darwin',
  realUsers: false,
};
const texts = (input) => healthLines({ ...calm, ...input }).map((line) => line.text);

test('each health line appears in its case and in its order', () => {
  assert.deepEqual(healthLines(calm), [{ level: 'ok', text: 'Protection: Standard' }]);
  assert.deepEqual(texts({ locked: true }), ['Protection: Locked']);

  const everything = healthLines({
    record: { connection: { mode: 'quick' } },
    locked: false,
    stop: { on: true, at: '2026-10-18T09:30:00.000Z', by: 'prompt' },
    lock: { computer: 'ffffffff', counter: 3 },
    helperUp: false,
    facts: { protection: 'none', ci: 'none' },
    renewal: { due: true, on: '2026-11-02' },
    profile: null,
    platform: 'win32',
    realUsers: true,
    builds: { level: 'unattended', lockedUnattended: false },
  });
  assert.deepEqual(everything.map((line) => line.text), [
    'STOP is on, since 18 October 2026',
    'Protection: Standard',
    QUICK_LINE,
    WINDOWS_LINE,
    UNATTENDED_LINE,
    FREE_PLAN_LINE,
    NO_CI,
    LOCKED_ELSEWHERE,
    NO_HELPER,
    'Renew the host key by 2 November 2026',
    NO_PROFILE,
  ]);
  assert.deepEqual(everything.map((line) => line.level), [
    'stop', 'ok', 'watch', 'watch', 'watch', 'watch', 'watch', 'watch', 'watch', 'watch', 'watch',
  ]);
});

test('the lines come only in their own case', () => {
  assert.deepEqual(texts({ record: { connection: { mode: 'quick' } } }), ['Protection: Standard', QUICK_LINE]);
  assert.deepEqual(texts({ platform: 'win32' }), ['Protection: Standard', WINDOWS_LINE]);
  assert.deepEqual(texts({ facts: { protection: 'none', ci: 'present' } }), ['Protection: Standard', FREE_PLAN_LINE]);
  assert.deepEqual(texts({ facts: { protection: 'unknown', ci: 'unknown' } }), ['Protection: Standard']);
  assert.deepEqual(texts({ helperUp: false }), ['Protection: Standard', NO_HELPER]);
  assert.deepEqual(texts({ renewal: { due: true, on: '2026-12-25' } }), ['Protection: Standard', 'Renew the host key by 25 December 2026']);
  assert.deepEqual(texts({ profile: null }), ['Protection: Standard', NO_PROFILE]);
  assert.deepEqual(texts({ stop: { on: true } }), ['STOP is on', 'Protection: Standard']);
});

test('on Windows the build-commands level comes right after the Windows line', () => {
  const win = (builds, extra = {}) => healthLines({ ...calm, platform: 'win32', builds, ...extra });
  const windows = { level: 'watch', text: WINDOWS_LINE };
  assert.equal(UNATTENDED_LINE, 'Build commands run unattended on this Windows computer, with no sandbox.');
  assert.equal(GUARDED_LINE, 'Build commands run at low integrity on this Windows computer: they can\'t change files outside the project, but can still use the network.');
  assert.equal(LOCKED_UNATTENDED_LINE, 'Unattended build commands are off in a Locked project');
  assert.deepEqual(win({ level: 'unattended', lockedUnattended: false }).slice(1), [windows, { level: 'watch', text: UNATTENDED_LINE }]);
  assert.deepEqual(win({ level: 'guarded', lockedUnattended: false }).slice(1), [windows, { level: 'ok', text: GUARDED_LINE }]);
  assert.deepEqual(win({ level: 'ask', lockedUnattended: true }, { locked: true }), [
    { level: 'ok', text: 'Protection: Locked' }, windows, { level: 'watch', text: LOCKED_UNATTENDED_LINE },
  ]);
  // At Ask, or with nothing read, only the Windows line.
  assert.deepEqual(win({ level: 'ask', lockedUnattended: false }).slice(1), [windows]);
  assert.deepEqual(win(undefined).slice(1), [windows]);
  assert.deepEqual(win(null).slice(1), [windows]);
  assert.deepEqual(win({ level: 'always' }).slice(1), [windows]);
  // The lines come before the rest of the watch lines.
  assert.deepEqual(win({ level: 'unattended' }, { helperUp: false }).map((line) => line.text), ['Protection: Standard', WINDOWS_LINE, UNATTENDED_LINE, NO_HELPER]);
});

test('off Windows the build-commands level adds nothing, whatever it reads', () => {
  for (const platform of ['darwin', 'linux']) {
    for (const builds of [{ level: 'unattended', lockedUnattended: false }, { level: 'guarded', lockedUnattended: false }, { level: 'ask', lockedUnattended: true }]) {
      assert.deepEqual(texts({ platform, builds }), ['Protection: Standard']);
    }
  }
});

test('the lock line shows only when another computer holds the project', () => {
  assert.deepEqual(texts({ lock: { computer: computerId() } }), ['Protection: Standard']);
  assert.deepEqual(texts({ lock: null }), ['Protection: Standard']);
  assert.deepEqual(texts({ lock: { computer: 'ffffffff' } }), ['Protection: Standard', LOCKED_ELSEWHERE]);
});

test('STOP comes first, at level stop', () => {
  const lines = healthLines({ ...calm, stop: { on: true, at: '2026-10-18T09:30:00.000Z' }, helperUp: false, locked: true });
  assert.deepEqual(lines[0], { level: 'stop', text: 'STOP is on, since 18 October 2026' });
  assert.equal(lines.filter((line) => line.level === 'stop').length, 1);
  assert.equal(healthLines({ ...calm, stop: { on: false } }).some((line) => line.level === 'stop'), false);
});

test('the Locked suggestion shows only for a Standard project with real users on a Mac', () => {
  const suggestion = { level: 'watch', text: REAL_USERS };
  assert.deepEqual(healthLines({ ...calm, realUsers: true }), [{ level: 'ok', text: 'Protection: Standard' }, suggestion]);
  assert.deepEqual(texts({ realUsers: true, locked: true }), ['Protection: Locked']);
  assert.deepEqual(texts({ realUsers: false }), ['Protection: Standard']);
  assert.deepEqual(texts({ realUsers: true, platform: 'win32' }), ['Protection: Standard', WINDOWS_LINE]);
  assert.deepEqual(texts({ realUsers: true, platform: 'linux' }), ['Protection: Standard']);
});

test('a project with no pipeline on its default branch is said to have no CI', () => {
  assert.deepEqual(texts({ facts: { protection: 'on', ci: 'none' } }), ['Protection: Standard', NO_CI]);
  assert.deepEqual(texts({ facts: { protection: 'on', ci: 'present' } }), ['Protection: Standard']);
  assert.deepEqual(texts({ facts: { protection: 'on', ci: 'unknown' } }), ['Protection: Standard']);
  assert.deepEqual(texts({ facts: null }), ['Protection: Standard'], 'missing facts add no line');
});

// --- host facts ---

const NOW = new Date('2026-10-19T00:00:00.000Z');
const at = (ms) => () => new Date(NOW.getTime() + ms);
const FACTS = { protection: 'none', ci: 'none' };

function fakeClient(answer) {
  const calls = [];
  return {
    calls,
    host: {
      facts: async (args) => {
        calls.push(args);
        if (typeof answer === 'function') return answer();
        return answer;
      },
    },
  };
}
const cacheFile = (project) => path.join(stateDir(project), '..', 'host-facts.json');
const triedFile = (project) => path.join(stateDir(project), '..', 'host-facts-tried.json');
const keep = (project, body) => {
  fs.mkdirSync(path.dirname(cacheFile(project)), { recursive: true });
  fs.writeFileSync(cacheFile(project), typeof body === 'string' ? body : JSON.stringify(body));
};

test('host facts are read from the cache for a day, then asked again, and missing facts add no line', async () => {
  const home = shortHome();
  await as(home, async () => {
    const client = fakeClient({ ok: true, ...FACTS });
    // Nothing cached: asked once, and kept.
    assert.deepEqual(await readHostFacts('o__p', { client, now: at(0) }), FACTS);
    assert.deepEqual(client.calls, [{ project: 'o__p' }]);
    assert.equal(JSON.parse(fs.readFileSync(cacheFile('o__p'), 'utf8')).at, NOW.toISOString());
    assert.deepEqual(fs.readdirSync(path.dirname(cacheFile('o__p'))).filter((name) => name.endsWith('.tmp')), []);

    // Under a day old: the cache answers and the helper isn't asked.
    assert.deepEqual(await readHostFacts('o__p', { client, now: at(HOST_FACTS_MAX_AGE_MS - 1) }), FACTS);
    assert.equal(client.calls.length, 1);

    // A day old: asked again, and the cache is renewed.
    const newer = fakeClient({ ok: true, protection: 'on', ci: 'present' });
    assert.deepEqual(await readHostFacts('o__p', { client: newer, now: at(HOST_FACTS_MAX_AGE_MS) }), { protection: 'on', ci: 'present' });
    assert.equal(newer.calls.length, 1);
    assert.equal(JSON.parse(fs.readFileSync(cacheFile('o__p'), 'utf8')).at, new Date(NOW.getTime() + HOST_FACTS_MAX_AGE_MS).toISOString());

    // A cache dated in the future isn't trusted.
    const future = fakeClient({ ok: true, protection: 'unknown', ci: 'unknown' });
    assert.deepEqual(await readHostFacts('o__p', { client: future, now: at(-60 * 1000) }), { protection: 'unknown', ci: 'unknown' });
    assert.equal(future.calls.length, 1);
  });
});

test('a helper that fails, refuses or is slow falls back to the old cache, and with none gives null', async () => {
  const home = shortHome();
  await as(home, async () => {
    const failures = [
      () => ({ ok: false, refused: 'the host helper could not be reached: is it running?' }),
      () => { throw new Error('boom'); },
      () => ({ ok: true, protection: 'strange', ci: 'present' }),
      () => new Promise(() => {}), // never answers
    ];
    for (const fail of failures) {
      fs.rmSync(path.dirname(cacheFile('o__p')), { recursive: true, force: true });
      const started = Date.now();
      assert.equal(await readHostFacts('o__p', { client: fakeClient(fail), now: at(0), waitMs: 50 }), null);
      assert.ok(Date.now() - started < 2000);
      keep('o__p', { at: new Date(NOW.getTime() - 3 * HOST_FACTS_MAX_AGE_MS).toISOString(), facts: FACTS });
      assert.deepEqual(await readHostFacts('o__p', { client: fakeClient(fail), now: at(0), waitMs: 50 }), FACTS, 'the old cache is used');
      assert.deepEqual(JSON.parse(fs.readFileSync(cacheFile('o__p'), 'utf8')).facts, FACTS, 'and left as it was');
    }
    // A damaged cache is no cache.
    fs.rmSync(triedFile('o__p'), { force: true });
    keep('o__p', '{not json');
    assert.equal(await readHostFacts('o__p', { client: fakeClient(failures[0]), now: at(0) }), null);
    keep('o__p', { at: NOW.toISOString(), facts: { protection: 'on', ci: 'nonsense' } });
    assert.equal(await readHostFacts('o__p', { client: fakeClient(failures[0]), now: at(0) }), null);
    // A project name that isn't a folder name has no facts.
    assert.equal(await readHostFacts('../x', { client: fakeClient({ ok: true, ...FACTS }), now: at(0) }), null);
  });
});

test('a helper that is slow is not waited on again for ten minutes, and the old cache is used meanwhile', async () => {
  const home = shortHome();
  await as(home, async () => {
    const never = () => new Promise(() => {});
    const first = fakeClient(never);
    assert.equal(await readHostFacts('o__p', { client: first, now: at(0), waitMs: 50 }), null);
    assert.equal(first.calls.length, 1);
    assert.equal(JSON.parse(fs.readFileSync(triedFile('o__p'), 'utf8')).at, NOW.toISOString());

    // Within ten minutes: not asked at all.
    const second = fakeClient({ ok: true, ...FACTS });
    assert.equal(await readHostFacts('o__p', { client: second, now: at(9 * 60 * 1000), waitMs: 50 }), null);
    assert.equal(second.calls.length, 0);
    keep('o__p', { at: new Date(NOW.getTime() - 3 * HOST_FACTS_MAX_AGE_MS).toISOString(), facts: FACTS });
    assert.deepEqual(await readHostFacts('o__p', { client: second, now: at(9 * 60 * 1000), waitMs: 50 }), FACTS, 'a stale cache is used meanwhile');
    assert.equal(second.calls.length, 0);

    // After ten minutes: asked again, and an answer clears the mark.
    assert.deepEqual(await readHostFacts('o__p', { client: second, now: at(10 * 60 * 1000), waitMs: 50 }), FACTS);
    assert.equal(second.calls.length, 1);
    assert.equal(fs.existsSync(triedFile('o__p')), false);

    // A helper that is simply down (answers at once) leaves no mark.
    const down = fakeClient({ ok: false, refused: 'the host helper could not be reached: is it running?' });
    await readHostFacts('o__p', { client: down, now: at(3 * HOST_FACTS_MAX_AGE_MS), waitMs: 50 });
    assert.equal(fs.existsSync(triedFile('o__p')), false);
  });
});

test('a helper that accepts and never answers is given up on in about two seconds, and its connection is closed', async () => {
  const home = shortHome();
  const address = testAddress(home);
  const connections = [];
  const closed = [];
  const server = net.createServer((socket) => {
    connections.push(socket);
    socket.on('data', () => {}); // takes the request and never answers
    closed.push(new Promise((resolve) => socket.on('close', resolve)));
  });
  await new Promise((resolve) => server.listen(address, resolve));
  try {
    await as(home, async () => {
      const started = Date.now();
      assert.equal(await readHostFacts('o__p', { address, now: at(0), waitMs: 300 }), null);
      assert.ok(Date.now() - started < 2000, 'returned in good time');
      assert.equal(connections.length, 1);
      // The client closed the request itself: the helper's side sees the connection end.
      await Promise.race([Promise.all(closed), new Promise((_, reject) => setTimeout(() => reject(new Error('the request was left open')), 2000))]);
      assert.equal(fs.existsSync(triedFile('o__p')), true, 'and the next reading will not wait');
    });
  } finally {
    for (const socket of connections) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
});
