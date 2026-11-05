// scripts/lib/by-hand-tie.js
// Whether a signed by-hand tie already names a work for a change at a commit: the helper's own carry-on of a change made by
// hand is then done, and is not done again. An event that is not signed by an enrolled computer is no tie.
export function tieNamesWork(events, number, head, signed) {
  return events.some((e) => e.kind === 'by-hand' && e.data?.n === number && e.data.head === head && typeof e.data.work === 'string' && signed(e) === true);
}
