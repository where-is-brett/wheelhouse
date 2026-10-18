// tests/scripts/host/token-url.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenUrl } from '../../../scripts/host/token-url.js';

const request = { owner: 'a-director', repos: ['product', 'wheelhouse-profile'], name: 'Wheelhouse agents', days: 366 };

test('tokenUrl fills in the GitHub page', () => {
  const url = new URL(tokenUrl({ host: 'github', ...request }));
  assert.equal(url.hostname, 'github.com');
  assert.equal(url.pathname, '/settings/personal-access-tokens/new');
  assert.equal(url.searchParams.get('name'), 'Wheelhouse agents');
  assert.equal(url.searchParams.get('target_name'), 'a-director');
  assert.equal(url.searchParams.get('expires_in'), '366');
  assert.equal(url.searchParams.get('contents'), 'write');
  assert.equal(url.searchParams.get('pull_requests'), 'write');
  assert.equal(url.searchParams.get('issues'), 'write');
  assert.equal(url.searchParams.get('metadata'), 'read');
  assert.match(url.searchParams.get('description'), /product, wheelhouse-profile/);
});

test('tokenUrl keeps the GitHub name within 40 characters', () => {
  const url = new URL(tokenUrl({ host: 'github', ...request, name: 'x'.repeat(60) }));
  assert.equal(url.searchParams.get('name').length, 40);
});

test('tokenUrl refuses an expiry GitHub does not accept', () => {
  assert.throws(() => tokenUrl({ host: 'github', ...request, days: 400 }), /1 to 366/);
});

test('tokenUrl fills in the GitLab page', () => {
  const url = new URL(tokenUrl({ host: 'gitlab', ...request }));
  assert.equal(url.hostname, 'gitlab.com');
  assert.ok(url.pathname.endsWith('/personal_access_tokens'));
  assert.equal(url.searchParams.get('name'), 'Wheelhouse agents');
  assert.equal(url.searchParams.get('scopes'), 'api');
});
