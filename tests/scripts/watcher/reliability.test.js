// tests/scripts/watcher/reliability.test.js
// The engine's reliability bar (design section 10): each lost, stalled or crash-resumed piece is recorded, and more than three
// in a rolling 30 days, across projects, raises one notice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  BAR, checkReliability, claimFolder, engineTroubleCard, overBar, readIncidents, recordIncident, reliabilityFile,
} from '../../../scripts/watcher/reliability.js';
import { wheelhouseHome } from '../../../scripts/lib/paths.js';
import { withHome } from '../../helpers/homes.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-08T05:00:00.000Z');
const ago = (days) => new Date(NOW.getTime() - days * DAY).toISOString();
const line = (days, over = {}) => ({ kind: 'resumed', project: 'harbour__demo', work: 'w-tide-1', at: ago(days), ...over });

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
  fs.mkdirSync(claimFolder());
  const written = [];
  assert.equal((await checkReliability({ project: 'harbour__demo', client: clientOf(written), now: () => NOW })).raised, false);
  assert.equal(written.length, 0);
}));
