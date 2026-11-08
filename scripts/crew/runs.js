// scripts/crew/runs.js
// Finding a run's transcript and its subagents' transcripts. Read-only: every file found is
// checked with lstat, and a link or anything that is not a plain file is left out.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { plainWords, glossaryOf } from '../frontdesk/glossary.js';

export function configDir(env = process.env) {
  return env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function plainFile(file) {
  try {
    return fs.lstatSync(file).isFile();
  } catch {
    return false;
  }
}

function safeId(id) {
  return typeof id === 'string' && id !== '' && id !== '.' && id !== '..' && !/[\\/\0]/.test(id);
}

export function findTranscript({ sessionId, env = process.env } = {}) {
  if (!safeId(sessionId)) return null;
  const projects = path.join(configDir(env), 'projects');
  let folders;
  try {
    folders = fs.readdirSync(projects, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const folder of folders) {
    if (!folder.isDirectory()) continue;
    const file = path.join(projects, folder.name, `${sessionId}.jsonl`);
    if (plainFile(file)) return file;
  }
  return null;
}

export function findSubagents(file) {
  if (typeof file !== 'string' || !file.endsWith('.jsonl')) return [];
  const sessionDir = path.join(path.dirname(file), path.basename(file, '.jsonl'));
  const dir = path.join(sessionDir, 'subagents');
  let names;
  try {
    // Both folders must be plain directories: a link is not followed.
    if (!fs.lstatSync(sessionDir).isDirectory() || !fs.lstatSync(dir).isDirectory()) return [];
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const found = [];
  for (const name of names) {
    const m = /^agent-(.+)\.jsonl$/.exec(name);
    if (!m) continue;
    const sub = path.join(dir, name);
    try {
      const st = fs.lstatSync(sub);
      if (st.isFile()) found.push({ agentId: m[1], file: sub, mtime: st.mtimeMs });
    } catch {
      // vanished between listing and checking
    }
  }
  found.sort((a, b) => a.mtime - b.mtime || (a.agentId < b.agentId ? -1 : 1));
  return found.map(({ agentId, file: f }) => ({ agentId, file: f }));
}

// The parsed events of the last `max` bytes of a transcript, oldest first. Opened read-only and
// never followed through a link; anything that is not a plain file gives []. When the read starts
// part-way into the file its first line is dropped, and any line that does not parse (such as a
// half-written last line) is skipped.
export function readTail(file, { max = 256 * 1024 } = {}) {
  if (typeof file !== 'string' || !(max > 0)) return [];
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  let fd;
  try {
    fd = fs.openSync(file, flags);
  } catch {
    return [];
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return [];
    const start = Math.max(0, st.size - max);
    const length = st.size - start;
    if (length === 0) return [];
    const buf = Buffer.alloc(length);
    let got = 0;
    while (got < length) {
      const n = fs.readSync(fd, buf, got, length - got, start + got);
      if (n === 0) break;
      got += n;
    }
    const lines = buf.toString('utf8', 0, got).split('\n');
    if (start > 0) lines.shift();
    const events = [];
    for (const line of lines) {
      if (line.trim() === '') continue;
      try {
        const event = JSON.parse(line);
        if (event && typeof event === 'object' && !Array.isArray(event)) events.push(event);
      } catch {
        // not JSON, or still being written
      }
    }
    return events;
  } catch {
    return [];
  } finally {
    fs.closeSync(fd);
  }
}

// Step lines: a transcript event in plain words. Tool results are never shown, so nothing a
// command printed reaches a line; only what the run did, and the first sentence of what it said.

const HIDDEN = '[hidden: looked like a key]';
const KEY_PATTERNS = [
  /sk-[A-Za-z0-9_-]{20,}/,
  /gh[pousr]_[A-Za-z0-9]{20,}/,
  /glpat-[A-Za-z0-9_-]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /xox[abprs]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /(api[_-]?key|token|secret|password)\s*[:=]\s*\S{8,}/i,
];

// A text holding a key- or token-looking value becomes one fixed line.
export function mask(text) {
  const s = String(text ?? '');
  return KEY_PATTERNS.some((re) => re.test(s)) ? HIDDEN : s;
}

// Terminal escape codes and other control characters removed.
export function plain(text) {
  return String(text ?? '')
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b[@-Z\\-_]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '');
}

const TEST_RUN = /\b(?:test|jest|vitest|pytest)\b|node\s+--test/;
const RECORD_DECISION = /frontdesk[\\/]cli\.js\s+record\s+decision\b/;

function shown(file, cwd) {
  if (typeof file !== 'string' || file === '') return null;
  if (typeof cwd === 'string' && cwd !== '' && path.isAbsolute(file)) {
    const rel = path.relative(cwd, file);
    if (rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)) return rel.split(path.sep).join('/');
  }
  return file;
}

function toolStep(block, cwd) {
  const name = typeof block.name === 'string' ? block.name : '';
  const input = block.input && typeof block.input === 'object' ? block.input : {};
  switch (name) {
    case 'Read': {
      const f = shown(input.file_path, cwd);
      return f ? `Reading \`${f}\`` : 'Reading a file';
    }
    case 'Edit':
    case 'Write': {
      const f = shown(input.file_path, cwd);
      return f ? `Changing \`${f}\`` : 'Changing a file';
    }
    case 'Grep':
    case 'Glob':
      return 'Searching the code';
    case 'Bash': {
      const command = typeof input.command === 'string' ? input.command : '';
      if (RECORD_DECISION.test(command)) return 'Recording a decision';
      return TEST_RUN.test(command) ? 'Running the tests' : 'Running a command';
    }
    case 'WebFetch':
    case 'WebSearch':
      return 'Looking something up';
    case '':
      return null;
    case 'Agent':
    case 'Task':
      return subagentLine({ agentType: input.subagent_type, description: input.description });
    default:
      return `Using ${name}`;
  }
}

// The first sentence, cut to 120 characters. The whole text is checked for a key first, so a cut
// can never split one below the length a pattern needs.
function sentence(raw) {
  const s = plain(raw).trim();
  if (mask(s) === HIDDEN) return HIDDEN;
  const m = /^[\s\S]*?[.!?](?=\s|$)/.exec(s);
  return (m ? m[0] : s).trim().slice(0, 120).trim();
}

// One transcript event in plain words, with whether it did something ('did') or said something
// ('said'), or null for anything not known.
function stepAndKind(event) {
  if (!event || typeof event !== 'object' || event.type !== 'assistant') return null;
  const content = event.message?.content;
  const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    let line = null;
    let kind = 'did';
    if (block.type === 'tool_use') line = toolStep(block, event.cwd);
    else if (block.type === 'text' && typeof block.text === 'string') {
      line = sentence(block.text);
      kind = 'said';
    }
    if (line) {
      const at = typeof event.timestamp === 'string' || typeof event.timestamp === 'number' ? event.timestamp : null;
      return { at, text: mask(plain(line)), kind };
    }
  }
  return null;
}

// One transcript event in plain words, or null for anything not known.
export function stepOf(event) {
  const step = stepAndKind(event);
  return step ? { at: step.at, text: step.text } : null;
}

// A step through the glossary, as one line.
function worded(step, words) {
  // A step is one line: the glossary's trailing "Terms:" note is left off.
  const said = step.text === HIDDEN ? step.text : plainWords(step.text, words).text.split('\n\nTerms:')[0];
  return { at: step.at, text: mask(plain(said)) };
}

// The steps of a run, oldest first, each through the glossary. A waiting decision is named by its
// number only.
export function stepsOf(events, { glossary, waiting = null } = {}) {
  const words = glossary ?? glossaryOf({});
  const out = [];
  for (const event of Array.isArray(events) ? events : []) {
    const step = stepOf(event);
    if (!step) continue;
    out.push(worded(step, words));
  }
  if (waiting !== null && waiting !== undefined) {
    out.push({ at: out.length ? out[out.length - 1].at : null, text: `Waiting for your answer to decision ${waiting}` });
  }
  return out;
}

// Who is doing it: subagents and the Bosun.

const ROLES = {
  builder: { name: 'A Crew member', verb: 'building' },
  reviewer: { name: 'A Lookout', verb: 'reviewing' },
  tester: { name: 'The tester', verb: 'trying' },
};
const CREW_MEMBER = ROLES.builder;

function roleFor(agentType) {
  const kind = typeof agentType === 'string' ? agentType.split(':').pop() : '';
  return Object.hasOwn(ROLES, kind) ? ROLES[kind] : CREW_MEMBER;
}

export function roleOf(agentType) {
  return roleFor(agentType).name;
}

export function subagentLine({ agentType, description } = {}) {
  const role = roleFor(agentType);
  const what = plain(description).trim().slice(0, 80).trim();
  return mask(plain(`${role.name} is ${role.verb}${what ? ` ${what}` : ''}`));
}

function lowerFirst(text) {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

// A step line in a third person: "<who> is reading `x`", or "<who> is thinking: <line>" for
// anything that is not a phrase for what was done.
function inThirdPerson(who, step) {
  if (step.text === HIDDEN || step.kind === 'said') return `${who} is thinking: ${step.text}`;
  return `${who} is ${lowerFirst(step.text)}`;
}

// The piece named by a `record decision` command: a `--work <name>` argument, or the `work` field
// of the JSON the command carries. The question is never read.
function decisionWork(event) {
  const content = event?.message?.content;
  for (const block of Array.isArray(content) ? content : []) {
    if (block?.type !== 'tool_use' || block.name !== 'Bash') continue;
    const command = typeof block.input?.command === 'string' ? block.input.command : '';
    if (!RECORD_DECISION.test(command)) continue;
    const m = /--work[=\s]+["']?([A-Za-z0-9][A-Za-z0-9._:/-]{0,59})/.exec(command)
      || /["']work["']\s*:\s*["']([A-Za-z0-9][A-Za-z0-9._:/-]{0,59})["']/.exec(command);
    return { work: m ? m[1] : null };
  }
  return null;
}

function agentCalls(events) {
  const calls = new Map();
  for (const event of events) {
    const content = event?.message?.content;
    for (const block of Array.isArray(content) ? content : []) {
      if (block?.type === 'tool_use' && (block.name === 'Agent' || block.name === 'Task') && typeof block.id === 'string') {
        const input = block.input && typeof block.input === 'object' ? block.input : {};
        calls.set(block.id, { agentType: input.subagent_type, description: input.description });
      }
    }
  }
  return calls;
}

// The call whose result names this agent id, or null.
function callFor(agentId, events, calls) {
  for (const event of events) {
    const content = event?.message?.content;
    for (const block of Array.isArray(content) ? content : []) {
      if (block?.type !== 'tool_result' || !calls.has(block.tool_use_id)) continue;
      let text = '';
      try {
        text = JSON.stringify(block.content) ?? '';
      } catch {
        text = '';
      }
      if (event.toolUseResult?.agentId === agentId || text.includes(agentId)) return calls.get(block.tool_use_id);
    }
  }
  return null;
}

export function runSteps({ sessionId, env = process.env, glossary, waiting = null, foreman = false } = {}) {
  const file = findTranscript({ sessionId, env });
  if (!file) return { steps: [], crew: [] };
  const words = glossary ?? glossaryOf({});
  const events = readTail(file);
  const steps = [];
  for (const event of events) {
    const raw = stepAndKind(event);
    if (!raw) continue;
    const step = { ...worded(raw, words), kind: raw.kind };
    const decision = foreman ? decisionWork(event) : null;
    if (decision) {
      const line = decision.work ? `The Bosun is deciding what to do about ${decision.work}` : 'The Bosun is deciding what to do';
      steps.push({ at: step.at, text: mask(plain(line)) });
    } else {
      steps.push({ at: step.at, text: foreman ? mask(plain(inThirdPerson('The Bosun', step))) : step.text });
    }
  }
  if (waiting !== null && waiting !== undefined) {
    const text = `Waiting for your answer to decision ${waiting}`;
    steps.push({ at: steps.length ? steps[steps.length - 1].at : null, text: foreman ? `The Bosun is ${lowerFirst(text)}` : text });
  }
  const calls = agentCalls(events);
  const crew = [];
  for (const sub of findSubagents(file)) {
    const call = callFor(sub.agentId, events, calls);
    const who = roleOf(call?.agentType);
    const latest = stepsOfKind(readTail(sub.file), words).pop();
    if (latest) crew.push(mask(plain(inThirdPerson(who, latest))));
    else crew.push(call ? subagentLine(call) : subagentLine({}));
  }
  return { steps, crew };
}

function stepsOfKind(events, words) {
  const out = [];
  for (const event of events) {
    const raw = stepAndKind(event);
    if (raw) out.push({ ...worded(raw, words), kind: raw.kind });
  }
  return out;
}
