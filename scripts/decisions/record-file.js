// scripts/decisions/record-file.js
// An answered decision as the short file the project keeps (design section 6.6 of the director's way of working): one file per
// decision under docs/decisions/, so agents and people read the same thing. Pure: it makes the path and the text and writes
// nothing; the callers (the feature command `answer`, and the daily batch) put the file where it belongs.
//
//   recordFile(decision, answer, { taken }) -> { path, text }
//     decision: { question, work, options: [{ label, says, cost, undo }], recommend }
//     answer:   { at, option, words }   `option` is the label chosen, or '' for the director's own words
//     taken:    paths already in use (a list or a Set), so a second record with the same question and day gets -2, -3
//
// The text is always in this form:
//   <!-- docs/decisions/<file>.md -->
//   # <the question>
//
//   - **Date:** <d Month yyyy>
//   - **Piece:** <work, or "none">
//   - **Options:** A. <says> (<cost>; <whether it can be undone>) · B. ... · C. ...
//   - **Recommended:** <label>
//   - **Chosen:** <label, or "own words">
//   - **The director's words:** "<words>", or "none"

export const DECISIONS_DIR = 'docs/decisions';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const SLUG_MAX = 50;

const flat = (x) => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim() : '');
const two = (n) => String(n).padStart(2, '0');
const dateOf = (at) => (at instanceof Date ? at : new Date(at));

// The calendar day of a time on this computer, as yyyy-mm-dd: the day the director answered, as they lived it.
export function dayOf(at) {
  const d = dateOf(at);
  if (Number.isNaN(d.getTime())) throw new Error('A decision record needs the time of the answer');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

// The day written for people: 7 November 2026.
export function dayWords(at) {
  const d = dateOf(at);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// The question as a file name's words: lower case, letters and digits joined by single hyphens, at most 50 characters.
export function slugOf(question) {
  const slug = flat(question).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const cut = slug.slice(0, SLUG_MAX).replace(/-+$/, '');
  return cut === '' ? 'decision' : cut;
}

// The path a record takes, with -2, -3 and so on while `taken` already holds it.
export function recordPath(question, at, taken = []) {
  const used = taken instanceof Set ? taken : new Set(taken);
  const stem = `${DECISIONS_DIR}/${dayOf(at)}-${slugOf(question)}`;
  let path = `${stem}.md`;
  for (let n = 2; used.has(path); n += 1) path = `${stem}-${n}.md`;
  return path;
}

function optionsLine(options) {
  return (Array.isArray(options) ? options : []).slice(0, LETTERS.length).map((o, i) => {
    const says = flat(o.says) !== '' ? flat(o.says) : flat(o.label);
    const extra = [flat(o.cost), flat(o.undo)].filter((x) => x !== '').map((x) => x.replace(/[.!?]+$/, ''));
    return `${LETTERS[i]}. ${says.replace(/[.!?]+$/, '')}${extra.length === 0 ? '' : ` (${extra.join('; ')})`}`;
  }).join(' · ');
}

// The text of the record with its path comment on the first line.
export function recordText(path, decision, answer) {
  const words = flat(answer.words);
  const chosen = flat(answer.option) === '' ? 'own words' : flat(answer.option);
  return [
    `<!-- ${path} -->`,
    `# ${flat(decision.question)}`,
    '',
    `- **Date:** ${dayWords(answer.at)}`,
    `- **Piece:** ${flat(decision.work) === '' ? 'none' : flat(decision.work)}`,
    `- **Options:** ${optionsLine(decision.options)}`,
    `- **Recommended:** ${flat(decision.recommend) === '' ? 'none' : flat(decision.recommend)}`,
    `- **Chosen:** ${chosen}`,
    `- **The director's words:** ${words === '' ? 'none' : `"${words}"`}`,
    '',
  ].join('\n');
}

export function recordFile(decision, answer, { taken = [] } = {}) {
  if (flat(decision?.question) === '') throw new Error('A decision record needs the question');
  const path = recordPath(decision.question, answer.at, taken);
  return { path, text: recordText(path, decision, answer) };
}
