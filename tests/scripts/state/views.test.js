// tests/scripts/state/views.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildViews, writeViews, latestFor } from '../../../scripts/state/views.js';
import { listEvents, makeEvent, confirmationFor, eventHash, dataHash } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol, readEnrolled } from '../../../scripts/state/signing.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { tempFolder } from '../../helpers/homes.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'state');
const T = (n) => `2026-10-18T02:00:${String(n).padStart(2, '0')}.000Z`;
const at = (n) => () => new Date(T(n));
const VIEW_NAMES = ['rulebook', 'levels', 'settings', 'glossary', 'ideas', 'rejections', 'waiting', 'approvals', 'reviews', 'unconfirmed', 'damaged', 'status', 'work', 'features', 'reports', 'questions', 'incidents'];
const now = () => new Date('2026-10-18T09:00:00.000Z');

async function withHome(fn) {
  const home = path.join(tempFolder('wh-views-'), 'Zoë home');
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

test('a review with its sig removed does not count; a missing enrolled list counts nothing', async () => {
  await withHome(() => {
    const kept = ev('review', 1, { pr: 7, commit: 'a' });
    const stripped = { ...ev('review', 2, { pr: 7, commit: 'b' }) };
    delete stripped.sig;
    const v = build([kept, stripped]);
    assert.deepEqual(Object.keys(v.reviews['7']), ['a']);
    for (const missing of [undefined, null]) {
      const none = buildViews([kept, ev('approval', 3, { pr: 7, commit: 'a' })], missing, { now });
      assert.deepEqual(none.reviews, {});
      assert.deepEqual(none.approvals, {});
    }
  });
});

test('views are replaced all at once', async () => {
  await withHome(async (home) => {
    const dir = stateDir('o__p');
    fs.mkdirSync(path.join(dir, 'events', '2026', '10'), { recursive: true });
    const out = path.join(home, 'projects', 'o__p', 'views');
    // an earlier build, a stale file in it, and the leftovers of a crashed one
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'stale.json'), '{}');
    fs.mkdirSync(`${out}.new`, { recursive: true });
    fs.writeFileSync(path.join(`${out}.new`, 'junk.json'), '{}');
    fs.mkdirSync(`${out}.old`, { recursive: true });
    await writeViews('o__p', { now });
    const names = fs.readdirSync(out).sort();
    assert.ok(!names.includes('stale.json'), 'the old folder was replaced whole');
    assert.ok(!names.includes('junk.json'));
    assert.equal(names.length, VIEW_NAMES.length);
    assert.deepEqual(fs.readdirSync(path.dirname(out)).filter((n) => n.startsWith('views')), ['views']);
    // a rename that fails puts the earlier views back
    const before = fs.readFileSync(path.join(out, 'status.json'), 'utf8');
    const real = fs.renameSync;
    fs.renameSync = (from, to) => {
      if (to === out && from.endsWith('.new')) throw new Error('locked');
      return real(from, to);
    };
    try {
      await assert.rejects(writeViews('o__p', { now: () => new Date('2026-10-19T00:00:00.000Z') }), /locked/);
    } finally {
      fs.renameSync = real;
    }
    assert.equal(fs.readFileSync(path.join(out, 'status.json'), 'utf8'), before);
  });
});

// --- final review ---

test('a card-answer with no card id closes the card whose question it quotes', async () => {
  await withHome(() => {
    const asked = ev('card', 10, { title: 'Pick a size', question: 'Approve pull request #7 at commit abcdef123456?' });
    const titled = ev('card', 11, { title: 'Pick a shape' });
    const other = ev('card', 12, { title: 'Pick a sound', question: 'Which sound?' });
    const answers = [
      // The prompt record's shape: the question as shown, and the label clicked.
      ev('card-answer', 20, { question: 'Approve pull request #7 at commit abcdef123456?', label: 'Approve' }),
      ev('card-answer', 21, { question: 'Pick a shape', label: 'Round' }),
      ev('card-answer', 22, { question: 'Something nobody asked', label: 'Yes' }),
      // A card id wins over the question: this one names c002, whatever it quotes.
      ev('card-answer', 23, { card: 'c002', question: 'Which sound?', label: 'Bell' }),
    ];
    const v = build([...base(), asked, titled, other, ...answers]);
    assert.deepEqual(v.waiting.map((c) => c.id), [other.id]);
    assert.equal(v.status.waitingCount, 1);
  });
});

// --- the build loop's records ---

const H1 = '1'.repeat(64);
const H2 = '2'.repeat(64);
const H3 = '3'.repeat(64);
const workEv = (n, data = {}) => ev('work', n, { id: 'export-csv', title: 'Export', lane: 'feature', doc: { path: 'd.md', hash: H1 }, visible: true, dependsOn: [], ...data });
const click = (n, data) => ev('action', n, { question: 'the card as shown', label: 'Approve', ...data });
const approve = (n, hash, extra = {}) => click(n, { action: 'approve-work', work: 'export-csv', lane: 'feature', hash, shownFirst: false, ...extra });
const unsigned = (e) => { const { sig, ...rest } = e; return rest; };

test('an approval of another hash leaves the work unapproved', async () => {
  await withHome(() => {
    const w = workEv(1);
    assert.deepEqual(build([w]).work['export-csv'].approved, false);
    assert.equal(build([w]).work['export-csv'].approval, undefined);
    assert.equal(build([w]).work['export-csv'].work.data.title, 'Export');
    // another hash; another work; an unsigned click; a forged one
    const wrong = [approve(2, H2), approve(3, H1, { work: 'other' }), unsigned(approve(4, H1)), { ...approve(5, H1), data: { ...approve(5, H1).data, lane: 'small' } }];
    assert.equal(build([w, ...wrong]).work['export-csv'].approved, false);
    const v = build([w, ...wrong, approve(6, H1, { shownFirst: true })]).work['export-csv'];
    assert.equal(v.approved, true);
    assert.deepEqual(v.approval, { hash: H1, shownFirst: true, lane: 'feature' });
    // A work with no document has nothing to approve.
    const bare = workEv(1, { doc: undefined });
    delete bare.data.doc;
    assert.equal(build([bare, approve(2, H1)]).work['export-csv'].approved, false);
    // A click that no enrolled key signed counts for nothing.
    assert.equal(build([w, approve(2, H1)], {}).work['export-csv'].approved, true);
    assert.equal(buildViews([w, approve(2, H1)], [], { now }).work['export-csv'].approved, false);
  });
});

test('a revised work document asks for a new approval', async () => {
  await withHome(() => {
    const v = build([workEv(1), approve(2, H1), workEv(3, { doc: { path: 'd.md', hash: H2 } })]);
    assert.equal(v.work['export-csv'].approved, false);
    assert.equal(build([workEv(1), approve(2, H1), workEv(3, { doc: { path: 'd.md', hash: H2 } }), approve(4, H2)]).work['export-csv'].approved, true);
  });
});

test('an approved amendment moves the hash an approval must name', async () => {
  await withHome(() => {
    const w = workEv(1);
    const amendment = ev('amendment', 3, { work: 'export-csv', change: 'CSV, not Excel', hash: H2 });
    const amend = (n, hash) => click(n, { action: 'amend', work: 'export-csv', hash, label: 'Change it' });
    const base1 = [w, approve(2, H1, { shownFirst: true }), amendment];
    // The amendment is only proposed: the approval still stands.
    assert.equal(build(base1).work['export-csv'].approved, true);
    // Approved by a verified click: the approval carries to the changed document.
    const moved = build([...base1, amend(4, H2)]).work['export-csv'];
    assert.equal(moved.approved, true);
    assert.deepEqual(moved.approval, { hash: H2, shownFirst: true, lane: 'feature' });
    // An approval that names the old document no longer counts.
    const stale = build([w, amendment, amend(4, H2), approve(5, H1)]).work['export-csv'];
    assert.equal(stale.approved, false);
    assert.equal(build([w, amendment, amend(4, H2), approve(5, H2)]).work['export-csv'].approved, true);
    // An approval of the changed document made before the click counts too.
    assert.equal(build([w, amendment, approve(2, H2), amend(4, H2)]).work['export-csv'].approved, true);
    // An unsigned click, a click naming no proposed amendment, or another work's, changes nothing.
    for (const nothing of [unsigned(amend(4, H2)), amend(4, H3), click(4, { action: 'amend', work: 'other', hash: H2, label: 'Change it' })]) {
      const v = build([...base1, nothing]).work['export-csv'];
      assert.deepEqual([v.approved, v.approval.hash], [true, H1]);
      assert.equal(build([w, amendment, nothing, approve(5, H2)]).work['export-csv'].approved, false);
    }
    // The latest approved amendment is the one that counts.
    const second = ev('amendment', 5, { work: 'export-csv', change: 'and tabs', hash: H3 });
    const chain = build([...base1, amend(4, H2), second, amend(6, H3)]).work['export-csv'];
    assert.deepEqual([chain.approved, chain.approval.hash], [true, H3]);
    // An amendment of work nobody had approved does not approve it.
    assert.equal(build([w, amendment, amend(4, H2)]).work['export-csv'].approved, false);
    // A revised document after the amendment starts again.
    const revised = workEv(7, { doc: { path: 'd.md', hash: H3 } });
    assert.equal(build([...base1, amend(4, H2), revised]).work['export-csv'].approved, false);
  });
});

test('features hold the latest feature event for each work', async () => {
  await withHome(() => {
    const a = ev('feature', 1, { work: 'export-csv', step: 'started' });
    const b = ev('feature', 2, { work: 'export-csv', step: 'building', branch: 'feature/export-csv' });
    const c = ev('feature', 3, { work: 'login', step: 'planned' });
    const v = build([c, a, b]);
    assert.deepEqual(Object.keys(v.features).sort(), ['export-csv', 'login']);
    assert.equal(v.features['export-csv'].id, b.id);
    assert.equal(v.features['export-csv'].data.step, 'building');
    assert.equal(v.features['export-csv'].at, T(2));
  });
});

test('reports hold the latest report event for each work', async () => {
  await withHome(() => {
    assert.deepEqual(build([]).reports, {});
    const a = ev('report', 1, { work: 'export-csv', outcome: 'blocked', summary: 'Stuck', rulings: [] });
    const b = ev('report', 2, { work: 'export-csv', outcome: 'merged', summary: 'Done', rulings: [], pr: 7 });
    const c = ev('report', 3, { work: 'login', outcome: 'closed', summary: 'Dropped', rulings: [] });
    const v = build([c, a, b]);
    assert.deepEqual(Object.keys(v.reports).sort(), ['export-csv', 'login']);
    assert.equal(v.reports['export-csv'].id, b.id);
    assert.equal(v.reports['export-csv'].data.outcome, 'merged');
    assert.equal(v.reports['export-csv'].at, T(2));
    assert.equal(v.reports.login.key, 'login');
  });
});

const question = (n, data = {}) => ev('question', n, {
  id: 'q-export-csv-1', work: 'export-csv', what: 'Which separator?', why: 'It changes the file',
  options: [{ label: 'Comma', says: 'Commas' }, { label: 'Tab', says: 'Tabs' }], recommendation: 'Comma', level: 2, ...data,
});
const answer = (n, label, extra = {}) => click(n, { action: 'answer', questionId: 'q-export-csv-1', questionHash: dataHash(question(1).data), label, ...extra });

test('a question is answered only by a verified answer action', async () => {
  await withHome(() => {
    const q = question(1);
    const open = build([q]).questions['q-export-csv-1'];
    assert.equal(open.answer, null);
    assert.equal(open.question.data.what, 'Which separator?');
    // A plain card-answer, an unsigned click, a click for another question, and one from an unenrolled key answer nothing.
    const plain = ev('card-answer', 2, { question: 'Answer question q-export-csv-1', label: 'Comma' });
    const noise = [plain, unsigned(answer(3, 'Comma')), answer(4, 'Comma', { questionId: 'q-export-csv-2' })];
    assert.equal(build([q, ...noise]).questions['q-export-csv-1'].answer, null);
    assert.equal(buildViews([q, answer(5, 'Comma')], [], { now }).questions['q-export-csv-1'].answer, null);
    const done = build([q, ...noise, answer(6, 'Tab')]).questions['q-export-csv-1'];
    assert.deepEqual(done.answer, { label: 'Tab', at: T(6) });
    // An answer to a question nobody asked is not a question.
    assert.deepEqual(Object.keys(build([answer(6, 'Tab')]).questions), []);
    // A question the foreman records again, word for word, is still one question and keeps its answer.
    assert.deepEqual(Object.keys(build([q, answer(6, 'Tab'), question(7)]).questions), ['q-export-csv-1']);
    assert.deepEqual(build([q, answer(6, 'Tab'), question(7)]).questions['q-export-csv-1'].answer, { label: 'Tab', at: T(6) });
    // A label the question does not offer, or an answer naming another question hash, answers nothing.
    assert.equal(build([q, answer(6, 'Semicolon')]).questions['q-export-csv-1'].answer, null);
    assert.equal(build([q, answer(6, 'Tab', { questionHash: 'e'.repeat(64) })]).questions['q-export-csv-1'].answer, null);
  });
});

test('a question rewritten after it was answered needs a fresh answer', async () => {
  await withHome(() => {
    const q = question(1);
    const rewritten = question(7, { options: [{ label: 'Semicolon', says: 'Semicolons' }, { label: 'Tab', says: 'Different tabs' }] });
    const early = answer(6, 'Tab');
    const v = build([q, early, rewritten]).questions['q-export-csv-1'];
    assert.equal(v.question.id, rewritten.id);
    assert.equal(v.answer, null, 'the earlier answer was for the question as it was');
    // An answer that names the new content counts; the old one still does not replace it.
    const fresh = answer(8, 'Semicolon', { questionHash: dataHash(rewritten.data) });
    assert.deepEqual(build([q, early, rewritten, fresh]).questions['q-export-csv-1'].answer, { label: 'Semicolon', at: T(8) });
    // A rewritten question that kept the label but changed the words still asks again.
    const reworded = question(7, { what: 'Which delimiter?' });
    assert.equal(build([q, early, reworded]).questions['q-export-csv-1'].answer, null);
  });
});

test('an incident stays open until a verified lift names it; an unsigned lift changes nothing', async () => {
  await withHome(() => {
    const inc = ev('incident', 1, { id: 'bad-total', what: 'Totals are wrong' });
    const other = ev('incident', 2, { id: 'slow-page', what: 'The page hangs' });
    const lift = (n, incident, extra = {}) => click(n, { action: 'lift-incident', incident, label: 'End it', ...extra });
    const fix = (n, incident, pr) => click(n, { action: 'incident-fix', incident, pr, label: 'Merge the fix' });
    assert.deepEqual(build([]).incidents, { open: [] });
    assert.deepEqual(build([inc, other]).incidents.open, [
      { id: 'bad-total', what: 'Totals are wrong', at: T(1), fixes: [] },
      { id: 'slow-page', what: 'The page hangs', at: T(2), fixes: [] },
    ]);
    // An unsigned lift, a forged one and a plain note do nothing.
    const forged = { ...lift(4, 'bad-total'), data: { ...lift(4, 'bad-total').data, incident: 'slow-page' } };
    const v = build([inc, other, unsigned(lift(3, 'bad-total')), forged, ev('note', 5, { incident: 'bad-total', lifted: true })]);
    assert.deepEqual(v.incidents.open.map((i) => i.id), ['bad-total', 'slow-page']);
    assert.deepEqual(buildViews([inc, lift(3, 'bad-total')], [], { now }).incidents.open.map((i) => i.id), ['bad-total']);
    // Fixes come from verified clicks only, in order, and a repeat is listed once.
    const withFixes = build([inc, other, fix(3, 'bad-total', 31), unsigned(fix(4, 'bad-total', 99)), fix(5, 'bad-total', 31), fix(6, 'bad-total', 32), fix(7, 'slow-page', 40)]);
    assert.deepEqual(withFixes.incidents.open.map((i) => [i.id, i.fixes]), [['bad-total', [31, 32]], ['slow-page', [40]]]);
    // A verified lift ends it.
    const lifted = build([inc, other, fix(3, 'bad-total', 31), lift(4, 'bad-total')]);
    assert.deepEqual(lifted.incidents.open.map((i) => i.id), ['slow-page']);
    // A lift before the incident was declared does not end it; a second declaration of an open incident is one incident.
    assert.deepEqual(build([lift(0, 'bad-total'), inc]).incidents.open.map((i) => i.id), ['bad-total']);
    assert.equal(build([inc, ev('incident', 2, { id: 'bad-total', what: 'again' })]).incidents.open.length, 1);
  });
});

test('an approval counts only for the lane the work is in now', async () => {
  await withHome(() => {
    const w = workEv(1);
    const moved = workEv(3, { lane: 'quick' });
    assert.equal(build([w, approve(2, H1)]).work['export-csv'].approved, true);
    const v = build([w, approve(2, H1), moved]).work['export-csv'];
    assert.equal(v.approved, false);
    assert.equal(v.approval, undefined);
    // A fresh approval for the new lane counts; one for the old lane still does not.
    assert.equal(build([w, approve(2, H1), moved, approve(4, H1, { lane: 'feature' })]).work['export-csv'].approved, false);
    const again = build([w, approve(2, H1), moved, approve(4, H1, { lane: 'quick' })]).work['export-csv'];
    assert.deepEqual([again.approved, again.approval.lane], [true, 'quick']);
    // The lane check holds for an approval carried over a change as well.
    const amendment = ev('amendment', 5, { work: 'export-csv', change: 'x', hash: H2 });
    const amend = click(6, { action: 'amend', work: 'export-csv', hash: H2, label: 'Change it' });
    assert.equal(build([w, approve(2, H1), moved, amendment, amend]).work['export-csv'].approved, false);
  });
});

test('a work event naming the document an approved change already moved to leaves the work approved', async () => {
  await withHome(() => {
    const w = workEv(1);
    const amendment = ev('amendment', 3, { work: 'export-csv', change: 'CSV, not Excel', hash: H2 });
    const amend = click(4, { action: 'amend', work: 'export-csv', hash: H2, label: 'Change it' });
    const base1 = [w, approve(2, H1, { shownFirst: true }), amendment, amend];
    const recorded = workEv(5, { doc: { path: 'd.md', hash: H2 } });
    const v = build([...base1, recorded]).work['export-csv'];
    assert.equal(v.approved, true);
    assert.deepEqual(v.approval, { hash: H2, shownFirst: true, lane: 'feature' });
    // A work event naming some other document starts again.
    assert.equal(build([...base1, workEv(5, { doc: { path: 'd.md', hash: H3 } })]).work['export-csv'].approved, false);
    // One naming the original document is approved only because the director approved that document itself.
    assert.equal(build([...base1, workEv(5)]).work['export-csv'].approval.hash, H1);
  });
});

test('work remembers when it was first recorded', async () => {
  await withHome(() => {
    const v = build([workEv(5, { title: 'Export again' }), workEv(2), ev('work', 3, { id: 'login', title: 'Login', lane: 'small', visible: false, dependsOn: [] })]);
    assert.equal(v.work['export-csv'].since, T(2));
    assert.equal(v.work['export-csv'].work.at, T(5), 'the latest event is still the work');
    assert.equal(v.work.login.since, T(3));
  });
});
