// tests/scripts/setup/choices.test.js
// Setup's one recommended card and its choices (design section 15.1): the card's words, what its
// Go ahead stands for and records, when a Go ahead holds, and which choices Customise asks next.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  oneCard, setupTime, consentHolds, customiseBatch, aboutOf, actedBy, GO_AHEAD, CUSTOMISE, PER_CARD,
} from '../../../scripts/setup/choices.js';
import { stepFourDrift, choiceList } from '../../../scripts/setup/redo.js';
import { NEW_PRODUCT, HOST_LABELS, WAYS, REAL_USERS, STRICTER } from '../../../scripts/setup/host.js';
import { LIVE_DATA, PRODUCT } from '../../../scripts/setup/questions.js';
import { cardProblems } from '../../../scripts/hooks/card-check.js';

const phase = (value) => [{ kind: 'setting', data: { key: 'phase', value } }];
// A new product's choices as the dry run finds them, each taken as recommended.
function newProductChoices({ connection = WAYS.quick, live = LIVE_DATA.no } = {}) {
  const c = (step, id, label, extra = {}) => ({ step, id, key: `${step}.${id}`, card: { recommend: label, options: [] }, typed: false, writes: undefined, chosen: null, label, text: null, ...extra });
  return [
    c(3, 'join', NEW_PRODUCT),
    c(3, 'real-users', REAL_USERS.no),
    c(3, 'host', HOST_LABELS.github),
    c(3, 'connection-0123456789', connection),
    c(4, 'product-before-launch', PRODUCT.shaping, { writes: { labels: { [PRODUCT.shaping]: phase('before-launch') } } }),
    c(4, 'live-data', live),
  ];
}

test('the one card for a new product on a Mac says the director\'s approved words, a plain line each', () => {
  const { card, choices, writes, id } = oneCard({
    folder: '/x/tide-tables', list: newProductChoices(), product: { isNew: true, host: null, repo: null, name: 'tide-tables' }, platform: 'darwin', toRun: [3, 6, 7, 10], count: 0,
  });
  assert.equal(card.question, [
    'Set up Wheelhouse for tide-tables?',
    'Here\'s what I recommend. It takes about 5 minutes.',
    '- A new product, in a private repository on your GitHub account.',
    '- Agents use your ordinary GitHub sign-in, which they can\'t read on this Mac.',
    '- Before launch: no real users and no live data yet.',
    '- On this computer: usage counted here only, and 30 days of chat history kept (older history is deleted).',
    '- Wheelhouse\'s settings saved to the project, then its main line protected.',
    'Nothing runs until you choose.',
    'To know more, just ask.',
  ].join('\n'));
  assert.deepEqual(card.options.map((o) => o.label), [GO_AHEAD, CUSTOMISE]);
  assert.match(card.options[0].description, /^Recommended: /);
  // It passes the card check, as any card the director sees must.
  assert.deepEqual(cardProblems(card), []);
  // Go ahead stands for every choice listed, and records the phase the description's choice makes.
  assert.deepEqual(choices.map((c) => [c.key, c.label]), newProductChoices().map((c) => [c.key, c.label]));
  assert.deepEqual(writes, { labels: { [GO_AHEAD]: phase('before-launch') } });
  assert.match(id, /^plan-[0-9a-f]{12}$/);
});

test('a run with only the health check left gets a short one card naming it, with an honest time and no empty list', () => {
  // A run v0.1.1 parked at its phone card, carried on after the update (rehearsal of 27 October 2026):
  // every choice answered, steps 1 to 8 done.
  const { card } = oneCard({ folder: '/x/Tides', list: [], product: { isNew: false, host: 'github', repo: 'a/Tides', name: 'Tides' }, platform: 'darwin', toRun: [10], count: 7 });
  assert.equal(card.question, [
    'Finish setting up Wheelhouse for Tides?',
    'Setup is nearly done. What\'s left takes about a minute:',
    '- A last check that everything is safe.',
    'Nothing runs until you choose.',
    'To know more, just ask.',
  ].join('\n'));
  assert.doesNotMatch(card.question, /5 minutes/);
  assert.deepEqual(cardProblems(card), []);
  assert.equal(setupTime([10]), 'about a minute');
  assert.equal(setupTime([3, 6, 7, 10]), 'about 5 minutes');
  // Whatever is left, the card lists something: never a plan with no lines.
  for (const toRun of [[10], [6, 7, 10], [7, 10]]) {
    const lines = oneCard({ folder: '/x/Tides', list: [], product: null, platform: 'darwin', toRun, count: 7 }).card.question.split('\n').filter((l) => l.startsWith('- '));
    assert.ok(lines.length > 0, JSON.stringify(toRun));
  }
});

test('the one card\'s lines follow what setup finds: Windows, the README\'s words, a project under way, and the director\'s own choices', () => {
  const list = newProductChoices({ connection: WAYS.own });
  list[4] = { ...list[4], label: PRODUCT.readme, card: { options: [{ label: PRODUCT.readme, says: '"Tide tables for skippers."' }] }, chosen: { label: PRODUCT.readme, text: null, at: '2026-10-26T10:00:00Z' } };
  const win = oneCard({ folder: '/x/t', list, product: { isNew: true, name: 't' }, platform: 'win32', toRun: [3], count: 1 }).card.question;
  assert.match(win, /- A key for this project only, made on GitHub \(you'll click Authorise and Install\)\./);
  assert.match(win, /- Described as: "Tide tables for skippers\."/);
  assert.match(win, /Here's the plan, with your choices\./);
  assert.doesNotMatch(win, /On this computer/);
  // A project already under way: kept as it is, and test data only, to be safe.
  const under = [
    { step: 3, id: 'real-users', key: '3.real-users', card: {}, chosen: null, label: REAL_USERS.no, text: null },
    { step: 4, id: 'live-data', key: '4.live-data', card: {}, chosen: null, label: LIVE_DATA.yes, text: null },
  ];
  const kept = oneCard({ folder: '/x/h', list: under, product: { isNew: false, host: 'github', repo: 'a/harbour', name: 'harbour' }, platform: 'darwin', toRun: [3, 6, 7, 10], count: 0 }).card.question;
  assert.match(kept, /- harbour on GitHub, as it is\./);
  assert.match(kept, /- Before launch: no real users yet\./);
  assert.match(kept, /- Agents use test data only, to be safe\./);
  // Make it stricter on the Mac.
  assert.match(oneCard({ folder: '/x/t', list: newProductChoices({ connection: STRICTER }), product: { isNew: true, name: 't' }, platform: 'darwin', toRun: [], count: 0 }).card.question,
    /- A key for this project only, made on GitHub \(you'll click Authorise and Install\)\./);
});

test('the one card is never the same card twice: its id names the choices and how many answers the run holds', () => {
  const at = (count, list = newProductChoices()) => oneCard({ folder: '/x/t', list, product: null, platform: 'darwin', toRun: [], count }).id;
  assert.equal(at(0), at(0));
  assert.notEqual(at(0), at(1));
  assert.notEqual(at(0), at(0, newProductChoices({ live: LIVE_DATA.yes })));
});

test('a Go ahead holds until one of its choices gets a newer, different answer of the director\'s', () => {
  const consent = { at: '2026-10-26T10:00:00.000Z', choices: [{ key: '4.live-data', label: LIVE_DATA.no, text: null }, { key: '3.host', label: HOST_LABELS.github, text: null }] };
  assert.equal(consentHolds(null, {}), false);
  assert.equal(consentHolds(consent, {}), true);
  // An older answer, or a newer one that says the same, leaves it standing.
  assert.equal(consentHolds(consent, { '4.live-data': { label: LIVE_DATA.yes, text: null, at: '2026-10-26T09:00:00.000Z' } }), true);
  assert.equal(consentHolds(consent, { '4.live-data': { label: LIVE_DATA.no, text: null, at: '2026-10-26T11:00:00.000Z' } }), true);
  // A newer answer that differs: it lapses, and the one card is asked again.
  assert.equal(consentHolds(consent, { '4.live-data': { label: LIVE_DATA.yes, text: null, at: '2026-10-26T11:00:00.000Z' } }), false);
});

test('Customise asks the choices not yet answered since it was clicked, four at most to a card', () => {
  const since = '2026-10-26T10:00:00.000Z';
  const list = newProductChoices();
  assert.equal(PER_CARD, 4);
  assert.deepEqual(customiseBatch(list, since).map((c) => c.id), ['join', 'real-users', 'host', 'connection-0123456789']);
  const answered = list.map((c, i) => (i < 4 ? { ...c, chosen: { label: c.label, text: null, at: '2026-10-26T10:05:00.000Z' } } : c));
  assert.deepEqual(customiseBatch(answered, since).map((c) => c.id), ['product-before-launch', 'live-data']);
  // An answer from before Customise was clicked is asked again, for the director to see.
  const before = list.map((c) => ({ ...c, chosen: { label: c.label, text: null, at: '2026-10-26T09:00:00.000Z' } }));
  assert.equal(customiseBatch(before, since).length, 4);
});

test('each choice says what it is about and which step acts on it', () => {
  assert.equal(aboutOf('3.join-0123456789'), 'new or from your other computer');
  assert.equal(aboutOf('3.connection-stricter-0123456789'), 'how agents reach the project');
  assert.equal(aboutOf('4.product-launched'), 'the description');
  assert.equal(actedBy('3.host'), 3);
  assert.equal(actedBy('3.real-users'), null);
  assert.equal(actedBy('4.live-data'), 7);
  assert.equal(actedBy('4.product-before-launch'), null);
  const listed = choiceList({
    open: [],
    answers: { '3.host': { label: HOST_LABELS.github, text: null, at: '2026-10-26T10:00:00Z' }, '4.live-data': { label: LIVE_DATA.no, text: null, at: '2026-10-26T10:00:00Z' } },
    doneOrRunning: (n) => n === 3,
  });
  assert.deepEqual(listed.map((c) => [c.key, c.acted]), [['3.host', true], ['4.live-data', false]]);
});

test('step 4 settles again when live data or Apple signing now say otherwise', () => {
  const live = (label) => ({ '4.live-data': { label, text: null, at: 'x' } });
  assert.equal(stepFourDrift({ liveData: false }, live(LIVE_DATA.no)), false);
  assert.equal(stepFourDrift({ liveData: false }, live(LIVE_DATA.yes)), true);
  assert.equal(stepFourDrift({ liveData: true }, live(LIVE_DATA.no)), true);
  assert.equal(stepFourDrift(undefined, live(LIVE_DATA.no)), false);
});

test('the recommended card gains the engine line and nothing else is asked', async () => {
  const { engineLine } = await import('../../../scripts/setup/engine-parts.js');
  const product = { isNew: true, host: null, repo: null, name: 'tide-tables' };
  const without = oneCard({ folder: '/x/tide-tables', list: newProductChoices(), product, platform: 'darwin', toRun: [3, 6, 7, 10], count: 0 });
  const withEngine = oneCard({ folder: '/x/tide-tables', list: newProductChoices(), product, platform: 'darwin', toRun: [2, 3, 6, 7, 10], count: 0 });
  const lines = (c) => c.card.question.split('\n');
  assert.deepEqual(lines(withEngine).filter((l) => !lines(without).includes(l)), [`- ${engineLine()}`]);
  assert.match(engineLine(), /^Install the build engine, Archon, with its usage reporting off/);
  assert.deepEqual(withEngine.card.options, without.card.options);
  assert.deepEqual(withEngine.choices, without.choices);
  // Windows has no engine yet, so no line.
  const win = oneCard({ folder: '/x/t', list: [], product: { isNew: true, name: 't' }, platform: 'win32', toRun: [2, 3], count: 1 }).card.question;
  assert.doesNotMatch(win, /build engine/);
  // Nor on a Mac whose projects are all on GitLab: the engine builds on GitHub only.
  const gitlab = oneCard({ folder: '/x/t', list: [], product: { isNew: false, host: 'gitlab', repo: 'a/t', name: 't' }, platform: 'darwin', toRun: [2, 3], count: 1, hosts: ['gitlab'] }).card.question;
  assert.doesNotMatch(gitlab, /build engine/);
});
