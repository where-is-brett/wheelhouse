// tests/scripts/host/token-url.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenUrl } from '../../../scripts/host/token-url.js';

const request = { owner: 'a-director', repos: ['product', 'wheelhouse-profile'], name: 'Wheelhouse agents', days: 366 };

test('tokenUrl fills in the GitHub page with the kept key\'s permissions', () => {
  const url = new URL(tokenUrl({ host: 'github', ...request }));
  assert.equal(url.hostname, 'github.com');
  assert.equal(url.pathname, '/settings/personal-access-tokens/new');
  assert.equal(url.searchParams.get('name'), 'Wheelhouse agents');
  assert.equal(url.searchParams.get('target_name'), 'a-director');
  assert.equal(url.searchParams.get('expires_in'), '366');
  assert.equal(url.searchParams.get('contents'), 'write');
  assert.equal(url.searchParams.get('pull_requests'), 'write');
  assert.equal(url.searchParams.get('issues'), 'write');
  assert.equal(url.searchParams.get('statuses'), 'read');
  assert.equal(url.searchParams.get('checks'), 'read');
  assert.equal(url.searchParams.get('metadata'), 'read');
  assert.equal(url.searchParams.get('administration'), null, 'Administration is never in the kept key');
  assert.match(url.searchParams.get('description'), /product, wheelhouse-profile/);
});

test('tokenUrl asks for statuses at write only where checks run on the computer', () => {
  const url = new URL(tokenUrl({ host: 'github', ...request, localChecks: true }));
  assert.equal(url.searchParams.get('statuses'), 'write');
});

test('tokenUrl makes the one-off Administration key short-lived and with nothing else but metadata', () => {
  const url = new URL(tokenUrl({ host: 'github', kind: 'administration', ...request, days: 30 }));
  assert.equal(url.searchParams.get('administration'), 'write');
  assert.equal(url.searchParams.get('metadata'), 'read');
  assert.equal(url.searchParams.get('expires_in'), '1');
  for (const other of ['contents', 'pull_requests', 'issues', 'statuses', 'checks']) assert.equal(url.searchParams.get(other), null, other);
  assert.match(url.searchParams.get('description'), /once/i);
  assert.match(url.searchParams.get('name'), /one use/i);
});

test('tokenUrl keeps the GitHub name within 40 characters', () => {
  const url = new URL(tokenUrl({ host: 'github', ...request, name: 'x'.repeat(60) }));
  assert.equal(url.searchParams.get('name').length, 40);
});

test('tokenUrl refuses an expiry GitHub does not accept', () => {
  assert.throws(() => tokenUrl({ host: 'github', ...request, days: 400 }), /1 to 366/);
});

test('tokenUrl fills in the GitLab personal page with the two scopes, a name and a description, and no expiry', () => {
  const url = new URL(tokenUrl({ host: 'gitlab', ...request }));
  assert.equal(url.hostname, 'gitlab.com');
  assert.ok(url.pathname.endsWith('/-/user_settings/personal_access_tokens'));
  assert.equal(url.searchParams.get('name'), 'Wheelhouse agents');
  assert.equal(url.searchParams.get('scopes'), 'api,write_repository');
  assert.match(url.searchParams.get('description'), /product, wheelhouse-profile/);
  assert.equal(url.searchParams.get('expires_at'), null, 'GitLab documents no expiry parameter');
});

test('tokenUrl follows a company\'s GitLab address', () => {
  const url = new URL(tokenUrl({ host: 'gitlab', ...request, base: 'https://gitlab.example.org/' }));
  assert.equal(url.origin, 'https://gitlab.example.org');
});

test('tokenUrl opens the GitLab project key page without filling it in, as GitLab documents no filling there', () => {
  const url = new URL(tokenUrl({ host: 'gitlab', kind: 'project', project: 'group/sub/shop', ...request, base: 'https://gitlab.example.org' }));
  assert.equal(url.pathname, '/group/sub/shop/-/settings/access_tokens');
  assert.equal([...url.searchParams].length, 0);
});

test('tokenUrl needs the project for its key page', () => {
  assert.throws(() => tokenUrl({ host: 'gitlab', kind: 'project', ...request }), /project/);
});
