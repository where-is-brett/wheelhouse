// scripts/lib/mod-numbers.js
// The mod's numbers and words, named once. The foreman's own lead is FOREMAN_PROMPT_LEAD in
// scripts/foreman/start.js, and the scripts import it from there. The mod can't import scripts/,
// so it holds a copy, FOREMAN_LEAD in hooks/mod/numbers.ts, with copies of the numbers here it
// needs; tests/scripts/mod/validate.test.js keeps each copy in step (ruling 27).

// The id of the side pane the mod draws.
export const PANE_ID = 'wheelhouse';
// How often the front desk's pane and courier tick.
export const TICK_MS = 15000;
// How often a Shape 2 foreman's watcher loop runs, as the watcher's own state interval.
export const FOREMAN_TICK_MS = 30000;
// How often a Shape 1 check runs that the watcher is still running.
export const WATCH_EVERY_MS = 60000;
// The limit on one Shape 2 loop, answered inside the bridge.
export const WATCH_BRIDGE_MS = 45000;
// The least time between two courier wakes.
export const COURIER_GAP_MS = 10 * 60 * 1000;
// How long after a card's wake the courier wakes once more while the card waits unasked.
export const REMIND_MS = 5 * 60 * 1000;
// How many characters of a card's SHA-256 name the card in a press.
export const CARD_HASH_CHARS = 12;
// The most lines the pane shows of what is being built.
export const PANE_LINES = 5;
// How many ticks a pane may go unanswered before it says it is out of date.
export const STALE_TICKS = 3;
// How long after a setting's change was confirmed the pane still offers Undo on its row.
export const UNDO_MS = 60000;
// The words every prompt the mod submits starts with.
export const LEADS = Object.freeze({ pane: 'Wheelhouse pane:', courier: 'Wheelhouse courier:' });
// A message from a Wheelhouse session starts with this.
export const MESSAGE_LEAD = /^Wheelhouse(?: [a-z]+)?:/;
// When the director counts as away: hours without a message, and the evening and morning edges.
export const AWAY = Object.freeze({ hours: 2, evening: '18:00', morning: '09:00' });
