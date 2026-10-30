// tests/scripts/host/helper-broker.test.js
// The helper's broker routes (Archon design, section 12.4): a call is placed by its folder, sorted and decided by the
// rules, and only a call that passes reaches the real gh. No GitHub token leaves the helper: git's reads come from a
// fetch mirror the helper keeps, and /broker/refresh brings it up to date.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { brokerRoutes } from '../../../scripts/engine/broker/routes.js';

const HEAD = 'a'.repeat(40);

function setup({ permit = { stop: false, lockHeld: true, defaultBranch: 'main', incident: { open: false } } } = {}) {
  const forwarded = [];
  const refreshed = [];
  const routes = brokerRoutes({
    placeOf: (cwd) => (String(cwd).startsWith('/p') ? { project: 'p', folder: '/p', repo: 'acme/web' } : null),
    permit: async () => permit,
    forward: async (project, argv, opts) => { forwarded.push({ project, argv, opts }); return { code: 0, stdout: 'out\n', stderr: '' }; },
    refresh: async (project) => { refreshed.push(project); return { ok: true }; },
  });
  return { routes, forwarded, refreshed };
}

test('a read is forwarded and its output comes back unchanged', async () => {
  const { routes, forwarded } = setup();
  assert.deepEqual(await routes['/broker/gh']({ argv: ['pr', 'view', '14', '--json', 'body'], cwd: '/p/wt' }), { ok: true, code: 0, stdout: 'out\n', stderr: '' });
  assert.deepEqual(forwarded[0].argv, ['pr', 'view', '14', '--json', 'body']);
});

test('a refused call never reaches the real gh, and says why as gh\'s error output', async () => {
  const { routes, forwarded } = setup();
  const merge = await routes['/broker/gh']({ argv: ['pr', 'merge', '14', '--squash', '--match-head-commit', HEAD], cwd: '/p/wt' });
  assert.equal(merge.code, 1);
  assert.match(merge.stderr, /no signed CLEAN review/);
  const other = await routes['/broker/gh']({ argv: ['repo', 'delete', 'acme/web'], cwd: '/p/wt' });
  assert.match(other.stderr, /isn't on Wheelhouse's list/);
  const outside = await routes['/broker/gh']({ argv: ['pr', 'view', '1'], cwd: '/elsewhere' });
  assert.match(outside.stderr, /isn't a registered project's/);
  const elsewhere = await routes['/broker/gh']({ argv: ['pr', 'view', '1', '--repo', 'other/repo'], cwd: '/p/wt' });
  assert.match(elsewhere.stderr, /isn't on Wheelhouse's list/, 'a call naming another repository');
  assert.equal(forwarded.length, 0);
});

test('no route hands a token to a caller', async () => {
  const { routes, forwarded, refreshed } = setup();
  assert.deepEqual(Object.keys(routes).sort(), ['/broker/gh', '/broker/refresh'], 'there is no credential route');
  for (const argv of [['auth', 'token'], ['auth', 'status', '--show-token'], ['auth', 'git-credential', 'get']]) {
    const got = await routes['/broker/gh']({ argv, cwd: '/p/wt' });
    assert.match(got.stderr, /isn't on Wheelhouse's list/, argv.join(' '));
  }
  assert.equal(forwarded.length, 0);
  // A fetch is the helper's: it refreshes the project's fetch mirror, and the answer says only that it did.
  assert.deepEqual(await routes['/broker/refresh']({ cwd: '/p/wt' }), { ok: true });
  assert.deepEqual(refreshed, ['p']);
  assert.equal((await routes['/broker/refresh']({ cwd: '/elsewhere' })).ok, false);
  const helper = fs.readFileSync(path.join(import.meta.dirname, '..', '..', '..', 'scripts', 'host', 'helper.js'), 'utf8');
  assert.doesNotMatch(helper, /\/broker\/credential/, 'the helper serves no credential route, and scrubs every broker answer');
});

test('a re-run of the main line\'s failed jobs reaches the real gh only while the main line is red', async () => {
  const red = setup({ permit: { stop: false, lockHeld: true, defaultBranch: 'main', incident: { open: true, isFix: false }, redMain: true, runBranch: 'main' } });
  const argv = ['run', 'rerun', '77', '--failed'];
  assert.equal((await red.routes['/broker/gh']({ argv, cwd: '/p/wt' })).code, 0);
  assert.deepEqual(red.forwarded.map((f) => f.argv), [argv]);
  const green = setup({ permit: { stop: false, lockHeld: true, defaultBranch: 'main', incident: { open: false }, redMain: false, runBranch: 'main' } });
  const got = await green.routes['/broker/gh']({ argv, cwd: '/p/wt' });
  assert.equal(got.code, 1);
  assert.match(got.stderr, /red main line/);
  assert.equal(green.forwarded.length, 0);
});

test("a call from the merge queue's folder is shaped before the list decides it, and each one refused is a Logbook line", async () => {
  const forwarded = [];
  const notes = [];
  const routes = brokerRoutes({
    placeOf: (cwd) => (String(cwd).startsWith('/engine/queues/p') ? { project: 'p', folder: '/p', repo: 'acme/web', queue: true } : String(cwd).startsWith('/p') ? { project: 'p', folder: '/p', repo: 'acme/web' } : null),
    permit: async () => ({ stop: false, lockHeld: true, defaultBranch: 'main', incident: { open: false } }),
    forward: async (project, argv, opts) => { forwarded.push({ argv, stdin: opts.stdin }); return { code: 0, stdout: '', stderr: '' }; },
    refresh: async () => ({ ok: true }),
    queueCall: async (place, argv) => (argv[1] === 'edit' ? { ok: true, argv: ['pr', 'edit', '5', '--body-file', '-'], stdin: 'Closes #5\n' } : argv[1] === 'create' ? { ok: false, refused: 'not from the queue' } : { ok: true, argv, stdin: '' }),
    note: async (project, words) => { notes.push({ project, words }); },
  });
  const edit = await routes['/broker/gh']({ argv: ['pr', 'edit', '5', '--body-file', '/a/pr-body-5.md'], cwd: '/engine/queues/p' });
  assert.equal(edit.code, 0);
  assert.deepEqual(forwarded.at(-1), { argv: ['pr', 'edit', '5', '--body-file', '-'], stdin: 'Closes #5\n' });
  const create = await routes['/broker/gh']({ argv: ['pr', 'create', '--head', 'b'], cwd: '/engine/queues/p' });
  assert.match(create.stderr, /not from the queue/);
  const off = await routes['/broker/gh']({ argv: ['repo', 'delete', 'acme/web'], cwd: '/engine/queues/p' });
  assert.match(off.stderr, /isn't on Wheelhouse's list/);
  assert.equal(forwarded.length, 1);
  assert.deepEqual(notes.map((n) => n.project), ['p', 'p']);
  assert.match(notes[0].words, /merge queue's call gh pr create/);
  // A run's own call is neither shaped nor noted.
  await routes['/broker/gh']({ argv: ['repo', 'delete', 'acme/web'], cwd: '/p/wt' });
  assert.equal(notes.length, 2);
});
