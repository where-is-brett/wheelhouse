// scripts/hooks/protected-tests.js
// Before each file or shell tool in a build engine's step (Archon design, section 11): refuses an edit that deletes a
// test file or adds a marker that skips a test, unless the run's work order lists that file. The order comes from the
// helper by the step's own run (WHEELHOUSE_RUN_ID's source, ownRun: the run Archon gave the step's process, never a
// file an agent wrote). Outside an engine run it does nothing. The check step before review
// (scripts/engine/protected-check.js) compares the whole change as well, so a test loosened some other way is
// still found.
import fs from 'node:fs';
import path from 'node:path';
import { answer, runAndExit, worktreeRoot } from './kit.js';
import { segments } from './shell-words.js';
import { ownRun } from '../protection/archon.js';
import { helperClient } from '../host/helper-client.js';
import { isTestFile, skipCount, listed } from '../engine/test-guard.js';
import { startedAsScript } from '../lib/started-as-script.js';

const WRITING = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];
const SHELL = ['Bash', 'PowerShell'];
// The shell commands that take a file away.
const REMOVERS = new Set(['rm', 'unlink', 'trash', 'del', 'erase', 'Remove-Item', 'ri']);

const DELETES = (file) => `Wheelhouse does not let a build step delete the test ${file}: the work order doesn't list it. Change the code so the test passes, or take the blocked exit and say why the test is wrong`;
const SKIPS = (file) => `Wheelhouse does not let a build step skip a test in ${file}: the work order doesn't list it. Make the test pass, or take the blocked exit and say why it should be skipped`;
const NO_ORDER = 'Wheelhouse could not read this run\'s work order from the helper, so it can\'t tell whether this test may change. Try again; if it keeps happening, take the blocked exit';

const read = (file) => {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
};

// The test files an edit deletes and those it adds a skip marker to: [{ file, kind: 'deletes'|'skips' }], with each
// file as a full path.
export function changesOf(input) {
  const tool = input?.tool_name;
  const given = input?.tool_input ?? {};
  const cwd = typeof input?.cwd === 'string' ? input.cwd : process.cwd();
  const full = (file) => path.resolve(cwd, String(file));
  const found = [];
  if (tool === 'Write' && typeof given.file_path === 'string' && isTestFile(given.file_path)) {
    const before = read(full(given.file_path));
    const content = String(given.content ?? '');
    if (before !== null && content.trim() === '' && before.trim() !== '') found.push({ file: full(given.file_path), kind: 'deletes' });
    else if (skipCount(content) > skipCount(before)) found.push({ file: full(given.file_path), kind: 'skips' });
  } else if ((tool === 'Edit' || tool === 'MultiEdit') && typeof given.file_path === 'string' && isTestFile(given.file_path)) {
    const edits = tool === 'Edit' ? [given] : Array.isArray(given.edits) ? given.edits : [];
    if (edits.some((e) => skipCount(e?.new_string) > skipCount(e?.old_string))) found.push({ file: full(given.file_path), kind: 'skips' });
  } else if (tool === 'NotebookEdit' && typeof given.notebook_path === 'string' && isTestFile(given.notebook_path)) {
    if (given.edit_mode === 'delete') found.push({ file: full(given.notebook_path), kind: 'deletes' });
    else if (skipCount(given.new_source) > 0) found.push({ file: full(given.notebook_path), kind: 'skips' });
  } else if (SHELL.includes(tool) && typeof given.command === 'string') {
    const parts = segments(given.command, tool === 'PowerShell') ?? [];
    for (const words of parts) {
      const [first, second, ...rest] = words;
      const removing = REMOVERS.has(first) || (first === 'git' && second === 'rm') || first === 'mv' || (first === 'git' && second === 'mv');
      if (!removing) continue;
      const args = (first === 'git' ? rest : [second, ...rest]).filter((w) => typeof w === 'string' && !w.startsWith('-'));
      // A move takes its sources away; the last word is where they go.
      const taken = first === 'mv' || second === 'mv' ? args.slice(0, -1) : args;
      for (const file of taken) if (isTestFile(file)) found.push({ file: full(file), kind: 'deletes' });
    }
  }
  return found;
}

// The hook's answer: undefined to let the tool run. `env` gives the step's run; `client` the helper.
export async function decide(input, { env = process.env, client = helperClient({ timeout: 8000 }) } = {}) {
  const runId = ownRun(env);
  if (!runId || (!WRITING.includes(input?.tool_name) && !SHELL.includes(input?.tool_name))) return undefined;
  const changes = changesOf(input);
  if (changes.length === 0) return undefined;
  const got = await client.engine.order({ runId });
  if (got?.ok !== true || !got.order) return answer.deny(NO_ORDER);
  const root = worktreeRoot(input.cwd) ?? input.cwd;
  for (const change of changes) {
    const rel = path.relative(root, change.file).split(path.sep).join('/');
    if (listed(rel, got.order.protectedFiles)) continue;
    return answer.deny(change.kind === 'deletes' ? DELETES(rel) : SKIPS(rel));
  }
  return undefined;
}

if (startedAsScript(import.meta.url)) await runAndExit(decide, { failClosed: true, event: 'PreToolUse' });
