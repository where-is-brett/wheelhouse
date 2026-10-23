// adapters/copilot/translate.js
// Copilot's hook input, turned into the input Wheelhouse's guards read (Claude Code's shape), and the guards'
// answers turned back into Copilot's. Every function here is pure. It imports only the adapter's tool lists,
// which import nothing, so the hook kit can read it without pulling in the rest of the adapter.
//
// What Copilot gives and takes (checks 56, 58 and 60, Copilot CLI 1.0.101, 21 October 2026):
//
// Input. Wheelhouse registers Copilot's hooks in camelCase only (check 56: the same event under two spellings
// runs twice), so this reads the camelCase payload only: `sessionId`, `timestamp` (milliseconds), `cwd`, and
// for a tool `toolName` and `toolArgs`; `postToolUse` adds `toolResult`, `postToolUseFailure` adds `error`.
// A PascalCase payload carries `hook_event_name` and is Claude Code's (scripts/agents/of-input.js). Nothing in
// the input names the permission mode, a sandbox, the runtime's version or the harness (check 58).
//
// Tools. The names are Copilot's own (check 58's table): `bash`, `view`, `rg`, `glob`, `web_fetch`, `task`, an
// MCP tool as `<server>-<tool>`, and file changes as `apply_patch`, whose `toolArgs` is a patch string, not an
// object. The known names are every list in ./tools.js, the union of checks 58, 63 and 66; anything else is an
// unknown tool, which is refused (design section 6.2). A guard never decides on a name alone: check 58's deny
// on `view` was walked round with `cat`, so every tool that reads or writes a file is given the guards its path.
//
// Answers. A tool call is refused by stdout JSON `{ permissionDecision: 'deny', permissionDecisionReason }`
// with exit 0, and exit 2 also refuses (check 58), so the hook entry exits 2 on a refusal (exitCodeFor) and a
// Copilot that ignored the body still refuses. Text the agent reads goes in `additionalContext` (check 60).
import tools from './tools.js';

// Copilot's name for a tool, to the name Claude Code's guards know it by (checks 58 and 66; ruling P5-2). A
// known tool missing here keeps its own name: the tools that only read, halt or notify are then let through by
// the lists the hook entry hands the guards (ruling P5-3), and the rest meet STOP and the lineage hold as tools
// that may write.
export const TOOL_MAP = Object.freeze({
  bash: 'Bash',
  // Not seen: there is no `pwsh` on the Mac (check 58). Unproven until the Windows sitting.
  powershell: 'PowerShell',
  view: 'Read',
  rg: 'Grep',
  glob: 'Glob',
  web_fetch: 'WebFetch',
  task: 'Agent',
  apply_patch: 'Edit',
  // Neither seen with the model check 58 used; entered under the names the research gives.
  edit: 'Edit',
  create: 'Write',
  // Check 66 saw it; it stops a running shell, as Claude Code's KillShell does.
  stop_bash: 'KillShell',
});

// Each tool's arguments renamed to the ones the guards read (ruling P5-4). An argument not named here is passed
// on under its own name, never dropped.
const ARGUMENT_MAP = Object.freeze({
  view: { path: 'file_path' },
  edit: { path: 'file_path' },
  create: { path: 'file_path' },
  rg: { paths: 'path' },
  glob: { paths: 'path' },
});

// Every name in the adapter's tool lists (carry-over e, ruling P5-10).
export const KNOWN_TOOLS = Object.freeze([...new Set([...tools.read, ...tools.halt, ...tools.notify, tools.ask, ...tools.shell, ...tools.edit, ...tools.other])]);

// Known, but refused as unknown until it is settled whether `preToolUse` sees each call inside it or only the
// wrapper (checks 58 and 66 left it open; ruling P5-10).
const UNSETTLED = Object.freeze(['multi_tool_use.parallel']);

// The refusal for a tool Wheelhouse doesn't know (Review Focus 1).
export function UNKNOWN_TOOL(name) {
  return `Copilot has a tool Wheelhouse doesn't know yet, \`${name}\`; it is refused until Wheelhouse is updated`;
}

// Copilot's event names, to Claude Code's (check 60: `userPromptSubmitted` is Claude Code's UserPromptSubmit,
// `agentStop` its Stop). The entry may pass either; an event in neither spelling is kept as it is.
const EVENTS = Object.freeze({
  sessionStart: 'SessionStart',
  sessionEnd: 'SessionEnd',
  userPromptSubmitted: 'UserPromptSubmit',
  preToolUse: 'PreToolUse',
  postToolUse: 'PostToolUse',
  postToolUseFailure: 'PostToolUseFailure',
  preCompact: 'PreCompact',
  subagentStart: 'SubagentStart',
  subagentStop: 'SubagentStop',
  agentStop: 'Stop',
});

// Top-level keys whose Claude Code name is not the plain snake_case of Copilot's (check 60's subagentStop).
const KEY_MAP = Object.freeze({ toolResult: 'tool_response', response: 'last_assistant_message' });

const snake = (key) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// Which harness ran the hook (ruling P5-6). Copilot's CLI sets COPILOT_CLI_BINARY_VERSION in the hook's own
// environment and its input carries no harness field (check 58). Everything else is 'unknown', which the hook
// entry refuses as it does the Local harness, letting only reading through, until sittings S1 and S2 name
// VS Code's sign. No recorded input is 'local' yet.
export function harnessOf(raw, env = process.env) {
  const version = env?.COPILOT_CLI_BINARY_VERSION;
  return typeof version === 'string' && version !== '' ? 'copilot' : 'unknown';
}

// A patch's header lines (check 58's patch shape): `*** ` and a word, read with any spaces before them, so a
// header indented by mistake is still read. Those that name a file, and those that name none.
const HEADER = /^\*\*\* [A-Za-z]/;
const PATH_LINE = /^\*\*\* (?:Add File|Update File|Delete File|Move to): *(.*?) *\r?$/;
const PLAIN_LINE = /^\*\*\* (?:Begin Patch|End Patch|End of File) *\r?$/;

// The paths an apply_patch changes, in the order given, or null when the patch is not a string, names no path,
// or holds a header line Wheelhouse doesn't know (a new kind of change it cannot read the path of). A line of
// a file's own text that starts with `+` or `-` is never read as a header; a context line (a space first) that
// looks like one is, which can only refuse the call or check one path more, never let a path by unchecked.
export function patchPaths(patch) {
  if (typeof patch !== 'string') return null;
  const paths = [];
  for (const line of patch.split('\n')) {
    const trimmed = line.trimStart();
    if (!HEADER.test(trimmed)) continue;
    const named = PATH_LINE.exec(trimmed);
    if (named) {
      if (named[1] === '') return null;
      if (!paths.includes(named[1])) paths.push(named[1]);
    } else if (!PLAIN_LINE.test(trimmed)) return null;
  }
  return paths.length > 0 ? paths : null;
}

// The tool's arguments under the guards' names, or null when a renamed argument and one already under the
// guards' name disagree: which one the tool uses isn't known, so the guards can't be given the right one.
function argumentsOf(name, args) {
  const renames = ARGUMENT_MAP[name] ?? {};
  const out = {};
  for (const [key, value] of Object.entries(args)) {
    const target = Object.hasOwn(renames, key) ? renames[key] : key;
    if (Object.hasOwn(out, target) && out[target] !== value) return null;
    out[target] = value;
  }
  return out;
}

// An MCP tool's Claude Code name: `<server>-<tool>` split at the first hyphen (ruling P5-5), or null.
function mcpName(name) {
  const cut = name.indexOf('-');
  if (cut <= 0 || cut === name.length - 1) return null;
  return `mcp__${name.slice(0, cut)}__${name.slice(cut + 1)}`;
}

// The input the guards read, in Claude Code's shape, for Copilot's input `raw` at `event` (either spelling).
// An apply_patch gives one Edit input per path it changes, as a list, and the call is refused if any one is
// (ruling P5-14). A tool Wheelhouse doesn't know gives `{ unknownTool: name }` (ruling P5-10). Null for input
// that cannot be read: not an object, no folder (every recorded input carries `cwd`, and the guards place the
// project by it), a tool name that is not a string, arguments that are not an object or that disagree, or a
// patch with no path.
export function toGuardInput(raw, event) {
  if (!isObject(raw) || typeof raw.cwd !== 'string' || raw.cwd === '') return null;
  const base = { hook_event_name: Object.hasOwn(EVENTS, event) ? EVENTS[event] : event };
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'toolName' || key === 'toolArgs') continue;
    const target = Object.hasOwn(KEY_MAP, key) ? KEY_MAP[key] : snake(key);
    // The event's name is the entry's to say, and a key the payload already spelt in snake_case keeps its value.
    if (target === 'hook_event_name' || Object.hasOwn(base, target)) continue;
    base[target] = value;
  }
  if (!Object.hasOwn(raw, 'toolName')) return base;
  const name = raw.toolName;
  if (typeof name !== 'string' || name === '') return null;
  if (UNSETTLED.includes(name)) return { unknownTool: name };
  if (name === 'apply_patch') {
    const paths = patchPaths(raw.toolArgs);
    if (paths === null) return null;
    return paths.map((file) => ({ ...base, tool_name: TOOL_MAP.apply_patch, tool_input: { file_path: file, patch: raw.toolArgs } }));
  }
  let toolName;
  if (KNOWN_TOOLS.includes(name)) toolName = Object.hasOwn(TOOL_MAP, name) ? TOOL_MAP[name] : name;
  else toolName = mcpName(name);
  if (toolName === null) return { unknownTool: name };
  const args = raw.toolArgs ?? {};
  const input = isObject(args) ? argumentsOf(name, args) : null;
  return input === null ? null : { ...base, tool_name: toolName, tool_input: input };
}

// A guard's answer (Claude Code's shape, adapters/claude-code/answers.js) in Copilot's shape for `event`: a
// tool decision as `{ permissionDecision, permissionDecisionReason }` (check 58), text for the agent as
// `{ additionalContext }` (check 60), and a block kept as it is. Anything else is passed on unchanged.
export function fromGuardAnswer(out, event) {
  if (!isObject(out)) return out;
  const specific = out.hookSpecificOutput;
  if (isObject(specific) && typeof specific.permissionDecision === 'string') {
    const shaped = { permissionDecision: specific.permissionDecision };
    if (typeof specific.permissionDecisionReason === 'string') shaped.permissionDecisionReason = specific.permissionDecisionReason;
    return shaped;
  }
  if (isObject(specific) && typeof specific.additionalContext === 'string') return { additionalContext: specific.additionalContext };
  if (out.decision === 'block') return typeof out.reason === 'string' ? { decision: 'block', reason: out.reason } : { decision: 'block' };
  return out;
}

// The exit code the hook entry ends with after writing `shaped`: 2 for a refusal, so a Copilot that ignored
// the body still refuses (check 58), and 0 otherwise.
export function exitCodeFor(shaped) {
  if (!isObject(shaped)) return 0;
  return shaped.permissionDecision === 'deny' || shaped.decision === 'block' ? 2 : 0;
}

export default Object.freeze({ toGuardInput, fromGuardAnswer, UNKNOWN_TOOL });
