// scripts/engine/spend.js
// The spend meter (Archon design, section 10.1): a run's cost from the engine's record of its steps, and the minutes
// it has spent running, from the project's own `run` records. Only running time counts: a run paused at an ask is
// waiting for someone, not spending.

// The minutes `records` (a run's `run` records, each { at, data: { state } }, in time order) spent running up to
// `now`: from each start, or carrying on after an ask, to the next pause or end.
export function runningMinutes(records, now = new Date()) {
  let total = 0;
  let from = null;
  for (const e of records ?? []) {
    const at = Date.parse(e?.at);
    if (!Number.isFinite(at)) continue;
    const state = e.data?.state;
    if (state === 'started') from ??= at;
    else if (from !== null) {
      total += at - from;
      from = null;
    }
    if (state === 'ended') break;
  }
  if (from !== null) total += Math.max(0, now.getTime() - from);
  return Math.round(total / 600) / 100;
}

const RANK = { reported: 0, estimated: 1, unknown: 2 };
const figure = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const cents = (n) => Math.round(n * 1e6) / 1e6;
export const TOKEN_KINDS = Object.freeze(['input', 'output', 'cacheRead', 'cacheWrite']);

// A run's cost from its record (the engine's inspect): { tokens, kinds, dollars, floorDollars, premiumRequests,
// minutes, source, byRole }. Tokens add up what the steps reported or estimated; dollars are null when any step that
// called a model gave none, with `floorDollars` the known part; `source` is the weakest of the steps'. Requests are
// the steps' counted requests, null when the run's spend is unknown. Minutes add up the steps' own running time.
export function runCost(inspect) {
  const steps = Array.isArray(inspect?.steps) ? inspect.steps : [];
  let tokens = 0;
  let floor = 0;
  let unknownDollars = false;
  let requests = 0;
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
  return {
    tokens,
    kinds: anyKinds ? Object.fromEntries(TOKEN_KINDS.map((k) => [k, kindsKnown[k] ? kinds[k] : null])) : null,
    dollars: unknownDollars ? null : cents(floor),
    floorDollars: cents(floor),
    premiumRequests: source === 'unknown' ? null : requests,
    minutes: Math.round(minutes * 100) / 100,
    source,
    byRole,
  };
}
