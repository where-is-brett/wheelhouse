// tests/scripts/host/helper-seat-click.test.js
// The First Mate's seat card, clicked in the chat of an agent whose hooks only read: the helper composes the card from the seat as it
// stands, a hook posts that it was shown (/cards/hook-shown) and that the director clicked it (/cards/hook-click), and the helper signs
// the take-over (proof hook-click) and moves the seat. No window opens.
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
import { takeTurn } from '../../../scripts/lib/session-files.js';
import { readSeat, seatFile } from '../../../scripts/lib/first-mate-seat.js';
import { seatCard } from '../../../scripts/lib/seat-card.js';
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
const LEAVE = 'Leave it there';

// A computer with a project kept on it, an enrolled key and a helper that takes the hook routes. `advance` moves the helper's clock.
// With `hosted`, the project is on a (stand-in) code host, where STOP refuses an ordinary card before it is looked up.
async function computer({ hosted = false, hookClicks = true } = {}) {
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
  // The chat that asks is one the helper has seen take a turn.
  takeTurn('chat-1', T0.getTime());
  let clock = T0.getTime();
  const helper = await startHelper({
    run: hostGuard,
    address: testAddress(home),
    envFor: async () => ({}),
    adapterFor: async () => ({ defaultBranch: async () => 'main' }),
    now: () => new Date((clock += 1000)),
    hookClicks,
  });
  const real = fs.realpathSync.native(folder);
  const client = helperClient({ address: helper.address });
  return {
    advance: (ms) => { clock += ms; },
    live: (session, at = T0.getTime()) => takeTurn(session, at),
    folder: real,
    client,
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

// The seat card as the session start gives it, composed from the seat file a few seconds after it was last seen.
const card = (project = PROJECT) => seatCard({ seat: readSeat(project), now: () => new Date(T0.getTime() + 3000) }).card;
const place = (c, over = {}) => ({ cwd: c.folder, session: 'chat-1', message: card(c.project).question, options: card(c.project).options, ...over });
const shown = (c, over) => c.client.cards.hookShown(place(c, over));
const click = (c, label = TAKE, over) => c.client.cards.hookClick({ ...place(c, over), label });
const kinds = (c) => c.events().map((e) => e.kind);

test('Take over here moves the seat to the session with no process, signs the take-over with proof hook-click, and writes no card-answer', async () => {
  const c = await computer();
  try {
    c.hold();
    assert.equal((await shown(c)).ok, true);
    const got = await click(c);
    assert.equal(got.ok, true, JSON.stringify(got));
    assert.deepEqual([got.recorded, got.card, got.label, got.moved, got.holder], [true, 'seat-take-over', TAKE, true, 'chat-1']);
    const seat = readSeat(PROJECT);
    assert.equal(seat.session, 'chat-1');
    assert.equal(seat.pid, null);
    assert.equal(seat.pidStart, null);
    assert.equal(seat.movedFrom, 'a');
    assert.equal(fs.realpathSync.native(seat.folder), c.folder, 'the project\'s own folder');
    const record = c.events().find((e) => e.id === got.id);
    assert.deepEqual(record.data, { action: 'seat-take-over', session: 'a', since: SINCE, question: seatTakeOverLine('a', SINCE), label: TAKE, proof: 'hook-click' });
    assert.ok(verify(record, readEnrolled()), 'the helper signed it');
    assert.ok(!kinds(c).includes('card-answer'), 'a composed card is not in the state, so it has no answer');
  } finally { await c.close(); }
});

test('a click that comes minutes later still matches the card as it was shown, though its words now say another time', async () => {
  const c = await computer();
  try {
    c.hold();
    assert.equal((await shown(c)).ok, true);
    c.advance(9 * 60 * 1000);
    assert.notEqual(seatCard({ seat: readSeat(PROJECT), now: () => new Date(T0.getTime() + 9 * 60 * 1000) }).card.question, card().question, 'the words moved on');
    const got = await click(c);
    assert.equal(got.ok, true, JSON.stringify(got));
    assert.equal(got.moved, true);
  } finally { await c.close(); }
});

test('Leave it there changes nothing and records nothing', async () => {
  const c = await computer();
  try {
    c.hold();
    await shown(c);
    const before = c.events().length;
    const got = await click(c, LEAVE);
    assert.equal(got.ok, true);
    assert.equal(got.recorded, false);
    assert.equal(readSeat(PROJECT).session, 'a');
    assert.equal(c.events().length, before);
  } finally { await c.close(); }
});

test('a card never shown, or whose click was taken already, moves nothing', async () => {
  const c = await computer();
  try {
    c.hold();
    const unshown = await click(c);
    assert.equal(unshown.ok, false);
    assert.match(unshown.refused, /was not shown to this session/);
    await shown(c);
    assert.equal((await click(c)).ok, true);
    c.hold();
    const again = await click(c);
    assert.equal(again.ok, false);
    assert.match(again.refused, /taken already/);
    assert.equal(readSeat(PROJECT).session, 'a');
  } finally { await c.close(); }
});

test('a seat that changed hands after the card was shown is not moved, and nothing is signed', async () => {
  const c = await computer();
  try {
    c.hold();
    await shown(c);
    const message = place(c).message;
    // Another window took the seat while the director looked at the card.
    c.hold({ session: 'c', since: '2026-11-24T00:30:00.000Z' });
    const before = c.events().length;
    const got = await click(c, TAKE, { message });
    assert.equal(got.ok, false);
    assert.match(got.refused, /no card waiting reads like that|not the one shown/);
    assert.equal(readSeat(PROJECT).session, 'c');
    assert.equal(c.events().length, before, 'no signed record');
  } finally { await c.close(); }
});

test('it is served under STOP, and the seat moves', async () => {
  const c = await computer();
  try {
    c.hold();
    await shown(c);
    setStop({ by: 'prompt' });
    const got = await click(c);
    assert.equal(got.ok, true, JSON.stringify(got));
    assert.equal(got.moved, true);
    assert.equal(readSeat(PROJECT).session, 'chat-1');
    assert.equal(stopState().on, true, 'STOP stays on');
  } finally { await c.close(); }
});

test('on a project kept on a code host, it is served under STOP too', async () => {
  const c = await computer({ hosted: true });
  try {
    c.hold();
    await shown(c);
    setStop({ by: 'prompt' });
    const got = await click(c);
    assert.equal(got.ok, true, JSON.stringify(got));
    assert.deepEqual([got.recorded, got.moved], [true, true]);
    assert.equal(readSeat(c.project).session, 'chat-1');
    assert.ok(!c.events().some((e) => e.kind === 'card-answer'));
  } finally { await c.close(); }
});

test('it is refused with no seat, a free seat, the caller\'s own seat, a bad session id or a folder that is not the main one', async () => {
  const c = await computer();
  try {
    const refused = async (why, over) => {
      c.hold();
      const asked = card();
      const got = await c.client.cards.hookShown({ cwd: c.folder, session: 'chat-1', message: asked.question, options: asked.options, ...over });
      assert.equal(got.ok, false, why);
      assert.equal(c.events().length, 0, `${why}: nothing recorded`);
    };
    // No seat: nothing composes a card at all.
    c.hold();
    const asked = card();
    fs.rmSync(seatFile(PROJECT));
    const none = await c.client.cards.hookShown({ cwd: c.folder, session: 'chat-1', message: asked.question, options: asked.options });
    assert.equal(none.ok, false);
    c.hold({ pid: 999999, pidStart: null });
    assert.equal((await c.client.cards.hookShown({ cwd: c.folder, session: 'chat-1', message: asked.question, options: asked.options })).ok, false, 'a free seat');
    await refused('its own seat', { session: 'a' });
    for (const session of ['has space', 'x'.repeat(200)]) await refused(`session ${JSON.stringify(session)}`, { session });
    // A linked worktree of the project.
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
    c.hold();
    assert.equal((await shown(c, { cwd: sub })).ok, true);
  } finally { await c.close(); }
});

test('it is refused for a session with no live chat behind it: no turn seen, or none for two hours', async () => {
  const c = await computer();
  try {
    c.hold();
    assert.equal((await shown(c, { session: 'ghost-session' })).ok, false);
    c.live('old-session', T0.getTime() - 3 * 3600 * 1000);
    assert.equal((await shown(c, { session: 'old-session' })).ok, false);
    assert.equal(c.events().length, 0, 'nothing recorded');
    assert.equal(readSeat(PROJECT).session, 'a');
  } finally { await c.close(); }
});

test('until an agent\'s clicks are recorded on this computer, the hook routes take nothing, so no click moves the seat', async () => {
  const c = await computer({ hookClicks: false });
  try {
    c.hold();
    assert.equal((await shown(c)).ok, false);
    assert.equal((await click(c)).ok, false);
    assert.equal(readSeat(PROJECT).session, 'a');
  } finally { await c.close(); }
});
