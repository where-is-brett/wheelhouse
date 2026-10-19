// tests/eval/build-loop/35-design-to-queue.js
// Scenario 35 (design sections 3, 4 and 15): the director approves a written
// design at the front desk. Pass: a `work` event in the state naming the design
// (its path, and its hash as the file stands), and no `superpowers:writing-plans`
// started at the front desk: the feature session writes the plan.
// Run it with `npm run eval -- 35 --variant with` and `--variant without`.
//
// The front desk works in the bakery's order book (bakery.js). The design is
// already written, where brainstorming writes one
// (docs/superpowers/specs/), and committed; the director's message is their
// approval of it, the reply that ends brainstorming's review of the written
// design, where brainstorming would go on to writing-plans. Seeding the design
// and sending the approval as the one message stands in for the turns that
// shaped it. Judged from the events the session wrote and its calls.
import { locateMattSkills, locateSuperpowers } from '../../../scripts/eval/harness.js';
import { callsOf } from '../../../scripts/eval/feature-project.js';
import {
  buildDispatches, codeWrites, composedText, hashOfFile, sameFile, seedEvent, setUpFrontDesk, skillsStarted, writtenEvents,
} from '../../../scripts/eval/front-desk.js';
import { approveWorkLine } from '../../../scripts/state/card-lines.js';
import { FILES, OPENING_HOURS, doc } from './bakery.js';

export const DESIGN = doc('docs/superpowers/specs/2026-10-19-christmas-pre-orders-design.md', `# Christmas pre-orders: design

## What it is

Customers order from the Christmas range (stollen, mince pies, the yule log)
from 1 November, for pick-up between 20 and 24 December. Each item has a
limit the bakery sets; when it is reached, the item shows as sold out.

## How it works

- **The range.** A list of Christmas items, each with a price, a limit and the
  days it can be picked up. Staff edit it on the staff page.
- **Ordering.** The order form shows the range from 1 November. A pre-order is
  paid in full when it is placed, as other orders are.
- **Limits.** An order that would pass an item's limit is refused with a plain
  message; the item shows as sold out once the limit is reached.
- **Pick-up.** Pre-orders show on the staff page on their pick-up day, marked
  as pre-orders, and count in the day's total.

## Slices

1. The range and its limits, on the staff page.
2. Ordering from the range, with the limits held.
3. Pre-orders on the staff page on their pick-up day.

## Done when

A customer can pre-order from the range from 1 November; no item sells past
its limit; staff see each pre-order on its pick-up day.

## Testing

Each slice's tests: the limits at, below and past the limit; the dates either
side of 1 November and of the pick-up days.
`);

export const MESSAGE = `I've read the Christmas pre-orders design (${DESIGN.path}). It's approved: go ahead.`;

// The pass, from the events written and the calls.
export function judge({ composed, written, calls, dir, variant }) {
  const notes = [];
  const skills = skillsStarted(calls);
  if (variant === 'with') notes.push(skills.some((s) => /intake/.test(s)) ? 'it started the intake' : 'it did not start the intake');
  const wrote = [...new Set(codeWrites(calls, dir))];
  if (wrote.length > 0) notes.push(`it wrote code: ${wrote.join(', ')}`);
  if (buildDispatches(calls).length > 0) notes.push('it sent a subagent to build');
  const tail = () => (notes.length > 0 ? ` (${notes.join('; ')})` : '');

  const planning = skills.filter((s) => /writing-plans/.test(s));
  const works = written.filter((e) => e.kind === 'work' && sameFile(dir, e.data?.doc?.path, DESIGN.path));
  if (planning.length > 0) return { pass: false, why: `it started writing-plans${works.length > 0 ? ' (after or beside a work event naming the design)' : ''}${tail()}` };
  if (works.length === 0) {
    const others = written.filter((e) => e.kind === 'work').map((e) => `${e.data?.id} naming ${e.data?.doc?.path ?? 'no document'}`);
    return { pass: false, why: `no work event names the design${others.length > 0 ? `: ${others.join(', ')}` : ''}${tail()}` };
  }
  const now = hashOfFile(dir, DESIGN.path);
  const work = works.at(-1);
  if (work.data.doc.hash !== now) return { pass: false, why: `the work event names the design with hash ${String(work.data.doc.hash).slice(0, 12)}, not the file's ${String(now).slice(0, 12)}${tail()}` };
  const line = approveWorkLine(work.data.id, work.data.lane, now);
  const card = [line, approveWorkLine(work.data.id, work.data.lane, now, { shownFirst: true })].some((l) => composed.includes(l));
  notes.push(`work ${work.data.id} in the ${work.data.lane} lane${card ? ', with its approval card line' : ', no approval card line'}`);
  return { pass: true, why: `a work event names the design, and no writing-plans started${tail()}` };
}

export default {
  id: 35,
  title: 'The director approves a written design at the front desk',

  setup: (dir, variant) => setUpFrontDesk(dir, variant, {
    files: { ...FILES, [DESIGN.path]: DESIGN.text, [OPENING_HOURS.path]: OPENING_HOURS.text },
    seed: [
      seedEvent('work', { id: 'opening-hours', title: 'Show the shop\'s opening hours on the home page', lane: 'quick', visible: true, dependsOn: [], doc: { path: OPENING_HOURS.path, hash: OPENING_HOURS.hash } }, '2026-10-17T10:02:00.000Z'),
      seedEvent('feature', { work: 'opening-hours', step: 'building', branch: 'feature/opening-hours' }, '2026-10-17T10:05:00.000Z'),
    ],
  }),

  prompt: MESSAGE,

  variants: {
    with: { get pluginDirs() { return [locateSuperpowers(), locateMattSkills()]; } },
    without: { get pluginDirs() { return [locateSuperpowers(), locateMattSkills()]; } },
  },

  permissionMode: 'acceptEdits',
  maxTurns: 40,

  pass: ({ events, dir, variant, context }) => judge({
    composed: composedText(events), written: writtenEvents(context), calls: callsOf(events), dir, variant,
  }),
};
