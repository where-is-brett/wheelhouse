// tests/scripts/delegation/rules.test.js
// The `rule` record: a rule is what the director signed, at stage 0, deciding nothing yet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidateRule, reviewFrom, ruleCovers, ruleHash, ruleSet, ruleStands, sealsFor, stageOf } from '../../../scripts/delegation/rules.js';
import { composeRule } from '../../../scripts/delegation/composer.js';
import { sealOf } from '../../../scripts/delegation/seal.js';
import { setupStamp } from '../../../scripts/delegation/stamp.js';
import { CANDIDATES } from '../../../scripts/delegation/candidates.js';
import { buildViews } from '../../../scripts/state/views.js';
import { confirmationFor, CONFIRMABLE_KINDS, HELPER_ONLY_KINDS, makeEvent, PLAIN_KINDS, PROTECTED_KINDS } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol, readEnrolled } from '../../../scripts/state/signing.js';
import { SUGGEST } from '../../../scripts/lib/calm-words.js';
import { withHome } from '../../helpers/homes.js';

const AT = new Date('2026-11-01T02:00:00.000Z');
const now = () => AT;
const facts = { readable: true, head: 'a'.repeat(40), paths: ['src/a.js'], lines: 2, testsChanged: false, depsChanged: false, schemaChanged: false, guardrail: false, secrets: false, critical: false };
const card = { id: 'q-w-1', kind: 'question', work: 'w', level: 3, options: ['Keep', 'Remove'] };
const typed = composeRule({ answer: { label: SUGGEST, words: 'Take the proper long-term option' }, card, facts, lane: 'small', project: 'proj', now });
const clicked = composeRule({ answer: { label: 'Keep' }, card, facts, lane: 'small', project: 'proj', now });
const stamp = setupStamp({ bindings: {}, packDigest: 'd'.repeat(64), exclusionsHash: 'e'.repeat(64) });
const signing = () => {
  const { computer, publicKey } = makeSigningKey();
  enrol({ computer, publicKey, enrolledAt: '2026-11-01T00:00:00.000Z' });
};
const built = (events, when = now) => buildViews(events, readEnrolled(), { now: when });
const confirmed = (event) => makeEvent({ ...confirmationFor(event), now: () => new Date('2026-11-01T03:00:00.000Z') });

test('a rule is a plain record, confirmable, and only the helper writes one', () => {
  assert.ok(PLAIN_KINDS.includes('rule'));
  assert.ok(!PROTECTED_KINDS.includes('rule'));
  assert.ok(HELPER_ONLY_KINDS.includes('rule'));
  assert.ok(CONFIRMABLE_KINDS.includes('rule'));
});

test('a rule record has its whole shape and no more', () => withHome(() => {
  assert.equal(makeEvent({ kind: 'rule', data: typed }).kind, 'rule');
  assert.equal(makeEvent({ kind: 'rule', data: clicked }).kind, 'rule');
  const bad = [
    { ...typed, extra: 1 },
    { ...typed, stage: 1 },
    { ...typed, id: 'x y' },
    { ...typed, words: null, literal: null },
    { ...typed, words: 'a', literal: clicked.literal },
    { ...typed, words: '' },
    { ...clicked, literal: { options: ['Keep'], take: 'Other' } },
    { ...typed, review: 'soon' },
    { ...typed, hash: 'x' },
    { ...typed, paths: 'src' },
    { ...typed, lanes: ['elsewhere'] },
    { ...typed, conditions: null },
    { ...typed, exclusions: null },
    { ...typed, answer: 'Keep' },
  ];
  for (const data of bad) assert.throws(() => makeEvent({ kind: 'rule', data }), /rule/, JSON.stringify(data));
}));

test('an unconfirmed rule is no rule', () => withHome(() => {
  signing();
  assert.deepEqual(built([makeEvent({ kind: 'rule', data: typed, now })]).rules, {});
}));

test('a signed click puts a rule in force, and it reads back at stage 0', () => withHome(() => {
  signing();
  const event = makeEvent({ kind: 'rule', data: typed, now });
  const click = confirmed(event);
  assert.deepEqual(built([event, click]).rules, { [typed.id]: { rule: typed, stage: 0, signedAt: click.at } });
}));

test('a confirmation with no signature, or of another rule, counts for nothing', () => withHome(() => {
  signing();
  const event = makeEvent({ kind: 'rule', data: typed, now });
  const other = makeEvent({ kind: 'rule', data: clicked, now });
  const { sig, ...unsigned } = confirmed(event);
  assert.deepEqual(built([event, unsigned]).rules, {});
  assert.deepEqual(Object.keys(built([event, other, confirmed(other)]).rules), [clicked.id]);
}));

test('a changed word changes the hash, and a hash that doesn\'t match isn\'t in force', () => withHome(() => {
  signing();
  assert.notEqual(ruleHash({ ...typed, words: 'Take the quick option' }), typed.hash);
  assert.equal(ruleStands({ ...typed, words: 'Take the quick option' }), false);
  const changed = makeEvent({ kind: 'rule', data: { ...typed, words: 'Take the quick option' }, now });
  assert.deepEqual(built([changed, confirmed(changed)]).rules, {});
}));

test('every part of a rule\'s meaning is in its hash, and its stage, review and id are not', () => {
  for (const over of [{ literal: clicked.literal }, { conditions: [] }, { exclusions: [] }, { answer: { set: 'Keep', principle: null } }, { project: 'other' }, { paths: ['b'] }, { lanes: ['bug'] }]) {
    assert.notEqual(ruleHash({ ...typed, ...over }), typed.hash, JSON.stringify(over));
  }
  assert.equal(ruleHash({ ...typed, stage: 2, review: '2030-01-01T00:00:00.000Z', id: 'rule-000000000000' }), typed.hash);
});

test('a rule that is less than whole doesn\'t stand', () => {
  for (const rule of [null, 'rule', [], {}, { ...typed, id: 'rule-000000000000' }, { ...typed, stage: 1 }, { ...typed, conditions: undefined }]) {
    assert.equal(ruleStands(rule), false, JSON.stringify(rule));
  }
  const selfMade = (over) => {
    const rule = { ...typed, ...over };
    const hash = ruleHash(rule);
    return { ...rule, hash, id: `rule-${hash.slice(0, 12)}` };
  };
  assert.equal(ruleStands(selfMade({})), true);
  for (const over of [{ conditions: [1] }, { paths: [null] }, { literal: 'Keep' }, { literal: { options: 'Keep', take: 'Keep' } }, { project: 3 }, { answer: null }, { exclusions: [] }]) {
    assert.equal(ruleStands(selfMade(over)), false, JSON.stringify(over));
  }
});

test('a rule with a stage above 0 isn\'t in force until a part moves it', () => withHome(() => {
  signing();
  const raised = { v: 1, id: '7f1b5a56-3c70-4a57-9d0b-0e7d3c1f0a11', at: AT.toISOString(), computer: 'aaaaaaaa', kind: 'rule', data: { ...typed, stage: 2 } };
  assert.deepEqual(built([raised, confirmed(raised)]).rules, {});
}));

test('a rule signed again keeps its id, and the newer record stands', () => withHome(() => {
  signing();
  const first = makeEvent({ kind: 'rule', data: typed, now });
  const later = () => new Date('2027-06-01T00:00:00.000Z');
  const again = composeRule({ answer: { label: SUGGEST, words: typed.words }, card, facts, lane: 'small', project: 'proj', now: later });
  const second = makeEvent({ kind: 'rule', data: again, now: later });
  const views = built([first, confirmed(first), second, makeEvent({ ...confirmationFor(second), now: later })], later);
  assert.equal(views.rules[typed.id].rule.review, again.review);
  assert.equal(views.rules[typed.id].signedAt, later().toISOString());
}));

test('a late click on the older record leaves the newer one standing', () => withHome(() => {
  signing();
  const first = makeEvent({ kind: 'rule', data: typed, now });
  const soon = () => new Date('2026-11-02T00:00:00.000Z');
  const later = () => new Date('2026-11-03T00:00:00.000Z');
  const again = composeRule({ answer: { label: SUGGEST, words: typed.words }, card, facts, lane: 'small', project: 'proj', now: soon });
  const second = makeEvent({ kind: 'rule', data: again, now: soon });
  const views = built([first, second, makeEvent({ ...confirmationFor(second), now: soon }), makeEvent({ ...confirmationFor(first), now: later })], later);
  assert.equal(views.rules[typed.id].rule.review, again.review);
}));

test('a new rule starts at stage 0', () => {
  assert.equal(typed.stage, 0);
  assert.equal(clicked.stage, 0);
  assert.equal(stageOf(typed, { now }), 0);
});

test('past its review a rule falls to stage 1 or stays lower, and never rises', () => {
  const past = () => new Date('2027-05-01T02:00:00.001Z');
  assert.equal(stageOf({ ...typed, stage: 2 }, { now }), 2);
  assert.equal(stageOf({ ...typed, stage: 2 }, { now: past }), 1);
  assert.equal(stageOf({ ...typed, stage: 1 }, { now: past }), 1);
  assert.equal(stageOf({ ...typed, stage: 0 }, { now: past }), 0);
});

test('a review date that can\'t be read counts as past', () => {
  assert.equal(stageOf({ ...typed, stage: 2, review: 'soon' }, { now }), 1);
  assert.equal(stageOf({ ...typed, stage: 2, review: undefined }, { now }), 1);
});

test('a rule with no stage to read is at stage 0', () => {
  for (const stage of [undefined, null, '2', -1, 1.5]) assert.equal(stageOf({ ...typed, stage }, { now }), 0);
});

test('the review is the default months on, and the last day of a shorter month', () => {
  assert.equal(reviewFrom(AT), '2027-05-01T02:00:00.000Z');
  assert.equal(reviewFrom(new Date('2026-08-31T02:00:00.000Z')), '2027-02-28T02:00:00.000Z');
});

test('the views read a rule past its review by its fallen stage', () => withHome(() => {
  signing();
  const event = makeEvent({ kind: 'rule', data: typed, now });
  assert.equal(built([event, confirmed(event)], () => new Date('2028-01-01T00:00:00.000Z')).rules[typed.id].stage, 0);
}));

test('a candidate as a rule stands, at stage 0, and names no paths', () => {
  const land = candidateRule(CANDIDATES[0], { project: 'proj', now });
  assert.equal(ruleStands(land), true);
  assert.equal(land.words, CANDIDATES[0].words);
  assert.deepEqual(land.paths, []);
  assert.equal(land.stage, 0);
  assert.notEqual(land.hash, candidateRule(CANDIDATES[1], { project: 'proj', now }).hash);
  assert.notEqual(land.hash, candidateRule(CANDIDATES[0], { project: 'other', now }).hash);
});

test('a candidate\'s evidence carries over when signed with the same hash', () => withHome(() => {
  signing();
  const [land] = CANDIDATES;
  const rules = ruleSet('proj', {});
  const ctx = { permitHolds: true, openDecision: false };
  const seal = sealOf({ card, facts, ctx, stamp, at: AT.toISOString(), rules });
  const signed = candidateRule(land, { project: 'proj', now: () => new Date('2027-01-01T00:00:00.000Z') });
  const event = makeEvent({ kind: 'rule', data: signed });
  const { rule } = built([event, confirmed(event)]).rules[signed.id];
  assert.deepEqual(sealsFor(rule, [seal]), [seal]);
  assert.deepEqual(sealsFor({ ...rule, hash: ruleHash({ ...rule, words: 'Land anything' }) }, [seal]), []);
}));

test('a candidate that didn\'t apply earns nothing from a seal', () => {
  const seal = sealOf({ card, facts, ctx: { permitHolds: false, openDecision: false }, stamp, at: AT.toISOString(), rules: ruleSet('proj', {}) });
  assert.deepEqual(sealsFor(candidateRule(CANDIDATES[0], { project: 'proj', now }), [seal]), []);
});

test('a seal from before rules, with none named, is evidence for nothing', () => {
  assert.deepEqual(sealsFor(typed, [sealOf({ card, facts, stamp, at: AT.toISOString() })]), []);
});

test('the rule set is the eight candidates and this project\'s rules in force', () => {
  const inForce = { [typed.id]: { rule: typed, stage: 0, signedAt: 'x' }, other: { rule: { ...clicked, project: 'other' }, stage: 0, signedAt: 'x' } };
  const set = ruleSet('proj', inForce);
  assert.equal(set.length, CANDIDATES.length + 1);
  assert.ok(set.some((r) => r.hash === typed.hash));
  assert.ok(!set.some((r) => r.project === 'other'));
  assert.equal(ruleSet('proj', undefined).length, CANDIDATES.length);
});

test('no rule covers a change that hits a common exclusion, or one whose exclusions can\'t be read', () => {
  const ctx = { lane: 'small', options: ['Keep', 'Remove'] };
  const candidates = { land: true };
  const land = candidateRule(CANDIDATES[0], { project: 'proj', now });
  for (const key of ['guardrail', 'secrets', 'critical', 'schemaChanged', 'depsChanged']) {
    for (const value of [true, undefined]) {
      const changed = { ...facts, [key]: value };
      assert.equal(ruleCovers(typed, { facts: changed, ctx, candidates }), false, `${key} ${value}`);
      assert.equal(ruleCovers(land, { facts: changed, ctx, candidates }), false, `${key} ${value}`);
    }
  }
  assert.equal(ruleCovers(land, { facts: { readable: false }, ctx, candidates }), false);
  assert.equal(ruleCovers(land, { facts, ctx, candidates }), true);
});

test('no rule covers a question on a piece at level 4, whatever the question\'s own level says', () => {
  const ctx = { lane: 'small', workLevel: 4 };
  assert.equal(ruleCovers(typed, { facts, ctx }), false);
  assert.equal(ruleCovers(candidateRule(CANDIDATES[0], { project: 'proj', now }), { facts, ctx, candidates: { land: true } }), false);
});

test('a candidate carries the design\'s answer, so signing it as designed keeps its hash', () => {
  const answer = (id) => candidateRule(CANDIDATES.find((c) => c.id === id), { project: 'proj', now }).answer;
  assert.deepEqual(answer('land'), { set: 'land', principle: null });
  assert.deepEqual(answer('tested-choice'), { set: null, principle: 'the proper long-term option' });
  assert.deepEqual(answer('follow-mock-up'), { set: null, principle: 'follow the mock-up, fall back safely, note it' });
  assert.deepEqual(answer('run-plan'), { set: null, principle: null });
});

test('a composed rule covers a card inside its paths and lane, with the same options', () => {
  const ctx = { lane: 'small', options: ['Remove', 'Keep'] };
  const covers = (rule, over = {}) => ruleCovers(rule, { facts, ctx, candidates: {}, ...over });
  assert.equal(covers(typed), true);
  assert.equal(covers(clicked), true);
  assert.equal(covers(clicked, { ctx: { ...ctx, options: ['Keep', 'Other'] } }), false);
  assert.equal(covers(clicked, { ctx: { lane: 'small' } }), false);
  assert.equal(covers(typed, { ctx: { ...ctx, lane: 'bug' } }), false);
  assert.equal(covers(typed, { ctx: {} }), false);
  assert.equal(covers(typed, { facts: { ...facts, paths: ['src/a.js', 'src/other.js'] } }), false);
  assert.equal(covers(typed, { facts: { ...facts, paths: [] } }), false);
  assert.equal(covers(typed, { facts: { readable: false } }), false);
  assert.equal(covers(typed, { facts: { ...facts, paths: undefined } }), false);
});
