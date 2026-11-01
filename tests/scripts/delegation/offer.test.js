// tests/scripts/delegation/offer.test.js
// When an answer earns the one click, and what keeps it rare: a script finds the pattern, and nothing changes until the
// director's signed click.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answersToOffer, offerDue, sittingSince } from '../../../scripts/delegation/offer.js';
import { composeRule } from '../../../scripts/delegation/composer.js';
import { decisionKey } from '../../../scripts/delegation/asked.js';
import { confirmWords, confirmLine, answerLine } from '../../../scripts/state/card-lines.js';
import { RULE_WORDS_MOST, SITTING_GAP_HOURS } from '../../../scripts/delegation/limits.js';
import { TURNED_DOWN_DAYS } from '../../../scripts/frontdesk/learning.js';
import { SUGGEST } from '../../../scripts/lib/calm-words.js';

const NOW = new Date('2026-11-01T10:00:00.000Z');
const P = 'o__p';
const FACTS = { readable: true, paths: ['src/a.js'], depsChanged: false, schemaChanged: false, guardrail: false, secrets: false, critical: false };
const OPTIONS = [{ label: 'Keep' }, { label: 'Replace' }];
const ago = (minutes) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

const question = (id, extra = {}) => ({ id, work: 'w1', what: 'Keep the old export?', level: 3, options: OPTIONS, recommendation: 'Keep', key: decisionKey(extra.work ?? 'w1', 'Keep the old export?'), ...extra });
const entry = (data, label, at, extra = {}) => ({ question: { key: data.id, data }, answer: label === null ? null : { label, at }, ...extra });
const viewsOf = (questions, extra = {}) => ({ questions, work: { w1: { work: { data: { lane: 'small', level: 3 } } }, w2: { work: { data: { lane: 'small', level: 3 } } } }, rules: {}, ...extra });
const answered = (views, outcomes = []) => answersToOffer({ views, outcomes, sitting: ago(30) });
const offered = (views, { facts = FACTS, events = [], outcomes = [], sitting = ago(30) } = {}) => {
  const [answer] = answersToOffer({ views, outcomes, sitting });
  return answer === undefined ? null : offerDue({ events, answer, sitting, now: () => NOW, views, outcomes, facts, project: P });
};
const leftTheRecommendation = () => viewsOf({ 'q-w1-1': entry(question('q-w1-1'), 'Replace', ago(5)) });
const ruleOf = (views) => offered(views);
const offerCard = (eventId, data, answers = [], decided = null) => ({ card: { data: { line: confirmLine({ kind: 'rule', id: eventId, data }) } }, answers, decided });

test('offered after a like question was answered, or the answer left the recommendation', () => {
  assert.equal(answered(leftTheRecommendation())[0].why, 'left');
  assert.equal(answered(viewsOf({ 'q-w1-1': entry(question('q-w1-1'), 'Keep', ago(5)) })).length, 0);
  const like = viewsOf({
    'q-w2-1': entry(question('q-w2-1', { work: 'w2' }), 'Keep', ago(60 * 24)),
    'q-w1-1': entry(question('q-w1-1'), 'Keep', ago(5)),
  });
  assert.equal(answered(like)[0].why, 'like');
  assert.ok(offered(like));
});

test('a like question answered otherwise earns nothing, and nor do other options', () => {
  const other = viewsOf({ 'q-w2-1': entry(question('q-w2-1', { work: 'w2' }), 'Replace', ago(60 * 24)), 'q-w1-1': entry(question('q-w1-1'), 'Keep', ago(5)) });
  assert.deepEqual(answered(other), []);
  const options = viewsOf({ 'q-w2-1': entry(question('q-w2-1', { work: 'w2', options: [{ label: 'Keep' }, { label: 'Drop' }] }), 'Keep', ago(60 * 24)), 'q-w1-1': entry(question('q-w1-1'), 'Keep', ago(5)) });
  assert.deepEqual(answered(options), []);
});

test('words in an unsigned record earn nothing, and can\'t stand over a signed answer', () => {
  const said = [{ card: { data: { line: answerLine('q-w1-1') } }, answers: [{ at: ago(1), data: { label: SUGGEST, text: 'Land everything' } }], decided: null }];
  assert.equal(offered(viewsOf({ 'q-w1-1': entry(question('q-w1-1'), null) }), { outcomes: said }), null);
  assert.equal(offered(leftTheRecommendation(), { outcomes: said }).words, null);
});

test('a clicked label is kept as a literal match', () => {
  assert.deepEqual(ruleOf(leftTheRecommendation()).literal, { options: ['Keep', 'Replace'], take: 'Replace' });
});

test('at most one a sitting', () => {
  const views = leftTheRecommendation();
  assert.ok(offered(views));
  assert.equal(offered(views, { events: [{ id: 'e1', kind: 'rule', at: ago(10), data: {} }] }), null);
  assert.ok(offered(views, { events: [{ id: 'e1', kind: 'rule', at: ago(60), data: {} }] }));
});

test('a sitting is a run of clicks, and ends after the gap', () => {
  const hours = (n) => ago(n * 60);
  const views = viewsOf({ 'q-w1-1': entry(question('q-w1-1'), 'Keep', hours(1)), 'q-w1-2': entry(question('q-w1-2'), 'Keep', hours(1 + SITTING_GAP_HOURS - 0.5)), 'q-w1-3': entry(question('q-w1-3'), 'Keep', hours(30)) });
  assert.equal(sittingSince({ views, outcomes: [], now: () => NOW }), hours(1 + SITTING_GAP_HOURS - 0.5));
  assert.equal(sittingSince({ views: viewsOf({}), outcomes: [], now: () => NOW }), NOW.toISOString());
});

test('an answer from before this sitting earns nothing', () => {
  assert.deepEqual(answersToOffer({ views: leftTheRecommendation(), outcomes: [], sitting: ago(1) }), []);
});

test('a declined offer stays quiet 30 days, whatever paths it comes with', () => {
  const views = leftTheRecommendation();
  const earlier = composeRule({ answer: { label: 'Replace' }, card: { kind: 'question', level: 3, options: OPTIONS }, facts: { ...FACTS, paths: ['src/other.js'] }, lane: 'small', project: P, now: () => NOW });
  const events = [{ id: 'e1', kind: 'rule', at: ago(60 * 24 * 10), data: earlier }];
  for (const label of ['Not now', 'Keep as is']) {
    const decided = label === 'Keep as is' ? { label, at: ago(60 * 24) } : null;
    assert.equal(offered(views, { events, outcomes: [offerCard('e1', earlier, [{ at: ago(60 * 24), data: { label } }], decided)] }), null);
  }
  const long = ago(60 * 24 * (TURNED_DOWN_DAYS + 1));
  assert.ok(offered(views, { events, outcomes: [offerCard('e1', earlier, [{ at: long, data: { label: 'Keep as is' } }], { label: 'Keep as is', at: long })] }));
});

test('an offer still waiting on its card isn\'t made again', () => {
  const views = leftTheRecommendation();
  const earlier = ruleOf(views);
  assert.equal(offered(views, { events: [{ id: 'e1', kind: 'rule', at: ago(60 * 24), data: earlier }], outcomes: [offerCard('e1', earlier)] }), null);
});

test('a rule already in force isn\'t offered again', () => {
  const views = leftTheRecommendation();
  const rule = ruleOf(views);
  assert.equal(offered({ ...views, rules: { [rule.id]: { rule, stage: 0 } } }), null);
});

test('never at level 4', () => {
  const asked = viewsOf({ 'q-w1-1': entry(question('q-w1-1', { level: 4 }), 'Replace', ago(5)) });
  assert.equal(offered(asked), null);
  const piece = leftTheRecommendation();
  piece.work.w1.work.data.level = 4;
  assert.equal(offered(piece), null);
});

test('a change that can\'t be read, or hits an exclusion, gets no offer', () => {
  assert.equal(offered(leftTheRecommendation(), { facts: { readable: false } }), null);
  assert.equal(offered(leftTheRecommendation(), { facts: { ...FACTS, secrets: true } }), null);
});

test('a scope too wide for one line to show gets no offer', () => {
  const paths = Array.from({ length: RULE_WORDS_MOST }, (_, i) => `src/${i}.js`);
  assert.equal(offered(leftTheRecommendation(), { facts: { ...FACTS, paths } }), null);
});

test('a joiner, a build command, a blind card and an ask with no key earn nothing', () => {
  const asked = (extra, more = {}) => viewsOf({ 'q-w1-1': entry(question('q-w1-1', extra), 'Replace', ago(5), more) });
  assert.deepEqual(answered(asked({}, { joins: 'q-w1-0' })), []);
  assert.deepEqual(answered(asked({ commands: ['npm test'] })), []);
  assert.deepEqual(answered(asked({ key: undefined })), []);
  assert.deepEqual(answered(leftTheRecommendation(), [{ card: { data: { line: answerLine('q-w1-1'), blind: true } }, answers: [], decided: null }]), []);
});

test('the words read as the rule would, with its scope', () => {
  const rule = ruleOf(leftTheRecommendation());
  assert.equal(confirmWords({ kind: 'rule', data: rule }), 'When the options are exactly Keep, Replace, take Replace. Only in this project, in the small lane, for src/a.js');
});

test('no pattern changes anything until the click', () => {
  const views = leftTheRecommendation();
  const before = JSON.stringify(views);
  const rule = ruleOf(views);
  assert.equal(rule.stage, 0);
  assert.deepEqual(views.rules, {});
  assert.equal(JSON.stringify(views), before);
});
