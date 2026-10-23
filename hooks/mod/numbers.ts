// hooks/mod/numbers.ts
// The mod's copies of the numbers and words it needs, named once here. The mod can't import
// scripts/, so tests/scripts/mod/validate.test.js keeps each in step with scripts/lib/mod-numbers.js
// and scripts/mod/bridge.js.

// The id of the side pane the mod draws.
export const PANE_ID = 'wheelhouse'
// How often the front desk's pane ticks.
export const TICK_MS = 15000
// How many ticks a pane may go unanswered before it says it is out of date.
export const STALE_TICKS = 3
// The bridge's own limit on a request, and on a Shape 2 foreman's tick.
export const BRIDGE_MS = 5000
export const WATCH_BRIDGE_MS = 45000
// How long a change can be undone (UNDO_MS in scripts/lib/mod-numbers.js).
export const UNDO_MS = 60000
// The words every prompt the pane submits starts with.
export const PANE_LEAD = 'Wheelhouse pane:'
// A message from a Wheelhouse session starts with this.
export const MESSAGE_LEAD = /^Wheelhouse(?: [a-z]+)?:/
// The foreman's lead (FOREMAN_PROMPT_LEAD in scripts/foreman/start.js). It matches MESSAGE_LEAD,
// but a prompt it leads is never traffic: the foreman talks to no one.
export const FOREMAN_LEAD = 'Wheelhouse foreman:'
// How long the mod waits for the bridge: its limit and the time node takes to start. A tick can't
// tell a foreman's from a front desk's before the answer, so every tick waits a foreman's time.
export const ASK_MS = BRIDGE_MS + 1500
export const TICK_ASK_MS = WATCH_BRIDGE_MS + 5000
// The Calm interface's set words (scripts/lib/calm-words.js), written as the pane says them.
export const STOP_HALTS = 'Halts every builder at once.'
export const ONLY_YOU_LIFT = 'Only you can lift it.'
export const NOTHING_NEEDS_YOU = 'Nothing needs you.'
export const RECORDING = 'Recording…'
export const WHY = 'Why?'
export const HIDE_WHY = 'Hide why'
export const SHOW_ME = 'Show me'
export const WHAT_CHANGED = 'What changed:'
export const SUGGEST = 'Suggest a change…'
export const WHAT_WOULD_YOU_CHANGE = 'What would you change?'
export const SENT_TO_FRONT_DESK = 'Sent to the front desk. A new proposal will follow.'
export const NOT_HANDED = 'That didn\'t reach the front desk. Type it in the chat instead.'
export const NOT_HERE = 'This pane lives in the front desk\'s chat. Type /wheelhouse there.'
export const NOT_RECORDED = 'That wasn\'t recorded. Try again, or type it in the chat.'
export const SETTING_UP = 'Setup is still running. This pane opens when it finishes.'
// The line shown when the latest state could not be read: when it failed and which reading is shown.
export const staleLine = (failedAt: string, shownAt: string) => `Couldn't read the latest at ${failedAt}. Showing ${shownAt}'s.`
// The note for a suggestion made at a time (hh:mm).
export const suggestedAt = (hhmm: string) => `You suggested a change at ${hhmm}. A new proposal is on its way, and nothing goes live meanwhile.`
// The note under a card's buttons where the pane has no box to type in (the phone): the change goes in the chat.
export const typeYourChange = (n: number | string) => `Type your change in the chat, and I'll know it's about card ${n}.`
