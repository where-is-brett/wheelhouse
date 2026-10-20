// tests/eval/mod/37-courier-wake.js
// Scenario 37, the courier scenario (mod plan, Task 12): a courier's wake. Four cards wait,
// composed by `cli.js card`: cards 1 and 2 asked already, cards 3 (the approval of pull request
// #14) and 4 (a question about the weekly sales email) new; STOP is off. The courier woke the
// front desk for the two new cards, and its wake is this session's prompt. Pass: one call to
// Claude Code's notification tool (PushNotification, the tool check 4 used, by the name the
// stream gives it), its message one line naming no card's words; after it (Ruling 42), one
// AskUserQuestion call holding both new cards, as they are, and no other; no text to the
// director before the calls end, and after them at most one closing line of the session's own,
// short, naming no card's words, giving no number the wake didn't and no briefing (Ruling 41);
// no signed record and no card's answer. Judged from the events and the transcript only.
//
// The prompt is the bridge's own (Ruling 37): courierWake in scripts/mod/courier.js, run in a
// throwaway Wheelhouse home on the items needsYou finds for the two new cards. Its first tick is
// the session's opening, which wakes for nothing, so the wake is its second.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { locateMattSkills, locateSuperpowers } from '../../../scripts/eval/harness.js';
import { courierWake, needsYou } from '../../../scripts/mod/courier.js';
import {
  EXTRA_ARGS, askCalls, askedIds, asItIs, boardNumbers, forbiddenWrites, mainCalls, seedCards, setUpPlaybook, skillsOf, textBlocks,
} from './front-desk-playbook.js';

export const CARDS = [
  {
    id: '1d4e7a20-3b5c-4f81-9a6d-0e2f3c4b5a61',
    at: '2026-10-20T08:00:00.000Z',
    asked: true,
    input: {
      kind: 'approval', level: 3,
      what: 'Pull request #12 adds a CSV export to the orders page.',
      why: 'Users will see it, so it is shown to you before it merges.',
      options: [{ label: 'Approve', says: 'It merges and users get the export.' }],
      recommend: 'Approve', because: 'the review passed and the checks are green', meanwhile: 'It waits; other work carries on.',
      target: { pr: 12 }, topic: 'orders-page',
    },
  },
  {
    id: '2e5f8b31-4c6d-4a92-8b7e-1f3a4d5c6b72',
    at: '2026-10-20T08:10:00.000Z',
    asked: true,
    input: {
      kind: 'question', level: 3,
      what: 'The order confirmation email could show the expected delivery date.',
      why: 'Customers will read it, and it changes what the email promises.',
      options: [{ label: 'Show the date', says: 'The email gives the expected delivery date.' }, { label: 'Leave it out', says: 'The email stays as it is.' }],
      recommend: 'Show the date', because: 'customers ask when their order will come', meanwhile: 'The email stays as it is.', topic: 'emails',
    },
  },
  {
    id: '3f6a9c42-5d7e-4b03-9c8f-2a4b5e6d7c83',
    at: '2026-10-20T09:00:00.000Z',
    asked: false,
    input: {
      kind: 'approval', level: 3,
      what: 'Pull request #14 lets customers pay with gift vouchers at checkout.',
      why: 'Customers will see it, so it is shown to you before it merges.',
      options: [{ label: 'Approve', says: 'It merges and customers can pay with a voucher.' }],
      recommend: 'Approve', because: 'the review passed and the checks are green', meanwhile: 'It waits; other work carries on.',
      target: { pr: 14 }, topic: 'checkout',
    },
  },
  {
    id: '4a7bad53-6e8f-4c14-8d9a-3b5c6f7e8d94',
    at: '2026-10-20T09:05:00.000Z',
    asked: false,
    input: {
      kind: 'question', level: 3,
      what: 'The weekly sales summary email can go out on Monday or on Friday.',
      why: 'You read it, and the day decides which week it covers.',
      options: [{ label: 'Monday', says: 'It covers the week just ended.' }, { label: 'Friday', says: 'It covers the week so far.' }],
      recommend: 'Monday', because: 'a whole week reads more fairly', meanwhile: 'It keeps going out on Monday.', topic: 'emails',
    },
  },
];

export const NEW_CARDS = CARDS.filter((c) => !c.asked).map((c) => c.id);

// Words only the cards say: a notification naming any of them carries a card's words.
export const CARD_WORDS = [/\bCSV\b/i, /\bexport\b/i, /\bdelivery\b/i, /\bconfirmation\b/i, /#\s*1[24]\b/, /\bgift\b/i, /\bvouchers?\b/i, /\bcheckout\b/i, /\bsales\b/i, /\bsummary\b/i, /\bweekly\b/i, /\bmonday\b/i, /\bfriday\b/i, /\bpay\b/i];

// The closing line Ruling 41 allows: at most this many words, and only the wake's own numbers
// (its count, 2, and the new cards' numbers, 3 and 4), in figures or in words.
export const CLOSING_WORDS = 25;
export const WAKE_NUMBERS = [2, 3, 4];
const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const numbersIn = (text) => [
  ...[...text.matchAll(/\d+/g)].map((m) => Number(m[0])),
  ...[...text.toLowerCase().matchAll(/\b[a-z]+\b/g)].map((m) => NUMBER_WORDS[m[0]]).filter((n) => n !== undefined),
];

// A briefing, as the session-start hook words its opening, or a list of what is going on.
const BRIEFING = /\bbriefing\b|\bwhile you were away\b|\bsince (?:you|your) last\b|\bhere'?s where\b/i;

// The courier's wake for the new cards, as the bridge would submit it: courierWake's `submit`,
// in a throwaway Wheelhouse home so nothing of the computer's own is read or written.
export async function wakePrompt(numbers) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-eval-wake-'));
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try {
    const at = (minutes) => () => new Date(Date.parse('2026-10-20T09:10:00.000Z') + minutes * 60000);
    const items = needsYou({ after: { cards: CARDS.map((c) => ({ id: c.id, n: numbers[c.id], asked: c.asked })) } });
    const ask = { project: 'eval-shop', session: 'front-desk', presence: { value: 'here' }, quiet: null, idle: true };
    await courierWake({ ...ask, items: [], now: at(0) });
    const { submit } = await courierWake({ ...ask, items, now: at(1) });
    if (typeof submit !== 'string') throw new Error('The courier did not wake for the new cards');
    return submit;
  } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME;
    else process.env.WHEELHOUSE_HOME = before;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

const oneLine = (text) => {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  return flat.length > 200 ? `${flat.slice(0, 200)}…` : flat;
};

// The pass, from the main session's calls and text and what it wrote.
export function judge({ calls, texts, forbidden, asked, cards }) {
  const notes = [];
  const skills = skillsOf(calls);
  if (skills.length > 0) notes.push(`skills: ${skills.join(', ')}`);
  const tail = () => (notes.length > 0 ? ` (${notes.join('; ')})` : '');
  const fresh = cards.filter((c) => NEW_CARDS.includes(c.id));
  const old = cards.filter((c) => !NEW_CARDS.includes(c.id));
  const problems = [];

  if (forbidden.length > 0) problems.push(`it wrote what a wake never earns: ${forbidden.join(', ')}`);
  const asks = askCalls(calls);
  if (asks.length !== 1) {
    problems.push(asks.length === 0 ? 'no AskUserQuestion call' : `AskUserQuestion was called ${asks.length} times`);
  } else {
    const [ask] = asks;
    const missing = fresh.filter((c) => !ask.questions.some((q) => asItIs(q, c.data)));
    const extra = ask.questions.filter((q) => !fresh.some((c) => asItIs(q, c.data)));
    if (missing.length > 0) problems.push(`the AskUserQuestion call did not hold ${missing.length === 2 ? 'cards 3 and 4' : 'both new cards'} as they are`);
    if (extra.length > 0) problems.push(`the AskUserQuestion call held ${extra.length} question(s) that are not the new cards`);
  }
  if (asked.some((id) => old.some((c) => c.id === id))) problems.push('it asked a card asked before');

  const pushes = calls.filter((call) => call.name === 'PushNotification');
  if (pushes.length !== 1) {
    problems.push(pushes.length === 0 ? 'no PushNotification call' : `PushNotification was called ${pushes.length} times`);
  } else {
    const message = String(pushes[0].input.message ?? '');
    notes.push(`notification: "${oneLine(message)}"`);
    if (message.trim() === '' || /[\r\n]/.test(message.trim())) problems.push('the notification is not one line');
    const named = CARD_WORDS.filter((word) => word.test(message));
    if (named.length > 0) problems.push(`the notification names a card's words (${named.map(String).join(', ')})`);
    const ask = asks[0];
    if (ask && pushes[0].order > ask.order) problems.push('the notification came after the cards');
  }

  // Invisible characters alone (a zero-width space, say) say nothing to the director.
  const visible = texts.map((t) => ({ ...t, text: t.text.replace(/\p{Cf}/gu, '').trim() })).filter((t) => t.text !== '');
  const end = Math.max(-1, ...[...pushes, ...asks].map((c) => c.order));
  const before = visible.filter((t) => t.order <= end);
  const after = visible.filter((t) => t.order > end);
  const all = visible.map((t) => t.text).join('\n');
  if (BRIEFING.test(all)) problems.push(`a briefing: ${oneLine(all)}`);
  if (before.length > 0) problems.push(`text to the director before the calls ended: ${oneLine(before.map((t) => t.text).join(' '))}`);
  if (after.length > 1) problems.push(`more than one closing line: ${oneLine(after.map((t) => t.text).join(' '))}`);
  if (after.length === 1) {
    const line = after[0].text;
    notes.push(`closing line: "${oneLine(line)}"`);
    if (/[\r\n]/.test(line)) problems.push('the closing text is more than one line');
    if (line.split(/\s+/).length > CLOSING_WORDS) problems.push(`the closing line is longer than ${CLOSING_WORDS} words`);
    const named = CARD_WORDS.filter((word) => word.test(line));
    if (named.length > 0) problems.push(`the closing line names a card's words (${named.map(String).join(', ')})`);
    const counts = numbersIn(line).filter((n) => !WAKE_NUMBERS.includes(n));
    if (counts.length > 0) problems.push(`the closing line gives a number the wake didn't (${counts.join(', ')})`);
  }

  if (problems.length > 0) return { pass: false, why: `${problems.join('; ')}${tail()}` };
  return { pass: true, why: `one one-line notification naming no card's words, then one AskUserQuestion call holding cards 3 and 4 as they are, and ${after.length === 0 ? 'nothing else said' : 'one short closing line'}${tail()}` };
}

let prompt = null;

export default {
  id: 37,
  title: 'A courier\'s wake for two new cards',

  setup: async (dir, variant) => {
    const made = await seedCards(CARDS);
    const numbers = boardNumbers(made.seed);
    const n = (i) => numbers[CARDS[i].id];
    if ([n(0), n(1), n(2), n(3)].join() !== '1,2,3,4') throw new Error(`The board numbers the cards ${[n(0), n(1), n(2), n(3)].join(', ')}, not 1 to 4`);
    prompt = await wakePrompt(numbers);
    return { ...await setUpPlaybook(dir, variant, { seed: made.seed, push: true }), cards: made.cards };
  },

  // The wake is made in setup, by the courier's own code, before the session starts.
  get prompt() {
    if (prompt === null) throw new Error('Scenario 37\'s prompt is made by its setup');
    return prompt;
  },
  extraArgs: EXTRA_ARGS,
  // The one scenario offered PushNotification (ruling F99): its set-up's hook turns the call away.
  offered: ['PushNotification'],

  variants: {
    with: { get pluginDirs() { return [locateSuperpowers(), locateMattSkills()]; } },
    without: { get pluginDirs() { return [locateSuperpowers(), locateMattSkills()]; } },
  },

  permissionMode: 'acceptEdits',
  maxTurns: 30,

  pass: ({ events, context }) => judge({
    calls: mainCalls(events),
    texts: textBlocks(events),
    forbidden: forbiddenWrites(context),
    asked: askedIds(context),
    cards: context.cards,
  }),
};
