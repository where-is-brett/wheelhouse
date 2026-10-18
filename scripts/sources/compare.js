// scripts/sources/compare.js
// What changed between two copies of a source's text, which models it names, and which are retiring.

const textOf = (copy) => (typeof copy === 'string' ? copy : copy?.text ?? '');
const linesOf = (copy) => textOf(copy).split('\n').map((line) => line.trim()).filter(Boolean);
const linksOf = (copy) => (copy && typeof copy === 'object' && Array.isArray(copy.links) ? copy.links : []);

// The lines of `after` not in `before`, and the reverse, by lines as sets: moving a line is no
// change. Each side is the text, or `{ text, links }`, in which case the links not seen before
// are listed too (a link alone is not a change).
export function compareSource(before, after) {
  const was = new Set(linesOf(before));
  const is = new Set(linesOf(after));
  const added = [...is].filter((line) => !was.has(line));
  const removed = [...was].filter((line) => !is.has(line));
  const known = new Set(linksOf(before));
  const newLinks = [...new Set(linksOf(after))].filter((link) => !known.has(link));
  return { changed: added.length > 0 || removed.length > 0, added, removed, newLinks };
}

const MODEL = /(?<![\w-])claude-[\w.-]*\d[\w.-]*/gi;

// Words of the form `claude-…` that hold a digit, once each, in the order they first appear.
export function modelNames(text) {
  const names = [];
  for (const match of String(text ?? '').matchAll(MODEL)) {
    const name = match[0].replace(/[.-]+$/, '');
    if (/\d/.test(name) && !names.includes(name)) names.push(name);
  }
  return names;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH = '(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)';
const monthNumber = (word) => MONTHS.findIndex((name) => name.startsWith(word.toLowerCase().slice(0, 3))) + 1;
const DATE = new RegExp(`(\\d{4})-(\\d{2})-(\\d{2})|(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH}\\.?,?\\s+(\\d{4})|${MONTH}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})`, 'gi');

function isoDate(year, month, day) {
  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

// Every date on a line, as `YYYY-MM-DD`: `2027-01-05`, `5 January 2027` or `January 5, 2027`.
function datesIn(line) {
  const dates = [];
  for (const m of line.matchAll(DATE)) {
    const date = m[1] ? isoDate(+m[1], +m[2], +m[3])
      : m[4] ? isoDate(+m[6], monthNumber(m[5]), +m[4])
        : isoDate(+m[9], monthNumber(m[7]), +m[8]);
    if (date) dates.push(date);
  }
  return dates;
}

// Each model on a line with a date, with the date it retires: the model first named on the
// line (a later one is its replacement) and the latest date on the line (an earlier one is
// when it was deprecated). A date already past is left out. A model on several lines keeps
// its earliest date. In the order the models first appear.
export function retirements(text, now) {
  const today = new Date(now ?? Date.now()).toISOString().slice(0, 10);
  const found = [];
  for (const line of String(text ?? '').split('\n')) {
    const [model] = modelNames(line);
    const dates = model ? datesIn(line) : [];
    if (!model || dates.length === 0) continue;
    const date = dates.reduce((latest, d) => (d > latest ? d : latest));
    if (date < today) continue;
    const seen = found.find((entry) => entry.model === model);
    if (!seen) found.push({ model, date });
    else if (date < seen.date) seen.date = date;
  }
  return found;
}
