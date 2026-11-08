// scripts/decisions/switch.js
// The one switch for typed-reply answers (design section 6.1, the known gap). It is the project setting `typedReplies`
// (scripts/settings/catalogue.js), on by default since the director's decision of 8 November 2026; the gap it leaves is
// written in the main design's section 12.5. Everything that changes with it asks here, so turning it off is the one
// setting and nothing else.
//
// Off: a typed reply is never recorded, a decision is asked through the question picker as any question is, and the
// decision message and its check still apply. On: a decision is a chat message the director answers by typing.
import { isAllowed } from '../settings/catalogue.js';
import { effectiveSettings } from '../settings/effective.js';

export const TYPED_REPLIES = 'typedReplies';

const isRecord = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// Whether typed replies are on, from a project's `settings` view (the views the helper gives, or the one on disk). A
// project that never set them has the default, on. Anything that can't be read is off, never the default: a view that
// isn't a record, or a stored entry for this setting whose value isn't one it allows.
export function typedRepliesIn(settings) {
  try {
    if (!isRecord(settings)) return false;
    if (Object.hasOwn(settings, TYPED_REPLIES)) {
      const entry = settings[TYPED_REPLIES];
      if (!isRecord(entry) || !isAllowed(TYPED_REPLIES, entry.value)) return false;
    }
    return effectiveSettings({ project: settings, now: () => new Date() })[TYPED_REPLIES]?.value === true;
  } catch {
    return false;
  }
}
