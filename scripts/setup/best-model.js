// scripts/setup/best-model.js
// The model the front desk runs on (design section 8). By the director's ruling of 24 October 2026
// it is Claude Code's most capable model short of the strongest, which Claude Code's alias `opus`
// names, pinned by setup with no question. The strongest, which its alias `best` names, is never a
// default: it waits for the director's own opt-in, which comes with the Thoroughness design, so
// nothing in setup asks for it yet. Wheelhouse names no model itself, so setup asks Claude Code once
// what the alias stands for on this computer and pins the full name it gives in the project's
// routing table (`routing.frontDesk`); the pin moves only after the evaluation passes on a new
// model (section 9.1), never by the alias moving on its own.
//
// It starts one `claude -p` with `--model <alias>` in a scratch folder, asking for a one-word
// reply, and reads the model from its init event. Only the project's settings of that empty folder
// load, so none of the director's plugins or hooks run.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run as realRun } from '../lib/run.js';
import { resolveClaude, invocation, withoutHostVariables } from '../lib/claude.js';
import { isModelName } from '../gate/guardrails.js';

// Claude Code's alias for the front desk's model.
export const FRONT_DESK_ALIAS = 'opus';
// Claude Code's alias for its strongest model, for the director's opt-in once it is designed.
export const STRONGEST_ALIAS = 'best';
// How long Claude Code may take to start and say which model it runs on.
export const ALIAS_WAIT_MS = 60 * 1000;

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

// The full name `alias` stands for on this computer, or null when Claude Code can't be started,
// isn't signed in or gives no name that could be passed to it. `run` and `claude` are for tests.
export async function aliasModel(alias, { run = realRun, claude = () => resolveClaude(), timeoutMs = ALIAS_WAIT_MS } = {}) {
  let resolved;
  try {
    resolved = claude();
  } catch {
    return null;
  }
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-best-'));
  try {
    const call = invocation(resolved, [], ['--model', alias, '--max-turns', '1', '--output-format', 'stream-json', '--verbose', '--setting-sources', 'project', '--strict-mcp-config'], 'Reply with the word ok.');
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
    return isModelName(model) && model !== alias ? model : null;
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
}
