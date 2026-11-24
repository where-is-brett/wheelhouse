// tests/scripts/setup/choices.test.js
// Setup's one recommended card and its choices (design section 15.1): the card's words, what its
// Go ahead stands for and records, when a Go ahead holds, and which choices Customise asks next.
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {
  openChoices, oneCard, setupTime, consentHolds, consentWithdrawn, customiseBatch, aboutOf, actedBy, GO_AHEAD, CUSTOMISE, PER_CARD, USE_GITLAB, gitlabSince, gitlabBatch, gitlabCard,
} from '../../../scripts/setup/choices.js';
import { stepFourDrift, choiceList } from '../../../scripts/setup/redo.js';
import { COMPANY_GITLAB, NEW_PRODUCT, HOST_LABELS, WAYS, REAL_USERS, STRICTER } from '../../../scripts/setup/host.js';
import { LIVE_DATA, PHONE, PRODUCT } from '../../../scripts/setup/questions.js';
import { PUT_ON_GITLAB, KEEP_HERE } from '../../../scripts/setup/local.js';
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

test('the one card says a compaction rule found is kept, and nothing is said when there is none', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-card-compact-'));
  try {
    fs.mkdirSync(path.join(folder, '.claude'));
    const ask = () => oneCard({ folder, list: [], product: { isNew: false, host: 'local', repo: null, name: 'tides' }, platform: 'darwin', toRun: [7], count: 1, claudeHome: path.join(folder, 'none') }).card.question;
    assert.doesNotMatch(ask(), /compact/);
    fs.writeFileSync(path.join(folder, '.claude', 'settings.json'), JSON.stringify({ env: { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: 35 } }));
    assert.match(ask(), /- You already set Claude Code to tidy a long chat at 35% full in the project's settings: I keep it and add nothing of my own\./);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('the one card names the phone setting as Claude Desktop\'s alone when the session is a terminal', () => {
  const ask = (desktop) => oneCard({ folder: '/x/t', list: newProductChoices(), product: { isNew: true, host: null, repo: null, name: 't' }, platform: 'darwin', toRun: [3, 6, 7, 10], count: 0, desktop }).card.question;
  assert.match(ask(true), /and Claude Code allowed to send phone notifications, which you finish near the end\./);
  // The phone question's answer is on the list: skipped in a terminal (its recommendation), and the plan says no test is run now.
  const phoneSkipped = [...newProductChoices(), { step: 4, id: 'phone', key: '4.phone', card: { recommend: PHONE.skip, options: [] }, typed: false, writes: undefined, chosen: null, label: PHONE.skip, text: null }];
  const skipped = oneCard({ folder: '/x/t', list: phoneSkipped, product: { isNew: true, host: null, repo: null, name: 't' }, platform: 'darwin', toRun: [3, 6, 7, 10], count: 0, desktop: false });
  assert.match(skipped.card.question, /and Claude Code allowed to send phone notifications, with no phone test now\./);
  assert.doesNotMatch(skipped.card.options[0].description, /phone/);
  const pushed = oneCard({ folder: '/x/t', list: newProductChoices(), product: { isNew: true, host: null, repo: null, name: 't' }, platform: 'darwin', toRun: [3, 6, 7, 10], count: 0, desktop: false, pushed: true }).card.question;
  assert.match(pushed, /and phone notifications on, since Wheelhouse's records show an earlier setup on this computer reached your phone\./);
  assert.doesNotMatch(pushed, /with no phone test now/);
});

test('the one card for a new product on a Mac says the director\'s approved words, a plain line each', () => {
  const { card, choices, writes, id } = oneCard({
    folder: '/x/tide-tables', list: newProductChoices(), product: { isNew: true, host: null, repo: null, name: 'tide-tables' }, platform: 'darwin', toRun: [3, 6, 7, 10], count: 0,
  });
  assert.equal(card.question, [
    'Set up Wheelhouse for tide-tables?',
    'Here\'s what I recommend. It takes about 5 minutes.',
    '- A new product, in a private repository on your GitHub account.',
    '- Agents use your ordinary GitHub sign-in, which reaches your whole account; on this Mac the sandbox keeps agents\' commands away from your Mac\'s saved passwords, where that sign-in is kept, unless this project is an iPhone or Mac app (making those needs your saved passwords, so agents\' commands can reach them).',
    '- Before launch: no real users and no live data yet.',
    '- On this computer: usage counted here only; 30 days of chat history kept; Claude Code takes only its well-tried updates; and Claude Code allowed to send phone notifications, which you finish near the end.',
    '- Wheelhouse\'s settings saved to the project, and its main line protected if your GitHub plan allows it (the free plan doesn\'t for a private repository).',
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

test('Go ahead on a narrow GitLab way with GitLab\'s tool names the token that may stand in for a project key', () => {
  const list = newProductChoices({ connection: WAYS.narrow }).map((c) => (c.id === 'host' ? { ...c, label: HOST_LABELS.gitlab } : c));
  const { card } = oneCard({ folder: '/x/tide-tables', list, product: { isNew: true, host: null, repo: null, name: 'tide-tables' }, platform: 'win32', toRun: [3, 6, 7, 10], count: 0 });
  assert.match(card.options[0].description, /You'll sign in on GitLab pages that open and click through them\. Windows may ask you to click Yes to let an installer run, or for an administrator's password\. If GitLab won't make a key for one project, you'll also paste a 30-day token that can act as you across GitLab into a box on your screen, not the chat\. Near the end, setup offers a test notification on your phone, which you can skip\.$/);
  assert.deepEqual(cardProblems(card), []);
});

test('Go ahead names the phone test only where step 9 will ask', () => {
  const base = { folder: '/x/Tides', list: [], product: { isNew: false, host: 'github', repo: 'a/Tides', name: 'Tides' }, platform: 'darwin', count: 0 };
  const says = (over) => oneCard({ ...base, ...over }).card.options[0].description;
  assert.match(says({ toRun: [3, 6, 7] }), /phone/);
  assert.doesNotMatch(says({ toRun: [3, 6, 7], pushed: true }), /phone notification|test notification/);
  assert.doesNotMatch(says({ toRun: [3, 7] }), /test notification/);
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
  assert.match(win, /- A key for this project only, from an app you create on GitHub \(you'll tick Enable Device Flow, click Create, type the code shown, then Authorize and install\)\./);
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
  assert.match(kept, /- Agents are told to use test data only, to be safe\./);
  // Make it stricter on the Mac.
  assert.match(oneCard({ folder: '/x/t', list: newProductChoices({ connection: STRICTER }), product: { isNew: true, name: 't' }, platform: 'darwin', toRun: [], count: 0 }).card.question,
    /- A key for this project only, made on GitHub \(you'll click Authorize and install\)\./);
});

test('the one card is never the same card twice: its id names the choices and how many answers the run holds', () => {
  const at = (count, list = newProductChoices()) => oneCard({ folder: '/x/t', list, product: null, platform: 'darwin', toRun: [], count }).id;
  assert.equal(at(0), at(0));
  assert.notEqual(at(0), at(1));
  assert.notEqual(at(0), at(0, newProductChoices({ live: LIVE_DATA.yes })));
});

test('the plan names GitLab for a folder whose own remote is on GitLab, and for a kept folder put on GitLab', () => {
  const c = (id, label) => ({ step: 3, id, key: `3.${id}`, card: { recommend: label, options: [] }, typed: false, writes: undefined, chosen: null, label, text: null });
  const ask = (product, list) => oneCard({ folder: '/x/h', list, product, platform: 'win32', toRun: [3], count: 0 }).card.question;
  const gitlab = ask({ isNew: false, host: 'gitlab', repo: 'team/harbour', name: 'harbour' }, [c('connection-0123456789', WAYS.narrow)]);
  assert.match(gitlab, /- harbour on GitLab, as it is\./);
  assert.match(gitlab, /- A GitLab key for this project only, or, where GitLab won't allow one, a 30-day token that can act as you across GitLab\./);
  assert.doesNotMatch(gitlab, /GitHub/);
  const github = ask({ isNew: false, host: 'github', repo: 'a/harbour', name: 'harbour' }, [c('connection-0123456789', WAYS.own)]);
  assert.match(github, /- A key for this project only, from an app you create on GitHub/);
  const put = ask({ isNew: false, host: 'local', repo: null, name: 'harbour' }, [c('kept', PUT_ON_GITLAB), c('connection-0123456789', WAYS.narrow)]);
  assert.match(put, /- Put on GitLab: a private project on your account/);
  assert.match(put, /- A GitLab key for this project only, or, where GitLab won't allow one, a 30-day token that can act as you across GitLab\./);
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
  // The description and live data wait for the real-users answer, which decides which description is asked and whether
  // live data is.
  const first = customiseBatch(list, since).map((c) => c.id);
  assert.equal(first[0], 'real-users');
  assert.equal(first.length, 4);
  assert.equal(first.some((id) => /^(?:product-|live-data$)/.test(id)), false);
  const answered = list.map((c) => (first.includes(c.id) ? { ...c, chosen: { label: c.label, text: null, at: '2026-10-26T10:05:00.000Z' } } : c));
  const second = customiseBatch(answered, since).map((c) => c.id);
  assert.ok(second.includes('product-before-launch') && second.includes('live-data'));
  // An answer from before Customise was clicked is asked again, for the director to see.
  const before = list.map((c) => ({ ...c, chosen: { label: c.label, text: null, at: '2026-10-26T09:00:00.000Z' } }));
  assert.equal(customiseBatch(before, since).length, 4);
});

test('each choice says what it is about and which step acts on it', () => {
  assert.equal(aboutOf('3.join-0123456789'), 'new, or already set up on another computer');
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

test('the recommended card names no build engine: setup installs Archon on no computer', () => {
  const product = { isNew: true, host: null, repo: null, name: 'tide-tables' };
  const without = oneCard({ folder: '/x/tide-tables', list: newProductChoices(), product, platform: 'darwin', toRun: [3, 6, 7, 10], count: 0 });
  const withTwo = oneCard({ folder: '/x/tide-tables', list: newProductChoices(), product, platform: 'darwin', toRun: [2, 3, 6, 7, 10], count: 0 });
  assert.doesNotMatch(withTwo.card.question, /build engine|Archon/);
  assert.deepEqual(withTwo.card.options, without.card.options);
  assert.deepEqual(withTwo.choices, without.choices);
});

test('the backup question waits for where the project is kept, and comes once a local project says so', () => {
  const since = '2026-10-01T00:00:00.000Z';
  const open = (id, chosen = null) => ({ id, chosen });
  const said = { label: 'x', at: '2026-10-02T00:00:00.000Z' };
  const ids = (list) => customiseBatch(list, since).map((c) => c.id);
  assert.deepEqual(ids([open('join'), open('real-users'), open('backup'), open('product-before-launch')]), ['real-users', 'join']);
  assert.deepEqual(ids([open('join', said), open('real-users', said), open('backup'), open('product-before-launch')]), ['product-before-launch', 'backup']);
  assert.deepEqual(ids([open('kept'), open('backup')]), ['kept']);
  assert.deepEqual(ids([open('join', said), open('real-users', said), open('backup'), open('product-before-launch', said)]), ['backup']);
  assert.deepEqual(ids([open('real-users'), open('connection')]), ['real-users', 'connection'], 'a hosted project\'s list is as it was');
});

test('a join answer refused and asked again leaves one join question, and no plan line from the refused text', async () => {
  const refused = { label: null, text: 'https://gitlab.example.org/', at: '2026-10-26T10:05:00.000Z' };
  const card = (what) => ({ what, options: [{ label: NEW_PRODUCT }, { label: HOST_LABELS.gitlab }], recommend: HOST_LABELS.gitlab });
  // A step 3 that, as host.js's does, asks `join`, then `join-abc` once the first answer is refused.
  const step = {
    n: 3,
    plan: async (ctx) => {
      if (!ctx.answers['3.join']) return { ask: { id: 'join', typed: true, card: card('Where?') } };
      if (ctx.answers['3.join-abc']) return { wait: 0, why: 'asked' };
      return { ask: { id: 'join-abc', typed: true, card: card('Not a name. Where?') } };
    },
  };
  const planOf = (s, answers) => s.plan({ answers });
  const list = await openChoices({ steps: [step], run: null, answers: { '3.join': refused }, planOf });
  assert.deepEqual(list.map((c) => c.id), ['join-abc']);
  // Only the question still open is asked on the next Customise round.
  assert.deepEqual(customiseBatch(list, '2026-10-26T10:00:00.000Z').map((c) => c.id), ['join-abc']);
  const plan = oneCard({ folder: os.tmpdir(), list, product: null, platform: 'darwin', toRun: [3], count: 1 }).card.question;
  assert.doesNotMatch(plan, /another computer/);
  assert.match(plan, /A new product, in a private project on your GitLab account\./);
  assert.equal(plan.split('\n').filter((l) => l.startsWith('- ')).length, 1);
});

test('the plan line for an address join names the product the address gave, and the host it named', async () => {
  const step = {
    n: 3,
    plan: async (ctx) => (ctx.answers['3.join'] ? { wait: 0, why: 'asked' } : { ask: { id: 'join', typed: true, card: { what: 'Where?', options: [{ label: NEW_PRODUCT }], recommend: NEW_PRODUCT } } }),
  };
  const planOf = (s, answers) => s.plan({ answers });
  for (const [text, line] of [
    ['https://gitlab.company.example/team/app', /^- app from your company's GitLab at gitlab\.company\.example, brought into this folder with its saved Wheelhouse settings\. If setup can't find them there, it stops and asks you again before doing anything more\.$/m],
    ['github.com/ann/cafe-menu', /^- cafe-menu from GitHub, brought into this folder with its saved Wheelhouse settings\. If setup can't find them there, it stops and asks you again before doing anything more\.$/m],
  ]) {
    const list = await openChoices({ steps: [step], run: null, answers: { '3.join': { label: null, text, at: '2026-10-26T10:05:00.000Z' } }, planOf });
    const plan = oneCard({ folder: os.tmpdir(), list, product: null, platform: 'darwin', toRun: [3], count: 1 }).card.question;
    assert.match(plan, line, plan);
  }
});

test('an owner/name join on the company\'s GitLab, picked on the which-GitLab card, names that GitLab and its account or groups', () => {
  const entry = (id, label, text = null) => ({ step: 3, id, key: `3.${id}`, card: { options: [] }, typed: true, writes: undefined, chosen: { label, text, at: '2026-10-26T10:05:00.000Z' }, label, text });
  const list = [entry('join', null, 'ann/cafe-menu'), entry('gitlab-where', COMPANY_GITLAB)];
  const plan = oneCard({ folder: os.tmpdir(), list, product: { isNew: false, host: 'gitlab', repo: 'ann/cafe-menu', name: 'cafe-menu' }, platform: 'darwin', toRun: [3], count: 1 }).card.question;
  assert.match(plan, /^- cafe-menu from your account or groups on your company's GitLab, brought into this folder with its saved Wheelhouse settings\. If setup can't find them there, it stops and asks you again before doing anything more\.$/m, plan);
});

test('the plan line names a host only as step 3 reads it: www.gitlab.com is the public GitLab, and a host step 3 refuses is named nowhere', async () => {
  const step = {
    n: 3,
    plan: async (ctx) => (ctx.answers['3.join'] ? { wait: 0, why: 'asked' } : { ask: { id: 'join', typed: true, card: { what: 'Where?', options: [{ label: NEW_PRODUCT }], recommend: NEW_PRODUCT } } }),
  };
  const planOf = (s, answers) => s.plan({ answers });
  const lineFor = async (text) => {
    const list = await openChoices({ steps: [step], run: null, answers: { '3.join': { label: null, text, at: '2026-10-26T10:05:00.000Z' } }, planOf });
    return oneCard({ folder: os.tmpdir(), list, product: null, platform: 'darwin', toRun: [3], count: 1 }).card.question;
  };
  assert.match(await lineFor('https://www.gitlab.com/ann/cafe-menu'), /^- cafe-menu from GitLab, brought into this folder with its saved Wheelhouse settings\. If setup can't find them there, it stops and asks you again before doing anything more\.$/m);
  for (const refused of ['https://git_lab.example.com/ann/cafe-menu', 'https://bitbucket.org/ann/cafe-menu']) {
    assert.doesNotMatch(await lineFor(refused), /, on /, refused);
  }
});

test('a Go ahead is withdrawn only by a miss that names it, by its id and its time as written, and one whose time cannot be read stands for nothing', () => {
  const consent = { id: 'plan-aaa', at: '2026-11-16T03:00:05.000Z', choices: [] };
  const miss = (withdraws) => ({ step: 3, kind: 'answer', after: { joined: 'a/b', missed: 'none', withdraws } });
  assert.equal(consentWithdrawn([], consent), false);
  assert.equal(consentWithdrawn([miss({ id: 'plan-aaa', at: consent.at })], consent), true);
  // A Go ahead given again after the miss is another: its time differs, even where the same plan is named, and the clock is not read.
  assert.equal(consentWithdrawn([miss({ id: 'plan-aaa', at: '2026-11-16T03:00:01.000Z' })], consent), false);
  assert.equal(consentWithdrawn([miss({ id: 'plan-bbb', at: consent.at })], consent), false);
  assert.equal(consentWithdrawn([miss(null)], consent), false);
  assert.equal(consentWithdrawn([miss({ id: 'plan-aaa', at: consent.at })], { ...consent, at: '2026-11-16T03:00:09.000Z' }), false);
  // A miss recorded before Go aheads were named holds only its time: it withdraws a Go ahead given before it, and not one given after.
  const legacy = (missedAt) => ({ step: 3, kind: 'answer', after: { joined: 'a/b', missed: 'none', missedAt } });
  assert.equal(consentWithdrawn([legacy('2026-11-16T03:00:09.000Z')], consent), true);
  assert.equal(consentWithdrawn([legacy('2026-11-16T03:00:01.000Z')], consent), false);
  assert.equal(consentWithdrawn([legacy('not a time')], consent), true);
  // The oldest miss records, from a run saved before any Go ahead was withdrawn, hold neither a `withdraws` nor a `missedAt`: they
  // withdraw nothing, as they did then, and a run restored from them keeps its Go ahead.
  const oldest = (after) => ({ step: 3, kind: 'answer', after });
  assert.equal(consentWithdrawn([oldest({ joined: 'a/b', missed: 'none' })], consent), false);
  assert.equal(consentWithdrawn([oldest({ joined: 'a/b', missed: ['o/a', 'o/b'], host: 'github' })], consent), false);
  // Not a miss, not step 3's, or not an answer: nothing is withdrawn.
  assert.equal(consentWithdrawn([{ step: 3, kind: 'answer', after: { joined: 'a/b', withdraws: { id: 'plan-aaa', at: consent.at } } }], consent), false);
  assert.equal(consentWithdrawn([{ ...miss({ id: 'plan-aaa', at: consent.at }), step: 4 }], consent), false);
  // A time that cannot be read, or no Go ahead, stands for nothing.
  assert.equal(consentWithdrawn([], { ...consent, at: 'not a time' }), true);
  assert.equal(consentWithdrawn([], { ...consent, at: undefined }), true);
  assert.equal(consentWithdrawn([], null), true);
});

test('a plan asked again after step 3 stopped says its tools and sign-in are done, and asks nothing of them again', () => {
  const list = newProductChoices({ connection: WAYS.narrow }).map((c) => (c.id === 'host' ? { ...c, label: HOST_LABELS.gitlab } : c));
  const base = { folder: '/x/tide-tables', list, product: { isNew: true, host: null, repo: null, name: 'tide-tables' }, platform: 'darwin', count: 1 };
  const again = oneCard({ ...base, toRun: [3, 6, 7, 10], done: { tools: true, signedIn: 'gitlab' } });
  assert.match(again.card.question, /^- Done already, and kept as it is: setup's tools \(step 2\) and your sign-in to GitLab\.$/m);
  assert.match(again.card.options[0].description, /You're already signed in to GitLab/);
  assert.doesNotMatch(again.card.options[0].description, /You'll sign in|password/);
  const first = oneCard({ ...base, toRun: [2, 3, 6, 7, 10] });
  assert.doesNotMatch(first.card.question, /Done already/);

  const kept = oneCard({ ...base, list: newProductChoices().map((c) => (c.id === 'join' ? { ...c, label: KEEP_HERE } : c)), toRun: [3, 6, 7, 10], done: { tools: true, signedIn: 'gitlab' } });
  assert.doesNotMatch(kept.card.options[0].description, /password/);
  // A sign-in the project no longer uses (kept here, or on another host) is said to be kept for later.
  assert.match(kept.card.question, /^- Already done: setup's tools\.\n- Your GitLab sign-in stays on this computer for later; this project doesn't use it\.$/m);
  assert.doesNotMatch(kept.card.question, /kept as it is/);
  assert.match(kept.card.options[0].description, /^Recommended: setup does all of this now\. The only thing left to ask you is a test notification on your phone near the end, which you can skip\.$/);
  // Where setup will not ask about the phone, nothing is left to ask.
  assert.match(oneCard({ folder: '/x/tide-tables', list: newProductChoices().map((c) => (c.id === 'join' ? { ...c, label: KEEP_HERE } : c)), product: { isNew: true, host: null, repo: null, name: 'tide-tables' }, platform: 'darwin', count: 1, toRun: [3, 7, 10], done: { tools: true, signedIn: 'gitlab' } }).card.options[0].description, /Nothing more is asked of you here\.$/);
  assert.deepEqual(cardProblems(again.card), []);
});

// ---- The first card's start: GitLab, chat history and the system's own prompt ----

const keptHereChoice = () => ({ step: 3, id: 'join', key: '3.join', card: { recommend: KEEP_HERE, options: [] }, typed: false, writes: undefined, chosen: null, label: KEEP_HERE, text: null });
const localProduct = { isNew: true, host: null, repo: null, name: 't' };

test('the one card offers GitLab as a click of its own while where the project is kept is the recommendation', () => {
  const options = (list, over = {}) => oneCard({ folder: '/x/t', list, product: localProduct, platform: 'darwin', toRun: [3, 6, 7, 10], count: 0, ...over }).card.options.map((o) => o.label);
  assert.deepEqual(options([keptHereChoice()]), [GO_AHEAD, USE_GITLAB, CUSTOMISE]);
  // Not offered once the director has answered where, or when a host is chosen already.
  assert.deepEqual(options([{ ...keptHereChoice(), chosen: { label: KEEP_HERE, at: '2026-11-24T01:00:00.000Z' } }]), [GO_AHEAD, 'Change a choice']);
  assert.deepEqual(options(newProductChoices()), [GO_AHEAD, CUSTOMISE]);
  const card = oneCard({ folder: '/x/t', list: [keptHereChoice()], product: localProduct, platform: 'win32', toRun: [3, 6, 7, 10], count: 0 }).card;
  assert.deepEqual(cardProblems(card), []);
});

test('a click on Put it on GitLab asks where the project is kept alone, until it is answered', () => {
  const at = '2026-11-24T01:00:00.000Z';
  const list = [keptHereChoice(), { ...keptHereChoice(), id: 'real-users', key: '3.real-users' }];
  assert.deepEqual(gitlabBatch(list, at).map((c) => c.id), ['join']);
  assert.deepEqual(gitlabBatch([{ ...keptHereChoice(), chosen: { label: 'GitLab', at: '2026-11-24T02:00:00.000Z' } }], at), []);
  // Which GitLab is asked once GitLab is chosen; whether to fetch GitLab's tool is not where the project is kept, so its
  // recommendation stands and the card names it.
  const after = [{ ...keptHereChoice(), chosen: { label: 'GitLab', at: '2026-11-24T02:00:00.000Z' } }, { ...keptHereChoice(), id: 'host-tool-glab', key: '2.host-tool-glab' }, { ...keptHereChoice(), id: 'host', key: '3.host' }];
  assert.deepEqual(gitlabBatch(after, at).map((c) => c.id), ['host']);
  const answers = { '0.plan-0123456789ab': { label: USE_GITLAB, at } };
  assert.equal(gitlabSince(answers), at);
  assert.equal(gitlabSince({ '0.plan-0123456789ab': { label: GO_AHEAD, at } }), null);
});

test('a click on Put it on GitLab asks the where question recommending GitLab, with no word for keeping it here', () => {
  const entry = { ...keptHereChoice(), card: { what: 'Where?', why: 'It needs no account here.', options: [{ label: KEEP_HERE, says: 'Nothing goes online.' }, { label: 'GitLab', says: 'A private project.' }], recommend: KEEP_HERE, because: 'it is the simplest start' } };
  const { card } = gitlabCard(entry);
  assert.equal(card.recommend, 'GitLab');
  assert.doesNotMatch(JSON.stringify({ why: card.why, because: card.because }), /simplest|no account/);
  assert.deepEqual(card.options, entry.card.options);
  assert.equal(entry.card.recommend, KEEP_HERE, 'the entry is not changed');
  // A card with no GitLab option is as it was.
  const none = { ...entry, card: { ...entry.card, options: [entry.card.options[0]] } };
  assert.equal(gitlabCard(none), none);
});

test('the chat history line says the setting changes, and that older history goes, only where that is true', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-card-history-'));
  try {
    const line = (settings) => {
      if (settings !== undefined) fs.writeFileSync(path.join(home, 'settings.json'), typeof settings === 'string' ? settings : JSON.stringify(settings));
      return oneCard({ folder: '/x/t', list: [], product: localProduct, platform: 'darwin', toRun: [6], count: 0, claudeHome: home }).card.question.split('\n').find((l) => /chat history/.test(l));
    };
    assert.match(line(), /; 30 days of chat history kept; Claude Code/);
    assert.doesNotMatch(line({}), /deleted|changes/);
    assert.doesNotMatch(line({ cleanupPeriodDays: 30 }), /deleted|changes/);
    assert.doesNotMatch(line('not json'), /deleted|changes/);
    assert.match(line({ cleanupPeriodDays: 90 }), /30 days of chat history kept \(your Claude Code setting is 90 days, so this changes it, and chats older than 30 days are deleted\)/);
    // Text that is a number counts as that number; 0 or less is a limit step 6 changes.
    assert.match(line({ cleanupPeriodDays: '90' }), /setting is 90 days, so this changes it, and chats older than 30 days are deleted/);
    assert.doesNotMatch(line({ cleanupPeriodDays: '30' }), /deleted|changes|raises/);
    assert.match(line({ cleanupPeriodDays: 0 }), /setting is 0 days, so this changes it\)/);
    assert.match(line({ cleanupPeriodDays: -1 }), /setting is -1 days, so this changes it\)/);
    assert.doesNotMatch(line({ cleanupPeriodDays: 'ninety' }), /deleted|changes|raises/);
    const raised = line({ cleanupPeriodDays: 7 });
    assert.match(raised, /setting is 7 days, so this raises it; nothing is deleted/);
    // With no Claude Code folder given, nothing is read: a settings.json in the folder this runs from is not the director's.
    const was = process.cwd();
    process.chdir(home);
    try {
      fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ cleanupPeriodDays: 90 }));
      const plain = oneCard({ folder: '/x/t', list: [], product: localProduct, platform: 'darwin', toRun: [6], count: 0 }).card.question.split('\n').find((l) => /chat history/.test(l));
      assert.doesNotMatch(plain, /deleted|changes|90/);
    } finally { process.chdir(was); }
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('Go ahead names what the system itself asks in the words of the computer: a password on a Mac, the installer\'s Yes on Windows', () => {
  const says = (platform, list) => oneCard({ folder: '/x/t', list, product: localProduct, platform, toRun: [2, 3, 6, 7, 10], count: 0 }).card.options[0].description;
  for (const list of [[], newProductChoices(), newProductChoices().map((c) => (c.id === 'host' ? { ...c, label: HOST_LABELS.gitlab } : c))]) {
    assert.match(says('darwin', list), /computer's password/);
    const win = says('win32', list);
    assert.doesNotMatch(win, /computer's password|computer password/);
  }
  assert.match(says('win32', []), /Windows may ask you to click Yes to let an installer run, or for an administrator's password\./);
});

test('the computer line names only what step 6 would change, and is left out when nothing changes', () => {
  const ask = (computerChanging, over = {}) => oneCard({ folder: '/x/t', list: [], product: localProduct, platform: 'darwin', toRun: [6], count: 0, desktop: true, computerChanging, ...over }).card.question.split('\n').find((l) => l.startsWith('- On this computer')) ?? null;
  assert.equal(ask([]), null);
  assert.equal(ask(['retention'], { claudeHome: '/x/none' }), '- On this computer: 30 days of chat history kept.');
  assert.equal(ask(['telemetry', 'updates']), '- On this computer: usage counted here only; and Claude Code takes only its well-tried updates.');
  assert.match(ask(['push']), /^- On this computer: Claude Code allowed to send phone notifications, which you finish near the end\.$/);
  assert.match(ask(null), /usage counted here only; 30 days of chat history kept; Claude Code takes only its well-tried updates; and Claude Code allowed to send phone/);
  // A phone fact is Wheelhouse's own record, said so; a terminal's question is kept though nothing else changes.
  assert.equal(ask([], { pushed: true }), '- On this computer: phone notifications on, since Wheelhouse\'s records show an earlier setup on this computer reached your phone.');
  assert.match(ask(['push'], { list: [{ step: 4, id: 'phone', key: '4.phone', card: { recommend: PHONE.skip, options: [] }, typed: false, chosen: null, label: PHONE.skip, text: null }] }), /with no phone test now/);
});
