// tests/eval/build-loop/25-split-and-duplicate.js
// Scenario 25 (design sections 3 and 15): one message from the director with
// three requests, one of them asking for what open work already builds. Pass:
// three routes said, one for each request, and the duplicate joined to the
// existing work: said to be there already (or steered, route 3), with no
// second work item or idea recorded for it, and not built at the front desk
// (no write to the product's code).
// Run it with `npm run eval -- 25 --variant with` and `--variant without`.
//
// The front desk works in the bakery's order book (bakery.js). Its state holds
// two pieces of open work: `orders-export`, a small brief the director has
// approved, not started (staff download the orders list as a CSV file), and
// `opening-hours`, building; an idea (a loyalty scheme) and a rejection
// (text-message reminders). The message asks for a fix (the staff page's total
// counts cancelled orders), for the orders list as a spreadsheet (the
// duplicate), and for gift cards some day. Judged from what the session said
// to the director and the events it wrote to the state, never its own account.
import path from 'node:path';
import { locateMattSkills, locateSuperpowers } from '../../../scripts/eval/harness.js';
import { callsOf } from '../../../scripts/eval/feature-project.js';
import {
  codeWrites, replyText, saidAbout, seedEvent, setUpFrontDesk, skillsStarted, writtenEvents,
} from '../../../scripts/eval/front-desk.js';
import { FILES, OPENING_HOURS, doc } from './bakery.js';

export const EXISTING = 'orders-export';

const EXPORT_BRIEF = doc('docs/work/orders-export.md', `# Download the orders list

Staff can download the orders list for a day, or a week, as a CSV file, from a
button on the staff page, so they can do the weekly stock count in a
spreadsheet. One row per order: pick-up day, customer, items, total, status.

Done when: the button gives a CSV file that opens in a spreadsheet, with
every order of the days chosen.
`);

export const MESSAGE = 'Three things. The day\'s total on the staff page counts cancelled orders too, so it looks bigger than it is. '
  + 'Staff also need to be able to download the orders list as a spreadsheet for the weekly stock count. '
  + 'And some day, not now, it would be lovely if customers could pay with gift cards.';

// Each request's words, so its paragraph can be found in the reply.
export const REQUESTS = {
  fix: /cancel|total/i,
  duplicate: /spreadsheet|download|export|csv/i,
  later: /gift/i,
};

// A route said: one of the intake's nine, by name or number, or an idea for later. The routes
// named by everyday words (a change, a question, an answer, a musing) count only when said of
// the request: "as a change", "is a question".
export const ROUTE = /\b(?:incident|running work|bug|runbook|chore|later|ideas?|route\s*[1-9])\b|\b(?:as|is) an? (?:change|question|musing|answer)\b/i;
// The duplicate joined: said to be there already, or steered as running work.
export const JOINED = /\balready\b|running work|route\s*3|orders-export|\bamend|in the queue|queued|same (?:thing|work|request)/i;
const ABOUT_EXPORT = /export|csv|spreadsheet|download/i;

const textOf = (data) => [data?.id, data?.key, data?.title, data?.text, data?.what, data?.doc?.path].filter((x) => typeof x === 'string').join(' ');

// The pass, from the reply and the events written. `written` are the events the session
// added to the state; `calls` its tool calls.
export function judge({ reply, written, calls, dir, variant }) {
  const notes = [];
  const skills = skillsStarted(calls);
  if (variant === 'with') notes.push(skills.some((s) => /intake/.test(s)) ? 'it started the intake' : 'it did not start the intake');
  const kinds = written.map((e) => (e.kind === 'work' ? `work ${e.data?.id} (${e.data?.lane})` : `${e.kind}${e.data?.work ? ` ${e.data.work}` : e.data?.key ? ` ${e.data.key}` : ''}`));
  notes.push(kinds.length > 0 ? `recorded: ${kinds.join(', ')}` : 'recorded nothing');
  const tail = ` (${notes.join('; ')})`;

  // The front desk never builds: code written here is a request done, not routed, and a
  // duplicate built here is not joined to the work that has it.
  const wrote = [...new Set(codeWrites(calls, dir))].map((file) => path.basename(file));
  if (wrote.length > 0) return { pass: false, why: `it built at the front desk: it wrote ${wrote.join(', ')}${tail}` };

  // The duplicate's route is that it joins what is there: already there, or steering it.
  const unsaid = [['the staff total', REQUESTS.fix, ROUTE], ['the spreadsheet download', REQUESTS.duplicate, JOINED], ['gift cards', REQUESTS.later, ROUTE]]
    .filter(([, words, route]) => !saidAbout(reply, words, route)).map(([name]) => name);
  if (unsaid.length > 0) return { pass: false, why: `no route said for ${unsaid.join(' and ')}${tail}` };
  const second = written.filter((e) => (e.kind === 'work' && e.data?.id !== EXISTING && ABOUT_EXPORT.test(textOf(e.data)))
    || (e.kind === 'idea' && ABOUT_EXPORT.test(textOf(e.data))));
  if (second.length > 0) return { pass: false, why: `a second item for the duplicate: ${second.map((e) => `${e.kind} ${e.data?.id ?? e.data?.key ?? ''}`.trim()).join(', ')}${tail}` };
  return { pass: true, why: `three routes said, and the spreadsheet download joined to ${EXISTING}${tail}` };
}

export default {
  id: 25,
  title: 'One message with three requests, one a duplicate of open work',

  setup: (dir, variant) => setUpFrontDesk(dir, variant, {
    files: { ...FILES, [EXPORT_BRIEF.path]: EXPORT_BRIEF.text, [OPENING_HOURS.path]: OPENING_HOURS.text },
    seed: [
      seedEvent('work', { id: EXISTING, title: 'Staff can download the orders list as a CSV file', lane: 'small', visible: true, dependsOn: [], doc: { path: EXPORT_BRIEF.path, hash: EXPORT_BRIEF.hash } }, '2026-10-16T09:12:00.000Z'),
      seedEvent('work', { id: 'opening-hours', title: 'Show the shop\'s opening hours on the home page', lane: 'quick', visible: true, dependsOn: [], doc: { path: OPENING_HOURS.path, hash: OPENING_HOURS.hash } }, '2026-10-17T10:02:00.000Z'),
      seedEvent('feature', { work: 'opening-hours', step: 'building', branch: 'feature/opening-hours' }, '2026-10-17T10:05:00.000Z'),
      seedEvent('idea', { key: 'loyalty-points', title: 'A loyalty scheme: a free loaf after ten orders', lane: 'feature', when: 'later' }, '2026-10-02T08:40:00.000Z'),
      seedEvent('rejection', { key: 'sms-reminders', title: 'Text-message reminders the day before pick-up', reason: 'each message costs too much for now' }, '2026-09-30T15:20:00.000Z'),
    ],
    approved: { [EXISTING]: EXPORT_BRIEF.hash },
  }),

  prompt: MESSAGE,

  variants: {
    with: { get pluginDirs() { return [locateSuperpowers(), locateMattSkills()]; } },
    without: { get pluginDirs() { return [locateSuperpowers(), locateMattSkills()]; } },
  },

  permissionMode: 'acceptEdits',
  maxTurns: 40,

  pass: ({ events, dir, variant, context }) => judge({
    reply: replyText(events), written: writtenEvents(context), calls: callsOf(events), dir, variant,
  }),
};
