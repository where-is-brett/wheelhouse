// tests/scripts/lib/route.test.js
// The route reader (builders and settings design, section 6): the one reader of `builders:` and `builderLaunch:`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { builderRoute } from '../../../scripts/lib/route.js';
import { writeSignInFact } from '../../../scripts/lib/sign-in-gate.js';
import { tempFolder } from '../../helpers/homes.js';

const ID = '0a1b2c3d';
const views = (settings) => ({ settings: Object.fromEntries(Object.entries(settings).map(([key, value]) => [key, { key, value }])) });
const ok = () => ({ ok: true });
const read = (settings, extra = {}) => builderRoute({ agent: 'claude-code', computer: ID, home: tempFolder('wh-route-'), readViews: () => views(settings), fault: () => null, check: ok, ...extra });

test('builderRoute reads only the per-computer key, and none saved is no route, never a guess', () => {
  assert.deepEqual(read({ [`builders:${ID}`]: 'desktop' }), { route: 'desktop', from: 'profile', signIn: { open: true } });
  assert.equal(read({ [`builders:${ID}`]: 'background' }).route, 'background');
  assert.equal(read({ 'builders:ffffffff': 'desktop' }).route, null, "another computer's value is not this one's");
  assert.deepEqual(read({}), { route: null, from: 'unset', signIn: { open: true } });
  assert.equal(builderRoute({ computer: ID, readViews: () => null, fault: () => null }).from, 'unset');
});

test('a malformed value is from: fault with the file named, never read as none', () => {
  const bad = read({ [`builders:${ID}`]: 'both' });
  assert.equal(bad.route, null);
  assert.equal(bad.from, 'fault');
  assert.match(bad.fault.file, /builders:0a1b2c3d/);
  assert.equal(bad.signIn.open, false);
  const damaged = builderRoute({ computer: ID, readViews: () => null, fault: () => ({ file: '/h/settings.json', line: 3, column: 9, hint: 'A comma is missing.' }) });
  assert.equal(damaged.from, 'fault');
  assert.deepEqual([damaged.fault.file, damaged.fault.line, damaged.fault.column], ['/h/settings.json', 3, 9]);
  assert.match(damaged.signIn.reason, /settings\.json/);
});

test('a stored launch is returned, and one that fails checkLaunch makes the route count as unable to sign in', () => {
  const words = ['wrap', 'claude'];
  const good = read({ [`builders:${ID}`]: 'background', [`builderLaunch:${ID}`]: words });
  assert.deepEqual([good.route, good.launch, good.from], ['background', words, 'profile']);
  const failing = read({ [`builders:${ID}`]: 'background', [`builderLaunch:${ID}`]: words }, { check: () => ({ ok: false, why: "it isn't on this computer's PATH." }) });
  assert.equal(failing.from, 'fault');
  assert.equal(failing.signIn.open, false);
  assert.match(failing.signIn.reason, /launch command saved for this computer can't be used/);
  // Desktop does not use the launch command, so a bad one does not shut it.
  assert.equal(read({ [`builders:${ID}`]: 'desktop', [`builderLaunch:${ID}`]: words }, { check: () => ({ ok: false, why: 'x' }) }).signIn.open, true);
});

test('the sign-in gate applies to the background route only', () => {
  const home = tempFolder('wh-route-');
  writeSignInFact(home, 'claude-code:background', { kind: 'not-signed-in', since: '2026-11-24T14:02:00.000Z', command: 'claude', excerpt: 'x', starts: 1 });
  const base = { agent: 'claude-code', computer: ID, home, readViews: () => views({ [`builders:${ID}`]: 'background' }), fault: () => null, check: ok };
  assert.equal(builderRoute(base).signIn.open, false);
  assert.equal(builderRoute({ ...base, readViews: () => views({ [`builders:${ID}`]: 'desktop' }) }).signIn.open, true);
});

test("an agent that supports only some routes runs on the first it supports", () => {
  const got = read({ [`builders:${ID}`]: 'desktop' }, { routes: ['background'] });
  assert.deepEqual([got.route, got.from], ['background', 'profile']);
  assert.equal(read({ [`builders:${ID}`]: 'desktop' }, { routes: [] }).route, null);
});
