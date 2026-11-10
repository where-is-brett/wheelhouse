// tests/scripts/watcher/reliability.test.js
// The engine's reliability bar (design section 10): each lost, stalled or crash-resumed piece is recorded, and more than three
// in a rolling 30 days, across projects, raises one notice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  BAR, checkReliability, claimFolder, noticeFile, recordClaimFolder, takeClaim, engineTroubleCard, overBar, readIncidents, recordIncident, reliabilityFile,
} from '../../../scripts/watcher/reliability.js';
import { wheelhouseHome } from '../../../scripts/lib/paths.js';
import { cardProblems } from '../../../scripts/hooks/card-check.js';
import { withHome } from '../../helpers/homes.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-08T05:00:00.000Z');
const ago = (days) => new Date(NOW.getTime() - days * DAY).toISOString();
const line = (days, over = {}) => ({ kind: 'resumed', project: 'harbour__demo', work: 'w-tide-1', at: ago(days), ...over });

// A claim as a watcher at work holds it: a folder with its owner inside.
function held(folder) {
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'owner'), 'other\n');
}

function clientOf(written = []) {
  return { state: { write: async (a) => { written.push(a); return { ok: true }; } } };
}

test('each lost, stalled or resumed piece is recorded once', () => withHome(async () => {
  const a = { kind: 'lost', project: 'harbour__demo', work: 'w-tide-1', at: ago(0) };
  recordIncident(a);
  recordIncident(a);
  recordIncident({ ...a, kind: 'stalled' });
  recordIncident({ ...a, kind: 'resumed', project: 'harbour__other' });
  recordIncident({ ...a, kind: 'resumed', project: 'harbour__other' });
  const lines = readIncidents();
  assert.deepEqual(lines.map((l) => l.kind).sort(), ['lost', 'resumed', 'stalled']);
  assert.ok(fs.existsSync(reliabilityFile()));
  assert.equal(path.dirname(reliabilityFile()), wheelhouseHome());
  assert.equal(readIncidents().length, 3);
}));

test('an incident of another kind or without a work is not recorded', () => withHome(async () => {
  recordIncident({ kind: 'happy', project: 'harbour__demo', work: 'w-tide-1', at: ago(0) });
  recordIncident({ kind: 'lost', project: 'harbour__demo', at: ago(0) });
  assert.deepEqual(readIncidents(), []);
}));

test('three in 30 days are not over the bar; four are', () => {
  assert.equal(BAR, 3);
  assert.equal(overBar([line(1), line(2), line(3)], NOW), false);
  assert.equal(overBar([line(1), line(2), line(3), line(4)], NOW), true);
});

test('incidents older than 30 days don\'t count', () => {
  assert.equal(overBar([line(1), line(2), line(3), line(31), line(45)], NOW), false);
  assert.equal(overBar([line(1), line(2), line(3), line(29.5)], NOW), true);
});

test('a fourth incident in 30 days raises one notice', () => withHome(async () => {
  const written = [];
  const client = clientOf(written);
  for (let i = 1; i <= 3; i += 1) recordIncident(line(i, { work: `w-tide-${i}` }));
  assert.equal((await checkReliability({ project: 'harbour__demo', client, now: () => NOW })).raised, false);
  recordIncident(line(4, { work: 'w-tide-4' }));
  assert.equal((await checkReliability({ project: 'harbour__demo', client, now: () => NOW })).raised, true);
  assert.equal(written.length, 1);
  assert.equal(written[0].kind, 'card');
  assert.match(written[0].data.question, /^Engine trouble: look at Archon early\?/);
}));

test('a fifth in the same 30 days raises none', () => withHome(async () => {
  const written = [];
  const client = clientOf(written);
  for (let i = 1; i <= 4; i += 1) recordIncident(line(i, { work: `w-tide-${i}` }));
  await checkReliability({ project: 'harbour__demo', client, now: () => NOW });
  recordIncident(line(0.5, { work: 'w-tide-5' }));
  assert.equal((await checkReliability({ project: 'harbour__other', client, now: () => NOW })).raised, false);
  assert.equal(written.length, 1);
}));

test('another notice is raised once 30 days have passed and the bar is still crossed', () => withHome(async () => {
  const written = [];
  const client = clientOf(written);
  for (let i = 1; i <= 4; i += 1) recordIncident(line(i, { work: `w-tide-${i}` }));
  await checkReliability({ project: 'harbour__demo', client, now: () => NOW });
  const later = new Date(NOW.getTime() + 31 * DAY);
  for (let i = 1; i <= 4; i += 1) recordIncident({ ...line(0, { work: `w-bay-${i}` }), at: new Date(later.getTime() - i * DAY).toISOString() });
  assert.equal((await checkReliability({ project: 'harbour__demo', client, now: () => later })).raised, true);
  assert.equal(written.length, 2);
}));

test('a notice the helper refuses is not marked as sent, so it is raised again', () => withHome(async () => {
  for (let i = 1; i <= 4; i += 1) recordIncident(line(i, { work: `w-tide-${i}` }));
  const refusing = { state: { write: async () => ({ ok: false, refused: 'no' }) } };
  assert.equal((await checkReliability({ project: 'harbour__demo', client: refusing, now: () => NOW, log: () => {} })).raised, false);
  const written = [];
  assert.equal((await checkReliability({ project: 'harbour__demo', client: clientOf(written), now: () => NOW })).raised, true);
}));

test('the notice is a decision in the shape of section 6.2 and names no project', () => {
  const card = engineTroubleCard(4);
  const { parts } = card;
  assert.match(parts.ask, /^Engine trouble: look at Archon early\?$/);
  assert.ok(parts.holds && parts.why && parts.because && parts.meanwhile);
  assert.ok(parts.options.length >= 2 && parts.options.length <= 4);
  for (const o of parts.options) assert.ok(o.says && o.cost && o.undo, `${o.label} says what it costs and whether it can be undone`);
  assert.equal(parts.options.filter((o) => o.recommended).length, 1);
  assert.equal(card.recommend, parts.options.find((o) => o.recommended).label);
  assert.doesNotMatch(JSON.stringify(card), /harbour/);
  assert.match(card.question, /4/);
});

test('the notice passes the card check the picker applies', () => {
  assert.deepEqual(cardProblems(engineTroubleCard(4).question), []);
});

test('incidents more than 30 days older than the newest are dropped as one is added', () => withHome(async () => {
  recordIncident(line(60, { work: 'w-tide-1' }));
  recordIncident(line(45, { work: 'w-tide-2' }));
  recordIncident(line(1, { work: 'w-tide-3' }));
  assert.deepEqual(readIncidents().map((l) => l.work), ['w-tide-3']);
  assert.equal(fs.readdirSync(wheelhouseHome()).filter((n) => n.endsWith('.tmp')).length, 0);
  recordIncident(line(1, { work: 'w-tide-3' }));
  assert.equal(readIncidents().length, 1, 'still recorded once');
}));

test('two watchers checking at once send the notice once', () => withHome(async () => {
  const written = [];
  const client = { state: { write: async (a) => { await new Promise((r) => setImmediate(r)); written.push(a); return { ok: true }; } } };
  for (let i = 1; i <= 4; i += 1) recordIncident(line(i, { work: `w-tide-${i}` }));
  const both = await Promise.all([
    checkReliability({ project: 'harbour__demo', client, now: () => NOW }),
    checkReliability({ project: 'harbour__other', client, now: () => NOW }),
  ]);
  assert.equal(both.filter((b) => b.raised).length, 1);
  assert.equal(written.length, 1);
  assert.equal(fs.existsSync(claimFolder()), false, 'the claim is let go');
}));

test('a claim another watcher holds keeps this one from sending', () => withHome(async () => {
  for (let i = 1; i <= 4; i += 1) recordIncident(line(i, { work: `w-tide-${i}` }));
  held(claimFolder());
  const written = [];
  assert.equal((await checkReliability({ project: 'harbour__demo', client: clientOf(written), now: () => NOW })).raised, false);
  assert.equal(written.length, 0);
}));

test('a future-dated entry doesn\'t wipe real ones: pruning goes by the incoming incident', () => withHome(async () => {
  recordIncident(line(-90, { work: 'w-tide-1' }));
  recordIncident(line(2, { work: 'w-tide-2' }));
  recordIncident(line(1, { work: 'w-tide-3' }));
  assert.deepEqual(readIncidents().map((l) => l.work).sort(), ['w-tide-1', 'w-tide-2', 'w-tide-3']);
}));

test('a claim another watcher holds does not stop an incident being recorded, only the pruning', () => withHome(async () => {
  recordIncident(line(60, { work: 'w-tide-1' }));
  held(recordClaimFolder());
  recordIncident(line(1, { work: 'w-tide-2' }));
  assert.deepEqual(readIncidents().map((l) => l.work), ['w-tide-1', 'w-tide-2'], 'recorded, and not pruned without the claim');
}));

test('a claim is let go only by its owner', () => withHome(async () => {
  const folder = claimFolder();
  const mine = takeClaim(folder);
  assert.equal(typeof mine, 'function');
  assert.equal(takeClaim(folder), null, 'held');
  fs.writeFileSync(path.join(folder, 'owner'), 'someone-else\n');
  mine();
  assert.ok(fs.existsSync(folder), 'a claim that is no longer mine is left alone');
}));

test('a stale claim is taken over by one watcher only, and nothing is left beside it', () => withHome(async () => {
  const folder = claimFolder();
  held(folder);
  const old = new Date(Date.now() - 60 * 60 * 1000);
  fs.utimesSync(folder, old, old);
  const first = takeClaim(folder);
  const second = takeClaim(folder);
  assert.equal(typeof first, 'function');
  assert.equal(second, null);
  first();
  assert.deepEqual(fs.readdirSync(wheelhouseHome()).filter((n) => n.includes('claim')), []);
}));

test('a notice sent between the first look and the claim is not sent again', () => withHome(async () => {
  for (let i = 1; i <= 4; i += 1) recordIncident(line(i, { work: `w-tide-${i}` }));
  const written = [];
  const between = () => fs.writeFileSync(noticeFile(), `${JSON.stringify({ at: NOW.toISOString() })}\n`);
  assert.equal((await checkReliability({ project: 'harbour__demo', client: clientOf(written), now: () => NOW, between })).raised, false);
  assert.equal(written.length, 0);
}));

test('the notice\'s time is on record before the card is sent, so a stop after the send never sends it twice', () => withHome(async () => {
  for (let i = 1; i <= 4; i += 1) recordIncident(line(i, { work: `w-tide-${i}` }));
  let seen = null;
  const client = { state: { write: async () => { seen = fs.existsSync(noticeFile()); return { ok: true }; } } };
  await checkReliability({ project: 'harbour__demo', client, now: () => NOW });
  assert.equal(seen, true);
  const refusing = { state: { write: async () => ({ ok: false, refused: 'no' }) } };
  fs.rmSync(noticeFile());
  await checkReliability({ project: 'harbour__demo', client: refusing, now: () => NOW, log: () => {} });
  assert.equal(fs.existsSync(noticeFile()), false, 'a refused card leaves no mark');
}));

test('when the record claim is held a moment, the watcher waits for it and the line is written under it', () => withHome(async () => {
  recordIncident(line(60, { work: 'w-tide-1' }));
  held(recordClaimFolder());
  let waits = 0;
  const sleep = () => {
    waits += 1;
    if (waits === 2) fs.rmSync(recordClaimFolder(), { recursive: true, force: true });
  };
  assert.equal(recordIncident(line(1, { work: 'w-tide-2' }), { sleep }), true);
  assert.equal(waits, 2);
  assert.deepEqual(readIncidents().map((l) => l.work), ['w-tide-2'], 'written under the claim, so the old line was pruned with it');
}));

test('the same occurrence added by another watcher between the look and the claim is not added twice', () => withHome(async () => {
  const a = line(1, { work: 'w-tide-1', key: 'resumed:harbour__demo:w-tide-1:run-1' });
  const beforeClaim = () => fs.appendFileSync(reliabilityFile(), `${JSON.stringify(a)}\n`);
  assert.equal(recordIncident(a, { beforeClaim }), false);
  assert.equal(readIncidents().length, 1);
}));

test('a fresh claim moved aside by mistake is put back, and never removed', () => withHome(async () => {
  const folder = claimFolder();
  held(folder);
  const old = new Date(Date.now() - 60 * 60 * 1000);
  fs.utimesSync(folder, old, old);
  // After the stale claim was seen, another watcher took it over and made a live one.
  const seen = () => {
    fs.rmSync(folder, { recursive: true, force: true });
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'owner'), 'live\n');
  };
  assert.equal(takeClaim(folder, { seen }), null);
  assert.equal(fs.readFileSync(path.join(folder, 'owner'), 'utf8').trim(), 'live');
  assert.deepEqual(fs.readdirSync(wheelhouseHome()).filter((n) => n.includes('stale')), []);
}));

test('a live claim that can\'t be put back is left where it is, not deleted', () => withHome(async () => {
  const folder = claimFolder();
  held(folder);
  const old = new Date(Date.now() - 60 * 60 * 1000);
  fs.utimesSync(folder, old, old);
  const seen = () => {
    fs.rmSync(folder, { recursive: true, force: true });
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'owner'), 'live\n');
  };
  // Something makes the way back busy: a folder with a file in it where the claim belongs.
  const aside = () => {
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'busy'), 'x');
  };
  assert.equal(takeClaim(folder, { seen, aside }), null);
  const left = fs.readdirSync(wheelhouseHome()).filter((n) => n.includes('stale'));
  assert.equal(left.length, 1);
  assert.equal(fs.readFileSync(path.join(wheelhouseHome(), left[0], 'owner'), 'utf8').trim(), 'live');
}));

test('a claim folder that couldn\'t be given its owner is removed, not left to block others', () => withHome(async () => {
  const folder = claimFolder();
  assert.equal(takeClaim(folder, { owner: () => { throw new Error('disk full'); } }), null);
  assert.equal(fs.existsSync(folder), false);
  assert.equal(typeof takeClaim(folder), 'function');
}));

test('stale folders left beside a claim are swept once they are old', () => withHome(async () => {
  const folder = claimFolder();
  fs.mkdirSync(`${folder}.stale-old`, { recursive: true });
  fs.mkdirSync(`${folder}.stale-new`, { recursive: true });
  const old = new Date(Date.now() - 60 * 60 * 1000);
  fs.utimesSync(`${folder}.stale-old`, old, old);
  const release = takeClaim(folder);
  release();
  assert.deepEqual(fs.readdirSync(wheelhouseHome()).filter((n) => n.includes('stale')), ['reliability-notice.claim.stale-new']);
}));

test('an owner that can\'t be written never touches the claim folder, even one another watcher has just made', () => withHome(async () => {
  const folder = claimFolder();
  const owner = () => {
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'owner'), 'live\n');
    throw new Error('disk full');
  };
  assert.equal(takeClaim(folder, { owner }), null);
  assert.equal(fs.readFileSync(path.join(folder, 'owner'), 'utf8').trim(), 'live');
  assert.deepEqual(fs.readdirSync(wheelhouseHome()).filter((n) => n.includes('.new-')), [], 'only its own temporary folder was removed');
}));

test('a claim is never a folder without an owner: a put-back onto a live claim fails and leaves its owner intact', () => withHome(async () => {
  const folder = claimFolder();
  held(folder);
  const old = new Date(Date.now() - 60 * 60 * 1000);
  fs.utimesSync(folder, old, old);
  const live = (who) => () => {
    fs.rmSync(folder, { recursive: true, force: true });
    fs.mkdirSync(`${folder}.new-${who}`);
    fs.writeFileSync(path.join(`${folder}.new-${who}`, 'owner'), `${who}\n`);
    fs.renameSync(`${folder}.new-${who}`, folder);
  };
  // One watcher's fresh claim is moved aside by a watcher with a stale view, and another then takes the place.
  assert.equal(takeClaim(folder, { seen: live('first'), aside: live('second') }), null);
  assert.equal(fs.readFileSync(path.join(folder, 'owner'), 'utf8').trim(), 'second');
}));

test('a claim that is taken has its owner inside from the start', () => withHome(async () => {
  const folder = claimFolder();
  const seenEmpty = [];
  const release = takeClaim(folder);
  seenEmpty.push(fs.readdirSync(folder).length);
  release();
  assert.deepEqual(seenEmpty, [1]);
}));

test('old temporary claim folders are swept, and fresh ones are left', () => withHome(async () => {
  const folder = claimFolder();
  fs.mkdirSync(`${folder}.new-old`, { recursive: true });
  fs.mkdirSync(`${folder}.new-fresh`, { recursive: true });
  const old = new Date(Date.now() - 60 * 60 * 1000);
  fs.utimesSync(`${folder}.new-old`, old, old);
  takeClaim(folder)();
  assert.deepEqual(fs.readdirSync(wheelhouseHome()).filter((n) => n.includes('.new-')), ['reliability-notice.claim.new-fresh']);
}));

test('a claim that is old enough to be a crashed watcher\'s is not waited for', () => withHome(async () => {
  held(recordClaimFolder());
  const old = new Date(Date.now() - 60 * 1000);
  fs.utimesSync(recordClaimFolder(), old, old);
  let waits = 0;
  assert.equal(recordIncident(line(1, { work: 'w-tide-1' }), { sleep: () => { waits += 1; } }), true);
  assert.equal(waits, 0);
  assert.deepEqual(readIncidents().map((l) => l.work), ['w-tide-1'], 'appended without the claim');
}));
