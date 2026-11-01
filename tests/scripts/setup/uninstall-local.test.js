// tests/scripts/setup/uninstall-local.test.js
// Uninstall of a project kept on this computer (spec 10), after a whole setup in the end-to-end world: the folder takes all the
// home holds, the last local change takes setup's files out, the remote, mirror and check folder go, and the home has its own
// card. The real helper and git run; a host tool never does.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { standInHost, makeClock, makeComputer, shimTools, shutOutGitConfig, follow } from '../../helpers/setup-e2e.js';
import { REAL_USERS } from '../../../scripts/setup/host.js';
import { LIVE_DATA } from '../../../scripts/setup/questions.js';
import { READY, ARRIVED } from '../../../scripts/setup/notify.js';
import { SETUP_FILES } from '../../../scripts/setup/project-files.js';
import { mirrorOf } from '../../../scripts/setup/local.js';
import { UNINSTALL_LABEL } from '../../../scripts/state/card-lines.js';
import { DELETE_LABEL } from '../../../scripts/setup/uninstall.js';
import { UNINSTALL_TITLE } from '../../../scripts/setup/uninstall-run.js';
import { homeDir } from '../../../scripts/host/local/home.js';
import { keepSeenMain } from '../../../scripts/host/local/merge.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { engineDir } from '../../../scripts/lib/paths.js';
import { g } from '../../helpers/git-fixture.js';
import { waitLongerOnTheHelper } from '../../helpers/until.js';

waitLongerOnTheHelper();

const SKIP = process.platform === 'win32' ? 'the session start and setup\'s ending find the helper at the user\'s own named pipe on Windows' : false;
const PROJECT = 'Cafe-Menu';
const ANSWERS = {
  'real-users': REAL_USERS.no, product: 'Tide tables for sailors, used by the harbour\'s skippers.', 'live-data': LIVE_DATA.no,
  'phone-ready': READY.ready, 'push-arrived': ARRIVED.yes,
};

let shims;
let gitConfig;
before(() => {
  if (SKIP) return;
  shims = shimTools();
  gitConfig = shutOutGitConfig();
});
after(() => {
  shims?.restore();
  gitConfig?.restore();
});

// A computer with setup finished on a project kept on it.
async function setUp() {
  shims.reset();
  const clock = makeClock();
  const a = makeComputer(standInHost({ shims }), clock);
  await a.start();
  await a.sessionStart();
  await follow(a, { answer: (id) => (id.startsWith('plan-') ? 'Go ahead' : ANSWERS[Object.keys(ANSWERS).find((k) => id === k || id.startsWith(`${k}-`))]), phone: true });
  const home = await a.act(() => homeDir(PROJECT));
  return { a, home };
}

// A commit on the home's main version, as a merge there leaves one, with the folder not yet up to it. Gives its id.
async function moveHome(a, home, name = 'tides.txt', text = 'high water\n') {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-home-'));
  await g(work, 'clone', '-q', home, '.');
  fs.writeFileSync(path.join(work, name), text);
  await g(work, 'add', name);
  await g(work, '-c', 'user.name=W', '-c', 'user.email=w@example.com', 'commit', '-q', '-m', `Add ${name}`);
  await g(work, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
  const tip = await g(work, 'rev-parse', 'HEAD');
  await a.act(() => keepSeenMain(PROJECT, tip));
  fs.rmSync(work, { recursive: true, force: true });
  return tip;
}

async function uninstall(a, { answer = 'Keep it' } = {}) {
  const plan = await a.cli('uninstall', 'plan');
  for (const ask of plan.asks) await a.click(ask.card, ask.about === 'home' ? answer : 'Keep it');
  await a.click(plan.card, UNINSTALL_LABEL);
  await a.cli('uninstall', 'apply', plan.hash);
  return { plan, status: await a.cli('uninstall', 'status') };
}

const holds = async (folder, commit) => (await g(folder, 'merge-base', '--is-ancestor', commit, 'HEAD').then(() => true, () => false));

test('uninstall brings the folder up first', { skip: SKIP }, async () => {
  const { a, home } = await setUp();
  try {
    const tip = await moveHome(a, home);
    assert.equal(await holds(a.folder, tip), false);
    const { plan, status } = await uninstall(a);
    const local = plan.card.question;
    assert.match(local, /bring this folder up to the main version/);
    assert.doesNotMatch(local, /pull request/);
    assert.equal(status[0], 'Uninstall is done.', status.join('\n'));
    assert.equal(await holds(a.folder, tip), true);
    assert.equal(fs.readFileSync(path.join(a.folder, 'tides.txt'), 'utf8'), 'high water\n');
  } finally {
    await a.cleanup();
  }
});

test('the wheelhouse remote, mirror and check folder go', { skip: SKIP }, async () => {
  const { a, home } = await setUp();
  try {
    await a.act(() => writeProject('another', { folder: path.join(a.user, 'another'), remoteUrl: null, host: 'local', repo: 'local/another', connection: { host: 'local', mode: 'none', project: 'local/another' } }));
    const [mirror, checks] = await a.act(() => [mirrorOf(PROJECT), path.join(engineDir(), 'checks', PROJECT)]);
    fs.mkdirSync(mirror, { recursive: true });
    fs.mkdirSync(checks, { recursive: true });
    const { status } = await uninstall(a);
    assert.equal(status[0], 'Uninstall is done.', status.join('\n'));
    await assert.rejects(g(a.folder, 'config', '--get', 'remote.wheelhouse.url'));
    assert.equal(fs.existsSync(mirror), false);
    assert.equal(fs.existsSync(checks), false);
    assert.equal(fs.existsSync(home), true, 'the home is kept unless its card says delete');
  } finally {
    await a.cleanup();
  }
});

test('project files leave by a last local change', { skip: SKIP }, async () => {
  const { a, home } = await setUp();
  try {
    assert.ok(SETUP_FILES.every((f) => fs.existsSync(path.join(a.folder, ...f.split('/')))));
    const { status } = await uninstall(a);
    assert.equal(status[0], 'Uninstall is done.', status.join('\n'));
    assert.equal(await g(home, 'log', '-1', '--format=%s', 'main'), UNINSTALL_TITLE);
    assert.equal(await g(a.folder, 'rev-parse', 'HEAD'), await g(home, 'rev-parse', 'main'));
    assert.ok(['.claude/wheelhouse.json', '.archon/config.yaml'].every((f) => !fs.existsSync(path.join(a.folder, ...f.split('/')))), 'setup\'s files are out of the folder');
    assert.equal(await g(a.folder, 'status', '--porcelain'), '', 'the folder is as its last commit');
    assert.deepEqual(a.refused, []);
    assert.deepEqual(a.launchd.map(([verb]) => verb), process.platform === 'darwin' ? ['bootout'] : [], 'the last uninstall unloads the agent');
  } finally {
    await a.cleanup();
  }
});

test('a folder with changes of its own stops uninstall with nothing of it touched', { skip: SKIP }, async () => {
  const { a } = await setUp();
  try {
    const readme = path.join(a.folder, SETUP_FILES[0]);
    fs.appendFileSync(readme, 'my own words\n');
    const { status } = await uninstall(a);
    assert.match(status.join('\n'), /your folder has changes of its own/, status.join('\n'));
    assert.match(fs.readFileSync(readme, 'utf8'), /my own words/);
    assert.notEqual(await g(a.folder, 'config', '--get', 'remote.wheelhouse.url'), '');
  } finally {
    await a.cleanup();
  }
});

test('the home gets one level-4 card with Keep it first', { skip: SKIP }, async () => {
  const { a, home } = await setUp();
  try {
    const plan = await a.cli('uninstall', 'plan');
    const cards = plan.asks.filter((x) => x.about === 'home');
    assert.equal(cards.length, 1);
    assert.equal(cards[0].card.options[0].label, 'Keep it');
    assert.equal(cards[0].card.options[1].label, DELETE_LABEL);
    assert.doesNotMatch(cards[0].card.question, /home\b.*bare|remote|forge/i);
    const { status } = await uninstall(a, { answer: DELETE_LABEL });
    assert.equal(status[0], 'Uninstall is done.', status.join('\n'));
    assert.equal(fs.existsSync(home), false);
    assert.ok(status.some((l) => /private copy is deleted/.test(l)), status.join('\n'));
  } finally {
    await a.cleanup();
  }
});

test('the folder\'s git holds the whole history afterwards', { skip: SKIP }, async () => {
  const { a, home } = await setUp();
  try {
    // A line only the home holds, and a main version that parted from the folder's, with no file in common changed.
    const main = await g(home, 'rev-parse', 'main');
    await g(home, 'branch', 'feature/a-job', main);
    const tip = await moveHome(a, home, 'tides.txt');
    await g(a.folder, 'checkout', '-q', 'main');
    fs.writeFileSync(path.join(a.folder, 'mine.txt'), 'by hand\n');
    await g(a.folder, 'add', 'mine.txt');
    await g(a.folder, '-c', 'user.name=D', '-c', 'user.email=d@example.com', 'commit', '-q', '-m', 'Add my own file');
    const { status } = await uninstall(a, { answer: DELETE_LABEL });
    assert.equal(status[0], 'Uninstall is done.', status.join('\n'));
    assert.equal(fs.existsSync(home), false);
    assert.equal(await holds(a.folder, tip), true);
    assert.equal(await g(a.folder, 'rev-parse', 'feature/a-job'), main);
    assert.equal(fs.existsSync(path.join(a.folder, 'mine.txt')), true);
    assert.equal(await g(a.folder, 'status', '--porcelain'), '');
  } finally {
    await a.cleanup();
  }
});
