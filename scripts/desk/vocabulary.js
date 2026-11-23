// scripts/desk/vocabulary.js
// The desk interface's vocabulary, `desk/1` (spec 5.2). Every front end reads and changes
// Wheelhouse with these names and no others. A name removed, renamed or changed in meaning is a new version;
// a name added is not (`unpair` and `ask-here` were added to desk/1, and a watch may carry evidence).

export const DESK_VERSION = 'desk/1';

export const VIEWS = Object.freeze(['glance', 'briefing', 'logbook', 'waiting', 'card', 'work', 'settings', 'usage', 'preview', 'why', 'survey']);

export const COMMANDS = Object.freeze(['answer', 'suggest', 'not-now', 'request', 'set', 'all-stop', 'lift-all-stop', 'pair', 'safekeeping', 'pull-cards', 'unpair', 'ask-here']);

export const WATCH_EVENTS = Object.freeze(['card-added', 'card-closed', 'glance-changed', 'work-changed', 'all-stop', 'notice']);

// The acts that decide nothing, so need no evidence that the director made them: a request is
// queued for the First Mate, putting a card off decides nothing, and stopping must always be easy.
// `pair` only asks: it raises a card, and the director's click on it is the decision (Task 10). `unpair` asks the
// same way: it raises the Unpair card, and the director's signed Unpair it removes the key.
// Pulling the cards past the day's budget only brings them up.
export const NO_EVIDENCE = Object.freeze(['request', 'not-now', 'all-stop', 'pull-cards', 'unpair']);

export function needsEvidence(command) {
  return !NO_EVIDENCE.includes(command) && command !== 'pair';
}
