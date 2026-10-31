// tests/scripts/board/model.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardModel, numberedWaiting, oneLine, seeOf } from '../../../scripts/board/model.js';
import { LINE_CHARS } from '../../../scripts/lib/core-numbers.js';
import { BUILD_QUESTION_LABELS, BUILD_QUESTION_OPTIONS, settingKey } from '../../../scripts/protection/windows-builds.js';

const NOW = new Date('2026-10-19T12:00:00.000Z');
const at = (day, hour = 0) => new Date(Date.UTC(2026, 9, day, hour)).toISOString();
let seq = 0;
const ev = (kind, when, data) => ({ v: 1, id: `e${++seq}`, at: when, computer: 'c1', kind, data });
const latest = (e, key) => ({ key, id: e.id, at: e.at, data: e.data });

// The state views as buildViews makes them, with nothing in them.
function emptyViews() {
  return {
    rulebook: [], levels: {}, settings: {}, glossary: {}, ideas: {}, rejections: {}, waiting: [],
    approvals: {}, reviews: {}, unconfirmed: [], blockers: {}, risks: {}, decisions: [], shown: {}, damaged: [],
    status: { builtAt: NOW.toISOString(), waitingCount: 0, unconfirmedCount: 0, lastMerge: null, lastEventAt: null },
  };
}

// The build loop's views, as its Task 8 builds them.
function buildLoop({ work = [], features = [], questions = [], incidents = [] } = {}) {
  return {
    work: Object.fromEntries(work.map((w) => [w.data.id, { work: { key: w.data.id, id: w.id, at: w.at, data: w.data }, approved: w.approved ?? true }])),
    features: Object.fromEntries(features.map((f) => [f.data.work, latest(f, f.data.work)])),
    questions: Object.fromEntries(questions.map((q) => [q.data.id, { question: { key: q.data.id, id: q.id, at: q.at, data: q.data }, answer: q.answer ?? null }])),
    incidents: { open: incidents },
  };
}

const usageWith = (over = {}) => ({
  week: { from: at(13), to: at(20), tokens: 1200000, usd: 84, share: 34, shareAt: at(19) },
  byPart: { 'front-desk': { tokens: 100, usd: 1 }, foreman: { tokens: 200, usd: 2 }, feature: { tokens: 900, usd: 9 } },
  bySubagents: { tokens: 50 },
  byFeature: {},
  unusual: [],
  missing: [],
  ...over,
});

const settingsWith = (phase = 'before-launch') => ({ phase: { value: phase, from: 'project' }, budget: { value: 'report', from: 'default' } });

const model = (over = {}) => boardModel({
  project: 'demo', views: emptyViews(), events: [], usage: usageWith(), health: [{ level: 'ok', text: 'Protection: Standard' }],
  settings: settingsWith(), sources: { at: at(18), sources: [], newModels: [], newLinks: [], retiring: [], releases: [], advisories: [] },
  now: () => NOW, ...over,
});

test('unconfirmed rulings, levels and settings come first', () => {
  const views = emptyViews();
  views.unconfirmed = [
    { kind: 'ruling', id: 'r1', at: at(10), data: { words: 'Never email [customers](https://x.test) on Sundays' } },
    { kind: 'level', id: 'l1', at: at(11), key: 'copy', data: { key: 'copy', value: 2 } },
    { kind: 'setting', id: 's1', at: at(12), key: 'pace', data: { key: 'pace', value: 2 } },
  ];
  const m = model({ views });
  assert.deepEqual(m.director.first, [
    'A ruling: Never email customers on Sundays, not yet confirmed by you',
    'A level: copy 2, not yet confirmed by you',
    'A setting: pace 2, not yet confirmed by you',
  ]);
  assert.deepEqual(model().director.first, []);
});

test('a profile setting not yet confirmed is listed among them, as the director\'s own', () => {
  const views = emptyViews();
  views.unconfirmed = [{ kind: 'setting', id: 's1', at: at(12), key: 'pace', data: { key: 'pace', value: 2 } }];
  const profileUnconfirmed = [
    { kind: 'setting', id: 'p1', at: at(11), key: 'briefing', data: { key: 'briefing', value: 'short', words: '# Keep it short' } },
    { kind: 'ruling', id: 'p2', at: at(13), data: { words: 'not a profile kind' } },
  ];
  assert.deepEqual(model({ views, profileUnconfirmed }).director.first, [
    'Your setting: briefing short, not yet confirmed by you',
    'A setting: pace 2, not yet confirmed by you',
  ]);
  // Without the project's views the profile's still show.
  assert.deepEqual(model({ views: null, profileUnconfirmed }).director.first, ['Your setting: briefing short, not yet confirmed by you']);
  assert.deepEqual(model({ profileUnconfirmed: 'damaged' }).director.first, []);
});

test('a proposal kept as is on its card in this project is no longer listed as waiting for confirmation', () => {
  const views = emptyViews();
  views.unconfirmed = [
    { kind: 'level', id: 'l1', at: at(11), key: 'copy', data: { key: 'copy', value: 2 } },
    { kind: 'setting', id: 's1', at: at(12), key: 'pace', data: { key: 'pace', value: 2 } },
  ];
  const profileUnconfirmed = [
    { kind: 'setting', id: 'p1', at: at(11), key: 'boardTab', data: { key: 'boardTab', value: 'build' } },
    { kind: 'setting', id: 'p2', at: at(13), key: 'briefing', data: { key: 'briefing', value: 'short' } },
  ];
  views.keptAsIs = ['l1', 'p1'];
  assert.deepEqual(model({ views, profileUnconfirmed }).director.first, [
    'A setting: pace 2, not yet confirmed by you',
    'Your setting: briefing short, not yet confirmed by you',
  ]);
  views.keptAsIs = 'damaged';
  assert.equal(model({ views, profileUnconfirmed }).director.first.length, 4);
});

test('waiting lists cards and unasked build-loop questions once each, numbered', () => {
  const askedCard = ev('card', at(12), { title: 'Pick a colour', question: 'Answer question q-login-1 about the colour' });
  const other = ev('card', at(11), { title: 'Name the app', question: 'Name the app?' });
  // Answered, so not in the waiting view, but it still names its question.
  const done = ev('card', at(10), { title: 'Ship it?', question: 'Answer question q-login-4' });
  const events = [askedCard, other, done, ev('card-answer', at(13), { question: 'Answer question q-login-4', label: 'Not now' })];
  const questions = [
    { ...ev('question', at(9), { id: 'q-login-1', work: 'login', what: 'Which colour?', why: '', options: [], recommendation: '', level: 3 }) },
    { ...ev('question', at(8), { id: 'q-login-2', work: 'login', what: 'Email or phone sign-in?', why: '', options: [], recommendation: '', level: 3 }) },
    { ...ev('question', at(7), { id: 'q-login-3', work: 'login', what: 'Answered already', why: '', options: [], recommendation: '', level: 3 }), answer: { label: 'Yes', at: at(8) } },
    { ...ev('question', at(6), { id: 'q-login-4', work: 'login', what: 'Asked on a card already', why: '', options: [], recommendation: '', level: 3 }) },
  ];
  const views = { ...emptyViews(), ...buildLoop({ questions }) };
  // The cards waiting are the waiting view's, whatever the events say.
  views.waiting = [askedCard, other].map((e) => ({ id: e.id, at: e.at, data: e.data }));
  const m = model({ views, events });
  assert.deepEqual(m.director.waiting, [
    { n: 1, id: 'q:q-login-2', what: 'Email or phone sign-in?', since: at(8) },
    { n: 2, id: other.id, what: 'Name the app', since: at(11) },
    { n: 3, id: askedCard.id, what: 'Pick a colour', since: at(12) },
  ]);
});

test('the board\'s waiting items carry ids, and numberedWaiting numbers them the same way', () => {
  const card = ev('card', at(12), { title: 'Pick a colour', question: 'Pick a colour?' });
  const questions = [
    { ...ev('question', at(8), { id: 'q-login-2', work: 'login', what: 'Email or phone sign-in?', why: '', options: [], recommendation: '', level: 3 }) },
  ];
  const views = { ...emptyViews(), ...buildLoop({ questions }), waiting: [{ id: card.id, at: card.at, data: card.data }] };
  const m = model({ views, events: [card] });
  const items = numberedWaiting(views, [card]);
  assert.deepEqual(m.director.waiting.map((w) => [w.n, w.id]), items.map((i) => [i.n, i.id]));
  assert.deepEqual(items.map((i) => i.id), ['q:q-login-2', card.id]);
  assert.equal(items[0].question, 'q-login-2');
  assert.equal(items[1].card, card.id);
});

test('a Windows build-commands proposal is not listed as not yet confirmed: only its own card confirms it', () => {
  const views = emptyViews();
  views.unconfirmed = [
    { kind: 'setting', id: 's1', at: at(12), key: 'pace', data: { key: 'pace', value: 2 } },
    { kind: 'setting', id: 's2', at: at(13), key: settingKey('0a1b2c3d'), data: { key: settingKey('0a1b2c3d'), value: 'unattended' } },
    { kind: 'setting', id: 's3', at: at(14), data: { key: settingKey('0a1b2c3d'), value: 'unattended' } },
  ];
  assert.deepEqual(model({ views }).director.first, ['A setting: pace 2, not yet confirmed by you']);
});

// A build-command question as the feature CLI writes it.
const buildQuestion = (when, id, work, over = {}) => ev('question', when, {
  id, work, kind: 'build-command', what: `Let this feature's builder run its tests (${id})`, why: 'w',
  options: BUILD_QUESTION_OPTIONS, recommendation: BUILD_QUESTION_LABELS.once, level: 3, commands: ['npm test', 'npm run build'], ...over,
});

test('a build-command question waiting is named by its commands, with what it says beside them', () => {
  const questions = [
    buildQuestion(at(8), 'q-login-1', 'login', { what: 'Run the [tests](https://x.test)' }),
    buildQuestion(at(9), 'q-login-2', 'login', { what: '' }),
    // Not a build-command question (another recommendation), so shown as today.
    buildQuestion(at(10), 'q-login-3', 'login', { what: 'Anything at all', recommendation: BUILD_QUESTION_LABELS.feature }),
  ];
  const m = model({ views: { ...emptyViews(), ...buildLoop({ questions }) } });
  assert.deepEqual(m.director.waiting, [
    { n: 1, id: 'q:q-login-1', what: 'Run npm test, npm run build: Run the tests', since: at(8) },
    { n: 2, id: 'q:q-login-2', what: 'Run npm test, npm run build', since: at(9) },
    { n: 3, id: 'q:q-login-3', what: 'Anything at all', since: at(10) },
  ]);
});

test('a feature held by Not now to its build commands reads as waiting on the director, not building', () => {
  const work = ['login', 'search', 'dark', 'maps', 'share', 'help'].map((id) => ({ ...ev('work', at(1), { id, title: `Work ${id}`, lane: 'feature', visible: true, dependsOn: [] }) }));
  const features = work.map((w) => ev('feature', at(2), { work: w.data.id, step: 'building' }));
  const notNow = (when, id) => ev('card-answer', when, { question: `May the builder run npm test?\n\nAnswer question ${id}`, label: BUILD_QUESTION_LABELS.notNow });
  const questions = [
    buildQuestion(at(3), 'q-login-1', 'login'),
    // Not now, then asked again: the newer question decides.
    buildQuestion(at(3), 'q-search-1', 'search'),
    buildQuestion(at(5), 'q-search-2', 'search'),
    // Not now, then a report: the feature has moved on.
    buildQuestion(at(3), 'q-dark-1', 'dark'),
    // A card-answer that names two questions, or another question, isn't an exact match.
    buildQuestion(at(3), 'q-maps-1', 'maps'),
    // Not a build-command question.
    buildQuestion(at(3), 'q-share-1', 'share', { recommendation: BUILD_QUESTION_LABELS.feature }),
    // Not now from before the question was recorded.
    buildQuestion(at(6), 'q-help-1', 'help'),
  ];
  const events = [
    notNow(at(4), 'q-login-1'),
    notNow(at(4), 'q-search-1'),
    notNow(at(4), 'q-dark-1'),
    ev('report', at(5), { work: 'dark', outcome: 'blocked', summary: 's', rulings: [] }),
    ev('card-answer', at(4), { question: 'Answer question q-maps-1 and Answer question q-maps-2', label: BUILD_QUESTION_LABELS.notNow }),
    ev('card-answer', at(4), { question: 'Answer question q-maps-10', label: BUILD_QUESTION_LABELS.notNow }),
    notNow(at(4), 'q-share-1'),
    notNow(at(5), 'q-help-1'),
    // Another label isn't Not now.
    ev('card-answer', at(4), { question: 'Answer question q-maps-1', label: 'Explain more' }),
  ];
  const m = model({ views: { ...emptyViews(), ...buildLoop({ work, features, questions }) }, events });
  const steps = Object.fromEntries(m.build.features.map((f) => [f.work, f.step]));
  assert.deepEqual(steps, {
    login: 'waiting on you to allow its build commands',
    search: 'building',
    dark: 'building',
    maps: 'building',
    share: 'building',
    help: 'building',
  });
  assert.deepEqual(m.director.inProgress.feature[0], { title: 'Work login', step: 'waiting on you to allow its build commands', see: 'In your briefing when it is done' });
});

test('launch progress counts resolved blockers', () => {
  const views = { ...emptyViews(), ...buildLoop({
    work: [
      { ...ev('work', at(5), { id: 'signup', title: 'Sign-up page', lane: 'small', visible: true, dependsOn: [], place: 2 }) },
      { ...ev('work', at(6), { id: 'billing', title: 'Billing', lane: 'feature', visible: true, dependsOn: [], place: 1 }) },
      { ...ev('work', at(4), { id: 'login', title: 'Log in', lane: 'feature', visible: true, dependsOn: [] }) },
      { ...ev('work', at(4), { id: 'draft', title: 'Not approved yet', lane: 'small', visible: true, dependsOn: [] }), approved: false },
    ],
    features: [ev('feature', at(7), { work: 'login', step: 'building' })],
  }) };
  const b1 = ev('blocker', at(1), { key: 'login', what: 'No sign-in', resolved: true });
  const b2 = ev('blocker', at(2), { key: 'terms', what: 'No [terms](https://x.test) page' });
  const b3 = ev('blocker', at(3), { key: 'help', what: 'No help page' });
  views.blockers = { login: latest(b1, 'login'), terms: latest(b2, 'terms'), help: latest(b3, 'help') };
  views.ideas = {
    dark: latest(ev('idea', at(1), { key: 'dark', text: 'Dark mode', when: 'now' }), 'dark'),
    share: latest(ev('idea', at(2), { key: 'share', text: 'Share links', when: 'next' }), 'share'),
    maps: latest(ev('idea', at(3), { key: 'maps', text: 'Maps' }), 'maps'),
  };
  const m = model({ views, settings: settingsWith('launched') });
  assert.deepEqual(m.director.launch, {
    phase: 'launched', resolved: 1, gained: 0, total: 3, blockers: ['No terms page', 'No help page'], next: ['Dark mode', 'Billing', 'Sign-up page'],
  });
  assert.deepEqual(m.director.ideas, { now: ['Dark mode'], next: ['Share links'], later: ['Maps'] });
});

test('work in progress is grouped by lane from the build loop\'s views', () => {
  const views = { ...emptyViews(), ...buildLoop({
    work: [
      { ...ev('work', at(1), { id: 'login', title: 'Log in', lane: 'feature', visible: true, dependsOn: [] }) },
      { ...ev('work', at(1), { id: 'typo', title: 'Fix the footer typo', lane: 'quick', visible: true, dependsOn: [] }) },
      { ...ev('work', at(1), { id: 'crash', title: 'Crash on save', lane: 'bug', visible: true, dependsOn: [] }) },
      { ...ev('work', at(1), { id: 'old', title: 'Old work', lane: 'small', visible: true, dependsOn: [] }) },
    ],
    features: [
      ev('feature', at(2), { work: 'login', step: 'building', slice: { n: 2, m: 4 } }),
      ev('feature', at(3), { work: 'typo', step: 'started' }),
      ev('feature', at(4), { work: 'crash', step: 'paused' }),
      ev('feature', at(5), { work: 'old', step: 'closed' }),
    ],
  }) };
  const events = [ev('report', at(3), { work: 'login', outcome: 'blocked', pr: 12, summary: 'Waiting on CI', rulings: [] })];
  const m = model({ views, events });
  assert.deepEqual(m.director.inProgress, {
    quick: [{ title: 'Fix the footer typo', step: 'started', see: 'In your briefing when it is done' }],
    small: [],
    feature: [{ title: 'Log in', step: 'building', see: 'In your briefing when it is done' }],
    bug: [{ title: 'Crash on save', step: 'paused', see: 'In your briefing when it is done' }],
  });
  assert.deepEqual(m.build.features, [
    { work: 'login', title: 'Log in', lane: 'feature', step: 'building', slice: { n: 2, m: 4 }, pr: 12 },
    { work: 'typo', title: 'Fix the footer typo', lane: 'quick', step: 'started', slice: null, pr: null },
    { work: 'crash', title: 'Crash on save', lane: 'bug', step: 'paused', slice: null, pr: null },
  ]);
});

test('a pull request\'s review state comes from the signed reviews', () => {
  const views = emptyViews();
  const r = (pr, commit, when, verdict, findings) => ev('review', when, { pr, commit, verdict, findings });
  views.reviews = {
    3: { aaa: r(3, 'aaa', at(10), 'FINDINGS', 2), bbb: r(3, 'bbb', at(11), 'CLEAN', 0) },
    4: { ccc: r(4, 'ccc', at(12), 'FINDINGS', 3) },
    9: { ddd: r(9, 'ddd', at(12), 'CLEAN', 0) },
  };
  views.approvals = { 5: { eee: ev('approval', at(12), { pr: 5, commit: 'eee' }) } };
  const events = [
    ev('merge', at(13), { pr: 9, commit: 'ddd' }),
    ev('report', at(12), { work: 'login', outcome: 'blocked', pr: 4, summary: '', rulings: [] }),
  ];
  const m = model({ views, events });
  assert.deepEqual(m.build.pullRequests, [
    { pr: 3, work: null, review: 'clean', findings: 0, blocked: null },
    { pr: 4, work: 'login', review: 'findings', findings: 3, blocked: '' },
    { pr: 5, work: null, review: 'none', findings: null, blocked: null },
  ]);
});

test('a pull request whose work\'s latest report says blocked carries its reason, until a later report says otherwise', () => {
  const report = (when, data) => ev('report', when, { work: 'export', summary: '', rulings: [], ...data });
  const blocked = report(at(10), { outcome: 'blocked', pr: 17, summary: 'Checks red on #17:\nthe [orders](https://x.test) test fails' });
  const prs = (events) => model({ events }).build.pullRequests;
  assert.deepEqual(prs([blocked]), [{ pr: 17, work: 'export', review: 'none', findings: null, blocked: 'Checks red on #17: the orders test fails' }]);
  // A later report for the work that isn't blocked takes it out; one that ends the pull request takes the pull request out.
  assert.deepEqual(prs([blocked, report(at(11), { outcome: 'closed' })]), [{ pr: 17, work: 'export', review: 'none', findings: null, blocked: null }]);
  assert.deepEqual(prs([blocked, report(at(11), { outcome: 'merged', pr: 17 })]), []);
  // The work's latest report speaks for its own pull request only.
  assert.deepEqual(prs([report(at(9), { outcome: 'blocked', pr: 16 }), report(at(10), { outcome: 'blocked', pr: 17, summary: 'Stuck' })]), [
    { pr: 16, work: 'export', review: 'none', findings: null, blocked: null },
    { pr: 17, work: 'export', review: 'none', findings: null, blocked: 'Stuck' },
  ]);
});

test('quality counts this week\'s reviews and their findings', () => {
  const views = emptyViews();
  const r = (pr, commit, when, verdict, findings) => ev('review', when, { pr, commit, verdict, findings });
  views.reviews = {
    3: { aaa: r(3, 'aaa', at(14), 'FINDINGS', 2), bbb: r(3, 'bbb', at(15), 'CLEAN', 0) },
    4: { ccc: r(4, 'ccc', at(16), 'FINDINGS', 3) },
    5: { old: r(5, 'old', at(2), 'FINDINGS', 7) },
  };
  assert.deepEqual(model({ views }).build.quality, { reviews: 3, withFindings: 2, findings: 5 });
  // With no usage figures, this week is the last seven days.
  assert.deepEqual(model({ views, usage: null }).build.quality, { reviews: 3, withFindings: 2, findings: 5 });
});

test('text from events becomes one capped line, with links and headings taken out', () => {
  assert.equal(oneLine('# Title\n\n- see [the docs](https://x.test) and ![a chart](https://x.test/c.png)'), 'Title see the docs and a chart');
  assert.equal(oneLine('> quoted\n1. first\n* second\n```js\nrun `code`\n```'), 'quoted first second run code');
  assert.equal(oneLine('  lots \t of\r\n space  '), 'lots of space');
  // Links inside links, and leftover brackets, never make a link.
  assert.equal(oneLine('[[x](y)](https://evil.test)'), 'x');
  assert.equal(oneLine('[![a](b)](https://evil.test) and [c][d]'), 'a and c');
  assert.equal(oneLine('[x] (https://e.test) [y](https://e.test/(z))'), 'x (https://e.test) y (https://e.test/(z))');
  // Heading, list and quote marks however they are nested or indented.
  for (const text of ['- # Heading', '1. ## Heading', '> - # Heading', '## ## Heading', '    # Heading', '####### Heading', '[# Heading](https://e.test)']) {
    assert.equal(oneLine(text), 'Heading', text);
  }
  // HTML tags are taken out; an autolink keeps its address as text.
  assert.equal(oneLine('<b>bold</b> <img src=x onerror=y> <https://e.test> 1 < 2'), 'bold https://e.test 1 2');
  // A tag taken out can't leave another behind, and no < or > is left at all.
  assert.equal(oneLine('<img<b> src=x onerror=alert(1)>'), '');
  assert.equal(oneLine('<a<b> href="https://evil.test">click</a>'), 'click');
  assert.equal(oneLine('<<script>script>alert(1)<</script>/script>'), 'script alert(1) /script');
  assert.equal(oneLine('write to <mailto:a@b.test> or <a@b.test>'), 'write to mailto:a@b.test or a@b.test');
  // Deep nesting is cut before it is read, so it stays quick.
  const started = Date.now();
  const deep = oneLine(`${'[<'.repeat(50000)}x${'>](y)'.repeat(50000)}`);
  assert.ok(deep.length <= LINE_CHARS && !/[<>[\]]/.test(deep));
  assert.ok(Date.now() - started < 2000);
  // Read twice, a line reads the same.
  const adversarial = [
    '[[x](y)](https://evil.test)', '- # Heading', '> - # H', '    # Heading', '- ~~~ code', '[~~~ x](y)', '[# x](y) [- z](w)',
    '<img<b> src=x onerror=alert(1)>', '<a<b> href="https://evil.test">click</a>', '<<script>script>alert(1)<</script>/script>',
    '1 < 2 > 0', '```js\n# a\n```', `${'x '.repeat(150)}[y](z)`, '[a](b(c))', '- [ ] task', '> > ## [deep](u) <b>x</b>',
  ];
  for (const text of adversarial) assert.equal(oneLine(oneLine(text)), oneLine(text), text);
  assert.equal(oneLine(undefined), '');
  assert.equal(oneLine(42), '42');
  const long = oneLine('word '.repeat(100));
  assert.equal(long.length, LINE_CHARS);
  assert.ok(long.endsWith('…'));

  // Event text on the board goes through it.
  const views = emptyViews();
  const risk = ev('risk', at(1), { key: 'rates', what: '## Rates [typed in](https://x.test)\nby hand', costLater: '`A day`' });
  views.risks = { rates: latest(risk, 'rates') };
  views.decisions = [{ id: 'd1', at: at(2), data: { what: '# Kept *the* list', why: 'x'.repeat(300), level: 2 } }];
  const events = [ev('merge', at(3), { pr: 7, commit: 'abc', forUsers: '### New: [dark mode](https://x.test)' }), ev('merge', at(4), { pr: 8, commit: 'abd' })];
  const m = model({ views, events });
  assert.deepEqual(m.build.risks, [{ what: 'Rates typed in by hand', costLater: 'A day' }]);
  assert.equal(m.director.rulings[0].what, 'Kept *the* list');
  assert.equal(m.build.decisions[0].why.length, LINE_CHARS);
  assert.deepEqual(m.director.changed, [{ what: 'Pull request #8 merged', at: at(4), behind: true }, { what: 'New: dark mode', at: at(3) }]);
});

test('with no build-loop views, no state and no usage, the model is built and names each missing piece', () => {
  const m = boardModel({ project: 'demo', now: () => NOW });
  assert.equal(m.project, 'demo');
  assert.equal(m.builtAt, NOW.toISOString());
  assert.deepEqual(m.director.waiting, []);
  assert.deepEqual(m.director.first, []);
  assert.deepEqual(m.director.inProgress, { quick: [], small: [], feature: [], bug: [] });
  assert.deepEqual(m.director.ideas, { now: [], next: [], later: [] });
  assert.equal(m.director.budget.setting, 'report');
  assert.deepEqual(m.build.features, []);
  assert.deepEqual(m.build.quality, { reviews: 0, withFindings: 0, findings: 0 });
  for (const line of [
    'There is no state for this project on this computer yet',
    'The build loop isn\'t running yet',
    'Usage counts aren\'t on yet',
  ]) assert.equal(m.missing.filter((x) => x === line).length, 1, line);
  assert.equal(new Set(m.missing).size, m.missing.length);

  // State without the build loop's views names only that.
  const some = model();
  assert.deepEqual(some.missing, ['The build loop isn\'t running yet']);
  // Usage's own missing lines come through.
  const noTokens = model({ usage: usageWith({ missing: ['Token counts start once setup switches on usage counting on this computer'] }) });
  assert.ok(noTokens.missing.includes('Token counts start once setup switches on usage counting on this computer'));
});

test('damaged records are counted in missing, and damaged inputs never throw', () => {
  const views = emptyViews();
  views.damaged = ['events/2026/10/x.json: not JSON', 'an event with a repeated id: e9 (idea, 2026-10-18T00:00:00.000Z)'];
  views.risks = { odd: { key: 'odd', id: 'x', at: at(1), data: null } };
  views.decisions = [null, { id: 'd', at: at(1), data: { what: 'Ok', level: 2 } }];
  views.reviews = { 3: { aaa: null } };
  const events = [null, 'junk', { kind: 'merge' }, ev('merge', 'not a time', { pr: 'x' })];
  let m;
  assert.doesNotThrow(() => { m = model({ views, events }); });
  assert.ok(m.missing.includes('2 records couldn\'t be read'));
  assert.deepEqual(m.director.rulings, [{ what: 'Ok', at: at(1) }]);
  // A view of the wrong shape altogether still builds the board.
  assert.doesNotThrow(() => boardModel({ project: 'demo', views: { blockers: 'nonsense', reviews: [1, 2], work: 5, features: 'x' }, events: 'junk', usage: 7, health: 'x', settings: [], sources: 'x', now: NOW }));
});

test('budget shows the week and unusual use in its own unit; open incidents and sources to watch join health', () => {
  const usage = usageWith({
    unusual: [
      { kind: 'session', id: 'session:abc', tokens: 3000000, median: 400000, cause: 'Mostly feature work on login', unit: 'tokens' },
      { kind: 'day', id: 'day:2026-10-18', tokens: 42.5, median: 6, cause: 'Mostly foreman work', unit: 'usd' },
    ],
  });
  const views = { ...emptyViews(), ...buildLoop({ incidents: [{ id: 'leak', what: 'Emails [sent](https://x.test) twice', at: at(18), fixes: [] }] }) };
  const sources = {
    at: at(18), sources: [], newModels: [], newLinks: [], releases: [],
    retiring: [{ model: 'm-old', date: '2026-11-01', routed: true, soon: true }, { model: 'm-other', date: '2026-11-01', routed: false, soon: true }],
    advisories: [{ repo: 'owner/repo', id: 'GHSA-1', summary: '# Bad [thing](https://x.test)', at: at(17) }],
  };
  const m = model({ usage, views, sources });
  assert.deepEqual(m.director.budget.week, { from: at(13), to: at(20), tokens: 1200000, usd: 84 });
  assert.equal(m.director.budget.share, 34);
  assert.deepEqual(m.director.budget.unusual, [
    'One session used 3.0M tokens, against a usual 400K: Mostly feature work on login',
    '18 October 2026 used $43, against a usual $6: Mostly foreman work',
  ]);
  assert.deepEqual(m.build.usage, { ...usage.byPart, subagents: 50 });
  const texts = m.director.health.map((l) => l.text);
  assert.equal(texts[0], 'Protection: Standard');
  assert.ok(texts.includes('Incident leak is open, so nothing merges: Emails sent twice'));
  assert.equal(m.director.health.find((l) => l.text.startsWith('Incident leak')).incident, 'leak');
  assert.ok(texts.includes('m-old, a model your projects use, retires on 1 November 2026'));
  assert.ok(texts.includes('A security advisory for owner/repo: Bad thing'));
  assert.ok(!texts.some((t) => t.includes('m-other')));
});

test('event times reach the model only as strict UTC times', () => {
  const views = emptyViews();
  const loose = 'Oct 18 2026 (## H\n[x](https://e.test))';
  views.decisions = [{ id: 'd1', at: loose, data: { what: 'A', level: 2 } }, { id: 'd2', at: at(5), data: { what: 'B', level: 2 } }];
  views.waiting = [{ id: 'c1', at: '2026-10-18', data: { title: 'T' } }];
  const events = [ev('merge', loose, { pr: 3 }), ev('report', '2026-10-18T00:00:00+01:00', { work: 'w', outcome: 'merged', summary: '', rulings: ['R'] })];
  const m = model({ views, events, usage: usageWith({ week: { from: loose, to: at(20), tokens: 1, usd: 1, share: null } }) });
  assert.deepEqual(m.director.rulings, [{ what: 'B', at: at(5) }, { what: 'A', at: null }]);
  assert.ok(m.build.decisions.every((d) => d.at === null || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(d.at)));
  assert.equal(m.build.decisions.find((d) => d.what === 'R').at, null);
  assert.deepEqual(m.director.waiting, [{ n: 1, id: 'c1', what: 'T', since: null }]);
  assert.deepEqual(m.director.changed, []);
  assert.equal(m.director.budget.week.from, null);

  // A date that rolls over is no time; one without milliseconds, or with fewer, is.
  const times = emptyViews();
  times.decisions = ['2026-02-30T00:00:00Z', '2026-10-18T24:00:00Z', '2026-10-18T00:00:60Z', '2026-10-18T00:00:00Z', '2026-10-18T00:00:00.5Z']
    .map((when, i) => ({ id: `t${i}`, at: when, data: { what: `t${i}`, level: 2 } }));
  const read = Object.fromEntries(model({ views: times }).director.rulings.map((r) => [r.what, r.at]));
  assert.deepEqual(read, { t0: null, t1: null, t2: null, t3: '2026-10-18T00:00:00Z', t4: '2026-10-18T00:00:00.5Z' });
});

test('a clock that can\'t be read is named, not replaced by this computer\'s', () => {
  for (const now of [() => new Date('nonsense'), 'nonsense', undefined, null, true, () => null, 'Oct 18 2026', NaN, Infinity, 1e20,
    () => { throw new Error('no clock'); }]) {
    const m = model({ now });
    assert.equal(m.builtAt, null);
    assert.ok(m.missing.includes('The Logbook\'s clock couldn\'t be read'));
  }
  assert.ok(!model().missing.includes('The Logbook\'s clock couldn\'t be read'));
  for (const now of [NOW, NOW.getTime(), () => NOW.getTime()]) assert.equal(model({ now }).builtAt, NOW.toISOString());
});

test('a review of an older commit doesn\'t speak for the pull request\'s head', () => {
  const views = emptyViews();
  views.reviews = {
    3: { aaa: ev('review', at(10), { pr: 3, commit: 'aaa', verdict: 'CLEAN', findings: 0 }) },
    4: { ccc: ev('review', at(10), { pr: 4, commit: 'ccc', verdict: 'CLEAN', findings: 0 }) },
  };
  views.approvals = {
    3: { bbb: ev('approval', at(11), { pr: 3, commit: 'bbb' }) },
    4: { ccc: ev('approval', at(11), { pr: 4, commit: 'ccc' }) },
  };
  assert.deepEqual(model({ views }).build.pullRequests, [
    { pr: 3, work: null, review: 'none', findings: null, blocked: null },
    { pr: 4, work: null, review: 'clean', findings: 0, blocked: null },
  ]);
});

test('usage figures that aren\'t numbers read as unknown', () => {
  const m = model({ usage: usageWith({ byPart: { 'front-desk': { tokens: '12', usd: NaN }, foreman: null }, bySubagents: { tokens: '5' } }) });
  assert.deepEqual(m.build.usage, {
    'front-desk': { tokens: null, usd: null }, foreman: { tokens: null, usd: null }, feature: { tokens: null, usd: null }, subagents: null,
  });
});

test('build decisions join the decisions and the rulings from build-loop reports, newest first, at most 20', () => {
  const views = emptyViews();
  views.decisions = Array.from({ length: 15 }, (_, i) => ({ id: `d${i}`, at: at(1, i), data: { what: `d${i}`, why: 'w', level: i % 2 ? 2 : 1 } })).reverse();
  const events = [ev('report', at(2), { work: 'login', outcome: 'merged', pr: 4, summary: 's', rulings: ['Kept the old URL', 'Used the house font'] })];
  for (let i = 0; i < 8; i++) events.push(ev('report', at(3, i), { work: `w${i}`, outcome: 'merged', summary: '', rulings: [`r${i}`] }));
  const m = model({ views, events });
  assert.equal(m.build.decisions.length, 20);
  assert.deepEqual(m.build.decisions[0], { what: 'r7', why: '', at: at(3, 7) });
  assert.ok(m.build.decisions.some((d) => d.what === 'Kept the old URL'));
  assert.equal(m.director.rulings.length, 7);
  assert.equal(m.director.rulings[0].what, 'd13');
});

test('a piece of work is seen before it merges where it is shown first, else in the briefing', () => {
  assert.equal(seeOf({ work: { data: { shownFirst: true } } }), 'Before it merges');
  assert.equal(seeOf({ approval: { shownFirst: true } }), 'Before it merges');
  assert.equal(seeOf({ work: { data: { shownFirst: false } } }), 'In your briefing when it is done');
  for (const odd of [undefined, null, 'x', {}, { work: 5 }]) assert.equal(seeOf(odd), 'In your briefing when it is done');
  const views = { ...emptyViews(), ...buildLoop({
    work: [
      { ...ev('work', at(1), { id: 'login', title: 'Log in', lane: 'feature', visible: true, dependsOn: [], shownFirst: true }) },
      { ...ev('work', at(1), { id: 'typo', title: 'Fix a typo', lane: 'quick', visible: true, dependsOn: [] }) },
    ],
    features: [ev('feature', at(2), { work: 'login', step: 'building' }), ev('feature', at(3), { work: 'typo', step: 'building' })],
  }) };
  const m = model({ views });
  assert.equal(m.director.inProgress.feature[0].see, 'Before it merges');
  assert.equal(m.director.inProgress.quick[0].see, 'In your briefing when it is done');
});

test('launch counts the blockers cleared since the last briefing', () => {
  const views = emptyViews();
  const done = (key, day) => latest(ev('blocker', at(day), { key, what: key, resolved: true }), key);
  views.blockers = { a: done('a', 2), b: done('b', 5), c: done('c', 6), d: latest(ev('blocker', at(7), { key: 'd', what: 'd' }), 'd') };
  assert.equal(model({ views }).director.launch.gained, 0);
  assert.equal(model({ views, since: at(4) }).director.launch.gained, 2);
  assert.equal(model({ views, since: at(6) }).director.launch.gained, 0);
  assert.equal(model({ views, since: 'not a time' }).director.launch.gained, 0);
});

test('a waiting card with parts is named by its ask and carries its own words', () => {
  const parts = {
    ask: 'Approve the sign-in page?', what: 'Sign-in works on phones.', small: 'Small feature', why: 'it changes what users see',
    meanwhile: 'If not now, it waits; nothing else is held up.', recommendation: 'Approve, because the checks passed.', optional: 3,
  };
  const views = emptyViews();
  views.waiting = [
    { id: 'c1', at: at(1), data: { question: 'The whole card text, long', parts, level: 3 } },
    { id: 'c2', at: at(2), data: { title: 'Plain card' } },
    { id: 'c3', at: at(3), data: { title: 'Same words', parts: { ask: 'Same', what: 'Same', why: 'because' } } },
  ];
  const m = model({ views });
  assert.deepEqual(m.director.waiting, [
    {
      n: 1, id: 'c1', what: 'Approve the sign-in page?', since: at(1), line: 'Sign-in works on phones.', small: 'Small feature',
      meanwhile: 'If not now, it waits; nothing else is held up.', recommendation: 'Approve, because the checks passed.', level: 3, optional: 3,
    },
    { n: 2, id: 'c2', what: 'Plain card', since: at(2) },
    { n: 3, id: 'c3', what: 'Same', since: at(3), line: 'because' },
  ]);
});

test('while the premium model rests, the board says so in one line, until its rest ends', () => {
  const rest = { kind: 'premium-rest', id: 'r1', at: at(10), data: { why: 'limit', at: at(10), until: '2026-10-27T01:00:00.000Z' } };
  const lines = (now, events = [rest]) => model({ events, now: () => new Date(now) }).director.health.filter((l) => /Premium model/.test(l.text));
  const [line] = lines(NOW);
  assert.equal(line.level, 'watch');
  assert.equal(line.text, 'Premium model not available, so design is on the most capable model: it reached its usage limit. It is tried again from 27 October 2026.');
  assert.match(lines(NOW, [{ ...rest, data: { ...rest.data, why: 'billing' } }])[0].text, /it was refused for billing/);
  assert.deepEqual(lines('2026-10-27T02:00:00.000Z'), []);
  assert.deepEqual(lines(NOW, []), []);
});

test('the Logbook says checks ran on this computer, and no director-facing line holds commit status', () => {
  const check = (result, minutes, at) => ({ kind: 'check', at, data: { result, minutes } });
  const lines = (events) => model({ events }).director.health.map((l) => l.text).filter((t) => /[Cc]hecks ran|counting|commit status/.test(t));
  assert.deepEqual(lines([check('failed', 1, '2026-10-30T00:00:00Z'), check('passed', 3, '2026-10-31T00:00:00Z')]), ['Checks ran on this computer: passed, 3 minutes.']);
  assert.deepEqual(lines([check('failed', 0.4, '2026-10-31T00:00:00Z')]), ['Checks ran on this computer: failed, 1 minute.']);
  assert.deepEqual(lines([check('could-not-run', 0, '2026-10-31T00:00:00Z')]), ['Checks ran on this computer: couldn\'t run.']);
  assert.deepEqual(lines([]), []);
});

test('while tests aren\'t counting, the First Mate offers to add or repair them', () => {
  const state = (s, at) => ({ kind: 'checks-state', at, data: { state: s, why: 'director' } });
  const watch = (events) => model({ events }).director.health.filter((l) => l.level === 'watch' && /counting/.test(l.text)).map((l) => l.text);
  assert.deepEqual(watch([state('not-counting', '2026-10-30T00:00:00Z')]), ['Tests aren\'t counting yet: ask the First Mate to add tests or repair them']);
  assert.deepEqual(watch([state('not-counting', '2026-10-30T00:00:00Z'), state('counting', '2026-10-31T00:00:00Z')]), []);
});
