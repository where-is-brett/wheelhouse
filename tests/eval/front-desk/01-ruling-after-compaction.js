// tests/eval/front-desk/01-ruling-after-compaction.js
// Scenario 1 (design section 18): a ruling, then a compaction, then a plan
// touching it. Pass: after the compaction, the replies to the request and to
// the answers that follow it apply the ruling (a price in its form: $18.50,
// $2.40 or $32.00, in a reply or a file the session wrote in the project in
// those turns) and quote it (six of its words in a row: the plan's Task 13,
// Step 1, "quoted"; section 18's own pass asks only that it is applied). A run
// whose session never compacted doesn't count.
// Run it with `npm run eval -- 1 --variant with` and `--variant without`.
//
// One session over five of the director's turns (the harness resumes it):
// the ruling; `/compact`, the closest real thing to a compaction a headless run
// can make (Claude Code compacts the conversation and runs the session start
// hooks with `compact`); a request whose plan sets prices; then two answers to
// brainstorming's questions, so the plan exists before the pass is judged
// (ruling F92). Between the
// first two turns, with Wheelhouse, the director's click on the ruling's confirm
// card is made as the click would record it: a confirmation signed by the
// stand-in's key (no click is made in an evaluation), so the session start after
// the compaction reloads the ruling as accepted. Without Wheelhouse the ruling is
// in the conversation alone. Judged from the events and the files written.
import { locateMattSkills, locateSuperpowers } from '../../../scripts/eval/harness.js';
import { callsOf } from '../../../scripts/eval/feature-project.js';
import { compacted, quotes, replyText, setUpFrontDesk, textsWritten, writtenEvents } from '../../../scripts/eval/front-desk.js';
import { SHOP_FILES, clock } from './shop.js';

// The ruling, in the director's words.
export const RULING = 'every price on the site shows two decimal places and the dollar sign, like $4.50, never $4.5 or 4.50';

export const PROMPTS = [
  `A ruling for the whole site: ${RULING}.`,
  '/compact',
  'Put the Christmas range on the menu page with its prices: stollen 18.5, mince pies 2.4 each and the yule log 32.',
  'Its own "Christmas range" section at the top of the menu: names and prices only, no descriptions or pictures.',
  'That\'s everything; there\'s nothing more to decide. Please take it from here.',
];

// The turns after the compaction: the request and the answers to brainstorming.
const AFTER = 2;

// A price of the Christmas range in the ruling's form.
export const APPLIED = /\$18\.50\b|\$2\.40\b|\$32\.00\b/;

// With Wheelhouse, the director clicks the confirm card of the ruling the session recorded, before
// the compaction. Without, there is nothing to click.
export function between({ turn, context, variant }) {
  if (turn !== 1 || variant !== 'with') return;
  const ruling = writtenEvents(context).filter((e) => e.kind === 'ruling').at(-1);
  if (ruling !== undefined) context.helper.confirm(ruling.id);
}

// The pass, from each turn's events and what the session wrote to the state.
export function judge({ turns, written, variant, dir }) {
  const notes = [];
  if (variant === 'with') {
    const ruling = written.filter((e) => e.kind === 'ruling').at(-1);
    if (ruling === undefined) notes.push('no ruling recorded in the first turn');
    else {
      notes.push(`the ruling recorded${quotes(ruling.data?.words, RULING, 12) ? ' in the director\'s words' : ', not in the director\'s words'}`);
      notes.push(written.some((e) => e.kind === 'confirmation' && e.data?.confirms === ruling.id) ? 'and confirmed by the click' : 'not confirmed');
    }
  }
  const tail = () => (notes.length > 0 ? ` (${notes.join('; ')})` : '');
  if (!Array.isArray(turns) || turns.length < PROMPTS.length) return { pass: false, why: `did not count: ${turns?.length ?? 0} of ${PROMPTS.length} turns ran${tail()}` };
  if (!compacted(turns[1].events)) return { pass: false, why: `did not count: the session never compacted${tail()}` };
  const after = turns.slice(AFTER).flatMap((turn) => turn.events);
  const reply = replyText(after);
  const files = textsWritten(callsOf(after), dir).join('\n');
  const quoted = quotes(reply, RULING);
  const applied = APPLIED.test(reply) ? 'in its reply' : APPLIED.test(files) ? 'in a file it wrote' : null;
  if (!quoted && applied === null) return { pass: false, why: `after the compaction the replies neither applied the ruling nor quoted it${tail()}` };
  if (!quoted) return { pass: false, why: `after the compaction the ruling was applied (${applied}), but not quoted${tail()}` };
  if (applied === null) return { pass: false, why: `after the compaction the ruling was quoted, but no price was given in its form${tail()}` };
  return { pass: true, why: `after the compaction the replies quoted the ruling and applied it (${applied})${tail()}` };
}

export default {
  id: 1,
  title: 'A ruling, then a compaction, then a plan touching it',

  setup: (dir, variant) => {
    const { ago } = clock();
    return setUpFrontDesk(dir, variant, { files: SHOP_FILES, lastPrompt: ago(20) });
  },

  prompts: PROMPTS,
  between,

  variants: {
    with: { get pluginDirs() { return [locateSuperpowers(), locateMattSkills()]; } },
    without: { get pluginDirs() { return [locateSuperpowers(), locateMattSkills()]; } },
  },

  permissionMode: 'acceptEdits',
  maxTurns: 40,

  pass: ({ turns, variant, context, dir }) => judge({ turns, written: context?.helper ? context.helper.events() : [], variant, dir }),
};
