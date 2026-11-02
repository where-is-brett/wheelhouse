// scripts/agents/copilot/hook-entry.js
// The one hook Copilot runs for Wheelhouse (adapters/copilot/hooks.js registers it): one Node.js start per event,
// `node hook-entry.js <event>`, with Copilot's camelCase input on stdin. It reads the input once and, in a
// Wheelhouse project only, runs every Wheelhouse hook for that event in this one process, in order:
//
//   preToolUse           the harness check, the STOP guard, the lineage hold, then the tool guard and the areas guard
//                        once for each input the translation gives (one per path of an apply_patch); the first
//                        refusal wins
//   userPromptSubmitted  the STOP word, then the board context
//   sessionStart         the session start
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
// the input included, sits under one deadline (GUARD_DEADLINE_MS): past it a guard event is refused with
// DEADLINE and an informing event writes nothing.
//
// Every step comes from `deps.steps` when given, and each step's own deps from `deps.stepDeps`.
//
// On Copilot no hook writes (rulings P5-20, P5-22): the entry asks the helper's /health once per event it runs
// steps for, waiting at most HELPER_PROBE_MS, and gives every step `writeVia: 'helper'`, the helper client and
// whether the helper answered (`helperUp`). So the STOP guard marks no bypass and, with no helper, refuses all
// but reading with NO_HELPER_STOP; the STOP word asks the desk to set STOP (`all-stop`, by the prompt); the board
// context and the session start write nothing under the Wheelhouse home and never open the keys folder. The entry's own records go to
// the helper as session marks (/session/mark): a tool Wheelhouse doesn't know, a compaction, and a run past its
// deadline. A mark that can't be sent is lost; nothing is kept to send later.
import claudeTools from '../../../adapters/claude-code/tools.js';
import copilotTools from '../../../adapters/copilot/tools.js';
import { toGuardInput, fromGuardAnswer, harnessOf, exitCodeFor, UNKNOWN_TOOL } from '../../../adapters/copilot/translate.js';
import { readInput, answer, projectOf, registeredByPath, beingSetUp, managedDir, lockedByPath } from '../../hooks/kit.js';
import { GUARD_DEADLINE_MS, HELPER_PROBE_MS } from '../../lib/copilot-numbers.js';
import { helperClient } from '../../host/helper-client.js';
import { startedAsScript } from '../../lib/started-as-script.js';

export const LOCAL_HARNESS = 'Wheelhouse doesn\'t run in this kind of chat. Switch the chat to Copilot in the chat\'s agent picker.';
export const DEADLINE = 'A Wheelhouse check took too long, so this was refused; try again';
export const COULD_NOT_RUN = 'Wheelhouse\'s check could not run';

// The events the entry answers, with Claude Code's name for each, which the guards read.
const EVENT_NAMES = Object.freeze({
  sessionStart: 'SessionStart',
  userPromptSubmitted: 'UserPromptSubmit',
  preToolUse: 'PreToolUse',
  preCompact: 'PreCompact',
});
// The one event whose hooks guard; the rest only inform.
const GUARD_EVENT = 'preToolUse';

// Each step's module, loaded only for the event that runs it, so one start loads what that event needs.
const STEP_MODULES = Object.freeze({
  stopGuard: () => import('../../hooks/stop-guard.js'),
  lineageHold: () => import('../../hooks/lineage-hold.js'),
  toolGuard: () => import('../../hooks/tool-guard.js'),
  areas: () => import('../../hooks/areas.js'),
  stopWord: () => import('../../hooks/stop-word.js'),
  boardContext: () => import('../../hooks/board-context.js'),
  sessionStart: () => import('../../hooks/session-start.js'),
});

// The tools that only read, halt or notify, by both agents' names (ruling P5-3): a translated name is Claude Code's,
// and a tool the translation keeps under its own name is Copilot's.
const TOOL_LISTS = Object.freeze({
  readTools: Object.freeze([...claudeTools.read, ...copilotTools.read]),
  haltTools: Object.freeze([...claudeTools.halt, ...copilotTools.halt]),
  notifyTools: Object.freeze([...claudeTools.notify, ...copilotTools.notify]),
});
const EXTRA_DEPS = Object.freeze({ stopGuard: TOOL_LISTS, lineageHold: TOOL_LISTS });

const refuses = (out) => out?.hookSpecificOutput?.permissionDecision === 'deny' || out?.decision === 'block';
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

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

// Runs the steps named, in order, on each input; the first refusal is the answer. Text for the agent from more
// than one step is joined, so every line reaches it. A step's allow is the answer only when it allows every input
// it is given, and nothing else answers.
async function runSteps(names, inputs, { event, steps, stepDeps, dir }) {
  const context = [];
  let other;
  let allowed;
  for (const [name, list] of names) {
    const decide = steps?.[name] ?? (await STEP_MODULES[name]()).decide;
    const given = list(inputs);
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
      else if (isObject(out) && other === undefined) other = out;
    }
    if (given.length > 0 && allows === given.length) allowed ??= first;
  }
  if (context.length > 0) return answer.context(EVENT_NAMES[event], context.join('\n\n'));
  return other ?? allowed;
}

const first = (inputs) => inputs.slice(0, 1);
const each = (inputs) => inputs;
const STEPS = Object.freeze({
  preToolUse: [['stopGuard', first], ['lineageHold', first], ['toolGuard', each], ['areas', each]],
  userPromptSubmitted: [['stopWord', first], ['boardContext', first]],
  sessionStart: [['sessionStart', first]],
});

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

// Each step's deps on Copilot: every write through the helper (ruling P5-20), and the STOP guard marks no bypass.
function helperStepDeps(shared, given, cwd) {
  const own = { stopGuard: { bypass: false }, stopWord: { client: stopClient(shared.client, cwd) } };
  return Object.fromEntries(Object.keys(STEP_MODULES).map((name) => [name, { ...shared, ...own[name], ...given?.[name] }]));
}

// The answer, in Claude Code's shape, for one event's input: undefined for none. `seen.mark` is set once the
// project is known, so a run past its deadline can still be marked.
async function decideEvent(event, { stdin, env, deps, seen }) {
  const raw = await readInput(stdin);
  const dir = deps.dir ?? managedDir();
  if (typeof raw.cwd !== 'string' || raw.cwd === '') return refusal(event, COULD_NOT_RUN);
  if (!inWheelhouse(raw.cwd, { find: deps.projectOf ?? projectOf, dir })) return undefined;
  // The policy hook (Locked's) does nothing outside a Locked project: the person's own registration covers the rest.
  if (deps.policy === true && !(deps.lockedByPath ?? lockedByPath)(raw.cwd, { dir })) return undefined;
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
  const inputs = Array.isArray(translated) ? translated : [translated];
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
  // Once per event, inside the deadline (ruling P5-22): no answer means the helper isn't running.
  let helperUp = false;
  try {
    helperUp = (await bounded(client.health()))?.ok === true;
  } catch {
    // not answering
  }
  const stepDeps = helperStepDeps({ writeVia: 'helper', client, helperUp, agent: 'copilot' }, deps.stepDeps, raw.cwd);
  return runSteps(STEPS[event], inputs, { event, steps: deps.steps, stepDeps, dir });
}

// Runs the entry for `event`: `{ text, code }`, the line to write (or '') and the exit code. Never throws.
//   deps.steps        a step's decide, by name, in place of the hook's own
//   deps.stepDeps     extra deps for a step, by name
//   deps.deadlineMs   the deadline over the whole run (GUARD_DEADLINE_MS)
//   deps.recordCompaction(input)  records a compaction (a /session/mark compaction)
//   deps.client       the helper's client (helper-client.js), for the probe, the steps and the marks
//   deps.policy       true for the policy hook's start (`--policy`): it answers only in a Locked project
//   deps.dir, deps.projectOf, deps.harnessOf, deps.lockedByPath  as the hooks take them
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
  const { text, code } = await runEntry(process.argv[2], { stdin: process.stdin, deps: { policy: process.argv.includes('--policy') } });
  // Waits for the write to be taken (a Windows pipe takes it asynchronously), then exits: a guard still running
  // past the deadline, or a timer it left, must not hold the process.
  if (text !== '') await new Promise((resolve) => process.stdout.write(text, () => resolve()));
  process.exit(code);
}
