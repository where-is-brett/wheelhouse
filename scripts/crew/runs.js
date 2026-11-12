// scripts/crew/runs.js
// Finding a run's transcript and its subagents' transcripts. Read-only: every file found is
// checked with lstat, and a link or anything that is not a plain file is left out.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { plainWords, glossaryOf } from '../frontdesk/glossary.js';
import { SLUG } from '../lib/build-loop.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { stateDir } from '../lib/paths.js';
import { listEvents } from '../state/events.js';
import { readEnrolled } from '../state/signing.js';
import { buildViews } from '../state/views.js';
import { effectiveSettings } from '../settings/effective.js';
import { isOpen } from '../desk/views.js';
import { readCapped } from '../feature/status.js';
import { readDecisions } from '../decisions/pending.js';
import { runningFile, sessionFile, pidAlive } from '../watcher/waker.js';
import { levelFor } from './level.js';
import { LEVELS } from './levels.js';

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

// A text holding a key- or token-looking value becomes one set line.
export function mask(text) {
  const s = String(text ?? '');
  return KEY_PATTERNS.some((re) => re.test(s)) ? HIDDEN : s;
}

// Terminal escape codes and other control characters removed, and every run of white space (line
// breaks, tabs, U+2028 and U+2029 included) made one space, so the result is always one line.
export function plain(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b[@-Z\\-_]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')
    .trim();
}

// A test tool run in command position: at the start, or after `&&`, `||`, `;` or `|`, with any
// variable settings before it. `cd test` or `ls test/` is not a test run.
const TEST_RUN = new RegExp(
  '(?:^|&&|\\|\\||[;|])\\s*(?:\\w+=\\S*\\s+)*(?:'
  + '(?:npm|pnpm|yarn)\\s+(?:run\\s+)?test\\b'
  + '|npx\\s+(?:-{1,2}\\S+\\s+)*(?:jest|vitest|pytest|mocha)\\b'
  + '|(?:jest|vitest|pytest|mocha)\\b'
  + '|python3?\\s+-m\\s+pytest\\b'
  + '|node\\s+(?:--\\S+\\s+)*--test\\b'
  + ')',
);
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
      return /^mcp__[^_]/.test(name) ? 'Using a connected tool' : `Using ${name}`;
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
export function stepAndKind(event) {
  if (!event || typeof event !== 'object' || event.type !== 'assistant') return null;
  const content = event.message?.content;
  const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    let line = null;
    let kind = 'did';
    let agent = null;
    if (block.type === 'tool_use') {
      line = toolStep(block, event.cwd);
      if (block.name === 'Agent' || block.name === 'Task') {
        kind = 'sent';
        const input = block.input && typeof block.input === 'object' ? block.input : {};
        agent = { agentType: input.subagent_type, description: input.description };
      }
    }
    else if (block.type === 'text' && typeof block.text === 'string') {
      line = sentence(block.text);
      kind = 'said';
    }
    if (line) {
      const at = typeof event.timestamp === 'string' || typeof event.timestamp === 'number' ? event.timestamp : null;
      return { at, text: mask(plain(line)), kind, agent };
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

// A decision number to name: a positive whole number, and nothing else.
export function validWaiting(waiting) {
  return Number.isInteger(waiting) && waiting > 0;
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
  if (validWaiting(waiting)) {
    out.push({ at: out.length ? out[out.length - 1].at : null, text: `Waiting for your answer to decision ${waiting}` });
  }
  return out;
}

// Who is doing it: subagents and the Bosun.

const ROLES = {
  builder: { name: 'A Crew member', verb: 'building', base: 'build' },
  reviewer: { name: 'A Lookout', verb: 'reviewing', base: 'review' },
  tester: { name: 'The tester', verb: 'trying', base: 'try' },
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
  const what = describe(description);
  if (what === HIDDEN) return HIDDEN;
  return mask(plain(`${role.name} is ${role.verb}${what ? ` ${what}` : ''}`));
}

// A call's description: through plain and mask as a whole first, so a cut can never split a key;
// then cut to 80 characters. A description that looks like a key gives the hidden line.
function describe(description) {
  const whole = mask(plain(description).trim());
  return whole === HIDDEN ? HIDDEN : whole.slice(0, 80).trim();
}

// "sending out a Lookout to review task 2", or null when the description is hidden.
function sendPhrase({ agentType, description } = {}) {
  const role = roleFor(agentType);
  const what = describe(description);
  if (what === HIDDEN) return null;
  return `sending out ${lowerFirst(role.name)} to ${role.base}${what ? ` ${what}` : ''}`;
}

export function lowerFirst(text) {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

// A step line in a third person: "<who> is reading `x`", or "<who> is thinking: <line>" for
// anything that is not a phrase for what was done.
export function inThirdPerson(who, step) {
  if (step.text === HIDDEN || step.kind === 'said') return `${who} is thinking: ${step.text}`;
  if (step.kind === 'sent') return `${who} is ${step.phrase}`;
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

// The call whose result names each agent id, built once: agent id -> call. A result names its
// agent in `toolUseResult.agentId`, or else by the id standing as a whole word in its text.
function callsByAgent(events, calls, agentIds) {
  const byAgent = new Map();
  for (const event of events) {
    const content = event?.message?.content;
    for (const block of Array.isArray(content) ? content : []) {
      if (block?.type !== 'tool_result' || !calls.has(block.tool_use_id)) continue;
      const call = calls.get(block.tool_use_id);
      const named = event.toolUseResult?.agentId;
      if (typeof named === 'string') {
        if (!byAgent.has(named)) byAgent.set(named, call);
        continue;
      }
      let text = '';
      try {
        text = JSON.stringify(block.content) ?? '';
      } catch {
        text = '';
      }
      for (const id of agentIds) {
        if (byAgent.has(id)) continue;
        if (new RegExp(`(?<![A-Za-z0-9_-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_-])`).test(text)) byAgent.set(id, call);
      }
    }
  }
  return byAgent;
}

// A subagent's meta file beside its transcript, or null: read-only, never through a link, at most
// 64 KiB, and anything that is not a JSON object counts as no meta. Only fields of the expected
// type are kept.
const META_MAX = 64 * 1024;

function readMeta(subFile) {
  const file = subFile.replace(/\.jsonl$/, '.meta.json');
  if (file === subFile || !plainFile(file)) return null;
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  } catch {
    return null;
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > META_MAX) return null;
    const buf = Buffer.alloc(st.size);
    let got = 0;
    while (got < st.size) {
      const n = fs.readSync(fd, buf, got, st.size - got, got);
      if (n === 0) break;
      got += n;
    }
    const meta = JSON.parse(buf.toString('utf8', 0, got));
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
    const str = (v) => (typeof v === 'string' ? v : undefined);
    return {
      agentType: str(meta.agentType),
      description: str(meta.description),
      toolUseId: str(meta.toolUseId),
      requestShape: str(meta.requestShape),
      finished: meta.finished === true,
    };
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

// The ids of the calls that have a result in the tail.
function resultIds(events) {
  const ids = new Set();
  for (const event of events) {
    const content = event?.message?.content;
    for (const block of Array.isArray(content) ? content : []) {
      if (block?.type === 'tool_result' && typeof block.tool_use_id === 'string') ids.add(block.tool_use_id);
    }
  }
  return ids;
}

export const CREW_SHOWN = 5;
const STILL_WORKING_MS = 10 * 60 * 1000;

function modifiedAt(file) {
  try {
    return fs.lstatSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

// `crew` holds one line for each subagent still working, newest first, at most five, then
// "and N more crew members". A subagent has finished when its meta says so; or, when it is not a
// background one, its call has a result in the tail; or its file changed more than ten minutes
// before `now`. A background launch's immediate result never means finished.
export function runSteps({ sessionId, env = process.env, glossary, waiting = null, foreman = false, now = Date.now } = {}) {
  const file = findTranscript({ sessionId, env });
  if (!file) return { steps: [], crew: [], crewDid: [] };
  const words = glossary ?? glossaryOf({});
  const events = readTail(file);
  const steps = [];
  for (const event of events) {
    const raw = stepAndKind(event);
    if (!raw) continue;
    const step = withKind(raw, words);
    const decision = foreman ? decisionWork(event) : null;
    if (decision) {
      const line = decision.work ? `The Bosun is deciding what to do about ${decision.work}` : 'The Bosun is deciding what to do';
      steps.push({ at: step.at, text: mask(plain(line)), kind: 'did' });
    } else {
      steps.push({ at: step.at, text: foreman ? mask(plain(inThirdPerson('The Bosun', step))) : step.text, kind: step.kind });
    }
  }
  if (validWaiting(waiting)) {
    const text = `Waiting for your answer to decision ${waiting}`;
    steps.push({ at: steps.length ? steps[steps.length - 1].at : null, text: foreman ? `The Bosun is ${lowerFirst(text)}` : text, kind: 'did' });
  }
  const clock = typeof now === 'function' ? now() : now;
  const subs = findSubagents(file).map((sub) => ({ ...sub, mtime: modifiedAt(sub.file), meta: readMeta(sub.file) }));
  const calls = agentCalls(events);
  const byAgent = callsByAgent(events, calls, subs.map((sub) => sub.agentId));
  const answered = resultIds(events);
  const finished = (sub) => {
    const meta = sub.meta;
    if (meta?.finished === true) return true;
    if (meta && meta.requestShape !== 'background' && meta.toolUseId !== undefined && answered.has(meta.toolUseId)) return true;
    return clock - sub.mtime > STILL_WORKING_MS;
  };
  const working = subs
    .filter((sub) => !finished(sub))
    .sort((a, b) => b.mtime - a.mtime || (a.agentId < b.agentId ? -1 : 1));
  const crew = [];
  // The same lines with a subagent's own words left out, for what a model reads.
  const crewDid = [];
  for (const sub of working.slice(0, CREW_SHOWN)) {
    const call = callOf(sub, calls, byAgent);
    const latest = stepsOfKind(readTail(sub.file), words).pop();
    const fallback = worded({ at: null, text: subagentLine(call ?? {}) }, words).text;
    if (latest) crew.push(mask(plain(inThirdPerson(roleOf(call?.agentType), latest))));
    else crew.push(fallback);
    crewDid.push(latest && latest.kind !== 'said' ? crew[crew.length - 1] : fallback);
  }
  const left = working.length - CREW_SHOWN;
  if (left > 0) {
    crew.push(`and ${left} more crew member${left === 1 ? '' : 's'}`);
    crewDid.push(crew[crew.length - 1]);
  }
  return { steps, crew, crewDid };
}

// The call behind a subagent: its meta's own words, else the call its meta names, else the call whose
// result names it, else null.
function callOf(sub, calls, byAgent) {
  const meta = sub.meta;
  if (meta && (meta.agentType !== undefined || meta.description !== undefined)) {
    return { agentType: meta.agentType, description: meta.description };
  }
  return (meta?.toolUseId !== undefined && calls.get(meta.toolUseId)) || byAgent.get(sub.agentId) || null;
}

// A step with its kind, and for a sent subagent the phrase "sending out ..." through the glossary.
export function withKind(raw, words) {
  const step = { ...worded(raw, words), kind: raw.kind };
  if (raw.kind === 'sent') {
    const phrase = sendPhrase(raw.agent);
    if (phrase) step.phrase = worded({ at: raw.at, text: phrase }, words).text;
  }
  return step;
}

function stepsOfKind(events, words) {
  const out = [];
  for (const event of events) {
    const raw = stepAndKind(event);
    if (raw) out.push(withKind(raw, words));
  }
  return out;
}

const readSmall = (file) => {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 64 * 1024) return null;
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
};

// A running record that says a session is going: its state is `running` and, when it names a process, that process lives.
const liveRecord = (record) => record !== null && record.state === 'running' && (!Number.isInteger(record.pid) || pidAlive(record.pid));

// The latest steps of each piece with a live run, for the Logbook: `{ [work]: { steps, crew } }`. A piece whose level
// is `off` is never opened (design 8.1 rule 6); nor is anything when a record can't be read. The Bosun comes under
// the name `foreman`, on the project's own level, when its running record names a session. `read` stands for `runSteps`.
export function crewNow(project, views, settings, { env = process.env, read = runSteps } = {}) {
  const out = {};
  // Not a project name (a path, say): nothing is opened, deliberately.
  if (typeof project !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(project) || project.includes('..')) return out;
  const glossary = glossaryOf(views?.glossary);
  const ids = Object.keys(views !== null && typeof views === 'object' && views.work !== null && typeof views.work === 'object' ? views.work : {});
  for (const work of ids) {
    // Whatever one piece's records give, the others still show: a failure shows less and never breaks the Logbook.
    try {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(work) || work.includes('..')) continue;
      if (levelFor(views, settings, work) === 'off') continue;
      if (!liveRecord(readSmall(runningFile(project, `feature-${work}`)))) continue;
      const sessionId = readSmall(sessionFile(project, work))?.sessionId;
      if (typeof sessionId !== 'string') continue;
      out[work] = read({ sessionId, env, glossary, waiting: waitingDecision(project, work) });
    } catch {
      // This piece shows no step.
    }
  }
  try {
    if (levelFor(views, settings, 'foreman') !== 'off') {
      const record = readSmall(runningFile(project, 'foreman'));
      if (liveRecord(record) && typeof record.sessionId === 'string') {
        out.foreman = read({ sessionId: record.sessionId, env, glossary, foreman: true });
      }
    }
  } catch {
    // The Bosun shows no step.
  }
  return out;
}

// The transcript page: the run so far as Markdown, kept on this computer.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const PAGE_MAX = 2 * 1024 * 1024;
const RESULT_CHARS = 160;
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };

// Transcript text made safe for a Markdown page: one line, keys hidden, then every character that
// Markdown or HTML would act on written as plain text. Keys are hidden first, while they can still
// be recognised.
export function escapeMarkdown(text) {
  return mask(plain(text)).replace(/[&<>\\`*_[\]#|]/g, (c) => ESCAPES[c] ?? `\\${c}`);
}

function writtenAt(now) {
  const value = typeof now === 'function' ? now() : now;
  const d = value instanceof Date ? value : new Date(value ?? Date.now());
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function blocksOf(event) {
  const content = event?.message?.content;
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return Array.isArray(content) ? content : [];
}

// What each tool call returned, as one cut line: call id -> text. Only its first 160 characters
// are kept, and only after the whole text has been checked for a key.
function resultLines(events) {
  const results = new Map();
  for (const event of events) {
    for (const block of blocksOf(event)) {
      if (block?.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue;
      const c = block.content;
      const raw = typeof c === 'string' ? c
        : Array.isArray(c) ? c.map((part) => (typeof part?.text === 'string' ? part.text : '')).join(' ') : '';
      const whole = mask(plain(raw));
      if (whole === '') continue;
      results.set(block.tool_use_id, whole === HIDDEN ? whole : whole.slice(0, RESULT_CHARS).trim());
    }
  }
  return results;
}

// One run's events as page lines, oldest first.
function eventLines(events) {
  const results = resultLines(events);
  const lines = [];
  for (const event of events) {
    if (event?.type !== 'assistant') continue;
    for (const block of blocksOf(event)) {
      if (block?.type === 'text' && typeof block.text === 'string') {
        const said = escapeMarkdown(block.text);
        if (said !== '') lines.push('', said, '');
      } else if (block?.type === 'tool_use') {
        const step = stepsOf([{ ...event, message: { content: [block] } }])[0];
        if (!step) continue;
        lines.push(`- ${escapeMarkdown(step.text)}`);
        // A decision's question is never shown, so nothing the call returned is either.
        const result = step.text === 'Recording a decision' ? undefined : results.get(block.id);
        if (result) lines.push(`  ${escapeMarkdown(result)}`);
      }
    }
  }
  return lines;
}

export function renderPage({ work, events = [], subagents = [], waiting = null, now = Date.now } = {}) {
  const out = [
    `# ${escapeMarkdown(work)}: what the crew did`,
    '',
    `Written ${writtenAt(now)}. Kept on this computer only.`,
    '',
  ];
  const own = eventLines(Array.isArray(events) ? events : []);
  out.push(...(own.some((l) => l !== '') ? own : ['No transcript yet.']));
  for (const sub of Array.isArray(subagents) ? subagents : []) {
    out.push('', `## ${escapeMarkdown(sub?.line)}`, '');
    const lines = eventLines(Array.isArray(sub?.events) ? sub.events : []);
    out.push(...(lines.some((l) => l !== '') ? lines : ['No transcript yet.']));
  }
  if (validWaiting(waiting)) out.push('', `Waiting for your answer to decision ${waiting}`);
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

export function pagePath(project, work) {
  return path.join(project, '.wheelhouse', 'watch', `${work}.md`);
}

function missing(file) {
  try {
    fs.lstatSync(file);
    return false;
  } catch {
    return true;
  }
}

// Writes the run's page and returns its path. `sessionId` is the piece's session; without one the
// page says there is no transcript yet. Refuses (null) when `.wheelhouse`, `.wheelhouse/watch` or
// the page is a link or not what it should be, or `work` is not a feature slug. Writes only the page.
export function writePage(project, work, { sessionId, env = process.env, now = Date.now, waiting = null } = {}) {
  if (typeof project !== 'string' || project === '' || typeof work !== 'string' || !SLUG.test(work)) return null;
  const root = path.join(project, '.wheelhouse');
  const dir = path.join(root, 'watch');
  const file = pagePath(project, work);
  try {
    for (const folder of [root, dir]) {
      if (missing(folder)) fs.mkdirSync(folder, { mode: 0o700 });
      else if (!fs.lstatSync(folder).isDirectory()) return null;
    }
    if (!missing(file) && !plainFile(file)) return null;
    const transcript = findTranscript({ sessionId, env });
    const events = transcript ? readTail(transcript, { max: PAGE_MAX }) : [];
    const callsFor = agentCalls(events);
    const subs = transcript ? findSubagents(transcript) : [];
    const byAgent = callsByAgent(events, callsFor, subs.map((s) => s.agentId));
    const subagents = subs.map((sub) => {
      const call = callOf({ ...sub, meta: readMeta(sub.file) }, callsFor, byAgent);
      return { line: subagentLine(call ?? {}), events: readTail(sub.file, { max: PAGE_MAX }) };
    });
    const page = renderPage({ work, events, subagents, waiting, now });
    // A temporary name no earlier run can have left behind; the page is for this computer's user only.
    const temp = path.join(dir, `.${work}.md.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
    try {
      fs.writeFileSync(temp, page, { flag: 'wx', mode: 0o600 });
      fs.renameSync(temp, file);
    } catch (error) {
      fs.rmSync(temp, { force: true });
      throw error;
    }
    return file;
  } catch {
    return null;
  }
}

// The piece's page for a command: its session found, and nothing opened for a piece at `off`.

const SESSION_RECORD_MAX = 64 * 1024;
const FOLLOW_MS = 2000;
const FOLLOW_FIRST = 10;
const TEMP_PAGE = /^\..+\.tmp$/;
const TEMP_AGE_MS = 60 * 1000;

// The session the watcher kept for a piece, read as the watcher's other readers read it; null when there is none.
export function sessionIdOf(project, work) {
  if (typeof project !== 'string' || typeof work !== 'string' || !SLUG.test(work)) return null;
  try {
    const kept = JSON.parse(readCapped(sessionFile(project, work), SESSION_RECORD_MAX) ?? 'null');
    return kept !== null && typeof kept === 'object' && safeId(kept.sessionId) ? kept.sessionId : null;
  } catch {
    return null;
  }
}

// Writes a piece's page, unless its watch level is `off` (design 8.1, rule 6): then nothing is opened and the answer is
// null. `level` is the level just read (a string), or a function that reads it. This is the only way the page is written
// for a piece, so every caller is held to the level. `project` is the project's name; `folder` is its main folder.
export function writePiecePage({ project, folder, work, level, env = process.env, now = Date.now, waiting = null } = {}) {
  const at = typeof level === 'function' ? level() : level;
  if (!LEVELS.includes(at) || at === 'off') return null;
  return writePage(folder, work, { sessionId: sessionIdOf(project, work), env, now, waiting });
}

// The number of the oldest decision waiting on the director for a piece, or null. An unreadable record gives null.
export function waitingDecision(project, work) {
  try {
    return readDecisions(project).pending.find((d) => d.workId === work)?.n ?? null;
  } catch {
    return null;
  }
}

const NONE = (work) => `There is no open piece called ${work}.`;
const NOT_STARTED = (work) => `${work} has not started yet, so there is nothing to watch.`;

// "watch <work>", in the helper: checks the piece is open and has started, raises it to the transcript level when it is
// below it (`raise` records that, and nothing is recorded before the checks), and writes its page. Resolves `{ file }`, or
// `{ said }`, one line, when there is no page to write. `project` is the project's name, `folder` its main folder.
export async function pageFor({
  project, folder, work, raise, env = process.env, now = () => new Date(),
} = {}) {
  if (typeof work !== 'string' || !SLUG.test(work)) return { said: NONE(work) };
  const read = () => {
    const views = buildViews(listEvents(stateDir(project), { report: () => {} }), readEnrolled());
    return { views, level: levelFor(views, effectiveSettings({ project: views.settings, now }), work) };
  };
  let { views, level } = read();
  if (!isOpen(views, work)) return { said: NONE(work) };
  const feature = views.features?.[work]?.data;
  if (feature === null || typeof feature !== 'object' || feature.step === 'closed') return { said: NOT_STARTED(work) };
  if (level !== 'transcript') {
    await raise();
    ({ level } = read());
  }
  if (level !== 'transcript') return { said: NOT_STARTED(work) };
  const file = writePiecePage({ project, folder, work, level, env, now, waiting: waitingDecision(project, work) });
  return file === null ? { said: `The page for ${work} couldn't be written.` } : { file };
}

// Whether the piece is open and the level it is watched at, from the project's records. A record that can't be read gives
// a piece that is not open, at off.
export function pieceState(project, work, { now = () => new Date() } = {}) {
  try {
    const views = buildViews(listEvents(stateDir(project), { report: () => {} }), readEnrolled());
    return { open: isOpen(views, work), level: levelFor(views, effectiveSettings({ project: views.settings, now }), work) };
  } catch {
    return { open: false, level: 'off' };
  }
}

// Removes the page of every piece that is not open, and says which it removed. Only a plain file in the watch folder named
// for a piece is removed; a link, a folder or anything else is left alone. `views` is the records' views, or a function that
// reads them, called only when there is a page to look at.
export function prunePages(folder, views) {
  const dir = path.join(folder, '.wheelhouse', 'watch');
  const removed = [];
  let names;
  try {
    if (!fs.lstatSync(dir).isDirectory()) return removed;
    names = fs.readdirSync(dir);
  } catch {
    return removed;
  }
  const pages = names.filter((name) => /^[a-z0-9-]{1,40}\.md$/.test(name));
  // A temporary file an interrupted write left behind: dot-prefixed, ending `.tmp`, a plain file, over a minute old.
  for (const name of names) {
    if (!TEMP_PAGE.test(name)) continue;
    const file = path.join(dir, name);
    try {
      const stat = fs.lstatSync(file);
      if (stat.isFile() && Date.now() - stat.mtimeMs > TEMP_AGE_MS) fs.rmSync(file);
    } catch {
      // left for the next look
    }
  }
  if (pages.length === 0) return removed;
  const seen = typeof views === 'function' ? views() : views;
  for (const name of pages) {
    const m = /^([a-z0-9-]{1,40})\.md$/.exec(name);
    if (isOpen(seen, m[1])) continue;
    const file = path.join(dir, name);
    if (!plainFile(file)) continue;
    try {
      fs.rmSync(file);
      removed.push(m[1]);
    } catch {
      // left for the next look
    }
  }
  return removed;
}

// --follow: the page rewritten every two seconds, each new step printed. Stops when the piece closes, or goes to `off`
// (the level is read again on every tick, and nothing of the transcript is opened once it is off). Resolves the exit code.
export async function follow({
  project, folder, work, out = (t) => process.stdout.write(t), err = (t) => process.stderr.write(t),
  env = process.env, now = () => new Date(), intervalMs = FOLLOW_MS, state = pieceState, waiting = waitingDecision,
  sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
} = {}) {
  const say = (line) => out(`${line}\n`);
  let seen = new Map();
  let first = true;
  let told = null;
  for (;;) {
    const { open, level } = state(project, work, { now });
    if (!open) {
      if (first) {
        err(`There is no open piece called ${work}.\n`);
        return 1;
      }
      say(`${work} has closed, so there is nothing more to follow.`);
      return 0;
    }
    if (level === 'off') {
      say(`Watching ${work} is off, so the page is no longer written and its run is no longer read.`);
      return 0;
    }
    const sessionId = sessionIdOf(project, work);
    const pending = waiting(project, work);
    // The page belongs to the transcript level; below it the steps are followed alone.
    const file = level === 'transcript' ? writePiecePage({ project, folder, work, level, env, now, waiting: pending }) : null;
    if (first) {
      say(level !== 'transcript'
        ? `Following ${work}. Its watch level is below the full transcript, so no page is written. Stop with Ctrl-C.`
        : file === null ? `The page for ${work} can't be written here. Following the steps only.` : `Following ${work}. The page is at \`${file}\`. Stop with Ctrl-C.`);
    }
    const transcript = findTranscript({ sessionId, env });
    // What the crew said is left out: only what it did reaches the terminal.
    const events = transcript ? readTail(transcript, { max: PAGE_MAX }).filter((event) => stepAndKind(event)?.kind !== 'said') : [];
    const steps = stepsOf(events);
    const counts = new Map();
    let fresh = [];
    for (const step of steps) {
      const key = `${step.at}|${step.text}`;
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      if (n > (seen.get(key) ?? 0)) fresh.push(step);
    }
    if (first) fresh = fresh.slice(-FOLLOW_FIRST);
    for (const step of fresh) say(step.text);
    if (pending !== told) {
      if (validWaiting(pending)) say(`Waiting for your answer to decision ${pending}`);
      told = pending;
    }
    seen = counts;
    first = false;
    await sleep(intervalMs);
  }
}

async function main(argv) {
  const say = (line) => process.stderr.write(`${line}\n`);
  const named = argv.length === 4 && argv[2] === '--folder';
  if (argv[0] === '--follow' && process.env.CLAUDECODE) {
    say("--follow is for the director's own terminal, not for a Claude Code session, so it won't run here.");
    return 1;
  }
  if ((argv.length !== 2 && !named) || argv[0] !== '--follow' || !SLUG.test(argv[1])) {
    say('Usage: runs.js --follow <work> [--folder <the project\'s folder>]');
    return 1;
  }
  const { projectOf } = await import('../hooks/kit.js');
  const found = projectOf(named ? argv[3] : process.cwd());
  const folder = found === null ? null : found.record?.folder;
  if (found === null || typeof folder !== 'string') {
    say("This folder isn't a Wheelhouse project.");
    return 1;
  }
  return follow({ project: found.project, folder, work: argv[1] });
}

if (startedAsScript(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
