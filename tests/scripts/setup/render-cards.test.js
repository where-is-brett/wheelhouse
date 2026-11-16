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
    const hostAt = cards.findIndex((c) => c.id === 'host' || /^join/.test(c.id));
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
    if (p.glab === 'unavailable') assert.deepEqual(said, p.tool === 'fetch' ? ['GitLab\'s own tool could not be fetched on this computer, so Wheelhouse will reach the host without it'] : [], 'what step 2 said');

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
  assert.match(own.description, /If git holds no GitLab key that works, you make one on a page that opens\./, 'the way says the key may still be made');
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
  assert.match(connection[1].card.question, /^How should .*\? Quick is no longer offered: it needs GitLab's own tool, which couldn't be fetched on this computer\.\n/);
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
    assert.match(go.card.question, /one-day GitLab token on a page that opens and paste it into your computer's own box/, `path ${name}`);
    assert.match(go.card.question, /then revokes it/, `path ${name}`);
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
    assert.ok(goes.some((c) => c.step === 10), `path ${name} reaches step 10's card`);
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
  const asks = { a: /a GitLab key only if your git holds none that works/, b: /one-day GitLab token, and, if GitLab won't make a key for one project, a second token that reaches all your projects for 30 days, each pasted into your computer's own box/, c: /one-day GitLab token, and, if GitLab won't make a key for one project, a second token that reaches all your projects for 30 days, each pasted into your computer's own box/, d: /sign in on GitHub pages that open/, e: /sign in to your company's GitLab in your browser, or with a token you make on a page that opens/ };
  for (const [name, says] of Object.entries(asks)) {
    const { cards } = await rendered(name);
    const plan = cards.filter((c) => /^plan-/.test(c.id)).at(-1);
    assert.match(plan.card.options.find((o) => o.label === 'Go ahead').description, says, `path ${name}`);
  }
});
