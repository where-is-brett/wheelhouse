// tests/scripts/setup/render-cards.test.js
// Setup's cards as the director reads them (scripts/setup/render-cards.js), on five pretend computers: a company's
// GitLab on Windows with Quick and then with Narrow chosen and GitLab's tool not to be had, the public GitLab, GitHub,
// and a company's GitLab on a Mac. Each run goes from the one card through Customise to setup's last card, and every
// card is read for what a director would trip on: a clause said twice, a name in lower case, a host named that wasn't
// chosen, the public GitLab offered after the company's, one question in the words of another, a card asked again
// with no reason given, and a fetch claimed that never ran.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPath, PATHS, COMPANY_ADDRESS, recommendedOf } from '../../../scripts/setup/render-cards.js';

const runs = new Map();
const rendered = async (name, options = {}) => {
  const key = `${name}${options.desktop ? '-desktop' : ''}`;
  if (!runs.has(key)) runs.set(key, await renderPath(name, options));
  return runs.get(key);
};

// A card's words, each part as the director reads it.
const parts = (card) => [card.header, ...card.question.split('\n'), ...card.options.flatMap((o) => [o.label, o.description ?? ''])];
const words = (text) => text.toLowerCase().replace(/https?:\/\/\S+/g, ' ').match(/[a-z0-9'’.-]+/g)?.map((w) => w.replace(/[.]+$/, '')) ?? [];

// A run of six or more words that comes twice on one card: within its question, within an option, or in the question
// and an option again. Two options may share their wording, as choices side by side do.
function repeatedRun(card) {
  const runsOf = (text) => {
    const all = words(text);
    return all.slice(0, Math.max(0, all.length - 5)).map((_, i) => all.slice(i, i + 6).join(' '));
  };
  const twice = (runs) => runs.find((r, i) => runs.indexOf(r) !== i) ?? null;
  const asked = runsOf(`${card.header}\n${card.question}`);
  const inQuestion = twice(asked);
  if (inQuestion !== null) return inQuestion;
  for (const o of card.options) {
    const own = runsOf(`${o.label}: ${o.description ?? ''}`);
    const found = twice(own) ?? own.find((r) => asked.includes(r)) ?? null;
    if (found !== null) return found;
  }
  return null;
}

// A name in lower case in prose: web addresses and host names (gitlab.com, gitlab.example.com) are not prose.
const lowerName = (text) => text.replace(/https?:\/\/\S+/g, '').replace(/\b[\w-]+(\.[\w-]+)+\b/g, '').match(/\b(windows|gitlab|github)\b/)?.[0] ?? null;

const question = (c) => c.kind === 'question';
const bare = (id) => id.replace(/-?[0-9a-f]{10,}$/, '');

for (const name of Object.keys(PATHS)) {
  test(`path ${name} (${PATHS[name].title}) reads cleanly from the one card to setup's last card`, async () => {
    const { cards, end, said } = await rendered(name);
    assert.equal(end?.how, 'finished', `the run ends with setup finished, not ${JSON.stringify(end)}`);
    assert.equal(end.step, 10);
    const p = PATHS[name];
    const hostAt = cards.findLastIndex((c) => c.id === 'host' || /^join/.test(c.id));
    assert.ok(hostAt >= 0, 'the host is asked');
    const companyAt = cards.findIndex((c) => /^gitlab-(where|address)/.test(c.id) && c.answer?.text === COMPANY_ADDRESS);
    assert.equal(companyAt >= 0, p.where === 'company', 'the company address is typed where the path has one');

    cards.forEach((c, i) => {
      const where = `card ${i + 1} (${c.step}.${c.id})`;
      const repeated = repeatedRun(c.card);
      assert.equal(repeated, null, `${where} says "${repeated}" twice`);
      for (const part of parts(c.card)) assert.equal(lowerName(part), null, `${where} has a name in lower case: ${part}`);
      // Once the host is chosen, a card names it and not both.
      if (i > hostAt) for (const part of parts(c.card)) assert.doesNotMatch(part, /GitHub or GitLab|GitLab or GitHub/, `${where} names both hosts after ${p.host} was chosen`);
      // After the company's address, the public GitLab is never the recommendation, nor named in it.
      if (companyAt >= 0 && i > companyAt) {
        const recommended = c.card.options.find((o) => o.label === recommendedOf(c.card));
        assert.doesNotMatch(`${recommended?.label ?? ''} ${recommended?.description ?? ''}`, /gitlab\.com/i, `${where} recommends the public GitLab after the company's`);
      }
      // Where GitLab's tool can't be had, no card claims it is fetched, nor recommends fetching it.
      if (p.glab === 'unavailable') {
        for (const part of parts(c.card)) assert.doesNotMatch(part.replace(/Nothing is fetched/g, ''), /GitLab's (own )?tool (is |was )?fetched|fetched GitLab's tool/i, `${where} claims a fetch: ${part}`);
        assert.doesNotMatch(String(recommendedOf(c.card)), /^Fetch/, `${where} recommends fetching GitLab's tool`);
      }
    });
    // A path that asks for GitLab's tool where it can't be had hears that the fetch failed; any other plans no fetch.
    if (p.glab === 'unavailable') assert.deepEqual(said, p.tool === 'fetch' ? ['GitLab\'s own tool could not be fetched on this computer, so Wheelhouse will work with GitLab without it'] : [], 'what step 2 said');

    // No two different cards share a question, and a card asked again opens with its own reason.
    const asked = cards.filter(question);
    asked.forEach((c, i) => {
      for (const e of asked.slice(0, i)) {
        if (JSON.stringify(e.card) === JSON.stringify(c.card)) continue;
        assert.notEqual(c.card.question, e.card.question, `${c.step}.${c.id} is asked in the words of ${e.step}.${e.id}`);
      }
      // The one card after Customise is the plan with the director's choices, not its question asked again.
      const before = c.step === 0 ? undefined : asked.slice(0, i).find((e) => e.step === c.step && bare(e.id) === bare(c.id) && e.id !== c.id);
      if (before !== undefined) {
        const [reason] = c.card.question.split('\n')[0].split(/(?<=\.) /);
        assert.ok(!before.card.question.includes(reason), `${c.step}.${c.id} is asked again with no reason line`);
        assert.match(reason, /\.$/, `${c.step}.${c.id}'s reason line is one sentence`);
      }
    });
  });
}

test('path a: with GitLab\'s tool left out, Quick is not offered, and where git holds no key Narrow is recommended', async () => {
  const { cards } = await rendered('a');
  const connection = cards.filter((c) => c.step === 3 && /^connection-/.test(c.id));
  assert.equal(connection.length, 1, 'the connection card is asked once');
  assert.deepEqual(connection[0].card.options.map((o) => o.label), ['Narrow', 'Use my git as it is'], 'the recommended way comes first');
  assert.equal(recommendedOf(connection[0].card), 'Narrow');
  const own = connection[0].card.options.find((o) => o.label === 'Use my git as it is');
  assert.match(own.description, /Your git holds no GitLab key yet, so you make one on a page that opens and set its expiry date 90 days ahead\./, 'the way says the key may still be made');
  const tool = cards.find((c) => c.step === 2 && c.kind === 'question');
  assert.equal(recommendedOf(tool.card), 'Don\'t use GitLab\'s tool');
  assert.ok(cards.findIndex((c) => c === tool) < cards.findIndex((c) => c === connection[0]), 'GitLab\'s tool is asked before the connection');
  const one = cards.filter((c) => c.id === 'one-card' || /^plan-/.test(c.id)).at(-1);
  assert.ok(one.card.question.includes('Agents use your own git as it is'), 'the one card lists the way chosen');
});

test('path b\': Quick, once GitLab\'s tool can\'t be fetched, is asked again with its reason, the same recommendation and order', async () => {
  const { cards } = await rendered('b\'');
  const connection = cards.filter((c) => c.step === 3 && /^connection-/.test(c.id));
  assert.equal(connection.length, 2, 'the connection card is asked twice: once, and again once Quick can\'t be had');
  assert.equal(connection[0].answer.label, 'Quick');
  assert.match(connection[1].card.question, /^How should .*\? Quick is no longer offered: it needs GitLab's own tool, which couldn't be fetched on this computer\. This changes the plan you said Go ahead to, and each option says what it brings\.\n/);
  assert.match(connection[1].card.question, /\nSetup waits for your answer; nothing is made on GitLab until you choose\.\n/);
  assert.equal(connection[1].card.options[0].label, connection[0].card.options[0].label, 'the first option stays first');
  assert.ok(!connection[1].card.options.some((o) => o.label === 'Quick'), 'Quick is gone');
  assert.equal(recommendedOf(connection[1].card), recommendedOf(connection[0].card));
});

test('path b: which GitLab and its address recommend no option, and say so on a line of their own', async () => {
  const { cards } = await rendered('b');
  for (const id of ['gitlab-where', 'gitlab-address']) {
    const c = cards.find((x) => x.step === 3 && (x.id === id || x.id.startsWith(`${id}-`)));
    assert.ok(c, `${id} is asked`);
    assert.equal(recommendedOf(c.card), null, `${id} recommends no option`);
    assert.ok(c.card.question.split('\n').some((l) => /^No recommendation: /.test(l)), `${id} says it recommends none`);
    assert.ok(!c.card.options.some((o) => /^Recommended:/.test(o.description ?? '')), `${id} marks no option as recommended`);
  }
});

test('path b: the connection card puts Narrow, the recommended way, first', async () => {
  const { cards } = await rendered('b');
  const connection = cards.find((c) => c.step === 3 && /^connection-/.test(c.id));
  assert.equal(connection.card.options[0].label, 'Narrow');
  assert.equal(recommendedOf(connection.card), 'Narrow');
});

test('paths b, b\' and c: step 3\'s Go-ahead card says the one-day token is used, never kept, and protects the main line now', async () => {
  for (const name of ['b', 'b\'', 'c']) {
    const { cards } = await rendered(name);
    const go = cards.find((c) => c.kind === 'go-ahead' && c.step === 3);
    assert.ok(go, `path ${name} shows step 3's Go-ahead card`);
    assert.match(go.card.question, /one-day GitLab token on a page that opens, setting its expiry date to tomorrow, and paste it into a box on your screen/, `path ${name}`);
    assert.match(go.card.question, /then cancels it/, `path ${name}`);
    assert.match(go.card.question, /Setup protects the main line now, while it holds that token/, `path ${name}`);
    assert.doesNotMatch(go.card.question, /sign in in your browser/i, `path ${name} asks for no browser sign-in`);
  }
});

test('path b: Narrow stands, so the connection card is asked once', async () => {
  const { cards } = await rendered('b');
  const connection = cards.filter((c) => c.step === 3 && /^connection-/.test(c.id));
  assert.equal(connection.length, 1);
  assert.equal(connection[0].answer.label, 'Narrow');
});

test('Quick names the host chosen, and only that one', async () => {
  for (const [name, host, other] of [['e', 'GitLab', 'GitHub'], ['d', 'GitHub', 'GitLab']]) {
    const { cards } = await rendered(name);
    const quick = cards.find((c) => /^connection-/.test(c.id)).card.options.find((o) => o.label === 'Quick');
    assert.ok(quick, `path ${name} offers Quick`);
    assert.match(quick.description, new RegExp(`your (full ${host} access|ordinary ${host} sign-in)`, 'i'));
    assert.doesNotMatch(quick.description, new RegExp(other));
  }
});

// On the Desktop app, a card whose question matches an earlier card's comes back with the earlier answer. No card in
// path a shares its question with another, so every answer is the one given on that card, and setup ends unpaused.
test('path a on the Desktop app reaches the end of setup with no pause and no loop', async () => {
  const { cards, end } = await rendered('a', { desktop: true });
  assert.deepEqual(end, { step: 10, how: 'finished' });
  assert.deepEqual(cards.filter((c) => c.stale), [], 'no card came back as an earlier one');
});

// Every Go-ahead card lists what its step does one thing to a line, in words a product owner reads without help.
const JARGON = /\bpins?\b|extraheader|tested versions|stable channel|\d+ keys in your|merge gate|sandbox's checks/i;
test('every path\'s Go-ahead cards list one thing to a line, with no jargon', async () => {
  for (const name of Object.keys(PATHS)) {
    const { cards } = await rendered(name);
    const goes = cards.filter((c) => c.kind === 'go-ahead');
    assert.ok(goes.some((c) => c.step === (PATHS[name].join && !PATHS[name].miss ? 7 : 10)), `path ${name} reaches its last step's card (a joining computer has no health check, so step 7 is its last Go-ahead card)`);
    for (const c of goes) {
      const lines = c.card.question.split('\n');
      assert.match(lines[0], /^Setup step \d+, [^:]+:$/, `path ${name} step ${c.step}'s card opens with its title alone`);
      assert.match(lines[1], /^- /, `path ${name} step ${c.step}'s card lists its first thing on a line of its own`);
      for (const l of lines.filter((x) => x.startsWith('- '))) assert.ok(l.length <= 260, `path ${name} step ${c.step}: a line runs on: ${l}`);
      assert.doesNotMatch(c.card.question, JARGON, `path ${name} step ${c.step}`);
    }
  }
});

test('on GitLab, step 10\'s card names a merge request, never a pull request', async () => {
  for (const name of ['a', 'b', 'c', 'e']) {
    const { cards } = await rendered(name);
    const health = cards.find((c) => c.kind === 'go-ahead' && c.step === 10);
    assert.match(health.card.question, /merge request/, `path ${name}`);
    assert.doesNotMatch(health.card.question, /pull request/, `path ${name}`);
  }
});

test('each path\'s plan says what will be asked of the director', async () => {
  const asks = { a: /a GitLab key: you make it on a page that opens and set its expiry date 90 days ahead/, b: /paste a one-day GitLab token into a box on your screen, not the chat. If GitLab won't make a key for this one project, you'll also paste a token set to end 30 days ahead that can act as you in every GitLab project and group you can reach/, c: /paste a one-day GitLab token into a box on your screen, not the chat. On a free account, or wherever GitLab won't make a key for this one project, you'll also paste a token set to end 30 days ahead that can act as you in every GitLab project and group you can reach/, d: /sign in on GitHub pages that open/, e: /sign in to your company's GitLab in your browser if your company has set that up, or else with a token you make on a page that opens/ };
  for (const [name, says] of Object.entries(asks)) {
    const { cards } = await rendered(name);
    const plan = cards.filter((c) => /^plan-/.test(c.id)).at(-1);
    assert.match(plan.card.options.find((o) => o.label === 'Go ahead').description, says, `path ${name}`);
  }
});

test('path g: a miss at step 3\'s apply withdraws the Go ahead, so the plan is asked again as a card of its own, with what is done said as done', async () => {
  for (const desktop of [false, true]) {
    const { cards, end, said } = await rendered('g', { desktop });
    assert.equal(end.how, 'finished');
    const plans = cards.filter((c) => /^plan-/.test(c.id));
    assert.equal(plans.length, 3, 'the one card, the plan with the director\'s choices, and the plan asked again after the miss');
    assert.notEqual(plans[1].id, plans[2].id);
    assert.notEqual(plans[1].card.question, plans[2].card.question);
    assert.equal(plans[2].answer.label, 'Go ahead', 'the second plan is answered as itself');
    assert.equal(plans[2].stale, undefined);
    // The miss, then the question asked again, then the plan again, then the step that was stopped.
    const join = cards.findIndex((c) => /^join-/.test(c.id));
    assert.ok(said.some((s) => /Setup couldn't bring in/.test(s)));
    assert.ok(join > cards.findIndex((c) => c.step === 3 && c.kind === 'go-ahead'), 'the miss comes after step 3\'s Go ahead');
    assert.ok(cards.indexOf(plans[2]) > join, 'the plan comes after the question asked again');
    const after = cards.slice(cards.indexOf(plans[2]) + 1);
    assert.ok(after.find((c) => c.kind === 'go-ahead' && c.step === 3)?.covered, 'step 3\'s Go ahead is covered by the new plan');
    assert.match(plans[2].card.question, /^- Already done: setup's tools\.\n- Your GitLab sign-in stays on this computer for later; this project doesn't use it\.$/m);
    assert.match(plans[2].card.options.find((o) => o.label === 'Go ahead').description, /^Recommended: setup does all of this now\. The only thing left to ask you is a test notification on your phone near the end, which you can skip\.$/);
    // Step 4's questions are asked before the plan, so nothing is asked after the Go ahead, and the plan says what they settled.
    assert.deepEqual(after.filter((c) => c.kind === 'question' && c.step !== 9).map((c) => c.id), [], 'no question card follows the second plan\'s Go ahead, bar the phone test');
    const before = cards.slice(0, cards.indexOf(plans[2]));
    assert.ok(before.some((c) => c.step === 4 && /^product-/.test(c.id)) && before.some((c) => c.id === 'live-data'), 'the description and live data are asked before the plan');
    assert.match(plans[2].card.question, /no real users and no live data yet/);
    assert.doesNotMatch(plans[2].card.question, /Setup step 2|install/i);
    assert.doesNotMatch(plans[2].card.options.find((o) => o.label === 'Go ahead').description, /password|sign in to/i);
  }
});

test('path g: a product kept on this computer after a miss is new, so no live data is recommended', async () => {
  const { cards } = await rendered('g');
  const live = cards.find((c) => c.id === 'live-data');
  assert.equal(recommendedOf(live.card), 'No live data');
});

test('path i: Copilot chosen on the builder question, step 6\'s card names every change and fits the composer\'s limit', async () => {
  const { cards, end } = await rendered('i', { desktop: true });
  assert.deepEqual(end, { step: 10, how: 'finished' });
  const ask = cards.find((c) => c.step === 6 && c.id === 'agent');
  assert.equal(ask.answer.label, 'Copilot');
  assert.match(ask.card.options.find((o) => o.label === 'Copilot').description, /GitHub's Copilot does the building on this computer, using your Copilot plan's monthly allowance\. Setup adds its checks and reads your plan from your GitHub account/);
  const six = cards.find((c) => c.step === 6 && c.kind === 'go-ahead');
  assert.ok(six.card.question.length <= 1200, `step 6's card is ${six.card.question.length} characters`);
  assert.match(six.card.question, /Copilot's checks before each of its actions and First Mate files, in your Copilot folder for every project \(the checks act only in Wheelhouse projects; the First Mate files say to apply only there\)/);
  assert.match(six.card.question, /Usage counting left as you set it/);
  assert.match(six.card.question, /Chat history kept 30 days/);
  assert.match(six.card.question, /Phone notifications prepared/);
});

test('path j: the first card\'s Put it on GitLab click asks where it is kept alone, then the plan comes back with GitLab on it', async () => {
  const { cards, end } = await rendered('j');
  assert.equal(end.how, 'finished');
  const first = cards[0];
  assert.deepEqual(first.card.options.map((o) => o.label), ['Go ahead', 'Put it on GitLab', 'Customise']);
  assert.equal(first.answer.label, 'Put it on GitLab');
  assert.equal(cards[1].id, 'join', 'where the project is kept is asked next, and no other choice with it');
  // The director has just asked for GitLab, so that card recommends it and does not argue for keeping the project here.
  const where = cards[1].card;
  assert.match(where.options.find((o) => o.label === 'GitLab').description, /^Recommended: /);
  assert.doesNotMatch(where.options.find((o) => o.label === 'Keep it on this computer').description, /^Recommended/);
  assert.doesNotMatch(JSON.stringify(where), /simplest start|nothing to sign in to|needs no account/);
  assert.match(cards.find((c) => c.step === 0 && c.card.question.includes('with your choices')).card.question, /private project on your GitLab account/);
  // Windows never says "computer's password".
  for (const c of cards) assert.doesNotMatch(JSON.stringify(c.card), /computer's password|computer password/);
});
