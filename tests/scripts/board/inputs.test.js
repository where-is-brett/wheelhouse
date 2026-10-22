// tests/scripts/board/inputs.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadBoardInputs } from '../../../scripts/board/inputs.js';
import { HELPER_WAIT_MS } from '../../../scripts/lib/core-numbers.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { recordAllowance } from '../../../scripts/usage/store.js';
import { profileViewsDir, sourcesDir, stateDir, stopFile, usageDir, wheelhouseHome } from '../../../scripts/lib/paths.js';
import { NO_HELPER } from '../../../scripts/hooks/session-start.js';
import { NO_CHROME_LINE, phonePushLine } from '../../../scripts/board/health.js';
import { journalFile } from '../../../scripts/lib/setup-run.js';
import { HOST_UNREACHABLE } from '../../../scripts/host/company-ca.js';
import { as, shortHome, tempFolder, testAddress } from '../../helpers/homes.js';
import { beforeTimer } from '../../helpers/until.js';

const NOW = new Date('2026-10-19T12:00:00.000Z');
const P = 'owner__name';
const NO_CI = 'This project has no CI, so nothing can merge';
const LOCKED_ELSEWHERE = 'Another computer holds this project, so this one is read-only';
const NO_PROFILE = 'Your profile isn\'t backed up off this computer yet';

const put = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
};

// A registered project whose main folder is `repo`, with nothing else kept for it.
function register(home) {
  const repo = path.join(home, 'repo');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  writeProject(P, { folder: repo, remoteUrl: 'https://example.com/owner/name.git', host: 'github', repo: 'owner/name', connection: {} });
  return repo;
}

// Views, events, settings, host facts, usage and sources as the other scripts leave them on disk.
function keepEverything() {
  const views = path.join(wheelhouseHome(), 'projects', P, 'views');
  put(path.join(views, 'waiting.json'), [{ id: 'c1', at: '2026-10-18T09:00:00.000Z', data: { title: 'Approve the sign-in page' } }]);
  put(path.join(views, 'unconfirmed.json'), []);
  put(path.join(views, 'damaged.json'), []);
  put(path.join(views, 'settings.json'), { phase: { key: 'phase', id: 's1', at: '2026-10-01T00:00:00.000Z', value: 'launched', before: null } });
  put(path.join(views, 'work.json'), { 'sign-in': { work: { key: 'sign-in', id: 'w1', at: '2026-10-10T00:00:00.000Z', data: { id: 'sign-in', title: 'Sign-in page', lane: 'feature' } }, approved: true } });
  put(path.join(views, 'features.json'), { 'sign-in': { key: 'sign-in', id: 'f1', at: '2026-10-11T00:00:00.000Z', data: { work: 'sign-in', step: 'building' } } });
  put(path.join(stateDir(P), 'events', '2026', 'm1.json'), { v: 1, id: 'm1', at: '2026-10-18T10:00:00.000Z', computer: 'c1', kind: 'merge', data: { pr: 3, forUsers: 'People can search' } });
  put(path.join(stateDir(P), '..', 'host-facts.json'), { at: '2026-10-01T00:00:00.000Z', facts: { protection: 'on', ci: 'none' } });
  put(path.join(sourcesDir(), 'report.json'), { at: '2026-10-18T00:00:00.000Z', sources: [], newModels: [], newLinks: [], retiring: [], releases: [], advisories: [{ repo: 'owner/lib', summary: 'A flaw' }] });
  put(stopFile(), { by: 'prompt', at: '2026-10-18T09:30:00.000Z' });
  recordAllowance({ windows: [{ kind: 'seven_day', percentUsed: 34, resetsAt: '2026-10-22T00:00:00.000Z' }], at: NOW });
}

// A helper client that answers as told and counts what it is asked.
function fakeClient({ health = { ok: true }, lock = { ok: true, result: null } } = {}) {
  const calls = [];
  const reply = (name, answer) => async (args) => {
    calls.push(name);
    return typeof answer === 'function' ? answer(args) : answer;
  };
  return { calls, health: reply('health', health), lock: { read: reply('lock', lock) }, host: { facts: reply('facts', { ok: true, protection: 'on', ci: 'present' }) } };
}

const texts = (inputs) => inputs.model.director.health.map((line) => line.text);

test('the board says GitLab can\'t be reached when the helper says so for this project, and only then', async () => {
  const base = 'https://git.example.org:8443';
  const home = shortHome();
  await as(home, async () => {
    const repo = register(home);
    const linesFor = async (health, options = {}) => texts(await loadBoardInputs({ cwd: repo, client: fakeClient({ health }), address: testAddress(home), now: () => NOW, ...options }));
    assert.equal((await linesFor({ ok: true, away: { [P]: base } })).filter((t) => t === HOST_UNREACHABLE(base)).length, 1);
    assert.ok(!(await linesFor({ ok: true })).includes(HOST_UNREACHABLE(base)));
    // Another project's trouble is not this one's, and a reading that is not an address is ignored.
    assert.ok(!(await linesFor({ ok: true, away: { other__project: base } })).includes(HOST_UNREACHABLE(base)));
    assert.ok(!(await linesFor({ ok: true, away: { [P]: { not: 'an address' } } })).some((t) => t.includes("can't be reached")));
    // The glance asks nothing of the helper, so it says nothing.
    assert.ok(!(await linesFor({ ok: true, away: { [P]: base } }, { offline: true })).includes(HOST_UNREACHABLE(base)));
  });
});

test('outside a Wheelhouse project the inputs say so', async () => {
  const home = shortHome();
  await as(home, async () => {
    register(home);
    for (const cwd of [tempFolder('wh-elsewhere-'), undefined, '', 'relative/folder', 42]) {
      const found = await loadBoardInputs({ cwd, client: fakeClient(), now: () => NOW });
      assert.equal(typeof found.none, 'string', String(cwd));
      assert.equal(found.model, undefined);
    }
  });
});

test('the inputs gather the views, events, settings, usage, sources and health from files', async () => {
  const home = shortHome();
  await as(home, async () => {
    const repo = register(home);
    keepEverything();
    const client = fakeClient({ lock: { ok: true, result: { computer: 'ffffffff' } } });
    const found = await loadBoardInputs({ cwd: path.join(repo, 'src'), client, address: testAddress(home), now: () => NOW });
    assert.equal(found.project, P);
    assert.deepEqual(found.model.director.waiting.map((w) => w.what), ['Approve the sign-in page']);
    assert.deepEqual(found.model.build.features.map((f) => [f.title, f.step]), [['Sign-in page', 'building']]);
    assert.deepEqual(found.model.director.changed.map((c) => c.what), ['People can search']);
    assert.equal(found.settings.phase.value, 'launched');
    assert.equal(found.settings.boardTab.value, 'director');
    assert.equal(found.usage.week.share, 34);
    assert.equal(found.model.director.budget.share, 34);
    assert.equal(found.sources.advisories.length, 1);
    const lines = texts(found);
    assert.equal(lines[0], 'STOP is on, since 18 October 2026');
    for (const line of [NO_CI, LOCKED_ELSEWHERE, NO_PROFILE, 'A security advisory for owner/lib: A flaw']) assert.ok(lines.includes(line), line);
    assert.equal(lines.includes(NO_HELPER), false);
    if (process.platform === 'darwin') assert.ok(lines.includes('This project has real users: Locked would protect it more'));
    assert.deepEqual(client.calls.sort(), ['health', 'lock']);
    assert.deepEqual(found.model.missing.filter((line) => /state|settings|sources|How the project stands/.test(line)), []);
  });
});

// This computer's setup journal with step 9 settled on the push test's answer.
const PUSH_LINE = phonePushLine('2026-10-19T01:00:00.000Z');
function settledPushTest(arrived) {
  put(journalFile(), { v: 1, runs: [{ id: 'run-1', folder: '/x', startedAt: '2026-10-19T00:00:00.000Z', steps: { 9: { doneAt: '2026-10-19T01:00:00.000Z' } },
    changes: [{ id: 'chg-1', step: 9, kind: 'answer', target: 'step 9', before: null, after: { pushArrived: arrived } }] }] });
}

test('a push test that didn\'t reach the phone, in setup\'s journal, is on the board\'s health; one that did isn\'t', async () => {
  const home = shortHome();
  await as(home, async () => {
    const repo = register(home);
    keepEverything();
    assert.equal(texts(await loadBoardInputs({ cwd: repo, client: fakeClient(), now: () => NOW })).includes(PUSH_LINE), false, 'no journal');
    settledPushTest(false);
    assert.ok(texts(await loadBoardInputs({ cwd: repo, client: fakeClient(), now: () => NOW })).includes(PUSH_LINE));
    settledPushTest(true);
    assert.equal(texts(await loadBoardInputs({ cwd: repo, client: fakeClient(), now: () => NOW })).includes(PUSH_LINE), false);
    // A journal that can't be read adds no line, and the board still comes.
    put(journalFile(), 'not json');
    const found = await loadBoardInputs({ cwd: repo, client: fakeClient(), now: () => NOW });
    assert.equal(texts(found).includes(PUSH_LINE), false);
    assert.equal(found.project, P);
  });
});

test('a profile setting written but not confirmed is on the board, as the director\'s own', async () => {
  const home = shortHome();
  await as(home, async () => {
    const repo = register(home);
    keepEverything();
    put(path.join(profileViewsDir(), 'unconfirmed.json'), [
      { kind: 'setting', id: 'p1', at: '2026-10-18T08:00:00.000Z', key: 'briefing', data: { key: 'briefing', value: 'short' } },
    ]);
    const found = await loadBoardInputs({ cwd: repo, client: fakeClient(), now: () => NOW });
    assert.deepEqual(found.model.director.first, ['Your setting: briefing short, not yet confirmed by you']);
  });
});

test('the inputs wait at most 2 seconds for the helper and then use what they have', async () => {
  const home = shortHome();
  await as(home, async () => {
    const repo = register(home);
    keepEverything();
    const never = () => new Promise(() => {});
    const started = Date.now();
    // Done before a timer half as long again, set at the same moment, however busy the computer is.
    const { inTime, value: found } = await beforeTimer(() => loadBoardInputs({ cwd: repo, client: fakeClient({ health: never, lock: never }), address: testAddress(home), now: () => NOW }), HELPER_WAIT_MS * 1.5);
    const took = Date.now() - started;
    assert.ok(inTime, `still waiting after ${took} ms`);
    assert.ok(took >= 1900, `gave up after ${took} ms`);
    // What the files hold is all there; the helper counts as not answering, and the lock as unknown.
    assert.deepEqual(found.model.director.waiting.map((w) => w.what), ['Approve the sign-in page']);
    const lines = texts(found);
    assert.ok(lines.includes(NO_HELPER));
    assert.equal(lines.includes(LOCKED_ELSEWHERE), false);
    assert.ok(lines.includes(NO_CI), 'host facts from the cache');
  });
});

test('offline, the inputs ask the helper nothing and leave out what only it knows', async () => {
  const home = shortHome();
  await as(home, async () => {
    const repo = register(home);
    keepEverything();
    const client = fakeClient({ health: { ok: false, refused: 'down' }, lock: { ok: true, result: { computer: 'ffffffff' } } });
    // Offline, done before a timer of 450 ms set at the same moment, as the status line needs.
    const { inTime, value: found } = await beforeTimer(() => loadBoardInputs({ cwd: repo, client, address: testAddress(home), now: () => NOW, offline: true }), 450);
    assert.ok(inTime, 'it took 450 ms or more');
    assert.deepEqual(client.calls, []);
    const lines = texts(found);
    assert.equal(lines.includes(NO_HELPER), false);
    assert.equal(lines.includes(LOCKED_ELSEWHERE), false);
    // A cache older than a day is still read, and nothing asks the host for a newer one.
    assert.ok(lines.includes(NO_CI));
    assert.equal(fs.existsSync(path.join(stateDir(P), '..', 'host-facts-tried.json')), false);
    assert.deepEqual(found.model.director.waiting.map((w) => w.what), ['Approve the sign-in page']);
    assert.equal(found.model.director.budget.share, 34);
  });
});

test('the Chrome line reads the pages the main folder\'s configuration lists, and the browser found (F74)', async () => {
  const home = shortHome();
  await as(home, async () => {
    const repo = register(home);
    const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const EDGE = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
    const said = async (found, options = {}) => texts(await loadBoardInputs({ cwd: repo, client: fakeClient(), now: () => NOW, findBrowser: () => found, ...options })).includes(NO_CHROME_LINE);
    // No configuration, or one listing no pages: nothing, whatever the browser.
    assert.equal(await said(null), false);
    put(path.join(repo, '.claude', 'wheelhouse.json'), { v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [] });
    assert.equal(await said(EDGE), false);
    // Pages listed: the line with Edge alone or no browser, none with Chrome.
    put(path.join(repo, '.claude', 'wheelhouse.json'), { v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [], pages: ['/'] });
    assert.equal(await said(EDGE), true);
    assert.equal(await said(null), true);
    assert.equal(await said(CHROME), false);
    // The glance shows no line of this level, so offline nothing is looked for.
    assert.equal(await said(null, { offline: true }), false);
    // A configuration that can't be read says nothing.
    put(path.join(repo, '.claude', 'wheelhouse.json'), '{ "v": 1, "pages": [');
    assert.equal(await said(null), false);
  });
});

test('with every file missing, a project still gets a model that names what is missing', async () => {
  const home = shortHome();
  await as(home, async () => {
    const repo = register(home);
    // A damaged view and a damaged report are no view and no report.
    put(path.join(wheelhouseHome(), 'projects', P, 'views', 'waiting.json'), '{not json');
    put(path.join(sourcesDir(), 'report.json'), '[1, 2]');
    const found = await loadBoardInputs({ cwd: repo, client: fakeClient({ health: { ok: false, refused: 'down' }, lock: { ok: false } }), address: testAddress(home), now: () => NOW });
    assert.equal(found.project, P);
    assert.equal(found.sources, null);
    assert.equal(found.settings.phase.value, 'before-launch');
    for (const line of [
      'There is no state for this project on this computer yet',
      'The build loop isn\'t running yet',
      'The weekly check of official sources hasn\'t run yet',
    ]) assert.ok(found.model.missing.includes(line), line);
    assert.ok(texts(found).includes(NO_HELPER));
    // A clock that can't be read is named, and nothing throws.
    const unread = await loadBoardInputs({ cwd: repo, client: fakeClient(), address: testAddress(home), now: () => { throw new Error('no clock'); } });
    assert.equal(unread.model.builtAt, null);
    assert.ok(unread.model.missing.includes('The board\'s clock couldn\'t be read'));
  });
});

test('a helper that takes the request and never answers still leaves the cached facts, and is marked as tried', async () => {
  const home = shortHome();
  await as(home, async () => {
    const repo = register(home);
    keepEverything();
    const address = testAddress(home);
    const held = new Set();
    // Accepts every connection and never answers.
    const server = net.createServer((socket) => { held.add(socket); socket.on('close', () => held.delete(socket)); socket.on('error', () => {}); });
    await new Promise((resolve) => server.listen(address, resolve));
    try {
      const { inTime, value: found } = await beforeTimer(() => loadBoardInputs({ cwd: repo, address, now: () => NOW }), HELPER_WAIT_MS * 1.5);
      assert.ok(inTime, 'still waiting on the helper');
      const lines = texts(found);
      assert.ok(lines.includes(NO_CI), 'the old cache still speaks');
      assert.ok(lines.includes(NO_HELPER));
      // Marked before the reading returned, so a hook that exits straight after doesn't wait on it again.
      const tried = JSON.parse(fs.readFileSync(path.join(stateDir(P), '..', 'host-facts-tried.json'), 'utf8'));
      assert.equal(tried.at, NOW.toISOString());
    } finally {
      for (const socket of held) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

const INPUTS = fileURLToPath(new URL('../../../scripts/board/inputs.js', import.meta.url));
const RENDER = fileURLToPath(new URL('../../../scripts/board/render.js', import.meta.url));

test('offline, only the files the glance needs are read: no other view, usage day, event, setting or report', { skip: process.platform === 'win32' }, async (t) => {
  const home = shortHome();
  await as(home, async () => {
    const repo = register(home);
    keepEverything();
    // Each of these is a pipe nobody writes to: reading one would wait for ever.
    const today = NOW.toISOString().slice(0, 10);
    const pipes = [
      path.join(wheelhouseHome(), 'projects', P, 'views', 'ideas.json'),
      path.join(wheelhouseHome(), 'projects', P, 'views', 'settings.json'),
      path.join(usageDir(), 'records', `${today}.jsonl`),
      path.join(usageDir(), 'mod', `${today}.jsonl`),
      path.join(stateDir(P), 'events', '2026', 'm2.json'),
      path.join(profileViewsDir(), 'settings.json'),
      path.join(sourcesDir(), 'report.json'),
      journalFile(),
    ];
    for (const pipe of pipes) {
      fs.mkdirSync(path.dirname(pipe), { recursive: true });
      fs.rmSync(pipe, { force: true });
      if (spawnSync('mkfifo', [pipe]).status !== 0) {
        t.skip('no mkfifo here');
        return;
      }
    }
    const script = `const { loadBoardInputs } = await import(${JSON.stringify(INPUTS)});
const { glanceLine } = await import(${JSON.stringify(RENDER)});
const found = await loadBoardInputs({ cwd: ${JSON.stringify(repo)}, now: () => new Date(${JSON.stringify(NOW.toISOString())}), offline: true });
process.stdout.write(glanceLine(found.model));
process.exit(0);`;
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: { ...process.env, WHEELHOUSE_HOME: home }, timeout: 5000 });
    assert.equal(run.error, undefined, 'it read a pipe and waited');
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, 'Wheelhouse · 1 waiting · 1 building · week 34% · STOP on');
  });
});

test('a shorter waitMs is how long a helper that never answers is waited for', async () => {
  const home = shortHome();
  await as(home, async () => {
    const repo = register(home);
    keepEverything();
    const never = () => new Promise(() => {});
    const hung = { health: never, lock: { read: never } };
    // Each is done before a timer set at the same moment: 300 ms before the usual wait, and the
    // usual wait before one half as long again.
    for (const [waitMs, under] of [[300, HELPER_WAIT_MS], [undefined, HELPER_WAIT_MS * 1.5], [10, HELPER_WAIT_MS * 1.5]]) {
      const started = Date.now();
      const { inTime, value: found } = await beforeTimer(() => loadBoardInputs({ cwd: repo, client: hung, now: () => NOW, waitMs }), under);
      const took = Date.now() - started;
      assert.ok(inTime, `${waitMs}: still waiting after ${took} ms`);
      // Too short a wait gives the usual one.
      if (waitMs !== 300) assert.ok(took >= HELPER_WAIT_MS - 50, `${waitMs}: ${took} ms`);
      assert.equal(found.project, P);
      assert.match(texts(found).join('\n'), /helper/i);
    }
  });
});
