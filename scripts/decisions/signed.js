// scripts/decisions/signed.js
// The signed decision for a piece of work and a question, if the director has already made one. The First Mate looks
// here before it asks an approval card, and the foreman's start looks here before it asks again, so a fresh Desktop
// chat on approved work finds "Already approved on <date>" and no card.
import { listEvents } from '../state/events.js';
import { readEnrolled } from '../state/signing.js';
import { signedCardOutcomes } from '../state/views.js';
import { stateDir } from '../lib/paths.js';
import { PUT_OFF } from '../lib/front-desk.js';

const words = (text) => (typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().toLowerCase() : '');
// The work an answer card is about: the work id in its set line, "Answer question q-<work>-<n>".
const workOf = (line) => /^Answer question q-(.+)-[0-9]+$/.exec(typeof line === 'string' ? line : '')?.[1] ?? null;

// signedDecisionFor(project, work, question) -> { at } | null. `at` is when the director's signed answer was recorded.
// Only a verified signed record counts, never a plain answer; an answer that only put the card off or asked more
// does not decide it. The latest signed answer wins. Anything unreadable gives null, so the card is asked as usual.
export function signedDecisionFor(project, work, question, { events, enrolled } = {}) {
  try {
    const held = events ?? listEvents(stateDir(project), { report: () => {} });
    const hits = signedCardOutcomes(held, enrolled ?? readEnrolled())
      .filter((o) => o.signed !== null && !PUT_OFF.includes(o.signed.label)
        && workOf(o.card?.data?.line) === work && words(o.card.data.parts?.ask ?? o.card.data.question.split('\n')[0]) === words(question))
      .sort((a, b) => a.signed.at.localeCompare(b.signed.at));
    return hits.length === 0 ? null : { at: hits.at(-1).signed.at };
  } catch {
    return null;
  }
}
