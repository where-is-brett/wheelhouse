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
//   postToolUse          feature-status on every tool; and, once check C6 passes, the ask tool's answer recorded as a click
//                        (hook-click.js), and the First Mate told when Copilot answered a card itself
//   subagentStop         report-check, feature-status
//   agentStop            card-check, feature-status, aside-overlap. A block here sends the reason back as a new prompt
//                        (check 96), so the entry answers it with exit 0 and the body
//   sessionEnd           stop-guard, helm-end
//   preCompact           records the compaction and answers nothing: Copilot compacts whatever a hook answers
//                        (check 60), so nothing may rely on this hook to keep the briefing or a rule in context
//
// A step that can't change the answer is left unloaded (INERT_ON_HELPER, PASSES_THE_WORD_TOOLS below): the list above is what
// runs for an agent that can write, and the steps run here are that list less those.
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
// and an informing event writes nothing. The prompt event, which the model waits on before every prompt, has the shorter
// PROMPT_DEADLINE_MS for the steps after the stop-word step, which keeps the guards' time.
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
import { startTiming } from './hook-timing.js';
import claudeTools from '../../../adapters/claude-code/tools.js';
import copilotTools from '../../../adapters/copilot/tools.js';
import { toGuardInput, fromGuardAnswer, harnessOf, exitCodeFor, patchChanges, callsOf, upperDrive, UNKNOWN_TOOL, SHELL_INPUT_TOOLS } from '../../../adapters/copilot/translate.js';
import { readInput, answer, projectOf, registeredByPath, beingSetUp, managedDir, isWhy } from '../../hooks/kit.js';
import { C6_PASSED, GUARD_DEADLINE_MS, GUARD_TIMEOUT_SEC, HELPER_PROBE_MS, PROMPT_DEADLINE_MS, SESSION_START_MS } from './numbers.js';
import { helperClient } from '../../host/helper-client.js';
import { labelsIn, VSCODE_ASK } from './ask-click.js';
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
if (SESSION_START_MS >= GUARD_DEADLINE_MS) throw new Error('The session start\'s time must be shorter than the hook deadline');

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

// A step's module for `event`. The card check's Stop half is a module of its own (scripts/hooks/card-check-stop.js), whose
// `decide` is what card-check.js's gives a Stop input, so a stop loads none of the question card's checks.
const loadStep = (name, event) => (name === 'cardCheck' && event === 'agentStop' ? import('../../hooks/card-check-stop.js') : STEP_MODULES[name]());

// The tools that only read, halt or notify, by both agents' names: a translated name is Claude Code's, and a tool
// the translation keeps under its own name is Copilot's.
const TOOL_LISTS = Object.freeze({
  readTools: Object.freeze([...claudeTools.read, ...copilotTools.read]),
  haltTools: Object.freeze([...claudeTools.halt, ...copilotTools.halt]),
  notifyTools: Object.freeze([...claudeTools.notify, ...copilotTools.notify]),
});
const EXTRA_DEPS = Object.freeze({ stopGuard: TOOL_LISTS, lineageHold: TOOL_LISTS });

// Steps that cannot change what Copilot is told or let do, left unloaded (each Node.js start reads every module a step
// imports, which on Windows is most of what an event costs: about 13 ms a module on the laptop's measure).
//   - `promptRecord` and `helmEnd` begin by returning nothing for an agent whose hooks only read (`writeVia: 'helper'`,
//     which every step is given here): scripts/hooks/prompt-record.js's decide and scripts/hooks/helm-end.js's.
//   - `stopGuard` and `lineageHold` let a tool that only reads, halts or notifies through whatever the STOP word, the
//     helper or a hold say (their `readTools.includes(tool)` lines), so a call to one is never refused by either. A why
//     session is the exception: the STOP guard refuses there what its three tools don't name.
const INERT_ON_HELPER = Object.freeze(['promptRecord', 'helmEnd']);
const PASSES_THE_WORD_TOOLS = Object.freeze(['stopGuard', 'lineageHold']);
const onlyWordTools = (inputs) => inputs.every((input) => [...TOOL_LISTS.readTools, ...TOOL_LISTS.haltTools, ...TOOL_LISTS.notifyTools].includes(input.tool_name));

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
async function runSteps(steps, inputs, { event, decides, stepDeps, dir, env, seen }) {
  const context = [];
  let other;
  let allowed;
  for (const [name, select] of steps) {
    // The stop-word step has had its time; the prompt event's own deadline runs from here.
    if (name !== 'stopWord') seen?.stopWordDone?.();
    const given = select(inputs);
    if (given.length === 0) continue;
    // A why session never skips the STOP guard, whichever environment the run or the step is given.
    if (decides?.[name] === undefined && (INERT_ON_HELPER.includes(name) || (event === GUARD_EVENT && PASSES_THE_WORD_TOOLS.includes(name) && onlyWordTools(given) && !isWhy(env) && !isWhy(stepDeps?.[name]?.env ?? process.env)))) continue;
    const decide = decides?.[name] ?? (await loadStep(name, event)).decide;
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
  seen?.stopWordDone?.();
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
// The names Copilot's edit and create give their text, under the guards' names. When both names for the same text are
// given and differ, which one the tool writes isn't known, so neither is passed and the call is refused as unreadable.
function withText(input) {
  const given = input.tool_input;
  if (!isObject(given) || !['Edit', 'Write'].includes(input.tool_name) || typeof given.patch === 'string') return input;
  const text = { ...given };
  const pairs = input.tool_name === 'Edit' ? [['old_string', 'old_str'], ['new_string', 'new_str']] : [['content', 'file_text']];
  for (const [guards, copilots] of pairs) {
    if (guards in given && copilots in given && given[guards] !== given[copilots]) {
      text[guards] = undefined;
      delete text[copilots];
    } else text[guards] ??= given[copilots];
  }
  return { ...input, tool_input: text };
}
// The question tool's input as card-check reads it (check 59: `toolArgs.message` holds the card, and the answer comes
// back only as text): the message as one question, with the choices as its options when the call gives them, or else
// the labels of its `requestedSchema`, so the guards see the options the card shows (and the click route posts).
// Nothing for any other tool, or a call with no message.
// Whether the call lets the person type an answer: true when a field named for free input (any spelling with "free" in it) is
// anything but false, or a `requestedSchema` field takes what is typed (words, a number: any field but a list of options or a
// yes-or-no); false when such a field is false and none
// says otherwise, or when every `requestedSchema` field lists its options, so nothing can be typed; undefined when the call says
// nothing, which the card check takes as allowing it for a card that decides. A field lists its options when it has a non-empty
// `enum`, or a non-empty `oneOf` whose every entry is a `const`, and no `anyOf`; a `oneOf` entry without one (`{ type: 'string' }`)
// takes any words.
const FREE_FLAG = /free/i;
const listsOptions = (p) => isObject(p) && !('anyOf' in p) && (Array.isArray(p.enum) ? p.enum.length > 0 : Array.isArray(p.oneOf) && p.oneOf.length > 0 && p.oneOf.every((o) => isObject(o) && 'const' in o));
const typesWords = (input) => {
  const flags = Object.keys(input).filter((key) => FREE_FLAG.test(key));
  const fields = isObject(input.requestedSchema?.properties) ? Object.values(input.requestedSchema.properties) : [];
  const schemaWords = fields.some((p) => !listsOptions(p) && !(isObject(p) && p.type === 'boolean'));
  const schemaListed = fields.length > 0 && fields.every(listsOptions);
  if (schemaWords || flags.some((key) => input[key] !== false)) return true;
  return flags.length > 0 || schemaListed ? false : undefined;
};
const freeOf = (input) => {
  const free = typesWords(input);
  return free === undefined ? {} : { allowFreeformInput: free };
};
const cardOf = (input) => {
  if (input?.tool_name !== copilotTools.ask || typeof input.tool_input?.message !== 'string') return [];
  const given = input.tool_input.choices ?? input.tool_input.options;
  const schema = Array.isArray(given) ? [] : labelsIn(input.tool_input);
  const choices = Array.isArray(given) ? given : schema.length > 0 ? schema : null;
  const question = { question: input.tool_input.message, ...freeOf(input.tool_input), ...(Array.isArray(choices) ? { options: choices.map((label) => (isObject(label) ? label : { label })) } : {}) };
  return [{ ...input, tool_name: claudeTools.ask, tool_input: { questions: [question] } }];
};
const cards = (inputs) => inputs.slice(0, 1).flatMap(cardOf);
// A subagent's name as Claude Code's reviewer and builder carry it: `wheelhouse-builder` is `wheelhouse:builder`.
const subagent = (inputs) => inputs.slice(0, 1).map((input) => {
  const named = /^wheelhouse[-:](builder|reviewer)$/.exec(String(input.agent_type ?? input.agent_name ?? ''));
  return named ? { ...input, agent_type: `wheelhouse:${named[1]}` } : input;
});

const stepsFor = (event) => ({
  sessionStart: [['sessionStart', first]],
  userPromptSubmitted: [['stopWord', first], ['contextGauge', first], ['promptRecord', first], ['boardContext', first]],
  preToolUse: [['stopGuard', first], ['lineageHold', first], ['toolGuard', guarded], ['protectedTests', writers], ['frontDeskWrites', writers], ['cardCheck', cards]],
  postToolUse: [['featureStatus', first]],
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
// notes no open card (that note is kept under the Wheelhouse home). A builder's report names no commit: Wheelhouse
// commits its work after the run (scripts/feature/commit-work.js).
function helperStepDeps(shared, given, cwd, c6) {
  const own = { sessionStart: { totalMs: SESSION_START_MS }, stopGuard: { bypass: false }, stopWord: { client: stopClient(shared.client, cwd) }, cardCheck: { markOpen: () => {}, picker: c6 === true }, reportCheck: { commitNamed: false } };
  return Object.fromEntries(Object.keys(STEP_MODULES).map((name) => [name, { ...shared, ...own[name], ...given?.[name] }]));
}

// The answer, in Claude Code's shape, for one event's input: undefined for none. `seen.mark` is set once the
// project is known, so a run past its deadline can still be marked.
//
// A batch of tool calls (`toolCalls`, as VS Code's CLI session logs a turn's calls) is decided call by call, each
// through every step, so the STOP guard and the lineage hold see each one: the first refusal is the batch's answer,
// one deny with exit 2 that Copilot applies to the whole batch, and a call that can't be read refuses it. A folder's
// drive letter is read in capitals, as Copilot spells it so on some events and not on others.
async function decideEvent(event, { stdin, env, deps, seen }) {
  const timing = seen.timing;
  timing?.mark('stdinBegun');
  timing?.note('stdinTty', stdin?.isTTY === true);
  const given = await readInput(timing ? timing.counted(stdin) : stdin);
  timing?.mark('stdinEnded');
  if (event === GUARD_EVENT || event === 'postToolUse') timing?.note('tool', given?.toolName);
  const raw = isObject(given) && typeof given.cwd === 'string' ? { ...given, cwd: upperDrive(given.cwd) } : given;
  const dir = deps.dir ?? managedDir();
  if (typeof raw.cwd !== 'string' || raw.cwd === '') return refusal(event, COULD_NOT_RUN);
  const inProject = inWheelhouse(raw.cwd, { find: deps.projectOf ?? projectOf, dir });
  timing?.mark('projectRead');
  if (!inProject) return undefined;
  const calls = event === GUARD_EVENT ? callsOf(raw) : [raw];
  if ((deps.harnessOf ?? harnessOf)(raw, env) !== 'copilot') {
    if (event === 'sessionStart') return answer.context('SessionStart', LOCAL_HARNESS);
    if (event === GUARD_EVENT && (calls === null || !calls.every((one) => copilotTools.read.includes(one.toolName)))) return answer.deny(LOCAL_HARNESS);
    return undefined;
  }
  if (calls === null) return refusal(event, COULD_NOT_RUN);
  if (calls.length === 1) return decideCall(event, calls[0], { deps, seen, dir, env });
  let passed;
  let allows = 0;
  for (const one of calls) {
    const out = await decideCall(event, one, { deps, seen, dir, env });
    if (refuses(out)) return out;
    if (out?.hookSpecificOutput?.permissionDecision === 'allow') allows += 1;
    passed ??= out;
  }
  // An allow stands only when every call gives it; otherwise the batch is left to Copilot's own rules.
  return allows === calls.length ? passed : undefined;
}

// The answer for one call, or for one input of an event that is not about a tool.
async function decideCall(event, raw, { deps, seen, dir, env }) {
  // A subagent's own prompt and its own stop come through these two events too, named by `agentId` and `parentAgentId`, both present in the captured inputs (check 96). The
  // prompt is the parent's task, not the director's words, and a block at a subagent's `agentStop` is ignored:
  // the subagent is held by `subagentStop`, which the parent's run sees.
  if ((event === 'userPromptSubmitted' || event === 'agentStop') && isText(raw.agentId) && raw.agentId !== '' && isText(raw.parentAgentId) && raw.parentAgentId !== '') return undefined;
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
    if (event === GUARD_EVENT && !SHELL_INPUT_TOOLS.includes(translated.unknownTool)) await mark('unknown-tool', { name: translated.unknownTool });
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
  seen.timing?.mark('helperBegun');
  try {
    helperUp = (await bounded(client.health()))?.ok === true;
  } catch {
    // not answering
  }
  seen.timing?.mark('helperEnded');
  seen.timing?.note('helper', helperUp ? 'ok' : 'failed');
  const stepDeps = helperStepDeps({ writeVia: 'helper', client, helperUp, agent: 'copilot' }, deps.stepDeps, raw.cwd, deps.c6 ?? C6_PASSED);
  const out = await runSteps(stepsFor(event), inputs, { event, decides: deps.steps, stepDeps, dir, env, seen });
  if ((deps.c6 ?? C6_PASSED) !== true || refuses(out)) return out;
  // Once check C6 has passed: the question tool's card is posted as shown when it is asked, and its answer is recorded when it
  // comes back. The answer's text for the First Mate (Copilot answered by itself) joins what the steps gave.
  // Only the question tool has a card, so no other tool loads the click recording.
  if (inputs.length !== 1 || ![copilotTools.ask, VSCODE_ASK].includes(inputs[0].tool_name)) return out;
  if (event === GUARD_EVENT) await bounded((await import('./hook-click.js')).recordShown(inputs[0], { client }));
  if (event === 'postToolUse') {
    const told = await (await import('./hook-click.js')).recordAnswer(inputs[0], { client });
    if (typeof told === 'string') {
      const held = out?.hookSpecificOutput?.additionalContext;
      return answer.context(EVENT_NAMES[event], typeof held === 'string' && held !== '' ? `${held}\n\n${told}` : told);
    }
  }
  return out;
}

// Runs the entry for `event`: `{ text, code }`, the line to write (or '') and the exit code. Never throws.
//   deps.steps        a step's decide, by name, in place of the hook's own
//   deps.stepDeps     extra deps for a step, by name
//   deps.deadlineMs   the deadline over the whole run (GUARD_DEADLINE_MS)
//   deps.promptDeadlineMs  the prompt event's deadline for the steps after the stop-word step (PROMPT_DEADLINE_MS)
//   deps.c6           whether check C6 has passed (C6_PASSED)
//   deps.recordCompaction(input)  records a compaction (a /session/mark compaction)
//   deps.client       the helper's client (helper-client.js), for the probe, the steps and the marks
//   deps.dir, deps.projectOf, deps.harnessOf  as the hooks take them
//   deps.timing       the phase recorder (hook-timing.js's startTiming), when timing is on
export async function runEntry(event, { stdin = process.stdin, env = process.env, deps = {} } = {}) {
  if (!Object.hasOwn(EVENT_NAMES, event)) return { text: '', code: 0 };
  const deadlineMs = deps.deadlineMs ?? GUARD_DEADLINE_MS;
  let timer;
  let arm;
  const late = new Promise((resolve) => {
    arm = (ms) => {
      clearTimeout(timer);
      timer = setTimeout(() => resolve({ late: true }), ms);
    };
    arm(deadlineMs);
  });
  let out;
  const seen = { timing: deps.timing };
  // The prompt event, which the model waits on before every prompt, has the shorter deadline for what follows the
  // stop-word step, so that step keeps the guards' time.
  if (event === 'userPromptSubmitted') {
    let started = false;
    seen.stopWordDone = () => {
      if (started) return;
      started = true;
      arm(deps.promptDeadlineMs ?? PROMPT_DEADLINE_MS);
    };
  }
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
    return { text: `${JSON.stringify(shaped)}\n`, code: exitCodeFor(shaped, event) };
  } catch {
    return event === GUARD_EVENT ? { text: `${JSON.stringify({ permissionDecision: 'deny', permissionDecisionReason: COULD_NOT_RUN })}\n`, code: 2 } : { text: '', code: 0 };
  }
}

if (startedAsScript(import.meta.url)) {
  const timing = startTiming(process.argv[2]);
  timing.mark('modulesLoaded');
  const { text, code } = await runEntry(process.argv[2], { stdin: process.stdin, deps: { timing } });
  // Waits for the write to be taken (a Windows pipe takes it asynchronously), then exits: a guard still running
  // past the deadline, or a timer it left, must not hold the process.
  if (text !== '') await new Promise((resolve) => process.stdout.write(text, () => resolve()));
  timing.mark('answerWritten');
  timing.mark('exit');
  timing.flush();
  process.exit(code);
}
