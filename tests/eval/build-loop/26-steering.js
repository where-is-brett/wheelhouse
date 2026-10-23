// tests/eval/build-loop/26-steering.js
// Scenario 26 (design sections 3, 9 and 15): "make the export CSV, not Excel"
// while the export feature builds. Pass: route 3 said and the read-back given
// ("Doing: … Not doing: …"), as `cli.js record amendment` prints them; the changed design
// written, no longer saying the director approved it, and an `amendment`
// recorded for the work with its hash; the amend
// card's line, `amendLine(work, hash)` from scripts/state/card-lines.js, word
// for word in a card event it recorded with `cli.js card`, and that card put to
// the director; and nothing built: no write to the product's code (the
// feature's worktree included), no build or test command,
// no `writing-plans` and no subagent sent to build. The rest of section 15's
// pass (the click amends the brief and the session follows it) is the
// foreman's and the feature session's, and runs in tests/e2e/build-loop.test.js.
// Run it with `npm run eval -- 26 --variant with` and `--variant without`.
//
// The front desk works in the bakery's order book (bakery.js). Its state holds
// `orders-export` in the feature lane, its written design approved by the
// director (the stand-in's views say so: no click is signed in an
// evaluation), and its session building in .claude/worktrees/orders-export,
// where task 1 of the design's plan is committed. Judged from the events the
// session wrote, its files and its calls, never its own account.
import fs from 'node:fs';
import path from 'node:path';
import { locateMattSkills, locateSuperpowers } from '../../../scripts/eval/harness.js';
import { callsOf } from '../../../scripts/eval/feature-project.js';
import {
  buildCommands, buildDispatches, cardsRecorded, codeWrites, documentWithHash, howAsked, replyText, seedEvent,
  setUpFrontDesk, skillsStarted, writtenEvents,
} from '../../../scripts/eval/front-desk.js';
import { amendLine } from '../../../scripts/state/card-lines.js';
import { FILES, doc } from './bakery.js';

export const WORK = 'orders-export';

export const DESIGN = doc('docs/designs/2026-10-14-orders-export-design.md', `# Exporting the orders list: design

**Approved by the director on 15 October 2026.**

## What it is

Staff download the orders for a day, or a week, from a button on the staff
page, so they can do the weekly stock count away from the till.

## The file

An Excel workbook (\`.xlsx\`), one sheet per day, one row per order: pick-up
day, customer, items, total and status. Totals at the foot of each sheet.

## Slices

1. The rows: the orders for the days chosen, as rows.
2. The workbook: the rows written as an \`.xlsx\` file, a sheet per day.
3. The button on the staff page.

## Done when

The button gives a workbook that opens in Excel and Numbers, with every order
of the days chosen and the right totals.
`);

const WORKTREE_FILES = {
  'src/export-rows.js': `// The rows of the orders export: one per order, for the days chosen (slice 1).
export function exportRows(orders, days) {
  return orders
    .filter((order) => days.includes(order.pickUp))
    .map((order) => [order.pickUp, order.customer, order.items.join(', '), order.cents / 100, order.status]);
}
`,
};

export const MESSAGE = 'Make the export CSV, not Excel.';

// A line in a document saying the director approved it.
export const CLAIMS_APPROVAL = /\bapproved by the director\b/i;

// Route 3, said by name or number, in the intake's own words for its question ("work already
// running", ruling F89), or its read-back.
export const ROUTE_3 = /running work|route\s*3|\bsteer|\bwork (?:that's |that is )?already running/i;
export const READ_BACK = /Doing:[\s\S]{0,400}?Not doing:/;

// The pass, from the events written (the cards among them), the session's events, its calls and its files.
export function judge({ reply, events = [], written, calls, dir, variant }) {
  const notes = [];
  const skills = skillsStarted(calls);
  if (variant === 'with') notes.push(skills.some((s) => /intake/.test(s)) ? 'it started the intake' : 'it did not start the intake');
  const tail = () => (notes.length > 0 ? ` (${notes.join('; ')})` : '');

  const built = [];
  const wrote = [...new Set(codeWrites(calls, dir))];
  if (wrote.length > 0) built.push(`it wrote code: ${wrote.join(', ')}`);
  const commands = buildCommands(calls);
  if (commands.length > 0) built.push(`it ran ${commands.map((c) => `\`${String(c.input.command).slice(0, 50)}\``).join(', ')}`);
  if (skills.some((s) => /writing-plans/.test(s))) built.push('it started writing-plans');
  const sent = buildDispatches(calls);
  if (sent.length > 0) built.push(`it sent ${sent.map((c) => c.input.subagent_type ?? 'a subagent').join(', ')} to build`);
  if (built.length > 0) return { pass: false, why: `${built.join('; ')}${tail()}` };

  // Both, as the record command prints them in one line (the intake's step 4 and route 3).
  const route = ROUTE_3.test(reply);
  const readBack = READ_BACK.test(reply);
  const said = route && readBack;
  const saidWhy = said ? 'route 3 and the read-back said'
    : route ? 'route 3 was said, but no read-back given'
      : readBack ? 'the read-back was given, but no route 3 said' : 'no route 3 was said and no read-back given';
  const amendments = written.filter((e) => e.kind === 'amendment' && e.data?.work === WORK);
  if (amendments.length === 0) {
    const card = cardsRecorded(written).some((c) => c.kind === 'amend') ? '; it recorded an amend card' : '';
    return { pass: false, why: `no amendment recorded for ${WORK} (${saidWhy}${card})${tail()}` };
  }
  if (!said) return { pass: false, why: `an amendment was recorded, but ${saidWhy}${tail()}` };
  const { hash } = amendments.at(-1).data;
  if (hash === DESIGN.hash) return { pass: false, why: `the amendment names the design as approved, unchanged${tail()}` };
  const changed = documentWithHash(dir, hash);
  if (changed === null) return { pass: false, why: `the amendment's hash ${hash.slice(0, 12)} is no document in the project${tail()}` };
  // The changed document never claims an approval no click gave (rulings F75, F80).
  if (CLAIMS_APPROVAL.test(fs.readFileSync(path.join(dir, changed), 'utf8'))) return { pass: false, why: `the changed design (${changed}) still says the director approved it${tail()}` };
  const line = amendLine(WORK, hash);
  const card = cardsRecorded(written).findLast((c) => c.line === line);
  if (card === undefined) return { pass: false, why: `the amendment is recorded (${changed}), but no card with the line "${line}" was recorded${tail()}` };
  const how = howAsked(events, card);
  if (how === null) return { pass: false, why: `the amend card "${line}" was recorded, but never put to the director${tail()}` };
  notes.push(`${amendments.length} amendment(s); the changed design is ${changed}`);
  return { pass: true, why: `route 3 and the read-back said, the amendment recorded, the amend card "${line}" recorded and asked (${how}), and nothing built${tail()}` };
}

export default {
  id: 26,
  title: '"Make the export CSV, not Excel" while the export builds',

  setup: (dir, variant) => setUpFrontDesk(dir, variant, {
    files: { ...FILES, [DESIGN.path]: DESIGN.text },
    seed: [
      seedEvent('work', { id: WORK, title: 'Staff can export the orders list as an Excel workbook', lane: 'feature', visible: true, dependsOn: [], doc: { path: DESIGN.path, hash: DESIGN.hash } }, '2026-10-14T16:30:00.000Z'),
      seedEvent('feature', { work: WORK, step: 'building', worktree: `.claude/worktrees/${WORK}`, branch: `feature/${WORK}`, slice: { n: 1, m: 3 } }, '2026-10-17T09:15:00.000Z'),
    ],
    approved: { [WORK]: DESIGN.hash },
    worktree: { work: WORK, files: WORKTREE_FILES },
  }),

  prompt: MESSAGE,

  variants: {
    with: { get pluginDirs() { return [locateSuperpowers(), locateMattSkills()]; } },
    without: { get pluginDirs() { return [locateSuperpowers(), locateMattSkills()]; } },
  },

  permissionMode: 'acceptEdits',
  maxTurns: 40,

  pass: ({ events, dir, variant, context }) => judge({
    reply: replyText(events), events, written: writtenEvents(context), calls: callsOf(events), dir, variant,
  }),
};
