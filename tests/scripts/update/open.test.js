// tests/scripts/update/open.test.js
// How the update opens its reviewed change (update design, section 6.2): one commit on wheelhouse-release-<commit>, built beside the
// director's main checkout without touching its files, its index or its branch; the branch pushed through the helper's /push and
// the change opened through /pr/open-release. Real git in a folder of the test's own; the helper is a stand-in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openReleaseChange } from '../../../scripts/update/open.js';
import { g } from '../../helpers/git-fixture.js';
import { tempFolder } from '../../helpers/homes.js';

const SHA = 'c'.repeat(40);
const BRANCH = `wheelhouse-release-${SHA}`;
const OLD = `${JSON.stringify({ extraKnownMarketplaces: { wheelhouse: { source: { ref: 'v0.2.6' } } } }, null, 2)}\n`;
const NEW = `${JSON.stringify({ extraKnownMarketplaces: { wheelhouse: { source: { ref: 'v0.2.7' } } } }, null, 2)}\n`;

async function repo() {
  const dir = tempFolder('wh-uo-');
  await g(dir, 'init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'deep'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), OLD);
  fs.writeFileSync(path.join(dir, '.claude', 'other.json'), '{}\n');
  fs.writeFileSync(path.join(dir, 'src', 'deep', 'a.js'), 'a\n');
  fs.writeFileSync(path.join(dir, 'README.md'), 'hello\n');
  await g(dir, 'add', '-A');
  await g(dir, 'commit', '-q', '-m', 'one');
  return dir;
}

function stand(over = {}) {
  const calls = [];
  return {
    calls,
    client: {
      push: async (b) => { calls.push(['push', b]); return over.push ?? { ok: true }; },
      openReleasePr: async (b) => { calls.push(['open', b]); return over.open ?? { ok: true, result: { number: 12, url: 'https://example.com/pr/12' } }; },
    },
  };
}

const request = (dir) => ({ project: 'p1', projectDir: dir, branch: BRANCH, file: '.claude/settings.json', text: NEW, title: 'Move this project to Wheelhouse v0.2.7', body: 'Moves it.', release: 'v0.2.7', commit: SHA });

test('open: one commit on the release branch changes only the settings file, and the main checkout is not touched', async () => {
  const dir = await repo();
  const before = { head: await g(dir, 'rev-parse', 'HEAD'), branch: await g(dir, 'branch', '--show-current'), status: await g(dir, 'status', '--porcelain'), settings: fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8') };
  const { client, calls } = stand();
  const got = await openReleaseChange({ ...request(dir), client });
  assert.deepEqual([got.ok, got.number], [true, 12]);
  assert.equal(await g(dir, 'diff', '--name-only', 'main', BRANCH), '.claude/settings.json');
  assert.equal(await g(dir, 'show', `${BRANCH}:.claude/settings.json`), NEW.trim());
  assert.equal(await g(dir, 'rev-parse', `${BRANCH}^`), before.head);
  assert.equal(await g(dir, 'rev-list', '--count', `main..${BRANCH}`), '1');
  assert.deepEqual({ head: await g(dir, 'rev-parse', 'HEAD'), branch: await g(dir, 'branch', '--show-current'), status: await g(dir, 'status', '--porcelain'), settings: fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8') }, before);
  assert.deepEqual(calls.map((c) => c[0]), ['push', 'open']);
  assert.deepEqual(calls[0][1], { project: 'p1', dir, refspec: BRANCH });
  assert.deepEqual(calls[1][1], { project: 'p1', release: 'v0.2.7', commit: SHA, head: BRANCH, title: 'Move this project to Wheelhouse v0.2.7', body: 'Moves it.' });
});

test('open: a settings file that is not there yet is added in its folder, and asking again reuses the branch', async () => {
  const dir = await repo();
  await g(dir, 'rm', '-q', '-r', '.claude');
  await g(dir, 'commit', '-q', '-m', 'no settings');
  const { client } = stand();
  assert.equal((await openReleaseChange({ ...request(dir), client })).ok, true);
  assert.equal(await g(dir, 'show', `${BRANCH}:.claude/settings.json`), NEW.trim());
  const first = await g(dir, 'rev-parse', BRANCH);
  assert.equal((await openReleaseChange({ ...request(dir), client })).ok, true);
  assert.equal(await g(dir, 'rev-parse', BRANCH), first);
});

test('open: a push the helper refuses, or a change it will not open, is said as the helper said it, and nothing else is tried', async () => {
  const dir = await repo();
  const pushed = stand({ push: { ok: false, refused: 'Wheelhouse does not hold the lock' } });
  assert.deepEqual(await openReleaseChange({ ...request(dir), client: pushed.client }), { ok: false, refused: 'Wheelhouse does not hold the lock' });
  assert.deepEqual(pushed.calls.map((c) => c[0]), ['push']);
  const refused = stand({ open: { ok: false, refused: 'All stop is on' } });
  assert.deepEqual(await openReleaseChange({ ...request(dir), client: refused.client }), { ok: false, refused: 'All stop is on' });
});

test('open: a project whose main version can not be found is not changed', async () => {
  const dir = tempFolder('wh-uo-');
  await g(dir, 'init', '-q', '-b', 'main');
  const { client, calls } = stand();
  const got = await openReleaseChange({ ...request(dir), client });
  assert.equal(got.ok, false);
  assert.match(got.refused, /main version/);
  assert.deepEqual(calls, []);
});

test('open: only a release or undo branch, and only the settings file, are taken', async () => {
  const dir = await repo();
  const { client, calls } = stand();
  assert.equal((await openReleaseChange({ ...request(dir), branch: 'feature-x', client })).ok, false);
  assert.equal((await openReleaseChange({ ...request(dir), file: 'src/deep/a.js', client })).ok, false);
  assert.deepEqual(calls, []);
});

test('open: a local branch of that name left by anything else is reset to the commit worked out here, and what is pushed is that commit', async () => {
  const dir = await repo();
  // A planted branch holding other content.
  await g(dir, 'checkout', '-q', '-b', 'planted');
  fs.writeFileSync(path.join(dir, 'README.md'), 'planted\n');
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), '{"planted":true}\n');
  await g(dir, 'commit', '-q', '-a', '-m', 'planted');
  await g(dir, 'branch', '-f', BRANCH, 'planted');
  await g(dir, 'checkout', '-q', 'main');
  const planted = await g(dir, 'rev-parse', BRANCH);
  const { client, calls } = stand();
  assert.equal((await openReleaseChange({ ...request(dir), client })).ok, true);
  const tip = await g(dir, 'rev-parse', BRANCH);
  assert.notEqual(tip, planted);
  assert.equal(await g(dir, 'show', `${BRANCH}:.claude/settings.json`), NEW.trim());
  assert.equal(await g(dir, 'show', `${BRANCH}:README.md`), 'hello');
  assert.equal(await g(dir, 'rev-parse', `${BRANCH}^`), await g(dir, 'rev-parse', 'main'));
  assert.equal(calls.find((c) => c[0] === 'push')[1].refspec, BRANCH, 'pushed by name, never forced');
});
