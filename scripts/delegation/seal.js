// scripts/delegation/seal.js
// A seal: what the script checks said about a card when it was written, with a hash and a time (delegated decisions
// design, section 12). It is the first of the three `shadow` lines joined by the card's id, and the score the last. Only
// a question at level 3 can ever be read: an approval, a cap and the other cards no rule can decide are sealed as what
// they are, as is level 4.
import { dataHash } from '../state/events.js';
import { CANDIDATES, COMMON_EXCLUSIONS, exclusionsHit } from './candidates.js';
import { normaliseWords } from './words.js';
import { SUGGEST } from '../lib/calm-words.js';
import { PUT_OFF } from '../lib/front-desk.js';

function signedOf(card) {
  if (card.kind !== 'question') return card.kind;
  return card.level === 4 ? 'level-4' : null;
}

export function sealOf({ card, facts, ctx = {}, stamp, at }) {
  const signed = signedOf(card);
  const seal = {
    line: 'seal',
    card: card.id,
    work: card.work,
    head: facts?.head ?? null,
    signed,
    reader: signed === null,
    candidates: Object.fromEntries(CANDIDATES.map((c) => [c.id, c.applies(facts, ctx)])),
    exclusions: { hit: exclusionsHit(facts), unread: COMMON_EXCLUSIONS.filter((e) => e.hit(facts) === null).map((e) => e.id) },
    stamp,
    at,
  };
  return { ...seal, hash: dataHash(seal) };
}

const isText = (x) => typeof x === 'string' && x.trim() !== '';

// What would have been decided against what the director did: 'match', 'miss', or 'outside' when they stepped out of
// the options, which counts as a miss whatever their words say. Null where there is nothing to score: no reading and no
// set answer (a rule's, from part 5), or no answer yet. A label that puts a card off answers nothing, and Suggest a
// change… alone is outside. `reading` scores on its pick alone: its frame and `afterAnswer` stay on its own line.
export function scoreOf({ seal, reading, answer, steered = false }) {
  const would = seal?.set ?? reading?.pick;
  if (!isText(would) || !isText(answer?.label)) return null;
  if (steered || answer.label === SUGGEST || isText(answer.words)) return 'outside';
  if (PUT_OFF.includes(answer.label)) return null;
  return normaliseWords(would) === normaliseWords(answer.label) ? 'match' : 'miss';
}

export function scoreLine({ seal, score, at }) {
  const line = { line: 'score', card: seal.card, work: seal.work, seal: seal.hash, score, at };
  return { ...line, hash: dataHash(line) };
}

// Each card's lines from `shadow` events: { seal, reading, score }, the first of each by time, since a crash between a
// write and `shadow.json` can leave a second. What was sealed first is what the card was sealed with.
export function firstLines(events) {
  const cards = new Map();
  for (const { data } of [...events].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))) {
    const lines = cards.get(data.card) ?? {};
    lines[data.line] ??= data;
    cards.set(data.card, lines);
  }
  return cards;
}
