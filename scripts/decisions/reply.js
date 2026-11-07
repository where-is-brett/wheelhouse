// scripts/decisions/reply.js
// Reads the director's typed words as a reply to the decisions that wait (design section 6.1). A reply names its
// decision, by its number ("2 C", "2: weekly, not daily") or by its reply code ("K7QP B"), or has no number and a single
// letter while exactly one decision waits. Anything that could mean more than one decision, or none, is never an answer:
// it is ambiguous, refused or nothing, and nothing is recorded from it.
//
//   parseReply(text, pending) -> { kind: 'answer', n, label, words, private? }   `private: true` for a letter followed by "private"
//                              | { kind: 'why', n, words }
//                              | { kind: 'ambiguous', candidates }
//                              | { kind: 'refused', n, reason }     reason: 'beyond-options' or 'not-waiting'
//                              | { kind: 'none' }
// `label` is the letter chosen, or 'own' for the director's own words ("2: ..."); `words` is what followed.
// `pending` is the list pendingDecisions gives: { n, code, options } each.
import { LETTERS } from './message.js';

const none = { kind: 'none' };
// What may follow a letter that stands on its own: the end, or a mark that ends it. A space and more words does not, so
// "A lot of this looks fine" is a sentence and not option A.
// The mark may follow the letter straight on, but only when it closes there: "B, but keep it" and "B." are replies, while
// "a.m." and "A-list" are not.
const AFTER_LETTER = /^(?:$|[,.;:!](?:\s|$))/;
const WORDS_LEAD = /^[\s,.;:!]+/;

const countOf = (decision) => Math.min(LETTERS.length, Array.isArray(decision?.options) ? decision.options.length : 0);

// The letter the text starts with when it stands on its own, as { letter, words }, or null.
function letterOf(text) {
  const m = /^([A-Za-z])/.exec(text);
  if (m === null) return null;
  const rest = text.slice(1);
  if (!AFTER_LETTER.test(rest.trimEnd() === '' ? '' : rest)) return null;
  return { letter: m[1].toUpperCase(), words: rest.replace(WORDS_LEAD, '').trim() };
}

// What follows a number or a code: a letter, "words" after a colon, or nothing that counts.
function afterHead(n, rest, pending) {
  const decision = pending.find((d) => d.n === n);
  const text = rest.trim();
  if (text === '') return none;
  // The colon that opens the director's own words has a space after it: "2: weekly", never "2:30" or "1:1 with Sam".
  const colon = /^:\s/.test(text);
  const body = colon ? text.slice(1).trim() : text;
  const found = letterOf(body);
  // A number that names no waiting decision is a refused reply only when what follows is shaped like one.
  if (decision === undefined) return (found !== null || (colon && body !== '')) ? { kind: 'refused', n, reason: 'not-waiting' } : none;
  // "2: C" is the letter; "2: weekly, not daily" is the director's own words.
  if (found !== null && (!colon || body.length === 1)) {
    const index = LETTERS.indexOf(found.letter);
    if (index < 0 || index >= countOf(decision)) return { kind: 'refused', n, reason: 'beyond-options' };
    return { kind: 'answer', n, label: found.letter, words: found.words };
  }
  if (colon && body !== '') return { kind: 'answer', n, label: 'own', words: body };
  return none;
}

// Only "why", "why?", "why 2" and "why 2?" (with or without a #): a sentence that happens to start with "why" is the director
// talking, not a request to be told the reasons.
function whyOf(text, pending) {
  const m = /^why(?:\s+#?([1-9][0-9]{0,2}))?\s*\??$/i.exec(text);
  if (m === null) return null;
  const n = m[1] === undefined ? null : Number(m[1]);
  const words = '';
  if (n === null) {
    if (pending.length === 0) return none;
    if (pending.length > 1) return { kind: 'ambiguous', candidates: pending.map((d) => d.n) };
    return { kind: 'why', n: pending[0].n, words };
  }
  if (!pending.some((d) => d.n === n)) return { kind: 'refused', n, reason: 'not-waiting' };
  return { kind: 'why', n, words };
}

// A trailing "private" after a letter ("2 B private") keeps the answer out of the project's files (design section 6.6). It counts
// only straight after a letter and nothing else: words before it ("B, but keep it private") or the director's own words are
// theirs and are never read as the mark.
const PRIVATE_TAIL = /^(.*\S)\s+private[.!]?$/is;

export function parseReply(text, pending) {
  if (typeof text !== 'string' || !Array.isArray(pending) || pending.length === 0) return none;
  const typed = text.replace(/\p{Cf}/gu, '').trim().replace(/^reply\b[\s:,-]*/i, '');
  if (typed === '') return none;
  const tail = PRIVATE_TAIL.exec(typed);
  if (tail !== null) {
    const head = readReply(tail[1], pending);
    if (head.kind === 'answer' && head.label !== 'own' && head.words === '') return { ...head, private: true };
    if (head.kind === 'refused' && head.reason === 'beyond-options') return head;
  }
  return readReply(typed, pending);
}

function readReply(typed, pending) {

  const why = whyOf(typed, pending);
  if (why !== null) return why;

  // A reply code: four characters that are a waiting decision's code.
  const coded = /^([A-Za-z0-9]{4})(?![A-Za-z0-9])(.*)$/s.exec(typed);
  if (coded !== null) {
    const owner = pending.filter((d) => typeof d.code === 'string' && d.code.toUpperCase() === coded[1].toUpperCase());
    if (owner.length === 1) return afterHead(owner[0].n, coded[2], pending);
  }

  // A number: "2 C", "2C", "#2 C" and "2: words".
  const numbered = /^#?([1-9][0-9]{0,2})(?![0-9])(.*)$/s.exec(typed);
  if (numbered !== null) return afterHead(Number(numbered[1]), numbered[2], pending);

  // A lone letter, which counts only while exactly one decision waits.
  const lone = letterOf(typed);
  if (lone === null) return none;
  const index = LETTERS.indexOf(lone.letter);
  if (pending.length > 1) {
    const fits = pending.filter((d) => index >= 0 && index < countOf(d));
    return { kind: 'ambiguous', candidates: (fits.length > 0 ? fits : pending).map((d) => d.n) };
  }
  if (index < 0 || index >= countOf(pending[0])) return { kind: 'refused', n: pending[0].n, reason: 'beyond-options' };
  return { kind: 'answer', n: pending[0].n, label: lone.letter, words: lone.words };
}
