// scripts/decisions/signed.js
// The signed decision for a piece of work and a question, if the director has already made one. The First Mate looks
// here before it asks an approval card, and the foreman's start looks here before it asks again, so a fresh Desktop
// chat on approved work finds "Already approved on <date>" and no card.
import { listEvents } from '../state/events.js';
import { readEnrolled, verify } from '../state/signing.js';
import { buildViews, signedCardOutcomes } from '../state/views.js';
import { stateDir } from '../lib/paths.js';
import { PUT_OFF } from '../lib/front-desk.js';

const words = (text) => (typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().toLowerCase() : '');
// The work an answer card is about: the work id in its set line, "Answer question q-<work>-<n>". The id is matched
// whole, so w-tide never takes w-tide-1's answers.
const workOf = (line) => /^Answer question q-(.+)-[0-9]+$/.exec(typeof line === 'string' ? line : '')?.[1] ?? null;
// The question a card asks: its ask, or the first line of its question. '' when the card holds neither.
const askOf = (card) => {
  const data = card?.data;
  if (typeof data?.parts?.ask === 'string') return words(data.parts.ask);
  return typeof data?.question === 'string' ? words(data.question.split('\n')[0]) : '';
};
// The answer as the director picked it: a typed reply's letter is the option it names.
const answerOf = (card, label) => {
  const options = Array.isArray(card?.data?.options) ? card.data.options : [];
  const picked = /^[A-D]$/.test(label ?? '') ? options['ABCD'.indexOf(label)] : undefined;
  return typeof picked === 'string' && picked !== '' ? picked : label;
};

// When the work's current approval was given: the latest verified click that approved its document in its lane, or
// the approved change that carried it there.
function approvedAt(sorted, enrolled, work, approval) {
  const ofWork = sorted.filter((e) => e.kind === 'action' && e.data?.work === work && verify(e, enrolled));
  const direct = ofWork.filter((e) => e.data.action === 'approve-work' && e.data.hash === approval.hash && e.data.lane === approval.lane);
  const carried = ofWork.filter((e) => e.data.action === 'amend' && e.data.hash === approval.hash);
  return (direct.at(-1) ?? carried.at(-1))?.at ?? null;
}

// signedDecisionFor(project, work, question) -> { kind, at, answer? } | null.
// - kind 'answer': a question card raised on this work, asking these words, that the director answered in a verified
//   signed record. An answer that only put the card off or asked more does not decide it; the latest signed answer wins.
//   A card that asks these words and has no such answer gives null, so it is asked, even on approved work.
// - kind 'approval': with no question card asking these words, the work's current document approved in its lane by a
//   verified click (a document changed since, or a lane moved, asks again). `at` is that click's time.
// Plain answers never count. Anything unreadable gives null, so the card is asked as usual.
export function signedDecisionFor(project, work, question, { events, enrolled } = {}) {
  try {
    if (typeof work !== 'string' || work === '' || words(question) === '') return null;
    const held = events ?? listEvents(stateDir(project), { report: () => {} });
    const keys = enrolled ?? readEnrolled();
    const asked = signedCardOutcomes(held, keys).filter((o) => workOf(o.card?.data?.line) === work && askOf(o.card) === words(question));
    if (asked.length > 0) {
      const hit = asked
        .filter((o) => o.signed !== null && typeof o.signed.at === 'string' && !PUT_OFF.includes(o.signed.label))
        .sort((a, b) => a.signed.at.localeCompare(b.signed.at))
        .at(-1);
      return hit === undefined ? null : { kind: 'answer', at: hit.signed.at, answer: answerOf(hit.card, hit.signed.label) };
    }
    const entry = buildViews(held, keys).work?.[work];
    if (entry?.approved !== true || entry.approval === undefined) return null;
    const sorted = [...held].sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const at = approvedAt(sorted, keys, work, entry.approval) ?? entry.work?.at ?? null;
    return at === null ? null : { kind: 'approval', at };
  } catch {
    return null;
  }
}

// The one line the First Mate says for a signed decision, with the day in words.
export function signedLine(signed) {
  const day = new Date(signed.at).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  if (signed.kind === 'answer') return `Already answered on ${day}: ${signed.answer ?? 'answered'}`;
  return `Already approved on ${day}`;
}
