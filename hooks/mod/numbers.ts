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
