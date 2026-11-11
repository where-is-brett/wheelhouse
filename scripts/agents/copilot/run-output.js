// scripts/agents/copilot/run-output.js
// What a `copilot -p --output-format json` run's output says once it ends: its events, the final answer, the session id,
// the model Auto chose, each refused tool call, a summary of what the run did, its use, and whether GitHub refused it
// because the month's allowance is gone. Pure readers of the text; the sessions part (adapters/copilot/sessions.js) turns
// them into records. The event types are those seen in check 96 and in the fixtures under tests/fixtures/copilot/run/.
import fs from 'node:fs';
import { isModelName } from '../../gate/guardrails.js';
import { scanText } from '../../state/secret-scan.js';
import { isMonthRefusal, modelOf as chosenModelOf } from './usage.js';

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const numberOr = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

// The most of a command an activity summary keeps, and the most commands. scripts/state/events.js holds the same two
// (ACTIVITY_COMMANDS, REFUSAL_KINDS); a test holds them equal.
const COMMAND_CHARS = 200;
export const MOST_COMMANDS = 50;
export const REFUSAL_KIND_NAMES = Object.freeze(['guard', 'rule', 'no-rule', 'other']);
const TOOL_NAME = /^[A-Za-z0-9_.:-]{1,64}$/;
const PLAIN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

// The events in a run's output, one JSON object per line; a line that isn't one is skipped.
export function eventsOf(stdout) {
  const events = [];
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    if (line.trim() === '') continue;
    try {
      const event = JSON.parse(line);
      if (isPlain(event)) events.push(event);
    } catch {
      // Not an event line.
    }
  }
  return events;
}

// The last `assistant.message` with something in it, or null (check 66).
export function finalAnswer(stdout) {
  let last = null;
  for (const event of eventsOf(stdout)) {
    const content = event.type === 'assistant.message' ? event.data?.content : undefined;
    if (typeof content === 'string' && content.trim() !== '') last = content;
  }
  return last;
}

// The session id from the last `result` event, when it is a plain id; otherwise null.
export function sessionIdOf(stdout) {
  let last = null;
  for (const event of eventsOf(stdout)) if (event.type === 'result') last = event.sessionId;
  return typeof last === 'string' && PLAIN_ID.test(last) ? last : null;
}

// The model Auto chose for the run (`session.auto_mode_resolved`'s `chosenModel`), else the usage file's `currentModel`:
// a name isModelName passes, or null. Never a model Wheelhouse passed: on an Auto-only plan it passes none.
export function modelOfRun({ usageFile = null, stdout = '' } = {}) {
  const plain = (value) => (typeof value === 'string' && isModelName(value) ? value : null);
  const chosen = plain(chosenModelOf(String(stdout ?? '')));
  if (chosen !== null) return chosen;
  if (typeof usageFile === 'string') {
    try {
      return plain(JSON.parse(fs.readFileSync(usageFile, 'utf8'))?.currentModel);
    } catch {
      // Missing or unreadable.
    }
  }
  return null;
}

// A tool refusal's kinds, by their messages (checks 58, 61 and 69). A guard's come first, so a Wheelhouse guard's refusal
// is never taken for a gap in the rules. A refusal is a guard's only when it carries the code `denied` and its message is
// one of the hook's own forms, from its start: the guard's reason or a hook that failed, so a tool's own message quoting
// those words is no guard's.
const GUARD = [/^Denied by preToolUse hook: /, /^Denied by preToolUse hook from "[^"\r\n]*" \(hook errored\)$/];
const RULE = /denied due to the following rules:?\s*(.*)$/s;
const NO_RULE = /no interactive user response was available/;

// A line as an activity record may hold it: cut short, and replaced by a note when the secret scan flags it, before or
// after the cut, so the scan the state's write makes never refuses the record.
function shown(line) {
  const cut = line.slice(0, COMMAND_CHARS);
  const hits = [...new Set([...scanText(line), ...scanText(cut)].map((hit) => hit.pattern))].sort();
  return hits.length > 0 ? `[hidden: matched ${hits.join(', ')}]` : cut;
}

// Each refused tool call, in order, as `{ tool, kind }`, with `rule` when a deny rule named one. All carry the code
// `denied` and the run still exits 0, so what happened is read from these events, never from the exit code.
export function refusalsOf(stdout) {
  const toolOf = new Map();
  const refusals = [];
  for (const event of eventsOf(stdout)) {
    if (event.type === 'tool.execution_start') toolOf.set(event.data?.toolCallId, event.data?.toolName);
    if (event.type !== 'tool.execution_complete' || event.data?.success !== false) continue;
    const tool = toolOf.get(event.data?.toolCallId);
    const message = typeof event.data?.error?.message === 'string' ? event.data.error.message : '';
    const refusal = { tool: typeof tool === 'string' && TOOL_NAME.test(tool) ? tool : tool === undefined || tool === null || tool === '' ? 'unknown' : 'other' };
    if (event.data?.error?.code === 'denied' && GUARD.some((form) => form.test(message))) refusal.kind = 'guard';
    else if (RULE.test(message)) {
      refusal.kind = 'rule';
      const rule = RULE.exec(message)[1].replace(/`/g, '').trim();
      if (rule !== '') refusal.rule = shown(rule);
    } else if (NO_RULE.test(message)) refusal.kind = 'no-rule';
    else refusal.kind = 'other';
    refusals.push(refusal);
  }
  return refusals;
}

// What a run did, for its `activity` record: `{ session, tools, commands, refusals }`.
export function activitySummary(stdout) {
  const tools = {};
  const commands = [];
  for (const event of eventsOf(stdout)) {
    if (event.type !== 'tool.execution_start') continue;
    const name = typeof event.data?.toolName === 'string' && TOOL_NAME.test(event.data.toolName) ? event.data.toolName : 'other';
    tools[name] = (tools[name] ?? 0) + 1;
    const command = event.data?.arguments?.command;
    if (typeof command === 'string' && command.trim() !== '' && commands.length < MOST_COMMANDS) commands.push(shown(command));
  }
  return { session: sessionIdOf(stdout), tools, commands, refusals: refusalsOf(stdout) };
}

const TOKEN_KINDS = ['input', 'output', 'cache_read', 'cache_write'];
const tokensOf = (details) => Object.fromEntries(TOKEN_KINDS.map((kind) => [kind, numberOr(details?.[kind]?.tokenCount)]));

// A session's use, read by field name (check 64): the usage file (`--usage-output-file`), else the last
// `session.usage_checkpoint` event, else nothing but the `result` event's premium requests. A missing field is null, never
// 0. `source` says which was read. The counts are the session's, cumulative across resumes (check 96).
export function sessionUsage({ usageFile = null, stdout = '' } = {}) {
  let premiumRequests = null;
  let checkpoint = null;
  for (const event of eventsOf(stdout)) {
    if (event.type === 'result') premiumRequests = numberOr(event.usage?.premiumRequests);
    if (event.type === 'session.usage_checkpoint' && isPlain(event.data)) checkpoint = event.data;
  }
  let file = null;
  if (typeof usageFile === 'string') {
    try {
      const parsed = JSON.parse(fs.readFileSync(usageFile, 'utf8'));
      if (isPlain(parsed)) file = parsed;
    } catch {
      // Missing or unreadable: the next source.
    }
  }
  if (file !== null) {
    return { source: 'file', totalNanoAiu: numberOr(file.totalNanoAiu), totalPremiumRequestCost: numberOr(file.totalPremiumRequestCost), tokens: tokensOf(file.tokenDetails), premiumRequests };
  }
  if (checkpoint !== null) {
    const snapshot = checkpoint.accountingSnapshot;
    return {
      source: 'checkpoint',
      totalNanoAiu: numberOr(checkpoint.totalNanoAiu ?? snapshot?.totalNanoAiu),
      totalPremiumRequestCost: numberOr(snapshot?.totalPremiumRequestCost),
      tokens: tokensOf(snapshot?.tokenDetails),
      premiumRequests,
    };
  }
  return { source: premiumRequests === null ? null : 'result', totalNanoAiu: null, totalPremiumRequestCost: null, tokens: tokensOf(null), premiumRequests };
}

// Whether GitHub refused the run because the month's allowance is gone: a run that did not finish well (no `result`, or a
// non-zero exit code in it) whose own words (a line that is no event, or an `error` event's message) say so. The words
// are usage.js's, which are not yet seen from a real refusal; a refusal they miss is an ordinary failed run, tried again.
export function monthRefusedIn(stdout) {
  const result = eventsOf(stdout).filter((event) => event.type === 'result').at(-1);
  if (result !== undefined && (result.exitCode === 0 || result.exitCode === undefined)) return false;
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    if (line.trim() === '') continue;
    let event = null;
    try {
      event = JSON.parse(line);
    } catch {
      if (isMonthRefusal(line)) return true;
      continue;
    }
    if (isPlain(event) && /error/i.test(String(event.type)) && [event.message, event.data?.message, event.data?.error?.message].some(isMonthRefusal)) return true;
  }
  return false;
}
