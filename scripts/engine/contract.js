// scripts/engine/contract.js
// What the core asks of a build engine, and nothing about any one engine (spec 6.1). An adapter is an object with
// the methods in METHODS; the events it reports are the normalised EngineEvents checked by checkEvent. The core
// never reads an engine's own words, only these.
//
//   health() -> { ok, findings: string[] }
//   start(order) -> { ok: true, runId } | { ok: false, refused }
//   watch(cursor) -> { events: EngineEvent[], cursor }       (follow(cursor) is the same as an async iterator)
//   act(runId, { answer: { ask, choice, words? } } | { cancel: { reason } } | { resume: {} }) -> { ok } | { ok: false, refused }
//     (`unreachable: true` beside a refusal when the engine gave no reply at all, so the caller may try again)
//   inspect(runId) -> { status, steps: [{ id, role, provider, model, tokens, dollars, minutes, source }], branch, pr, digest }
//   stopAll(reason, { beforeCancel(runs: [{ id, folder }]) }?) -> { cancelled: string[], survivors: string[], paused: string[] }
//
// Beside the interface, for the helper's continuation host (host.js): `name`, the engine's name for the record, and
// wakeCommand() -> { command, args, env }, the process that carries answered runs on; and, for All stop (stop.js),
// ownsProcess(command) -> boolean, whether a process as `ps` lists it is the engine's own.

export const METHODS = Object.freeze(['health', 'start', 'watch', 'act', 'inspect', 'stopAll']);
export const ENGINE_EVENTS = Object.freeze(['run-started', 'step-finished', 'ask', 'ask-resolved', 'run-ended']);
export const ASK_KINDS = Object.freeze(['question', 'approval', 'blocked', 'usage-limit', 'trouble']);
// Where a figure for spend came from. An engine that can't say gives 'unknown', with null figures: never zero.
export const SPEND_SOURCES = Object.freeze(['reported', 'estimated', 'unknown']);

// The names of the methods `adapter` lacks.
export function checkEngine(adapter) {
  return METHODS.filter((name) => typeof adapter?.[name] !== 'function');
}

const isText = (value) => typeof value === 'string' && value !== '';
const isFigure = (value) => value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);

// Why `event` isn't a well-formed EngineEvent, in plain words, or null when it is.
export function checkEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return 'An engine event must be an object';
  if (!ENGINE_EVENTS.includes(event.type)) return `An engine event has an unknown type: ${event.type}`;
  if (!isText(event.runId)) return `A ${event.type} event needs a run id`;
  if (!isText(event.at) || Number.isNaN(Date.parse(event.at))) return `A ${event.type} event needs the time it happened`;
  if (event.type === 'step-finished') {
    if (!isText(event.step)) return 'A step-finished event needs the step';
    if (!isText(event.role)) return 'A step-finished event needs the step\'s role';
    const spend = event.spend;
    if (!spend || typeof spend !== 'object') return 'A step-finished event needs its spend';
    if (!SPEND_SOURCES.includes(spend.source)) return `Spend has an unknown source: ${spend.source}`;
    if (!isFigure(spend.tokens) || !isFigure(spend.dollars)) return 'Spend figures must be null or a number of zero or more';
    if (spend.source === 'unknown' && (spend.tokens !== null || spend.dollars !== null)) {
      return 'Unknown spend must have null tokens and dollars, never zero';
    }
  } else if (event.type === 'ask') {
    if (!isText(event.id)) return 'An ask event needs an id';
    if (!ASK_KINDS.includes(event.kind)) return `An ask event has an unknown kind: ${event.kind}`;
    if (!Array.isArray(event.options)) return 'An ask event needs its options';
    if (event.options.some((o) => !isText(o?.id) || !isText(o?.label))) return 'Each option of an ask needs an id and a label';
  } else if (event.type === 'ask-resolved') {
    if (!isText(event.id)) return 'An ask-resolved event needs the id of the ask';
  } else if (event.type === 'run-ended') {
    if (!isText(event.outcome)) return 'A run-ended event needs the outcome';
  }
  return null;
}
