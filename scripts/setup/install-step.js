// scripts/setup/install-step.js
// Step 1, the install (design section 15, ruling R76). The director's own step: they paste the
// README's line, and Claude installs Wheelhouse in the project's folder and reloads, before setup
// can show any card. So the step changes nothing and shows no card: its plan settles at once with
// when it began, kept in the journal as the step's `answer` change for the timed runs (Task 18):
// { firstMessageAt, startedAt }, `startedAt` when the run started and `firstMessageAt` the
// earliest entry of a Claude Code session in this folder (its `cwd` the folder or inside it), read
// with step 5's transcript reader (scripts/setup/rules.js, folderEntries), from no earlier than
// FIRST_MESSAGE_WINDOW_MS before the run started; null when there is none. An entry without a
// time of its own is passed over. The plan reads the world and changes nothing, so the same
// transcripts and run give the same record.
import os from 'node:os';
import { SETUP_TITLES } from '../state/card-lines.js';
import { folderEntries } from './rules.js';

export const INSTALL_STEP = 1;
// How long before the run started a session's first message may be (ruling R76).
export const FIRST_MESSAGE_WINDOW_MS = 24 * 60 * 60 * 1000;

// The earliest time of an entry of a session in this folder at or after `since` (an ISO time), as
// an ISO time; null when there is none.
export function firstMessageAt(folder, { since, userHome, env = process.env } = {}) {
  const from = Date.parse(since);
  let first = null;
  for (const { entry } of folderEntries(folder, { userHome, env })) {
    const at = Date.parse(entry?.timestamp);
    if (!Number.isFinite(at) || (Number.isFinite(from) && at < from)) continue;
    if (first === null || at < first) first = at;
  }
  return first === null ? null : new Date(first).toISOString();
}

// Step 1. `env` is the environment the transcripts are found from (CLAUDE_CONFIG_DIR), for tests.
export function installStep({ env = process.env } = {}) {
  return {
    n: INSTALL_STEP,
    title: SETUP_TITLES[INSTALL_STEP],
    async plan(ctx) {
      const startedAt = typeof ctx.startedAt === 'string' ? ctx.startedAt : ctx.now().toISOString();
      const since = new Date(Date.parse(startedAt) - FIRST_MESSAGE_WINDOW_MS).toISOString();
      return { settled: { record: { firstMessageAt: firstMessageAt(ctx.folder, { since, userHome: ctx.userHome ?? os.homedir(), env }), startedAt } } };
    },
    async apply() {
      return [];
    },
  };
}
