// tests/eval/front-desk/03-worker-label.js
// Scenario 3 (design section 18): a worker label in a briefing. Its source
// events say "PR", "CI" and "slice". Pass: what the session showed the director
// (its reply) has none of them bare: each is replaced, or defined where it
// stands ("<label> means …", "<label> (…)" or "(<label>)"); and it showed what
// happened, naming at least one of the work's titles.
// Run it with `npm run eval -- 3 --variant with` and `--variant without`.
//
// The director comes back after three hours. With Wheelhouse, the board context
// hook's briefing comes with the prompt, built by the hook's own functions from
// the state (scripts/eval/front-desk.js, promptContext). The state holds a merge
// whose words for users say "PR #14" and "CI", a feature building slice 2 of 3,
// and a pull request whose session reported it blocked. The project's history
// on main holds the same traffic in the workers' commits, which is what a session
// without Wheelhouse has to go on. Judged from the reply alone.
import { locateMattSkills, locateSuperpowers } from '../../../scripts/eval/harness.js';
import { bareLabels, replyText, seedEvent, setUpFrontDesk } from '../../../scripts/eval/front-desk.js';
import { SHOP_FILES, clock, featureEvent, workEvent } from './shop.js';

export const MESSAGE = 'Hi, I\'m back. What\'s been happening?';

// The work's titles, any of which shows the director what happened.
export const SHOWN = /opening hours|export|pre-order|Christmas/i;

export const COMMITS = [
  { message: 'opening-hours task 1/1: hours list and home page (TDD), PR #14', files: { 'src/opening-hours.js': 'export const HOURS = [\'Tue-Sat 7am-3pm\', \'Sun 8am-1pm\'];\n' } },
  { message: 'Merge PR #14: opening hours on the home page, CI green' },
  { message: 'orders-export slice 1: CSV rows, PR #17 (CI red: flaky test)', files: { 'src/export-rows.js': 'export const exportRows = (orders) => orders.map((o) => [o.pickUp, o.customer]);\n' } },
];

// The state as the workers left it.
export function seed(ago) {
  return [
    workEvent('opening-hours', 'Show the shop\'s opening hours on the home page', 'quick', ago(600)),
    featureEvent('opening-hours', 'building', ago(590), { branch: 'feature/opening-hours' }),
    seedEvent('merge', { pr: 14, forUsers: 'The home page shows the opening hours (PR #14, merged once CI passed)' }, ago(120)),
    seedEvent('report', { work: 'opening-hours', outcome: 'merged', pr: 14, summary: 'PR #14 merged once CI went green.', rulings: [] }, ago(119)),
    featureEvent('opening-hours', 'closed', ago(118)),
    workEvent('orders-export', 'Staff can export the orders list as a spreadsheet', 'feature', ago(3000)),
    featureEvent('orders-export', 'building', ago(60), { branch: 'feature/orders-export', slice: { n: 2, m: 3 } }),
    seedEvent('report', { work: 'orders-export', outcome: 'blocked', pr: 17, summary: 'CI red on PR #17: a flaky test in slice 1.', rulings: [] }, ago(30)),
  ];
}

// The pass, from the reply.
export function judge({ reply }) {
  const bare = bareLabels(reply);
  if (!SHOWN.test(reply)) return { pass: false, why: `nothing of what happened was shown${bare.length > 0 ? `, and it used ${bare.join(', ')} bare` : ''}` };
  if (bare.length > 0) return { pass: false, why: `it showed what happened with ${bare.join(', ')} bare` };
  return { pass: true, why: 'it showed what happened with no worker label bare: PR, CI and slice each replaced, defined or not used' };
}

export default {
  id: 3,
  title: 'A worker label in a briefing',

  setup: (dir, variant) => {
    const { ago } = clock();
    return setUpFrontDesk(dir, variant, { files: SHOP_FILES, commits: COMMITS, seed: seed(ago), lastPrompt: ago(180) });
  },

  prompt: MESSAGE,

  variants: {
    with: { get pluginDirs() { return [locateSuperpowers(), locateMattSkills()]; } },
    without: { get pluginDirs() { return [locateSuperpowers(), locateMattSkills()]; } },
  },

  permissionMode: 'acceptEdits',
  maxTurns: 40,

  pass: ({ events }) => judge({ reply: replyText(events) }),
};
