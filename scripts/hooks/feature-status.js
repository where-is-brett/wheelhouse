// scripts/hooks/feature-status.js
// Keeps a feature session's status.json current, on PostToolUse (any tool),
// SubagentStop and Stop. In a feature worktree only (one whose root holds
// .wheelhouse/feature/brief.md), it keeps the session id for open-pr, keeps the
// ledger's rulings, then builds the status and writes it when it changed. On
// PostToolUse it does that at most once every five seconds; the last time is
// kept in .wheelhouse/feature/checked.json, since status.json is rewritten only
// on a change and so its own time can't say when the hook last looked.
// It informs: it prints nothing, and a failure anywhere is passed over.
// It never runs git; the root is found from the .git entry with fs.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runAndExit, worktreeRoot } from './kit.js';
import { featurePaths, readStatus, writeStatus } from '../feature/files.js';
import { buildStatus, captureRulings } from '../feature/status.js';

export const THROTTLE_MS = 5000;
const SMALL_BYTES = 4096;
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;

function readSmallJson(file) {
  try {
    if (fs.statSync(file).size > SMALL_BYTES) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// Written whole to a temporary name, then renamed over the real one.
function writeJson(file, value) {
  const temp = `${file}.${crypto.randomUUID().slice(0, 12)}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(value)}\n`, { flag: 'wx' });
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

// session.json holds `{ sessionId }`, rewritten only when the session changes.
function keepSession(file, sessionId) {
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return;
  if (readSmallJson(file)?.sessionId === sessionId) return;
  writeJson(file, { sessionId });
}

// Whether five seconds have passed since the hook last looked, and if so,
// marks now as the last look. A last look in the future (the clock went back)
// counts as long ago.
function due(file, nowMs) {
  const last = readSmallJson(file)?.at;
  if (Number.isFinite(last) && nowMs >= last && nowMs - last < THROTTLE_MS) return false;
  writeJson(file, { at: nowMs });
  return true;
}

// Every field but updatedAt.
function sameStatus(a, b) {
  if (a === null || b === null) return false;
  const { updatedAt: _a, ...restA } = a;
  const { updatedAt: _b, ...restB } = b;
  return JSON.stringify(restA) === JSON.stringify(restB);
}

// Each step stands alone: one that fails leaves the others to run.
function attempt(step) {
  try {
    return step();
  } catch {
    return undefined;
  }
}

export async function decide(input, { now = () => new Date(), answered } = {}) {
  const root = worktreeRoot(input.cwd);
  if (root === null) return undefined;
  const p = featurePaths(root);
  try {
    if (!fs.statSync(p.brief).isFile()) return undefined;
  } catch {
    return undefined;
  }
  attempt(() => keepSession(p.session, input.session_id));
  if (input.hook_event_name === 'PostToolUse' && attempt(() => due(path.join(p.dir, 'checked.json'), now().getTime())) === false) return undefined;
  attempt(() => captureRulings({ worktree: root }));
  attempt(() => {
    const next = buildStatus({ worktree: root, now, ...(answered ? { answered } : {}) });
    if (!sameStatus(readStatus(p.status), next)) writeStatus(p.status, next);
  });
  return undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // One script on three events: decide reads the event from the input.
  await runAndExit(decide, { failClosed: false, event: null });
}
