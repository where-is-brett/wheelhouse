// tests/scripts/host/helper-broker.test.js
// The helper's broker routes (Archon design, section 12.4): a call is placed by its folder, sorted and decided by the
// rules, and only a call that passes reaches the real gh; git's credential request is answered only for the project's
// own repository.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brokerRoutes } from '../../../scripts/engine/broker/routes.js';

const HEAD = 'a'.repeat(40);

function setup({ permit = { stop: false, lockHeld: true, defaultBranch: 'main', incident: { open: false } } } = {}) {
  const forwarded = [];
  const routes = brokerRoutes({
    placeOf: (cwd) => (String(cwd).startsWith('/p') ? { project: 'p', folder: '/p', repo: 'acme/web' } : null),
    permit: async () => permit,
    forward: async (project, argv, opts) => { forwarded.push({ project, argv, opts }); return { code: 0, stdout: 'out\n', stderr: '' }; },
    credential: async () => ({ username: 'x-access-token', password: 'ghs_FAKE' }),
  });
  return { routes, forwarded };
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

test('the credential helper answers only for a request from the project for its own repository', async () => {
  const { routes } = setup();
  const ok = await routes['/broker/credential']({ cwd: '/p/wt', action: 'get', request: 'protocol=https\nhost=github.com\npath=acme/web.git\n' });
  assert.deepEqual(ok, { ok: true, username: 'x-access-token', password: 'ghs_FAKE' });
  for (const [cwd, request, action] of [
    ['/p/wt', 'protocol=https\nhost=github.com\npath=other/repo.git\n', 'get'],
    ['/p/wt', 'protocol=https\nhost=github.com\n', 'get'],
    ['/p/wt', 'protocol=https\nhost=gitlab.com\n', 'get'],
    ['/elsewhere', 'protocol=https\nhost=github.com\n', 'get'],
    ['/p/wt', 'protocol=https\nhost=github.com\n', 'store'],
  ]) {
    assert.equal((await routes['/broker/credential']({ cwd, action, request })).ok, false, `${cwd} ${request}`);
  }
});
