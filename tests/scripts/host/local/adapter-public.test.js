// tests/scripts/host/local/adapter-public.test.js
// A project kept on this computer alone is never public, so its decisions are never offered "private".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withKeyedHome } from '../../../helpers/local-home.js';
import { makeLocalAdapter } from '../../../../scripts/host/local/adapter.js';

test('a local home is always private', async () => {
  await withKeyedHome(async () => {
    assert.equal(await makeLocalAdapter({ project: 'shop' }).isPublic(), false);
  });
});
