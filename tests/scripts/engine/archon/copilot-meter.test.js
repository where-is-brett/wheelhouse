// tests/scripts/engine/archon/copilot-meter.test.js
// The spend meter's premium-request estimate against GitHub's own figure (Archon design, section 10.1; checks 74 and
// 79), on recordings: no Copilot request is sent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readGitHubFigure, checkRequests, accountKey, requestsFile, CHECK_EVERY_MS } from '../../../../scripts/engine/archon/copilot-meter.js';
import { readRecord } from '../../../../scripts/engine/archon/record.js';
import { requestRates, parseAccountModels } from '../../../../scripts/agents/copilot/column.js';

// `gh api /copilot_internal/user` in the shape check 74 read on 29 October 2026, cut to the fields the meter reads.
const RECORDED = {
  access_type_sku: 'free_educational_quota',
  copilot_plan: 'individual',
  quota_reset_date: '2026-11-01',
  quota_snapshots: { premium_interactions: { entitlement: 200, remaining: 162, credits_used: 38, overage_permitted: false, unlimited: false } },
};
const gh = (body, code = 0) => async (program, args) => {
  assert.equal(program, 'gh');
  assert.deepEqual(args, ['api', '/copilot_internal/user']);
  return { code, stdout: typeof body === 'string' ? body : JSON.stringify(body), stderr: '' };
};

test('GitHub\'s figure is read from the account\'s premium interactions', async () => {
  assert.deepEqual(await readGitHubFigure({ run: gh(RECORDED) }), { used: 38, entitlement: 200, remaining: 162, resets: '2026-11-01' });
  // Used is the entitlement less what remains when GitHub gives no count of its own.
  const noCount = structuredClone(RECORDED);
  delete noCount.quota_snapshots.premium_interactions.credits_used;
  assert.equal((await readGitHubFigure({ run: gh(noCount) })).used, 38);
  assert.equal(await readGitHubFigure({ run: gh('not json') }), null);
  assert.equal(await readGitHubFigure({ run: gh(RECORDED, 1) }), null);
  assert.equal(await readGitHubFigure({ run: async () => { throw new Error('no gh'); } }), null);
  assert.equal(await readGitHubFigure({ run: gh({ quota_snapshots: {} }) }), null);
});

test('the first check keeps GitHub\'s figure as the starting point, and says nothing', async () => {
  const at = new Date('2026-10-30T09:00:00Z');
  const got = await checkRequests({ read: async () => ({ used: 38, entitlement: 200, remaining: 162, resets: '2026-11-01' }), estimate: () => 0, kept: null, now: at });
  assert.deepEqual(got.kept, { at: at.toISOString(), baseline: 38, estimateAt: 0, resets: '2026-11-01', last: 38 });
  assert.equal(got.line, null);
  assert.equal(got.used, 0);
});

test('a day later, GitHub\'s count since the start is the true one, and a difference of more than one request is a line', async () => {
  const kept = { at: '2026-10-30T09:00:00.000Z', baseline: 38, estimateAt: 0, resets: '2026-11-01', last: 38 };
  const later = new Date(Date.parse(kept.at) + CHECK_EVERY_MS);
  const read = (used) => async () => ({ used, entitlement: 200, remaining: 200 - used, resets: '2026-11-01' });
  const close = await checkRequests({ read: read(44), estimate: () => 5, kept, now: later });
  assert.equal(close.used, 6, 'GitHub\'s six, not the estimate\'s five');
  assert.equal(close.line, null, 'within one request');
  const far = await checkRequests({ read: read(50), estimate: () => 5, kept, now: later });
  assert.equal(far.used, 12);
  assert.match(far.line, /estimated 5/);
  assert.match(far.line, /GitHub counted 12/);
  assert.match(far.line, /GitHub's figure is the one that counts/);
});

test('it checks once a day; before then, or when GitHub can\'t be read, the larger of the two counts stands', async () => {
  const kept = { at: '2026-10-30T09:00:00.000Z', baseline: 38, estimateAt: 0, resets: '2026-11-01', last: 44 };
  const soon = new Date(Date.parse(kept.at) + CHECK_EVERY_MS - 1);
  const notAsked = await checkRequests({ read: async () => assert.fail('not asked before a day is up'), estimate: () => 9, kept, now: soon });
  assert.equal(notAsked.used, 9);
  assert.deepEqual(notAsked.kept, kept);
  const later = new Date(Date.parse(kept.at) + CHECK_EVERY_MS);
  const unread = await checkRequests({ read: async () => null, estimate: () => 2, kept, now: later });
  assert.equal(unread.used, 6, 'GitHub\'s last count since the start');
  assert.match(unread.line, /couldn't read GitHub's figure/);
});

test('a new month starts again from GitHub\'s figure', async () => {
  const kept = { at: '2026-10-31T09:00:00.000Z', baseline: 38, estimateAt: 0, resets: '2026-11-01', last: 60 };
  const got = await checkRequests({ read: async () => ({ used: 2, entitlement: 200, remaining: 198, resets: '2026-12-01' }), estimate: () => 2, kept, now: new Date('2026-11-01T10:00:00Z') });
  assert.equal(got.kept.baseline, 0);
  assert.equal(got.used, 2);
});

test('each Copilot attempt counts at its model\'s rate from the account\'s list, marked estimated', () => {
  const step = (id, model, attempt) => ({
    nodeId: id,
    execution: {
      accounting: 'node', attempt: { id: attempt },
      binding: { provider: 'copilot', model: { requested: model } },
      spend: { tokens: { source: 'provider', value: { input: 100, output: 10 } }, costUsd: { source: 'unavailable', reason: 'not_reported' } },
    },
  });
  const json = { status: 'completed', nodes: [step('build', 'gpt-included', 'a1'), step('build', 'gpt-included', 'a2'), step('review', 'auto', 'a3'), step('plan', 'big', 'a4')] };
  const rates = requestRates(parseAccountModels({ models: { availableModels: [{ modelId: 'gpt-included', _meta: { copilotUsage: '0x' } }, { modelId: 'big', _meta: { copilotUsage: '10x' } }] } }));
  const got = readRecord(json, { rates });
  assert.deepEqual(got.steps.map((s) => [s.id, s.requests, s.source]), [['build', 0, 'estimated'], ['build', 0, 'estimated'], ['review', 1, 'estimated'], ['plan', 10, 'estimated']]);
  // With no list, every Copilot prompt counts one: never zero.
  assert.deepEqual(readRecord(json).steps.map((s) => s.requests), [1, 1, 1, 1]);
});

test('a figure that can\'t be read is asked for again a day later, not at every look', async () => {
  const at = new Date('2026-10-30T09:00:00Z');
  const first = await checkRequests({ read: async () => null, estimate: () => 3, kept: null, now: at });
  assert.equal(first.used, 3);
  assert.equal(first.kept.at, at.toISOString());
  const soon = await checkRequests({ read: async () => assert.fail('not asked again so soon'), estimate: () => 3, kept: first.kept, now: new Date(at.getTime() + 60000) });
  assert.equal(soon.used, 3);
  const day = await checkRequests({ read: async () => ({ used: 40, entitlement: 200, remaining: 160, resets: '2026-11-01' }), estimate: () => 3, kept: first.kept, now: new Date(at.getTime() + CHECK_EVERY_MS) });
  assert.equal(day.kept.baseline, 40, 'the first figure read is the starting point');
});

test('requests the meter counted before GitHub\'s first reading stay in the count after it', async () => {
  // GitHub couldn't be read at first, and 30 requests went by; then its figure is the starting point.
  const kept = { at: '2026-10-30T09:00:00.000Z', baseline: 70, estimateAt: 30, resets: '2026-11-01', last: 70 };
  const later = new Date(Date.parse(kept.at) + CHECK_EVERY_MS);
  const got = await checkRequests({ read: async () => ({ used: 75, entitlement: 200, remaining: 125, resets: '2026-11-01' }), estimate: () => 35, kept, now: later });
  assert.equal(got.used, 35, 'the 30 before the start and GitHub\'s 5 since');
  const soon = await checkRequests({ read: async () => assert.fail('not asked'), estimate: () => 31, kept: got.kept, now: new Date(later.getTime() + 1) });
  assert.equal(soon.used, 35, 'not dropped back between readings');
});

test('GitHub\'s count going down starts a new month, even with no reset date', async () => {
  const kept = { at: '2026-10-31T09:00:00.000Z', baseline: 38, estimateAt: 0, resets: null, last: 60 };
  const got = await checkRequests({ read: async () => ({ used: 3, entitlement: 200, remaining: 197, resets: null }), estimate: () => 2, kept, now: new Date('2026-11-01T10:00:00Z') });
  assert.equal(got.kept.baseline, 0);
  assert.equal(got.used, 3);
});

test('the line for a figure that can\'t be read is said once, until a reading works', async () => {
  const at = Date.parse('2026-10-30T09:00:00Z');
  const day = (n) => new Date(at + n * CHECK_EVERY_MS);
  const first = await checkRequests({ read: async () => null, estimate: () => 3, kept: null, now: day(0) });
  assert.match(first.line, /couldn't read/);
  const second = await checkRequests({ read: async () => null, estimate: () => 3, kept: first.kept, now: day(1) });
  assert.equal(second.line, null);
  const read = await checkRequests({ read: async () => ({ used: 40, entitlement: 200, remaining: 160, resets: '2026-11-01' }), estimate: () => 3, kept: second.kept, now: day(2) });
  const lastRead = await checkRequests({ read: async () => ({ used: 41, entitlement: 200, remaining: 159, resets: '2026-11-01' }), estimate: () => 4, kept: read.kept, now: day(3) });
  assert.equal(lastRead.kept.unread, undefined);
  const again = await checkRequests({ read: async () => null, estimate: () => 4, kept: lastRead.kept, now: day(4) });
  assert.match(again.line, /couldn't read/);
});

test('an estimate may be a promise', async () => {
  const got = await checkRequests({ read: async () => null, estimate: async () => 6, kept: null, now: new Date('2026-10-30T09:00:00Z') });
  assert.equal(got.used, 6);
});

test('each account has its own file, named by no login, and accounts that can\'t be told apart share one', () => {
  const ann = { lastLoggedInUser: { host: 'https://github.com', login: 'ann' } };
  const bob = { loggedInUsers: [{ host: 'https://github.com', login: 'bob' }] };
  assert.notEqual(accountKey(ann), accountKey(bob));
  assert.doesNotMatch(requestsFile('/e', ann), /ann/);
  assert.equal(accountKey({ last_logged_in_user: { host: 'https://github.com', login: 'ann' } }), accountKey(ann));
  assert.equal(accountKey(null), accountKey({}));
});
