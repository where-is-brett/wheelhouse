// adapters/copilot/lean-hooks.js
// Lean's guard on a Mac where Node.js doesn't run (check 69; Part 5 Task 8): the hook file and the shell guard it runs,
// both built with the kit (scripts/agents/copilot/home.js) and only copied by setup, so every person's copy has the
// same bytes and MANIFEST.txt can list them. The guard guards only a Lean project (ruling P5-56) and lets everything
// through elsewhere.
//
// The hook file is the one Part 5 Task 2's registration writes, `<home>/hooks/wheelhouse.json` (ruling P5-15), with one
// camelCase `preToolUse` entry. The guard sits beside it as `hooks/wheelhouse-lean-guard.sh`. The entry's command
// starts an explicit /bin/sh, which expands the Copilot home when the hook runs, so the line is the same for everyone;
// the double quotes keep a home with a space or an apostrophe one word (Review Focus 5).
//
// The guard's lists are written into adapters/copilot/lean-guard.sh here, from the modules that name them: the files that
// steer an agent (agent-control.js), the credential folders (credentials.js) and Copilot's tools (./tools.js and
// ./translate.js). Mac only; the Windows form is sitting S2's.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_CONTROL, CONTROL_FILE, homeControlFolders } from '../../scripts/lib/agent-control.js';
import { credentialPaths } from '../../scripts/lib/credentials.js';
import { GUARD_DEADLINE_MS, GUARD_TIMEOUT_SEC, LEAN_RECORD_DIR } from '../../scripts/lib/copilot-numbers.js';
import { COULD_NOT_RUN, DEADLINE } from '../../scripts/agents/copilot/hook-entry.js';
import tools from './tools.js';
import { KNOWN_TOOLS, TOOL_MAP, UNKNOWN_TOOL, toGuardInput } from './translate.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const TEMPLATE = 'adapters/copilot/lean-guard.sh';
export const GUARD_SCRIPT = 'wheelhouse-lean-guard.sh';
const TEMPLATE_COMMENT = `# ${TEMPLATE}`;

// The entry's command: an explicit /bin/sh expands the home at run time, inside double quotes.
export const LEAN_HOOK_COMMAND = `/bin/sh -c 'exec /bin/sh "\${COPILOT_HOME:-$HOME/.copilot}/hooks/${GUARD_SCRIPT}"'`;

// The tool whose input is a patch string (check 58); its paths come from the patch's header lines.
const PATCH_TOOL = 'apply_patch';

// What the guard says when it refuses something other than a file that steers an agent (CONTROL_FILE's words).
const SAY = Object.freeze({
  SECRET: 'Wheelhouse does not let an agent open Wheelhouse\'s keys or the credentials on this computer',
  ENV: 'Wheelhouse does not let an agent read a .env file',
  SEARCH: 'Wheelhouse does not let an agent search the home folder or a folder holding credentials',
  RECORD: 'That file is Wheelhouse\'s record, which is only added to: an earlier record file is never changed, so add the new line with the shell',
  PLACE: 'Wheelhouse\'s guard could not tell where that path leads, so it refuses',
});

// What the guard says where this Mac's plutil is missing or lacks the options it reads with (ruling P5-56).
export const PLUTIL_MISSING = 'Wheelhouse\'s guard needs this Mac\'s plutil with its -type and raw options, and they aren\'t here, so it refuses';

// Wheelhouse's own folder in the home, which holds its keys where Node.js runs (the tool guard refuses it too).
const WHEELHOUSE_FOLDER = '.wheelhouse';

const shellQuoted = (value) => `'${String(value).replaceAll('\'', '\'\\\'\'')}'`;
const lines = (list) => list.join('\n');

// A case pattern can't say "within one folder", and its `*` crosses folders, so a glob is turned into case patterns
// only where every `*` is a whole `**` part. A part with any other wildcard, or a character a case pattern reads, throws.
function casePatterns(glob) {
  const parts = glob.toLowerCase().split('/');
  const expand = (segs) => {
    const at = segs.indexOf('**');
    if (at < 0) {
      for (const seg of segs) if (/[*?[\]\\]/.test(seg)) throw new Error(`The shell guard can't hold the pattern ${glob}: only whole ** parts can be wildcards`);
      return [segs.join('/')];
    }
    const before = segs.slice(0, at);
    const after = segs.slice(at + 1);
    if (before.length === 0 && after.length === 0) return ['*'];
    if (before.length === 0) return expand(after).flatMap((a) => [a, `*/${a}`]);
    if (after.length === 0) return expand(before).flatMap((b) => [b, `${b}/*`]);
    return expand(before).flatMap((b) => expand(after).flatMap((a) => [`${b}/${a}`, `${b}/*/${a}`]));
  };
  return expand(parts);
}

// The home's control folders on a Mac, from the home folder.
function homeControl() {
  const home = '/home-of-the-person';
  return homeControlFolders({ home, platform: 'darwin' }).map((folder) => path.posix.relative(home, folder));
}

// The tools grouped by what the guard reads of them, through the adapter's own map. A tool that changes files but has
// no path the guard can read would be let through unchecked, so it throws.
function toolGroups() {
  const by = (claudeName) => KNOWN_TOOLS.filter((name) => TOOL_MAP[name] === claudeName);
  const write = [...by('Edit'), ...by('Write')].filter((name) => name !== PATCH_TOOL);
  if (!tools.edit.includes(PATCH_TOOL)) throw new Error(`The adapter's tools no longer hold ${PATCH_TOOL}`);
  for (const name of tools.edit) {
    if (name !== PATCH_TOOL && !write.includes(name)) throw new Error(`The shell guard has no path to read for ${name}, a tool that changes files`);
  }
  // Known, but refused as unknown (translate.js's unsettled tools): toGuardInput says so for them.
  const unsettled = KNOWN_TOOLS.filter((name) => toGuardInput({ cwd: '/', toolName: name, toolArgs: {} }, 'preToolUse')?.unknownTool === name);
  return { read: by('Read'), grep: by('Grep'), glob: by('Glob'), write, unsettled };
}

// leanGuardScript({ root, comment, plutil, deadlineSec }) -> string, the guard with its lists written in.
//   comment      the line that replaces the template's path comment (the kit's own)
//   plutil       the parser's full path (the tests point it at a missing or failing one)
//   deadlineSec  the guard's own deadline, at most GUARD_DEADLINE_MS (the tests shorten it)
export function leanGuardScript({ root = REPO, comment, plutil = '/usr/bin/plutil', deadlineSec = GUARD_DEADLINE_MS / 1000 } = {}) {
  if (!Number.isInteger(deadlineSec) || deadlineSec < 1 || deadlineSec > GUARD_DEADLINE_MS / 1000) throw new Error(`The guard's deadline is a whole number of seconds up to ${GUARD_DEADLINE_MS / 1000}`);
  let text;
  try {
    text = fs.readFileSync(path.join(root, ...TEMPLATE.split('/')), 'utf8').replaceAll('\r\n', '\n');
  } catch (error) {
    throw new Error(`The shell guard can't be built: ${TEMPLATE} can't be read (${error.code ?? error.message})`, { cause: error });
  }
  const groups = toolGroups();
  const [unknownBefore, unknownAfter] = UNKNOWN_TOOL('\u0000').split('\u0000');
  const words = {
    PLUTIL: plutil,
    DEADLINE_SEC: String(deadlineSec),
    KNOWN_TOOLS: lines(KNOWN_TOOLS),
    UNSETTLED_TOOLS: lines(groups.unsettled),
    SHELL_TOOLS: lines(tools.shell),
    READ_TOOLS: lines(groups.read),
    GREP_TOOLS: lines(groups.grep),
    GLOB_TOOLS: lines(groups.glob),
    WRITE_TOOLS: lines(groups.write),
    PATCH_TOOL,
    CONTROL_PATTERNS: lines([...new Set(AGENT_CONTROL.flatMap(casePatterns))]),
    HOME_CONTROL: lines(homeControl()),
    SECRETS: lines([...credentialPaths('darwin'), WHEELHOUSE_FOLDER]),
    RECORD_DIR: LEAN_RECORD_DIR.toLowerCase(),
    SAY_CONTROL: CONTROL_FILE,
    SAY_SECRET: SAY.SECRET,
    SAY_ENV: SAY.ENV,
    SAY_SEARCH: SAY.SEARCH,
    SAY_RECORD: SAY.RECORD,
    SAY_PLACE: SAY.PLACE,
    SAY_COULD_NOT_RUN: COULD_NOT_RUN,
    SAY_PLUTIL: PLUTIL_MISSING,
    SAY_DEADLINE: DEADLINE,
    SAY_UNKNOWN_BEFORE: unknownBefore,
    SAY_UNKNOWN_AFTER: unknownAfter,
  };
  for (const [name, value] of Object.entries(words)) {
    const marker = `=@${name}@\n`;
    if (text.split(marker).length !== 2) throw new Error(`${TEMPLATE} has no single ${name}=@${name}@ line`);
    // The shell's own value: one word, single-quoted, with a newline between the items of a list.
    text = text.replace(marker, () => `=${/^\d+$/.test(value) ? value : shellQuoted(value)}\n`);
  }
  if (/@[A-Z_]+@/.test(text)) throw new Error(`${TEMPLATE} holds a word the build doesn't fill in`);
  if (comment !== undefined) {
    if (text.split(`\n${TEMPLATE_COMMENT}\n`).length !== 2) throw new Error(`${TEMPLATE}'s second line is not its path comment`);
    text = text.replace(`\n${TEMPLATE_COMMENT}\n`, () => `\n# ${comment}\n`);
  }
  return text;
}

// leanHookFile({ platform }) -> the hook file's content, the same file name the helper's registration writes.
export function leanHookFile({ platform = 'darwin' } = {}) {
  if (platform !== 'darwin') throw new Error('Lean\'s shell guard is for a Mac; the Windows form waits for the Windows sitting');
  return {
    version: 1,
    hooks: {
      preToolUse: [{ type: 'command', command: LEAN_HOOK_COMMAND, bash: LEAN_HOOK_COMMAND, timeoutSec: GUARD_TIMEOUT_SEC }],
    },
  };
}

export default Object.freeze({ leanHookFile, leanGuardScript });
