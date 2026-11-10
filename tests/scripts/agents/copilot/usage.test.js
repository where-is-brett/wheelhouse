// tests/scripts/agents/copilot/usage.test.js
// Copilot's use and the month (Copilot return design, section 5.4, build part 8): a test month of recorded requests
// walks through the nudge at 150, the hold at 180 and the waiting state at 200, each with its card, once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  accountOf, choiceOf, isMonthRefusal, mayStart, modelOf, monthCard, monthOf, monthState, readAccount, readLedger, recordAccount,
  recordRefusal, recordRun, requestsIn, resetWords, resultOf, pruneLedger,
  NUDGE_FINISH, NUDGE_CARRY, NUDGE_HOLD, HOLD_KEEP, HOLD_ALLOW, WAIT_FOR, WAIT_MOVE,
} from '../../../../scripts/agents/copilot/usage.js';
import { composeCard } from '../../../../scripts/cards/compose.js';
import { monthFor } from '../../../../scripts/agents/usage-month.js';
import { usageFigures } from '../../../../scripts/usage/figures.js';
import { briefingModel } from '../../../../scripts/briefing/model.js';

const DAY = 24 * 60 * 60 * 1000;
const NOV = Date.UTC(2026, 10, 1);
const at = (day, hour = 9) => new Date(NOV + (day - 1) * DAY + hour * 3600 * 1000).toISOString();
const tmp = () => fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'copilot-usage-'));

test('the month is the calendar month in UTC, and resets on the 1st', () => {
  assert.equal(monthOf(at(10)), '2026-11');
  assert.equal(monthOf('2026-12-01T00:00:00Z'), '2026-12');
  assert.equal(monthOf('2026-11-30T23:59:59Z'), '2026-11');
  assert.equal(resetWords(at(10)), '1 December 2026');
  assert.equal(resetWords('2026-12-15T00:00:00Z'), '1 January 2027');
});

test('a session\'s count is cumulative across resumes: a line adds what it has over the last', () => {
  const lines = [
    { at: at(2), session: 'a', requests: 2 },
    { at: at(3), session: 'a', requests: 3 },
    { at: at(3), session: 'b', requests: 1 },
  ];
  assert.equal(requestsIn(lines, at(4)), 4);
  // A session resumed after a month starts counts only what it adds in the new month.
  const across = [{ at: '2026-10-30T10:00:00Z', session: 'a', requests: 5 }, { at: at(2), session: 'a', requests: 7 }];
  assert.equal(requestsIn(across, at(3)), 2);
  // A count that falls is a new count from zero.
  assert.equal(requestsIn([{ at: at(2), session: 'a', requests: 5 }, { at: at(3), session: 'a', requests: 2 }], at(4)), 7);
  // A refusal adds nothing; a damaged line is skipped.
  assert.equal(requestsIn([{ at: at(2), refused: true }, { at: at(2), session: 'a', requests: 'x' }, null], at(3)), 0);
});

test('the CLI\'s output gives the run\'s count, session and the model Auto chose', () => {
  const out = fs.readFileSync(new URL('../../../fixtures/copilot/run/hello-output.jsonl', import.meta.url), 'utf8');
  assert.deepEqual(resultOf(out), { session: '<ID>', requests: 1, exitCode: 0 });
  assert.equal(modelOf(out), '<MODEL>');
  assert.equal(resultOf('not json\n'), null);
  assert.equal(resultOf(''), null);
  assert.equal(modelOf('{"type":"result"}'), null);
});

test('the account\'s reading is parsed from either shape, and refused without a remaining figure', () => {
  assert.deepEqual(accountOf({ quota_remaining: 148.6, quota_reset_date: '2026-12-01' }, at(5)), { at: at(5), remaining: 148.6, entitlement: null, resetDate: '2026-12-01' });
  assert.deepEqual(accountOf({ quota_snapshots: { premium_interactions: { entitlement: 200, remaining: 51 } } }, at(5)).entitlement, 200);
  assert.equal(accountOf({ plan: 'x' }, at(5)), null);
  assert.equal(accountOf(null, at(5)), null);
});

// The test month: requests recorded run by run, then read with the director's Usage nudge at 75%.
function month(requests, extra = {}) {
  const lines = [];
  let total = 0;
  for (const [i, n] of requests.entries()) {
    total += n;
    lines.push({ at: at(2 + Math.floor(i / 3), 9 + (i % 3)), session: `s${i}`, requests: n });
  }
  return monthState({ lines, now: at(20), ...extra });
}

test('149 of 200 is on track: no step, no card', () => {
  const state = month([149]);
  assert.equal(state.step, 'none');
  assert.equal(state.line, 'Copilot: 149 of 200 this month');
  assert.equal(monthCard({ state, now: at(20) }), null);
});

test('a test month walks through the three steps with the right cards, each once', () => {
  const offers = [];
  const walk = (used) => {
    const lines = [{ at: at(5), session: 's', requests: used }];
    const state = monthState({ lines, now: at(20) });
    const card = monthCard({ state, offers, now: at(20) });
    if (card) offers.push(card.record);
    return { state, card };
  };

  // 150: the nudge, with the design's three options and the recommendation.
  const nudge = walk(150);
  assert.equal(nudge.state.step, 'nudge');
  assert.equal(nudge.card.card, 'nudge');
  assert.deepEqual(nudge.card.input.options.map((o) => o.label), [NUDGE_FINISH, NUDGE_CARRY, NUDGE_HOLD]);
  assert.equal(nudge.card.input.recommend, NUDGE_FINISH);
  assert.match(nudge.card.input.what, /150 of this month's 200 requests/);
  assert.match(nudge.card.input.meanwhile, /Work in progress carries on/);
  // The nudge is offered once for the month.
  assert.equal(walk(160).card, null);
  assert.equal(walk(179).state.step, 'nudge');

  // 180: new work isn't started; one card says so, with the date the month resets.
  const hold = walk(180);
  assert.equal(hold.state.step, 'hold');
  assert.equal(hold.card.card, 'hold');
  assert.deepEqual(hold.card.input.options.map((o) => o.label), [HOLD_KEEP, HOLD_ALLOW]);
  assert.match(hold.card.input.what, /new work isn't being started/);
  assert.match(hold.card.input.what, /1 December 2026/);
  assert.equal(walk(190).card, null);

  // 200: GitHub stops Copilot work; the piece waits for the month and the card says it resumes on the 1st.
  const waiting = walk(200);
  assert.equal(waiting.state.step, 'waiting');
  assert.equal(waiting.card.card, 'waiting');
  assert.deepEqual(waiting.card.input.options.map((o) => o.label), [WAIT_FOR, WAIT_MOVE]);
  assert.match(waiting.card.input.what, /carries on from what's there on 1 December 2026/);
  assert.match(waiting.card.input.meanwhile, /helper's window/);
  assert.equal(walk(205).card, null);
  assert.deepEqual(offers.map((o) => o.card), ['nudge', 'hold', 'waiting']);

  // Every card composes as a card the First Mate can ask.
  for (const card of [nudge.card, hold.card, waiting.card]) assert.doesNotThrow(() => composeCard(card.input));
  assert.equal(card1Level(nudge.card), 3);
});
const card1Level = (card) => card.input.level;

test('the month resets on the 1st: new offers are possible, and the old month\'s use is gone', () => {
  const lines = [{ at: at(5), session: 's', requests: 200 }];
  assert.equal(monthState({ lines, now: at(20) }).step, 'waiting');
  const december = monthState({ lines, now: '2026-12-01T00:00:01Z' });
  assert.equal(december.used, 0);
  assert.equal(december.step, 'none');
  const offers = [{ card: 'nudge', month: '2026-11', at: at(6) }];
  const again = monthState({ lines: [{ at: '2026-12-02T00:00:00Z', session: 'n', requests: 160 }], now: '2026-12-03T00:00:00Z' });
  assert.equal(monthCard({ state: again, offers, now: '2026-12-03T00:00:00Z' }).card, 'nudge');
});

test('a month that jumps past the nudge offers the hold card alone', () => {
  const state = month([185]);
  assert.equal(state.step, 'hold');
  assert.equal(monthCard({ state, now: at(20) }).card, 'hold');
});

test('the nudge follows the Usage nudge setting; off keeps the hold and the waiting state', () => {
  assert.equal(month([160], { mark: 'off' }).step, 'none');
  assert.equal(month([160], { mark: 90 }).step, 'none');
  assert.equal(month([160], { mark: 50 }).step, 'nudge');
  assert.equal(month([181], { mark: 'off' }).step, 'hold');
  assert.equal(month([200], { mark: 'off' }).step, 'waiting');
  // The allowance setting moves the steps: 75% of 100 is 75.
  assert.equal(month([75], { allowance: 100 }).step, 'nudge');
});

test('a refusal from GitHub puts the month into waiting whatever the count says', () => {
  const dir = tmp();
  recordRun({ at: at(5), session: 's', requests: 40, dir });
  recordRefusal({ at: at(6), session: 's', dir });
  const state = monthState({ lines: readLedger({ dir }), now: at(7) });
  assert.equal(state.step, 'waiting');
  assert.equal(state.refused, true);
  assert.equal(monthState({ lines: readLedger({ dir }), now: '2026-12-01T00:10:00Z' }).step, 'none');
});

test('GitHub\'s figure is used where the account reports one, with the CLI\'s count since the reading added', () => {
  const lines = [{ at: at(2), session: 'a', requests: 40 }, { at: at(6, 12), session: 'b', requests: 3 }];
  const account = { at: at(6), remaining: 148.6, entitlement: null, resetDate: '2026-12-01' };
  const state = monthState({ lines, account, now: at(7) });
  // The CLI says 43; GitHub says 51.4 used at the reading, and 3 more requests ran after it.
  assert.equal(state.source, 'github');
  assert.equal(state.used, 54.4);
  // The account's own entitlement wins over the setting.
  assert.equal(monthState({ lines, account: { ...account, entitlement: 300, remaining: 250 }, allowance: 200, now: at(7) }).allowance, 300);
  // A reading from last month, or from the future, says nothing about this one.
  assert.equal(monthState({ lines, account: { ...account, at: '2026-10-30T00:00:00Z' }, now: at(7) }).source, 'count');
  assert.equal(monthState({ lines, account: { ...account, at: at(20) }, now: at(7) }).source, 'count');
});

test('the ledger and the account reading are kept in the usage folder, and last month\'s lines pruned', () => {
  const dir = tmp();
  recordRun({ at: '2026-09-20T00:00:00Z', session: 'old', requests: 3, dir });
  recordRun({ at: '2026-10-20T00:00:00Z', session: 'prev', requests: 3, model: 'm', dir });
  recordRun({ at: at(3), session: 'now', requests: 2, dir });
  assert.equal(readLedger({ dir }).length, 3);
  assert.equal(pruneLedger({ now: at(5), dir }), 1);
  assert.deepEqual(readLedger({ dir }).map((l) => l.session), ['prev', 'now']);
  assert.throws(() => recordRun({ session: '../x', requests: 1, dir }));
  assert.throws(() => recordRun({ session: 'x', requests: -1, dir }));
  recordAccount({ at: at(3), remaining: 150, entitlement: 200, resetDate: '2026-12-01' }, { dir });
  assert.equal(readAccount({ dir }).remaining, 150);
  assert.equal(readAccount({ dir: tmp() }), null);
  fs.appendFileSync(path.join(dir, 'copilot-requests.jsonl'), 'torn');
  assert.equal(readLedger({ dir }).length, 2);
});

test('the gate: what may start at each step, and what the director\'s pick changes', () => {
  const at150 = month([150]);
  const at180 = month([180]);
  const at200 = month([200]);
  const kinds = ['new', 'continue', 'review-critical', 'wake'];
  const ok = (state, choice, kind) => mayStart({ state, choice, kind }).ok;

  // Before the nudge, and after it with no pick: everything runs.
  for (const kind of kinds) assert.equal(ok(month([100]), null, kind), true);
  for (const kind of kinds) assert.equal(ok(at150, null, kind), true);
  // Finish what's started, then hold: no new work, the rest carries on.
  assert.deepEqual(kinds.map((k) => ok(at150, choiceOf(NUDGE_FINISH), k)), [false, true, true, true]);
  // Hold new work until the 1st: nothing but the review of critical work.
  assert.deepEqual(kinds.map((k) => ok(at150, choiceOf(NUDGE_HOLD), k)), [false, false, true, false]);
  // At 180 new work isn't started; what is started finishes its task and stops.
  assert.deepEqual(kinds.map((k) => ok(at180, null, k)), [false, true, true, false]);
  assert.equal(mayStart({ state: at180, kind: 'continue' }).finishThenStop, true);
  assert.equal(ok(at180, choiceOf(HOLD_KEEP), 'continue'), false);
  assert.equal(ok(at180, choiceOf(HOLD_ALLOW), 'new'), true);
  // At 200 nothing starts, a critical review included: the piece waits rather than merging unreviewed.
  for (const kind of kinds) assert.equal(ok(at200, choiceOf(HOLD_ALLOW), kind), false);
  assert.match(mayStart({ state: at200, kind: 'new' }).why, /waiting for the month.*1 December 2026/);
  // The last request still covers a critical review at 199; at 200 it can't.
  assert.equal(ok(month([199]), null, 'review-critical'), true);
  assert.throws(() => mayStart({ state: at150, kind: 'sleep' }));
  assert.equal(mayStart({ state: null, kind: 'new' }).ok, true);
  assert.equal(choiceOf('nothing'), null);
});

test('GitHub\'s refusal is recognised by what it says of the limit, and ordinary errors are not', () => {
  for (const text of ['You have exceeded your monthly quota of premium requests', 'Premium request allowance reached for this month', 'You have no more premium requests this month', 'Quota exceeded']) {
    assert.equal(isMonthRefusal(text), true, text);
  }
  for (const text of ['The file was not found', 'Hook timed out', 'Not signed in', '', null]) assert.equal(isMonthRefusal(text), false, String(text));
});

test('the month reaches the board and the briefing: "Copilot: 120 of 200 this month"', () => {
  const dir = tmp();
  recordRun({ at: at(3), session: 'a', requests: 120, dir });
  assert.equal(monthFor('claude-code', { now: at(4), dir }), null);
  const state = monthFor('copilot', { now: at(4), dir, settings: { usageMark: { value: 75 }, copilotAllowance: { value: 200 } } });
  assert.equal(state.line, 'Copilot: 120 of 200 this month');
  assert.equal(state.step, 'none');

  const figures = usageFigures({ project: null, now: at(4), agent: 'copilot', month: state });
  assert.equal(figures.month.used, 120);
  // The words that say no month shows give way once a month is read.
  assert.equal(figures.missing.some((m) => /no month's total/.test(m)), false);
  assert.equal(usageFigures({ project: null, now: at(4), agent: 'copilot' }).missing.length, 1);

  const model = { director: {}, build: {}, waiting: [], work: [], health: [], blockers: [], missing: [] };
  const briefing = briefingModel({ model, usage: figures, sources: null, since: null, now: new Date(at(4)), wasRaised: () => false });
  assert.match(briefing.usage ?? '', /Copilot: 120 of 200 this month/);
});
