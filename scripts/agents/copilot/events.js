// scripts/agents/copilot/events.js
// Copilot's events for the crew view (design section 8, part 9). A session's events are kept at
// <COPILOT_HOME>/session-state/<id>/events.jsonl, one JSON object per line (`type`, `data`, `id`, `parentId`, `timestamp`;
// check 96). This reads them, read-only and never through a link, and gives the steps and crew lines in the shape
// `runSteps` (./runs.js) gives for Claude Code: each event is put into the transcript shape the crew view already reads, so
// the words, the key masking and the glossary are the same for both.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { glossaryOf } from '../../frontdesk/glossary.js';
import {
  CREW_SHOWN, inThirdPerson, lowerFirst, mask, plain, readTail, stepAndKind, subagentLine, validWaiting, withKind,
} from '../../crew/runs.js';

export function copilotHome(env = process.env) {
  return env.COPILOT_HOME || path.join(os.homedir(), '.copilot');
}

const safeId = (id) => typeof id === 'string' && id !== '' && id !== '.' && id !== '..' && !/[\\/\0]/.test(id);

const plainFile = (file) => {
  try {
    return fs.lstatSync(file).isFile();
  } catch {
    return false;
  }
};

// The events file of a session, or null when the id is not a plain name, or the file is missing or not a plain file.
export function findCopilotEvents({ sessionId, env = process.env } = {}) {
  if (!safeId(sessionId)) return null;
  const dir = path.join(copilotHome(env), 'session-state', sessionId);
  try {
    if (!fs.lstatSync(dir).isDirectory()) return null;
  } catch {
    return null;
  }
  const file = path.join(dir, 'events.jsonl');
  return plainFile(file) ? file : null;
}

// Copilot's tool names, as the crew view's step lines know them by Claude Code's.
const TOOL_WORDS = Object.freeze({
  view: 'Read', apply_patch: 'Edit', edit: 'Edit', create: 'Edit', rg: 'Grep', glob: 'Glob', bash: 'Bash', powershell: 'Bash', web_fetch: 'WebFetch', task: 'Task',
});

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// One Copilot event as a transcript event of the shape the crew view reads, or null for any that says or does nothing the view
// shows. A tool's result is never carried over, so nothing a command printed reaches a line.
function asTranscript(event) {
  if (!isObject(event) || !isObject(event.data)) return null;
  const { data } = event;
  const at = event.timestamp;
  if (event.type === 'assistant.message') {
    return typeof data.content === 'string' && data.content.trim() !== '' ? { type: 'assistant', timestamp: at, message: { content: data.content } } : null;
  }
  if (event.type !== 'tool.execution_start' || typeof data.toolName !== 'string' || data.toolName === '') return null;
  const args = isObject(data.arguments) ? data.arguments : {};
  const name = Object.hasOwn(TOOL_WORDS, data.toolName) ? TOOL_WORDS[data.toolName] : data.toolName;
  const input = name === 'Task'
    ? { subagent_type: typeof args.agent_type === 'string' ? args.agent_type.replace(/^wheelhouse-/, '') : undefined, description: args.description }
    : { file_path: args.path, command: args.command };
  return { type: 'assistant', timestamp: at, message: { content: [{ type: 'tool_use', name, input }] } };
}

// One Copilot event in plain words, as { at, text, kind } with kind 'did' or 'said', or null.
export function copilotStepOf(event) {
  const step = stepAndKind(asTranscript(event));
  return step ? { at: step.at, text: step.text, kind: step.kind } : null;
}

// The sub-agent calls in the events that have no result yet: each call's id, with its agent and description.
function stillWorking(events) {
  const done = new Set(events.filter((e) => e?.type === 'tool.execution_complete').map((e) => e.data?.toolCallId));
  return events
    .filter((e) => e?.type === 'tool.execution_start' && e.data?.toolName === 'task' && !done.has(e.data?.toolCallId))
    .map((e) => ({ agentType: typeof e.data.arguments?.agent_type === 'string' ? e.data.arguments.agent_type.replace(/^wheelhouse-/, '') : undefined, description: e.data.arguments?.description }));
}

// { steps, crew, crewDid } for a Copilot session, as `runSteps` gives them: the steps oldest first, and one line for each
// sub-agent still working, newest first, at most five, then "and N more crew members". All empty when the events can't be found.
export function copilotRunSteps({ sessionId, env = process.env, glossary, waiting = null, foreman = false } = {}) {
  const file = findCopilotEvents({ sessionId, env });
  if (!file) return { steps: [], crew: [], crewDid: [] };
  const words = glossary ?? glossaryOf({});
  const events = readTail(file);
  const steps = [];
  for (const event of events) {
    const raw = stepAndKind(asTranscript(event));
    if (!raw) continue;
    const step = withKind(raw, words);
    steps.push({ at: step.at, text: foreman ? mask(plain(inThirdPerson('The Bosun', step))) : step.text, kind: step.kind });
  }
  if (validWaiting(waiting)) {
    const text = `Waiting for your answer to decision ${waiting}`;
    steps.push({ at: steps.length ? steps[steps.length - 1].at : null, text: foreman ? `The Bosun is ${lowerFirst(text)}` : text, kind: 'did' });
  }
  const working = stillWorking(events).reverse();
  const crew = working.slice(0, CREW_SHOWN).map((call) => subagentLine(call));
  const left = working.length - CREW_SHOWN;
  if (left > 0) crew.push(`and ${left} more crew member${left === 1 ? '' : 's'}`);
  return { steps, crew, crewDid: [...crew] };
}
