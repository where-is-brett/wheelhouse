// scripts/proof/note.js
// The proof note (design section 7 of the director's way of working): what a finished piece reaches the director as, and the
// body of its pull request. It is written for the director, in the report's own word limit, under seven headings in a fixed
// order. This file only builds text.
import { REPORT_WORDS } from '../lib/build-loop.js';

export const DATA_HEADING = 'The data, before and after';
export const HEADINGS = Object.freeze(['What changed', 'Why', 'Decided on its own', 'Decisions followed', 'How it was checked', 'What it looks like', DATA_HEADING]);

export const TEST_DATA = 'On test data.';
export const NOT_COMPARED = 'Nothing was compared.';
export const REAL_DATA = 'On a read-only sample of real data.';

const countWords = (text) => String(text).split(/\s+/).filter(Boolean).length;

// `text` cut to `n` words, with a mark where it was cut; whole when it fits, line breaks kept.
function cut(text, n) {
  const whole = String(text ?? '').trim();
  if (countWords(whole) <= n) return whole;
  return `${whole.split(/\s+/).filter(Boolean).slice(0, Math.max(1, n)).join(' ')}…`;
}
const line = (text, n) => cut(String(text ?? '').replace(/\s+/g, ' '), n);

// A name or value of the project's, as code, so nothing in it reads as the note's own marks.
const code = (text) => `\`${String(text).replace(/`/g, "'").replace(/\s+/g, ' ')}\``;

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (items) => items.join(', ');

// The decisions the piece made on its own: each call, why, and how many more there were.
function decided(calls, k) {
  if (calls.length === 0) return 'Nothing was decided on its own.';
  const shown = calls.slice(0, Math.max(1, Math.floor(5 * k)));
  const lines = shown.map((c) => `- ${line(c.decided, Math.max(3, Math.round(14 * k)))} (${line(c.why, Math.max(2, Math.round(12 * k)))})`);
  if (calls.length > shown.length) lines.push(`- and ${calls.length - shown.length} more, in the decision log.`);
  return lines.join('\n');
}

// The decisions of the director's the piece followed.
function followedBy(followed, k) {
  if (followed.length === 0) return "No decision of the director's applied.";
  const shown = followed.slice(0, Math.max(1, Math.floor(4 * k)));
  const lines = shown.map((f) => `- ${line(f.question, Math.max(3, Math.round(10 * k)))}: ${line(f.answer, Math.max(2, Math.round(10 * k)))}`);
  if (followed.length > shown.length) lines.push(`- and ${followed.length - shown.length} more.`);
  return lines.join('\n');
}

// How it was checked: the tests, the independent review (or that one follows), and what worried the session.
function checked({ report, review, notes }, k) {
  const out = [`Tests: ${line(report.fields.tests, Math.max(4, Math.round(40 * k)))}`];
  if (review === null || review === undefined) {
    out.push('An independent review follows once the pull request is open; its result is recorded there.');
  } else if (review.verdict === 'CLEAN') {
    out.push('The work was reviewed independently and found nothing.');
  } else {
    const blocking = review.blocking === 0 ? 'none blocking' : `${review.blocking} blocking`;
    out.push(`The work was reviewed independently: ${plural(review.findings, 'finding')}, ${blocking}.`);
  }
  if (Array.isArray(review?.lenses) && review.lenses.length > 0) out.push(`Lenses that ran: ${list(review.lenses)}.`);
  const concerns = (report.fields.concerns ?? []).slice(0, Math.max(1, Math.floor(3 * k)));
  for (const c of concerns) out.push(`Worried about: ${line(c, Math.max(3, Math.round(15 * k)))}`);
  for (const n of notes.slice(0, 2)) out.push(line(n, Math.max(4, Math.round(25 * k))));
  return out.join('\n');
}

// What it looks like: the pages the change touches.
function looks(previews, k) {
  if (previews.length === 0) return 'Nothing on a page changed.';
  const pages = previews.slice(0, Math.max(1, Math.floor(5 * k))).map((p) => code(p.page));
  return `The change touches ${list(pages)}.`;
}

// The data section: the comparison in the director's terms, then which data it ran on, last. With nothing compared it says why
// (a failure, a check that could not be made, or the session's own reason) and ends "Nothing was compared."
function dataSection(data, k) {
  const out = [];
  if (data.comparison === undefined) {
    if (typeof data.failure === 'string') {
      out.push(`The data command failed: ${line(data.failure, Math.max(4, Math.round(30 * k)))}`);
      if (typeof data.failureTail === 'string') out.push(`Its last lines: ${code(line(data.failureTail, Math.max(6, Math.round(50 * k))))}`);
    }
    else if (typeof data.unavailable === 'string') out.push(`The data check could not be made: ${line(data.unavailable, Math.max(4, Math.round(30 * k)))}`);
    if (typeof data.none === 'string') out.push(`${data.failure !== undefined || data.unavailable !== undefined ? "The session's reason" : 'No comparison was made'}: ${line(data.none, Math.max(4, Math.round(30 * k)))}`);
    else if (data.failure === undefined && data.unavailable === undefined) out.push('No comparison was made.');
  } else {
    const { counts, changed, unexpected } = data.comparison;
    const rows = counts.slice(0, Math.max(1, Math.floor(6 * k))).map((c) => `${code(c.table)}: ${c.before ?? 'none'} to ${c.after ?? 'none'}`);
    out.push(`Rows: ${rows.join('; ')}${counts.length > rows.length ? `; and ${counts.length - rows.length} more tables` : ''}.`);
    const shown = Math.max(1, Math.floor(5 * k));
    for (const c of changed.slice(0, shown)) out.push(`- ${code(c.table)} ${code(c.key)}, ${code(c.column)}: ${code(line(JSON.stringify(c.before), 6))} to ${code(line(JSON.stringify(c.after), 6))}`);
    if (changed.length > shown) out.push(`- and ${changed.length - shown} more changed values.`);
    if (unexpected.length === 0) out.push('Nothing moved that was not expected.');
    else for (const u of unexpected.slice(0, Math.max(1, Math.floor(4 * k)))) out.push(`Unexpected: ${line(u, Math.max(6, Math.round(20 * k)))}`);
  }
  if (typeof data.realRefused === 'string') out.push(`The real-data route was not used: ${line(data.realRefused, Math.max(4, Math.round(20 * k)))}`);
  if (data.comparison === undefined) out.push(NOT_COMPARED);
  else out.push(data.route === 'real' ? REAL_DATA : TEST_DATA);
  return out.join('\n');
}

function build({ report, calls, followed, review, previews, data, notes }, k) {
  const parts = [
    ['What changed', cut(report.body ?? '', Math.max(6, Math.round(110 * k)))],
    ['Why', line(report.goal ?? '', Math.max(4, Math.round(30 * k)))],
    ['Decided on its own', decided(calls, k)],
    ['Decisions followed', followedBy(followed, k)],
    ['How it was checked', checked({ report, review, notes }, k)],
    ['What it looks like', looks(previews, k)],
  ];
  if (data !== null && data !== undefined) parts.push([DATA_HEADING, dataSection(data, k)]);
  return `${parts.map(([heading, text]) => `## ${heading}\n\n${text}`).join('\n\n')}\n`;
}

// The proof note for a piece:
// - `report`: { fields, body, goal }: the report's fields and words, and the goal the brief set;
// - `calls`: what the piece decided on its own (the decision log, `readLog`);
// - `followed`: the decisions of the director's it followed, each { question, answer };
// - `review`: the independent review's { verdict, findings, blocking, lenses? }, or null while none has run;
// - `previews`: the pages whose pictures are kept, each { page };
// - `data`: null with no data work; else { route: 'test' | 'real', comparison?, none?, failure?, failureTail?, unavailable?, realRefused? }:
//   `failure` is why the helper's data command failed, `unavailable` why the check could not be made, `none` the session's reason;
// - `notes`: lines for "How it was checked" about a check that couldn't be made.
// Within REPORT_WORDS words: when the parts run over, each is cut shorter until the note fits.
export function proofNote({ report, calls = [], followed = [], review = null, previews = [], data = null, notes = [] }) {
  const input = { report, calls, followed, review, previews, data, notes };
  for (const k of [1, 0.75, 0.5, 0.35, 0.25, 0.15, 0.08]) {
    const note = build(input, k);
    if (countWords(note) <= REPORT_WORDS) return note;
  }
  const smallest = build(input, 0.01);
  // Over the limit even so: cut hard, so a note is never longer than a report may be.
  return countWords(smallest) <= REPORT_WORDS ? smallest : `${cut(smallest, REPORT_WORDS - 1)}\n`;
}
