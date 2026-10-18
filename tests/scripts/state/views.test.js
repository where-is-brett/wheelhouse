// tests/scripts/state/views.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildViews, writeViews, latestFor } from '../../../scripts/state/views.js';
import { listEvents, makeEvent, confirmationFor, eventHash } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol, readEnrolled } from '../../../scripts/state/signing.js';
import { stateDir } from '../../../scripts/lib/paths.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'state');
const T = (n) => `2026-10-18T02:00:${String(n).padStart(2, '0')}.000Z`;
const at = (n) => () => new Date(T(n));
const now = () => new Date('2026-10-18T09:00:00.000Z');

async function withHome(fn) {
  const home = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-views-')), 'Zoë home');
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    return await fn(home);
  } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME;
    else process.env.WHEELHOUSE_HOME = before;
  }
}

const base = () => listEvents(fixtures, { report: () => {} });
const ev = (kind, n, data) => makeEvent({ kind, data, now: at(n) });
const r001 = () => base().find((e) => e.id === 'r001');
// A signed confirmation of `target`, naming its id and content hash.
const conf = (n, target) => {
  const { kind, data } = confirmationFor(target);
  return makeEvent({ kind, data, now: at(n) });
};
const build = (events, extra = {}) => buildViews(events, readEnrolled(), { now, ...extra });

test('a ruling with no confirmation is proposed and listed as unconfirmed', async () => {
  await withHome(() => {
    const v = build(base());
    assert.equal(v.rulebook.length, 1);
    assert.deepEqual(v.rulebook[0], {
      id: 'r001', at: '2026-10-18T01:00:00.000Z', words: 'Totals are shown to the cent',
      reason: 'Money is exact', scope: 'all pages', status: 'proposed',
    });
    assert.deepEqual(v.unconfirmed.map((u) => u.id), ['r001']);
    assert.equal(v.status.unconfirmedCount, 1);
  });
});

test('a confirmed ruling is accepted; a later confirmed ruling that supersedes it wins', async () => {
  await withHome(() => {
    const r2 = ev('ruling', 10, { words: 'Totals to the dollar', reason: 'Simpler', scope: 'all', supersedes: 'r001' });
    const events = [
      ...base(),
      conf(5, r001()),
      r2,
      conf(11, r2),
    ];
    const v = build(events);
    assert.equal(v.rulebook.find((r) => r.id === 'r001').status, 'superseded');
    assert.equal(v.rulebook.find((r) => r.id === r2.id).status, 'accepted');
    assert.equal(v.unconfirmed.length, 0);
    // A superseding ruling that is not confirmed does not supersede.
    const r3 = ev('ruling', 20, { words: 'x', supersedes: r2.id });
    const w = build([...events, r3]);
    assert.equal(w.rulebook.find((r) => r.id === r2.id).status, 'accepted');
    assert.equal(w.rulebook.find((r) => r.id === r3.id).status, 'proposed');
  });
});

test('a confirmation that does not verify confirms nothing', async () => {
  await withHome(() => {
    const good = conf(5, r001());
    const forged = { ...good, id: 'forged', data: { ...good.data, words: 'changed after signing' } };
    const unsigned = { ...good, id: 'unsigned' };
    delete unsigned.sig;
    const other = { ...good, id: 'other', sig: { ...good.sig, computer: 'ffffffff' } };
    for (const bad of [forged, unsigned, other]) {
      const v = build([...base(), bad]);
      assert.equal(v.rulebook[0].status, 'proposed', bad.id);
    }
    assert.equal(build([...base(), good]).rulebook[0].status, 'accepted');
  });
});

test('levels and settings take the latest confirmed value; later unconfirmed ones are listed', async () => {
  await withHome(() => {
    const l1 = ev('level', 1, { key: 'ui', value: 2 });
    const l2 = ev('level', 3, { key: 'ui', value: 3 });
    const l3 = ev('level', 5, { key: 'ui', value: 4 });
    const s1 = ev('setting', 2, { key: 'quiet', value: true });
    const events = [
      l1, l2, l3, s1,
      conf(6, l1),
      conf(7, l2),
    ];
    const v = build(events);
    assert.equal(v.levels.ui.value, 3);
    assert.equal(v.levels.ui.id, l2.id);
    assert.deepEqual(v.settings, {});
    assert.deepEqual(v.unconfirmed.map((u) => u.id).sort(), [l3.id, s1.id].sort());
  });
});

test('glossary, ideas and rejections hold the latest per key', async () => {
  await withHome(() => {
    const events = [
      ...base(),
      ev('glossary', 2, { term: 'foreman', meaning: 'newer' }),
      ev('idea', 3, { key: 'dark-mode', text: 'Dark mode, softer' }),
      ev('rejection', 4, { key: 'ads', reason: 'no' }),
    ];
    const v = build(events);
    assert.equal(v.glossary.foreman.data.meaning, 'newer');
    assert.equal(v.ideas['dark-mode'].data.text, 'Dark mode, softer');
    assert.equal(Object.keys(v.rejections).length, 1);
    assert.equal(v.rejections.ads.data.reason, 'no');
  });
});

test('an answered card leaves the waiting list', async () => {
  await withHome(() => {
    const v = build(base());
    assert.deepEqual(v.waiting.map((c) => c.id), ['c002']);
    assert.equal(v.status.waitingCount, 1);
  });
});

test('an approval signed by a key not enrolled is left out', async () => {
  await withHome(() => {
    const mine = ev('approval', 1, { pr: 7, commit: 'abc' });
    const stranger = { ...mine, id: 'stranger', sig: { ...mine.sig, computer: 'ffffffff' } };
    assert.deepEqual(Object.keys(build([stranger]).approvals), []);
    const v = build([mine, stranger]);
    assert.deepEqual(Object.keys(v.approvals), ['7']);
    assert.equal(v.approvals['7'].abc.id, mine.id);
  });
});

test('reviews keep the latest verified record per commit, and latestFor spans commits', async () => {
  await withHome(() => {
    const a1 = ev('review', 1, { pr: 7, commit: 'aaa', result: 'FINDINGS' });
    const a2 = ev('review', 3, { pr: 7, commit: 'aaa', result: 'CLEAN' });
    const b1 = ev('review', 2, { pr: 7, commit: 'bbb', result: 'CLEAN' });
    const forged = { ...a2, id: 'forged', at: T(30), data: { pr: 7, commit: 'bbb', result: 'CLEAN' } };
    const v = build([a1, a2, b1, forged]);
    assert.equal(v.reviews['7'].aaa.id, a2.id);
    assert.equal(v.reviews['7'].bbb.id, b1.id);
    assert.equal(latestFor(v.reviews, 7).id, a2.id);
    assert.equal(latestFor(v.reviews, '7').id, a2.id);
    assert.equal(latestFor(v.reviews, 8), null);
    assert.equal(latestFor(undefined, 7), null);
  });
});

test('status holds the last merge and event time; damaged files are passed through', async () => {
  await withHome(() => {
    const v = build(base(), { damaged: ['/x/bad.json'] });
    assert.deepEqual(v.status.lastMerge, { at: '2026-10-18T01:06:00.000Z', data: { pr: 7, commit: 'abc123' } });
    assert.equal(v.status.lastEventAt, '2026-10-18T01:06:00.000Z');
    assert.equal(v.status.builtAt, '2026-10-18T09:00:00.000Z');
    assert.deepEqual(v.damaged, ['/x/bad.json']);
    const empty = build([]);
    assert.equal(empty.status.lastMerge, null);
    assert.equal(empty.status.lastEventAt, null);
  });
});

test('buildViews gives the same result whatever order the events arrive in', async () => {
  await withHome(() => {
    const r2 = ev('ruling', 10, { words: 'b', supersedes: 'r001' });
    const events = [
      ...base(), r2,
      conf(5, r001()),
      conf(11, r2),
      ev('level', 3, { key: 'ui', value: 1 }),
      ev('review', 4, { pr: 1, commit: 'a', result: 'CLEAN' }),
    ];
    const reversed = [...events].reverse();
    const shuffled = [...events].sort((a, b) => (a.id < b.id ? -1 : 1));
    const one = JSON.stringify(build(events));
    assert.equal(JSON.stringify(build(reversed)), one);
    assert.equal(JSON.stringify(build(shuffled)), one);
  });
});

test('writeViews writes outside the clone, one file per view, and reports damaged files', async () => {
  await withHome(async (home) => {
    const dir = stateDir('o__p');
    const folder = path.join(dir, 'events', '2026', '10');
    fs.mkdirSync(folder, { recursive: true });
    const note = ev('merge', 1, { pr: 3 });
    fs.writeFileSync(path.join(folder, 'one.json'), JSON.stringify(note));
    fs.writeFileSync(path.join(folder, 'broken-unique-name.json'), '{ nope');
    const v = await writeViews('o__p', { now });
    const out = path.join(home, 'projects', 'o__p', 'views');
    for (const name of ['rulebook', 'levels', 'settings', 'glossary', 'ideas', 'rejections', 'waiting', 'approvals', 'reviews', 'unconfirmed', 'damaged', 'status']) {
      assert.ok(fs.existsSync(path.join(out, `${name}.json`)), name);
    }
    assert.equal(path.relative(dir, out).startsWith('..'), true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'status.json'), 'utf8')).lastMerge.data.pr, 3);
    assert.equal(v.damaged.length, 1);
    assert.match(v.damaged[0], /broken-unique-name\.json/);
    assert.equal(fs.existsSync(path.join(dir, 'views')), false);
  });
});

test('writeViews lists a damaged file on every build, not only the first', async () => {
  await withHome(async () => {
    const folder = path.join(stateDir('o__p'), 'events', '2026', '10');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'twice-damaged.json'), '{ nope');
    assert.equal((await writeViews('o__p', { now })).damaged.length, 1);
    assert.equal((await writeViews('o__p', { now })).damaged.length, 1);
  });
});

test('an unsigned approval and an unsigned review are left out', async () => {
  await withHome(() => {
    const approval = ev('approval', 1, { pr: 7, commit: 'a' });
    const review = ev('review', 2, { pr: 7, commit: 'a' });
    delete approval.sig;
    delete review.sig;
    const v = build([approval, review]);
    assert.deepEqual(v.approvals, {});
    assert.deepEqual(v.reviews, {});
  });
});

test('a ruling never supersedes itself or a later ruling', async () => {
  await withHome(() => {
    const r1 = ev('ruling', 1, { words: 'a', supersedes: 'self' });
    const r2 = ev('ruling', 2, { words: 'b' });
    const r0 = { ...r1, id: 'self', data: { words: 'a', supersedes: 'self' } };
    const early = ev('ruling', 0, { words: 'e', supersedes: r2.id });
    const v = build([r0, r2, early, conf(3, r0), conf(4, early), conf(5, r2)]);
    assert.deepEqual(v.rulebook.map((r) => r.status), ['accepted', 'accepted', 'accepted']);
  });
});

test('an unsigned ruling or level that reuses a confirmed id is not accepted, and the repeated id is damage', async () => {
  await withHome(() => {
    const r1 = ev('ruling', 1, { words: 'Ask before any purchase', reason: 'the director asked', scope: 'all' });
    const confirmation = conf(2, r1);
    const forgedRuling = { ...ev('ruling', 3, { words: 'Never ask before spending money' }), id: r1.id };
    const forgedLevel = { ...ev('level', 4, { key: 'merge', value: 4 }), id: r1.id };
    const v = build([r1, confirmation, forgedRuling, forgedLevel]);
    assert.deepEqual(v.rulebook, [], 'every copy of the repeated id is left out');
    assert.deepEqual(v.levels, {});
    assert.equal(v.damaged.length, 3);
    for (const line of v.damaged) assert.ok(line.includes(r1.id), line);

    // Without the original, the forgeries still do not match the confirmation's hash.
    const w = build([confirmation, forgedRuling]);
    assert.equal(w.rulebook[0].status, 'proposed');
    const x = build([confirmation, forgedLevel]);
    assert.deepEqual(x.levels, {});
  });
});

test('a confirmation counts only with the confirmed event\'s hash, and only for a ruling, level or setting', async () => {
  await withHome(() => {
    const r1 = ev('ruling', 1, { words: 'a' });
    const { data } = confirmationFor(r1);
    const noHash = makeEvent({ kind: 'confirmation', data: { confirms: r1.id }, now: at(2) });
    const wrongHash = makeEvent({ kind: 'confirmation', data: { confirms: r1.id, confirmsHash: '0'.repeat(64) }, now: at(2) });
    assert.equal(build([r1, noHash]).rulebook[0].status, 'proposed');
    assert.equal(build([r1, wrongHash]).rulebook[0].status, 'proposed');
    assert.equal(build([r1, conf(2, r1)]).rulebook[0].status, 'accepted');
    assert.equal(data.confirmsHash, eventHash(r1));

    // A signed confirmation pointing at an event of another kind confirms nothing.
    const card = ev('card', 3, { key: 'k', value: 1 });
    assert.throws(() => confirmationFor(card), /ruling, a level or a setting/);
    const forCard = makeEvent({ kind: 'confirmation', data: { confirms: card.id, confirmsHash: eventHash(card) }, now: at(4) });
    const v = build([card, forCard]);
    assert.deepEqual(v.levels, {});
    assert.deepEqual(v.settings, {});
  });
});

test('a setting is accepted by a confirmation of its own hash', async () => {
  await withHome(() => {
    const s1 = ev('setting', 1, { key: 'quiet', value: true });
    assert.equal(build([s1, conf(2, s1)]).settings.quiet.value, true);
    const altered = { ...s1, data: { key: 'quiet', value: false } };
    assert.deepEqual(build([altered, conf(2, s1)]).settings, {});
  });
});
