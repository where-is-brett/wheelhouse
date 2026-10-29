// tests/scripts/mod/desk-parity.test.js
// The mod's bridge gives the same pane, the same digest and the same courier wakes through the desk
// as it gave reading the files itself, for one fixture record over a run of front-desk ticks: the
// session opens, a card is added, All stop is set, and the card closes. Each run is made three
// ways: with a helper client that has no desk (as the bridge's tests give it), with the helper up
// (its desk is the core over the files, each body crossing as JSON, as over the socket), and with
// the helper down (the desk's local fallback). The fixtures under tests/fixtures/desk-parity/mod/
// were taken from the bridge before it read through the desk; DESK_PARITY_WRITE=1 writes them again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from '../../../scripts/mod/bridge.js';
import { setStop, liftStop } from '../../../scripts/lib/stop.js';
import { TICK_MS } from '../../../scripts/lib/mod-numbers.js';
import { courierCursor } from '../../../scripts/mod/courier.js';
import { deskCore } from '../../../scripts/desk/core.js';
import { fileSource } from '../../../scripts/desk/file-source.js';
import { as, shortHome } from '../../helpers/homes.js';
import { P, NOW, put, viewsDir, writeRecord, upClient } from '../desk/fixture.js';

// The pane's clock times are the computer's own: the fixture's are UTC.
process.env.TZ = 'UTC';

const FIXTURES = fileURLToPath(new URL('../../fixtures/desk-parity/mod/', import.meta.url));
const at = (ticks) => new Date(Date.parse(NOW) + ticks * TICK_MS);

// A card no visit has handed out yet, so it wakes the front desk.
const ADDED = { id: 'c2', at: '2026-10-29T11:00:00.000Z', data: { question: 'Shall the footer link to the help page?', options: ['Yes', 'Not now'] }, asked: null };

// A helper client that is up and takes every record, with no desk of its own.
function plainClient() {
  return {
    ...upClient,
    state: { record: async () => ({ ok: true }), write: async () => ({ ok: true }) },
    profile: { record: async () => ({ ok: true }) },
  };
}

// A helper whose desk is the core over the files, as the helper's is; `clock` is the bridge's.
function upHelper(repo, clock) {
  const core = deskCore({ source: fileSource(P, { cwd: repo, client: upClient, now: () => clock.now }), recorder: {}, now: () => clock.now });
  const wire = (body) => JSON.parse(JSON.stringify(body));
  return {
    ...plainClient(),
    desk: {
      read: async (body) => { const { view, args } = wire(body); return wire(await core.read(view, args)); },
      act: async (body) => { const { command, args, evidence } = wire(body); return wire(await core.act(command, args, evidence)); },
      watch: async (body) => wire(await core.watch(wire(body).cursor)),
    },
  };
}

// A helper client whose helper isn't running, in the helper client's own words.
const downHelper = () => ({
  ...plainClient(),
  desk: Object.fromEntries(['read', 'act', 'watch'].map((op) => [op, async () => ({ ok: false, refused: 'the host helper could not be reached: is it running?' })])),
});

// The run of ticks, then the digest, in a home of its own: what each tick answered, and the digest.
async function runFor(helperOf) {
  const home = shortHome();
  return as(home, async () => {
    const repo = writeRecord(home);
    const clock = { now: at(0) };
    const client = helperOf(repo, clock);
    const deps = { now: () => clock.now, env: {}, client, timeZone: 'UTC', watchTick: async () => ({ watcher: 'running', submit: [] }) };
    const tick = async (ticks, given = () => {}) => {
      clock.now = at(ticks);
      given();
      return handle({ cmd: 'tick', session: 'sess-1', cwd: repo, idle: true, surface: 'desktop' }, deps);
    };
    const waiting = path.join(viewsDir(), 'waiting.json');
    const ticks = {
      opened: await tick(0),
      added: await tick(1, () => put(waiting, [...JSON.parse(fs.readFileSync(waiting, 'utf8')), ADDED])),
      stopped: await tick(2, () => setStop({ by: 'prompt', now: () => clock.now })),
      closed: await tick(3, () => { liftStop(); put(waiting, JSON.parse(fs.readFileSync(waiting, 'utf8')).filter((c) => c.id !== ADDED.id)); }),
    };
    clock.now = at(4);
    const digest = await handle({ cmd: 'digest', origin: 'composer', cwd: repo }, deps);
    return { ticks, digest, cursor: courierCursor(P) };
  });
}

const fixtureFile = (name) => path.join(FIXTURES, `${name}.json`);

test('the pane, the courier\'s wakes and the digest are the same with no desk, with the helper up and with it down', async () => {
  const plain = await runFor(() => plainClient());
  if (process.env.DESK_PARITY_WRITE === '1') {
    fs.mkdirSync(FIXTURES, { recursive: true });
    fs.writeFileSync(fixtureFile('ticks'), `${JSON.stringify(plain.ticks, null, 2)}\n`);
    fs.writeFileSync(fixtureFile('digest'), `${JSON.stringify(plain.digest, null, 2)}\n`);
  }
  const ticks = JSON.parse(fs.readFileSync(fixtureFile('ticks'), 'utf8'));
  const digest = JSON.parse(fs.readFileSync(fixtureFile('digest'), 'utf8'));
  // The run wakes for the added card and for All stop, and the card's close shows.
  assert.deepEqual(ticks.added.submit?.length, 1, 'the added card wakes the front desk');
  assert.deepEqual(ticks.stopped.submit?.length, 1, 'All stop wakes the front desk');
  assert.equal(ticks.closed.pane.cards.some((c) => c.id === ADDED.id), false, 'the closed card is gone');
  assert.equal(digest.ok, true);
  assert.deepEqual(plain.ticks, ticks, 'no desk');
  assert.deepEqual(plain.digest, digest, 'no desk: digest');
  // The courier keeps the desk's watch cursor beside what it sent.
  assert.equal(typeof plain.cursor, 'string', 'the courier keeps a cursor');
  const up = await runFor(upHelper);
  assert.equal(typeof up.cursor, 'string', 'the courier keeps the helper\'s cursor');
  assert.deepEqual(up.ticks, ticks, 'helper up');
  assert.deepEqual(up.digest, digest, 'helper up: digest');
  const down = await runFor(() => downHelper());
  assert.deepEqual(down.ticks, ticks, 'helper down');
  assert.deepEqual(down.digest, digest, 'helper down: digest');
});
