// scripts/engine/spend.js
// The spend meter (Archon design, section 10.1): a run's cost from the engine's record of its steps, and the minutes
// it has spent running, from the project's own `run` records. Only running time counts: a run paused at an ask is
// waiting for someone, not spending, and one on a computer asleep is doing nothing.

// The spans of `slept` as [from, to] in milliseconds, in order and with none overlapping. One that makes no sense is
// passed over.
function sleepSpans(slept) {
  const spans = (Array.isArray(slept) ? slept : [])
    .map((s) => [Date.parse(s?.from), Date.parse(s?.to)])
    .filter(([from, to]) => from < to)
    .sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [from, to] of spans) {
    const last = out.at(-1);
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else out.push([from, to]);
  }
  return out;
}

// The milliseconds from `from` to `to`, less what `spans` cover.
function awake(from, to, spans) {
  let time = Math.max(0, to - from);
  for (const [start, end] of spans) time -= Math.max(0, Math.min(to, end) - Math.max(from, start));
  return time;
}

// The minutes from `from` (a time) to `now`, less the spans of `slept`: how long a wait has really lasted.
export const awakeMinutes = (from, now, slept = []) => awake(Date.parse(from), now.getTime(), sleepSpans(slept)) / 60000;

// The minutes `records` (a run's `run` records, each { at, data: { state } }, in time order) spent running up to
// `now`: from each start, or carrying on after an ask, to the next pause or end, less the spans of `slept`
// ([{ from, to }], when the computer was asleep). A resumed run's legs add up. After an `ended`, only a `started` with
// `resume` counts: a plain one is an answer arriving late, and nothing ran.
export function runningMinutes(records, now = new Date(), slept = []) {
  const spans = sleepSpans(slept);
  let total = 0;
  let from = null;
  let over = false;
  for (const e of records ?? []) {
    const at = Date.parse(e?.at);
    if (!Number.isFinite(at)) continue;
    const state = e.data?.state;
    if (state === 'started') {
      if (over && !Number.isInteger(e.data.resume)) continue;
      over = false;
      from ??= at;
    } else if (from !== null) {
      total += awake(from, at, spans);
      from = null;
    }
    if (state === 'ended') over = true;
  }
  if (from !== null) total += awake(from, now.getTime(), spans);
  return Math.round(total / 600) / 100;
}

const RANK = { reported: 0, estimated: 1, unknown: 2 };
const figure = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const cents = (n) => Math.round(n * 1e6) / 1e6;
export const TOKEN_KINDS = Object.freeze(['input', 'output', 'cacheRead', 'cacheWrite']);

// A run's cost from its record (the engine's inspect): { tokens, kinds, dollars, floorDollars, premiumRequests,
// minutes, source, byRole }. Tokens add up what the steps reported or estimated; dollars are null when any step that
// called a model gave none, with `floorDollars` the known part; `source` is the weakest of the steps'. Requests are
// the steps' counted requests, whatever became of the run: a cancelled step counted its prompt though it reported no
// spend. They are null only when they can't be known: a step of unknown spend that counted none, or a run the engine
// no longer has. Minutes add up the steps' own running time. A step's row holds its last attempt only, so for a run that
// resumed the steps read less than the run spent: where the engine gives `totals` ({ tokens, dollars }), which add every
// leg, the larger figure stands (check 93). `kinds`, `byRole`, `minutes` and requests stay the steps'.
export function runCost(inspect) {
  const steps = Array.isArray(inspect?.steps) ? inspect.steps : [];
  let tokens = 0;
  let floor = 0;
  let unknownDollars = false;
  let requests = 0;
  let requestsKnown = inspect?.status !== 'unknown';
  let minutes = 0;
  let source = 'reported';
  const kinds = Object.fromEntries(TOKEN_KINDS.map((k) => [k, 0]));
  const kindsKnown = Object.fromEntries(TOKEN_KINDS.map((k) => [k, true]));
  let anyKinds = false;
  const byRole = {};
  for (const s of steps) {
    const stepSource = Object.hasOwn(RANK, s.source) ? s.source : 'unknown';
    if (RANK[stepSource] > RANK[source]) source = stepSource;
    if (figure(s.tokens)) tokens += s.tokens;
    if (figure(s.dollars)) floor += s.dollars;
    else unknownDollars = true;
    if (figure(s.requests)) requests += s.requests;
    else if (stepSource === 'unknown') requestsKnown = false;
    if (figure(s.minutes)) minutes += s.minutes;
    if (s.kinds && typeof s.kinds === 'object') {
      anyKinds = true;
      for (const k of TOKEN_KINDS) {
        if (figure(s.kinds[k])) kinds[k] += s.kinds[k];
        else kindsKnown[k] = false;
      }
    }
    const role = typeof s.role === 'string' && s.role !== '' ? s.role : s.id ?? 'step';
    const share = (byRole[role] ??= { tokens: 0, dollars: 0, minutes: 0 });
    if (figure(s.tokens)) share.tokens += s.tokens;
    share.dollars = figure(s.dollars) && share.dollars !== null ? cents(share.dollars + s.dollars) : null;
    if (figure(s.minutes)) share.minutes += s.minutes;
  }
  const totals = inspect?.totals;
  if (figure(totals?.tokens)) tokens = Math.max(tokens, totals.tokens);
  if (figure(totals?.dollars)) floor = Math.max(floor, totals.dollars);
  return {
    tokens,
    kinds: anyKinds ? Object.fromEntries(TOKEN_KINDS.map((k) => [k, kindsKnown[k] ? kinds[k] : null])) : null,
    dollars: unknownDollars ? null : cents(floor),
    floorDollars: cents(floor),
    premiumRequests: requestsKnown ? requests : null,
    minutes: Math.round(minutes * 100) / 100,
    source,
    byRole,
  };
}

// What a cost (a run's `cost` record, or runCost's answer) adds to the month's requests. A count that can't be known is
// never 0: it reads as one for each step it names, at least one, until the provider's own figure corrects it.
export function countedRequests(cost) {
  if (figure(cost?.premiumRequests)) return cost.premiumRequests;
  return Math.max(1, Object.keys(cost?.byRole ?? {}).length);
}
