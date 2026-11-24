// tests/scripts/watcher/desktop-queue.test.js
// The wake file of the Desktop route (builders and settings design, section 7.2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { dropWakes, oldestWaiting, queueDir, queueWake, takeWakes } from '../../../scripts/watcher/desktop-queue.js';
import { watcherDir, writeWake } from '../../../scripts/watcher/waker.js';
import { withHome } from '../../helpers/homes.js';
import { P, T0, project } from '../../helpers/foreman.js';

const bundle = (work) => writeWake(P, work === undefined ? { to: 'foreman', events: [], digest: [], dropped: 0 } : { to: 'feature', work, events: [], digest: [], dropped: 0 }, { now: () => new Date(T0) });
const at = (n) => () => new Date(T0 + n * 1000);

test('a wake is written whole in its own folder, apart from the bundle folder, and read back', () => withHome(async () => {
  await project();
  const file = bundle('alpha');
  const made = queueWake(P, { kind: 'feature-wake', work: 'alpha', file, sessionId: '0f0e0d0c-aaaa-bbbb-cccc-111122223333', now: at(0) });
  assert.equal(path.dirname(made), queueDir(P));
  assert.notEqual(queueDir(P), path.join(watcherDir(P), 'wakes'));
  const [wake] = takeWakes(P);
  assert.deepEqual({ ...wake, path: undefined }, { kind: 'feature-wake', work: 'alpha', file, sessionId: '0f0e0d0c-aaaa-bbbb-cccc-111122223333', at: new Date(T0).toISOString(), path: undefined });
  assert.deepEqual(fs.readdirSync(queueDir(P)).filter((n) => n.endsWith('.tmp')), []);
}));

test('a queued wake for a piece with one waiting replaces it, and other pieces keep theirs', () => withHome(async () => {
  await project();
  queueWake(P, { kind: 'feature-wake', work: 'alpha', file: bundle('alpha'), now: at(0) });
  queueWake(P, { kind: 'feature-wake', work: 'beta', file: bundle('beta'), now: at(1) });
  queueWake(P, { kind: 'foreman', file: bundle(), now: at(2) });
  queueWake(P, { kind: 'feature-wake', work: 'alpha', file: bundle('alpha'), now: at(3) });
  const wakes = takeWakes(P);
  assert.deepEqual(wakes.map((w) => `${w.kind}:${w.work ?? ''}`), ['feature-wake:beta', 'foreman:', 'feature-wake:alpha']);
}));

test('a wake whose file is outside the bundle folder, or whose work is not a slug, is refused', () => withHome(async () => {
  await project();
  const file = bundle('alpha');
  assert.throws(() => queueWake(P, { kind: 'feature-wake', work: 'alpha', file: '/etc/passwd' }), /wakes folder/);
  assert.throws(() => queueWake(P, { kind: 'feature-wake', work: 'alpha', file: path.join(path.dirname(file), '..', 'outbox.json') }), /wakes folder/);
  assert.throws(() => queueWake(P, { kind: 'feature-wake', work: 'Alpha; rm', file }), /lower-case/);
  assert.throws(() => queueWake(P, { kind: 'feature-start', file }), /lower-case/);
  assert.throws(() => queueWake(P, { kind: 'foreman', work: 'alpha', file }), /names no piece/);
  assert.throws(() => queueWake(P, { kind: 'say-something', work: 'alpha', file }), /one of/);
  assert.throws(() => queueWake(P, { kind: 'feature-wake', work: 'alpha', file, sessionId: 'not a session; id' }), /session id/);
  assert.deepEqual(takeWakes(P), []);
}));

test('dropWakes removes only the named wakes in the queue, and oldestWaiting names the earliest time', () => withHome(async () => {
  await project();
  assert.equal(oldestWaiting(P), null);
  const a = queueWake(P, { kind: 'feature-wake', work: 'alpha', file: bundle('alpha'), now: at(5) });
  const b = queueWake(P, { kind: 'feature-wake', work: 'beta', file: bundle('beta'), now: at(9) });
  assert.equal(oldestWaiting(P), new Date(T0 + 5000).toISOString());
  dropWakes(P, ['/etc/passwd', path.join(queueDir(P), '..', 'outbox.json'), a]);
  assert.deepEqual(takeWakes(P).map((w) => w.path), [b]);
  // A file that is not a wake this module wrote is left alone and not returned.
  fs.writeFileSync(path.join(queueDir(P), 'note.txt'), 'x');
  fs.writeFileSync(path.join(queueDir(P), `wake-${'0'.repeat(13)}-${'a'.repeat(12)}.json`), '{"kind":"foreman"');
  assert.deepEqual(takeWakes(P).map((w) => w.path), [b]);
}));

test('a queue file is read only as a whole wake this module could have written: no link, no file outside the bundle folder, no bad session id', () => withHome(async () => {
  await project();
  const file = bundle('alpha');
  const good = queueWake(P, { kind: 'feature-wake', work: 'beta', file: bundle('beta'), now: at(1) });
  const put = (n, wake) => {
    const name = path.join(queueDir(P), `wake-${String(T0 + n).padStart(13, '0')}-${'b'.repeat(11)}${n}.json`);
    fs.writeFileSync(name, `${JSON.stringify({ at: new Date(T0).toISOString(), ...wake })}\n`);
    return name;
  };
  put(1, { kind: 'feature-wake', work: 'alpha', file: '/etc/passwd' });
  put(2, { kind: 'feature-wake', work: 'alpha', file: path.join(path.dirname(file), '..', 'outbox.json') });
  put(3, { kind: 'feature-wake', work: 'alpha', file, sessionId: 'not a session; id' });
  put(4, { kind: 'foreman', work: 'alpha', file });
  put(5, { kind: 'feature-start', file });
  // A link in the queue, to a whole wake elsewhere, is not followed.
  const elsewhere = path.join(watcherDir(P), 'planted.json');
  fs.writeFileSync(elsewhere, `${JSON.stringify({ kind: 'feature-wake', work: 'alpha', file, at: new Date(T0).toISOString() })}\n`);
  try {
    fs.symlinkSync(elsewhere, path.join(queueDir(P), `wake-${String(T0 + 9).padStart(13, '0')}-${'c'.repeat(12)}.json`));
  } catch { /* a system that makes no links here has none to follow */ }
  // The bundle a wake names must be a plain file: a link there is refused when queued.
  const linked = path.join(path.dirname(file), 'linked.json');
  let made = true;
  try {
    fs.symlinkSync(elsewhere, linked);
  } catch {
    made = false; // Windows without the right to make links
  }
  if (made) assert.throws(() => queueWake(P, { kind: 'feature-wake', work: 'alpha', file: linked }), /wakes folder/);
  assert.deepEqual(takeWakes(P).map((w) => w.path), [good]);
}));
