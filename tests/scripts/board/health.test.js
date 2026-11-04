// tests/scripts/board/health.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { verdict } from '../../../scripts/lib/calm-words.js';
import { healthLines, brokenCount, readHostFacts, readScreens, NO_CHROME_LINE, QUICK_LINE, phonePushLine } from '../../../scripts/board/health.js';
import { WINDOWS_LINE, UNATTENDED_LINE, GUARDED_LINE, LOCKED_UNATTENDED_LINE } from '../../../scripts/lib/platform-lines.js';
import { FREE_PLAN_LINE } from '../../../scripts/host/protection.js';
import { NO_HELPER } from '../../../scripts/hooks/session-start.js';
import { frontDeskModelLine } from '../../../scripts/lib/front-desk-model.js';
import { computerId, stateDir } from '../../../scripts/lib/paths.js';
import { HOST_FACTS_MAX_AGE_MS } from '../../../scripts/lib/core-numbers.js';
import { as, shortHome, tempFolder, testAddress } from '../../helpers/homes.js';
import { beforeTimer, WAIT_MS } from '../../helpers/until.js';

// This computer's ID is made and kept in the home, so the tests that read it use their own.
process.env.WHEELHOUSE_HOME = shortHome();

const NO_CI = 'This project has no CI, so nothing can merge';
const LOCKED_ELSEWHERE = 'Another computer holds this project, so this one is read-only';
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
    platform: 'win32',
    realUsers: true,
    builds: { level: 'unattended', lockedUnattended: false },
  });
  assert.deepEqual(everything.map((line) => line.text), [
    'All stop is on, since 18 October 2026',
    'Protection: Standard',
    QUICK_LINE,
    WINDOWS_LINE,
    UNATTENDED_LINE,
    FREE_PLAN_LINE,
    NO_CI,
    LOCKED_ELSEWHERE,
    NO_HELPER,
    'Renew the host key by 2 November 2026',
  ]);
  assert.deepEqual(everything.map((line) => line.level), [
    'stop', 'ok', 'ok', 'watch', 'watch', 'watch', 'watch', 'watch', 'watch', 'watch',
  ]);
});

test('the quick connection is normal on a Mac and a calm note elsewhere (the director\'s ruling, 24 October 2026)', () => {
  const quick = { record: { connection: { mode: 'quick' } } };
  // On the Mac the sandbox denies the sign-in's files and the keychain (check 73): no line.
  assert.deepEqual(healthLines({ ...calm, ...quick }), [{ level: 'ok', text: 'Protection: Standard' }]);
  // On Windows, with no sandbox, one ok line in the same words as setup's, never a watch line.
  const windows = healthLines({ ...calm, ...quick, platform: 'win32' });
  assert.deepEqual(windows.filter((l) => l.text === QUICK_LINE), [{ level: 'ok', text: QUICK_LINE }]);
  assert.ok(!windows.some((l) => l.text === QUICK_LINE && l.level !== 'ok'));
  // The narrow connection brings no line anywhere.
  for (const platform of ['darwin', 'win32']) {
    assert.ok(!healthLines({ ...calm, platform, record: { connection: { mode: 'narrow' } } }).some((l) => l.text === QUICK_LINE));
  }
});

test('a front desk on another model than the pin is one watch line; on the pin, or with either unknown, none (design section 8)', () => {
  const line = frontDeskModelLine({ running: 'model-small', pinned: 'model-top' });
  const lines = healthLines({ platform: 'darwin', frontDeskModel: { running: 'model-small', pinned: 'model-top' } });
  assert.deepEqual(lines.filter((l) => l.text === line), [{ level: 'watch', text: line }]);
  for (const frontDeskModel of [{ running: 'model-top', pinned: 'model-top' }, { running: null, pinned: 'model-top' }, null, undefined]) {
    assert.ok(!healthLines({ platform: 'darwin', frontDeskModel }).some((l) => /front desk is running/.test(l.text)));
  }
});

test('the lines come only in their own case', () => {
  assert.deepEqual(texts({ record: { connection: { mode: 'quick' } }, platform: 'win32' }), ['Protection: Standard', QUICK_LINE, WINDOWS_LINE]);
  assert.deepEqual(texts({ platform: 'win32' }), ['Protection: Standard', WINDOWS_LINE]);
  assert.deepEqual(texts({ facts: { protection: 'none', ci: 'present' } }), ['Protection: Standard', FREE_PLAN_LINE]);
  assert.deepEqual(texts({ facts: { protection: 'unknown', ci: 'unknown' } }), ['Protection: Standard']);
  assert.deepEqual(texts({ helperUp: false }), ['Protection: Standard', NO_HELPER]);
  assert.deepEqual(texts({ renewal: { due: true, on: '2026-12-25' } }), ['Protection: Standard', 'Renew the host key by 25 December 2026']);
  // The records stay on this computer (design section 24): no line asks for the profile's repository.
  assert.deepEqual(texts({ profile: null }), ['Protection: Standard']);
  assert.deepEqual(texts({ stop: { on: true } }), ['All stop is on', 'Protection: Standard']);
  // The host's tool stopped starting and the project moved to the web API by itself: one calm line.
  const moved = { host: 'gitlab', connection: { mode: 'as-is', backend: 'rest', switched: 'cli' } };
  assert.deepEqual(texts({ record: moved }), ['Protection: Standard', "GitLab's tool stopped working on this computer, so Wheelhouse is using GitLab's web API instead."]);
  assert.deepEqual(texts({ record: { ...moved, connection: { mode: 'as-is', backend: 'rest' } } }), ['Protection: Standard']);
});

test('a refused or missing host key is said in plain words, pointing to setup\'s step 3', () => {
  const gitlab = { host: 'gitlab', connection: { mode: 'as-is' } };
  const github = { host: 'github', connection: { mode: 'as-is' } };
  assert.deepEqual(healthLines({ ...calm, record: gitlab, renewal: { due: false, key: 'refused' } }).map((l) => [l.level, l.text]), [
    ['ok', 'Protection: Standard'],
    ['watch', 'GitLab no longer accepts your key. Ask for step 3 of setup ("check my GitLab connection") and a page will open to make a new one.'],
  ]);
  assert.deepEqual(texts({ record: github, renewal: { due: false, key: 'missing' } }), [
    'Protection: Standard',
    'There is no GitHub key on this computer. Ask for step 3 of setup ("check my GitHub connection") and a page will open to make one.',
  ]);
  // Nothing in either line names the way the web is reached.
  for (const key of ['refused', 'missing']) {
    for (const record of [gitlab, github]) {
      assert.doesNotMatch(texts({ record, renewal: { due: false, key } }).join(' '), /REST|curl/i);
    }
  }
  // A key due for renewal and not refused says the date, as before.
  assert.deepEqual(texts({ record: gitlab, renewal: { due: true, on: '2026-12-25' } }), ['Protection: Standard', 'Renew the host key by 25 December 2026']);
});

test('with pages listed and no Chrome found, one line says an approval asks again after an update (F74)', () => {
  const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const EDGE = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
  const folder = (config) => {
    const dir = tempFolder('wh-screens-');
    if (config !== undefined) {
      fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.claude', 'wheelhouse.json'), typeof config === 'string' ? config : JSON.stringify(config));
    }
    return dir;
  };
  const config = (extra) => ({ v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [], ...extra });
  const linesFor = (dir, found) => healthLines({ ...calm, screens: readScreens({ folder: dir, findBrowser: () => found }) });
  const said = (lines) => lines.filter((line) => line.text === NO_CHROME_LINE);
  const listed = folder(config({ pages: ['/', '/pricing'] }));

  // Edge only, or no browser: the line, as information, not a problem.
  assert.deepEqual(said(linesFor(listed, EDGE)), [{ level: 'ok', text: NO_CHROME_LINE }]);
  assert.deepEqual(said(linesFor(listed, null)), [{ level: 'ok', text: NO_CHROME_LINE }]);
  // Chrome found: nothing.
  assert.deepEqual(said(linesFor(listed, CHROME)), []);
  // No pages listed, or no configuration at all: nothing, whatever the browser.
  for (const dir of [folder(config({})), folder(config({ pages: [] })), folder()]) assert.deepEqual(said(linesFor(dir, null)), []);
  // A configuration that can't be read, a browser finder that throws, or no folder: nothing, and no throw.
  for (const dir of [folder('{ not json'), folder(config({ pages: ['no-slash'] }))]) assert.deepEqual(said(linesFor(dir, null)), []);
  assert.deepEqual(said(healthLines({ ...calm, screens: readScreens({ folder: listed, findBrowser: () => { throw new Error('no'); } }) })), []);
  assert.deepEqual(said(healthLines({ ...calm, screens: readScreens({}) })), []);
  // Only a reading that says both, in so many words, brings it.
  for (const screens of [undefined, null, {}, { pages: true }, { chrome: false }, { pages: 1, chrome: 0 }]) assert.deepEqual(said(healthLines({ ...calm, screens })), []);
  assert.deepEqual(texts({ screens: { pages: true, chrome: false } }), ['Protection: Standard', NO_CHROME_LINE]);
});

test('a push test that didn\'t reach the phone is a dated watch line saying why and what to check; one that did adds none', () => {
  const line = phonePushLine('2026-10-20T05:00:00.000Z');
  // It reads as a past result, with its date, day month year.
  assert.match(line, /didn't reach your phone on 20 October 2026\./);
  // A push is skipped while the director is at the computer (check 4), so the line says so, and
  // names what to check: Remote Control, the second push option and the phone's permission.
  assert.match(line, /at the computer/);
  assert.match(line, /Remote Control/);
  assert.match(line, /Push when actions required/);
  assert.match(line, /phone allows Claude's notifications/);
  // With no date that reads, the line says no date.
  assert.match(phonePushLine(undefined), /didn't reach your phone\. /);
  assert.match(phonePushLine('not a date'), /didn't reach your phone\. /);
  assert.deepEqual(healthLines({ ...calm, phonePush: { arrived: false, at: '2026-10-20T05:00:00.000Z' } }), [
    { level: 'ok', text: 'Protection: Standard' }, { level: 'watch', text: line },
  ]);
  for (const phonePush of [{ arrived: true }, null, undefined, {}, { arrived: 'no' }]) assert.deepEqual(texts({ phonePush }), ['Protection: Standard'], JSON.stringify(phonePush));
  // Among the watch lines, after the helper's.
  assert.deepEqual(texts({ phonePush: { arrived: false }, helperUp: false }), ['Protection: Standard', NO_HELPER, phonePushLine(undefined)]);
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
  assert.deepEqual(lines[0], { level: 'stop', text: 'All stop is on, since 18 October 2026' });
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

test('GitLab\'s gaps and the faked-tests line reach the board: the line only for real users whose plan is not Premium', () => {
  const FAKED = "the project's tests on the host could be faked with Wheelhouse's key";
  const gap = "DEBUG is a project secret that a merge request's pipeline could read";
  const lines = (facts, realUsers) => texts({ facts: { protection: 'on', ci: 'present', ...facts }, realUsers, platform: 'linux' });
  const withFaked = lines({ plan: 'free', gaps: [gap] }, true);
  assert.equal(withFaked.length, 3);
  assert.ok(withFaked[1].includes(FAKED));
  assert.equal(withFaked[2], gap);
  assert.ok(lines({ plan: 'unknown' }, true).some((t) => t.startsWith("Wheelhouse could not tell GitLab's plan") && t.includes(FAKED)));
  assert.deepEqual(lines({ plan: 'premium' }, true), ['Protection: Standard']);
  assert.deepEqual(lines({ plan: 'free' }, false), ['Protection: Standard']);
  // A GitHub project has no plan to tell, and a gap is said whoever the users are.
  assert.deepEqual(lines({}, true), ['Protection: Standard']);
  assert.deepEqual(lines({ gaps: [gap] }, false), ['Protection: Standard', gap]);
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

test('host facts keep the plan and the gaps the helper read on GitLab, and drop what is not a plan or a line', async () => {
  const home = shortHome();
  await as(home, async () => {
    const sent = { ok: true, protection: 'on', ci: 'present', plan: 'free', gaps: ['DEBUG is a project secret', 42, '', 'x'.repeat(401)] };
    assert.deepEqual(await readHostFacts('o__p', { client: fakeClient(sent), now: at(0) }), { protection: 'on', ci: 'present', plan: 'free', gaps: ['DEBUG is a project secret'] });
    fs.rmSync(path.dirname(cacheFile('o__p')), { recursive: true, force: true });
    assert.deepEqual(await readHostFacts('o__p', { client: fakeClient({ ok: true, protection: 'on', ci: 'present', plan: 'gold' }), now: at(0) }), { protection: 'on', ci: 'present' });
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
      const read = await beforeTimer(() => readHostFacts('o__p', { client: fakeClient(fail), now: at(0), waitMs: 50 }), 2000);
      assert.equal(read.inTime, true, 'given up in good time');
      assert.equal(read.value, null);
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
      const read = await beforeTimer(() => readHostFacts('o__p', { address, now: at(0), waitMs: 300 }), 2000);
      assert.equal(read.inTime, true, 'returned in good time');
      assert.equal(read.value, null);
      assert.equal(connections.length, 1);
      // The client closed the request itself: the helper's side sees the connection end.
      assert.equal((await beforeTimer(Promise.all(closed), WAIT_MS)).inTime, true, 'the request was left open');
      assert.equal(fs.existsSync(triedFile('o__p')), true, 'and the next reading will not wait');
    });
  } finally {
    for (const socket of connections) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a project with no CI whose checks run on this computer can merge, and says so', () => {
  assert.deepEqual(texts({ facts: { protection: 'on', ci: 'here' } }), ['Protection: Standard', 'Checks run on this computer']);
});

test('the safekeeping line is always there, at watch only when its status is, with its detail and its mark', () => {
  const lines = (level) => healthLines({ ...calm, safekeeping: { level, line: 'Only here', detail: 'Lost with it' } }).at(-1);
  assert.deepEqual(lines('safe'), { level: 'ok', text: 'Safekeeping: Only here', detail: 'Lost with it', safekeeping: true });
  assert.equal(lines('watch').level, 'watch');
  assert.equal(healthLines(calm).some((line) => line.safekeeping), false);
});

test('update lines: nothing is said without update facts', () => {
  assert.deepEqual(healthLines({ ...calm, update: null }), healthLines(calm));
});

test('update lines: the version line carries the date for a week after an update, then only the version', () => {
  assert.deepEqual(texts({ update: { version: 'v0.2.7', updatedAt: '2026-11-04T09:00:00.000Z' } }), ['Protection: Standard', 'Wheelhouse v0.2.7 (updated 4 November 2026)']);
  assert.deepEqual(texts({ update: { version: 'v0.2.7', updatedAt: null } }), ['Protection: Standard', 'Wheelhouse v0.2.7']);
});

test('update lines: a newer release is announced in the director\'s words, and calmly', () => {
  const lines = healthLines({ ...calm, update: { version: 'v0.2.7', newer: 'v0.2.8' } });
  assert.deepEqual(lines.at(-1), { level: 'ok', text: 'v0.2.8 is out; type /wheelhouse:update when you want it' });
  assert.equal(texts({ update: { version: 'v0.2.7', newer: null } }).some((t) => /is out/.test(t)), false);
});

test('update lines: the three part-way lines, and a refresh left', () => {
  const part = (kind) => healthLines({ ...calm, update: { partway: { kind, tag: 'v0.2.7' } } }).at(-1);
  assert.deepEqual(part('merge'), { level: 'watch', text: "Wheelhouse's update to v0.2.7 is waiting for its change to merge" });
  assert.deepEqual(part('idle'), { level: 'watch', text: "Wheelhouse's update to v0.2.7 is waiting for work in progress to finish" });
  assert.deepEqual(part('stopped'), { level: 'watch', text: "Wheelhouse's update to v0.2.7 stopped: type /wheelhouse:update to carry on" });
  const left = healthLines({ ...calm, update: { refresh: { tag: 'v0.2.7', left: "Locked's password refresh" } } }).at(-1);
  assert.equal(left.level, 'watch');
  assert.match(left.text, /v0\.2\.7 is installed.*Locked's password refresh is left/);
});

test('update lines: a project naming a release this computer does not have', () => {
  assert.deepEqual(
    healthLines({ ...calm, update: { mismatch: { names: 'v0.2.7', has: 'v0.2.6' } } }).at(-1),
    { level: 'watch', text: 'This project names v0.2.7 but this computer has v0.2.6: type /wheelhouse:update to try again' },
  );
});

test('update lines: an old helper still answering is a calm line, and no update line is broken', () => {
  const lines = healthLines({ ...calm, update: { oldHelper: 'v0.2.6', partway: { kind: 'stopped', tag: 'v0.2.7' } } });
  assert.ok(lines.some((l) => l.level === 'ok' && /older Wheelhouse helper \(v0\.2\.6\)/.test(l.text)));
  assert.equal(lines.some((l) => l.level === 'stop'), false);
});

// A watcher whose wakes keep failing is a broken thing the director is told about, not silence.
const NOW_MS = Date.parse('2026-11-04T05:00:00.000Z');
const failing = (message, minutesAgo = 2) => ({ lastError: { at: new Date(NOW_MS - minutesAgo * 60000).toISOString(), message } });
const atNow = { now: new Date(NOW_MS) };
const CANT_FIND = "Work can't start: Wheelhouse can't find Claude Code to start the builder. Start a new session in this folder.";

test('repeated wake failures from a missing claude show a plain line at stop level, and the verdict is not calm', () => {
  const lines = healthLines({ ...calm, ...atNow, watcher: failing('A wake for the Bosun has failed 101 times: spawn claude ENOENT') });
  assert.deepEqual(lines.at(-1), { level: 'stop', text: CANT_FIND });
  assert.equal(brokenCount(lines), 1);
  assert.doesNotMatch(verdict({ waiting: 0, broken: brokenCount(lines) }), /Nothing is broken/);
});

test('other repeated wake failures say so without blaming claude', () => {
  const line = healthLines({ ...calm, ...atNow, watcher: failing('A wake for sign-in has failed 4 times: exit 1') }).at(-1);
  assert.equal(line.level, 'stop');
  assert.match(line.text, /^Work can't start: Wheelhouse has tried 4 times to start the builder and failed\./);
});

test('old, few, unrelated or answered failures bring no line', () => {
  const none = (watcher) => assert.deepEqual(healthLines({ ...calm, ...atNow, watcher }), [{ level: 'ok', text: 'Protection: Standard' }]);
  none(failing('A wake for the Bosun has failed 101 times: spawn claude ENOENT', 24 * 60));
  none(failing('A wake for the Bosun has failed 2 times: spawn claude ENOENT'));
  none(failing('the watcher lost the helper'));
  none({ ...failing('A wake for the Bosun has failed 9 times: spawn claude ENOENT'), lastOk: new Date(NOW_MS - 60000).toISOString() });
  none(undefined);
  none({});
});

test('own files: after an approved update the explained move is a calm line and brings no watch line', () => {
  const lines = healthLines({ ...calm, ownFiles: { calm: 'Wheelhouse moved to v0.2.7 and its files match.' } });
  assert.deepEqual(lines.at(-1), { level: 'ok', text: 'Wheelhouse moved to v0.2.7 and its files match.' });
  assert.equal(lines.some((l) => l.level === 'watch'), false);
  assert.equal(healthLines({ ...calm, ownFiles: { line: 'Files changed', calm: 'One row' } }).filter((l) => l.level === 'watch').length, 1);
});
