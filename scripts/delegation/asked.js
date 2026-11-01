// scripts/delegation/asked.js
// One decision, one card (delegated decisions design, section 7.4). A decision's key is its piece and its normalised
// words, by script, and a step's topic label plays no part. An ask repeating an answered key takes the director's own
// earlier answer only where every condition holds; anything less is a card, and what can't be read counts as less. An
// answer the director has since moved on from says nothing at all. A close match is the reader's word, so it can only
// help the director: it joins a card or adds a line, and never answers.
import crypto from 'node:crypto';
import { exclusionsHit } from './candidates.js';
import { normaliseWords, sameChoice, sameOptions } from './words.js';
import { joinersOf } from '../state/joiners.js';

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
// The asks an earlier answer can stand for. An approval signs for itself, by its pull request and head.
const REUSED_KINDS = Object.freeze(['question', 'blocked']);

export function decisionKey(work, words) {
  return crypto.createHash('sha256').update(JSON.stringify([work, normaliseWords(words)])).digest('hex');
}

// The latest answer to this key on this piece that reached the build. `settled(id)` says one did: an answer All stop kept
// back, or one that came too late, decided nothing. -> { id, answer, at, level, options, head, changed, words } | null.
export function earlierAnswer({ views, work, key, settled }) {
  const found = Object.entries(isPlain(views?.questions) ? views.questions : {})
    .filter(([id, q]) => q?.question?.data?.work === work && q.question.data.key === key && typeof q.answer?.label === 'string' && settled(id))
    .sort(([, a], [, b]) => (a.answer.at < b.answer.at ? -1 : a.answer.at > b.answer.at ? 1 : 0)).at(-1);
  if (!found) return null;
  const [id, { question: { data }, answer }] = found;
  return { id, answer: answer.label, at: answer.at, level: data.level, options: data.options, head: data.head, changed: answer.changed === true, words: answer.words };
}

// Whether the director has spoken on the piece since an answer: another answer, a steer on any of its cards, or the piece
// recorded again.
export function spokenSince({ views, work, earlier }) {
  const after = (at) => typeof at === 'string' && at > earlier.at;
  if (after(views?.work?.[work]?.work?.at)) return true;
  return Object.entries(isPlain(views?.questions) ? views.questions : {}).some(([id, q]) => q?.question?.data?.work === work
    && (after(q.steered) || (id !== earlier.id && after(q.answer?.at))));
}

// The common exclusions a piece's facts hit, or null when they can't be read. A piece with nothing done hits none.
export function repeatExclusions(facts) {
  if (facts?.readable === true) return exclusionsHit(facts);
  return facts?.nothing === true ? [] : null;
}

// reuse({ ask, earlier, commitsSince, spokenSince, changed, exclusions, asksAgain }) -> { answer } | { card: 'said-before' } | null.
// `ask` is { kind, level, options }, as its card has them. `commitsSince` is null and `exclusions` null when they can't be
// read, and each gives a card. `asksAgain` is anything else that needs the director's click.
export function reuse({ ask, earlier, commitsSince, spokenSince: spoken, changed, exclusions, asksAgain = false }) {
  if (!isPlain(earlier) || !REUSED_KINDS.includes(ask?.kind) || ask.level === 4 || spoken === true || changed === true) return null;
  const holds = earlier.level !== 4 && sameOptions(ask.options, earlier.options) && commitsSince === 0 && Array.isArray(exclusions) && exclusions.length === 0 && asksAgain !== true;
  return holds ? { answer: earlier.answer } : { card: 'said-before' };
}

// What the reader's `sameAs` may do to a card: { join: <the open card's id> } behind a card with the same options,
// { line: <the answer> } for an answer that still stands, or null, and the card stands as it is. Both cards are the
// piece's, in the build's own words, at level 3. A card with others behind it stays theirs, a blind card is asked for
// itself, and one already answered or joined has nothing to gain.
export function closeMatch({ card, sameAs, views }) {
  const questions = isPlain(views?.questions) ? views.questions : {};
  const asked = questions[card];
  const other = questions[sameAs];
  const [data, match] = [asked?.question?.data, other?.question?.data];
  if (card === sameAs || !isPlain(data) || !isPlain(match) || data.work !== match.work || data.level !== 3 || match.level !== 3) return null;
  if (typeof data.key !== 'string' || typeof match.key !== 'string' || isPlain(asked.answer) || asked.joins !== undefined || asked.saidBefore !== undefined) return null;
  if (isPlain(other.answer)) {
    const earlier = { id: sameAs, at: other.answer.at };
    const stands = typeof other.answer.label === 'string' && other.answer.changed !== true && !spokenSince({ views, work: data.work, earlier });
    return stands ? { line: other.answer.label } : null;
  }
  const open = other.joins === undefined && data.blind !== true && match.blind !== true && joinersOf(questions, card).length === 0 && sameChoice(data, match);
  return open ? { join: sameAs } : null;
}
