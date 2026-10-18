// tests/scripts/lib/homes.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { withHome } from '../../helpers/homes.js';

test('withHome removes its temporary folders', async () => {
  const before = process.env.WHEELHOUSE_HOME;
  let seen;
  // Synchronous work.
  const value = withHome((home) => {
    seen = home;
    assert.equal(process.env.WHEELHOUSE_HOME, home);
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(`${home}/x`, 'x');
    return 7;
  });
  assert.equal(value, 7);
  assert.equal(fs.existsSync(seen), false);
  assert.equal(fs.existsSync(seen.replace(/[\\/]home$/, '')), false, 'the folder above the home goes too');
  assert.equal(process.env.WHEELHOUSE_HOME, before);

  // Asynchronous work, and work that throws.
  let asyncSeen;
  assert.equal(await withHome(async (home) => { asyncSeen = home; fs.mkdirSync(home, { recursive: true }); return 'a'; }), 'a');
  assert.equal(fs.existsSync(asyncSeen.replace(/[\\/]home$/, '')), false);
  let thrownSeen;
  await assert.rejects(withHome(async (home) => { thrownSeen = home; throw new Error('boom'); }), /boom/);
  assert.equal(fs.existsSync(thrownSeen.replace(/[\\/]home$/, '')), false);
  assert.throws(() => withHome((home) => { thrownSeen = home; throw new Error('boom'); }), /boom/);
  assert.equal(fs.existsSync(thrownSeen.replace(/[\\/]home$/, '')), false);
  assert.equal(process.env.WHEELHOUSE_HOME, before);
});
