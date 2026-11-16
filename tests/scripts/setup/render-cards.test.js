// tests/scripts/setup/render-cards.test.js
// Setup's cards as the director reads them (scripts/setup/render-cards.js), on five pretend computers: a company's
// GitLab on Windows with Quick and then with Narrow chosen and GitLab's tool not to be had, the public GitLab, GitHub,
// and a company's GitLab on a Mac. Each run goes from the one card through Customise to the end of step 3, and every
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
  test(`path ${name} (${PATHS[name].title}) reads cleanly from the one card to the end of step 3`, async () => {
    const { cards, end, said } = await rendered(name);
    assert.equal(end?.how, 'finished', `the run ends at the end of step 3, not ${JSON.stringify(end)}`);
    assert.equal(end.step, 3);
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
    if (p.glab === 'unavailable') assert.deepEqual(said, [], 'no fetch of GitLab\'s tool is planned');

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

test('path a: Quick, with GitLab\'s tool left out, is asked again with its reason, and Use my git as it is is recommended', async () => {
  const { cards } = await rendered('a');
  const connection = cards.filter((c) => c.step === 3 && /^connection-/.test(c.id));
  assert.equal(connection.length, 2, 'the connection card is asked twice: once, and again once Quick can\'t be had');
  assert.equal(connection[0].answer.label, 'Quick');
  assert.match(connection[1].card.question, /^Quick needs GitLab's own tool, which this computer can't use, so choose again\. /);
  assert.deepEqual(connection[1].card.options.map((o) => o.label), ['Use my git as it is', 'Narrow']);
  assert.equal(recommendedOf(connection[1].card), 'Use my git as it is');
  const quick = connection[0].card.options.find((o) => o.label === 'Quick');
  assert.match(quick.description, /GitLab's own tool/, 'Quick says it depends on GitLab\'s tool');
  const tool = cards.find((c) => c.step === 2 && c.kind === 'question');
  assert.equal(recommendedOf(tool.card), 'Don\'t use GitLab\'s tool');
  const one = cards.filter((c) => c.id === 'one-card' || /^plan-/.test(c.id)).at(-1);
  assert.ok(one.card.question.includes('Agents use your own git as it is'), 'the one card lists the way chosen');
  assert.doesNotMatch(one.card.question, /Quick/);
});

test('path b: Narrow stands, so the connection card is asked once', async () => {
  const { cards } = await rendered('b');
  const connection = cards.filter((c) => c.step === 3 && /^connection-/.test(c.id));
  assert.equal(connection.length, 1);
  assert.equal(connection[0].answer.label, 'Narrow');
});

test('Quick names the host chosen, and only that one', async () => {
  for (const [name, host, other] of [['a', 'GitLab', 'GitHub'], ['d', 'GitHub', 'GitLab']]) {
    const { cards } = await rendered(name);
    const quick = cards.find((c) => /^connection-/.test(c.id)).card.options.find((o) => o.label === 'Quick');
    assert.ok(quick, `path ${name} offers Quick`);
    assert.match(quick.description, new RegExp(`your full ${host} access`));
    assert.doesNotMatch(quick.description, new RegExp(other));
  }
});

// On the Desktop app, a card whose question matches an earlier card's comes back with the earlier answer. No card in
// path a shares its question with another, so every answer is the one given on that card, and step 3 ends unpaused.
test('path a on the Desktop app reaches the end of step 3 with no pause and no loop', async () => {
  const { cards, end } = await rendered('a', { desktop: true });
  assert.deepEqual(end, { step: 3, how: 'finished' });
  assert.deepEqual(cards.filter((c) => c.stale), [], 'no card came back as an earlier one');
});
