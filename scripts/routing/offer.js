// scripts/routing/offer.js
// What the front desk's session start hands over for the usage cards (design section 14.6): the one line that gives
// the card to ask and says what a pick of its first option is, and the record of the offer. The decision is
// nudge.js's; this reads the level and the mark from the settings in force and composes the card.
import { composeCard } from '../cards/compose.js';
import { cardHash } from '../lib/measures-clicks.js';
import { effectiveSettings } from '../settings/effective.js';
import { levelOf } from './thoroughness.js';
import { nudgeCard } from './nudge.js';

// The words before a usage card's AskUserQuestion input, as JSON on the same line.
export const USAGE_ASK = 'A usage card for the director: ask it with AskUserQuestion, exactly as given, as a question of its own: ';
// What a pick of the card's first option does: the director's click is the setting change and their confirmation of
// it at once, which the prompt record signs (design section 14.4; the director, 25 October 2026), so the front desk
// records nothing and asks no confirm card.
export const usageDo = (label) => ` The director's click on "${label}" is the change itself, recorded and confirmed by that click: record nothing and ask no confirm card. Any other pick changes nothing.`;

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// usageOffer({ views, profile, allowance, now, timeZone }) -> null, or { line, record }. The record carries the hash of
// the card as composed (its text, header and options), so the prompt record counts a click only on that very card.
// `views` is the project's state views (`settings`, `usageCards`), `profile` the director's own settings view,
// `allowance` the weekly window (weeklyOf), `ready` the columns ready beyond Balanced and Thorough (readyColumns). Anything that can't be read or composed gives null: it informs.
export function usageOffer({ views, profile, allowance, ready = [], now, timeZone }) {
  try {
    const settings = effectiveSettings({ project: isPlain(views?.settings) ? views.settings : {}, profile: isPlain(profile) ? profile : {}, now });
    const got = nudgeCard({
      allowance, level: levelOf(settings), mark: settings.usageMark?.value, offers: Array.isArray(views?.usageCards) ? views.usageCards : [], switched: isPlain(views?.settings?.efficiency) ? views.settings.efficiency : null, ready, now, timeZone,
    });
    if (got === null) return null;
    const { question } = composeCard(got.input);
    return { line: `${USAGE_ASK}${JSON.stringify(question)}.${usageDo(got.switchLabel)}`, record: { ...got.record, hash: cardHash(question) } };
  } catch {
    return null;
  }
}
