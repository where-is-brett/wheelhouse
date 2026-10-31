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
