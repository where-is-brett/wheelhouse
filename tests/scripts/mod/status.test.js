// tests/scripts/mod/status.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { NO_HELPER } from '../../../scripts/hooks/session-start.js';
import { paneModel, paneStatusFile, writePaneStatus, readPaneStatus, QUESTION_WAITS, cardTextOf } from '../../../scripts/mod/status.js';
import { needsYou, courierWake } from '../../../scripts/mod/courier.js';
import { makeEvent } from '../../../scripts/state/events.js';
import { buildViews } from '../../../scripts/state/views.js';
import { readEnrolled } from '../../../scripts/state/signing.js';
import { CARD_HASH_CHARS, LEADS, PANE_LINES } from '../../../scripts/lib/mod-numbers.js';
import { loadBoardInputs } from '../../../scripts/board/inputs.js';
import { numberedWaiting, NO_STATE, NO_SETTINGS, NO_SOURCES } from '../../../scripts/board/model.js';
import { CANT_ANSWER } from '../../../scripts/mod/buttons.js';
import { cardNumbered } from '../../../scripts/cards/visit.js';
import { composeCard } from '../../../scripts/cards/compose.js';
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
  assert.deepEqual(first.buttons.map((b) => [b.label, b.does]), [['Approve', 'record'], ['Not now', 'record'], ['Explain more', 'turn'], ['Show me', 'turn']]);
  assert.equal(first.note, null);
  assert.deepEqual(third.buttons.map((b) => [b.label, b.does]), [['Comma', 'record'], ['Tab', 'record'], ['Explain more', 'turn']]);
  // A question from the build that no card asks yet is one line and no buttons.
  assert.deepEqual(line, { id: 'q:q-export-csv-2', n: 2, header: 'Question', kind: 'question', text: QUESTION_WAITS, hash: sha(QUESTION_WAITS), buttons: [], note: null, blocking: false, asked: false });
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
  assert.equal(got.submit, `${LEADS.courier} 1 new card (3). Send Claude's notification in one line, then ask any new cards now, once.`);
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
  assert.deepEqual(card.buttons, []);
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
    assert.equal(model.building[0], 'Building Speed up the automatic check run now, piece 1 of 3');
    assert.equal(model.building.at(-1), 'and 3 more building');
    assert.deepEqual(model.health.map((h) => h.level), ['watch', 'stop', 'stop', 'stop']);
    // STOP's own line and an incident's are marked, read before their words are made plain.
    assert.deepEqual(model.health.map((h) => h.of), [null, 'stop', 'stop', 'incident']);
    for (const line of [...model.building, ...model.health.map((h) => h.text)]) {
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
