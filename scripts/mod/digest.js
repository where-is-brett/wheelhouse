// scripts/mod/digest.js
// /digest: the briefing since the last one, as text, with no turn of the model's. The mod
// registers the command and shows the bridge's text as its answer. The briefing is built as the
// board-context hook builds it after a gap (briefingIn), from the board read offline and the
// settings in force, so it is within the words the briefing setting gives and goes through the
// glossary's plain words. Giving it marks the briefing given (briefedAt), so the next one starts
// from it, and marks as raised the unusual use it showed. It leaves the director's last message
// (promptAt) alone: a command is not a message to the front desk.
import { loadBoardInputs } from '../board/inputs.js';
import { briefingIn } from '../hooks/board-context.js';
import { briefingModel as realBriefingModel } from '../briefing/model.js';
import { readSeen, markSeen } from '../briefing/seen.js';
import { markRaised as realMarkRaised } from '../usage/figures.js';
import { effectiveFor } from './settings-pane.js';
import { CONTEXT_CHARS } from '../lib/core-numbers.js';

export const FIRST_LINE = 'Wheelhouse\'s briefing';
export const UNBUILT = 'Wheelhouse couldn\'t put the briefing together this time';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function attempt(read, fallback = null) {
  try {
    return read();
  } catch {
    return fallback;
  }
}

// digestText({ cwd, now }) -> { ok, text }. Never throws. `load`, `readEffective`, `briefingModel`
// and `markRaised` stand in for the real ones in tests.
export async function digestText({
  cwd, now = () => new Date(), load = loadBoardInputs, readEffective = effectiveFor,
  briefingModel = realBriefingModel, markRaised = realMarkRaised,
} = {}) {
  try {
    const at = attempt(() => new Date(typeof now === 'function' ? now() : now), new Date(NaN));
    const inputs = await load({ cwd, now: () => at, offline: true });
    if (isRecord(inputs) && typeof inputs.none === 'string') return { ok: false, text: inputs.none };
    if (!isRecord(inputs) || typeof inputs.project !== 'string' || !isRecord(inputs.model)) return { ok: false, text: UNBUILT };
    const { project, model, usage, sources } = inputs;
    // An offline reading holds no settings, so they are read from the views on disk.
    const settings = readEffective({ project, now: () => at });
    const since = readSeen(project, { now: at }).briefedAt;
    const given = briefingIn({
      project, model, usage, sources, settings, since, at, briefingModel, room: CONTEXT_CHARS - FIRST_LINE.length - 2,
    });
    attempt(() => markSeen(project, { briefedAt: at }));
    if (given.raise.length > 0 && Number.isFinite(at.getTime())) attempt(() => markRaised(given.raise, { now: at }));
    return { ok: true, text: `${FIRST_LINE}\n\n${given.text}` };
  } catch {
    return { ok: false, text: UNBUILT };
  }
}
