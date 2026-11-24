// tests/scripts/watcher/waker-launch.test.js
// The waker starts a Claude Code session through the launch command saved for this computer: a value that fails a check is
// named and starts nothing, and no value leaves the start as it was. Every session start is a stand-in.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeWaker, writeWake } from '../../../scripts/watcher/waker.js';
import { readConfig } from '../../../scripts/gate/guardrails.js';
import { withHome, tempFolder } from '../../helpers/homes.js';
import { standInTools } from '../../helpers/host-stand-ins.js';
import { P, T0, config as projectConfig, project } from '../../helpers/foreman.js';
import { storedLaunch } from '../../../scripts/lib/launch-stored.js';

const hostStandIns = standInTools();
after(() => hostStandIns.restore());

const foremanWake = () => writeWake(P, { to: 'foreman', events: [{ type: 'incident', id: 'e1', detail: {} }], digest: [], dropped: 0 }, { now: () => new Date(T0) });

function setUp({ words, path: binPath = '/bin' }) {
  const calls = [];
  const seen = [];
  const call = () => ({ file: 'agent', args: [], input: '', verbatim: false, env: {} });
  const sessions = {
    takesLaunch: true,
    checkForeman: () => {}, checkFeature: () => {},
    foremanCall: (options) => { seen.push(options.claude); return call(); },
    featureStartCall: call, featureResumeCall: call, finalAnswer: () => null,
  };
  const w = makeWaker({
    shape: 1, project: P, config: readConfig(JSON.stringify(projectConfig({}))), run: (file, args, options) => { calls.push({ file, args, ...options }); return { pid: 100 }; },
    alive: () => true, startTimeOf: async () => null, now: () => new Date(T0), bootedAt: () => 0,
    baseEnv: { PATH: binPath }, print: () => {}, sessions, launchWords: () => words,
  });
  return { w, calls, seen };
}

test('a stored launch command that fails a check is named and no session starts (review focus 1)', () => withHome(async () => {
  await project();
  const { w, calls, seen } = setUp({ words: ['wrap;rm', 'claude'] });
  await w.wakeForeman(foremanWake());
  assert.equal(calls.length, 0, 'no session was started');
  assert.equal(seen.length, 0, 'no call was built');
  assert.equal(w.waiting().length, 1, 'the wake is kept to go again');
  assert.match(w.waiting()[0].lastError, /launch command can't be used/);
}));

test('a launch command that is not on this computer is named and starts nothing', () => withHome(async () => {
  await project();
  const { w, calls } = setUp({ words: ['nowrap', 'claude'] });
  await w.wakeForeman(foremanWake());
  assert.equal(calls.length, 0);
  assert.match(w.waiting()[0].lastError, /isn't on this computer's PATH/);
}));

test('a working launch command is passed to the adapter\'s call', () => withHome(async () => {
  await project();
  const dir = tempFolder('wh-wake-wrapper-');
  const file = path.join(dir, 'wrap');
  fs.writeFileSync(file, `#!${process.execPath}\n`);
  fs.chmodSync(file, 0o755);
  const launched = setUp({ words: ['wrap', 'claude'], path: `${dir}:/bin` });
  await launched.w.wakeForeman(foremanWake());
  assert.equal(launched.calls.length, 1);
  assert.equal(launched.seen[0].file, file);
  assert.deepEqual(launched.seen[0].args, ['claude']);
}));

test('a launch command found only inside the project\'s folder is not used, as an agent can write there', () => withHome(async () => {
  const checkout = await project();
  const dir = path.join(checkout, 'bin');
  fs.mkdirSync(dir);
  const file = path.join(dir, 'wrap');
  fs.writeFileSync(file, `#!${process.execPath}\n`);
  fs.chmodSync(file, 0o755);
  const inside = setUp({ words: ['wrap', 'claude'], path: `${dir}:/bin` });
  await inside.w.wakeForeman(foremanWake());
  assert.equal(inside.calls.length, 0);
  assert.match(inside.w.waiting()[0].lastError, /isn't on this computer's PATH/);
}));

test('with no launch command saved, the start is as it was', () => withHome(async () => {
  await project();
  const plain = setUp({ words: null });
  await plain.w.wakeForeman(foremanWake());
  assert.equal(plain.calls.length, 1);
  assert.equal(plain.seen[0], null);
}));

test('the saved words are read from the settings\' views, and a fault in them is named, never read as none (review focus 2)', () => {
  const views = (value) => ({ settings: { 'builderLaunch:0a1b2c3d': { key: 'builderLaunch:0a1b2c3d', value } } });
  const ok = () => ({ ok: true });
  assert.deepEqual(storedLaunch({ id: '0a1b2c3d', readViews: () => views(['wrap', 'claude']), fault: () => null, check: ok }), ['wrap', 'claude']);
  assert.equal(storedLaunch({ id: '0a1b2c3d', readViews: () => views(null), fault: () => null, check: ok }), null);
  assert.equal(storedLaunch({ id: '0a1b2c3d', readViews: () => ({ settings: {} }), fault: () => null, check: ok }), null);
  assert.equal(storedLaunch({ id: '0a1b2c3d', readViews: () => null, fault: () => null, check: ok }), null);
  assert.equal(storedLaunch({ id: 'ffffffff', readViews: () => views(['wrap']), fault: () => null, check: ok }), null, 'another computer\'s value is not this one\'s');
  assert.throws(() => storedLaunch({ id: '0a1b2c3d', readViews: () => null, fault: () => ({ file: '/h/settings.json', line: 3, column: 9, hint: 'A comma is missing.' }) }), /launch command is unknown.*line 3, column 9/);
  assert.throws(() => storedLaunch({ id: '0a1b2c3d', readViews: () => views(['wrap;rm']), fault: () => null }), /can't be used/);
  assert.throws(() => storedLaunch({ id: '0a1b2c3d', readViews: () => views('wrap claude'), fault: () => null }), /can't be used/);
});
