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
// `pastBefore` and `ingBefore` stand in where a preposition follows ("merged into main"). A term that
// `takesName` is kept where a name follows it ("branch main").
const FIELD = { base: 'phrase', plural: 'plural', past: 'past', ing: 'ing' };
const COPIED = ['example', ...Object.values(FIELD), 'pastBefore', 'ingBefore'];
const PREPOSITIONS = new Set(['into', 'to', 'onto', 'with', 'in', 'on', 'from', 'by', 'after', 'before', 'at', 'for', 'as', 'under', 'over', 'against', 'across', 'through']);
// Words that follow a term without being its name.
const NOT_NAMES = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been', 'has', 'have', 'had', 'will', 'would', 'can', 'could',
  'should', 'may', 'might', 'must', 'not', 'no', 'of', 'in', 'on', 'at', 'to', 'for', 'from', 'by', 'with', 'into', 'as', 'if', 'then',
  'that', 'this', 'these', 'those', 'it', 'its', 'so', 'also', 'still', 'just', 'only', 'now', 'yet', 'when', 'while', 'after', 'before',
  'since', 'until', 'because', 'which', 'who', 'what', 'where', 'how', 'than', 'too', 'again', 'here', 'there',
]);
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
// event whose data is { term, plain, example?, phrase?, plural?, past?, ing?, pastBefore?, ingBefore?, takesName? }. A project entry
// replaces a starter term whatever its case.
export function glossaryOf(view) {
  const out = starter();
  for (const [key, event] of Object.entries(view ?? {})) {
    const data = event?.data;
    if (!isEntry(data)) continue;
    const term = typeof data.term === 'string' && data.term !== '' ? data.term : key;
    for (const have of Object.keys(out)) if (have.toLowerCase() === term.toLowerCase()) delete out[have];
    out[term] = {
      plain: data.plain,
      ...Object.fromEntries(COPIED.filter((f) => typeof data[f] === 'string' && data[f] !== '').map((f) => [f, data[f]])),
      ...(data.takesName === true ? { takesName: true } : {}),
    };
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

const WORD = /[\p{L}\p{N}_]/u;
const wordAt = (text, i) => i >= 0 && i < text.length && WORD.test(text[i]);

// The spans of a text that are quoted: backticks, double and curly quotes, and single quotes that
// open a quotation (not an apostrophe), then the text the caller asks to keep wherever it appears.
function protectedRanges(text, protect) {
  const ranges = [];
  const add = (pattern) => { for (const m of text.matchAll(pattern)) ranges.push([m.index, m.index + m[0].length]); };
  add(/`[^`\n]*`/g);
  add(/"[^"\n]*"/g);
  add(/“[^”\n]*”/g);
  add(/(?<![\p{L}\p{N}])['‘][^'’\n]+['’](?![\p{L}\p{N}])/gu);
  for (const kept of protect) {
    if (typeof kept !== 'string' || kept === '') continue;
    for (let at = text.indexOf(kept); at !== -1; at = text.indexOf(kept, at + kept.length)) ranges.push([at, at + kept.length]);
  }
  return ranges;
}

// Whether a match is part of a command, address, path, branch or file name or identifier: joined
// without a space to / @ : . = ? & # \, or to a hyphen with a word on both sides.
function joined(text, index, length) {
  const end = index + length;
  const before = text[index - 1];
  const after = text[end];
  if (before !== undefined && ('/@:.\\=?&#'.includes(before) || (before === '-' && wordAt(text, index - 2)))) return true;
  if (after === undefined) return false;
  if ('/@\\=&#'.includes(after)) return true;
  if (after === ':') return end + 1 < text.length && !/\s/.test(text[end + 1]);
  return (after === '.' || after === '-') && wordAt(text, end + 1);
}

// plainWords(text, glossary, { explanations, known, protect }) -> { text, terms }. `terms` are the
// glossary terms the text uses, each once, in order. With `plain` explanations (the default), the
// first mention of each term the director doesn't know is replaced by its plain words. With
// `some-terms` the terms stay. A term mentioned where it stays (a later mention, a spelling the
// glossary has no words for, a name or another term right after it) and isn't known is given its
// meaning in a "Terms:" line at the end, so no term is left bare. `known` is the concepts the
// director knows (see knownConcepts), or terms. Nothing is rewritten inside quotations, backticks,
// command-, address-, path- or name-like tokens, or the `protect` strings: they are what the
// director must recognise, type or click, and they are no use of a term.
export function plainWords(text, glossary, { explanations = 'plain', known = [], protect = [] } = {}) {
  if (typeof text !== 'string') return { text: '', terms: [] };
  const knows = new Set((Array.isArray(known) || known instanceof Set ? [...known] : []).map(conceptOf));
  const fenced = protectedRanges(text, Array.isArray(protect) ? protect : []);
  const matches = termMatches(text, glossary).filter((m) => !joined(text, m.index, m.length)
    && !fenced.some(([from, to]) => m.index < to && m.index + m.length > from));
  const terms = [...new Set(matches.map((m) => m.term))];
  const replaced = new Set();
  const stayed = new Set();
  let out = '';
  let at = 0;
  matches.forEach((m, i) => {
    if (knows.has(conceptOf(m.term))) return;
    const end = m.index + m.length;
    const form = spelling(m.term, text.slice(m.index, end));
    // Two nouns together ("PR review") don't come out right word by word, so both stay.
    const noun = (x) => ['base', 'plural'].includes(spelling(x.term, text.slice(x.index, x.index + x.length)));
    const apart = (a, b) => text.slice(a.index + a.length, b.index) === ' ' && noun(a) && noun(b);
    const compound = (i > 0 && apart(matches[i - 1], m)) || (i + 1 < matches.length && apart(m, matches[i + 1]));
    const entry = glossary[m.term];
    const tail = /^[ \t]+(\p{L}+)/u.exec(text.slice(end));
    const next = tail?.[1].toLowerCase();
    const name = /^[ \t]+([\p{L}\p{N}_#][\p{L}\p{N}_./-]*)/u.exec(text.slice(end))?.[1];
    const before = text.slice(0, m.index);
    let phrase = entry[FIELD[form]];
    if ((form === 'past' || form === 'ing') && PREPOSITIONS.has(next) && typeof entry[`${form}Before`] === 'string') phrase = entry[`${form}Before`];
    const verb = form === 'base' && Object.hasOwn(FORMS, m.term.toLowerCase()) && BEFORE_VERB.test(before);
    const named = form === 'base' && entry.takesName === true && name !== undefined && !NOT_NAMES.has(name.toLowerCase());
    if (explanations === 'some-terms' || replaced.has(m.term) || typeof phrase !== 'string' || phrase === '' || verb || named || compound) {
      stayed.add(m.term);
      return;
    }
    // A word that repeats the phrase's last word is taken in: "CI run" is "automatic check run".
    let skip = 0;
    const last = phrase.split(/\s+/).at(-1).toLowerCase();
    if (!phrase.endsWith(')') && next !== undefined) {
      if (next === last) skip = tail[0].length;
      else if (form === 'base' && next === `${last}s` && typeof entry.plural === 'string' && entry.plural !== '') {
        phrase = entry.plural;
        skip = tail[0].length;
      }
    }
    const capital = /^\p{Lu}/u.test(text.slice(m.index, end)) && SENTENCE_START.test(before);
    if (capital) phrase = phrase[0].toUpperCase() + phrase.slice(1);
    // "a review" is "an independent check".
    const lead = text.slice(at, m.index).replace(/(^|[^\p{L}\p{N}_])(a|an)(\s+)$/iu, (all, gap, article, space) => {
      const fitted = /^[aeiou]/i.test(phrase) ? 'an' : 'a';
      return `${gap}${article[0] === 'A' ? fitted[0].toUpperCase() + fitted.slice(1) : fitted}${space}`;
    });
    out += lead + phrase;
    at = end + skip;
    replaced.add(m.term);
  });
  out += text.slice(at);
  const listed = terms.filter((t) => stayed.has(t) && !knows.has(conceptOf(t)));
  if (listed.length > 0) {
    out += `\n\nTerms: ${listed.map((t) => `${t} means ${glossary[t].plain.replace(/[.\s]+$/, '')}`).join('; ')}.`;
  }
  return { text: out, terms };
}
