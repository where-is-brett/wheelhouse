// adapters/copilot/safety-line.js
// What Copilot can't promise, in plain sentences, for the board's health line, the full board view and the data
// note (design section 3.6). Each line is one line and none ends in a full stop. It imports only the design's
// numbers, so the board can read it without loading the adapter.
import { C6_PASSED, GUARD_DEADLINE_MS, GUARD_TIMEOUT_SEC, REVIEW_SESSION_READY } from '../../scripts/agents/copilot/numbers.js';

// Copilot lets one action through when its guard runs past the time-out, which is why every guard answers sooner.
const GUARD_HANG = `Copilot lets an action through if its guard runs past ${GUARD_TIMEOUT_SEC} seconds, so every guard answers within ${GUARD_DEADLINE_MS / 1000} seconds or refuses`;
const APPROVALS = 'Approvals in Copilot\'s chat aren\'t proven until check C6 passes; the steps that matter most are confirmed in Wheelhouse\'s own window';
const REVIEWS = 'Second looks at a change by Copilot aren\'t proven until the clean reviewer passes its check; until then they go to Claude Code\'s reviewer';
const LOCKED = 'Copilot doesn\'t offer Locked';
const WINDOWS = 'On Windows there is no sandbox, so builds run at Standard with Guarded build commands';

// safetyLine({ platform, approvalsProven, reviewsProven }) -> string[]
//   platform         the system, as process.platform names it
//   approvalsProven  whether check C6 has passed (default: the design's switch)
//   reviewsProven    whether the clean reviewer has passed its check (default: the design's switch)
// Each of the design's items that applies, most important first. The Windows item applies on Windows alone.
export default function safetyLine({ platform = process.platform, approvalsProven = C6_PASSED, reviewsProven = REVIEW_SESSION_READY } = {}) {
  return [
    GUARD_HANG,
    ...(approvalsProven === true ? [] : [APPROVALS]),
    ...(reviewsProven === true ? [] : [REVIEWS]),
    LOCKED,
    ...(platform === 'win32' ? [WINDOWS] : []),
  ];
}

// The board's line while Copilot has a tool Wheelhouse doesn't know (ruling P5-19, Review Focus 1): such a tool
// is refused, so a Copilot update is waiting on Wheelhouse.
export function updateWaiting(name) {
  return `Copilot has a tool Wheelhouse doesn't know yet, \`${name}\`: it is refused until Wheelhouse is updated`;
}
