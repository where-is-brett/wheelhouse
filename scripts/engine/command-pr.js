// scripts/engine/command-pr.js
// The helper's own change that puts the command the finder found on the default branch (spec 4.2): one commit in its own
// mirror, adding `testCommand` and its `checks.prepare` to the project's configuration and nothing else. It is the one
// guardrail change no one approves, since no agent wrote it, and that holds only while it is exactly that, so the gate
// compares it with what the record keeps. It needs its check, the lock and the rest of the gate. After it, any change to
// the command is an ordinary guardrail change for the director.
import { readConfig } from '../gate/guardrails.js';

export const CONFIG_FILE = '.claude/wheelhouse.json';
export const COMMAND_BRANCH = /^wheelhouse-test-command-[0-9a-f]{12}$/;
export const COMMAND_WORK = 'checks-command';
export const COMMAND_TITLE = 'Name the project\'s test command';
export const commandBranch = (base) => `wheelhouse-test-command-${base.slice(0, 12)}`;
export const COMMAND_BODY = 'This names the command that runs the project\'s tests, which Wheelhouse found by itself, and which passed on this computer on the main line.';

const parsed = (text) => {
  try { return JSON.parse(text); } catch { return null; }
};

// The configuration `base` (its text, or null with none) with the command in it.
export function commandText(base, { testCommand, prepare }) {
  const config = base === null ? readConfig(null) : JSON.parse(base);
  const checks = prepare ? { ...config.checks, prepare } : config.checks;
  return `${JSON.stringify({ ...config, testCommand, ...(checks ? { checks } : {}) }, null, 2)}\n`;
}

// commandChange({ headRef, paths, files, found }) -> { matched: false } | { matched: true, ok, why? }. Whether a pull request is
// this one: on its branch, changing only the configuration, to exactly what `commandText` gives for the command the
// record keeps, on a base that names none. `files` is the merge gate's read of each file, { base, head, headMode }.
export function commandChange({ headRef, paths, files, found }) {
  if (typeof headRef !== 'string' || !COMMAND_BRANCH.test(headRef)) return { matched: false };
  const no = (why) => ({ matched: true, ok: false, why });
  if (!Array.isArray(paths) || paths.length !== 1 || paths[0] !== CONFIG_FILE) return no('it changes more than the project\'s configuration');
  if (!found) return no('no command is kept for this project');
  const read = files?.[CONFIG_FILE];
  if (read?.headMode !== '100644') return no('its configuration isn\'t a plain file');
  const base = read.base === null ? readConfig(null) : parsed(read.base);
  if (base === null || base.testCommand !== undefined) return no('the default branch already names a command');
  const want = parsed(commandText(read.base, found));
  const got = parsed(read.head);
  return JSON.stringify(got) === JSON.stringify(want) ? { matched: true, ok: true } : no('it isn\'t the text Wheelhouse writes');
}
