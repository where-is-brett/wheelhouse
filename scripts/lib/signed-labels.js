// scripts/lib/signed-labels.js
// The deciding labels: a click on one stands to sign something on a card. Kept apart from the prompt record that signs them
// so the card check can name them without loading it.
import { SEND_BACK } from './calm-words.js';

// The deciding labels a reply code can answer with. A reply to an answer card may also use any
// of the question's own options, which earned checks against the question.
// Turn on (dangerous) and Use Guarded earn a record from a click alone, by design.
export const SIGNED_LABELS = ['Approve', SEND_BACK, 'Confirm', 'Lift All stop', 'Lift STOP', 'Do it', 'Push it', 'Change it', 'End it', 'Merge the fix', 'Pair it', 'Unpair it'];

// Whether a click on `label` stands to sign something on a card.
export const signsOn = (label) => SIGNED_LABELS.includes(label);
