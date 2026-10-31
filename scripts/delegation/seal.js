// scripts/delegation/seal.js
// A seal: what the script checks said about a card when it was written, with a hash and a time (delegated decisions
// design, section 12). It is the first of the three `shadow` lines joined by the card's id. Only a question at level 3
// can ever be read: an approval, a cap and the other cards no rule can decide are sealed as what they are, as is level 4.
import { dataHash } from '../state/events.js';
import { CANDIDATES, COMMON_EXCLUSIONS, exclusionsHit } from './candidates.js';

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
