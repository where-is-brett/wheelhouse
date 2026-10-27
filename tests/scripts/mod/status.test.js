// tests/scripts/mod/status.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { NO_HELPER } from '../../../scripts/hooks/session-start.js';
import { paneModel, paneStatusFile, writePaneStatus, readPaneStatus, QUESTION_WAITS, CARD_TO_MAKE, cardTextOf } from '../../../scripts/mod/status.js';
import { needsYou, courierWake } from '../../../scripts/mod/courier.js';
import { makeEvent } from '../../../scripts/state/events.js';
import { buildViews } from '../../../scripts/state/views.js';
import { readEnrolled } from '../../../scripts/state/signing.js';
import { CARD_HASH_CHARS, LEADS, PANE_LINES } from '../../../scripts/lib/mod-numbers.js';
import { loadBoardInputs } from '../../../scripts/board/inputs.js';
import { numberedWaiting, NO_STATE, NO_SETTINGS, NO_SOURCES } from '../../../scripts/board/model.js';
import { CANT_ANSWER } from '../../../scripts/mod/buttons.js';
import { cardNumbered } from '../../../scripts/cards/visit.js';
import { composeCard, textOf } from '../../../scripts/cards/compose.js';
import { markSeen } from '../../../scripts/briefing/seen.js';
import { briefingModel } from '../../../scripts/briefing/model.js';
import { previewFor, previewsFile } from '../../../scripts/mod/previews.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { recordAllowance } from '../../../scripts/usage/store.js';
import { setStop, liftStop } from '../../../scripts/lib/stop.js';
import { stopFile, wheelhouseHome } from '../../../scripts/lib/paths.js';
import { withHome, tempFolder } from '../../helpers/homes.js';

const P = 'owner__name';
const NOW = new Date('2026-10-19T12:00:00.000Z');
const FULL = 'abcdef1234567890abcdef1234567890abcdef12';
const at = (hour) => new Date(Date.UTC(2026, 9, 18, hour)).toISOString();

const common = {
  why: 'It changes what users see, which is yours to decide at level 3.',
  because: 'the checks passed and the change is small.',
  meanwhile: 'Nothing is released and the agents carry on with other work.',
  level: 3,
};
const says = (label) => ({ label, says: `It ${label.toLowerCase()} and goes ahead.` });
const approval = composeCard({ ...common, kind: 'approval', recommend: 'Approve', what: 'Pull request #13 changes the wording on the sign-in page.', options: [says('Approve')], target: { pr: 13, sha: FULL } }).card;
const answer = composeCard({
  ...common, kind: 'answer', recommend: 'Comma', what: 'The export needs to know which separator to use.',
  options: [{ label: 'Comma', says: 'Commas between values.' }, { label: 'Tab', says: 'Tabs between values.' }], target: { questionId: 'q-export-csv-1' },
}).card;

const put = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
};
const viewsDir = () => path.join(wheelhouseHome(), 'projects', P, 'views');
const view = (name, value) => put(path.join(viewsDir(), `${name}.json`), value);

// A registered project whose main folder is `repo`.
function register(home) {
  const repo = path.join(home, 'repo');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  writeProject(P, { folder: repo, remoteUrl: 'https://example.com/owner/name.git', host: 'github', repo: 'owner/name', connection: {} });
  return repo;
}

const question = (id, when, what) => ({ question: { key: id, id: `ev-${id}`, at: when, data: { id, work: 'export-csv', what, why: '', options: [{ label: 'Comma', says: 'x' }], recommendation: 'Comma', level: 3 } }, answer: null });

// Two cards and, between them, a question from the build that no card asks yet.
function keepWaiting() {
  view('waiting', [
    { id: 'card-approval', at: at(9), data: approval, asked: null },
    { id: 'card-answer', at: at(13), data: answer, asked: null },
  ]);
  view('work', {});
  view('features', {});
  view('questions', {
    'q-export-csv-1': question('q-export-csv-1', at(12), 'Which separator?'),
    'q-export-csv-2': question('q-export-csv-2', at(11), 'Which encoding?'),
  });
}

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, CARD_HASH_CHARS);

test('the pane lists the waiting cards in the board\'s numbering, each with its whole text and hash', () => withHome(async (home) => {
  const repo = register(home);
  keepWaiting();
  const model = await paneModel({ project: P, cwd: repo, now: () => NOW });
  assert.equal(model.v, 1);
  assert.equal(model.project, P);
  assert.equal(model.at, NOW.toISOString());
  assert.deepEqual(model.cards.map((c) => [c.n, c.id]), [[1, 'card-approval'], [2, 'q:q-export-csv-2'], [3, 'card-answer']]);
  const [first, line, third] = model.cards;
  assert.equal(first.text, approval.question);
  assert.equal(first.hash, sha(approval.question));
  assert.equal(first.hash.length, CARD_HASH_CHARS);
  assert.equal(first.kind, 'approval');
  assert.equal(first.header, 'Approval');
  assert.deepEqual(first.buttons.map((b) => [b.label, b.does, b.shape]), [
    ['Approve', 'record', 'filled'], ['Suggest a change…', 'suggest', 'outlined'], ['Not now', 'record', 'small'], ['Why?', 'why', 'small'], ['Show me', 'turn', 'small'],
  ]);
  assert.equal(first.note, null);
  assert.deepEqual(third.buttons.map((b) => [b.label, b.does, b.shape]), [
    ['Comma', 'record', 'filled'], ['Tab', 'record', 'outlined'], ['Suggest a change…', 'suggest', 'outlined'], ['Why?', 'why', 'small'],
  ]);
  // A question from the build that no card asks yet is one line and no buttons.
  assert.deepEqual(line, { id: 'q:q-export-csv-2', n: 2, header: 'Question', kind: 'question', text: QUESTION_WAITS, hash: sha(QUESTION_WAITS), buttons: [], note: null, blocking: false, asked: false, parts: null, steered: null, waited: null, revised: false });
  assert.equal(QUESTION_WAITS, 'A question from the build waits; the front desk will ask it');
}));

test('the board\'s waiting items carry ids, and the pane numbers them as the board and the front desk do', () => withHome(async (home) => {
  const repo = register(home);
  keepWaiting();
  const model = await paneModel({ project: P, cwd: repo, now: () => NOW });
  const board = await loadBoardInputs({ cwd: repo, now: () => NOW, offline: true });
  assert.deepEqual(model.cards.map((c) => [c.n, c.id]), board.model.director.waiting.map((w) => [w.n, w.id]));
  const views = JSON.parse(JSON.stringify({ waiting: JSON.parse(fs.readFileSync(path.join(viewsDir(), 'waiting.json'), 'utf8')), work: {}, features: {}, questions: JSON.parse(fs.readFileSync(path.join(viewsDir(), 'questions.json'), 'utf8')) }));
  assert.deepEqual(model.cards.map((c) => [c.n, c.id]), numberedWaiting(views, []).map((i) => [i.n, i.id]));
  // "Card 3" is the same card to the front desk.
  assert.equal(cardNumbered(views, 3).id, 'card-answer');
  assert.equal(model.cards[2].id, 'card-answer');
  assert.equal(cardNumbered(views, 2), null);
}));

test('each card says whether it blocks, by the front desk\'s order, and the open incidents are listed', () => withHome(async (home) => {
  const repo = register(home);
  const plain = { kind: 'question', header: 'Question', options: ['Yes'], question: 'Plain?', level: 3 };
  view('waiting', [
    { id: 'c-plain', at: at(9), data: plain, asked: null },
    { id: 'c-four', at: at(10), data: { ...plain, question: 'Level four?', level: 4 }, asked: null },
    { id: 'c-incident', at: at(11), data: { ...plain, kind: 'lift-incident', question: 'End it?' }, asked: null },
  ]);
  view('work', {});
  view('features', {});
  view('questions', { 'q-export-csv-2': question('q-export-csv-2', at(12), 'Which encoding?') });
  view('incidents', { open: [{ id: 'site-down', what: 'The site is down', at: at(8), fixes: [] }, { id: 'payments', what: 'x', at: at(9), fixes: [] }] });
  const model = await paneModel({ project: P, cwd: repo, now: () => NOW });
  assert.deepEqual(model.cards.map((c) => [c.id, c.blocking]), [['c-plain', false], ['c-four', true], ['c-incident', true], ['q:q-export-csv-2', false]]);
  assert.deepEqual(model.incidents, ['site-down', 'payments']);

  // No incidents view: none open. One that can't be read: none, and a line saying so.
  fs.rmSync(path.join(viewsDir(), 'incidents.json'));
  const none = await paneModel({ project: P, cwd: repo, now: () => NOW });
  assert.deepEqual(none.incidents, []);
  assert.ok(!none.missing.some((l) => l.includes('incidents')));
  view('incidents', { open: 'not a list' });
  const damaged = await paneModel({ project: P, cwd: repo, now: () => NOW });
  assert.deepEqual(damaged.incidents, []);
  assert.ok(damaged.missing.includes('The pane\'s list of open incidents couldn\'t be built'));
}));

// One courier tick of session s-1 on the pane's model, as the bridge's tick gives it.
const courierOn = (model, over = {}) => courierWake({
  project: P, session: 's-1', items: needsYou({ after: model }), presence: { value: 'here' }, quiet: undefined, idle: true, now: () => NOW, timeZone: 'UTC', ...over,
});
// Session s-1 opened a day ago, finding nothing, so its ticks are ordinary.
const openCourier = () => courierWake({ project: P, session: 's-1', items: [], presence: { value: 'here' }, idle: true, now: () => new Date(NOW.getTime() - 24 * 3600 * 1000) });

test('a click the gate waits for, and a hold, with no card yet are lines the courier wakes the front desk for', () => withHome(async (home) => {
  const repo = register(home);
  await openCourier();
  view('waiting', [{ id: 'card-approval', at: at(9), data: approval, asked: null }]);
  view('work', {});
  view('features', {});
  view('questions', {});
  view('reports', {});
  view('gateAsks', {
    // The gate waits for the director's approval of pull request #1, and no card asks for it yet.
    1: { id: 'ev-gate-1', at: at(10), data: { pr: 1, sha: 'ac6417b51c6d', ask: 'approval', work: 'readme' }, line: 'Approve pull request #1 at commit ac6417b51c6d', card: null, askedAt: null, clickedAt: null },
    // A pull request whose approval was clicked waits for nothing from the director.
    2: { id: 'ev-gate-2', at: at(10), data: { pr: 2, sha: 'bbbbbbbbbbbb', ask: 'approval', work: 'other' }, line: 'Approve pull request #2 at commit bbbbbbbbbbbb', card: null, askedAt: null, clickedAt: at(11) },
  });
  view('lineageHolds', [{ id: 'ev-hold', at: at(11), computer: null, data: { mismatches: [{ name: 'superpowers' }] }, card: null }]);
  const model = await paneModel({ project: P, cwd: repo, now: () => NOW });
  assert.deepEqual(model.cards.map((c) => [c.n, c.id, c.kind, c.text, c.blocking, c.asked]), [
    [1, 'card-approval', 'approval', approval.question, false, false],
    [2, 'make:ev-gate-1', 'approval', CARD_TO_MAKE, false, false],
    [3, 'make:ev-hold', 'question', CARD_TO_MAKE, true, false],
  ]);
  assert.deepEqual(model.cards[1].buttons, []);
  const wake = await courierOn(model);
  assert.ok(wake.submit.startsWith(LEADS.courier));
  assert.deepEqual(wake.sent.filter((id) => id.startsWith('card:make:')), ['card:make:ev-gate-1', 'card:make:ev-hold']);
}));

test('each card says whether the front desk has asked it, and an asked card never wakes the front desk', () => withHome(async (home) => {
  const repo = register(home);
  await openCourier();
  // The waiting view as the state builds it: a card made and asked in one turn, a card put off
  // with Not now in the chat (still waiting, asked), and a card nobody has asked yet.
  const event = (kind, data, minute) => makeEvent({ kind, data, now: () => new Date(Date.parse(at(9)) + minute * 60 * 1000) });
  const made = event('card', approval, 0);
  const putOff = event('card', answer, 1);
  const fresh = event('card', { kind: 'question', header: 'Question', options: ['Yes', 'No'], question: 'A new question?', level: 2 }, 2);
  const events = [made, putOff, fresh, event('asked', { cards: [made.id, putOff.id] }, 3), event('card-answer', { card: putOff.id, label: 'Not now' }, 4)];
  view('waiting', buildViews(events, readEnrolled(), { now: () => NOW }).waiting);
  view('work', {});
  view('features', {});
  view('questions', {});
  const model = await paneModel({ project: P, cwd: repo, now: () => NOW });
  assert.deepEqual(model.cards.map((c) => [c.id, c.asked]), [[made.id, true], [putOff.id, true], [fresh.id, false]]);
  const got = await courierOn(model);
  assert.deepEqual(got.sent, [`card:${fresh.id}`]);
  assert.equal(got.submit, `${LEADS.courier} 1 new card (3). Send Claude's notification in one line, titled "Wheelhouse", saying: 1 waiting on you: card 3. Then ask any new cards now, once.`);
  // The asked cards stay unwoken on later ticks too, the one put off by Not now included; the card
  // the wake named, still not asked, has its one reminder.
  assert.deepEqual((await courierOn(model, { now: () => new Date(NOW.getTime() + 3600 * 1000) })).sent, [`remind:${fresh.id}`]);
  assert.deepEqual(await courierOn(model, { now: () => new Date(NOW.getTime() + 7200 * 1000) }), { submit: null, sent: [] });
}));

test('a build question that holds up all work blocks and wakes while away; one that doesn\'t is held', () => withHome(async (home) => {
  const repo = register(home);
  await openCourier();
  const work = (id, dependsOn = []) => ({ key: id, work: { id: `ev-${id}`, at: at(8), data: { id, title: id, lane: 'build', dependsOn } } });
  const away = { presence: { value: 'away', until: '2026-10-19T20:00:00.000Z' } };
  view('waiting', []);
  view('features', {});
  view('questions', { 'q-export-csv-2': question('q-export-csv-2', at(11), 'Which encoding?') });
  // The one open feature asks the question, so all work waits on it.
  view('work', { 'export-csv': work('export-csv') });
  const blocking = await paneModel({ project: P, cwd: repo, now: () => NOW });
  assert.deepEqual(blocking.cards.map((c) => [c.id, c.blocking, c.asked]), [['q:q-export-csv-2', true, false]]);
  assert.deepEqual((await courierOn(blocking, away)).sent, ['card:q:q-export-csv-2']);

  // Another question, while other work goes on without the work that asks it: held while away.
  view('questions', { 'q-export-csv-3': question('q-export-csv-3', at(12), 'Which quoting?') });
  view('work', { 'export-csv': work('export-csv'), 'sign-in': work('sign-in') });
  const held = await paneModel({ project: P, cwd: repo, now: () => NOW });
  assert.deepEqual(held.cards.map((c) => [c.id, c.blocking]), [['q:q-export-csv-3', false]]);
  const later = { ...away, now: () => new Date(NOW.getTime() + 3600 * 1000) };
  assert.deepEqual(await courierOn(held, later), { submit: null, sent: [] });
  // Other work that waits on it: the question holds up all work again.
  view('work', { 'export-csv': work('export-csv'), 'sign-in': work('sign-in', ['export-csv']) });
  const waits = await paneModel({ project: P, cwd: repo, now: () => NOW });
  assert.deepEqual(waits.cards.map((c) => [c.id, c.blocking]), [['q:q-export-csv-3', true]]);
}));

test('a card that fails the card check and offers no Explain more has no button, and its note says it can\'t be answered here', () => withHome(async (home) => {
  const repo = register(home);
  // The reply code line left out, and only the deciding option and Not now offered.
  const broken = { ...approval, question: approval.question.split('\n').filter((l) => !l.startsWith('Reply code:')).join('\n'), options: ['Approve', 'Not now'] };
  view('waiting', [{ id: 'c-broken', at: at(9), data: broken, asked: null }]);
  const [card] = (await paneModel({ project: P, cwd: repo, now: () => NOW })).cards;
  // Only Why?, which asks the front desk.
  assert.deepEqual(card.buttons, [{ label: 'Why?', does: 'turn', shape: 'small' }]);
  assert.equal(card.note, CANT_ANSWER);
  assert.equal(CANT_ANSWER, 'This card can\'t be answered here: ask the front desk about it.');
}));

test('a card\'s text is its question, or its title when it has none', () => {
  assert.equal(cardTextOf({ question: 'Q?', title: 'T' }), 'Q?');
  assert.equal(cardTextOf({ title: 'T' }), 'T');
  assert.equal(cardTextOf({ question: 3, title: 'T' }), 'T');
  assert.equal(cardTextOf({}), '');
  assert.equal(cardTextOf(null), '');
});

test('a build-loop question no card asks yet is one line with no buttons', () => withHome(async (home) => {
  const repo = register(home);
  view('waiting', []);
  view('work', {});
  view('features', {});
  view('questions', { 'q-export-csv-2': question('q-export-csv-2', at(11), 'Which encoding?') });
  const { cards } = await paneModel({ project: P, cwd: repo, now: () => NOW });
  assert.equal(cards.length, 1);
  assert.equal(cards[0].id, 'q:q-export-csv-2');
  assert.deepEqual(cards[0].buttons, []);
  assert.equal(cards[0].text, 'A question from the build waits; the front desk will ask it');
}));

test('a card\'s text is kept as written; the other lines are one line each, in plain words', async () => {
  const written = '# Heading\n[a link](https://example.test) and <b>tags</b>\n\n  Two  spaces';
  const card = { kind: 'question', header: 'Question', options: ['Yes', 'Explain more'], question: written };
  const features = ['one', 'two', 'three', 'four', 'five', 'six', 'seven'].map((work, i) => ({ work, title: i === 0 ? '[Speed up the CI run](https://example.test)\n# now' : `Piece ${work}`, step: 'building', slice: { n: 1, m: 3 } }));
  await withHome(async (home) => {
    register(home);
    view('waiting', [{ id: 'c1', at: at(9), data: card, asked: null }]);
    view('reports', { done: { key: 'done', id: 'r1', at: at(9), data: { work: 'done', outcome: 'merged' } }, shut: { key: 'shut', id: 'r2', at: at(9), data: { work: 'shut', outcome: 'closed' } }, also: { key: 'also', id: 'r3', at: at(10), data: { work: 'also', outcome: 'merged' } } });
    const loadInputs = async () => ({
      project: P,
      model: {
        missing: [], director: { health: [{ level: 'ok', text: 'Protection: Standard' }, { level: 'watch', text: '## CI is red\n[see](https://example.test) and CI failed' }, { level: 'stop', text: 'STOP is on' }, { level: 'stop', text: 'STOP is on, since 09:00' }, { level: 'stop', text: 'Incident i1 is open, so nothing merges: x', incident: 'i1' }] },
        build: { features },
      },
      usage: null,
    });
    const model = await paneModel({ project: P, cwd: '/x', now: () => NOW, loadInputs });
    assert.equal(model.cards[0].text, written);
    assert.equal(model.cards[0].hash, sha(written));
    assert.equal(model.building.length, PANE_LINES);
    assert.equal(model.building[0].text, 'Building Speed up the automatic check run now, piece 1 of 3');
    assert.equal(model.building.at(-1).text, 'and 3 more building');
    assert.deepEqual(model.health.map((h) => h.level), ['watch', 'stop', 'stop', 'stop']);
    // STOP's own line and an incident's are marked, read before their words are made plain.
    assert.deepEqual(model.health.map((h) => h.of), [null, 'stop', 'stop', 'incident']);
    for (const line of [...model.building.map((b) => b.text), ...model.health.map((h) => h.text)]) {
      assert.doesNotMatch(line, /[\n<>[\]#]|https?:/, line);
    }
    assert.match(model.health[0].text, /^Automatic check run is red/);
    assert.deepEqual(model.finished, ['also', 'done']);
  });
});

test('STOP set from the phone shows in the next tick\'s model', () => withHome(async (home) => {
  const repo = register(home);
  assert.deepEqual((await paneModel({ project: P, cwd: repo, now: () => NOW })).stop, { on: false, since: null });
  setStop({ by: 'mod', now: () => new Date('2026-10-19T11:00:00.000Z') });
  assert.deepEqual((await paneModel({ project: P, cwd: repo, now: () => NOW })).stop, { on: true, since: '2026-10-19T11:00:00.000Z' });
  // Something unreadable at the STOP path still counts as on.
  liftStop();
  put(stopFile(), 'not json');
  assert.deepEqual((await paneModel({ project: P, cwd: repo, now: () => NOW })).stop, { on: true, since: null });
  liftStop();
  assert.equal((await paneModel({ project: P, cwd: repo, now: () => NOW })).stop.on, false);
}));

test('no state, no helper and no usage still give a model naming what is missing', () => withHome(async (home) => {
  const repo = register(home);
  const model = await paneModel({ project: P, cwd: repo, now: () => NOW });
  assert.equal(model.v, 1);
  assert.deepEqual(model.cards, []);
  assert.deepEqual(model.building, []);
  assert.equal(model.usage, null);
  assert.equal(model.watcher, null);
  assert.ok(model.missing.includes(NO_STATE));
  // What an offline reading never has isn't named as missing.
  assert.ok(!model.missing.includes(NO_SETTINGS));
  assert.ok(!model.missing.includes(NO_SOURCES));
  assert.ok(model.glance.length <= 80);

  // Outside a project, and with inputs that fail, there is still a model with one line saying so.
  const outside = await paneModel({ project: P, cwd: tempFolder('wh-elsewhere-'), now: () => NOW });
  assert.deepEqual(outside.missing, ['This folder isn\'t part of a Wheelhouse project']);
  assert.equal(outside.glance, 'Wheelhouse');
  // The helper being down is said plainly, with the time of the last sync the views come from.
  const asked = await paneModel({ project: P, cwd: repo, now: () => NOW, helperUp: true });
  assert.ok(!asked.missing.includes(NO_HELPER));
  const never = await paneModel({ project: P, cwd: repo, now: () => NOW, helperUp: false });
  assert.ok(never.missing.includes(NO_HELPER));
  assert.ok(never.missing.includes('Nothing has been synced to this computer yet, so nothing below is current'));
  view('status', { builtAt: '2026-10-18T18:00:00.000Z', waitingCount: 0 });
  const synced = await paneModel({ project: P, cwd: repo, now: () => NOW, helperUp: false });
  assert.ok(synced.missing.includes(NO_HELPER));
  assert.ok(synced.missing.includes('The state shown was last synced on 18 October 2026, 18:00 UTC'));
  view('status', { builtAt: 'yesterday' });
  assert.ok((await paneModel({ project: P, cwd: repo, now: () => NOW, helperUp: false })).missing.some((l) => l.startsWith('Nothing has been synced')));
  fs.rmSync(path.join(viewsDir(), 'status.json'));

  const broken = await paneModel({ project: P, cwd: repo, now: () => NOW, loadInputs: async () => { throw new Error('no'); } });
  assert.deepEqual(broken.missing, ['The board\'s inputs couldn\'t be read this time']);
  const noClock = await paneModel({ project: P, cwd: repo, now: () => 'not a time' });
  assert.equal(noClock.at, null);
  assert.ok(noClock.missing.includes('The pane\'s clock couldn\'t be read'));
}));

test('the usage line is the briefing\'s, and null when there is none', () => withHome(async (home) => {
  const repo = register(home);
  assert.equal((await paneModel({ project: P, cwd: repo, now: () => NOW })).usage, null);
  recordAllowance({ windows: [{ kind: 'seven_day', percentUsed: 34, resetsAt: '2026-10-22T00:00:00.000Z' }], at: NOW });
  assert.equal((await paneModel({ project: P, cwd: repo, now: () => NOW })).usage, 'Usage this week: 34% of your weekly allowance.');
}));

test('the model is kept as status.json, whole, and read back only when it is a version 1 model', () => withHome(async (home) => {
  const repo = register(home);
  assert.equal(readPaneStatus(P), null);
  const model = await paneModel({ project: P, cwd: repo, now: () => NOW });
  writePaneStatus(P, model);
  assert.equal(paneStatusFile(P), path.join(home, 'projects', P, 'status.json'));
  assert.deepEqual(readPaneStatus(P), JSON.parse(JSON.stringify(model)));
  assert.deepEqual(fs.readdirSync(path.dirname(paneStatusFile(P))).filter((n) => n.endsWith('.tmp')), []);
  // Damaged, another version, or not an object: nothing.
  for (const text of ['{"v":1', '{"v":2,"project":"x"}', '[1]', 'null', '']) {
    put(paneStatusFile(P), text);
    assert.equal(readPaneStatus(P), null, text);
  }
  assert.throws(() => writePaneStatus(P, { v: 2 }));
  assert.throws(() => writePaneStatus('../escape', model));
  assert.equal(readPaneStatus('../escape'), null);
}));

test('the model carries each card\'s parts as the composer kept them, and a card with none as null', () => withHome(async (home) => {
  const repo = register(home);
  const old = { kind: 'question', header: 'Question', options: ['Yes'], question: 'Plain?', level: 3 };
  view('waiting', [{ id: 'c-new', at: at(9), data: approval, asked: null }, { id: 'c-old', at: at(10), data: old, asked: null }]);
  view('work', {});
  view('features', {});
  view('questions', {});
  const [made, plain] = (await paneModel({ project: P, cwd: repo, now: () => NOW })).cards;
  // Drawn as they are: the set line and the code word for word, and the parts build the text.
  assert.deepEqual(made.parts, approval.parts);
  assert.equal(textOf(made.parts), made.text);
  assert.equal(made.parts.line, approval.line);
  assert.equal(made.parts.code, approval.code);
  assert.equal(plain.parts, null);
}));

test('a steered card carries its time in the computer\'s own time, a revised card is marked, and a card says how long it has waited', () => withHome(async (home) => {
  const repo = register(home);
  const revised = composeCard({ ...common, kind: 'approval', recommend: 'Approve', what: 'Pull request #14 changes the wording on the sign-in page.', options: [says('Approve')], target: { pr: 14, sha: FULL }, revises: 'card-approval', changed: 'The wording is shorter.' }).card;
  view('waiting', [
    { id: 'card-approval', at: new Date(NOW.getTime() - 2 * 3600 * 1000).toISOString(), data: approval, asked: null, steered: '2026-10-19T11:40:00.000Z' },
    { id: 'card-revised', at: new Date(NOW.getTime() - 30 * 1000).toISOString(), data: revised, asked: null, steered: null },
    { id: 'card-answer', at: new Date(NOW.getTime() - 61 * 60 * 1000).toISOString(), data: answer, asked: null, steered: 'not a time' },
  ]);
  view('work', {});
  view('features', {});
  view('questions', {});
  const cards = Object.fromEntries((await paneModel({ project: P, cwd: repo, now: () => NOW })).cards.map((c) => [c.id, c]));
  const local = new Date('2026-10-19T11:40:00.000Z');
  assert.equal(cards['card-approval'].steered, `${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`);
  assert.equal(cards['card-revised'].steered, null);
  assert.equal(cards['card-answer'].steered, null);
  assert.equal(cards['card-approval'].revised, false);
  assert.equal(cards['card-revised'].revised, true);
  assert.equal(cards['card-approval'].waited, 'asked 2 hours ago');
  assert.equal(cards['card-revised'].waited, 'asked just now');
  assert.equal(cards['card-answer'].waited, 'asked 1 hour ago');
}));

test('the model carries the verdict, the since line, launch, health, ideas, building and updated', () => withHome(async (home) => {
  const repo = register(home);
  markSeen(P, { briefedAt: '2026-10-19T09:10:00.000Z' });
  keepWaiting();
  view('blockers', {
    a: { key: 'a', id: 'b1', at: at(1), data: { key: 'a', what: 'Payments work', resolved: true } },
    b: { key: 'b', id: 'b2', at: '2026-10-19T10:00:00.000Z', data: { key: 'b', what: 'Privacy page', resolved: true } },
    c: { key: 'c', id: 'b3', at: at(3), data: { key: 'c', what: 'Domain name', resolved: false } },
  });
  view('ideas', {
    i1: { key: 'i1', id: 'e1', at: at(2), data: { text: 'Gift cards', when: 'now' } },
    i2: { key: 'i2', id: 'e2', at: '2026-10-19T10:30:00.000Z', data: { text: 'Loyalty stamps', when: 'later' } },
  });
  view('work', {
    'export-csv': { key: 'export-csv', work: { id: 'w1', at: at(1), data: { id: 'export-csv', title: 'Export', lane: 'feature', shownFirst: true } }, approved: true },
    'queued-one': { key: 'queued-one', work: { id: 'w2', at: at(2), data: { id: 'queued-one', title: 'Queued one', lane: 'feature' } }, approved: true },
  });
  view('features', {
    f1: { key: 'f1', id: 'f1', at: at(4), data: { work: 'export-csv', step: 'building' } },
  });
  const loadInputs = async () => loadBoardInputs({ cwd: repo, now: () => NOW, offline: true });
  const model = await paneModel({ project: P, cwd: repo, now: () => NOW, loadInputs });
  const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  // Three cards wait (two cards and a question from the build), and nothing is broken.
  assert.equal(model.verdict, 'Three things need you. Nothing is broken.');
  // The briefing opens with the same sentence, and the board's table says the same of when the work is seen.
  const inputs = await loadInputs();
  assert.equal(briefingModel({ model: inputs.model, usage: inputs.usage, sources: inputs.sources, now: NOW }).verdict, model.verdict);
  assert.equal(inputs.model.director.inProgress.feature[0].see, model.building[0].see);
  assert.equal(model.since, `Since you were last here at ${hhmm(new Date('2026-10-19T09:10:00.000Z'))}.`);
  assert.deepEqual(model.launch, { resolved: 2, total: 3, gained: 1, next: [{ text: 'Gift cards', yours: true }, { text: 'Queued one', yours: false }] });
  assert.deepEqual(model.ideas, { count: 2, fresh: 1 });
  assert.deepEqual(model.building, [{ text: 'Building Export', see: 'Before it merges' }]);
  assert.equal(model.updated, hhmm(NOW));
  // Nothing is to watch, so all is well; the lines stay a list. On Windows the no-sandbox line is to
  // watch, as it is on every Windows computer.
  const lines = model.health.map((h) => [h.level, h.text]);
  if (process.platform === 'win32') assert.match(lines.shift().join(' '), /^watch This computer has no sandbox/);
  assert.deepEqual(lines, []);
  assert.deepEqual(model.healthNote, { allWell: process.platform !== 'win32', protection: 'Standard', week: null });
}));

test('the verdict counts the health lines at stop level other than STOP\'s own, and healthNote says what is not well', () => withHome(async (home) => {
  register(home);
  view('waiting', []);
  const loadInputs = async () => ({
    project: P,
    model: {
      missing: [],
      director: { health: [{ level: 'ok', text: 'Protection: Locked' }, { level: 'watch', text: 'CI is red' }, { level: 'stop', text: 'STOP is on' }, { level: 'stop', text: 'Incident i1 is open, so nothing merges: x', incident: 'i1' }] },
      build: { features: [] },
    },
    usage: { week: { share: 34 } },
  });
  const model = await paneModel({ project: P, cwd: '/x', now: () => NOW, loadInputs });
  assert.equal(model.verdict, 'Nothing needs you. One thing is broken.');
  assert.equal(model.since, null);
  assert.equal(model.launch, null);
  assert.deepEqual(model.ideas, { count: 0, fresh: 0 });
  assert.equal(model.healthNote.allWell, false);
  // With no line at watch or stop, all is well.
  const calm = await paneModel({ project: P, cwd: '/x', now: () => NOW, loadInputs: async () => ({ project: P, model: { missing: [], director: { health: [{ level: 'ok', text: 'Protection: Standard' }] }, build: { features: [] } }, usage: null }) });
  assert.deepEqual(calm.healthNote, { allWell: true, protection: 'Standard', week: null });
  assert.equal(model.healthNote.protection, 'Locked');
  assert.match(model.healthNote.week, /34%/);
  // `health` stays the list of lines at watch or stop.
  assert.deepEqual(model.health.map((h) => h.level), ['watch', 'stop', 'stop']);
}));

test('only an approval card is asked for a preview, and Show me links to the address it gets', () => withHome(async (home) => {
  const repo = register(home);
  keepWaiting();
  const asked = [];
  const previews = async (args) => {
    asked.push([args.pr, args.sha]);
    return 'https://preview.example.test/13';
  };
  const model = await paneModel({ project: P, cwd: repo, now: () => NOW, previews, client: {} });
  assert.deepEqual(asked, [[13, FULL.slice(0, 12)]]);
  const shown = model.cards[0].buttons.find((b) => b.label === 'Show me');
  assert.deepEqual(shown, { label: 'Show me', does: 'turn', shape: 'link', href: 'https://preview.example.test/13' });
  assert.equal(model.cards[2].buttons.some((b) => b.shape === 'link'), false);
  // An address that is not https: is none, and a failing lookup is none.
  const plainHttp = await paneModel({ project: P, cwd: repo, now: () => NOW, previews: async () => 'http://preview.example.test/13' });
  assert.equal(plainHttp.cards[0].buttons.find((b) => b.label === 'Show me').shape, 'small');
  const failing = await paneModel({ project: P, cwd: repo, now: () => NOW, previews: async () => { throw new Error('down'); } });
  assert.equal(failing.cards[0].buttons.find((b) => b.label === 'Show me').shape, 'small');
}));

test('previewFor keeps an https address ten minutes, asks at most once a tick and never waits past 1.5 seconds', () => withHome(async () => {
  let calls = 0;
  let url = 'https://preview.example.test/13';
  const client = { preview: async () => { calls += 1; return { ok: true, url }; } };
  const base = { project: P, pr: 13, sha: FULL.slice(0, 12), client };
  const t0 = NOW;
  assert.equal(await previewFor({ ...base, now: () => t0 }), 'https://preview.example.test/13');
  assert.equal(calls, 1);
  // Kept: asked again nine minutes on, there is no call.
  assert.equal(await previewFor({ ...base, now: () => new Date(t0.getTime() + 9 * 60 * 1000) }), 'https://preview.example.test/13');
  assert.equal(calls, 1);
  // Ten minutes on, it is asked again.
  url = 'https://preview.example.test/13b';
  assert.equal(await previewFor({ ...base, now: () => new Date(t0.getTime() + 10 * 60 * 1000) }), 'https://preview.example.test/13b');
  assert.equal(calls, 2);
  // Another commit is another key.
  assert.equal(await previewFor({ ...base, sha: 'fedcba987654', now: () => new Date(t0.getTime() + 10 * 60 * 1000) }), 'https://preview.example.test/13b');
  assert.equal(calls, 3);

  // An answer of none is kept too.
  url = null;
  const later = new Date(t0.getTime() + 30 * 60 * 1000);
  assert.equal(await previewFor({ ...base, pr: 14, now: () => later }), null);
  assert.equal(await previewFor({ ...base, pr: 14, now: () => later }), null);
  assert.equal(calls, 4);
  // An address that is not https: is kept as none.
  url = 'http://preview.example.test/15';
  assert.equal(await previewFor({ ...base, pr: 15, now: () => later }), null);
  assert.equal(await previewFor({ ...base, pr: 15, now: () => later }), null);
  assert.equal(calls, 5);
  const kept = JSON.parse(fs.readFileSync(previewsFile(P), 'utf8'));
  assert.deepEqual(Object.keys(kept).sort(), ['14:' + FULL.slice(0, 12), '15:' + FULL.slice(0, 12)].sort());

  // At most one call a tick: the second pull request in a tick is not asked.
  const tick = { asked: false };
  url = 'https://preview.example.test/16';
  assert.equal(await previewFor({ ...base, pr: 16, now: () => later, tick }), 'https://preview.example.test/16');
  assert.equal(await previewFor({ ...base, pr: 17, now: () => later, tick }), null);
  assert.equal(calls, 6);
}));

test('a slow or failing preview call counts as none for the tick and is not kept', () => withHome(async () => {
  const base = { project: P, pr: 13, sha: FULL.slice(0, 12), now: () => NOW };
  const begun = Date.now();
  assert.equal(await previewFor({ ...base, client: { preview: () => new Promise(() => {}) } }), null);
  assert.ok(Date.now() - begun < 2500, 'waited past the limit');
  assert.equal(fs.existsSync(previewsFile(P)), false);
  assert.equal(await previewFor({ ...base, client: { preview: async () => { throw new Error('down'); } } }), null);
  assert.equal(await previewFor({ ...base, client: { preview: async () => ({ ok: false }) } }), null);
  assert.equal(fs.existsSync(previewsFile(P)), false);
  // Asked again on the next tick, it can answer.
  assert.equal(await previewFor({ ...base, client: { preview: async () => ({ ok: true, url: 'https://preview.example.test/13' }) } }), 'https://preview.example.test/13');
  // With no client, only what is kept is read.
  assert.equal(await previewFor({ ...base, pr: 99 }), null);
}));
