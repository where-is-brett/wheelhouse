// scripts/lib/start-time.js
// Process start times as the system gives them, read as whole seconds so two can be compared whatever shape each came in.

// The environment `ps` is run with, so it prints lstart in the C locale ("Mon Nov  9 08:06:12 2026") whatever the
// computer's own: under a day-first locale such as Australian English it prints the day first ("Mon  9 Nov 08:06:12 2026").
export const PS_ENV = Object.freeze({ LC_ALL: 'C' });

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = '(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)';
const MONTH_NAME = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
const MONTH = `(${MONTH_NAME})`;
const CLOCK = '(\\d\\d):(\\d\\d):(\\d\\d) +(\\d{4})';

// `ps`'s lstart in either order: month first, as the C locale and month-first locales print it, or day first, as
// day-first locales print it. Records written before `ps` was run in the C locale may hold either.
// It has no capture groups of its own, so it can sit inside a longer pattern.
export const LSTART = `${DAY} +(?:${MONTH_NAME} +\\d{1,2}|\\d{1,2} +${MONTH_NAME}) +\\d\\d:\\d\\d:\\d\\d +\\d{4}`;
const MONTH_FIRST = new RegExp(`^${DAY} +${MONTH} +(\\d{1,2}) +${CLOCK}$`);
const DAY_FIRST = new RegExp(`^${DAY} +(\\d{1,2}) +${MONTH} +${CLOCK}$`);

// A process start time as whole seconds since 1970, or null when it is not one of the shapes read here: `ps`'s lstart,
// month first ("Tue Nov  4 10:00:01 2026") or day first ("Tue  4 Nov 10:00:01 2026"), in local time; or an ISO time
// ("2026-11-04T10:00:01.123Z").
export function startSeconds(text) {
  if (typeof text !== 'string' || text.length > 64) return null;
  const trimmed = text.trim();
  const iso = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d{1,7})?Z$/.exec(trimmed);
  if (iso) {
    const ms = Date.UTC(+iso[1], +iso[2] - 1, +iso[3], +iso[4], +iso[5], +iso[6]);
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
  }
  const monthFirst = MONTH_FIRST.exec(trimmed);
  const dayFirst = monthFirst ? null : DAY_FIRST.exec(trimmed);
  if (!monthFirst && !dayFirst) return null;
  const [month, day, hours, minutes, seconds, year] = monthFirst
    ? monthFirst.slice(1)
    : [dayFirst[2], dayFirst[1], ...dayFirst.slice(3)];
  const date = new Date(+year, MONTHS.indexOf(month), +day, +hours, +minutes, +seconds);
  const ms = date.getTime();
  return Number.isFinite(ms) && date.getDate() === +day ? Math.floor(ms / 1000) : null;
}

// Whether two start times name the same moment: the same text, or both readable and the same second. A start time
// recorded in one shape still matches the same process read again in another.
export function sameStart(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a === b) return true;
  const seconds = startSeconds(a);
  return seconds !== null && seconds === startSeconds(b);
}
