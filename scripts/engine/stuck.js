// scripts/engine/stuck.js
// What stands behind work that can't start (delegated decisions design, section 8.5). Each hold of `parked`, `clash` or
// `dependency` names what holds it, and following those back gives the pieces every held piece waits on. When no run
// is going and nothing can start, the highest card behind them rises past the budget and Away. It is worked out afresh
// on every tick, from the holds alone, so a card's own moment of writing plays no part.

// The holds that name what holds them. Any other reason is its own: an All stop, a usage cap, an approval not given.
const FOLLOWED = new Set(['parked', 'clash', 'dependency']);
const followed = (hold) => (Array.isArray(hold) ? hold : []).filter((h) => FOLLOWED.has(h?.why) && Array.isArray(h.by));

// holdsUpCount({ hold }) -> { [work]: how many other pieces wait on it, directly or through other work }.
export function holdsUpCount({ hold } = {}) {
  const edges = new Map(followed(hold).map((h) => [h.work, h.by]));
  const counts = {};
  for (const held of edges.keys()) {
    const seen = new Set([held]);
    const queue = [...edges.get(held)];
    while (queue.length > 0) {
      const work = queue.shift();
      if (seen.has(work)) continue;
      seen.add(work);
      counts[work] = (counts[work] ?? 0) + 1;
      queue.push(...(edges.get(work) ?? []));
    }
  }
  return counts;
}

// topCard({ hold, running, cards }) -> { card, holdsUp } | null. `running` names what is going or about to; `cards` are
// the open cards of the pieces waiting on the director, [{ id, work, rank }], oldest first, the higher `rank` the more
// important. Of those behind a hold, the highest rises, then the one holding up most, then the oldest. With nothing
// held every piece simply waits on its own card, so the highest of them all rises.
export function topCard({ hold = [], running = [], cards = [] } = {}) {
  if (running.length > 0) return null;
  const counts = holdsUpCount({ hold });
  const behind = cards.filter((c) => (counts[c.work] ?? 0) > 0);
  const best = [...(followed(hold).length > 0 && behind.length > 0 ? behind : cards)]
    .sort((a, b) => b.rank - a.rank || (counts[b.work] ?? 0) - (counts[a.work] ?? 0))[0];
  return best === undefined ? null : { card: best, holdsUp: counts[best.work] ?? 0 };
}

// noCardBehind({ hold, running, cards }) -> the holds with nothing behind them that could move: no card and no run at
// the end of any path, and no reason of a piece's own. A reservation can outlast every card by design, since nothing
// releases one by itself, so this is the only place such a hold shows.
export function noCardBehind({ hold = [], running = [], cards = [] } = {}) {
  const held = new Map((Array.isArray(hold) ? hold : []).map((h) => [h.work, h]));
  const moves = (work, seen) => {
    if (seen.has(work)) return false;
    seen.add(work);
    if (running.includes(work) || cards.some((c) => c.work === work)) return true;
    const own = held.get(work);
    if (own === undefined) return false;
    return !FOLLOWED.has(own.why) || (own.by ?? []).some((by) => moves(by, seen));
  };
  return followed(hold).filter((h) => h.by.length > 0 && !h.by.some((by) => moves(by, new Set([h.work]))));
}

// deadEnds({ hold, running, cards }) -> Map<work, why>: the pieces at the far end of noCardBehind's holds, with no hold of
// their own, each with the reason of the hold nearest it. Those are what a card has to ask about.
export function deadEnds({ hold = [], running = [], cards = [] } = {}) {
  const held = new Map((Array.isArray(hold) ? hold : []).map((h) => [h.work, h]));
  const ends = new Map();
  const walk = (work, why, seen) => {
    if (seen.has(work)) return;
    seen.add(work);
    const own = held.get(work);
    if (own === undefined) {
      if (!ends.has(work)) ends.set(work, why);
    } else if (FOLLOWED.has(own.why)) for (const by of own.by ?? []) walk(by, own.why, seen);
  };
  for (const h of noCardBehind({ hold, running, cards })) for (const by of h.by) walk(by, h.why, new Set([h.work]));
  return ends;
}

// waitsOnItself({ hold, work }) -> whether following a piece's dependency holds comes back to it, so none of them can start.
export function waitsOnItself({ hold = [], work } = {}) {
  const edges = new Map((Array.isArray(hold) ? hold : []).filter((h) => h?.why === 'dependency').map((h) => [h.work, h.by ?? []]));
  const seen = new Set();
  const queue = [...(edges.get(work) ?? [])];
  while (queue.length > 0) {
    const next = queue.shift();
    if (next === work) return true;
    if (seen.has(next)) continue;
    seen.add(next);
    queue.push(...(edges.get(next) ?? []));
  }
  return false;
}
