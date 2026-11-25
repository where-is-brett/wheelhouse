// tests/scripts/foreman/check-in.test.js
// The foreman's check-in (builders and settings design, sections 7.1 and 7.2): one foreman per project.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkIn, checkInAge, checkInFile, heartbeat, FOREMAN_AWAY_MS, FOREMAN_REFUSE_MS, FOREMAN_SETUP_MS, endCheckIn } from '../../../scripts/foreman/check-in.js';
import { withHome } from '../../helpers/homes.js';
import { P, T0, project } from '../../helpers/foreman.js';

const at = (s) => () => new Date(T0 + s * 1000);
const A = 'aaaaaaaa-1111-2222-3333-444444444444';
const B = 'bbbbbbbb-1111-2222-3333-444444444444';

test('the pinned ages are the design\'s', () => {
  assert.equal(FOREMAN_SETUP_MS, 2 * 60 * 1000);
  assert.equal(FOREMAN_REFUSE_MS, 3 * 60 * 1000);
  assert.equal(FOREMAN_AWAY_MS, 3 * 60 * 1000);
});

test('a second foreman check-in for the project is refused while the first is fresh (review focus 4)', () => withHome(async () => {
  await project();
  assert.deepEqual(checkIn(P, { sessionId: A, now: at(0) }), { ok: true });
  const second = checkIn(P, { sessionId: B, now: at(179) });
  assert.equal(second.ok, false);
  assert.equal(second.running.sessionId, A);
  assert.equal(checkInAge(P, { now: at(179) }), 179000);
}));

test('the same session checks in again, and a first check-in older than 3 minutes gives way', () => withHome(async () => {
  await project();
  checkIn(P, { sessionId: A, now: at(0) });
  assert.deepEqual(checkIn(P, { sessionId: A, now: at(60) }), { ok: true });
  assert.deepEqual(checkIn(P, { sessionId: B, now: at(60 + 181) }), { ok: true });
  assert.equal(JSON.parse(fs.readFileSync(checkInFile(P), 'utf8')).sessionId, B);
}));

test('a heartbeat from a session that does not hold the check-in changes nothing', () => withHome(async () => {
  await project();
  checkIn(P, { sessionId: A, now: at(0) });
  assert.equal(heartbeat(P, { sessionId: B, now: at(30) }).ok, false);
  assert.equal(heartbeat(P, { sessionId: A, now: at(30) }).ok, true);
  assert.equal(checkInAge(P, { now: at(30) }), 0);
}));

test('no check-in, an unreadable one and one from a session id that is not one are all age null', () => withHome(async () => {
  await project();
  assert.equal(checkInAge(P, { now: at(0) }), null);
  fs.mkdirSync(checkInFile(P).replace(/[^/\\]+$/, ''), { recursive: true });
  fs.writeFileSync(checkInFile(P), '{nope');
  assert.equal(checkInAge(P, { now: at(0) }), null);
  fs.writeFileSync(checkInFile(P), JSON.stringify({ sessionId: 'a b; rm', at: new Date(T0).toISOString() }));
  assert.equal(checkInAge(P, { now: at(0) }), null);
  assert.equal(checkIn(P, { sessionId: 'not a session id' , now: at(0) }).ok, false);
}));

test('ending a check-in removes it only for the session that holds it', () => withHome(async () => {
  await project();
  checkIn(P, { sessionId: A, now: at(0) });
  endCheckIn(P, { sessionId: B });
  assert.notEqual(checkInAge(P, { now: at(1) }), null);
  endCheckIn(P, { sessionId: A });
  assert.equal(checkInAge(P, { now: at(1) }), null);
}));
