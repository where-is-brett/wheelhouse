// scripts/agents/copilot/hook-entry.js
// The one hook Copilot runs for Wheelhouse (adapters/copilot/hooks.js registers it): one Node.js start per event,
// `node hook-entry.js <event>`, with Copilot's camelCase input on stdin. It reads the input once and, in a
// Wheelhouse project only, runs every Wheelhouse hook for that event in this one process, in the order
// adapters/claude-code/hooks.js gives them (design section 3.1):
//
//   sessionStart         session-start
//   userPromptSubmitted  stop-word, context-gauge, prompt-record, board-context
//   preToolUse           stop-guard and lineage-hold on every tool; tool-guard on file, shell and MCP tools;
//                        protected-tests and front-desk-writes on edits and the shell; card-check on the ask tool.
//                        A tool the translation gives several inputs for (an apply_patch's files, an rg's paths)
//                        is checked once for each; the first refusal wins
//   postToolUse          prompt-record on the ask tool (once check C6 passes), feature-status on every tool
//   subagentStop         report-check, feature-status
//   agentStop            card-check, feature-status, aside-overlap
//   sessionEnd           stop-guard, helm-end
//   preCompact           records the compaction and answers nothing: Copilot compacts whatever a hook answers
//                        (check 60), so nothing may rely on this hook to keep the briefing or a rule in context
//
// Outside a Wheelhouse project it writes nothing and exits 0. In any harness but Copilot's (VS Code's Local
// harness, or one that can't be told: translate.js's harnessOf) the session start says Wheelhouse doesn't run
// there and only reading is let through.
//
// The answer is written in Copilot's shape (adapters/copilot/translate.js), and the entry exits 2 on a refusal,
// which Copilot also takes as one (check 58), and 0 otherwise. It catches its own errors and answers on purpose:
// a crash (exit 1) blocks every call and its stderr never reaches the model (check 58). The whole run, reading
// the input included, sits under one deadline (GUARD_DEADLINE_MS, well inside the limit the registration gives,
// GUARD_TIMEOUT_SEC, past which Copilot lets the action through): past it a guard event is refused with DEADLINE
// and an informing event writes nothing.
//
// Every step comes from `deps.steps` when given, and each step's own deps from `deps.stepDeps`.
//
// On Copilot no hook writes under the Wheelhouse home: the entry asks the helper's /health once per event it runs
// steps for, waiting at most HELPER_PROBE_MS, and gives every step `writeVia: 'helper'`, the helper client and
// whether the helper answered (`helperUp`). So the STOP guard marks no bypass and, with no helper, refuses all
// but reading with NO_HELPER_STOP; the STOP word asks the desk to set STOP (`all-stop`, by the prompt); the
// steps that sign or keep records send them to the helper or leave them. The entry's own records go to the helper
// as session marks (/session/mark): a tool Wheelhouse doesn't know, a compaction, and a run past its deadline. A
// mark that can't be sent is lost; nothing is kept to send later.
import claudeTools from '../../../adapters/claude-code/tools.js';
import copilotTools from '../../../adapters/copilot/tools.js';
import { toGuardInput, fromGuardAnswer, harnessOf, exitCodeFor, patchChanges, UNKNOWN_TOOL } from '../../../adapters/copilot/translate.js';
import { readInput, answer, projectOf, registeredByPath, beingSetUp, managedDir } from '../../hooks/kit.js';
import { C6_PASSED, GUARD_DEADLINE_MS, GUARD_TIMEOUT_SEC, HELPER_PROBE_MS } from './numbers.js';
import { helperClient } from '../../host/helper-client.js';
import { startedAsScript } from '../../lib/started-as-script.js';

export const LOCAL_HARNESS = 'Wheelhouse doesn\'t run in this kind of chat. Switch the chat to Copilot in the chat\'s agent picker.';
export const DEADLINE = 'A Wheelhouse check took too long, so this was refused; try again';
export const COULD_NOT_RUN = 'Wheelhouse\'s check could not run';
export const APP_TOOL = 'Wheelhouse does not let Copilot call the Claude app\'s own tools';
export const NO_TEXT = 'Wheelhouse could not read what this edit writes, so it can\'t check it; it is refused';

// The events the entry answers, with Claude Code's name for each, which the guards read.
export const EVENT_NAMES = Object.freeze({
  sessionStart: 'SessionStart',
  userPromptSubmitted: 'UserPromptSubmit',
  preToolUse: 'PreToolUse',
  postToolUse: 'PostToolUse',
  subagentStop: 'SubagentStop',
  agentStop: 'Stop',
  sessionEnd: 'SessionEnd',
  preCompact: 'PreCompact',
});
// The one event whose hooks guard; the rest only inform.
const GUARD_EVENT = 'preToolUse';

// The deadline stays inside the limit the registration gives.
if (GUARD_DEADLINE_MS >= GUARD_TIMEOUT_SEC * 1000) throw new Error('The hook deadline must be shorter than the registered limit');

// Each step's module, loaded only for the event that runs it, so one start loads what that event needs.
const STEP_MODULES = Object.freeze({
  sessionStart: () => import('../../hooks/session-start.js'),
  stopWord: () => import('../../hooks/stop-word.js'),
  contextGauge: () => import('../../hooks/context-gauge.js'),
  promptRecord: () => import('../../hooks/prompt-record.js'),
  boardContext: () => import('../../hooks/board-context.js'),
  stopGuard: () => import('../../hooks/stop-guard.js'),
  lineageHold: () => import('../../hooks/lineage-hold.js'),
  toolGuard: () => import('../../hooks/tool-guard.js'),
  protectedTests: () => import('../../hooks/protected-tests.js'),
  frontDeskWrites: () => import('../../hooks/front-desk-writes.js'),
  cardCheck: () => import('../../hooks/card-check.js'),
  featureStatus: () => import('../../hooks/feature-status.js'),
  reportCheck: () => import('../../hooks/report-check.js'),
  asideOverlap: () => import('../../hooks/aside-overlap.js'),
  helmEnd: () => import('../../hooks/helm-end.js'),
});

// The tools that only read, halt or notify, by both agents' names: a translated name is Claude Code's, and a tool
// the translation keeps under its own name is Copilot's.
const TOOL_LISTS = Object.freeze({
  readTools: Object.freeze([...claudeTools.read, ...copilotTools.read]),
  haltTools: Object.freeze([...claudeTools.halt, ...copilotTools.halt]),
  notifyTools: Object.freeze([...claudeTools.notify, ...copilotTools.notify]),
});
const EXTRA_DEPS = Object.freeze({ stopGuard: TOOL_LISTS, lineageHold: TOOL_LISTS });

// The tools each tool step is registered on (adapters/claude-code/hooks.js matchers), by the guards' names.
const GUARDED = Object.freeze(['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Grep', 'Glob', 'Bash', 'PowerShell', 'Monitor', 'WebFetch', 'ListMcpResourcesTool', 'ReadMcpResourceTool']);
const WRITERS = Object.freeze(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell']);
const isGuarded = (name) => GUARDED.includes(name) || (typeof name === 'string' && name.startsWith('mcp__'));
// The tool guard's pass list takes the Claude app's own tools by name (tool-guard.js APP_TOOLS, lineage-hold.js
// APP_TURN_TOOLS), and a Copilot MCP tool `ccd_turn-wrap_up` translates onto one of them: none is let by.
const isAppTool = (name) => typeof name === 'string' && name.startsWith('mcp__ccd_');

const refuses = (out) => out?.hookSpecificOutput?.permissionDecision === 'deny' || out?.decision === 'block';
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string';

// Whether `cwd` is in a Wheelhouse project, as the guards place it: a registered project, a folder inside one by
// path, or a folder being set up. A folder that can't be placed counts, so the guards decide on it.
function inWheelhouse(cwd, { find, dir }) {
  if (find(cwd, { dir })) return true;
  const byPath = registeredByPath(cwd);
  if (byPath !== false) return true;
  return beingSetUp(cwd) !== null;
}

// A refusal in Claude Code's shape, for the guard event; nothing for the others.
const refusal = (event, reason) => (event === GUARD_EVENT ? answer.deny(reason) : undefined);

// Runs the steps named, in order, each on the inputs its selector gives; the first refusal is the answer. Text for
// the agent from more than one step is joined, so every line reaches it. A step's allow is the answer only when it
// allows every input it is given, and nothing else answers.
async function runSteps(steps, inputs, { event, decides, stepDeps, dir }) {
  const context = [];
  let other;
  let allowed;
  for (const [name, select] of steps) {
    const given = select(inputs);
    if (given.length === 0) continue;
    const decide = decides?.[name] ?? (await STEP_MODULES[name]()).decide;
    let allows = 0;
    let first;
    for (const input of given) {
      const out = await decide(input, { event: EVENT_NAMES[event], dir, ...EXTRA_DEPS[name], ...stepDeps?.[name] });
      if (refuses(out)) return out;
      const text = out?.hookSpecificOutput?.additionalContext;
      if (out?.hookSpecificOutput?.permissionDecision === 'allow') {
        allows += 1;
        first ??= out;
      } else if (typeof text === 'string' && text !== '') context.push(text);
      else if (isObject(out) && other === undefined && out.hookSpecificOutput?.updatedInput === undefined) other = out;
    }
    if (allows === given.length) allowed ??= first;
  }
  if (context.length > 0) return answer.context(EVENT_NAMES[event], context.join('\n\n'));
  return other ?? allowed;
}

// The selectors: which of the call's inputs a step is given.
const first = (inputs) => inputs.slice(0, 1);
const each = (inputs) => inputs;
const guarded = (inputs) => inputs.filter((input) => isGuarded(input.tool_name));
// What the write guards read. An apply_patch is read as the files and hunks it changes (patchChanges), so a skip
// marker added to a test, a deleted test, or a status line put into a document is seen as it is for Claude Code's
// Edit and Write; an edit or create whose text the guards can't read is refused by `unreadable`, not let through.
const writers = (inputs) => inputs.flatMap((input) => {
  if (!WRITERS.includes(input.tool_name)) return [];
  if (input.tool_name === 'Edit' && typeof input.tool_input?.patch === 'string') {
    const own = input.tool_input.file_path;
    return (patchChanges(input.tool_input.patch) ?? []).filter((change) => change.tool_input.file_path === own).map((change) => ({ ...input, ...change }));
  }
  return [input];
});
// An Edit or Write whose text the write guards could not read (Copilot's `edit` and `create` name their text
// `old_str`, `new_str` and `file_text`, entered under the names the research gives; check 58 saw neither).
function unreadable(input) {
  const given = input.tool_input;
  if (input.tool_name === 'Edit' && typeof given?.patch !== 'string') return !(isText(given?.old_string) && isText(given?.new_string));
  if (input.tool_name === 'Write') return !isText(given?.content);
  return false;
}
// The names Copilot's edit and create give their text, under the guards' names.
function withText(input) {
  const given = input.tool_input;
  if (!isObject(given) || !['Edit', 'Write'].includes(input.tool_name) || typeof given.patch === 'string') return input;
  const text = { ...given };
  if (input.tool_name === 'Edit') {
    text.old_string ??= given.old_str;
    text.new_string ??= given.new_str;
  } else text.content ??= given.file_text;
  return { ...input, tool_input: text };
}
// The question tool's input as card-check reads it (check 59: `toolArgs.message` holds the card, and the answer comes
// back only as text): the message as one question, with the choices as its options when the call gives them. Nothing
// for any other tool, or a call with no message.
const cardOf = (input) => {
  if (input?.tool_name !== copilotTools.ask || typeof input.tool_input?.message !== 'string') return [];
  const choices = input.tool_input.choices ?? input.tool_input.options;
  const question = { question: input.tool_input.message, ...(Array.isArray(choices) ? { options: choices.map((label) => (isObject(label) ? label : { label })) } : {}) };
  return [{ ...input, tool_name: claudeTools.ask, tool_input: { questions: [question] } }];
};
const cards = (inputs) => inputs.slice(0, 1).flatMap(cardOf);
// A click, from the tool's own response and never the model's input, once check C6 shows a hook sees one.
const clicks = (c6) => (inputs) => (c6 === true ? inputs.slice(0, 1).flatMap(cardOf).map((card, i) => ({ ...card, tool_response: { answers: inputs[i]?.tool_response?.answers } })) : []);
// A subagent's name as Claude Code's reviewer and builder carry it: `wheelhouse-builder` is `wheelhouse:builder`.
const subagent = (inputs) => inputs.slice(0, 1).map((input) => {
  const named = /^wheelhouse[-:](builder|reviewer)$/.exec(String(input.agent_type ?? input.agent_name ?? ''));
  return named ? { ...input, agent_type: `wheelhouse:${named[1]}` } : input;
});

const stepsFor = (event, { c6 }) => ({
  sessionStart: [['sessionStart', first]],
  userPromptSubmitted: [['stopWord', first], ['contextGauge', first], ['promptRecord', first], ['boardContext', first]],
  preToolUse: [['stopGuard', first], ['lineageHold', first], ['toolGuard', guarded], ['protectedTests', writers], ['frontDeskWrites', writers], ['cardCheck', cards]],
  postToolUse: [['promptRecord', clicks(c6)], ['featureStatus', first]],
  subagentStop: [['reportCheck', subagent], ['featureStatus', first]],
  agentStop: [['cardCheck', first], ['featureStatus', first], ['asideOverlap', first]],
  sessionEnd: [['stopGuard', first], ['helmEnd', first]],
})[event];

// What `promise` gives within HELPER_PROBE_MS, or null when it fails or is late.
async function bounded(promise) {
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(null), HELPER_PROBE_MS); });
  try {
    return await Promise.race([Promise.resolve(promise).catch(() => null), late]);
  } finally {
    clearTimeout(timer);
  }
}

// The helper's client as the STOP word uses it: STOP is set through the desk (scripts/desk/client.js, never its local
// core: this runs in the sandbox), as the director's `all-stop`. Should the desk not set it (a project the helper
// can't serve its desk for), the helper's own /stop/set is asked, as before: stopping too much is the safe error.
// The desk is loaded only when the word is typed, so no other event's start pays for it.
function stopClient(client, cwd) {
  return {
    ...client,
    async stop({ by } = {}) {
      let set = null;
      try {
        const { deskClient } = await import('../../desk/client.js');
        set = await deskClient({ cwd, client, local: 'never' }).act('all-stop', { by });
      } catch {
        // A desk that fails to answer at all is asked no further; /stop/set is asked instead.
      }
      return set?.ok === true ? { ok: true } : client.stop({ by });
    },
  };
}

// Each step's deps on Copilot: every write through the helper, and the STOP guard marks no bypass. The card check
// notes no open card (that note is kept under the Wheelhouse home).
function helperStepDeps(shared, given, cwd) {
  const own = { stopGuard: { bypass: false }, stopWord: { client: stopClient(shared.client, cwd) }, cardCheck: { markOpen: () => {} } };
  return Object.fromEntries(Object.keys(STEP_MODULES).map((name) => [name, { ...shared, ...own[name], ...given?.[name] }]));
}

// The answer, in Claude Code's shape, for one event's input: undefined for none. `seen.mark` is set once the
// project is known, so a run past its deadline can still be marked.
async function decideEvent(event, { stdin, env, deps, seen }) {
  const raw = await readInput(stdin);
  const dir = deps.dir ?? managedDir();
  if (typeof raw.cwd !== 'string' || raw.cwd === '') return refusal(event, COULD_NOT_RUN);
  if (!inWheelhouse(raw.cwd, { find: deps.projectOf ?? projectOf, dir })) return undefined;
  if ((deps.harnessOf ?? harnessOf)(raw, env) !== 'copilot') {
    if (event === 'sessionStart') return answer.context('SessionStart', LOCAL_HARNESS);
    if (event === GUARD_EVENT && !copilotTools.read.includes(raw.toolName)) return answer.deny(LOCAL_HARNESS);
    return undefined;
  }
  const client = deps.client ?? helperClient({ timeout: GUARD_DEADLINE_MS });
  const placedIn = (deps.projectOf ?? projectOf)(raw.cwd, { dir })?.project;
  // A mark informs: one that fails or is late is lost, and the event is answered as it would be.
  const mark = async (name, data) => {
    if (typeof placedIn !== 'string') return;
    try {
      await bounded(client.session.mark({ project: placedIn, mark: name, data }));
    } catch {
      // lost
    }
  };
  seen.mark = mark;
  const translated = toGuardInput(raw, event);
  if (typeof translated?.unknownTool === 'string') {
    if (event === GUARD_EVENT) await mark('unknown-tool', { name: translated.unknownTool });
    return refusal(event, UNKNOWN_TOOL(translated.unknownTool));
  }
  const inputs = (Array.isArray(translated) ? translated : [translated]).map((input) => (isObject(input) ? withText(input) : input));
  if (inputs.length === 0 || !inputs.every(isObject)) return refusal(event, COULD_NOT_RUN);
  if (event === 'preCompact') {
    const record = deps.recordCompaction ?? ((input) => mark('compaction', typeof input.trigger === 'string' && input.trigger !== '' ? { trigger: input.trigger } : {}));
    try {
      await record(inputs[0]);
    } catch {
      // The compaction goes ahead whether or not it was recorded.
    }
    return undefined;
  }
  if (inputs.some((input) => isAppTool(input.tool_name))) return refusal(event, APP_TOOL);
  if (event === GUARD_EVENT && writers(inputs).some(unreadable)) return refusal(event, NO_TEXT);
  // Once per event, inside the deadline: no answer means the helper isn't running.
  let helperUp = false;
  try {
    helperUp = (await bounded(client.health()))?.ok === true;
  } catch {
    // not answering
  }
  const stepDeps = helperStepDeps({ writeVia: 'helper', client, helperUp, agent: 'copilot' }, deps.stepDeps, raw.cwd);
  return runSteps(stepsFor(event, { c6: deps.c6 ?? C6_PASSED }), inputs, { event, decides: deps.steps, stepDeps, dir });
}

// Runs the entry for `event`: `{ text, code }`, the line to write (or '') and the exit code. Never throws.
//   deps.steps        a step's decide, by name, in place of the hook's own
//   deps.stepDeps     extra deps for a step, by name
//   deps.deadlineMs   the deadline over the whole run (GUARD_DEADLINE_MS)
//   deps.c6           whether check C6 has passed (C6_PASSED)
//   deps.recordCompaction(input)  records a compaction (a /session/mark compaction)
//   deps.client       the helper's client (helper-client.js), for the probe, the steps and the marks
//   deps.dir, deps.projectOf, deps.harnessOf  as the hooks take them
export async function runEntry(event, { stdin = process.stdin, env = process.env, deps = {} } = {}) {
  if (!Object.hasOwn(EVENT_NAMES, event)) return { text: '', code: 0 };
  const deadlineMs = deps.deadlineMs ?? GUARD_DEADLINE_MS;
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ late: true }), deadlineMs);
  });
  let out;
  const seen = {};
  try {
    const settled = await Promise.race([decideEvent(event, { stdin, env, deps, seen }).then((value) => ({ value })), late]);
    out = settled.late ? refusal(event, DEADLINE) : settled.value;
    if (settled.late) await seen.mark?.('deadline', { event });
  } catch {
    out = refusal(event, COULD_NOT_RUN);
  } finally {
    clearTimeout(timer);
  }
  try {
    const shaped = out === undefined || out === null ? null : fromGuardAnswer(out, event);
    if (!isObject(shaped)) return { text: '', code: 0 };
    return { text: `${JSON.stringify(shaped)}\n`, code: exitCodeFor(shaped) };
  } catch {
    return event === GUARD_EVENT ? { text: `${JSON.stringify({ permissionDecision: 'deny', permissionDecisionReason: COULD_NOT_RUN })}\n`, code: 2 } : { text: '', code: 0 };
  }
}

if (startedAsScript(import.meta.url)) {
  const { text, code } = await runEntry(process.argv[2], { stdin: process.stdin });
  // Waits for the write to be taken (a Windows pipe takes it asynchronously), then exits: a guard still running
  // past the deadline, or a timer it left, must not hold the process.
  if (text !== '') await new Promise((resolve) => process.stdout.write(text, () => resolve()));
  process.exit(code);
}
