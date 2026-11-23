// scripts/desk/vocabulary.js
// The desk interface's vocabulary, `desk/1` (spec 5.2). Every front end reads and changes
// Wheelhouse with these names and no others; a new name is a new version.

export const DESK_VERSION = 'desk/1';

export const VIEWS = Object.freeze(['glance', 'briefing', 'logbook', 'waiting', 'card', 'work', 'settings', 'usage', 'preview', 'why', 'survey']);

export const COMMANDS = Object.freeze(['answer', 'suggest', 'not-now', 'request', 'set', 'all-stop', 'lift-all-stop', 'pair', 'safekeeping', 'pull-cards']);

export const WATCH_EVENTS = Object.freeze(['card-added', 'card-closed', 'glance-changed', 'work-changed', 'all-stop', 'notice']);

// The acts that decide nothing, so need no evidence that the director made them: a request is
// queued for the First Mate, putting a card off decides nothing, and stopping must always be easy.
// `pair` only asks: it raises a card, and the director's click on it is the decision (Task 10).
// Pulling the cards past the day's budget only brings them up.
export const NO_EVIDENCE = Object.freeze(['request', 'not-now', 'all-stop', 'pull-cards']);

export function needsEvidence(command) {
  return !NO_EVIDENCE.includes(command) && command !== 'pair';
}
