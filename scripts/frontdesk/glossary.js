// scripts/frontdesk/glossary.js
// The glossary behind the front desk's plain words: the starter terms, the project's own over
// them, finding which terms a text uses, and putting a text into plain words.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const STARTER = fileURLToPath(new URL('../../templates/glossary.json', import.meta.url));

// Other ways the director's text may name a term.
const ALIASES = { 'pull request': ['PR'] };
// The verb forms that count for a term, beside its plurals.
const FORMS = { merge: ['merged', 'merging'], review: ['reviewed', 'reviewing'], commit: ['committed', 'committing'] };
// Names, not ordinary words: only the capitalised form counts ("stop" and "standard" in a sentence don't).
export const NAMES = Object.freeze(['STOP', 'Standard', 'Locked']);

// The words that stand in for a term in a sentence, by how the text spells it. Each is a short
// phrase that fits where the term stood, with no capital: `phrase` for the term itself, `plural`
// for "PRs", `past` for "merged", `ing` for "merging". A term without the words for a spelling is
// kept there, with its meaning listed at the end.
const FIELD = { base: 'phrase', plural: 'plural', past: 'past', ing: 'ing' };
const COPIED = ['example', ...Object.values(FIELD)];
// What comes before a verb: "to merge" is the verb, where "the merge" is not.
const BEFORE_VERB = /\b(?:to|will|would|can|could|must|should|shall|may|might|not|never|then|also|just)\s+$/i;
// What comes before a sentence, a line or a list item begins.
const SENTENCE_START = /(?:^|[.!?]\s+|\n)[ \t]*(?:(?:[-*\u2022>]|#{1,6}|\d+[.)])[ \t]+)?$/u;

const isEntry = (x) => x !== null && typeof x === 'object' && typeof x.plain === 'string' && x.plain !== '';
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function starter() {
  const all = JSON.parse(fs.readFileSync(STARTER, 'utf8'));
  return Object.fromEntries(Object.entries(all).filter(([, entry]) => isEntry(entry)));
}

// The starter's terms with the project's `glossary` view over them: the view maps a term to an
// event whose data is { term, plain, example?, phrase?, plural?, past?, ing? }. A project entry
// replaces a starter term whatever its case.
export function glossaryOf(view) {
  const out = starter();
  for (const [key, event] of Object.entries(view ?? {})) {
    const data = event?.data;
    if (!isEntry(data)) continue;
    const term = typeof data.term === 'string' && data.term !== '' ? data.term : key;
    for (const have of Object.keys(out)) if (have.toLowerCase() === term.toLowerCase()) delete out[have];
    out[term] = { plain: data.plain, ...Object.fromEntries(COPIED.filter((f) => typeof data[f] === 'string' && data[f] !== '').map((f) => [f, data[f]])) };
  }
  return out;
}

// A pattern for one term in a text: the term or an alias, in any case, as whole words, with an
// optional plural ("branches", "PRs") and the verb forms ("merged"). A name (STOP, Standard,
// Locked) matches in its own capitals only. Words are runs of letters and digits.
export function termPattern(term) {
  const spaced = (n) => n.trim().split(/\s+/).map(escape).join('\\s+');
  const names = [term, ...(ALIASES[term.toLowerCase()] ?? [])].map((n) => `${spaced(n)}(?:e?s)?`);
  const body = [...names, ...(FORMS[term.toLowerCase()] ?? []).map(spaced)].join('|');
  return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${body})(?![\\p{L}\\p{N}_])`, NAMES.includes(term) ? 'gu' : 'giu');
}

// Where each term of the glossary is used in a text, left to right: { term, index, length }.
// Where two terms overlap, the longer one wins.
export function termMatches(text, glossary) {
  if (typeof text !== 'string') return [];
  const found = [];
  for (const term of Object.keys(glossary ?? {})) {
    for (const m of text.matchAll(termPattern(term))) found.push({ term, index: m.index, length: m[0].length });
  }
  found.sort((a, b) => a.index - b.index || b.length - a.length);
  const out = [];
  let end = 0;
  for (const m of found) {
    if (m.index < end) continue;
    out.push(m);
    end = m.index + m.length;
  }
  return out;
}

// The glossary terms a text uses, each once, in the order they first appear.
export function termsIn(text, glossary) {
  return [...new Set(termMatches(text, glossary).map((m) => m.term))];
}

// The name a `known:<concept>` setting gives a term: "pull request" is "pull-request".
export function conceptOf(term) {
  return String(term).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// The concepts the director knows, from the effective settings (those `known:*` that are true).
export function knownConcepts(settings) {
  return Object.entries(settings ?? {})
    .filter(([key, held]) => key.startsWith('known:') && held?.value === true)
    .map(([key]) => key.slice('known:'.length));
}

// How a text spells a term: its own words ("base"), a "plural", a "past" or an "ing" form.
function spelling(term, word) {
  const w = word.toLowerCase().replace(/\s+/g, ' ');
  const forms = (FORMS[term.toLowerCase()] ?? []).map((f) => f.toLowerCase());
  if (forms.includes(w)) return w.endsWith('ing') ? 'ing' : 'past';
  const own = [term, ...(ALIASES[term.toLowerCase()] ?? [])].map((n) => n.toLowerCase().replace(/\s+/g, ' '));
  return own.includes(w) ? 'base' : 'plural';
}

// plainWords(text, glossary, { explanations, known }) -> { text, terms }. `terms` are the glossary
// terms the text uses, each once, in order. With `plain` explanations (the default), the first
// mention of each term the director doesn't know is replaced by its plain words, and later
// mentions keep the term. With `some-terms` the terms stay. A term that stays and isn't known,
// because the text spells it in a way the glossary has no words for or because of the setting, is
// given its meaning in a "Terms:" line at the end, so no term is left bare. `known` is the
// concepts the director knows (see knownConcepts), or terms.
export function plainWords(text, glossary, { explanations = 'plain', known = [] } = {}) {
  if (typeof text !== 'string') return { text: '', terms: [] };
  const knows = new Set((Array.isArray(known) || known instanceof Set ? [...known] : []).map(conceptOf));
  const matches = termMatches(text, glossary);
  const terms = [...new Set(matches.map((m) => m.term))];
  const replaced = new Set();
  let out = '';
  let at = 0;
  if (explanations !== 'some-terms') {
    for (const m of matches) {
      if (replaced.has(m.term) || knows.has(conceptOf(m.term))) continue;
      const word = text.slice(m.index, m.index + m.length);
      const form = spelling(m.term, word);
      const phrase = glossary[m.term][FIELD[form]];
      const before = text.slice(0, m.index);
      const verb = form === 'base' && Object.hasOwn(FORMS, m.term.toLowerCase()) && BEFORE_VERB.test(before);
      if (typeof phrase !== 'string' || phrase === '' || verb) continue;
      const capital = /^\p{Lu}/u.test(word) && SENTENCE_START.test(before);
      out += text.slice(at, m.index) + (capital ? phrase[0].toUpperCase() + phrase.slice(1) : phrase);
      at = m.index + m.length;
      replaced.add(m.term);
    }
  }
  out += text.slice(at);
  const listed = terms.filter((t) => !replaced.has(t) && !knows.has(conceptOf(t)));
  if (listed.length > 0) {
    out += `\n\nTerms: ${listed.map((t) => `${t} means ${glossary[t].plain.replace(/[.\s]+$/, '')}`).join('; ')}.`;
  }
  return { text: out, terms };
}
