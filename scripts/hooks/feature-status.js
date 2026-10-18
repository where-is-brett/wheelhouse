// scripts/hooks/feature-status.js
// Keeps a feature session's status.json current, on PostToolUse (any tool),
// SubagentStop and Stop. It acts in a feature worktree only: one whose
// `.wheelhouse` and `.wheelhouse/feature` are real folders inside it, whose
// brief can be read, and whose branch is `feature/<the brief's work>`.
// Anywhere else it does nothing and writes nothing.
//
// In a feature worktree it keeps the session id for open-pr; keeps the
// ledger's rulings at every SubagentStop and Stop, and on PostToolUse whenever
// the ledger's size or time has moved; and builds the
// status, writing it when it changed. On PostToolUse the status is built at
// most once every five seconds. The time of the last build and the ledger's
// stamp are kept in .wheelhouse/feature/checked.json: status.json is rewritten
// only on a change, so its own time can't say when the hook last looked.
//
// It informs: it prints nothing, and a failure anywhere is passed over. Every
// write refuses a symlink. It never runs git; the root is found with fs.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runAndExit, worktreeRoot } from './kit.js';
import { featureSlug } from './session-start.js';
import { featurePaths, readStatus, writeStatus } from '../feature/files.js';
import { buildStatus, captureRulings, findLedger, loadFeature, readBrief, readCapped, safeFeatureFolder, writeWhole, SMALL_BYTES } from '../feature/status.js';

export const THROTTLE_MS = 5000;
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;

const checkedFile = (p) => path.join(p.dir, 'checked.json');

function readSmallJson(file) {
  try {
    return JSON.parse(readCapped(file, SMALL_BYTES) ?? 'null');
  } catch {
    return null;
  }
}

const writeJson = (file, value) => writeWhole(file, `${JSON.stringify(value)}\n`);

// The worktree's root and brief when `cwd` is in a feature worktree; null otherwise.
export function featureWorktree(cwd) {
  const root = worktreeRoot(cwd);
  if (root === null || !safeFeatureFolder(root)) return null;
  let brief;
  try {
    brief = readBrief(root);
  } catch {
    return null;
  }
  return featureSlug(root) === brief.work ? { root, brief } : null;
}

// session.json holds `{ sessionId }`, rewritten only when the session changes.
function keepSession(file, sessionId) {
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return;
  if (readSmallJson(file)?.sessionId === sessionId) return;
  writeJson(file, { sessionId });
}

// A last build in the future (the clock went back) counts as long ago.
const recent = (last, nowMs) => Number.isFinite(last) && nowMs >= last && nowMs - last < THROTTLE_MS;

// Each step stands alone: one that fails leaves the others to run.
function attempt(step) {
  try {
    return step();
  } catch {
    return undefined;
  }
}

// Every field but updatedAt.
function sameStatus(a, b) {
  if (a === null || b === null) return false;
  const { updatedAt: _a, ...restA } = a;
  const { updatedAt: _b, ...restB } = b;
  return JSON.stringify(restA) === JSON.stringify(restB);
}

export async function decide(input, { now = () => new Date(), answered, slice } = {}) {
  const found = featureWorktree(input.cwd);
  if (found === null) return undefined;
  const { root, brief } = found;
  const p = featurePaths(root);
  attempt(() => keepSession(p.session, input.session_id));

  const nowMs = now().getTime();
  const checked = readSmallJson(checkedFile(p));
  const before = checked !== null && typeof checked === 'object' && !Array.isArray(checked) ? checked : {};
  const ledger = attempt(() => findLedger(root, brief.plan)) ?? null;
  const stamp = ledger ? { file: path.relative(root, ledger.file), size: ledger.size, mtimeMs: ledger.mtimeMs } : null;
  const moved = JSON.stringify(before.ledger ?? null) !== JSON.stringify(stamp);
  // Two runs at once may leave the stamp of a ledger whose rulings the other
  // run's older rewrite lost. Rewriting is idempotent, so every stop captures
  // anyway, and a ruling is never missing for longer than a turn.
  const capture = moved || input.hook_event_name !== 'PostToolUse';
  const due = input.hook_event_name !== 'PostToolUse' || !recent(before.at, nowMs);
  if (!capture && !due) return undefined;

  // The brief and the ledger, read once for both steps.
  const feature = attempt(() => loadFeature(root, { brief, ledger }));
  if (!feature) return undefined;
  const after = { ...before };
  if (capture && attempt(() => (captureRulings({ worktree: root, feature }), true))) after.ledger = stamp;
  if (due) {
    attempt(() => {
      const next = buildStatus({ worktree: root, now, feature, ...(answered ? { answered } : {}), ...(slice ? { slice } : {}) });
      if (!sameStatus(readStatus(p.status), next)) writeStatus(p.status, next);
    });
    after.at = nowMs;
  }
  attempt(() => writeJson(checkedFile(p), after));
  return undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // One script on three events: decide reads the event from the input.
  await runAndExit(decide, { failClosed: false, event: null });
}
