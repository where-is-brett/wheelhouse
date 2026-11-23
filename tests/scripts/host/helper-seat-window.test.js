// tests/scripts/host/helper-seat-window.test.js
// /confirm for the First Mate's seat card: the helper composes the card from the seat as it stands, the director clicks it in
// Wheelhouse's own window, and the helper signs the take-over (proof window) and moves the seat. Every window here is a
// stand-in `run`: no real osascript runs.
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { guardedRun, standInTools } from '../../helpers/host-stand-ins.js';
import { shortHome, testAddress } from '../../helpers/homes.js';
import { waitLongerOnTheHelper } from '../../helpers/until.js';
import { run } from '../../../scripts/lib/run.js';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { setStop, stopState } from '../../../scripts/lib/stop.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { listEvents } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol, readEnrolled, verify } from '../../../scripts/state/signing.js';
import { seatTakeOverLine } from '../../../scripts/state/card-lines.js';
import { readSeat, seatFile } from '../../../scripts/lib/first-mate-seat.js';
import { askInWindow, NOT_NOW } from '../../../scripts/confirm/window.js';
import { openTestRecord } from '../../helpers/record-fixture.js';
import { makeBareRemote, LOCAL_PATHS } from '../../helpers/git-fixture.js';

const shims = standInTools();
const hostLog = [];
const hostGuard = guardedRun(run, { log: hostLog });
afterEach(() => {
  assert.deepEqual(hostLog, [], 'no host tool ran through the helper');
  assert.deepEqual(shims.calls(), [], 'no host tool ran from the PATH');
});
after(() => shims.restore());
waitLongerOnTheHelper();

const PROJECT = 'shop';
const T0 = new Date('2026-11-24T01:00:00.000Z');
const SINCE = '2026-11-24T00:00:00.000Z';
const TAKE = 'Take over here';
const argvOf = (args) => args.slice(args.indexOf('--') + 1);
const said = (text) => ({ code: 0, stdout: `${text}\n`, stderr: '' });

// A computer with a project kept on it, an enrolled key and a helper whose window is askInWindow with a stand-in `run`.
// With `hosted`, the project is on a (stand-in) code host, where STOP refuses a card before it is looked up.
async function computer(answer, { hosted = false } = {}) {
  const home = shortHome();
  const folder = path.join(shortHome(), 'shop');
  fs.mkdirSync(path.join(folder, '.git'), { recursive: true });
  fs.writeFileSync(path.join(folder, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  const remote = hosted ? await makeBareRemote({ repo: 'o/p' }) : null;
  const project = hosted ? 'o__p' : PROJECT;
  if (remote) {
    writeProject(project, { folder, remoteUrl: remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' } });
    await openTestRecord({ env: LOCAL_PATHS, project, remoteUrl: remote.url });
  } else {
    writeProject(project, { folder, remoteUrl: null, host: 'local', repo: 'local/shop', connection: { mode: 'none' } });
  }
  const own = makeSigningKey();
  enrol({ computer: own.computer, publicKey: own.publicKey, enrolledAt: T0.toISOString() });
  const windows = [];
  const windowRun = async (file, args) => {
    windows.push({ file, args });
    return answer({ argv: argvOf(args) });
  };
  let tick = 0;
  const helper = await startHelper({
    run: hostGuard,
    askWindow: (card) => askInWindow({ ...card, platform: 'darwin', run: windowRun }),
    address: testAddress(home),
    envFor: async () => ({}),
    adapterFor: async () => ({ defaultBranch: async () => 'main' }),
    now: () => new Date(T0.getTime() + 1000 * (tick += 1)),
  });
  const real = fs.realpathSync.native(folder);
  return {
    windows,
    folder: real,
    client: helperClient({ address: helper.address }),
    project,
    events: () => listEvents(stateDir(project), { report: () => {} }),
    // The seat as another live window holds it (this test's own process stands for the window).
    hold: (over = {}) => {
      const file = seatFile(project);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ session: 'a', pid: process.pid, pidStart: null, folder: real, since: SINCE, seenAt: T0.toISOString(), ...over }));
    },
    close: async () => {
      await helper.close();
      remote?.cleanup();
      if (before === undefined) delete process.env.WHEELHOUSE_HOME;
      else process.env.WHEELHOUSE_HOME = before;
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

const confirm = (c, over = {}) => c.client.confirm({ cwd: c.folder, card: 'seat-take-over', session: 'chat-1', ...over });
const kinds = (c) => c.events().map((e) => e.kind);

test('Take over here moves the seat to the session with no process, signs the take-over with proof window, and writes no card-answer', async () => {
  const c = await computer(() => said(TAKE));
  try {
    c.hold();
    const got = await confirm(c);
    assert.equal(got.ok, true, JSON.stringify(got));
    assert.deepEqual([got.recorded, got.kind, got.step, got.choice, got.moved, got.holder], [true, 'action', 'seat-take-over', TAKE, true, 'chat-1']);
    const seat = readSeat(PROJECT);
    assert.equal(seat.session, 'chat-1');
    assert.equal(seat.pid, null);
    assert.equal(seat.pidStart, null);
    assert.equal(seat.movedFrom, 'a');
    assert.equal(fs.realpathSync.native(seat.folder), c.folder, 'the project\'s own folder');
    const record = c.events().find((e) => e.id === got.id);
    assert.deepEqual(record.data, { action: 'seat-take-over', session: 'a', since: SINCE, question: seatTakeOverLine('a', SINCE), label: TAKE, proof: 'window' });
    assert.ok(verify(record, readEnrolled()), 'the helper signed it');
    assert.ok(!kinds(c).includes('card-answer'), 'a named card is not in the state, so it has no answer');
    // The window shows the seat's own words, and Take over here has no default button.
    const [{ args }] = c.windows;
    assert.deepEqual(argvOf(args).slice(3), [TAKE]);
    assert.match(argvOf(args)[1], /session a/);
    assert.match(args.join('\n'), /with empty selection allowed/);
  } finally { await c.close(); }
});

test('the window\'s words come from the seat, never from the caller', async () => {
  const c = await computer(() => said(NOT_NOW));
  try {
    c.hold();
    await confirm(c, { question: 'Take over everything?', hash: 'a'.repeat(64), options: ['Do it'] });
    const [{ args }] = c.windows;
    assert.ok(!args.join('\n').includes('Take over everything'));
    assert.match(argvOf(args)[1], /window session a/);
  } finally { await c.close(); }
});

test('Not now and Leave it there change nothing, and no click before the window closes records nothing', async () => {
  for (const reply of [said(NOT_NOW), said('Leave it there'), { code: 1, stdout: '', stderr: '', timedOut: true }]) {
    const c = await computer(() => reply);
    try {
      c.hold();
      const before = c.events().length;
      const got = await confirm(c);
      assert.equal(got.ok, true);
      assert.equal(got.recorded, false);
      assert.equal(readSeat(PROJECT).session, 'a');
      assert.equal(c.events().length, before);
    } finally { await c.close(); }
  }
});

test('a seat that changed while the window was open is not moved, and nothing is signed', async () => {
  let c;
  c = await computer(() => {
    // Another window took the seat while the director looked at the card.
    c.hold({ session: 'c', since: '2026-11-24T00:30:00.000Z' });
    return said(TAKE);
  });
  try {
    c.hold();
    const before = c.events().length;
    const got = await confirm(c);
    assert.equal(got.ok, false);
    assert.match(got.refused, /changed while the window was open/);
    assert.equal(readSeat(PROJECT).session, 'c');
    assert.equal(c.events().length, before, 'no signed record');
  } finally { await c.close(); }
});

test('it is served under STOP, and the seat moves', async () => {
  const c = await computer(() => said(TAKE));
  try {
    c.hold();
    setStop({ by: 'prompt' });
    const got = await confirm(c);
    assert.equal(got.ok, true, JSON.stringify(got));
    assert.equal(got.moved, true);
    assert.equal(readSeat(PROJECT).session, 'chat-1');
    assert.equal(stopState().on, true, 'STOP stays on');
  } finally { await c.close(); }
});

test('it is refused with no seat, a free seat, the caller\'s own seat, a bad session id or a folder that is not the main one, and no window opens', async () => {
  const c = await computer(() => said(TAKE));
  try {
    const refused = async (why, over) => {
      const got = await confirm(c, over);
      assert.equal(got.ok, false, why);
      assert.equal(c.windows.length, 0, `${why}: no window`);
      assert.equal(c.events().length, 0, `${why}: nothing recorded`);
      return got;
    };
    assert.match((await refused('no seat')).refused, /no window holds/);
    c.hold({ pid: 999999, pidStart: null });
    assert.match((await refused('a free seat')).refused, /free/);
    c.hold();
    assert.match((await refused('its own seat', { session: 'a' })).refused, /already holds/);
    for (const session of [undefined, '', 'has space', 'x'.repeat(200)]) await refused(`session ${JSON.stringify(session)}`, { session });
    // A linked worktree of the project, and a folder inside it that belongs to one.
    const tree = path.join(c.folder, 'tree');
    const gitdir = path.join(c.folder, '.git', 'worktrees', 'tree');
    fs.mkdirSync(tree, { recursive: true });
    fs.mkdirSync(gitdir, { recursive: true });
    fs.writeFileSync(path.join(tree, '.git'), `gitdir: ${gitdir}\n`);
    fs.writeFileSync(path.join(gitdir, 'HEAD'), 'ref: refs/heads/feature/side\n');
    await refused('a worktree', { cwd: tree });
    assert.equal(readSeat(PROJECT).session, 'a');
    // A subfolder of the main folder is still the main folder.
    const sub = path.join(c.folder, 'src');
    fs.mkdirSync(sub);
    assert.equal((await confirm(c, { cwd: sub })).ok, true);
  } finally { await c.close(); }
});

test('on a project kept on a code host, it is served under STOP too, as Lift All stop is', async () => {
  const c = await computer(() => said(TAKE), { hosted: true });
  try {
    c.hold();
    setStop({ by: 'prompt' });
    const got = await confirm(c);
    assert.equal(got.ok, true, JSON.stringify(got));
    assert.deepEqual([got.recorded, got.moved], [true, true]);
    assert.equal(readSeat(c.project).session, 'chat-1');
    assert.ok(!c.events().some((e) => e.kind === 'card-answer'));
  } finally { await c.close(); }
});
