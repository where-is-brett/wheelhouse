// scripts/engine/reproduction.js
// The bug lane's reproduction (Archon design, section 7.2): the reproduce step's output gives one done check that is
// red while the bug is there, a test (run with the order's test command) or a command that ends 0 once the bug is
// gone, and the test files that hold it. The helper keeps it from the engine's own record, never from a file.
import { isTestFile } from './test-guard.js';

// The most product files a bug's fix changes: more is a small change.
export const MOST_FILES = 5;
// The most test files a reproduction adds or changes.
export const MOST_TEST_FILES = 3;
// The bug lane's build rounds, as the quick lane's.
export const BUG_ROUNDS = 5;

const MOST_TEST_CHARS = 200;
const MOST_COMMAND_CHARS = 400;

const parsed = (text) => { try { return JSON.parse(text); } catch { return null; } };
const oneLine = (value, most) => typeof value === 'string' && value.trim() !== '' && value.length <= most && !/[\r\n]/.test(value);
// A path git reads as itself: no pathspec magic (`:!`, `:(exclude)`) and no glob, which could leave the test out of the
// check that it is unchanged.
const isPlainPath = (file) => typeof file === 'string' && file !== '' && !file.startsWith('/') && !file.startsWith('-')
  && !file.startsWith(':') && !/[\\*?[\]]/.test(file) && !file.split('/').includes('..') && isTestFile(file);

// The reproduction in the reproduce step's output (its text, as the engine kept it), or null when there is none.
export function readReproduction(text) {
  const output = typeof text === 'string' ? parsed(text) : null;
  if (!output || typeof output !== 'object' || output.blocked === true) return null;
  const hasTest = output.test !== undefined;
  const hasCommand = output.command !== undefined;
  if (hasTest === hasCommand) return null;
  if (hasTest && !oneLine(output.test, MOST_TEST_CHARS)) return null;
  if (hasCommand && !oneLine(output.command, MOST_COMMAND_CHARS)) return null;
  const { files } = output;
  if (!Array.isArray(files) || files.length === 0 || files.length > MOST_TEST_FILES || !files.every(isPlainPath)) return null;
  return { check: hasTest ? { test: output.test } : { command: output.command, expect: 0 }, files: [...files] };
}

// Whether two reproductions (or two checks alone) are the same.
export function sameReproduction(a, b) {
  if (!a || !b) return false;
  const checkOf = (r) => (r.check ? r.check : r);
  const ca = checkOf(a);
  const cb = checkOf(b);
  if (ca.test !== cb.test || ca.command !== cb.command || ca.expect !== cb.expect) return false;
  if (a.check && b.check) return JSON.stringify(a.files) === JSON.stringify(b.files);
  return true;
}
