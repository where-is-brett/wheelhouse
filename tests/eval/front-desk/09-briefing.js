// tests/eval/front-desk/09-briefing.js
// Scenario 9 (design sections 5.2 and 18): a return after three hours, with
// worker traffic in the state. Pass: the reply opens with the briefing (at most
// twelve words before its first line), shows every line of it in its order,
// keeps the shown briefing within 150 words, its "Terms:" line counted when it
// is shown, in whatever words, and has no worker chatter anywhere (CHATTER:
// the build's own talk, planted in its dispatches, notes and reports).
// Run it with `npm run eval -- 9 --variant with` and `--variant without`.
//
// With Wheelhouse, the board context hook's briefing comes with the prompt,
// built by the hook's own functions from the state (promptContext in
// scripts/eval/front-desk.js), and is what the reply is judged against; the
// "Terms:" line is added after the briefing's word limit (a deferred minor of
// the front desk plan's Task 5), so the words are counted with it and without
// it. Without Wheelhouse no briefing exists to show: the fail is structural, and
// the judgement names the reply's length and any chatter in it. The workers'
// commits on main carry the same traffic for both. Judged from the reply and
// what the hooks gave.
import { locateMattSkills, locateSuperpowers } from '../../../scripts/eval/harness.js';
import { replyText, seedEvent, setUpFrontDesk } from '../../../scripts/eval/front-desk.js';
import { HEADINGS } from '../../../scripts/hooks/board-context.js';
import { SHOP_FILES, clock, featureEvent, workEvent } from './shop.js';

export const MESSAGE = 'Hi, I\'m back. Anything I need to know?';

// The build's own talk, planted in the state's dispatches, notes and reports, and the commits.
export const CHATTER = /\bsub-?agents?\b|spec-reviewer|code-quality reviewer|fix round|re-review|\brebased?\b|\bTDD\b|red-green|\bworktrees?\b|\btask \d+\/\d+|\bflaky\b/i;

export const USAGE = { week: { tokens: 1200000, usd: 84, share: 34 }, unusual: [] };

export const COMMITS = [
  { message: 'opening-hours task 1/1 (TDD, red-green): hours list', files: { 'src/opening-hours.js': 'export const HOURS = [\'Tue-Sat 7am-3pm\', \'Sun 8am-1pm\'];\n' } },
  { message: 'Address spec-reviewer finding: fix round 1, re-review clean' },
  { message: 'Merge PR #14: opening hours on the home page' },
  { message: 'staff page: mark collected (subagent task 2/2), rebased on main' },
];

// The state as the workers left it, three hours after the director last wrote.
export function seed(ago) {
  return [
    workEvent('opening-hours', 'Show the shop\'s opening hours on the home page', 'quick', ago(600)),
    featureEvent('opening-hours', 'building', ago(590), { branch: 'feature/opening-hours' }),
    seedEvent('dispatch', { work: 'opening-hours', what: 'Builder subagent dispatched for task 1/1 (TDD, red-green) in worktree .claude/worktrees/opening-hours' }, ago(170)),
    seedEvent('note', { work: 'opening-hours', text: 'spec-reviewer found 1 issue; fix round 1; re-review clean; rebased on main' }, ago(140)),
    seedEvent('report', { work: 'opening-hours', outcome: 'merged', pr: 14, summary: 'Builder subagent finished task 1/1; spec-reviewer and code-quality reviewer clean after fix round 1; rebased on main; merged once the checks passed.', rulings: [] }, ago(125)),
    seedEvent('merge', { pr: 14, forUsers: 'The home page shows the shop\'s opening hours' }, ago(120)),
    featureEvent('opening-hours', 'closed', ago(119)),
    seedEvent('merge', { pr: 15, forUsers: 'Staff can mark an order as collected from the staff page' }, ago(110)),
    seedEvent('merge', { pr: 16, forUsers: 'The order form remembers a customer\'s name for next time' }, ago(90)),
    seedEvent('merge', { pr: 18, forUsers: 'Sold-out items show as sold out on the menu' }, ago(30)),
    workEvent('orders-export', 'Staff can export the orders list as a spreadsheet', 'feature', ago(3000)),
    featureEvent('orders-export', 'building', ago(60), { branch: 'feature/orders-export', slice: { n: 2, m: 3 } }),
    seedEvent('report', { work: 'orders-export', outcome: 'blocked', pr: 17, summary: 'Checks red on #17: a flaky test in slice 1; re-ran twice; the subagent rebased the worktree.', rulings: [] }, ago(20)),
    workEvent('christmas-pre-orders', 'Customers can pre-order the Christmas range', 'feature', ago(2000)),
    featureEvent('christmas-pre-orders', 'building', ago(100), { branch: 'feature/christmas-pre-orders', slice: { n: 1, m: 3 } }),
    seedEvent('question', {
      id: 'q-christmas-pre-orders-1',
      work: 'christmas-pre-orders',
      what: 'Should Christmas pre-orders close on 18 December or 20 December?',
      why: 'It sets the last day customers can order, which they will see.',
      options: [{ label: '18 December', says: 'Two clear days to bake every order.' }, { label: '20 December', says: 'More orders, with one baking day less.' }],
      recommendation: '18 December',
      level: 3,
    }, ago(45)),
  ];
}

// A text as words, without Markdown's marks or a list's markers, in lower case.
const plain = (text) => String(text).replace(/^\s*(?:[-*•>]|\d+[.)])\s+/gm, '').replace(/[*_`#>]/g, '').toLowerCase().split(/\s+/).filter(Boolean);

// Where the words of `line` stand in `words` from `from` on, or -1.
function find(words, line, from) {
  const want = plain(line);
  for (let i = from; i + want.length <= words.length; i += 1) {
    if (want.every((w, j) => words[i + j] === w)) return i;
  }
  return -1;
}

// How the reply shows `briefing` (the hook's text without its heading): whether every line is
// there in order, the words before its first line, and the words it takes, with and without its
// "Terms:" line: the hook's own, word for word, or else a paragraph of the reply after the briefing
// that starts "Terms:" in its own words.
export function shown(reply, briefing) {
  const words = plain(reply);
  const lines = String(briefing).split('\n').map((l) => l.trim()).filter(Boolean);
  const terms = lines.find((l) => l.startsWith('Terms:'));
  const body = lines.filter((l) => l !== terms);
  let at = 0;
  let first = -1;
  let end = -1;
  const missing = [];
  for (const line of body) {
    const found = find(words, line, at);
    if (found === -1) {
      missing.push(line);
      continue;
    }
    if (first === -1) first = found;
    at = found + plain(line).length;
    end = at;
  }
  const termsAt = terms === undefined || end === -1 ? -1 : find(words, terms, end);
  const bodyWords = first === -1 ? 0 : end - first;
  const own = termsAt !== -1 || end === -1 ? null
    : String(reply).split(/\n\s*\n/).map(plain).find((p, i, all) => p[0] === 'terms:' && all.slice(0, i).flat().length >= end);
  const termsWords = termsAt !== -1 ? plain(terms).length : own ? own.length : 0;
  return {
    missing,
    before: first === -1 ? words.length : first,
    bodyWords,
    termsShown: termsAt !== -1 || Boolean(own),
    words: bodyWords + termsWords,
  };
}

// The pass, from the reply and the briefing the hook gave (null without Wheelhouse).
export function judge({ reply, briefing }) {
  const chatter = String(reply).match(CHATTER);
  const said = chatter ? `; chatter: "${chatter[0]}"` : '';
  if (briefing === null) return { pass: false, why: `no briefing to show (structural); the reply is ${plain(reply).length} words${said}` };
  const how = shown(reply, briefing);
  const counted = `${how.words} words shown${how.termsShown ? `, ${how.bodyWords} without its Terms line` : ''}`;
  if (how.missing.length > 0) return { pass: false, why: `the briefing was not shown whole and in order: ${how.missing.length} line(s) missing, first "${how.missing[0]}" (${counted})${said}` };
  if (how.before > 12) return { pass: false, why: `the reply did not open with the briefing: ${how.before} words before it (${counted})${said}` };
  if (chatter) return { pass: false, why: `the briefing was shown in order, but the reply has worker chatter: "${chatter[0]}" (${counted})` };
  if (how.words > 150) return { pass: false, why: `the briefing opened the reply in order with no chatter, but ${counted}` };
  return { pass: true, why: `the briefing opened the reply, in order, with no chatter, ${counted}` };
}

// The briefing the board context hook gave the session, without its heading, or null.
export function briefingGiven(hooksGave) {
  const given = (hooksGave ?? []).find((h) => h.event === 'UserPromptSubmit' && typeof h.text === 'string' && h.text.includes(HEADINGS.briefing));
  return given === undefined ? null : given.text.slice(given.text.indexOf(HEADINGS.briefing) + HEADINGS.briefing.length).trim();
}

export default {
  id: 9,
  title: 'A return after a gap with worker traffic in between',

  setup: (dir, variant) => {
    const { ago } = clock();
    return setUpFrontDesk(dir, variant, { files: SHOP_FILES, commits: COMMITS, seed: seed(ago), lastPrompt: ago(180), usage: USAGE });
  },

  prompt: MESSAGE,

  variants: {
    with: { get pluginDirs() { return [locateSuperpowers(), locateMattSkills()]; } },
    without: { get pluginDirs() { return [locateSuperpowers(), locateMattSkills()]; } },
  },

  permissionMode: 'acceptEdits',
  maxTurns: 40,

  pass: ({ events, context }) => judge({ reply: replyText(events), briefing: briefingGiven(context?.hooksGave?.()) }),
};
