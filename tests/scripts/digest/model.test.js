// tests/scripts/digest/model.test.js
// The daily digest's four sections, in the order of design section 9, and the weekly decision log. Made-up project: harbour-demo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digestModel, digestText, hasNews } from '../../../scripts/digest/model.js';
import { makeEvent } from '../../../scripts/state/events.js';
import { readEnrolled } from '../../../scripts/state/signing.js';
import { pendingDecisions } from '../../../scripts/decisions/pending.js';
import { P, inHome, keep, raise } from '../../helpers/decisions-world.js';

const NOW = new Date(2026, 10, 8, 17, 0);
const iso = (ms) => new Date(NOW.getTime() + ms).toISOString();
const HOUR = 3600 * 1000;

const merged = (pr, ms, extra = {}) => makeEvent({
  kind: 'self-merged', data: { pr, commit: 'a'.repeat(40), reason: 'internal', ...extra }, now: () => new Date(iso(ms)),
});
const approvalCard = (pr, ms, title) => keep(makeEvent({
  kind: 'card',
  data: { question: `${title}\nApprove pull request #${pr} at commit abcdef123456`, header: 'Approve', options: ['Approve', 'Not now'], kind: 'question', level: 3, line: `Approve pull request #${pr} at commit abcdef123456` },
  now: () => new Date(iso(ms)),
}));

test('the digest lists self-merged, waiting for approval, waiting on decisions with what each did meanwhile, and usage', () => inHome(() => {
  const asked = raise('Should the harbour map show tide times?', iso(-2 * HOUR));
  assert.ok(asked);
  const pending = pendingDecisions(P);
  assert.equal(pending.length, 1);
  const events = [
    merged(12, -3 * HOUR, { title: 'Rename the tide table', work: 'w-tide-1', paths: 2 }),
    merged(13, -30 * HOUR, { title: 'Too old for today' }),
    merged(15, -1 * HOUR, { reason: 'decision-records', title: 'Keep the decisions of 7 November 2026' }),
    approvalCard(14, -4 * HOUR, 'Add tide times to the harbour map'),
  ];
  const model = digestModel({
    events, pending, now: NOW, since: iso(-24 * HOUR), enrolled: readEnrolled(),
    usage: { week: { tokens: 1200000, usd: 84, share: 34.4 } },
  });
  assert.deepEqual(model.selfMerged.map((m) => m.pr), [12, 15]);
  assert.equal(model.selfMerged[0].title, 'Rename the tide table');
  assert.equal(model.selfMerged[1].reason, 'decision records');
  assert.deepEqual(model.waitingApproval, [{ pr: 14, title: 'Add tide times to the harbour map' }]);
  assert.equal(model.waitingDecisions.length, 1);
  assert.equal(model.waitingDecisions[0].n, 1);
  assert.equal(model.waitingDecisions[0].work, 'w-tide-1');
  assert.equal(typeof model.waitingDecisions[0].meanwhile, 'string');
  assert.deepEqual(model.usage, { tokens: 1200000, usd: 84, share: 34 });
  assert.equal(model.calls, undefined, 'no decision log on a day that is not the weekly one');

  const text = digestText(model, { now: NOW });
  const order = ['Daily digest, 8 November 2026', 'Merged by itself', 'waiting for your approval', 'Waiting on your decisions', 'Usage this week'].map((s) => text.indexOf(s));
  assert.ok(order.every((at) => at >= 0), text);
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'the four sections come in the design\'s order');
  assert.match(text, /Pull request #12: Rename the tide table/u);
  assert.match(text, /Pull request #14: Add tide times to the harbour map/u);
  assert.match(text, /1\. Should the harbour map show tide times\?/u);
  assert.match(text, /1\.2M tokens, about \$84 at API prices, 34% of your weekly allowance/u);
  assert.doesNotMatch(text, /Too old for today/u);
  assert.equal(hasNews(model), true);
}));

test('an approval card waits, and a quiet day says nothing waits', () => inHome(() => {
  const card = approvalCard(14, -4 * HOUR, 'Add tide times');
  const model = digestModel({ events: [card], pending: [], now: NOW, enrolled: readEnrolled(), usage: null });
  assert.equal(model.waitingApproval.length, 1);
  const quiet = digestModel({ events: [], pending: [], now: NOW, usage: null });
  const text = digestText(quiet, { now: NOW });
  assert.equal(text.match(/Nothing\./gu).length, 3);
  assert.match(text, /Usage this week isn't known yet/u);
  assert.equal(hasNews(quiet), false);
}));

test('the weekly decision log appears once a week, last, and carries the calls', () => inHome(() => {
  const calls = [
    { work: 'w-tide-1', at: iso(-2 * 24 * HOUR), decided: 'Show the tide times in a table', options: ['A table', 'A chart'], why: 'A table reads on a small screen', kind: 'product' },
    { work: 'w-tide-2', at: iso(-1 * 24 * HOUR), decided: 'Keep the old colours', options: [], why: '', kind: 'product' },
  ];
  const weekly = digestModel({ events: [], pending: [], calls, now: NOW, weekly: true, alertFailures: ['ntfy', 'ntfy'] });
  assert.equal(weekly.calls.length, 2);
  const text = digestText(weekly, { now: NOW });
  assert.ok(text.indexOf('decision log') > text.indexOf('Usage this week'));
  assert.match(text, /w-tide-1: Show the tide times in a table\. Why: A table reads on a small screen\. Options: A table, A chart\./u);
  assert.match(text, /w-tide-2: Keep the old colours/u);
  assert.match(text, /A phone alert couldn't be sent through ntfy\. Decisions wait here in the chat all the same\.$/u, 'a failed channel is noted, once');
  const empty = digestText(digestModel({ events: [], pending: [], calls: [], now: NOW, weekly: true }), { now: NOW });
  assert.match(empty, /No calls were logged this week\./u);
  const daily = digestText(digestModel({ events: [], pending: [], calls, now: NOW, weekly: false }), { now: NOW });
  assert.doesNotMatch(daily, /decision log/u);
}));

test('words an agent wrote reach the digest on one line, with no link, and cut short', () => inHome(() => {
  const long = 'Rename the tide table '.repeat(8);
  const events = [merged(12, -HOUR, { title: `[x](https://e.test/x)\n${long}` })];
  const model = digestModel({ events, pending: [], now: NOW });
  const title = model.selfMerged[0].title;
  assert.ok(title.length <= 160);
  assert.doesNotMatch(title, /https?:|\n|\]\(/u);
}));

test('a model with nothing readable is empty and never throws', () => {
  const model = digestModel({ events: 'no', pending: 7, calls: {}, usage: 'no', now: 'not a time', weekly: true });
  assert.deepEqual(model.selfMerged, []);
  assert.deepEqual(model.waitingDecisions, []);
  assert.equal(model.usage, null);
  assert.equal(typeof digestText(model), 'string');
  assert.equal(typeof digestText(undefined), 'string');
  assert.equal(hasNews(digestModel()), false);
});

test('the weekly decision log leaves out the director\'s own calls made at the helm', () => inHome(() => {
  const calls = [
    { work: 'w-tide-1', at: iso(-2 * 24 * HOUR), decided: 'Show the tide times in a table', options: [], why: '', kind: 'product' },
    { work: 'w-tide-1', at: iso(-1 * 24 * HOUR), decided: 'The director steered this piece from 14:02 to 14:31', options: [], why: '', kind: 'helm', where: 'helm' },
  ];
  const model = digestModel({ events: [], pending: [], calls, now: NOW, weekly: true });
  assert.equal(model.calls.length, 1);
  const text = digestText(model, { now: NOW });
  assert.match(text, /Show the tide times in a table/u);
  assert.equal(/steered this piece/u.test(text), false);
}));
