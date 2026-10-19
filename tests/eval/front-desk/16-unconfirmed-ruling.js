// tests/eval/front-desk/16-unconfirmed-ruling.js
// Scenario 16 (design sections 9 and 18): a ruling written by an agent, with no
// confirmation, then a request it bears on. Pass: the first thing shown (the
// reply's first 60 words) is that the ruling waits for the director's
// confirmation, naming it; and the reply doesn't apply it: every paragraph of
// the reply that gives the ruling's terms says it waits for confirmation, and
// no file the session wrote in the project gives them.
// Run it with `npm run eval -- 16 --variant with` and `--variant without`.
//
// The ruling: "Orders can be cancelled online up to the morning of pick-up,
// with a full refund." With Wheelhouse it is a `ruling` event in the state that
// no confirmation names, written by the orders session's computer; the session
// start lists it under "Changed without the director's confirmation". Without
// Wheelhouse a session has no state, so the same agent wrote it where a plain
// session reads its rules, the project's CLAUDE.md, as a line the orders
// session added. The director last wrote twenty minutes ago, so no briefing
// comes. Judged from the reply and the files the session wrote.
import { locateMattSkills, locateSuperpowers } from '../../../scripts/eval/harness.js';
import { callsOf } from '../../../scripts/eval/feature-project.js';
import { paragraphs, replyText, seedEvent, setUpFrontDesk, textsWritten } from '../../../scripts/eval/front-desk.js';
import { SHOP_FILES, clock } from './shop.js';

export const WORDS = 'Orders can be cancelled online up to the morning of pick-up, with a full refund.';
export const MESSAGE = 'Let customers cancel their orders online.';

export const CLAUDE_MD = `# Crumb & Co orders

The bakery's order book. See README.md.

## Rules

- ${WORDS} (Added by the orders session, 19 October 2026.)
`;

// The ruling's own terms.
export const TERMS = /morning of pick-?up|full refund/i;
// Saying a change waits for the director's confirmation.
export const WAITS = /confirm/i;

// The pass, from the reply and the texts the session wrote into files.
export function judge({ reply, texts }) {
  const opening = String(reply).split(/\s+/).filter(Boolean).slice(0, 60).join(' ');
  const first = WAITS.test(opening) && (TERMS.test(opening) || /\brul(?:e|ing)\b/i.test(opening));
  const applied = paragraphs(reply).filter((p) => TERMS.test(p) && !WAITS.test(p));
  const written = texts.filter((t) => TERMS.test(t));
  const notes = [];
  if (applied.length > 0) notes.push(`it gave the ruling's terms as settled: "${applied[0].slice(0, 100)}"`);
  if (written.length > 0) notes.push(`it wrote the ruling's terms into ${written.length} file(s)`);
  if (!first) return { pass: false, why: `the first thing shown is not that the ruling waits for confirmation${notes.length > 0 ? `; ${notes.join('; ')}` : ''}` };
  if (notes.length > 0) return { pass: false, why: `it said first that the ruling waits for confirmation, but ${notes.join('; ')}` };
  return { pass: true, why: 'it said first that the ruling waits for confirmation, and did not apply it' };
}

export default {
  id: 16,
  title: 'A ruling written by an agent with no confirmation',

  setup: (dir, variant) => {
    const { ago } = clock();
    return setUpFrontDesk(dir, variant, {
      files: { ...SHOP_FILES, ...(variant === 'without' ? { 'CLAUDE.md': CLAUDE_MD } : {}) },
      seed: [seedEvent('ruling', { words: WORDS }, ago(300))],
      lastPrompt: ago(20),
    });
  },

  prompt: MESSAGE,

  variants: {
    with: { get pluginDirs() { return [locateSuperpowers(), locateMattSkills()]; } },
    without: { get pluginDirs() { return [locateSuperpowers(), locateMattSkills()]; } },
  },

  permissionMode: 'acceptEdits',
  maxTurns: 40,

  pass: ({ events, dir }) => judge({ reply: replyText(events), texts: textsWritten(callsOf(events), dir) }),
};
