// scripts/decisions/log.js
// The decision log (design section 5 of the director's way of working): every call a session makes on its own side of the
// decision line is one line in the piece's own log, decisions.jsonl in its feature folder, and then one `agent-call` event in
// the project's record (scripts/feature/status.js, captureCalls), because the worktree is removed after the merge.
//   readLog(worktree)             the calls the piece has logged, oldest first
//   appendCall(...)               the feature command `log`: adds one line, refusing a call on the director's side
//   callsFrom, projectCalls       the calls in the project's record (scripts/decisions/calls.js)
import fs from 'node:fs';
import { featurePaths, readCalls } from '../feature/files.js';
import { readCapped, safeFeatureFolder, writeWhole } from '../feature/status.js';
import { AGENT_KINDS, sideOf } from './line.js';

export { callsFrom, projectCalls } from './calls.js';

const LOG_BYTES = 8 * 1024 * 1024;

// Whether anything is at `file`, a link included.
function exists(file) {
  try {
    fs.lstatSync(file);
    return true;
  } catch {
    return false;
  }
}

// What `log` says to a session that tries to log a call the director decides.
export const asDirectorsCall = (kind) => `"${kind}" is the director's to decide, not a call to log. Ask instead: \`ask --about ${kind} --level 3 …\`, with two or more options and your recommendation. A kind you can't place is the director's too. The agents' own kinds are: ${AGENT_KINDS.join(', ')}.`;

// The calls the piece's log holds, oldest first, as `{ v, at, decided, options, why, kind }`. A line that is not a call is passed over.
export function readLog(worktree) {
  return readCalls(featurePaths(worktree).decisions, { maxBytes: LOG_BYTES }).calls;
}

// Adds one line to the piece's log, with the time, and returns it. The call is refused when its kind is not one of the
// agents' (so a director's kind, and a kind this doesn't know, both say to ask instead), when it holds fewer than two
// options, or when a part is missing. `fail(message)` throws the error the caller says to the session.
export function appendCall({ worktree, decided, options, why, kind, now = () => new Date(), fail }) {
  const text = (value, name) => {
    if (typeof value !== 'string' || value.trim() === '') fail(`--${name} is needed`);
    return value.trim();
  };
  const what = text(decided, 'decided');
  const because = text(why, 'why');
  const side = text(kind, 'kind');
  if (sideOf(side) !== 'agent') fail(asDirectorsCall(side));
  const seen = (options ?? []).map((o) => (typeof o === 'string' ? o.trim() : ''));
  if (seen.length < 2 || seen.includes('')) fail('Give the options you saw, two or more, each with --option "<what it was>"');
  if (new Set(seen).size !== seen.length) fail('Each option is different');
  if (!safeFeatureFolder(worktree)) fail("The feature's folder isn't a real folder inside this worktree");
  const file = featurePaths(worktree).decisions;
  const kept = readCapped(file, LOG_BYTES);
  // A file that is there but can't be read (a link, a folder, too big) must not be replaced.
  if (kept === null && exists(file)) fail("decisions.jsonl can't be added to");
  const before = kept ?? '';
  const call = { v: 1, at: now().toISOString(), decided: what, options: seen, why: because, kind: side };
  const lead = before === '' || before.endsWith('\n') ? '' : '\n';
  writeWhole(file, `${before}${lead}${JSON.stringify(call)}\n`);
  return call;
}
