// tests/scripts/frontdesk/cli.test.js
// The front desk's one command, against a fake helper that keeps its events in memory and builds
// the views from them as the real one does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main, readInput, RECORD_KINDS, MEANWHILE, CHECKS_UNSAID } from '../../../scripts/frontdesk/cli.js';
import { composeCard } from '../../../scripts/cards/compose.js';
import { buildViews } from '../../../scripts/state/views.js';
import { makeEvent, dataHash, listEvents, PROTECTED_KINDS } from '../../../scripts/state/events.js';
import { cloneState } from '../../../scripts/state/clone.js';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { makeBareRemote } from '../../helpers/git-fixture.js';
import { makeSigningKey, enrol, readEnrolled } from '../../../scripts/state/signing.js';
import { approvalLine, answerLine, confirmLine, LIFT_STOP, setLineOf } from '../../../scripts/state/card-lines.js';
import { setStop, stopState } from '../../../scripts/lib/stop.js';
import { decide as cardCheck } from '../../../scripts/hooks/card-check.js';
import { decide as promptRecord } from '../../../scripts/hooks/prompt-record.js';
import { answerInput } from '../../../scripts/cards/compose.js';
import { plainWords, glossaryOf } from '../../../scripts/frontdesk/glossary.js';
import { boardModel } from '../../../scripts/board/model.js';
import { CARD } from '../../../scripts/lib/front-desk.js';
import { as, shortHome, tempFolder, testAddress } from '../../helpers/homes.js';

const FULL = 'abcdef1234567890abcdef1234567890abcdef12';
const DOC = 'fedcba9876543210'.repeat(4);
const NOW = new Date('2026-10-19T12:00:00.000Z');
const T = (n) => new Date(Date.UTC(2026, 9, 18, 0, 0, n));
const CWD = path.resolve('/projects/shop');
const STOP = { ok: false, refused: 'STOP is on' };
const SCRIPT = fileURLToPath(new URL('../../../scripts/frontdesk/cli.js', import.meta.url));

// A home with an enrolled signing key, for makeEvent and the views.
async function inHome(fn) {
  const home = path.join(tempFolder('wh-frontdesk-'), 'home');
  return as(home, async () => {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    return fn();
  });
}

// The helper as the front desk sees it: every call is kept; writes make the event as /state/write
// does (a signed kind is refused) and the views are built from what is held. Under `stop` (true, or
// a function read on each request) every write is refused and the views say STOP is on, as the
// helper does under STOP.
function fakeHelper({ events = [], stop = false, head = FULL, profile = {} } = {}) {
  const held = [...events];
  const stopped = () => (typeof stop === 'function' ? stop() : stop);
  const calls = [];
  let tick = 100;
  const views = () => buildViews(held, readEnrolled(), { now: () => NOW });
  const writeAs = (kind, data, id) => {
    const made = makeEvent({ kind, data, now: () => T((tick += 1)) });
    const event = id === undefined ? made : { ...made, id };
    held.push(event);
    return { ok: true, id: event.id, pushed: true };
  };
  const client = {
    state: {
      views: async (body) => {
        calls.push(['views', body]);
        return {
          ok: true, views: views(), ...(stopped() ? { stop: true } : {}), ...(body.cards === true ? { cards: held.filter((e) => e.kind === 'card') } : {}),
        };
      },
      write: async (body) => {
        calls.push(['write', body]);
        if (stopped()) return STOP;
        if (PROTECTED_KINDS.includes(body.kind)) return { ok: false, refused: 'a signed kind is recorded through /state/record, never written here' };
        return writeAs(body.kind, body.data, body.id);
      },
    },
    profile: {
      write: async (body) => {
        calls.push(['profile.write', body]);
        return stopped() ? STOP : { ok: true, id: 'p-1', pushed: true };
      },
      views: async (body) => {
        calls.push(['profile.views', body]);
        return { ok: true, views: { settings: profile } };
      },
    },
    prState: async (body) => {
      calls.push(['prState', body]);
      return { ok: true, result: { headSha: head, state: 'open', mergeable: 'clean' } };
    },
  };
  return { client, calls, held, writes: () => calls.filter(([name]) => name === 'write').map(([, body]) => body) };
}

// Runs one command; resolves with { code, out, err, json }.
async function run(helper, argv, input) {
  let out = '';
  let err = '';
  const code = await main(argv, {
    cwd: CWD, client: helper.client, input, now: () => NOW, out: (t) => { out += t; }, err: (t) => { err += t; },
  });
  let json;
  try { json = JSON.parse(out); } catch { json = undefined; }
  return { code, out, err, json };
}

const says = (label) => ({ label, says: `It ${label.toLowerCase()}s and goes ahead.` });
const PRODUCT = (n) => ({
  kind: 'question', level: 2, what: `Which name suits page ${n}?`, why: 'It is the wording users see.',
  options: [says('Plain'), says('Playful')], recommend: 'Plain', because: 'it reads quickest', meanwhile: 'The page keeps its old name.',
});
const APPROVAL = {
  kind: 'approval', level: 3, what: 'Pull request #7 changes the wording on the sign-in page.', why: 'It changes what users see.',
  options: [says('Approve')], recommend: 'Approve', because: 'the checks passed', meanwhile: 'Nothing is released.',
};
const cardEvent = (input, n) => makeEvent({ kind: 'card', data: composeCard(input).card, now: () => T(n) });
const QUESTION = {
  id: 'q-export-csv-1', work: 'export-csv', what: 'The export needs to know which separator to use.', why: 'It changes the file people download.',
  options: [{ label: 'Comma', says: 'Commas between values; opens in any spreadsheet.' }, { label: 'Tab', says: 'Tabs between values.' }],
  recommendation: 'Tab', level: 2,
};
const questionEvent = (data = QUESTION, n = 5) => makeEvent({ kind: 'question', data, now: () => T(n) });

test('cards gives at most four questions and says how many are left', async () => {
  await inHome(async () => {
    const six = [1, 2, 3, 4, 5, 6].map((n) => cardEvent(PRODUCT(n), n));
    const helper = fakeHelper({ events: six });
    const first = await run(helper, ['cards']);
    assert.equal(first.code, 0, first.err);
    assert.equal(first.json.questions.length, CARD.questions);
    assert.equal(first.json.left, 2);
    // Oldest first within one rank, each as AskUserQuestion takes it.
    assert.deepEqual(first.json.questions.map((q) => q.question), six.slice(0, 4).map((e) => e.data.question));
    assert.equal(first.json.questions[0].multiSelect, false);
    assert.equal(first.json.questions[0].options[0].label, 'Plain');
    // The cards handed out are recorded as asked, so the next visit asks the rest.
    assert.deepEqual(helper.writes(), [{ cwd: CWD, kind: 'asked', data: { cards: six.slice(0, 4).map((e) => e.id) } }]);
    const second = await run(helper, ['cards']);
    assert.deepEqual(second.json.questions.map((q) => q.question), six.slice(4).map((e) => e.data.question));
    assert.equal(second.json.left, 0);
    const third = await run(helper, ['cards']);
    assert.deepEqual(third.json, { questions: [], left: 0 });
    assert.equal(helper.writes().length, 2, 'nothing handed out, nothing recorded');
    // Every request to the state names the folder, for the helper to place the project; the
    // director's profile, read for the explanations setting, has none to place.
    assert.ok(helper.calls.every(([name, body]) => body.cwd === CWD || name === 'profile.views'));
  });
});

test('cards turns an open feature question into one answer card, once', async () => {
  await inHome(async () => {
    const answered = { ...QUESTION, id: 'q-login-1', work: 'login' };
    const answer = makeEvent({
      kind: 'action', now: () => T(7),
      data: { action: 'answer', question: 'as shown', questionId: 'q-login-1', questionHash: dataHash(answered), label: 'Comma' },
    });
    const helper = fakeHelper({ events: [questionEvent(), questionEvent(answered, 6), answer] });
    const first = await run(helper, ['cards']);
    assert.equal(first.code, 0, first.err);
    const cards = helper.writes().filter((w) => w.kind === 'card');
    assert.equal(cards.length, 1, 'the answered question gets none');
    const card = cards[0].data;
    assert.equal(card.kind, 'answer');
    assert.equal(card.line, answerLine('q-export-csv-1'));
    assert.equal(card.level, 2);
    // Its options are the question's own, with what each says, and its recommendation the question's.
    const [asked] = first.json.questions;
    assert.equal(asked.question, card.question);
    assert.deepEqual(asked.options.slice(0, 2), [
      { label: 'Comma', description: 'Commas between values; opens in any spreadsheet.' },
      { label: 'Tab', description: 'Recommended: Tabs between values.' },
    ]);
    assert.match(card.question, /^What this is: The export needs to know which separator to use\.$/m);
    assert.match(card.question, /^Why it's coming to you: It changes the file people download\.$/m);
    assert.match(card.question, /^My recommendation: Tab, because /m);
    assert.ok(card.question.includes(`While you decide: ${MEANWHILE}`));
    assert.equal(MEANWHILE, 'that feature waits; the others carry on');
    assert.deepEqual(helper.writes().at(-1), { cwd: CWD, kind: 'asked', data: { cards: [helper.held.find((e) => e.kind === 'card').id] } });
    // The next visit makes no second card for it: one is waiting, and it was asked.
    const again = await run(helper, ['cards']);
    assert.equal(helper.writes().filter((w) => w.kind === 'card').length, 1);
    assert.deepEqual(again.json, { questions: [], left: 0 });
  });
});

test('a level 4 question becomes a card too, with what it does to the checks or that the build didn\'t say', async () => {
  await inHome(async () => {
    const said = { ...QUESTION, level: 4, checks: 'The export check stops running on this page.' };
    const unsaid = { ...QUESTION, id: 'q-export-csv-2', level: 4 };
    const work = makeEvent({ kind: 'work', data: { id: 'export-csv', title: 'Export a report as a spreadsheet', lane: 'feature', visible: true, dependsOn: [] }, now: () => T(1) });
    const helper = fakeHelper({ events: [work, questionEvent(said), questionEvent(unsaid, 6)] });
    const out = await run(helper, ['cards']);
    assert.equal(out.code, 0, out.err);
    assert.equal(out.json.problems, undefined);
    const cards = helper.writes().filter((w) => w.kind === 'card').map((w) => w.data);
    assert.deepEqual(cards.map((c) => [c.line, c.level]), [[answerLine('q-export-csv-1'), 4], [answerLine('q-export-csv-2'), 4]]);
    assert.match(cards[0].question, /^What this does to the checks: The export check stops running on this page\.$/m);
    assert.ok(cards[1].question.includes(`What this does to the checks: ${CHECKS_UNSAID}`));
    assert.equal(CHECKS_UNSAID, 'The build didn\'t say. Choose or type Explain more and I\'ll find out before you answer.');
    // With four options of its own the card has no Explain more button, and it still composes with that line.
    const four = { ...QUESTION, id: 'q-export-csv-3', level: 4, options: ['Comma', 'Tab', 'Semicolon', 'Pipe'].map((label) => ({ label, says: `${label} between values.` })) };
    const full = fakeHelper({ events: [questionEvent(four)] });
    const asked = await run(full, ['cards']);
    assert.equal(asked.json.problems, undefined);
    const [fourCard] = full.writes().filter((w) => w.kind === 'card').map((w) => w.data);
    assert.deepEqual(fourCard.options, ['Comma', 'Tab', 'Semicolon', 'Pipe']);
    assert.ok(fourCard.question.includes(`What this does to the checks: ${CHECKS_UNSAID}`));
    // The work is named by its title; a question for work with no title, by the work's id.
    assert.match(cards[0].question, /^My recommendation: Tab, because the session building Export a report as a spreadsheet recommends it\.$/m);
    const untitled = fakeHelper({ events: [questionEvent()] });
    await run(untitled, ['cards']);
    assert.match(untitled.writes()[0].data.question, /because the session building export-csv recommends it\.$/m);
  });
});

test('every line break in a view\'s text is put on one line', async () => {
  await inHome(async () => {
    const glossary = makeEvent({ kind: 'glossary', data: { term: 'deploy', plain: 'one\ntwo\r\nthree\u2028four', example: 'a\rb' }, now: () => T(1) });
    const ruling = makeEvent({ kind: 'ruling', data: { words: 'first\nsecond\r\nthird\u2028fourth' }, now: () => T(2) });
    const helper = fakeHelper({ events: [glossary, ruling] });
    const terms = (await run(helper, ['views', 'glossary'])).out.split('\n');
    assert.ok(terms.includes('deploy: one two three four'), terms.join('|'));
    const starter = Object.keys(JSON.parse(fs.readFileSync(new URL('../../../templates/glossary.json', import.meta.url), 'utf8')));
    assert.equal(terms.length, starter.length + 2, 'one line for each term, and the final newline');
    assert.deepEqual((await run(helper, ['explain', 'deploy'])).out, 'deploy: one two three four\nFor example: a b\n');
    assert.equal((await run(helper, ['views', 'rulebook'])).out, 'first second third fourth (waiting for the director to confirm it)\n');
  });
});

test('card, record and similar refuse at once when nothing is on standard input', async () => {
  await inHome(async () => {
    const helper = fakeHelper();
    for (const argv of [['card'], ['record', 'idea'], ['record', 'ruling'], ['similar']]) {
      for (const input of ['', '  \n']) {
        const out = await run(helper, argv, input);
        assert.equal(out.code, 1, argv.join(' '));
        assert.match(out.err, /^[^\n]*nothing was given[^\n]*\n$/, argv.join(' '));
      }
    }
    assert.deepEqual(helper.calls, []);
    // A terminal is never waited on.
    await assert.rejects(readInput({ isTTY: true, [Symbol.asyncIterator]: () => { throw new Error('read'); } }), /nothing was given/);
  });
  // Run as a script with its input closed, it answers one line at once.
  for (const argv of [['card'], ['record', 'idea'], ['similar']]) {
    const done = spawnSync(process.execPath, [SCRIPT, ...argv], { input: '', encoding: 'utf8', timeout: 20000 });
    assert.equal(done.status, 1, argv.join(' '));
    assert.match(done.stderr, /^[^\n]*nothing was given[^\n]*\n$/, argv.join(' '));
  }
});

test('cards says which questions it could not make a card of, and asks the rest', async () => {
  await inHome(async () => {
    const tooMany = { ...QUESTION, id: 'q-export-csv-2', options: ['A', 'B', 'C', 'D', 'E'].map((label) => ({ label, says: label })), recommendation: 'A' };
    const helper = fakeHelper({ events: [questionEvent(), questionEvent(tooMany, 6)] });
    const out = await run(helper, ['cards']);
    assert.equal(out.code, 0);
    assert.equal(out.json.questions.length, 1);
    assert.equal(out.json.problems.length, 1);
    assert.match(out.json.problems[0], /q-export-csv-2/);
  });
});

test('card fills a pull request\'s head and records the card once', async () => {
  await inHome(async () => {
    const helper = fakeHelper();
    const input = JSON.stringify({ ...APPROVAL, target: { pr: 7 } });
    const first = await run(helper, ['card'], input);
    assert.equal(first.code, 0, first.err);
    assert.equal(first.json.alreadyAsked, undefined);
    assert.deepEqual(helper.calls.find(([name]) => name === 'prState'), ['prState', { cwd: CWD, number: 7 }]);
    assert.ok(first.json.question.question.includes(approvalLine(7, FULL)));
    const cards = helper.writes().filter((w) => w.kind === 'card');
    assert.equal(cards.length, 1);
    assert.equal(first.json.id, helper.held.find((e) => e.kind === 'card').id);
    assert.equal(cards[0].data.line, approvalLine(7, FULL));
    // The card handed out is recorded as asked, so no later visit offers it again.
    assert.deepEqual(helper.writes().map((w) => [w.kind, w.data.cards]), [['card', undefined], ['asked', [first.json.id]]]);
    // Composed again, with other words, the waiting card comes back as it was recorded, marked as
    // asked already, so the director isn't asked it twice; nothing more is written.
    const second = await run(helper, ['card'], JSON.stringify({ ...APPROVAL, because: 'the review was clean', target: { pr: 7 } }));
    assert.equal(second.code, 0, second.err);
    assert.equal(second.json.id, first.json.id);
    assert.deepEqual(second.json.question, first.json.question);
    assert.equal(second.json.alreadyAsked, true);
    assert.equal(helper.writes().length, 2);
    // A target that names its commit is kept as it is.
    const named = await run(helper, ['card'], JSON.stringify({ ...APPROVAL, what: 'Pull request #8 changes the footer.', target: { pr: 8, sha: DOC } }));
    assert.ok(named.json.question.question.includes(approvalLine(8, DOC)));
    assert.equal(helper.calls.filter(([name]) => name === 'prState').length, 2, 'only the number was looked up');
  });
});

test('card refuses an answer card, input that is not JSON and a card the composer refuses', async () => {
  await inHome(async () => {
    const helper = fakeHelper();
    const answer = await run(helper, ['card'], JSON.stringify({ ...PRODUCT(1), kind: 'answer', target: { questionId: 'q-export-csv-1' } }));
    assert.equal(answer.code, 1);
    assert.match(answer.err, /cards/);
    const notJson = await run(helper, ['card'], 'not json');
    assert.equal(notJson.code, 1);
    assert.match(notJson.err, /JSON/);
    const refused = await run(helper, ['card'], JSON.stringify({ ...APPROVAL, what: 'The sign-in page changes.', target: { pr: 7, sha: FULL } }));
    assert.equal(refused.code, 1);
    assert.match(refused.err, /#7/);
    assert.equal(refused.err.trim().split('\n').length, 1, 'one line');
    assert.deepEqual(helper.writes(), []);
  });
});

test('record ruling keeps the words exactly and gives back its confirm card', async () => {
  await inHome(async () => {
    const helper = fakeHelper();
    const words = 'Prices show GST, even on $0 items — ALWAYS';
    const out = await run(helper, ['record', 'ruling'], JSON.stringify({ words, reason: 'the director said so', scope: 'project' }));
    assert.equal(out.code, 0, out.err);
    const [ruling, card, asked] = helper.writes();
    assert.equal(ruling.kind, 'ruling');
    assert.deepEqual(ruling.data, { words, reason: 'the director said so', scope: 'project' });
    assert.equal(out.json.id, ruling.id);
    // The confirm card names that very ruling, by its id and its words, and it waits on the board.
    const event = helper.held.find((e) => e.kind === 'ruling');
    assert.equal(event.id, out.json.id);
    assert.equal(card.kind, 'card');
    assert.equal(card.data.kind, 'confirm');
    assert.equal(card.data.line, confirmLine(event));
    assert.ok(out.json.card.question.question.includes(confirmLine(event)));
    assert.equal(out.json.card.question.question, card.data.question);
    assert.equal(out.json.card.id, helper.held.find((e) => e.kind === 'card').id);
    // The confirm card handed out is recorded as asked.
    assert.deepEqual(asked, { cwd: CWD, kind: 'asked', data: { cards: [out.json.card.id] } });
    // Words a confirm line can't carry are refused before anything is written.
    for (const bad of [{ words: 'Two\nlines' }, { words: '' }, { reason: 'none' }]) {
      const refused = await run(helper, ['record', 'ruling'], JSON.stringify(bad));
      assert.equal(refused.code, 1, JSON.stringify(bad));
    }
    assert.equal(helper.writes().length, 3);
  });
});

test('record work, amendment, incident and note write the build loop\'s kinds', async () => {
  await inHome(async () => {
    const helper = fakeHelper();
    const records = {
      work: { id: 'export-csv', title: 'Export a report as a spreadsheet', lane: 'feature', visible: true, dependsOn: [] },
      amendment: { work: 'export-csv', change: 'Add a total row', hash: DOC },
      incident: { id: 'bad-total', what: 'Totals are wrong on the invoice page' },
      // The no-blame account once an incident is over (intake, route 1).
      note: { incident: 'bad-total', text: 'A rounding change reached the invoice page; the fix and a check are in.' },
    };
    for (const [kind, data] of Object.entries(records)) {
      const out = await run(helper, ['record', kind], JSON.stringify(data));
      assert.equal(out.code, 0, out.err);
      assert.deepEqual(helper.writes().at(-1), { cwd: CWD, kind, data });
      assert.equal(out.json.id, helper.held.at(-1).id);
    }
    assert.deepEqual(helper.held.map((e) => e.kind), ['work', 'amendment', 'incident', 'note']);
    for (const kind of ['idea', 'rejection', 'glossary', 'decision', 'risk', 'blocker', 'reversal']) assert.ok(RECORD_KINDS.includes(kind), kind);
  });
});

test('record never writes a card, an answer, a shown or asked record, or a signed kind', async () => {
  await inHome(async () => {
    const helper = fakeHelper();
    for (const kind of ['card', 'card-answer', 'shown', 'asked', ...PROTECTED_KINDS, 'action', 'confirmation', 'question', 'unknown']) {
      const out = await run(helper, ['record', kind], JSON.stringify({ question: 'Approve?', label: 'Approve', cards: ['x'] }));
      assert.equal(out.code, 1, kind);
      assert.match(out.err, /record takes/);
    }
    assert.deepEqual(helper.calls, [], 'the helper was never asked');
  });
});

test('a setting the catalogue refuses is refused before it reaches the helper', async () => {
  await inHome(async () => {
    const helper = fakeHelper();
    for (const data of [{ key: 'pace', value: 9 }, { key: 'noSuchThing', value: 1 }, { key: 'autonomy', value: 'balanced', until: '2026-10-20T00:00:00.000Z' }]) {
      const out = await run(helper, ['record', 'setting'], JSON.stringify(data));
      assert.equal(out.code, 1, JSON.stringify(data));
      assert.equal(out.err.trim().split('\n').length, 1);
    }
    assert.deepEqual(helper.calls, []);
    // A project's setting goes to the project's state, the director's own to their profile.
    assert.equal((await run(helper, ['record', 'setting'], JSON.stringify({ key: 'pace', value: 2 }))).code, 0);
    assert.deepEqual(helper.writes()[0].data, { key: 'pace', value: 2, words: 'Pace (builders at once): 2' });
    const profile = await run(helper, ['record', 'setting'], JSON.stringify({ key: 'presence', value: 'away', until: '2026-10-20T00:00:00.000Z' }));
    assert.equal(profile.code, 0, profile.err);
    assert.deepEqual(helper.calls.find(([name]) => name === 'profile.write'), ['profile.write', {
      kind: 'setting', data: { key: 'presence', value: 'away', until: '2026-10-20T00:00:00.000Z', words: 'Presence: away, until 20 October 2026, 00:00 UTC' },
    }]);
  });
});

test('record setting records its confirm card and marks it asked, except a concept set to false', async () => {
  await inHome(async () => {
    const helper = fakeHelper();
    // The director's own setting: written to the profile, then its card, naming the id the profile gave it.
    const tab = await run(helper, ['record', 'setting'], JSON.stringify({ key: 'boardTab', value: 'build', because: 'given by the front desk' }));
    assert.equal(tab.code, 0, tab.err);
    const data = { key: 'boardTab', value: 'build', words: 'Board tab shown first: build' };
    assert.deepEqual(helper.calls.filter(([name]) => name === 'profile.write'), [['profile.write', { kind: 'setting', data }]]);
    const [card, asked] = helper.writes();
    assert.equal(card.kind, 'card');
    assert.equal(card.data.line, confirmLine({ kind: 'setting', id: 'p-1', data }));
    assert.equal(tab.json.id, 'p-1');
    assert.equal(tab.json.card.question.question, card.data.question);
    assert.ok(card.data.question.includes('Board tab shown first: build'));
    assert.deepEqual(asked.data, { cards: [tab.json.card.id] });

    // A concept set to false counts at once (explanations get longer), so it needs no card.
    const before = helper.writes().length;
    const known = await run(helper, ['record', 'setting'], JSON.stringify({ key: 'known:ci', value: false }));
    assert.equal(known.code, 0, known.err);
    assert.deepEqual(helper.calls.at(-1), ['profile.write', { kind: 'setting', data: { key: 'known:ci', value: false, words: 'Knows "ci": no' } }]);
    assert.equal(helper.writes().length, before);
    assert.equal(known.json.card, undefined);

    // A project's setting is written under the id its card was composed with.
    const pace = await main(['record', 'setting'], {
      cwd: CWD, client: helper.client, input: JSON.stringify({ key: 'pace', value: 1 }), now: () => NOW, makeId: () => 'id-pace', out: () => {}, err: () => {},
    });
    assert.equal(pace, 0);
    const [setting, paceCard] = helper.writes().slice(before);
    assert.equal(setting.id, 'id-pace');
    assert.equal(paceCard.data.line, confirmLine({ kind: 'setting', id: 'id-pace', data: { key: 'pace', value: 1, words: 'Pace (builders at once): 1' } }));

    // Under STOP nothing is written, and no card is made for a setting that wasn't.
    const stopped = fakeHelper({ stop: true });
    const refused = await run(stopped, ['record', 'setting'], JSON.stringify({ key: 'boardTab', value: 'build' }));
    assert.equal(refused.code, 1);
    assert.deepEqual(stopped.writes(), []);
  });
});

test('again gives the card the board numbers n, and records it as asked', async () => {
  await inHome(async () => {
    const one = cardEvent(PRODUCT(1), 1);
    const two = cardEvent(PRODUCT(2), 2);
    const events = [one, two, makeEvent({ kind: 'card-answer', data: { card: one.id, label: 'Not now' }, now: () => T(3) })];
    const helper = fakeHelper({ events });
    const model = boardModel({ views: buildViews(events, readEnrolled(), { now: () => NOW }), events, now: NOW });
    const n = model.director.waiting.findIndex((w) => w.since === one.at) + 1;
    const out = await run(helper, ['again', String(n)]);
    assert.equal(out.code, 0, out.err);
    assert.deepEqual(out.json.questions.map((q) => q.question), [one.data.question]);
    assert.deepEqual(helper.calls.map(([name, body]) => [name, body.cards ?? body.data?.cards]), [['views', true], ['write', [one.id]]]);
    assert.deepEqual(helper.writes(), [{ cwd: CWD, kind: 'asked', data: { cards: [one.id] } }]);
    for (const bad of [['again', '9'], ['again', '0'], ['again', 'x'], ['again'], ['again', '1', '2']]) {
      assert.equal((await run(helper, bad)).code, 1, bad.join(' '));
    }
    assert.equal(helper.writes().length, 1);
  });
});

test('views and explain answer in short lines, and similar finds work that shares words', async () => {
  await inHome(async () => {
    const ruling = makeEvent({ kind: 'ruling', data: { words: 'Money is shown in dollars' }, now: () => T(1) });
    const work = makeEvent({ kind: 'work', data: { id: 'export-csv', title: 'Export a report as a spreadsheet', lane: 'feature', visible: true, dependsOn: [] }, now: () => T(2) });
    const idea = makeEvent({ kind: 'idea', data: { key: 'dark-mode', title: 'A dark theme for the shop' }, now: () => T(3) });
    const helper = fakeHelper({ events: [ruling, work, idea, cardEvent(PRODUCT(1), 4)] });
    const rulebook = await run(helper, ['views', 'rulebook']);
    assert.equal(rulebook.code, 0, rulebook.err);
    assert.match(rulebook.out, /Money is shown in dollars/);
    assert.match((await run(helper, ['views', 'waiting'])).out, /^1\. Which name suits page 1\?/m);
    assert.match((await run(helper, ['views', 'ideas'])).out, /A dark theme for the shop/);
    assert.match((await run(helper, ['views', 'glossary'])).out, /^pull request: /m);
    const settings = await run(helper, ['views', 'settings']);
    assert.match(settings.out, /^Pace \(builders at once\): 3 \(the default\)$/m);
    assert.equal((await run(helper, ['views', 'secrets'])).code, 1);

    const explained = await run(helper, ['explain', 'pull', 'request']);
    assert.equal(explained.code, 0, explained.err);
    assert.match(explained.out, /^pull request: .+\nFor example: .+\n$/);
    assert.match((await run(helper, ['explain', 'PRs'])).out, /^pull request: /);
    assert.equal((await run(helper, ['explain', 'flibbertigibbet'])).code, 1);

    const found = await run(helper, ['similar'], 'Could we export the report to a spreadsheet?');
    assert.equal(found.code, 0, found.err);
    assert.equal(found.json.similar[0].id, 'export-csv');
    assert.equal(found.json.similar[0].kind, 'work');
    // The request's words may come as arguments instead, which STOP lets through; then standard
    // input is never read.
    const words = await run(helper, ['similar', 'Could we export', 'the report to a spreadsheet?'], 'not read');
    assert.equal(words.code, 0, words.err);
    assert.deepEqual(words.json, found.json);
    assert.equal((await run(helper, ['similar'], '  ')).code, 1);
    assert.deepEqual(helper.writes(), []);
  });
});

test('under STOP the reading commands run and record is refused', async () => {
  await inHome(async () => {
    const helper = fakeHelper({ stop: true, events: [cardEvent(PRODUCT(1), 1), questionEvent()] });
    const cards = await run(helper, ['cards']);
    assert.equal(cards.code, 0, cards.err);
    // The Lift STOP card alone; the waiting card stays on the board. The question's card can't be
    // written under STOP, so none is tried, and nothing is written.
    assert.deepEqual(cards.json.questions.map((q) => q.header), ['Lift STOP']);
    assert.equal(cards.json.left, 1);
    assert.equal(cards.json.problems, undefined);
    assert.deepEqual(helper.writes(), []);
    const again = await run(helper, ['again', '1']);
    assert.equal(again.code, 0);
    assert.equal(again.json.problems, undefined);
    for (const name of ['rulebook', 'waiting', 'ideas', 'glossary', 'settings']) assert.equal((await run(helper, ['views', name])).code, 0, name);
    assert.equal((await run(helper, ['explain', 'merge'])).code, 0);
    assert.equal((await run(helper, ['similar'], 'export a report')).code, 0);
    assert.equal((await run(helper, ['similar', 'export', 'a', 'report'])).code, 0);
    const recorded = await run(helper, ['record', 'idea'], JSON.stringify({ key: 'x', title: 'An idea' }));
    assert.equal(recorded.code, 1);
    assert.equal(recorded.err, 'STOP is on\n');
    assert.equal((await run(helper, ['card'], JSON.stringify(PRODUCT(2)))).code, 1);
  });
});

test('under STOP, cards gives the Lift STOP card alone, never recorded, and the director\'s click on it lifts STOP', async () => {
  await inHome(async () => {
    setStop({ by: 'prompt' });
    const waiting = [1, 2, 3, 4].map((n) => cardEvent(PRODUCT(n), n));
    const helper = fakeHelper({ stop: () => stopState().on, events: [...waiting, questionEvent()] });
    const visit = await run(helper, ['cards']);
    assert.equal(visit.code, 0, visit.err);
    assert.equal(visit.json.questions.length, 1, 'the Lift STOP card alone, as the hook\'s line of 1 says');
    const [lift] = visit.json.questions;
    assert.equal(lift.header, 'Lift STOP');
    assert.equal(setLineOf(lift.question), LIFT_STOP);
    assert.deepEqual(lift.options.map((o) => o.label), ['Lift STOP', 'Not now', 'Explain more', 'Show me']);
    // The four cards waiting stay on the board, counted as left; nothing is written, so nothing is refused.
    assert.equal(visit.json.left, 4);
    assert.equal(visit.json.problems, undefined);
    assert.deepEqual(helper.writes(), []);
    assert.equal(helper.held.filter((e) => e.kind === 'card').length, 4);
    // The card check takes the visit's cards as they are.
    const ask = { cwd: CWD, hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: visit.json.questions } };
    assert.equal(await cardCheck(ask, { projectOf: () => ({ project: 'o__p' }) }), undefined);
    // The director clicks Lift STOP: the prompt record signs the lift, after the card's shown
    // record, and STOP is lifted.
    const records = [];
    const api = {
      state: { record: async (b) => { records.push(b.event); return { ok: true }; }, write: async () => ({ ok: true }) },
      profile: { record: async () => ({ ok: true }) },
    };
    const answers = { [lift.question]: 'Lift STOP' };
    await promptRecord(
      { cwd: CWD, hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [lift], answers }, tool_response: { answers } },
      { client: api, now: () => new Date(), projectOf: () => ({ project: 'o__p' }) },
    );
    assert.deepEqual(records.map((e) => [e.kind, e.data.action ?? e.data.options]), [['shown', lift.options.map((o) => o.label)], ['action', 'lift-stop']]);
    assert.equal(records[1].data.question, lift.question);
    assert.equal(stopState().on, false);
    // With STOP off, a visit has no Lift STOP card, and the cards waiting are asked.
    const after = await run(helper, ['cards']);
    assert.ok(after.json.questions.every((q) => q.header !== 'Lift STOP'), JSON.stringify(after.json));
    assert.deepEqual(after.json.questions.map((q) => q.question), waiting.map((e) => e.data.question));
  });
});

const PLAIN_QUESTION = {
  ...QUESTION,
  what: 'The pull request for slice 2 needs a review before it can go on.',
  why: 'Without it `npm run build` stays red, and "pull request" is the word the host shows.',
  options: [{ label: 'Wait', says: 'The slice waits for its review.' }, { label: 'Skip', says: 'It goes on with no review.' }],
  recommendation: 'Wait',
};

test('a card\'s words are in the glossary\'s plain words; what must be recognised stays as written', async () => {
  await inHome(async () => {
    const helper = fakeHelper({ events: [questionEvent(PLAIN_QUESTION)] });
    const out = await run(helper, ['cards']);
    assert.equal(out.code, 0, out.err);
    const card = helper.writes().find((w) => w.kind === 'card').data;
    assert.equal(out.json.questions[0].question, card.question);
    // Each term the director doesn't know is put in plain words where it is first used in the card.
    assert.match(card.question, /^What this is: The proposed change for piece 2 needs an independent check before it can go on\.$/m);
    // A quotation and a command are kept as written.
    assert.match(card.question, /^Why it's coming to you: Without it `npm run build` stays red, and "pull request" is the word the host shows\.$/m);
    // A term used again is kept, with its meaning at the end of the card's last part.
    const glossary = glossaryOf({});
    assert.match(card.question, /^While you decide: .*\. Terms: (?:slice|review) means .+\.$/m);
    assert.ok(card.question.includes(`slice means ${glossary.slice.plain}`) && card.question.includes(`review means ${glossary.review.plain}`), card.question);
    // The labels the director clicks stay as the build wrote them.
    assert.deepEqual(card.options.slice(0, 2), ['Wait', 'Skip']);
    // The concepts are the terms of the card as written, before any were replaced.
    const raw = composeCard({ ...answerInput(PLAIN_QUESTION, 'export-csv'), glossary });
    assert.deepEqual(card.concepts, raw.card.concepts);
    assert.ok(card.concepts.includes('pull request') && card.concepts.includes('slice'), card.concepts.join());
  });
});

test('a card the plain words would take past its length is composed as written', async () => {
  await inHome(async () => {
    // The longest why that still composes as written, with a term the plain words make longer.
    const base = { ...QUESTION, what: 'The pull request is ready.' };
    let n = 0;
    const fits = (k) => { try { composeCard(answerInput({ ...base, why: `It needs ${'w'.repeat(k)}.` }, 'export-csv')); return true; } catch { return false; } };
    while (fits(n + 1)) n += 1;
    const long = { ...base, why: `It needs ${'w'.repeat(n)}.` };
    assert.ok(plainWords('The pull request is ready.', glossaryOf({})).text.length > 'The pull request is ready.'.length);
    const helper = fakeHelper({ events: [questionEvent(long)] });
    const out = await run(helper, ['cards']);
    assert.equal(out.code, 0, out.err);
    assert.equal(out.json.problems, undefined);
    assert.equal(out.json.questions[0].question, composeCard(answerInput(long, 'export-csv')).card.question);
    assert.ok(out.json.questions[0].question.length <= CARD.chars);
  });
});

test('the explanations setting and the concepts the director knows decide what is put in plain words', async () => {
  await inHome(async () => {
    const setting = (key, value) => ({ key, id: key, at: '2026-10-01T00:00:00.000Z', value, before: null });
    const some = fakeHelper({ events: [questionEvent(PLAIN_QUESTION)], profile: { explanations: setting('explanations', 'some-terms') } });
    await run(some, ['cards']);
    const kept = some.writes().find((w) => w.kind === 'card').data.question;
    assert.match(kept, /^What this is: The pull request for slice 2 needs a review before it can go on\.$/m);
    assert.match(kept, / Terms: pull request means /);
    const known = fakeHelper({ events: [questionEvent(PLAIN_QUESTION)], profile: { 'known:pull-request': setting('known:pull-request', true) } });
    await run(known, ['cards']);
    assert.match(known.writes().find((w) => w.kind === 'card').data.question, /^What this is: The pull request for piece 2 needs an independent check before it can go on\.$/m);
  });
});

test('card and record ruling put their cards in plain words too, keeping what the set line names', async () => {
  await inHome(async () => {
    const helper = fakeHelper();
    const approval = await run(helper, ['card'], JSON.stringify({ ...APPROVAL, target: { pr: 7 } }));
    assert.equal(approval.code, 0, approval.err);
    assert.match(approval.json.question.question, /^What this is: Proposed change #7 changes the wording on the sign-in page\.$/m);
    assert.ok(approval.json.question.question.includes(approvalLine(7, FULL)));
    const words = 'Every pull request needs a review';
    const ruling = await run(helper, ['record', 'ruling'], JSON.stringify({ words }));
    assert.equal(ruling.code, 0, ruling.err);
    assert.ok(ruling.json.card.question.question.includes(`"${words}"`), 'the rule is quoted in the director\'s own words');
    // Both pass the card check as they are.
    const ask = { cwd: CWD, hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [approval.json.question, ruling.json.card.question] } };
    assert.equal(await cardCheck(ask, { projectOf: () => ({ project: 'o__p' }) }), undefined);
  });
});

test('card gives back a waiting card no visit has asked, and records it as asked', async () => {
  await inHome(async () => {
    const waiting = makeEvent({ kind: 'card', data: composeCard({ ...APPROVAL, target: { pr: 7, sha: FULL } }).card, now: () => T(1) });
    const helper = fakeHelper({ events: [waiting] });
    const out = await run(helper, ['card'], JSON.stringify({ ...APPROVAL, target: { pr: 7, sha: FULL } }));
    assert.equal(out.code, 0, out.err);
    assert.equal(out.json.id, waiting.id);
    assert.equal(out.json.question.question, waiting.data.question);
    assert.equal(out.json.alreadyAsked, undefined);
    assert.deepEqual(helper.writes(), [{ cwd: CWD, kind: 'asked', data: { cards: [waiting.id] } }]);
  });
});

test('an unknown command, or a helper that can\'t be reached, is one line on standard error', async () => {
  await inHome(async () => {
    const helper = fakeHelper();
    const unknown = await run(helper, ['preview', '7']);
    assert.equal(unknown.code, 1);
    assert.match(unknown.err, /^Commands: cards, card, again, record, similar, views, explain\n$/);
    const away = { client: { state: { views: async () => ({ ok: false, refused: 'the host helper could not be reached: is it running?' }) } } };
    const out = await run(away, ['cards']);
    assert.equal(out.code, 1);
    assert.equal(out.err, 'the host helper could not be reached: is it running?\n');
  });
});

test('through the real helper, the command places the project from its folder and records what it decides', async () => {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const home = shortHome();
  const folder = path.join(home, 'shop');
  try {
    await as(home, async () => {
      fs.mkdirSync(path.join(folder, 'src'), { recursive: true });
      writeProject('o__p', {
        folder, remoteUrl: remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' },
      });
      const { computer, publicKey } = makeSigningKey();
      enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
      await cloneState({ project: 'o__p', remoteUrl: remote.url });
      const adapter = { defaultBranch: async () => 'main', prState: async () => ({ headSha: FULL, state: 'open' }) };
      const helper = await startHelper({ address: testAddress(home), adapterFor: async () => adapter, envFor: async () => ({}) });
      try {
        const client = helperClient({ address: helper.address });
        const say = async (argv, input) => {
          let out = '';
          let err = '';
          const code = await main(argv, { cwd: path.join(folder, 'src'), client, input, out: (t) => { out += t; }, err: (t) => { err += t; } });
          assert.equal(code, 0, err);
          return out;
        };
        const ruling = JSON.parse(await say(['record', 'ruling'], JSON.stringify({ words: 'Money is shown in dollars' })));
        const approval = JSON.parse(await say(['card'], JSON.stringify({ ...APPROVAL, target: { pr: 7 } })));
        assert.ok(approval.question.question.includes(approvalLine(7, FULL)));
        // Both cards were handed out as they were made, so the visit has none left to ask.
        const visit = JSON.parse(await say(['cards']));
        assert.deepEqual(visit, { questions: [], left: 0 });
        assert.match(await say(['views', 'rulebook']), /^Money is shown in dollars \(waiting for the director to confirm it\)$/m);
        const events = listEvents(stateDir('o__p'), { report: () => {} });
        assert.deepEqual(events.map((e) => e.kind).sort(), ['asked', 'asked', 'card', 'card', 'ruling']);
        assert.equal(events.find((e) => e.kind === 'ruling').id, ruling.id);
        assert.deepEqual(events.filter((e) => e.kind === 'asked').flatMap((e) => e.data.cards).sort(), [ruling.card.id, approval.id].sort());
        // Under STOP the real helper's views say so, and the visit's one card is Lift STOP.
        setStop({ by: 'prompt' });
        const stopped = JSON.parse(await say(['cards']));
        assert.deepEqual(stopped.questions.map((q) => q.header), ['Lift STOP']);
        assert.equal(stopped.problems, undefined);
      } finally {
        await helper.close();
      }
    });
  } finally {
    remote.cleanup();
  }
});

test('run as a script, an unknown command is refused with the list of commands', async () => {
  const done = spawnSync(process.execPath, [SCRIPT, 'nonsense'], { encoding: 'utf8' });
  assert.equal(done.status, 1);
  assert.equal(done.stderr, 'Commands: cards, card, again, record, similar, views, explain\n');
  assert.equal(done.stdout, '');
});
