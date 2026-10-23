// scripts/setup/best-model.js
// The model the front desk runs on (design section 8): the most capable model, which Claude Code's
// own alias `best` names. Wheelhouse names no model itself, so setup asks Claude Code once what the
// alias stands for on this computer and pins the full name it gives in the project's routing table
// (`routing.frontDesk`); the pin moves only after the evaluation passes on a new model (section
// 9.1), never by the alias moving on its own.
//
// It starts one `claude -p` with `--model best` in a scratch folder, asking for a one-word reply,
// and reads the model from its init event. Only the project's settings of that empty folder load,
// so none of the director's plugins or hooks run.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run as realRun } from '../lib/run.js';
import { resolveClaude, invocation, withoutHostVariables } from '../lib/claude.js';
import { isModelName } from '../gate/guardrails.js';

// Claude Code's alias for its most capable model.
export const BEST = 'best';
// How long Claude Code may take to start and say which model it runs on.
export const BEST_WAIT_MS = 60 * 1000;

// The model in the first init event of `stdout`, a stream of JSON lines, or null.
export function initModel(stdout) {
  for (const line of String(stdout ?? '').split('\n')) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event?.type === 'system' && event.subtype === 'init') return typeof event.model === 'string' ? event.model : null;
  }
  return null;
}

// The full name `best` stands for on this computer, or null when Claude Code can't be started,
// isn't signed in or gives no name that could be passed to it. `run` and `claude` are for tests.
export async function bestModel({ run = realRun, claude = () => resolveClaude(), timeoutMs = BEST_WAIT_MS } = {}) {
  let resolved;
  try {
    resolved = claude();
  } catch {
    return null;
  }
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-best-'));
  try {
    const call = invocation(resolved, [], ['--model', BEST, '--max-turns', '1', '--output-format', 'stream-json', '--verbose', '--setting-sources', 'project', '--strict-mcp-config'], 'Reply with the word ok.');
    let got;
    try {
      got = await run(call.file, call.args, {
        cwd: folder, input: call.input, baseEnv: withoutHostVariables(process.env), timeoutMs, limit: 256 * 1024,
        ...(call.verbatim ? { windowsVerbatimArguments: true } : {}),
      });
    } catch {
      return null;
    }
    const model = initModel(got?.stdout);
    return isModelName(model) && model !== BEST ? model : null;
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
}
