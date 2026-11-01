// scripts/hooks/areas.js
// Before each file or shell tool in a build engine's step (unattended goals design, section 6): refuses a write, or a
// shell delete or move, outside the areas of the goal the run's order belongs to. The areas come from the helper by the
// step's own run (ownRun: the run Archon gave the step's process, never a file an agent wrote), so they can be read and
// not written. No areas leave the run free as before, and outside an engine run it does nothing. With no word from the
// helper it refuses. A shell can change files in more ways than this reads, so the comparison at mark ready and the
// permit stand behind it (scripts/engine/routes.js, scripts/engine/broker/rules.js).
import path from 'node:path';
import { answer, runAndExit, worktreeRoot } from './kit.js';
import { segments } from './shell-words.js';
import { ownRun } from '../protection/archon.js';
import { helperClient } from '../host/helper-client.js';
import { outsideAreas } from '../engine/areas.js';
import { startedAsScript } from '../lib/started-as-script.js';

const WRITING = { Edit: 'file_path', Write: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' };
const SHELL = ['Bash', 'PowerShell'];
// The shell commands that take a file away.
const REMOVERS = new Set(['rm', 'unlink', 'trash', 'del', 'erase', 'Remove-Item', 'ri']);

const OUTSIDE = (file) => `Wheelhouse does not let this run change ${file}: it is outside the areas of the goal the director signed. Leave it as it is, or take the blocked exit and say why it must change`;
const NO_AREAS = 'Wheelhouse could not read this run\'s areas from the helper, so it can\'t tell whether this file may change. Try again; if it keeps happening, take the blocked exit';

// The paths a shell command's words change: what it deletes, and both ends of a move; of a copy, where it lands.
function shellPaths(words) {
  const [first, second, ...rest] = words;
  const git = first === 'git';
  if (!(REMOVERS.has(first) || ['mv', 'cp'].includes(first) || (git && ['rm', 'mv'].includes(second)))) return [];
  const args = (git ? rest : [second, ...rest]).filter((w) => typeof w === 'string' && !w.startsWith('-'));
  return first === 'cp' ? args.slice(-1) : args;
}

// The paths a tool would change, each in full.
export function pathsOf(input) {
  const tool = input?.tool_name;
  const given = input?.tool_input ?? {};
  const cwd = typeof input?.cwd === 'string' ? input.cwd : process.cwd();
  const full = (file) => path.resolve(cwd, String(file));
  if (Object.hasOwn(WRITING, tool)) return typeof given[WRITING[tool]] === 'string' ? [full(given[WRITING[tool]])] : [];
  if (!SHELL.includes(tool) || typeof given.command !== 'string') return [];
  return (segments(given.command, tool === 'PowerShell') ?? []).flatMap(shellPaths).map(full);
}

// The hook's answer: undefined to let the tool run. `env` gives the step's run; `client` the helper.
export async function decide(input, { env = process.env, client = helperClient({ timeout: 8000 }) } = {}) {
  const runId = ownRun(env);
  if (!runId) return undefined;
  const paths = pathsOf(input);
  if (paths.length === 0) return undefined;
  let got = null;
  try { got = await client.engine.areas({ runId }); } catch { got = null; }
  if (got?.ok !== true) return answer.deny(NO_AREAS);
  const root = worktreeRoot(input.cwd) ?? input.cwd;
  const inside = paths.map((file) => path.relative(root, file).split(path.sep).join('/')).filter((rel) => !rel.startsWith('../') && rel !== '..' && !path.isAbsolute(rel));
  const [first] = outsideAreas(inside.map((rel) => (rel === '' ? '.' : rel)), got.areas);
  return first === undefined ? undefined : answer.deny(OUTSIDE(first));
}

if (startedAsScript(import.meta.url)) await runAndExit(decide, { failClosed: true, event: 'PreToolUse' });
