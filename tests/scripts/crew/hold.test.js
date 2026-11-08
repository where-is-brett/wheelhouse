// tests/scripts/crew/hold.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { stateDir } from '../../../scripts/lib/paths.js';
import { listEvents } from '../../../scripts/state/events.js';
import { buildViews } from '../../../scripts/state/views.js';
import { openTestRecord } from '../../helpers/record-fixture.js';
import { tempFolder } from '../../helpers/homes.js';
import { holdFile, takeHold, readHold, holdBySession, markOpened, releaseHold, helmHeld, cleanOrphans, ORPHAN_GRACE_MS } from '../../../scripts/crew/hold.js';

async function withHome(fn) {
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = path.join(tempFolder('wh-hold-'), 'home');
  try {
    await openTestRecord({ project: 'o__p' });
    return await fn('o__p');
  } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME;
    else process.env.WHEELHOUSE_HOME = before;
  }
}
let tick = 0;
const now = () => new Date(Date.UTC(2026, 10, 8, 1, 0, tick++));
const viewsOf = (project) => buildViews(listEvents(stateDir(project), { report: () => {} }), []);

test('hold: take writes the event and the file', async () => {
  await withHome(async (p) => {
    const hold = await takeHold(p, { work: 'login', sessionId: 's-1', now });
    assert.equal(helmHeld(p, 'login'), true);
    assert.deepEqual(readHold(p, 'login'), hold);
    assert.equal(hold.opened, false);
    assert.equal(hold.pid, null);
    assert.ok(viewsOf(p).helm.login.since);
    assert.equal(viewsOf(p).helm.login.fromStart, false);
  });
});

test('hold: one writer', async () => {
  await withHome(async (p) => {
    await takeHold(p, { work: 'login', sessionId: 's-1', now });
    await assert.rejects(() => takeHold(p, { work: 'login', sessionId: 's-2', now }));
    assert.equal(readHold(p, 'login').sessionId, 's-1');
  });
});

test('hold: a broken file still holds', async () => {
  await withHome(async (p) => {
    fs.mkdirSync(path.dirname(holdFile(p, 'login')), { recursive: true });
    fs.writeFileSync(holdFile(p, 'login'), '{');
    assert.equal(helmHeld(p, 'login'), true);
    assert.equal(readHold(p, 'login'), null);
    await assert.rejects(() => takeHold(p, { work: 'login', sessionId: 's', now }));
  });
});

test('hold: release ends it', async () => {
  await withHome(async (p) => {
    await takeHold(p, { work: 'login', sessionId: 's-1', now });
    await releaseHold(p, 'login', { why: 'handed back', now });
    assert.equal(helmHeld(p, 'login'), false);
    assert.equal(viewsOf(p).helm.login, undefined);
  });
});

test('hold: finds a hold by session id', async () => {
  await withHome(async (p) => {
    await takeHold(p, { work: 'login', sessionId: 's-1', now });
    await takeHold(p, { work: 'search', sessionId: 's-2', fromStart: true, now });
    fs.writeFileSync(path.join(path.dirname(holdFile(p, 'login')), 'broken.json'), '{');
    assert.equal(holdBySession(p, 's-2').work, 'search');
    assert.equal(holdBySession(p, 's-2').fromStart, true);
    assert.equal(holdBySession(p, 'nope'), null);
  });
});

test('hold: marks the terminal opened', async () => {
  await withHome(async (p) => {
    await takeHold(p, { work: 'login', sessionId: 's-1', now });
    markOpened(p, 'login', { pid: 42, startTime: 'Sun Nov  8 01:00:00 2026' });
    assert.deepEqual(
      (({ opened, pid, startTime }) => ({ opened, pid, startTime }))(readHold(p, 'login')),
      { opened: true, pid: 42, startTime: 'Sun Nov  8 01:00:00 2026' },
    );
  });
});

test('hold: removes an orphan', async () => {
  await withHome(async (p) => {
    await takeHold(p, { work: 'kept', sessionId: 's-1', now });
    fs.writeFileSync(holdFile(p, 'orphan'), JSON.stringify({ work: 'orphan' }));
    const old = new Date(Date.now() - ORPHAN_GRACE_MS - 1000);
    fs.utimesSync(holdFile(p, 'orphan'), old, old);
    assert.deepEqual(cleanOrphans(p, viewsOf(p)), ['orphan']);
    assert.equal(helmHeld(p, 'orphan'), false);
    assert.equal(helmHeld(p, 'kept'), true);
  });
});

test('hold: a work name that is not a slug is refused', async () => {
  await withHome(async (p) => {
    for (const work of ['../x', 'a/b', '', 'Up', 'a.b']) assert.throws(() => holdFile(p, work), undefined, work);
    assert.equal(helmHeld(p, '../x'), false);
  });
});

test('hold: a newly taken hold with no event yet is kept', async () => {
  await withHome(async (p) => {
    fs.mkdirSync(path.dirname(holdFile(p, 'fresh')), { recursive: true });
    fs.writeFileSync(holdFile(p, 'fresh'), JSON.stringify({ work: 'fresh' }));
    assert.deepEqual(cleanOrphans(p, viewsOf(p)), []);
    assert.equal(helmHeld(p, 'fresh'), true);
    const later = () => new Date(Date.now() + ORPHAN_GRACE_MS + 1000);
    assert.deepEqual(cleanOrphans(p, viewsOf(p), { now: later }), ['fresh']);
  });
});
