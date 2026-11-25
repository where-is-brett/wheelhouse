// scripts/lib/seat-writes.js
// The front desk's commands that write a record, hand out a card or change the board: only the window that holds the First
// Mate's seat runs them (scripts/frontdesk/cli.js), and on an agent whose hooks only read each must name the chat's own
// session (scripts/hooks/front-desk-writes.js). Settings change through `record` and `suggest`, so they are covered. The rest only
// read, or keep a note by the session's own id.
export const SEAT_WRITES = Object.freeze(['cards', 'pull-cards', 'again', 'card', 'record', 'suggest', 'pull-back', 'drop', 'ask-bosun', 'undo', 'move', 'carry-on', 'archive', 'restore', 'premium-card', 'foreman-card', 'page', 'helm']);
