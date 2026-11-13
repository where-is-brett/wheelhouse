// probes/haiku-trial/sittings.js
// The director's clicks, gathered into sittings (spec 2026-11-13, section 5): where each sitting goes, which clicks it holds, the
// time windows the director may hold it to, how long the steps before it are likely to take, and the note that announces it.
// Nothing here touches the run: the runner reads these and does the typing and waiting.

const MINUTE = 60 * 1000;

// How long each merge wait lasts at most (the runner's wave waits).
export const WAVE_WAIT_MS = { 2: 90 * MINUTE, 3: 150 * MINUTE, 4: 90 * MINUTE };

// The step after which each sitting point goes.
export const SITTING_POINTS = { w3: 'f1c', w4: 'w4-type', end: 'w5-midnight' };
const ORDER = ['w3', 'w4', 'end'];

// The clicks, in the order they are done, and what each needs before it can be ready.
export const CLICKS = [
  { id: 'F6', ready: ['p6Merged', 'building'] },
  { id: 'F5a', ready: ['F6'] },
  { id: 'F5b', ready: ['p2Merged', 'p3Merged'] },
];
// The earliest sitting point at which each click can be ready: P6 merges and a work is building by wave 3; P2 and P3 have both
// merged only once wave 4 has begun.
const EARLIEST = { F6: 'w3', F5a: 'w3', F5b: 'w4' };

const pointIndex = (point) => {
  const at = ORDER.indexOf(point);
  if (at < 0) throw new Error(`no sitting point called ${point}; use ${ORDER.join(', ')}`);
  return at;
};

// Puts each click in the first sitting at or after the earliest point where it can be ready. A click that no sitting can take
// goes in a sitting at the end. A sitting with no clicks is left out. Sittings are numbered in the order of their points.
export function placeClicks(points = ['w4']) {
  const wanted = [...new Set(points)].sort((a, b) => pointIndex(a) - pointIndex(b));
  const placed = new Map(wanted.map((point) => [point, []]));
  for (const { id } of CLICKS) {
    const home = wanted.find((point) => pointIndex(point) >= pointIndex(EARLIEST[id])) ?? 'end';
    if (!placed.has(home)) placed.set(home, []);
    placed.get(home).push(id);
  }
  return ORDER.filter((point) => placed.get(point)?.length > 0)
    .map((point, i) => ({ n: i + 1, point, after: SITTING_POINTS[point], clicks: placed.get(point) }));
}

// 'HH:MM-HH:MM' in local time, as minutes after midnight. An end before the start means the window crosses midnight.
export function parseWindow(text) {
  const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(String(text).trim());
  const bad = () => new Error(`a window is HH:MM-HH:MM in local time, such as 22:00-02:00, not "${text}"`);
  if (!m) throw bad();
  const [sh, sm, eh, em] = m.slice(1).map(Number);
  if (sh > 23 || eh > 23 || sm > 59 || em > 59) throw bad();
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  if (start === end) throw bad();
  return { start, end };
}

// Whether a sitting may start: 'open' inside a window, 'before' when a window is still to come, 'past' when every window has
// gone. `now` is minutes after midnight of the day the run began, so it runs past 1440 on the next day. A window is read as of
// that day and of the day before it, so one that crosses midnight is open at 01:00.
export function windowState(windows, now) {
  const spans = windows.flatMap(({ start, end }) => {
    const to = end < start ? end + 1440 : end;
    return [[start - 1440, to - 1440], [start, to]];
  });
  if (spans.some(([from, to]) => now >= from && now < to)) return 'open';
  return spans.some(([from]) => from > now) ? 'before' : 'past';
}

// Rough times for each step, in minutes, from the logs of the runs so far. They are rough: they only set the early edge of a
// sitting's estimate. A step not listed counts as five.
const TYPICAL_MIN = {
  stage: 1, 'create-repo': 1, 'create-preview': 1, install: 2, seed: 2, 'setup-s0': 25, 'front-desk': 3, ntfy: 5,
  'w2-type': 10, 'f3-kill-p1': 15, 'w2-merge-wait': 45, 'w2-audit': 1,
  'w3-type': 10, f1: 10, f1b: 10, f1c: 5, 'w3-merge-wait': 60, 'w3-audit': 1,
  'w4-type': 10, 'f4-check': 15, 'f3b-kill-foreman': 1, 's9-1': 20, 's9-2': 5, 's9-3': 5, 's9-4': 3, 's9-5': 3, 's9-6': 3,
  'pull-back': 3, digest: 12, 'w4-merge-wait': 40, 'w4-audit': 1, 'w5-incident': 15, 'w5-midnight': 15,
  score: 10, signals: 2, results: 2, 'raise-decision-3': 3, 'review-card': 5,
};
export const TYPICAL_MS = Object.fromEntries(Object.entries(TYPICAL_MIN).map(([id, m]) => [id, m * MINUTE]));

// The most each step waits: the wave waits, and the steps' own limits.
const WAIT_STEP_WAVE = { 'w2-merge-wait': 2, 'w3-merge-wait': 3, 'w4-merge-wait': 4 };
export const LIMIT_MS = {
  ...Object.fromEntries(Object.entries(WAIT_STEP_WAVE).map(([id, wave]) => [id, WAVE_WAIT_MS[wave]])),
  'setup-s0': 45 * MINUTE, 'f3-kill-p1': 40 * MINUTE, 'f4-check': 30 * MINUTE, 's9-1': 40 * MINUTE, digest: 30 * MINUTE,
};
const DEFAULT_LIMIT_MS = 15 * MINUTE;
const typicalOf = (id) => TYPICAL_MS[id] ?? 5 * MINUTE;
const limitOf = (id) => LIMIT_MS[id] ?? Math.max(DEFAULT_LIMIT_MS, typicalOf(id));

// When a sitting is likely to come: the early edge adds up the typical times of the steps before it, the late edge their limits.
export function estimate({ remaining, now }) {
  return {
    early: now + remaining.reduce((sum, id) => sum + typicalOf(id), 0),
    late: now + remaining.reduce((sum, id) => sum + limitOf(id), 0),
  };
}

// About how long the clicks take the director: five minutes for one, ten for three.
export const minutesFor = (clicks) => Math.ceil(5 + 2.5 * (Math.max(1, clicks) - 1));

const NAMES = { F6: 'lift All stop', F5a: 'approve the undo of P6', F5b: 'approve the undo of P2' };
export const clickName = (id) => NAMES[id] ?? id;
const pad = (n) => String(n).padStart(2, '0');
const clock = (ms) => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`;
const dayOf = (ms, now) => {
  const days = Math.round((new Date(ms).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / (24 * 60 * MINUTE));
  return days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
};
const windowText = ({ start, end }) => `${pad(Math.floor(start / 60))}:${pad(start % 60)}-${pad(Math.floor(end / 60))}:${pad(end % 60)}`;

// The note the runner writes as director.md: each sitting still to come, its clicks, when it is likely to come and how long it
// takes. `estimates[i]` is the `estimate` for `sittings[i]`.
export function directorNote({ sittings, estimates, windows = [], now = Date.now() }) {
  const lines = ['# The director: sittings still to come', ''];
  if (sittings.length === 0) lines.push('No sitting is still to come.');
  sittings.forEach((s, i) => {
    const { early, late } = estimates[i] ?? {};
    const when = early === undefined ? 'time not known' : `between ${clock(early)} and ${clock(late)} ${dayOf(late, now)}`;
    lines.push(`- **Sitting ${s.n}** (${when}): ${s.clicks.length} click${s.clicks.length === 1 ? '' : 's'} in the helper window, about ${minutesFor(s.clicks.length)} minutes.`);
    for (const id of s.clicks) lines.push(`  - ${id}: ${clickName(id)}`);
  });
  if (windows.length > 0) lines.push('', `Held to: ${windows.map(windowText).join(', ')} (local time). A sitting whose point comes before a window waits for it; builds carry on meanwhile.`);
  else if (sittings.length > 0) lines.push('', 'Each sitting asks once when its point comes. Answer ready when you are at the screen.');
  return `${lines.join('\n')}\n`;
}
