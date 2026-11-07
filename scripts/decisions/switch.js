// scripts/decisions/switch.js
// The one switch for typed-reply answers (design section 6.1, the known gap). It is the project setting `typedReplies`
// (scripts/settings/catalogue.js), off until the director rules on where a typed reply came from. Everything that
// changes with it asks here, so turning it on is the one setting and nothing else.
//
// Off: a typed reply is never recorded, a decision is asked through the question picker as any question is, and the
// decision message and its check still apply. On: a decision is a chat message the director answers by typing.
import { effectiveSettings } from '../settings/effective.js';

export const TYPED_REPLIES = 'typedReplies';

// Whether typed replies are on, from a project's `settings` view (the views the helper gives, or the one on disk). Anything
// that can't be read is off.
export function typedRepliesIn(settings) {
  try {
    return effectiveSettings({ project: settings ?? {}, now: () => new Date() })[TYPED_REPLIES]?.value === true;
  } catch {
    return false;
  }
}
