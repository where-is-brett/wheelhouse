// tests/scripts/engine/archon/asks.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { normaliseAsk, ARCHON_ASKS, askOccurrence, parkChoice } from '../../../../scripts/engine/archon/asks.js';
import { checkEvent } from '../../../../scripts/engine/contract.js';

const items = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', '..', '..', 'fixtures', 'archon', 'attention-items.json'), 'utf8'));
const now = () => '2026-10-29T09:00:00.000Z';

test('every recorded item becomes a well-formed ask', () => {
  for (const [name, item] of Object.entries(items)) assert.equal(checkEvent(normaliseAsk(item, { now })), null, name);
});

test("normaliseAsk reads the pack's labels", () => {
  const ask = normaliseAsk(items.pack, { now });
  assert.equal(ask.type, 'ask');
  assert.equal(ask.runId, items.pack.runId);
  assert.equal(ask.at, items.pack.pausedAt);
  assert.equal(ask.kind, 'approval');
  assert.equal(ask.level, 3);
  assert.equal(ask.work, 'card-14');
  assert.equal(ask.topic, 'visible-change');
  assert.equal(ask.recommend, 'approve');
  assert.equal(ask.preview, items.pack.labels['wh.preview']);
  assert.deepEqual(ask.setLine, { pr: '14', head: items.pack.labels['wh.head'] });
  assert.equal(ask.labels.work, 'card-14');
  assert.deepEqual(ask.options, [{ id: 'approve', label: 'Approve' }, { id: 'reject', label: 'Suggest a change' }]);
  assert.equal(ask.context.branch, 'wh/card-14');
  assert.equal(ask.context.question, items.pack.message);
  assert.equal(ask.card, true);
});

test('the ask id is stable, and gives back the occurrence', () => {
  const one = normaliseAsk(items.pack, { now });
  const again = normaliseAsk(structuredClone(items.pack), { now: () => '2026-10-30T00:00:00.000Z' });
  assert.equal(one.id, again.id);
  assert.equal(askOccurrence(items.pack.runId, one.id), items.pack.occurrence);
  assert.equal(askOccurrence('another-run', one.id), null);
});

test('hold on a red main line is level 1 with answer hold', () => {
  const ask = normaliseAsk(items.mergeBase, { now });
  assert.equal(ask.kind, 'question');
  assert.equal(ask.level, 1);
  assert.equal(ask.answer, 'hold');
  assert.equal(ask.recommend, 'hold');
  assert.equal(ask.card, false);
  assert.match(ask.line, /main line is red/);
});

test('the red main line\'s hold opens a red-main incident, naming the pull request the queue suspects', () => {
  const ask = normaliseAsk(items.mergeBase, { now });
  assert.equal(ask.opens, 'red-main');
  assert.equal(ask.suspect, 41);
  assert.equal(normaliseAsk({ ...items.mergeBase, message: 'Merge queue: the default branch is red' }, { now }).suspect, null);
  assert.equal(normaliseAsk(items.pack, { now }).opens, undefined);
});

test("the merge queue's question about a pull request, and rounds ended, are level 3", () => {
  const pr = normaliseAsk(items.mergePr, { now });
  assert.equal(pr.level, 3);
  assert.equal(pr.kind, 'question');
  assert.equal(pr.answer, undefined);
  const rounds = normaliseAsk(items.roundsEnded, { now });
  assert.equal(rounds.level, 3);
  assert.deepEqual(rounds.options.map((o) => o.id), ['rerun', 'ready', 'finish']);
  assert.match(rounds.reason, /review/);
});

test('an unknown ask kind is level 3 recommending stop', () => {
  for (const name of ['gate', 'unreadable']) {
    const ask = normaliseAsk(items[name], { now });
    assert.equal(ask.kind, 'trouble', name);
    assert.equal(ask.level, 3, name);
    assert.equal(ask.recommend, 'stop', name);
    assert.equal(ask.card, true, name);
    assert.ok(ask.reason.length > 20, name);
    assert.doesNotMatch(ask.reason, /awaiting_response|child_run_missing|unreadable/, `${name}: plain words`);
  }
  const strange = { ...items.pack, labels: { ...items.pack.labels, 'wh.kind': 'wish' } };
  const ask = normaliseAsk(strange, { now });
  assert.equal(ask.kind, 'trouble');
  assert.equal(ask.recommend, 'stop');
  const novel = { ...items.usageLimit, kind: 'sandbox_request' };
  assert.equal(normaliseAsk(novel, { now }).level, 3);
});

test('a usage limit is a line, not a card', () => {
  const ask = normaliseAsk(items.usageLimit, { now });
  assert.equal(ask.kind, 'usage-limit');
  assert.equal(ask.resetAt, items.usageLimit.resetAt);
  assert.equal(ask.card, false);
  assert.deepEqual(ask.options, []);
  assert.match(ask.line, /carries on by itself/);
  assert.ok(ask.id.startsWith(items.usageLimit.runId));
  assert.equal(askOccurrence(items.usageLimit.runId, ask.id), null);
});

test("the table names each of Archon's own asks", () => {
  assert.deepEqual(ARCHON_ASKS.map((row) => row.name), ['main-line-red', 'merge-question', 'rounds-ended', 'usage-limit']);
  assert.ok(Object.isFrozen(ARCHON_ASKS));
});

test('a pack ask labelled as holding up all work says so, and so does the merge queue\'s own question', () => {
  const pack = normaliseAsk({ kind: 'attention', runId: 'r1', occurrence: 'o1', message: 'Which?', options: [{ id: 'a', label: 'A' }], labels: { 'wh.kind': 'question', 'wh.level': '3', 'wh.holds': 'all' } });
  assert.equal(pack.labels.holds, 'all');
  const merge = normaliseAsk({ kind: 'attention', runId: 'r2', occurrence: 'o2', message: 'Schema change', options: [{ id: 'approve', label: 'Approve' }], labels: { merge: 'pr' } });
  assert.equal(merge.holdsAll, true, 'the merge queue waits on it, so every ready pull request does');
});

test('the merge queue\'s question names its pull request, from the heading its record writes', () => {
  const merge = normaliseAsk({ kind: 'attention', runId: 'r3', occurrence: 'o3', message: '**Merge queue, PR 7: merge decision**\n\nShould it merge?', options: [{ id: 'merge', label: 'Merge' }], labels: { merge: 'pr' } });
  assert.equal(merge.mergeQuestion.pr, 7);
  assert.match(merge.reason, /pull request #7\b/);
  assert.doesNotMatch(merge.reason, /this pull request/);
});

test('a merge question with no heading is still a card, and names no number it can\'t read', () => {
  const merge = normaliseAsk({ kind: 'attention', runId: 'r4', occurrence: 'o4', message: 'Schema change in PR 99', options: [{ id: 'a', label: 'A' }], labels: { merge: 'pr' } });
  assert.equal(merge.mergeQuestion.pr, null);
  assert.match(merge.reason, /this pull request/);
});

test('parkChoice gives the park id only where the question offers it', () => {
  const options = [{ id: 'merge', label: 'Merge' }, { id: 'park', label: 'Leave it' }];
  assert.equal(parkChoice({ options, mergeQuestion: { pr: 7, park: 'park' } }), 'park');
  assert.equal(parkChoice({ options, mergeQuestion: { pr: 7, park: 'gone' } }), null);
  assert.equal(parkChoice({ options, mergeQuestion: { pr: 7, park: null } }), null);
  assert.equal(parkChoice({ options, mergeQuestion: { pr: 7 } }), null);
  assert.equal(parkChoice({ options }), null);
  assert.equal(parkChoice(null), null);
});
