// scripts/cards/standing.js
// How a card a click is on stands, in a module of its own so the card check can say it without loading the prompt hook.
import { chatCopy } from '../state/card-lines.js';

// How the cards the clicks are on stand, from `outcomes` (cardOutcomes): for each click, the card it answers (by the
// state's text, or by its chat copy when that is all the click names) and, when every such card was decided before
// it, `stale`, the latest of them. A click on no card the state holds is left out.
export function standing(out, outcomes) {
  const found = new Map();
  for (const click of out) {
    const mine = outcomes.filter((o) => typeof o.card.data?.question === 'string'
      && (o.card.data.question === click.question || chatCopy(o.card.data.question) === click.question));
    if (mine.length === 0) continue;
    const open = mine.filter((o) => o.decided === null);
    found.set(click, open.length > 0 ? { card: open.at(-1).card } : { card: mine.at(-1).card, stale: mine.at(-1) });
  }
  return found;
}
