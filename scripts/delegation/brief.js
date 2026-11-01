// scripts/delegation/brief.js
// The standing brief (delegated decisions design, sections 6 and 11.1): the director's intent for a project, one signed
// record in the private record. Agents read it through the helper and can't write it: a draft is no brief, and only the
// director's click on its confirm card puts one in force (views.brief). A blank line is allowed and means only that more
// questions park. `words` is the record's lines on one line, which the confirm card shows and the click signs, so a
// record whose words aren't its lines stands for nothing. Nothing here decides anything yet.
import { scanContent } from '../state/secret-scan.js';
import { BRIEF_EXAMPLES_MOST, BRIEF_FACTS_MOST, BRIEF_LINE_MOST } from './limits.js';

export const BRIEF_LINES = Object.freeze(['for', 'now', 'noGos', 'examples', 'facts']);
const BREAK = /[\r\n\v\f\u0085\u2028\u2029]/;
const BLANK = 'left blank';
const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const fits = (x) => typeof x === 'string' && x.length <= BRIEF_LINE_MOST && !BREAK.test(x);
const filled = (x) => fits(x) && x.trim() !== '';

// Whether `date` is a real day, as YYYY-MM-DD.
function isDay(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const day = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().startsWith(date);
}
const dayWords = (date) => new Date(`${date}T00:00:00.000Z`).toLocaleDateString('en-AU', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });

// What is wrong with a brief's lines, or null.
export function briefProblem(data) {
  if (!isPlain(data)) return 'needs its lines';
  if (![data.for, data.now, data.noGos].every(fits)) return `needs who it's for, what matters now and its no-gos each on one line of at most ${BRIEF_LINE_MOST} characters, or blank`;
  if (!Array.isArray(data.examples) || data.examples.length > BRIEF_EXAMPLES_MOST || !data.examples.every(filled)) return `takes at most ${BRIEF_EXAMPLES_MOST} examples, each on one line`;
  if (!Array.isArray(data.facts) || data.facts.length > BRIEF_FACTS_MOST) return `takes at most ${BRIEF_FACTS_MOST} facts`;
  for (const fact of data.facts) {
    if (!isPlain(fact) || Object.keys(fact).some((k) => !['words', 'date'].includes(k))) return 'needs each fact as its words and its date';
    if (!filled(fact.words)) return 'needs each fact\'s words, on one line';
    if (!isDay(fact.date)) return 'needs each fact\'s date, as YYYY-MM-DD';
  }
  return scanContent(JSON.stringify(BRIEF_LINES.map((line) => data[line]))).length > 0 ? 'holds what looks like a secret, and nothing secret goes in a brief' : null;
}

// A brief's lines on one line, every line shown, so the director signs all of it.
export function briefWords({ for: who, now, noGos, examples, facts }) {
  const line = (text) => (text.trim() === '' ? BLANK : text.trim());
  const list = (items) => (items.length === 0 ? BLANK : items.join('; '));
  return `For: ${line(who)}. Now: ${line(now)}. No-gos: ${line(noGos)}. Examples: ${list(examples)}. Facts: ${list(facts.map((f) => `${f.words} (${dayWords(f.date)})`))}.`;
}

// A brief from its lines, any left out blank. One with a problem comes back without its words, for briefProblem to name.
export function wholeBrief({ for: who = '', now = '', noGos = '', examples = [], facts = [] } = {}) {
  const lines = { for: who, now, noGos, examples, facts };
  return briefProblem(lines) === null ? { ...lines, words: briefWords(lines) } : lines;
}

// Whether a record is a whole brief, its words its own lines.
export const briefStands = (data) => briefProblem(data) === null && data.words === briefWords(data);

// The next version of a brief, with this fact, to confirm. A fact given again takes its new date.
export const addFact = (brief, fact) => wholeBrief({ ...brief, facts: [...brief.facts.filter((f) => f.words !== fact?.words), fact] });

// A brief's lines as a step reads them, or null.
export const briefLines = (brief) => (brief ? Object.fromEntries(BRIEF_LINES.map((line) => [line, brief[line]])) : null);
