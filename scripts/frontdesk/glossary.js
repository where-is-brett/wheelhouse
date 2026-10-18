// scripts/frontdesk/glossary.js
// The glossary behind the front desk's plain words: the starter terms, the project's own over
// them, and finding which terms a text uses.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const STARTER = fileURLToPath(new URL('../../templates/glossary.json', import.meta.url));

// Other ways the director's text may name a term.
const ALIASES = { 'pull request': ['PR'] };
// The verb forms that count for a term, beside its plurals.
const FORMS = { merge: ['merged', 'merging'], review: ['reviewed', 'reviewing'], commit: ['committed', 'committing'] };
// Names, not ordinary words: only the capitalised form counts ("stop" and "standard" in a sentence don't).
export const NAMES = Object.freeze(['STOP', 'Standard', 'Locked']);

const isEntry = (x) => x !== null && typeof x === 'object' && typeof x.plain === 'string' && x.plain !== '';
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function starter() {
  const all = JSON.parse(fs.readFileSync(STARTER, 'utf8'));
  return Object.fromEntries(Object.entries(all).filter(([, entry]) => isEntry(entry)));
}

// The starter's terms with the project's `glossary` view over them: the view maps a term to an
// event whose data is { term, plain, example? }. A project entry replaces a starter term
// whatever its case.
export function glossaryOf(view) {
  const out = starter();
  for (const [key, event] of Object.entries(view ?? {})) {
    const data = event?.data;
    if (!isEntry(data)) continue;
    const term = typeof data.term === 'string' && data.term !== '' ? data.term : key;
    for (const have of Object.keys(out)) if (have.toLowerCase() === term.toLowerCase()) delete out[have];
    out[term] = { plain: data.plain, ...(typeof data.example === 'string' && data.example !== '' ? { example: data.example } : {}) };
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
