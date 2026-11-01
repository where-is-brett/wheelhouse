// tests/scripts/state/views.test.js
import crypto from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildViews, writeViews, latestFor, readyColumns } from '../../../scripts/state/views.js';
import { listEvents, makeEvent, confirmationFor, eventHash, dataHash, eventPath } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol, readEnrolled, sign } from '../../../scripts/state/signing.js';
import { approvalLine, ciPushLine, confirmLine } from '../../../scripts/state/card-lines.js';
import { computerId, profileDir, stateDir } from '../../../scripts/lib/paths.js';
import { tempFolder } from '../../helpers/homes.js';
import { readingOf } from '../../../scripts/delegation/seal.js';
import { composeRule } from '../../../scripts/delegation/composer.js';
import { SUGGEST, WHY } from '../../../scripts/lib/calm-words.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'state');
const T = (n) => `2026-10-18T02:00:${String(n).padStart(2, '0')}.000Z`;
const at = (n) => () => new Date(T(n));
const VIEW_NAMES = ['rulebook', 'levels', 'settings', 'glossary', 'ideas', 'rejections', 'waiting', 'approvals', 'reviews', 'provenance', 'unconfirmed', 'damaged', 'codeClashes', 'status', 'blockers', 'risks', 'decisions', 'shown', 'work', 'features', 'reports', 'questions', 'incidents', 'keptAsIs', 'gateAsks', 'lineageHolds', 'outdated', 'controlFiles', 'survey', 'columnsReady', 'usageCards', 'premium', 'premiumFailures', 'runs', 'asks', 'costs', 'previews', 'lessons', 'engineNotes', 'cardsWaiting', 'evidence', 'rules', 'brief', 'sendBacks', 'slept'];
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

// A card as it was written before cards carried a kind, options and a level; makeEvent no longer takes one.
const legacyCard = (id, n, data) => ({ v: 1, id, at: T(n), computer: 'aaaaaaaa', kind: 'card', data });
const cardData = (question, extra = {}) => ({
  question, header: 'Approve', options: ['Approve', 'Not now', 'Explain more', 'Show me'], kind: 'approval',
  line: null, code: null, level: 3, importance: 5, ...extra,
});
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

test('the cards held back are the latest list, less any pulled since', () => {
  const note = (data, n) => makeEvent({ kind: 'note', data, now: () => new Date(Date.UTC(2026, 9, 18, 0, 0, n)) });
  const view = (events) => buildViews(events, []).cardsWaiting;
  assert.deepEqual(view([]), { count: 0, ids: [], pulled: [] });
  assert.deepEqual(view([note({ about: 'cards-waiting', count: 2 }, 1)]), { count: 2, ids: [], pulled: [] }, 'a note from the version before');
  const listed = note({ about: 'cards-waiting', count: 2, ids: ['q-a-1', 'q-b-2'] }, 2);
  assert.deepEqual(view([listed]), { count: 2, ids: ['q-a-1', 'q-b-2'], pulled: [] });
  const pulled = note({ about: 'cards-pulled', ids: ['q-a-1'] }, 3);
  assert.deepEqual(view([listed, pulled]), { count: 1, ids: ['q-b-2'], pulled: ['q-a-1'] });
  // The router wrote its list before it saw the pull: the pull still stands.
  assert.deepEqual(view([listed, pulled, note({ about: 'cards-waiting', count: 2, ids: ['q-a-1', 'q-b-2'] }, 4)]), { count: 1, ids: ['q-b-2'], pulled: ['q-a-1'] });
  assert.deepEqual(view([listed, pulled, note({ about: 'cards-waiting', count: 1, ids: ['q-b-2'] }, 5)]), { count: 1, ids: ['q-b-2'], pulled: [] });
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
    for (const name of ['rulebook', 'levels', 'settings', 'glossary', 'ideas', 'rejections', 'waiting', 'approvals', 'reviews', 'unconfirmed', 'damaged', 'status', 'blockers', 'risks', 'decisions', 'shown']) {
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
    const card = ev('card', 3, cardData('Pick a colour?'));
    assert.throws(() => confirmationFor(card), /ruling, a level, a setting, a rule or a brief/);
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
    const asked = ev('card', 10, cardData('Approve pull request #7 at commit abcdef123456?'));
    const titled = legacyCard('t001', 11, { title: 'Pick a shape' });
    const other = ev('card', 12, cardData('Which sound?', { options: ['Bell', 'Chime', 'Not now'] }));
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

const shownData = (code, question, options = ['Yes', 'No']) => ({ code, question, options });

test('blockers and risks hold the latest per key; decisions list newest first, at most 50', async () => {
  await withHome(() => {
    const events = [
      ev('blocker', 1, { key: 'login', what: 'No sign-in' }),
      ev('blocker', 2, { key: 'login', what: 'No sign-in', resolved: true }),
      ev('risk', 3, { key: 'rates', what: 'Typed in', costLater: 'A day' }),
    ];
    for (let i = 0; i < 55; i++) events.push(makeEvent({ kind: 'decision', now: () => new Date(Date.UTC(2026, 9, 18, 3, 0, i)),
      data: { what: `d${i}`, why: 'w', level: 1 } }));
    const v = build(events);
    assert.equal(v.blockers.login.data.resolved, true);
    assert.equal(v.risks.rates.data.costLater, 'A day');
    assert.equal(v.decisions.length, 50);
    assert.equal(v.decisions[0].data.what, 'd54');
    assert.equal(v.decisions[49].data.what, 'd5');
  });
});

test('an unsigned or wrongly signed shown record is left out of the shown view', async () => {
  await withHome(() => {
    const signed = ev('shown', 1, shownData('K7M2', 'Ship it?'));
    const unsigned = { ...ev('shown', 2, shownData('P3Q4', 'Other?')) };
    delete unsigned.sig;
    const forged = ev('shown', 3, shownData('R5S6', 'Third?'));
    forged.data = { ...forged.data, question: 'Altered?' };
    const v = build([signed, unsigned, forged]);
    assert.deepEqual(Object.keys(v.shown), ['K7M2']);
    assert.deepEqual(v.shown.K7M2, { id: signed.id, at: signed.at, question: 'Ship it?', options: ['Yes', 'No'], spent: false });
    assert.deepEqual(v.damaged, []);
  });
});

test('a shown record is spent once a signed record carries its question', async () => {
  await withHome(() => {
    // By an approval or action carrying the same question.
    const s1 = ev('shown', 5, shownData('K7M2', 'Approve pull request #4 at commit abc?'));
    const early = ev('approval', 2, { pr: 4, commit: 'abc', question: s1.data.question });
    assert.equal(build([early, s1]).shown.K7M2.spent, false);
    const approval = ev('approval', 6, { pr: 4, commit: 'abc', question: s1.data.question });
    assert.equal(build([s1, approval]).shown.K7M2.spent, true);
    const other = ev('approval', 6, { pr: 4, commit: 'abc', question: 'Something else' });
    assert.equal(build([s1, other]).shown.K7M2.spent, false);
    const action = ev('action', 7, { action: 'lift-stop', question: s1.data.question, label: 'Lift' });
    assert.equal(build([s1, action]).shown.K7M2.spent, true);
    const unsigned = { ...approval };
    delete unsigned.sig;
    assert.equal(build([s1, unsigned]).shown.K7M2.spent, false);

    // By a confirmation of the one event the question's confirm line names.
    const setting = ev('setting', 1, { key: 'quiet', value: true, words: 'Be quiet' });
    const other2 = ev('setting', 1, { key: 'loud', value: true, words: 'Be loud' });
    const s2 = ev('shown', 8, shownData('T8V9', `Please read this.\n${confirmLine(setting)}\nThank you.`));
    assert.equal(build([setting, s2]).shown.T8V9.spent, false);
    assert.equal(build([setting, s2, conf(9, setting)]).shown.T8V9.spent, true);
    assert.equal(build([setting, other2, s2, conf(9, other2)]).shown.T8V9.spent, false);
    assert.equal(build([setting, conf(7, setting), s2]).shown.T8V9.spent, false);
    const bad = conf(9, setting);
    bad.data = { ...bad.data, confirmsHash: 'f'.repeat(64) };
    assert.equal(build([setting, s2, bad]).shown.T8V9.spent, false);
  });
});

test('two shown records with one code and different questions are both left out and listed as damaged', async () => {
  await withHome(() => {
    const a = ev('shown', 1, shownData('K7M2', 'First?'));
    const b = ev('shown', 2, shownData('K7M2', 'Second?'));
    const fine = ev('shown', 3, shownData('P3Q4', 'Fine?'));
    const v = build([a, b, fine]);
    assert.deepEqual(Object.keys(v.shown), ['P3Q4']);
    assert.equal(v.damaged.filter((d) => d.includes('K7M2')).length, 1);
    // The clash is also listed under its own key, apart from real damage.
    assert.deepEqual(v.codeClashes, ['a shown code held by two different questions: K7M2']);
    assert.deepEqual(build([a, b, fine], { damaged: ['/x/bad.json'] }).codeClashes, v.codeClashes);
    // The same question shown again under its code is not damage.
    const again = ev('shown', 4, shownData('P3Q4', 'Fine?'));
    const w = build([fine, again]);
    assert.equal(w.shown.P3Q4.id, again.id);
    assert.deepEqual(w.damaged, []);
  });
});

test('only live shown records hold a code or clash: a spent or expired one gives way to a later card', async () => {
  await withHome(() => {
    // Spent, then a later card with the same code and other words: no clash, the later card holds it.
    const used = ev('shown', 1, shownData('K7M2', 'STOP went on at noon.'));
    const lift = ev('action', 2, { action: 'lift-stop', question: used.data.question, label: 'Lift STOP' });
    const later = ev('shown', 3, shownData('K7M2', 'STOP went on again.'));
    const v = build([used, lift, later]);
    assert.equal(v.shown.K7M2.id, later.id);
    assert.equal(v.shown.K7M2.spent, false);
    assert.deepEqual(v.damaged, []);
    // Expired, then a later card: the later card holds it.
    const old = makeEvent({ kind: 'shown', data: shownData('P3Q4', 'Old card?'), now: () => new Date('2026-10-01T00:00:00.000Z') });
    const fresh = ev('shown', 4, shownData('P3Q4', 'New card?'));
    const w = build([old, fresh]);
    assert.equal(w.shown.P3Q4.id, fresh.id);
    assert.deepEqual(w.damaged, []);
    // With no live record, the latest one is shown, as used.
    assert.equal(build([used, lift]).shown.K7M2.spent, true);
  });
});

test('an accepted setting keeps the usage card offer that made it', async () => {
  await withHome(() => {
    const at = '2026-10-26T01:00:00.000Z';
    const s1 = ev('setting', 1, { key: 'efficiency', value: 'lean', usageCard: at });
    const s2 = ev('setting', 3, { key: 'efficiency', value: 'balanced' });
    assert.equal(build([s1, conf(2, s1)]).settings.efficiency.usageCard, at);
    assert.equal('usageCard' in build([s1, conf(2, s1), s2, conf(4, s2)]).settings.efficiency, false);
  });
});

test('an accepted setting keeps its until and the accepted value it replaced', async () => {
  await withHome(() => {
    const s1 = ev('setting', 1, { key: 'quiet', value: true, until: '2026-11-01T00:00:00.000Z' });
    const s2 = ev('setting', 3, { key: 'quiet', value: false });
    const s3 = ev('setting', 5, { key: 'quiet', value: true, until: '2026-12-01T00:00:00.000Z' });
    const s4 = ev('setting', 7, { key: 'quiet', value: 'never confirmed' });
    const v1 = build([s1, conf(2, s1)]);
    assert.deepEqual(v1.settings.quiet, {
      key: 'quiet', id: s1.id, at: s1.at, value: true, until: '2026-11-01T00:00:00.000Z', before: null, computer: s1.computer, confirmedOn: s1.computer, line: null, confirmedAt: T(2),
    });
    const v2 = build([s1, conf(2, s1), s2, conf(4, s2)]);
    assert.deepEqual(v2.settings.quiet, {
      key: 'quiet', id: s2.id, at: s2.at, value: false, before: { value: true, until: '2026-11-01T00:00:00.000Z' }, computer: s2.computer, confirmedOn: s2.computer, line: null, confirmedAt: T(4),
    });
    const v3 = build([s1, conf(2, s1), s2, conf(4, s2), s3, conf(6, s3), s4]);
    assert.deepEqual(v3.settings.quiet.before, { value: false });
    assert.equal(v3.settings.quiet.until, '2026-12-01T00:00:00.000Z');
    assert.equal(v3.settings.quiet.id, s3.id);
  });
});

test('an accepted setting carries its event\'s computer and the card line of its latest confirmation', async () => {
  await withHome(() => {
    const s1 = ev('setting', 1, { key: 'quiet', value: true });
    const withLine = (n, line) => makeEvent({ kind: 'confirmation', data: { ...confirmationFor(s1).data, line }, now: at(n) });
    assert.equal(build([s1, withLine(2, 'The card\'s own line')]).settings.quiet.line, 'The card\'s own line');
    assert.equal(build([s1, withLine(2, 'The card\'s own line'), conf(3, s1)]).settings.quiet.line, null);
    assert.equal(build([s1, withLine(2, 7)]).settings.quiet.line, null);
    assert.equal(build([s1, conf(2, s1)]).settings.quiet.computer, s1.computer);
    // The computer that signed the latest confirmation, only where it is the one the confirmation names.
    assert.equal(build([s1, conf(2, s1)]).settings.quiet.confirmedOn, s1.computer);
    const elsewhere = sign({ ...conf(2, s1), computer: 'deadbeef' });
    assert.equal(build([s1, elsewhere]).settings.quiet.value, true, 'still accepted');
    assert.equal(build([s1, elsewhere]).settings.quiet.confirmedOn, null);
    // A level carries neither.
    const l1 = ev('level', 1, { key: 'ui', value: 2 });
    assert.deepEqual(Object.keys(build([l1, conf(2, l1)]).levels.ui).sort(), ['at', 'id', 'key', 'value']);
  });
});

test('a known:* setting of false, accepted with no confirmation, carries no signer and no line', async () => {
  await withHome(() => {
    const s1 = ev('setting', 1, { key: 'known:branch', value: false });
    assert.deepEqual(build([s1]).settings['known:branch'], {
      key: 'known:branch', id: s1.id, at: s1.at, value: false, before: null, computer: s1.computer, confirmedOn: null, line: null, confirmedAt: null,
    });
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

test('the wish to see work first stands once any signed approval said it, in any lane or for any document (R120)', async () => {
  await withHome(() => {
    const w = workEv(1);
    assert.equal(Object.hasOwn(build([w, approve(2, H1)]).work['export-csv'], 'shownFirst'), false);
    // Another document's approval, and another lane's: neither approves the work, but the wish stands.
    for (const said of [approve(2, H2, { shownFirst: true }), approve(2, H1, { shownFirst: true, lane: 'small' })]) {
      const v = build([w, said]).work['export-csv'];
      assert.deepEqual([v.approved, v.shownFirst], [false, true]);
    }
    // An approval that came later and said otherwise does not take it back.
    assert.equal(build([w, approve(2, H1, { shownFirst: true }), approve(3, H1)]).work['export-csv'].shownFirst, true);
    // An unsigned click says nothing.
    assert.equal(Object.hasOwn(build([w, unsigned(approve(2, H1, { shownFirst: true }))]).work['export-csv'], 'shownFirst'), false);
  });
});

test('an approval made in the same millisecond as its work carries to an approved amendment, however their ids sort', async () => {
  await withHome(() => {
    const w = workEv(1);
    // An approval stamped the same millisecond as the work, whose id sorts before the work's.
    let first;
    do first = approve(1, H1); while (!(first.id < w.id));
    const amendment = ev('amendment', 3, { work: 'export-csv', change: 'CSV, not Excel', hash: H2 });
    const moved = build([w, first, amendment, click(4, { action: 'amend', work: 'export-csv', hash: H2, label: 'Change it' })]).work['export-csv'];
    assert.deepEqual([moved.approved, moved.approval?.hash], [true, H2]);
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
    assert.deepEqual(done.answer, { label: 'Tab', at: T(6), computer: computerId() });
    // An answer to a question nobody asked is not a question.
    assert.deepEqual(Object.keys(build([answer(6, 'Tab')]).questions), []);
    // A question the foreman records again, word for word, is still one question and keeps its answer.
    assert.deepEqual(Object.keys(build([q, answer(6, 'Tab'), question(7)]).questions), ['q-export-csv-1']);
    assert.deepEqual(build([q, answer(6, 'Tab'), question(7)]).questions['q-export-csv-1'].answer, { label: 'Tab', at: T(6), computer: computerId() });
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
    assert.deepEqual(build([q, early, rewritten, fresh]).questions['q-export-csv-1'].answer, { label: 'Semicolon', at: T(8), computer: computerId() });
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

test('incident-closed closes a red-main incident, and only a red-main one', async () => {
  await withHome(() => {
    const red = ev('incident', 1, { id: 'red-main-0123456789', what: 'The main line is red', kind: 'red-main', suspect: 12, work: 'fix-main-red-main-0123456789' });
    const declared = ev('incident', 2, { id: 'bad-total', what: 'Totals are wrong' });
    const closed = (n, incident) => ev('incident-closed', n, { incident, why: 'the main line\'s checks are green' });
    assert.deepEqual(build([red]).incidents.open, [
      { id: 'red-main-0123456789', what: 'The main line is red', at: T(1), fixes: [], kind: 'red-main', suspect: 12, work: 'fix-main-red-main-0123456789' },
    ]);
    assert.deepEqual(build([red, declared, closed(3, 'red-main-0123456789')]).incidents.open.map((i) => i.id), ['bad-total']);
    // The director's own incident ends only by their lift.
    assert.deepEqual(build([declared, closed(3, 'bad-total')]).incidents.open.map((i) => i.id), ['bad-total']);
    // A close before the incident opened does nothing; one opened again after it closed is open.
    assert.equal(build([closed(0, 'red-main-0123456789'), red]).incidents.open.length, 1);
    const again = ev('incident', 4, { id: 'red-main-0123456789', what: 'Red again', kind: 'red-main', suspect: null, work: 'fix-main-red-main-0123456789' });
    assert.deepEqual(build([red, closed(3, 'red-main-0123456789'), again]).incidents.open.map((i) => i.what), ['Red again']);
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

// --- a card stays waiting until it is answered ---


test('Not now, Explain more and Show me keep a card waiting, marked asked', async () => {
  await withHome(() => {
    const card = ev('card', 1, cardData('Approve pull request #7 at commit abcdef123456?'));
    const plain = (n, label) => ev('card-answer', n, { card: card.id, label });
    const asked = (n, label) => ({ at: T(n), label });
    assert.equal(build([card]).waiting[0].asked, null);
    for (const label of ['Not now', 'Explain more', 'Show me']) {
      const v = build([card, plain(2, label)]);
      assert.deepEqual(v.waiting.map((c) => c.id), [card.id], label);
      assert.deepEqual(v.waiting[0].asked, asked(2, label), label);
      assert.equal(v.status.waitingCount, 1);
    }
    // The latest answer that didn't close it is the one marked; an answer quoting the question counts too.
    const quoted = ev('card-answer', 5, { question: card.data.question, label: 'Explain more' });
    const v = build([card, plain(2, 'Not now'), plain(3, 'Show me'), quoted, plain(4, 'Not now')]);
    assert.deepEqual(v.waiting[0].asked, asked(5, 'Explain more'));
    // A label the card didn't offer is no decision either.
    const other = build([card, plain(2, 'Something else')]);
    assert.deepEqual(other.waiting.map((c) => c.id), [card.id]);
    assert.deepEqual(other.waiting[0].asked, asked(2, 'Something else'));
  });
});

test('a card a visit handed out is marked asked until a later answer says more', async () => {
  await withHome(() => {
    const card = ev('card', 1, cardData('Approve pull request #7 at commit abcdef123456?'));
    const other = ev('card', 2, cardData('Pick a shape', { kind: 'question', options: ['Round', 'Square'] }));
    const handed = (n, cards) => ev('asked', n, { cards });
    // Shown and dismissed: no answer, but it isn't offered again.
    const v = build([card, other, handed(3, [card.id])]);
    assert.deepEqual(v.waiting.map((c) => [c.id, c.asked]), [[card.id, { at: T(3), label: null }], [other.id, null]]);
    // An answer after it is what the card is marked with; an asked record after the answer marks it again.
    const answered = ev('card-answer', 4, { card: card.id, label: 'Explain more' });
    assert.deepEqual(build([card, handed(3, [card.id]), answered]).waiting[0].asked, { at: T(4), label: 'Explain more' });
    assert.deepEqual(build([card, answered, handed(5, [card.id, other.id])]).waiting[0].asked, { at: T(5), label: null });
    // It never closes a card, and an answer that decides still does.
    assert.deepEqual(build([card, handed(3, [card.id]), ev('card-answer', 4, { card: card.id, label: 'Approve' })]).waiting, []);
  });
});

test('an option that decides closes the card, even after it was asked about', async () => {
  await withHome(() => {
    const card = ev('card', 1, cardData('Approve pull request #7 at commit abcdef123456?'));
    const v = build([card, ev('card-answer', 2, { card: card.id, label: 'Not now' }), ev('card-answer', 3, { card: card.id, label: 'Approve' })]);
    assert.deepEqual(v.waiting, []);
    const quoted = build([card, ev('card-answer', 2, { question: card.data.question, label: 'Approve' })]);
    assert.deepEqual(quoted.waiting, []);
    // Two cards asking the same question both close on one answer.
    const twin = ev('card', 4, cardData(card.data.question));
    assert.deepEqual(build([card, twin, ev('card-answer', 5, { question: card.data.question, label: 'Approve' })]).waiting, []);
  });
});

test('a signed record carrying the card\'s question closes it', async () => {
  await withHome(() => {
    const question = 'Approve pull request #7 at commit abcdef123456?';
    const card = ev('card', 1, cardData(question));
    const signed = (kind, n, data) => ev(kind, n, data);
    const approval = signed('approval', 3, { pr: 7, commit: 'abcdef123456', words: 'Approve', question });
    assert.deepEqual(build([card, approval]).waiting, []);
    const action = signed('action', 3, { action: 'lift-stop', question, label: 'Lift STOP' });
    assert.deepEqual(build([card, action]).waiting, []);
    // Not a record from before the card, one for another question, or one from a key that isn't enrolled.
    const early = signed('approval', 0, { pr: 7, commit: 'abcdef123456', words: 'Approve', question });
    const elsewhere = signed('approval', 3, { pr: 8, commit: 'abcdef123456', words: 'Approve', question: 'Another?' });
    const stranger = { ...approval, id: 'stranger', sig: { ...approval.sig, computer: 'ffffffff' } };
    const unsigned = { ...approval, id: 'unsigned', sig: undefined };
    assert.deepEqual(build([card, early, elsewhere, stranger, unsigned]).waiting.map((c) => c.id), [card.id]);
  });
});

test('a confirmation closes the card whose confirm line names the event, as it spends a shown card', async () => {
  await withHome(() => {
    const ruling = ev('ruling', 1, { words: 'Totals to the cent', reason: 'Money', scope: 'all' });
    const line = confirmLine(ruling);
    const card = ev('card', 2, cardData(`What this is: a rule.\n${line}`, { kind: 'confirm', options: ['Confirm', 'Not now', 'Explain more'], line }));
    const bare = ev('card', 2, cardData(`Confirm the rule?\n${line}`, { kind: 'confirm', options: ['Confirm', 'Not now'], line: null }));
    assert.deepEqual(build([ruling, card, bare]).waiting.map((c) => c.id), [card.id, bare.id].sort());
    const done = build([ruling, card, bare, conf(5, ruling)]);
    assert.deepEqual(done.waiting, []);
    // A confirmation from before the card, or of another event, leaves it waiting.
    const later = ev('card', 9, cardData(`What this is: a rule.\n${line}`, { kind: 'confirm', options: ['Confirm', 'Not now'], line }));
    assert.deepEqual(build([ruling, conf(5, ruling), later]).waiting.map((c) => c.id), [later.id]);
    const other = ev('ruling', 3, { words: 'Another', reason: 'x', scope: 'all' });
    assert.deepEqual(build([ruling, other, card, conf(5, other)]).waiting.map((c) => c.id), [card.id]);
  });
});

test('Keep as is closes a proposal\'s confirm card, and its proposal stays unconfirmed', async () => {
  await withHome(() => {
    const level = ev('level', 1, { key: 'copy-changes', value: 2, words: '"copy-changes": level 2', because: 'you chose it' });
    const line = confirmLine(level);
    const card = ev('card', 2, cardData(`What this is: a level.\n${line}`, { kind: 'confirm', options: ['Confirm', 'Not now', 'Explain more', 'Keep as is'], line }));
    const putOff = build([level, card, ev('card-answer', 3, { card: card.id, label: 'Not now' })]);
    assert.deepEqual(putOff.waiting.map((c) => c.id), [card.id]);
    assert.deepEqual(putOff.keptAsIs, []);
    const kept = build([level, card, ev('card-answer', 3, { card: card.id, label: 'Keep as is' })]);
    assert.deepEqual(kept.waiting, []);
    assert.deepEqual(kept.unconfirmed.map((u) => u.id), [level.id]);
    assert.deepEqual(kept.levels, {});
    // keptAsIs names it (ruling F49), so the lists of what waits for the director's confirmation leave it out.
    assert.deepEqual(kept.keptAsIs, [level.id]);
    // A profile setting's card kept as is here names the profile's event, which this project's state doesn't hold.
    const setting = { ...ev('setting', 4, { key: 'boardTab', value: 'build', words: 'Board opens on: build', because: 'you asked for it' }), id: 'profile-setting' };
    const own = ev('card', 5, cardData(`What this is: a setting.\n${confirmLine(setting)}`, { kind: 'confirm', options: ['Confirm', 'Not now', 'Explain more', 'Keep as is'], line: confirmLine(setting) }));
    assert.deepEqual(build([level, card, own, ev('card-answer', 6, { card: own.id, label: 'Keep as is' })]).keptAsIs, ['profile-setting']);
  });
});

test('a project\'s confirm card for a profile setting closes once the profile holds its confirmation', async () => {
  await withHome(async (home) => {
    // A profile setting with a card in project B; the director confirmed it from project A's card,
    // so the confirmation is in the profile and B's state holds no answer.
    const setting = ev('setting', 1, { key: 'boardTab', value: 'build', words: 'Board opens on: build', because: 'you asked for it' });
    const line = confirmLine(setting);
    const card = ev('card', 2, cardData(`What this is: a setting.\n${line}`, { kind: 'confirm', options: ['Confirm', 'Not now', 'Explain more', 'Keep as is'], line }));
    const confirmation = conf(3, setting);
    assert.deepEqual(build([card]).waiting.map((c) => c.id), [card.id]);
    const closed = build([card], { profile: [setting, confirmation] });
    assert.deepEqual(closed.waiting, []);
    // The project's own settings, levels and unconfirmed stay its own.
    assert.deepEqual(closed.settings, {});
    assert.deepEqual(closed.unconfirmed, []);
    // A confirmation the enrolled keys don't verify, or one of another event, closes nothing.
    const stranger = { ...confirmation, id: 'stranger', sig: { ...confirmation.sig, computer: 'ffffffff' } };
    assert.deepEqual(build([card], { profile: [setting, stranger] }).waiting.map((c) => c.id), [card.id]);
    const other = ev('setting', 1, { key: 'briefing', value: 'short', words: 'Briefing: short' });
    assert.deepEqual(build([card], { profile: [setting, other, conf(3, other)] }).waiting.map((c) => c.id), [card.id]);

    // writeViews reads the profile's events, so the views on disk agree; the profile's own views
    // are built from the profile alone.
    const keep = (event, dir) => {
      const file = path.join(dir, eventPath(event));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(event));
    };
    keep(card, stateDir('o__b'));
    assert.deepEqual((await writeViews('o__b', { now })).waiting.map((c) => c.id), [card.id]);
    keep(setting, profileDir());
    keep(confirmation, profileDir());
    assert.deepEqual((await writeViews('o__b', { now })).waiting, []);
    const onDisk = JSON.parse(fs.readFileSync(path.join(home, 'projects', 'o__b', 'views', 'waiting.json'), 'utf8'));
    assert.deepEqual(onDisk, []);
    const own = await writeViews(undefined, { now, dir: profileDir(), out: path.join(home, 'profile-views') });
    assert.equal(own.settings.boardTab.value, 'build');
  });
});

test('a card written before cards carried options closes on any answer but a put-off', async () => {
  await withHome(() => {
    const old = legacyCard('t002', 1, { title: 'Pick a shape' });
    assert.deepEqual(build([old, ev('card-answer', 2, { question: 'Pick a shape', label: 'Not now' })]).waiting.map((c) => c.id), [old.id]);
    assert.deepEqual(build([old, ev('card-answer', 2, { question: 'Pick a shape', label: 'Round' })]).waiting, []);
  });
});

test('the click the merge gate waits for: the latest gate-asks of each pull request, its card, when it was asked and clicked', async () => {
  await withHome(() => {
    const HEAD = 'abcdef1234567890abcdef1234567890abcdef12';
    const MERGE = '1234567890abcdef1234567890abcdef12345678';
    const asks = (n, data) => ev('gate-asks', n, { work: 'export-csv', pr: 7, ...data });
    const approve = asks(1, { ask: 'approval', sha: HEAD });
    const push = asks(2, { pr: 8, ask: 'ci-push', sha: MERGE, branch: 'wh/x' });
    const line = approvalLine(7, HEAD);
    // Nothing yet: the line its card would carry, and no card, asking or click.
    assert.deepEqual(build([approve, push]).gateAsks, {
      7: { id: approve.id, at: approve.at, data: approve.data, line, card: null, askedAt: null, clickedAt: null },
      8: { id: push.id, at: push.at, data: push.data, line: ciPushLine('wh/x', MERGE), card: null, askedAt: null, clickedAt: null },
    });
    // Its card, the latest asked record naming it, and a verified approval of that pull request at that commit.
    const card = ev('card', 3, cardData(`What this is: #7.\n${line}`, { line }));
    const handed = [ev('asked', 4, { cards: [card.id] }), ev('asked', 6, { cards: ['other', card.id] }), ev('asked', 7, { cards: ['other'] })];
    const approval = ev('approval', 8, { pr: 7, commit: HEAD, words: 'Approve', question: 'as shown' });
    const elsewhere = [ev('approval', 9, { pr: 7, commit: MERGE, words: 'Approve', question: 'as shown' }), unsigned(ev('approval', 9, { pr: 7, commit: HEAD, words: 'Approve', question: 'x' }))];
    const seven = build([approve, card, ...handed, approval, ...elsewhere]).gateAsks[7];
    assert.deepEqual([seven.card, seven.askedAt, seven.clickedAt], [card.id, T(6), T(8)]);
    // A CI push is clicked by a verified ci-push action naming its branch and commit.
    const pushed = [click(5, { action: 'ci-push', branch: 'wh/x', sha: MERGE, label: 'Push it' }), click(6, { action: 'ci-push', branch: 'wh/x', sha: MERGE, label: 'Push it' })];
    const others = [click(9, { action: 'ci-push', branch: 'wh/y', sha: MERGE, label: 'Push it' }), unsigned(click(9, { action: 'ci-push', branch: 'wh/x', sha: MERGE, label: 'Push it' }))];
    assert.equal(build([push, ...pushed, ...others]).gateAsks[8].clickedAt, T(6));
    // A later record for the same pull request takes the earlier one's place: the gate waits for one click at a time.
    const later = asks(9, { ask: 'ci-push', sha: MERGE, branch: 'wh/x' });
    assert.deepEqual(build([approve, later]).gateAsks[7].id, later.id);
    assert.deepEqual(build([]).gateAsks, {});
  });
});

// --- a gate card leaves the waiting list once its decision is gone (ruling F107) ---

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const gateAsk = (n, data) => ev('gate-asks', n, { work: 'export-csv', pr: 7, ask: 'approval', sha: A, ...data });
const gateCard = (n, line) => ev('card', n, cardData(`What this is: a click the gate waits for.\n${line}`, { line }));
const reportEv = (n, outcome, extra = {}) => ev('report', n, { work: 'export-csv', outcome, summary: 'Done.', rulings: [], pr: 7, ...extra });
const waitingIds = (events) => build(events).waiting.map((c) => c.id);

test('an approval or CI push card leaves the waiting list once the gate asks about another commit for its pull request and click', async () => {
  await withHome(() => {
    const cardA = gateCard(2, approvalLine(7, A));
    assert.deepEqual(waitingIds([gateAsk(1), cardA]), [cardA.id]);
    // The branch moved on and the gate asks about B: card A no longer waits; card B does once made.
    const cardB = gateCard(4, approvalLine(7, B));
    assert.deepEqual(waitingIds([gateAsk(1), cardA, gateAsk(3, { sha: B })]), []);
    assert.deepEqual(waitingIds([gateAsk(1), cardA, gateAsk(3, { sha: B }), cardB]), [cardB.id]);
    const v = build([gateAsk(1), cardA, gateAsk(3, { sha: B })]);
    assert.equal(v.status.waitingCount, 0);
    // A superseded CI push card leaves the same way.
    const push = (n, sha) => gateAsk(n, { pr: 8, ask: 'ci-push', sha, branch: 'wh/x' });
    const pushCard = gateCard(2, ciPushLine('wh/x', A));
    assert.deepEqual(waitingIds([push(1, A), pushCard]), [pushCard.id]);
    assert.deepEqual(waitingIds([push(1, A), pushCard, push(3, B)]), []);
    // Still current: a later CI push for the same pull request (an approval may carry across a clean
    // update), the gate asking again about the same commit, or another pull request's gate-asks.
    assert.deepEqual(waitingIds([gateAsk(1), cardA, gateAsk(3, { ask: 'ci-push', sha: B, branch: 'wh/x' })]), [cardA.id]);
    assert.deepEqual(waitingIds([gateAsk(1), cardA, gateAsk(3, { pr: 9, sha: B })]), [cardA.id]);
    // An approval card the front desk composed itself (`cli.js card`, for work shown first) leaves
    // once a later gate-asks for that pull request names another commit, and not for one older than it.
    const own = gateCard(5, approvalLine(7, A));
    assert.deepEqual(waitingIds([own]), [own.id]);
    assert.deepEqual(waitingIds([own, gateAsk(6)]), [own.id]);
    assert.deepEqual(waitingIds([gateAsk(3, { sha: B }), own]), [own.id]);
    assert.deepEqual(waitingIds([own, gateAsk(6, { sha: B })]), []);
  });
});

test('an approval or CI push card leaves the waiting list once its work reports merged or closed', async () => {
  await withHome(() => {
    const cardA = gateCard(2, approvalLine(7, A));
    const pushCard = gateCard(3, ciPushLine('wh/x', B));
    const asks = [gateAsk(1), gateAsk(1, { pr: 8, ask: 'ci-push', sha: B, branch: 'wh/x' })];
    const other = ev('card', 4, cardData('Pick a shape', { kind: 'question', options: ['Round', 'Square'] }));
    assert.deepEqual(waitingIds([...asks, cardA, pushCard, other]), [cardA.id, pushCard.id, other.id]);
    for (const outcome of ['merged', 'closed']) {
      const v = build([...asks, cardA, pushCard, other, reportEv(5, outcome)]);
      assert.deepEqual(v.waiting.map((c) => c.id), [other.id], outcome);
      assert.equal(v.status.waitingCount, 1, outcome);
    }
    // A blocked report leaves them waiting, and so does a report from an earlier life of the work:
    // older than the gate's record and naming another pull request.
    assert.deepEqual(waitingIds([...asks, cardA, reportEv(5, 'blocked')]), [cardA.id]);
    assert.deepEqual(waitingIds([reportEv(0, 'closed', { pr: 3 }), ...asks, cardA]), [cardA.id]);
    // An approval card the front desk composed, with no gate-asks: a report naming its pull request.
    const own = gateCard(2, approvalLine(9, A));
    assert.deepEqual(waitingIds([own, reportEv(5, 'merged')]), [own.id]);
    assert.deepEqual(waitingIds([own, reportEv(5, 'merged', { pr: 9 })]), []);
  });
});

test('a gate card put off with Not now, still current, stays waiting and marked asked', async () => {
  await withHome(() => {
    const cardA = gateCard(2, approvalLine(7, A));
    const notNow = ev('card-answer', 3, { card: cardA.id, label: 'Not now' });
    const v = build([gateAsk(1), cardA, notNow, gateAsk(4, { ask: 'ci-push', sha: B, branch: 'wh/x' })]);
    assert.deepEqual(v.waiting.map((c) => [c.id, c.asked]), [[cardA.id, { at: T(3), label: 'Not now' }]]);
  });
});

test('each lineage hold, with the card made for it', async () => {
  await withHome(() => {
    const hold = (n) => ev('lineage-hold', n, { at: T(n), mismatches: [{ upstream: 'superpowers', path: 'skills/a/SKILL.md' }] });
    const [first, second] = [hold(1), hold(2)];
    assert.deepEqual(build([first, second]).lineageHolds, [
      { id: first.id, at: first.at, computer: first.computer, data: first.data, card: null },
      { id: second.id, at: second.at, computer: second.computer, data: second.data, card: null },
    ]);
    const card = ev('card', 3, cardData('What this is: the kits differ.', { kind: 'question', event: first.id }));
    // Answered or not, the card stands for its hold.
    const answered = ev('card-answer', 4, { card: card.id, label: 'Leave it for now' });
    assert.deepEqual(build([first, second, card, answered]).lineageHolds.map((h) => h.card), [card.id, null]);
  });
});

const lineageHold = (n) => ev('lineage-hold', n, { at: T(n), mismatches: [{ upstream: 'superpowers', path: 'LICENSE' }] });
const holdCard = (n, hold) => ev('card', n, cardData('What this is: the kits differ.', { kind: 'question', event: hold.id }));

test('a lift closes the hold cards of the holds it names', async () => {
  await withHome(() => {
    const hold = lineageHold(1);
    const card = holdCard(2, hold);
    assert.deepEqual(build([hold, card]).waiting.map((c) => c.id), [card.id]);
    const v = build([hold, card, ev('lineage-lift', 3, { at: T(3), holds: [hold.id] })]);
    assert.deepEqual(v.waiting, []);
    assert.deepEqual(v.lineageHolds, []);
    assert.equal(v.status.waitingCount, 0);
  });
});

test('a lift leaves the holds it does not name', async () => {
  await withHome(() => {
    const [first, second] = [lineageHold(1), lineageHold(2)];
    const card = holdCard(3, second);
    const v = build([first, second, card, ev('lineage-lift', 4, { at: T(4), holds: [first.id] })]);
    assert.deepEqual(v.waiting.map((c) => c.id), [card.id]);
    assert.deepEqual(v.lineageHolds.map((h) => h.id), [second.id]);
  });
});

test('a hold recorded after the lift stands, though the lift names an earlier hold', async () => {
  await withHome(() => {
    const first = lineageHold(1);
    const lift = ev('lineage-lift', 2, { at: T(2), holds: [first.id] });
    const second = lineageHold(3);
    const card = holdCard(4, second);
    const v = build([first, lift, second, card]);
    assert.deepEqual(v.lineageHolds.map((h) => h.id), [second.id]);
    assert.deepEqual(v.waiting.map((c) => c.id), [card.id]);
  });
});

// --- a steered card stays waiting; a revised card closes the one it revises ---

const choice = { kind: 'question', options: ['Bell', 'Chime', 'Not now'] };

test('a card answered Suggest a change… stays waiting, marked steered at that time', async () => {
  await withHome(() => {
    const card = ev('card', 1, cardData('Which sound?', choice));
    const first = ev('card-answer', 2, { card: card.id, label: SUGGEST });
    const later = ev('card-answer', 5, { card: card.id, label: SUGGEST });
    assert.equal(build([card]).waiting[0].steered, null);
    assert.equal(build([card, first]).waiting[0].steered, T(2));
    // The latest such answer sets the time; a later answer that only puts the card off leaves it.
    const notNow = ev('card-answer', 6, { card: card.id, label: 'Not now' });
    const v = build([card, first, later, notNow]);
    assert.deepEqual(v.waiting.map((c) => [c.id, c.steered, c.asked]), [[card.id, T(5), { at: T(6), label: 'Not now' }]]);
    // Why? is not a steer.
    assert.equal(build([card, ev('card-answer', 3, { card: card.id, label: WHY })]).waiting[0].steered, null);
    // A press answered before a card was made is not about that card, though it quotes the same question.
    const quoted = ev('card-answer', 2, { question: 'Which sound?', label: SUGGEST });
    const sameQuestion = ev('card', 3, cardData('Which sound?', choice));
    assert.deepEqual(build([card, quoted, sameQuestion]).waiting.map((c) => [c.id, c.steered]), [[card.id, T(2)], [sameQuestion.id, null]]);
    // A real answer still decides the card.
    assert.deepEqual(waitingIds([card, first, ev('card-answer', 7, { card: card.id, label: 'Bell' })]), []);
  });
});

test('a revised card closes the card it revises', async () => {
  await withHome(() => {
    const old = ev('card', 1, cardData('Which sound?', choice));
    const revised = ev('card', 3, cardData('Which sound, quieter?', { ...choice, revises: old.id }));
    assert.deepEqual(waitingIds([old, revised]), [revised.id]);
    assert.equal(build([old, revised]).status.waitingCount, 1);
    // Whatever answer the old one had.
    const steered = ev('card-answer', 2, { card: old.id, label: SUGGEST });
    assert.deepEqual(waitingIds([old, steered, revised]), [revised.id]);
    // Until the revised card is in the state, the old one waits.
    assert.deepEqual(waitingIds([old, steered]), [old.id]);
    // A chain closes each card with the next.
    const again = ev('card', 5, cardData('Which sound, quietest?', { ...choice, revises: revised.id }));
    assert.deepEqual(waitingIds([old, revised, again]), [again.id]);
    // A card closes only a card older than it.
    const early = ev('card', 0, cardData('Which sound, first?', { ...choice, revises: old.id }));
    assert.deepEqual(waitingIds([old, early]), [early.id, old.id]);
  });
});

test('a revision of another kind or another pull request closes nothing', async () => {
  await withHome(() => {
    const old = gateCard(1, approvalLine(7, A));
    const revise = (line, extra = {}) => ev('card', 2, cardData(`What this is: a click the gate waits for.\n${line}`, { line, revises: old.id, ...extra }));
    // The same pull request at another commit closes it.
    const same = revise(approvalLine(7, B));
    assert.deepEqual(waitingIds([old, same]), [same.id]);
    // Another pull request closes nothing.
    const otherPr = revise(approvalLine(8, B));
    assert.deepEqual(waitingIds([old, otherPr]), [old.id, otherPr.id]);
    // Another kind closes nothing, though its line is the same pull request's.
    const otherKind = revise(approvalLine(7, B), { kind: 'question', options: ['Approve', 'Not now'] });
    assert.deepEqual(waitingIds([old, otherKind]), [old.id, otherKind.id]);
    // A card naming a card that is not there closes nothing.
    const nobody = revise(approvalLine(7, B), { revises: 'nobody' });
    assert.deepEqual(waitingIds([old, nobody]), [old.id, nobody.id]);
    // An approval card revised by one with no line to compare closes nothing.
    const noLine = ev('card', 2, cardData('Put it live?', { line: null, revises: old.id }));
    assert.deepEqual(waitingIds([old, noLine]), [old.id, noLine.id]);
    // A CI push card is closed by one for the same branch, not by one for another branch.
    const pushCard = (n, line, extra = {}) => ev('card', n, cardData(`What this is: a click.\n${line}`, { kind: 'ci-push', line, ...extra }));
    const first = pushCard(1, ciPushLine('wh/x', A));
    const sameBranch = pushCard(2, ciPushLine('wh/x', B), { revises: first.id });
    const otherBranch = pushCard(2, ciPushLine('wh/y', B), { revises: first.id });
    assert.deepEqual(waitingIds([first, sameBranch]), [sameBranch.id]);
    assert.deepEqual(waitingIds([first, otherBranch]), [first.id, otherBranch.id]);
  });
});

test('an approval card closed by a later head is listed as outdated, and its revision takes the place of the gate\'s card at its own head', async () => {
  await withHome(() => {
    const old = gateCard(2, approvalLine(7, A));
    const steered = ev('card-answer', 3, { card: old.id, label: SUGGEST });
    const moved = gateAsk(4, { sha: B });
    const plain = gateCard(5, approvalLine(7, B));
    const line = approvalLine(7, B);
    const revised = ev('card', 6, cardData(`What this is: a click the gate waits for.\n${line}`, { line, revises: old.id }));
    // The head moved: the old card no longer waits, and is listed as closed by a later head.
    const before = build([gateAsk(1), old, steered, moved, plain]);
    assert.deepEqual(before.waiting.map((c) => c.id), [plain.id]);
    assert.deepEqual(before.outdated.map((c) => c.id), [old.id]);
    assert.equal(before.outdated[0].data.line, approvalLine(7, A));
    // The revision at the head the gate asks about takes the place of the gate's card for it: one card waits.
    const after = build([gateAsk(1), old, steered, moved, plain, revised]);
    assert.deepEqual(after.waiting.map((c) => c.id), [revised.id]);
    assert.equal(after.status.waitingCount, 1);
    // A revised card made before the gate's card for its head leaves the gate's card nothing to make.
    assert.equal(build([gateAsk(1), old, moved, revised]).gateAsks['7'].card, revised.id);
    // A plain card with the same line does not replace another; a revision of another pull request takes no place.
    assert.equal(waitingIds([gateAsk(1), old, moved, plain, gateCard(6, line)]).length, 2);
    const elsewhere = ev('card', 6, cardData(`What this is: a click.\n${approvalLine(8, B)}`, { line: approvalLine(8, B), revises: old.id }));
    assert.deepEqual(waitingIds([gateAsk(1), old, moved, plain, elsewhere]), [plain.id, elsewhere.id]);
    // A card closed because its work finished, decided, or revised already is not listed as outdated.
    assert.deepEqual(build([gateAsk(1), old, moved, reportEv(7, 'merged')]).outdated, []);
    assert.deepEqual(build([gateAsk(1), old, ev('card-answer', 3, { card: old.id, label: 'Not now' }), moved]).outdated.map((c) => c.id), [old.id]);
    assert.deepEqual(build([gateAsk(1), old, moved, revised]).outdated, []);
    // A card that still waits is not outdated.
    assert.deepEqual(build([gateAsk(1), old]).outdated, []);
  });
});

test('a revised approval card has its own set line, so an approval of the old commit does not decide it', async () => {
  await withHome(() => {
    const old = gateCard(1, approvalLine(7, A));
    const line = approvalLine(7, B);
    const revised = ev('card', 3, cardData(`What this is: a click the gate waits for.\n${line}`, { line, revises: old.id }));
    // A verified approval of the old commit carries the old card's question: it decides the old card only.
    const approvedOld = ev('approval', 2, { pr: 7, commit: A.slice(0, 12), question: old.data.question });
    assert.deepEqual(waitingIds([old, approvedOld]), []);
    assert.deepEqual(waitingIds([old, approvedOld, revised]), [revised.id]);
    // The same click made after the revised card is not a click on it.
    const late = ev('approval', 4, { pr: 7, commit: A.slice(0, 12), question: old.data.question });
    assert.deepEqual(waitingIds([old, revised, late]), [revised.id]);
    // An approval carrying the revised card's own question decides it.
    const approvedNew = ev('approval', 5, { pr: 7, commit: B.slice(0, 12), question: revised.data.question });
    assert.deepEqual(waitingIds([old, revised, late, approvedNew]), []);
  });
});

test('the survey view is the latest survey, or null when none was taken', async () => {
  await withHome(() => {
    const survey = (n, hostReached) => ev('survey', n, {
      v: 1, hostReached, requests: [], pushed: [], local: [], more: { pushed: false, local: false },
      instructions: { files: [], sections: [] }, scheduled: 0, secrets: n, rules: [],
    });
    assert.equal(build([]).survey, null);
    const [first, second] = [survey(1, false), survey(2, true)];
    assert.deepEqual(build([second, first]).survey, { id: second.id, at: second.at, data: second.data });
  });
});

test('the columnsReady view keeps the latest column-ready record of each column', async () => {
  await withHome(() => {
    const ready = (n, column, pins) => ev('column-ready', n, { column, pins, records: [`run-${n}`] });
    assert.deepEqual(build([]).columnsReady, {});
    const first = ready(1, 'lean', { mostCapable: 'model-top', midSized: 'model-mid' });
    const second = ready(2, 'lean', { mostCapable: 'model-top', midSized: 'model-mid-2' });
    const light = ready(3, 'lightest', { mostCapable: 'model-top', midSized: 'model-mid' });
    const view = build([second, light, first]).columnsReady;
    assert.deepEqual(Object.keys(view).sort(), ['lean', 'lightest']);
    assert.deepEqual(view.lean, { id: second.id, at: second.at, pins: second.data.pins, records: ['run-2'] });
  });
});

test('the usageCards view lists the usage cards offered, oldest first, signed by an enrolled computer', async () => {
  await withHome(() => {
    assert.deepEqual(build([]).usageCards, []);
    const data = (card, from, to) => ({ card, at: '2026-10-26T01:00:00.000Z', reset: '2026-10-28T22:00:00.000Z', from, to, hash: 'ab'.repeat(32) });
    const first = ev('usage-card', 1, data('nudge', 'balanced', 'lean'));
    const second = ev('usage-card', 2, data('lightest', 'lean', 'lightest'));
    assert.deepEqual(build([second, first]).usageCards, [{ id: first.id, ...first.data }, { id: second.id, ...second.data }]);
    // An offer no enrolled key signed is no offer.
    const { sig, ...unsigned } = first;
    assert.deepEqual(build([unsigned, { ...second, data: { ...second.data, to: 'lean', card: 'nudge', from: 'balanced' } }]).usageCards, []);
  });
});

test('readyColumns counts a column only while the configuration holds the pins it ran on', () => {
  const pins = { mostCapable: 'model-top', midSized: 'model-mid', premium: 'model-premium' };
  const config = { tiers: { pins } };
  const view = {
    lean: { pins: { mostCapable: 'model-top', midSized: 'model-mid' } },
    lightest: { pins: { mostCapable: 'model-top', midSized: 'model-old' } },
    premium: { pins: { mostCapable: 'model-top', premium: 'model-premium' } },
  };
  assert.deepEqual(readyColumns(view, config), ['lean', 'premium']);
  // A pin moved since: its column waits for a new evaluation.
  assert.deepEqual(readyColumns(view, { tiers: { pins: { ...pins, midSized: 'model-mid-2' } } }), ['premium']);
  assert.deepEqual(readyColumns(view, { tiers: { pins: { ...pins, mostCapable: 'model-top-2' } } }), []);
  // The premium column needs a premium pin now.
  assert.deepEqual(readyColumns(view, { tiers: { pins: { ...pins, premium: null } } }), ['lean']);
  // A pin that stands for no model in both still matches: the column ran on it as it is.
  assert.deepEqual(readyColumns({ lean: { pins: { mostCapable: 'model-top', midSized: null } } }, { tiers: { pins: { mostCapable: 'model-top' } } }), ['lean']);
  // No pins, no view, or a view that can't be read: nothing is ready.
  for (const [v, c] of [[view, {}], [view, null], [view, { routing: {} }], [null, config], ['lean', config], [{ lean: 'yes' }, config], [{ lean: { pins: null } }, config]]) {
    assert.deepEqual(readyColumns(v, c), [], JSON.stringify([v, c]));
  }
});

// ---- A ruling confirmed by a click in the chat at Lean (ruling P5-52) ----

test('at Lean a ruling confirmed by a chat click the record names is in force; elsewhere it is not', () => {
  const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
  const at = (n) => () => new Date(Date.UTC(2026, 9, 23, 1, 0, n));
  const words = 'Every export is a CSV file, never Excel.';
  const ruling = makeEvent({ kind: 'ruling', data: { words }, now: at(1) });
  const question = `What this is: A rule you gave, in your words: "${words}"\nConfirm it?`;
  const card = makeEvent({ kind: 'card', data: { question, header: 'Confirm', options: ['Confirm', 'Not now'], kind: 'confirm', level: 3, line: confirmLine(ruling) }, now: at(2) });
  const answer = (data, n = 3) => makeEvent({ kind: 'card-answer', data: { card: card.id, label: 'Confirm', hash: sha(question), proof: 'chat-click', tier: 'lean', ...data }, now: at(n) });
  const status = (events, options) => buildViews(events, [], options).rulebook.map((r) => [r.status, r.proof ?? null]);
  const waiting = (events, options) => buildViews(events, [], options).waiting.map((c) => c.id);

  const good = [ruling, card, answer({})];
  assert.deepEqual(status(good, { lean: true }), [['accepted', 'chat-click']]);
  assert.deepEqual(waiting(good, { lean: true }), []);
  assert.deepEqual(buildViews(good, [], { lean: true }).unconfirmed, []);
  // A Claude Code project's rulebook still counts only a signed confirmation.
  assert.deepEqual(status(good), [['proposed', null]]);
  assert.deepEqual(buildViews(good, []).unconfirmed.map((u) => u.id), [ruling.id]);

  // Nothing else counts, at Lean either: the answer must name the card by its id and the card's text by its hash.
  const others = [
    answer({ hash: sha('another text') }),
    answer({ card: ruling.id }),
    answer({ proof: undefined }),
    answer({ tier: undefined }),
    answer({ label: 'Not now' }),
    answer({}, 0),
  ];
  for (const other of others) {
    assert.deepEqual(status([ruling, card, other], { lean: true }), [['proposed', null]], JSON.stringify(other.data));
  }
  // A wrong hash doesn't answer the card at all.
  assert.deepEqual(waiting([ruling, card, others[0]], { lean: true }), [card.id]);
  // A card whose line names other words, or another ruling, confirms nothing.
  const otherLine = makeEvent({ kind: 'card', data: { ...card.data, line: `Confirm ruling ${ruling.id}: "Exports are Excel."` }, now: at(2) });
  const otherAnswer = makeEvent({ kind: 'card-answer', data: { card: otherLine.id, label: 'Confirm', hash: sha(question), proof: 'chat-click', tier: 'lean' }, now: at(3) });
  assert.deepEqual(status([ruling, otherLine, otherAnswer], { lean: true }), [['proposed', null]]);
});

// ---- At Lean, the newest words of a ruling stand, and a ruling's card closes once (ruling P5-53) ----

const leanSha = (text) => crypto.createHash('sha256').update(text).digest('hex');
// A ruling under a short name, its confirm card and the director's chat click on it, at times n, n+1 and n+2.
function leanRuling(n, words, card, { label = 'Confirm', click = true } = {}) {
  const ruling = ev('ruling', n, { words, ...(card === undefined ? {} : { card }) });
  const question = `A rule you gave, in your words: "${words}"`;
  const confirmCard = ev('card', n + 1, { question, header: 'Confirm', options: ['Confirm', 'Suggest a change…', 'Show me', 'Not now'], kind: 'confirm', level: 3, line: confirmLine(ruling) });
  const answer = ev('card-answer', n + 2, { card: confirmCard.id, label, hash: leanSha(question), proof: 'chat-click', tier: 'lean' });
  return { ruling, card: confirmCard, answer, events: click ? [ruling, confirmCard, answer] : [ruling, confirmCard] };
}

test('at Lean a later ruling under the same short name, once confirmed, replaces the earlier one', async () => {
  await withHome(() => {
    const first = leanRuling(1, 'Exports are CSV.', 'exports');
    const second = leanRuling(10, 'Exports are CSV or Excel, as the director picks.', 'exports');
    const rulebook = (events, options = { lean: true }) => build(events, options).rulebook.map((r) => [r.words, r.status]);
    assert.deepEqual(rulebook([...first.events, ...second.events]), [['Exports are CSV.', 'superseded'], ['Exports are CSV or Excel, as the director picks.', 'accepted']]);
    // Until the new words are confirmed, the old ones stand.
    const waiting = leanRuling(10, 'Exports are Excel.', 'exports', { click: false });
    assert.deepEqual(rulebook([...first.events, ...waiting.events]), [['Exports are CSV.', 'accepted'], ['Exports are Excel.', 'proposed']]);
    // Another short name, or none, replaces nothing.
    const other = leanRuling(10, 'Totals are to the cent.', 'totals');
    const unnamed = leanRuling(20, 'Dates read 23 October 2026.');
    assert.deepEqual(rulebook([...first.events, ...other.events, ...unnamed.events]).map((r) => r[1]), ['accepted', 'accepted', 'accepted']);
    // A Claude Code project's signed rulings are as before: a short name in the data replaces nothing.
    const a = ev('ruling', 1, { words: 'one', card: 'same' });
    const b = ev('ruling', 3, { words: 'two', card: 'same' });
    assert.deepEqual(build([a, conf(2, a), b, conf(4, b)]).rulebook.map((r) => r.status), ['accepted', 'accepted']);
  });
});

test('at Lean a ruling\'s card closes on its first chat click, whatever it is, and only a first Confirm confirms', async () => {
  await withHome(() => {
    for (const label of ['Not now', 'Suggest a change…']) {
      const r = leanRuling(1, 'Exports are CSV.', 'exports', { label });
      const v = build(r.events, { lean: true });
      assert.deepEqual(v.waiting.map((c) => c.id), [], label);
      assert.equal(v.rulebook[0].status, 'proposed', label);
      // A Confirm after it confirms nothing.
      const late = ev('card-answer', 9, { ...r.answer.data, label: 'Confirm' });
      assert.equal(build([...r.events, late], { lean: true }).rulebook[0].status, 'proposed', label);
      // Not now leaves a Claude Code card waiting, as it always has.
      if (label === 'Not now') assert.deepEqual(build(r.events).waiting.map((c) => c.id), [r.card.id]);
    }
  });
});

test('views gather runs by work, latest state last', async () => {
  await withHome(() => {
    const run = (n, work, state, extra = {}) => ev('run', n, { work, lane: 'quick', engine: 'archon', runId: `r-${work}`, state, ...extra });
    const events = [
      run(1, 'login', 'started'), run(2, 'search', 'started'), run(3, 'login', 'paused'), run(4, 'login', 'ended', { outcome: 'merged' }),
      ev('ask', 5, { id: 'a-1', runId: 'r-login', work: 'login', kind: 'blocked', level: 3, options: [] }),
      ev('cost', 6, { runId: 'r-login', work: 'login', tokens: 10, dollars: null, premiumRequests: null, minutes: 1, source: 'unknown', byRole: {} }),
      ev('preview', 7, { work: 'login', head: 'a'.repeat(40), folder: '/p', pages: [] }),
      ev('lesson', 8, { work: 'login', text: 'Lock first' }),
    ];
    const views = build(events);
    assert.deepEqual(Object.keys(views.runs).sort(), ['login', 'search']);
    assert.deepEqual(views.runs.login.map((r) => r.data.state), ['started', 'paused', 'ended']);
    assert.equal(views.runs.login.at(-1).data.outcome, 'merged');
    assert.equal(views.runs.search.length, 1);
    assert.equal(views.asks.login.length, 1);
    assert.equal(views.costs.login[0].data.dollars, null);
    assert.equal(views.previews.login.at(-1).data.head, 'a'.repeat(40));
    assert.equal(views.lessons.login[0].data.text, 'Lock first');
    assert.deepEqual(build([]).runs, {});
  });
});

const sealed = (card, extra = {}) => ({ line: 'seal', card, work: 'w', head: null, signed: null, reader: true, candidates: { land: null }, exclusions: { hit: ['data-model'], unread: [] }, stamp: { models: null, pack: null, rule: null, exclusions: null }, at: T(1), hash: 'a'.repeat(64), ...extra });

test('a rule is in the views only once a signed click confirms it', async () => {
  await withHome(async () => {
    const rule = composeRule({ answer: { label: 'Keep' }, card: { kind: 'question', level: 3, options: ['Keep', 'Remove'] }, facts: { readable: true, paths: ['a.js'], depsChanged: false, schemaChanged: false, guardrail: false, secrets: false, critical: false }, lane: 'small', project: 'p', now: at(1) });
    const event = ev('rule', 1, rule);
    assert.deepEqual(build([]).rules, {});
    assert.deepEqual(build([event]).rules, {});
    const click = makeEvent({ ...confirmationFor(event), now: at(2) });
    assert.deepEqual(build([event, click]).rules, { [rule.id]: { rule, stage: 0, signedAt: T(2) } });
  });
});

test('shadow isn\'t in the views an agent reads', async () => {
  await withHome(async () => {
    const views = build([ev('shadow', 1, sealed('q-1'))]);
    assert.deepEqual(views.evidence, { sealed: 1, read: 0, sampled: 0 });
    assert.ok(!JSON.stringify(views).includes('data-model'));
    assert.ok(!JSON.stringify(views).includes('candidates'));
  });
});

test('the evidence view shows volume, and no match, miss or direction', async () => {
  await withHome(async () => {
    const score = { line: 'score', card: 'q-1', work: 'w', seal: 'a'.repeat(64), score: 'miss', at: T(2), hash: 'b'.repeat(64) };
    const { evidence } = build([ev('shadow', 1, sealed('q-1')), ev('shadow', 2, score)]);
    assert.deepEqual(Object.keys(evidence).sort(), ['read', 'sampled', 'sealed']);
    assert.deepEqual(evidence, { sealed: 1, read: 0, sampled: 0 });
    assert.ok(!JSON.stringify(build([ev('shadow', 2, score)])).includes('miss'));
  });
});

test('the evidence view counts a card once, and only a seal this computer can verify', async () => {
  await withHome(async () => {
    const one = ev('shadow', 1, sealed('q-1'));
    const unsigned = { ...ev('shadow', 2, sealed('q-2')), sig: undefined };
    assert.equal(build([one, ev('shadow', 2, sealed('q-1')), unsigned]).evidence.sealed, 1);
    assert.equal(build([]).evidence.sealed, 0);
  });
});

test('a card counts as read only with a reading, not a reader that gave none', async () => {
  await withHome(async () => {
    const line = (card, reader) => ev('shadow', 2, { ...readingOf({ card, work: 'w', why: 'no-start', at: T(1), ...(reader ? { reading: { frame: 'sound', why: 'It fits.', kind: 'can-see', fits: 'no-rule', pick: 'Keep', tags: [] } } : {}) }) });
    const views = build([ev('shadow', 1, sealed('q-1')), line('q-1', true), line('q-2', false)]);
    assert.equal(views.evidence.read, 1);
  });
});

const LEAD = 'q-lead-500001';
const JOIN = 'q-other-500001';
const asked = (n, data = {}) => ev('question', n, {
  id: LEAD, work: 'lead', what: 'Which page?', why: 'It changes it', options: [{ label: 'First', says: 'One' }, { label: 'Last', says: 'Two' }], recommendation: 'First', level: 3, ...data,
});
const joiner = (n, data = {}) => asked(n, { id: JOIN, work: 'other', what: 'which page', joins: LEAD, options: [{ label: 'first', says: 'One' }, { label: 'LAST', says: 'Two' }], recommendation: 'first', ...data });
const answerCard = (n, words, joiners) => ev('card', n, { question: words, header: 'Question', options: ['First', 'Last'], kind: 'answer', level: 3, line: `Answer question ${LEAD}`, ...(joiners ? { joiners } : {}) });
const clickedOn = (n, words, label = 'Last') => click(n, { action: 'answer', question: words, questionId: LEAD, questionHash: dataHash(asked(1).data), label });

test('a joiner on the card answered takes its lead\'s answer, in its own label', async () => {
  await withHome(() => {
    const got = build([asked(1), joiner(2), answerCard(3, 'lead and other', [JOIN]), clickedOn(4, 'lead and other')]).questions;
    assert.equal(got[LEAD].answer.label, 'Last');
    assert.equal(got[JOIN].answer.label, 'LAST');
    assert.equal(got[JOIN].answer.joined, LEAD);
  });
});

test('a click covers only what its card showed', async () => {
  await withHome(() => {
    const got = build([asked(1), answerCard(2, 'one'), joiner(3), answerCard(4, 'lead and other', [JOIN]), clickedOn(5, 'one')]).questions;
    assert.equal(got[LEAD].answer.label, 'Last');
    assert.equal(got[JOIN].answer, null);
    assert.deepEqual(got[JOIN].saidBefore.label, 'LAST');
    assert.equal(got[JOIN].joins, undefined, 'it is a question of its own again');
  });
});

const closeLead = (n) => asked(n, { work: 'lead' });
const closeOne = (n, data = {}) => asked(n, { id: 'q-lead-500002', what: 'Which page goes first?', ...data });
const CLOSE = 'q-lead-500002';
const matched = (n, data = {}) => ev('match', n, { card: CLOSE, work: 'lead', joins: LEAD, ...data });

test('a close match stands a card behind its lead, and a click on a card that listed it answers both', async () => {
  await withHome(() => {
    const open = build([closeLead(1), closeOne(2), matched(3)]);
    assert.equal(open.questions[CLOSE].joins, LEAD);
    assert.equal(open.questions[CLOSE].answer, null, 'a match answers nothing');
    const got = build([closeLead(1), closeOne(2), matched(3), answerCard(4, 'lead', [CLOSE]), clickedOn(5, 'lead')]).questions;
    assert.equal(got[CLOSE].answer.label, 'Last');
    assert.equal(got[CLOSE].answer.joined, LEAD);
  });
});

test('a close match is taken only as this computer signed it, on the same piece and options at level 3', async () => {
  await withHome(() => {
    const cases = [
      [closeOne(2, { options: [{ label: 'First', says: 'One' }, { label: 'Other', says: 'Two' }], recommendation: 'First' }), matched(3)],
      [closeOne(2, { level: 4, checks: 'None.' }), matched(3)],
    ];
    for (const [card, match] of cases) assert.equal(build([closeLead(1), card, match]).questions[CLOSE].joins, undefined);
    const elsewhere = 'q-other-500002';
    assert.equal(build([closeLead(1), closeOne(2, { id: elsewhere, work: 'other' }), matched(3, { card: elsewhere, work: 'other' })]).questions[elsewhere].joins, undefined);
    const { sig, ...unsigned } = matched(3);
    assert.ok(sig);
    assert.equal(build([closeLead(1), closeOne(2), unsigned]).questions[CLOSE].joins, undefined);
  });
});

test('a click on a card that never listed a close match leaves it open, with what was said', async () => {
  await withHome(() => {
    const got = build([closeLead(1), answerCard(2, 'lead'), closeOne(3), matched(4), clickedOn(5, 'lead')]).questions;
    assert.equal(got[CLOSE].answer, null);
    assert.equal(got[CLOSE].saidBefore.label, 'Last');
    assert.equal(got[CLOSE].joins, undefined);
  });
});

test('a card of its own leaves the waiting list while its question stands behind another', async () => {
  await withHome(() => {
    const own = ev('card', 3, { question: 'close', header: 'Question', options: ['First', 'Last'], kind: 'answer', level: 3, line: `Answer question ${CLOSE}` });
    assert.equal(build([closeLead(1), closeOne(2), own]).waiting.length, 1);
    assert.equal(build([closeLead(1), closeOne(2), own, matched(4)]).waiting.length, 0);
  });
});

test('a close match on an answered card gives the line, while that answer stands', async () => {
  await withHome(() => {
    const line = { card: CLOSE, work: 'lead', saidBefore: 'Last', from: LEAD };
    const said = ev('match', 5, line);
    const got = build([closeLead(1), answerCard(2, 'lead'), clickedOn(3, 'lead'), closeOne(4), said]).questions;
    assert.equal(got[CLOSE].saidBefore.label, 'Last');
    assert.equal(got[CLOSE].answer, null);
    const other = ev('match', 5, { ...line, saidBefore: 'First' });
    assert.equal(build([closeLead(1), answerCard(2, 'lead'), clickedOn(3, 'lead'), closeOne(4), other]).questions[CLOSE].saidBefore, undefined);
  });
});

test('a question recorded with what was said before says it in the view', async () => {
  await withHome(() => {
    const KEY = 'a'.repeat(64);
    const SECOND = 'q-lead-500002';
    const first = asked(1, { key: KEY });
    const answer = (n, label) => click(n, { action: 'answer', question: 'one', questionId: LEAD, questionHash: dataHash(first.data), label });
    const repeat = (n, data = {}) => asked(n, { id: SECOND, key: KEY, saidBefore: 'First', ...data });
    assert.equal(build([first, answer(2, 'First'), repeat(3)]).questions[SECOND].saidBefore.label, 'First');
    assert.equal(build([asked(1)]).questions[LEAD].saidBefore, undefined);
    assert.equal(build([first, repeat(3)]).questions[SECOND].saidBefore, undefined, 'no answer stands behind it');
    assert.equal(build([first, answer(2, 'Last'), repeat(3)]).questions[SECOND].saidBefore, undefined, 'not what the director said');
    assert.equal(build([first, answer(2, 'First'), repeat(3, { key: 'b'.repeat(64) })]).questions[SECOND].saidBefore, undefined, 'another decision');
    assert.equal(build([first, answer(2, 'Last'), answer(3, 'First'), repeat(4)]).questions[SECOND].saidBefore, undefined, 'an answer changed since');
  });
});

test('an answer the director changed says so', async () => {
  await withHome(() => {
    const again = (n, label) => click(n, { action: 'answer', question: 'one', questionId: LEAD, questionHash: dataHash(asked(1).data), label });
    assert.equal(build([asked(1), again(2, 'First')]).questions[LEAD].answer.changed, undefined);
    assert.equal(build([asked(1), again(2, 'First'), again(3, 'First')]).questions[LEAD].answer.changed, undefined);
    const got = build([asked(1), again(2, 'First'), again(3, 'Last')]).questions[LEAD].answer;
    assert.equal(got.label, 'Last');
    assert.equal(got.changed, true);
  });
});

test('a steer on a question\'s card shows on the question, by a click or in the chat', async () => {
  await withHome(() => {
    const card = answerCard(2, 'one');
    assert.equal(build([asked(1), card]).questions[LEAD].steered, undefined);
    const chat = ev('chat-steer', 3, { card: card.id });
    assert.equal(build([asked(1), card, chat]).questions[LEAD].steered, chat.at);
    const clicked = ev('card-answer', 3, { card: card.id, label: 'Suggest a change…' });
    assert.equal(build([asked(1), card, clicked]).questions[LEAD].steered, clicked.at);
  });
});

test('a joiner open behind an open lead says whom it joins', async () => {
  await withHome(() => {
    assert.equal(build([asked(1), joiner(2)]).questions[JOIN].joins, LEAD);
  });
});

test('a question naming a lead it isn\'t alike takes nothing from it', async () => {
  await withHome(() => {
    for (const data of [{ what: 'Something else' }, { options: [{ label: 'Other', says: 'x' }, { label: 'Last', says: 'y' }] }]) {
      const got = build([asked(1), joiner(2, data), answerCard(3, 'both', [JOIN]), clickedOn(4, 'both')]).questions[JOIN];
      assert.equal(got.answer, null);
      assert.equal(got.joins, undefined);
    }
  });
});

test('a lead at level 4 lends no answer, whatever a joiner says', async () => {
  await withHome(() => {
    const hash = dataHash(asked(1, { level: 4 }).data);
    const events = [asked(1, { level: 4 }), joiner(2), answerCard(3, 'both', [JOIN]), click(4, { action: 'answer', question: 'both', questionId: LEAD, questionHash: hash, label: 'Last' })];
    assert.equal(build(events).questions[JOIN].answer, null);
  });
});

test('a joiner\'s own click stands, and a joiner of a joiner joins nothing', async () => {
  await withHome(() => {
    const third = asked(3, { id: 'q-third-500001', work: 'third', joins: JOIN });
    const got = build([asked(1), joiner(2), third]).questions;
    assert.equal(got['q-third-500001'].joins, undefined);
  });
});

test('a card written after the click widens nothing', async () => {
  await withHome(() => {
    const got = build([asked(1), joiner(2), answerCard(3, 'other'), clickedOn(4, 'other'), answerCard(5, 'other', [JOIN])]).questions[JOIN];
    assert.equal(got.answer, null);
    assert.equal(got.saidBefore.label, 'LAST');
  });
});

test('a card must name the piece in the words the click signed', async () => {
  await withHome(() => {
    const got = build([asked(1), joiner(2), answerCard(3, 'just the one', [JOIN]), clickedOn(4, 'just the one')]).questions[JOIN];
    assert.equal(got.answer, null);
  });
});

test('a joiner recorded again is a question of its own', async () => {
  await withHome(() => {
    const words = 'lead and other';
    const got = build([asked(1), joiner(2), joiner(3, { why: 'Another reason' }), answerCard(4, words, [JOIN]), clickedOn(5, words)]).questions[JOIN];
    assert.equal(got.joins, undefined);
    assert.equal(got.answer, null);
  });
});

test('a signed send-back is listed, and closes its card', async () => {
  await withHome(() => {
    const sha = 'a'.repeat(40);
    const question = `A card.\n${approvalLine(7, sha)}`;
    const card = ev('card', 1, { question, header: 'Approval', options: ['Approve', 'Send it back'], kind: 'approval', level: 3, line: approvalLine(7, sha), code: null, concepts: [] });
    const sent = ev('action', 2, { action: 'send-back', pr: 7, sha, question, label: 'Send it back' });
    const v = build([card, sent]);
    assert.deepEqual(v.sendBacks, [{ id: sent.id, at: sent.at, pr: 7, sha }]);
    assert.equal(v.waiting.some((w) => w.id === card.id), false);
    const forged = { ...sent, sig: { ...sent.sig, value: 'forged' } };
    assert.deepEqual(build([card, forged]).sendBacks, []);
  });
});

test('a plain answer closes only the approval card it came after: the same card raised again at that head waits', async () => {
  await withHome(() => {
    const sha = 'a'.repeat(40);
    const question = `A card.\n${approvalLine(7, sha)}`;
    const data = { question, header: 'Approval', options: ['Approve', 'Send it back'], kind: 'approval', level: 3, line: approvalLine(7, sha), code: null, concepts: [] };
    const first = ev('card', 1, data);
    const answer = ev('card-answer', 2, { question, label: 'Send it back' });
    const sent = ev('action', 3, { action: 'send-back', pr: 7, sha, question, label: 'Send it back' });
    const again = ev('card', 4, data);
    const v = build([first, answer, sent, again]);
    assert.deepEqual(v.waiting.map((w) => w.id), [again.id]);
  });
});

test('the sleeps on the record are in the views, in order', () => {
  const at = (iso) => ({ now: () => new Date(iso) });
  const events = [
    makeEvent({ kind: 'slept', data: { from: '2026-11-01T09:00:00.000Z', to: '2026-11-01T10:00:00.000Z' }, ...at('2026-11-01T10:00:00.000Z') }),
    makeEvent({ kind: 'slept', data: { from: '2026-11-01T01:00:00.000Z', to: '2026-11-01T07:00:00.000Z' }, ...at('2026-11-01T07:00:00.000Z') }),
  ];
  assert.deepEqual(buildViews(events).slept, [
    { from: '2026-11-01T01:00:00.000Z', to: '2026-11-01T07:00:00.000Z' },
    { from: '2026-11-01T09:00:00.000Z', to: '2026-11-01T10:00:00.000Z' },
  ]);
  assert.deepEqual(buildViews([]).slept, []);
});
