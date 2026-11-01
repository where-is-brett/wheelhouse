// scripts/delegation/words.js
// One way of saying two questions use the same words (delegated decisions design, section 7.4): case, width, runs of
// white space, invisible marks and end punctuation make no difference, and every script is kept.

export function normaliseWords(text) {
  return String(text ?? '').normalize('NFKC').replace(/\p{Cf}/gu, '').toLowerCase().replace(/\s+/gu, ' ').trim().replace(/[\p{P}\s]+$/u, '');
}

const labelOf = (option) => (typeof option === 'string' ? option : option?.label);
const sorted = (options) => options.map((o) => normaliseWords(labelOf(o))).sort();

// Whether two lists offer the same options, in any order.
export function sameOptions(a, b) {
  return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
}

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// Whether one click could answer both: the same options at level 3. Never a kind that signs for itself: level 4, an
// approval, or a build command, whose grant is the click on its own card.
export function sameChoice(a, b) {
  if (!isPlain(a) || !isPlain(b) || a.level !== 3 || b.level !== 3) return false;
  if (a.commands !== undefined || b.commands !== undefined) return false;
  if (!Array.isArray(a.options) || !Array.isArray(b.options) || a.options.length === 0) return false;
  return sameOptions(a.options, b.options);
}

// Whether two open questions are one question asked twice (delegated decisions design, section 8.5): the same words too,
// and never by a step's topic label.
export function alike(a, b) {
  if (!sameChoice(a, b)) return false;
  const words = normaliseWords(a.what);
  return words !== '' && words === normaliseWords(b.what);
}
