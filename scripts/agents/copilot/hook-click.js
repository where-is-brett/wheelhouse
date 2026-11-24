// scripts/agents/copilot/hook-click.js
// The two steps that record a click on Copilot's question card, run by hook-entry.js once check C6 has passed: when the
// card is asked (preToolUse) it is posted to the helper as shown to this session, and when the answer comes back
// (postToolUse) a click is posted as a `hook-click`. An answer the harness gave by itself is no click: the first one in a
// session tells the First Mate to stop and say one line (AUTO_TELL).
import { askOf, answerOf, AUTO_TELL } from './ask-click.js';

const place = (input, extra) => ({ cwd: input.cwd, session: input.session_id, ...extra });
const usable = (input) => typeof input?.session_id === 'string' && input.session_id !== '' && typeof input.cwd === 'string';

// Posts the card as shown. Lost without a word when the helper is down or takes none: no click then counts for it.
export async function recordShown(input, { client }) {
  const ask = askOf(input);
  if (ask === null || !usable(input)) return;
  try {
    await client.cards.hookShown(place(input, { message: ask.message, options: ask.options }));
  } catch {
    // A card never recorded as shown takes no click.
  }
}

// Posts the answer. Returns the text for the First Mate (additionalContext), or undefined.
export async function recordAnswer(input, { client }) {
  const ask = askOf(input);
  if (ask === null || !usable(input)) return undefined;
  const answer = answerOf(input);
  try {
    if (answer.kind === 'click') await client.cards.hookClick(place(input, { message: ask.message, options: ask.options, label: answer.label }));
    else if (answer.kind === 'auto') {
      const got = await client.cards.hookAuto(place(input, {}));
      return got?.first === true ? AUTO_TELL : undefined;
    }
  } catch {
    // The helper refused or is down: nothing was recorded, and the card is asked again.
  }
  return undefined;
}
