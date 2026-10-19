// probes/39-transcripts/run.js
// Check 39: what Claude Code's transcript files show about a message and a turn.
//
// Two modes:
//
//   node probes/39-transcripts/run.js [--keep]
//     The scratch run. Makes a throwaway project under the temporary folder
//     with one project hook (hooks/context.js adds context at SessionStart and
//     UserPromptSubmit), then:
//       1. holds one `claude -p --input-format stream-json` session open (the
//          stand-in for the director's own session), with this script as its
//          permission host (`--permission-prompt-tool stdio`, as the Agent
//          SDK's canUseTool), and sends it, one at a time: a plain message; a
//          request to ask one AskUserQuestion, which the script answers as a
//          click on "Approve"; a request to start one background subagent, whose
//          end comes back as a task notification; and a reply code typed as a
//          message ("K7QD Approve");
//       2. relays one message into the same session from a second process, by
//          the route the watcher uses (scripts/watcher/waker.js, check 27):
//          `claude -p --resume <session id> "Wheelhouse: read relay.md"`;
//       3. reads the session's transcript and its subagent files and prints,
//          for every entry, its type, the fields present and any marker of
//          where it came from, then the same summary the --mine mode prints.
//     The report goes to <home>/.wheelhouse-probes/39-transcripts/, and a copy
//     with ids and folders masked to probes/39-transcripts/reports/scratch.txt.
//     No model is named: the default answers, unless WHEELHOUSE_PROBE_MODEL is
//     set (an alias, never written into the repository). A few cheap turns.
//
//   node probes/39-transcripts/run.js --mine [--days 7] [--out <file>]
//     Reads the transcripts under ~/.claude/projects/ changed in the last
//     `days` days (sessions and subagent files), and prints ONLY entry types,
//     field names (key paths), kinds of marker (known prefixes, the names of
//     leading tags, enumerated values such as `entrypoint` and `origin.kind`)
//     and counts. Never message text, `cwd` values, paths, session ids, model
//     names, project or folder names. The output is written under the
//     temporary folder (or to --out, which must be outside the repository)
//     and is never committed.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { withoutHostVariables } from '../../scripts/lib/claude.js';
import { probeLogDir } from '../lib/log.js';
import { assertUnderTmp, makeScratchProject } from '../lib/scratch.js';

const probeDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(probeDir, '..', '..');
const projectsRoot = path.join(os.homedir(), '.claude', 'projects');
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const DAY = 24 * 60 * 60 * 1000;

// ------------------------------------------------------------ the analysis

// Prefixes that mark where a user entry's text came from. The probe tests for
// these and counts them; it never prints the text.
export const KNOWN_PREFIXES = [
  '<task-notification>',
  '<side-sessions-event',
  '<system-reminder>',
  '<command-name>',
  '<command-message>',
  '<command-args>',
  '<local-command-stdout>',
  '<local-command-stderr>',
  '<local-command-caveat>',
  '<bash-input>',
  '<bash-stdout>',
  '<bash-stderr>',
  '<user-prompt-submit-hook>',
  '<teammate-message',
  '<channel',
  'Wheelhouse foreman:',
  'Wheelhouse:',
  '[Request interrupted by user',
  'Caveat:',
  'This session is being continued from a previous conversation',
  'Base directory for this skill:',
];

// A message that is only a reply code and one of the signed options (design, section 17.1).
export const REPLY_CODE = /^[A-Z0-9]{4} (Approve|Confirm|Lift STOP|Do it|Push it)$/;

// Fields whose values are kinds (short enumerated words), which may be printed.
const ENUM_FIELDS = new Set([
  'type', 'subtype', 'attachment.type', 'userType', 'entrypoint', 'origin', 'origin.kind', 'permissionMode',
  'level', 'operation', 'message.role', 'message.type', 'message.stop_reason', 'toolUseResult.status',
  'toolUseResult.type', 'hookEvent', 'attachment.hookEvent', 'attachment.hookName', 'version', 'mode', 'promptSource',
  'message.content[].type', 'source', 'turnOrigin', 'turnOrigin.kind', 'origin.producer', 'origin.fromMode',
  'origin.handback', 'sessionKind', 'turnCompanion', 'turnCompanion.kind', 'toolDenialKind',
  'attachment.origin.kind', 'attachment.commandMode', 'renderedInHumanTurn', 'renderedRole',
]);
const ENUM_VALUE = /^[A-Za-z0-9_:.-]{1,40}$/;
// A key that is a field name; anything else (a question's text, a file name) is shown as <key>.
const FIELD_NAME = /^[A-Za-z_$][A-Za-z0-9_$]{0,40}$/;
const MAX_DEPTH = 4;

// Every key path in a value. Arrays become `[]`; the blocks of a message's
// content are told apart by their type (`message.content[text].text`).
export function keyPaths(value, prefix = '', out = new Set(), depth = 0) {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 50)) {
      const tag = item && typeof item === 'object' && !Array.isArray(item) && typeof item.type === 'string' && ENUM_VALUE.test(item.type) && /content$/.test(prefix)
        ? `[${item.type}]` : '[]';
      const p = `${prefix}${tag}`;
      out.add(p);
      keyPaths(item, p, out, depth + 1);
    }
    return out;
  }
  for (const [key, inner] of Object.entries(value)) {
    const name = FIELD_NAME.test(key) ? key : '<key>';
    const p = prefix ? `${prefix}.${name}` : name;
    out.add(p);
    // A tool's input and a tool's own result are shown one level down only.
    const shallow = /(^|\.)(input|toolUseResult|structuredPatch|trackedFileBackups|snapshot)$/.test(p);
    if (!shallow) keyPaths(inner, p, out, depth + 1);
    else if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      for (const k of Object.keys(inner)) out.add(`${p}.${FIELD_NAME.test(k) ? k : '<key>'}`);
    }
  }
  return out;
}

// The kind of marker a text carries: a known prefix, a reply code, a leading
// tag's name, or none. Never the text itself.
export function textMarker(text) {
  const t = String(text ?? '').trimStart();
  for (const prefix of KNOWN_PREFIXES) if (t.startsWith(prefix)) return prefix;
  if (REPLY_CODE.test(t.trim())) return 'reply-code';
  const tag = /^<([a-z][a-z0-9_-]{0,40})[\s>]/.exec(t);
  if (tag) return `<${tag[1]}> (other tag)`;
  return t === '' ? 'empty' : 'plain text';
}

// Known tags found anywhere in a text (not only at its start).
export function embeddedTags(text) {
  const t = String(text ?? '');
  return KNOWN_PREFIXES.filter((p) => p.startsWith('<') && t.includes(p));
}

function enumValue(v) {
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'string' && ENUM_VALUE.test(v)) return v;
  if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.kind === 'string' && ENUM_VALUE.test(v.kind)) return `{kind:${v.kind}}`;
  return v === undefined ? undefined : `<${Array.isArray(v) ? 'array' : typeof v}>`;
}

// One user entry's signature: where it came from, as far as its fields and
// its text's prefix say.
export function userSignature(entry, toolNames, { firstPrompt = false } = {}) {
  const content = entry.message?.content;
  const parts = [];
  if (typeof content === 'string') {
    parts.push(`string:${textMarker(content)}`);
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (block?.type === 'tool_result') parts.push(`tool_result(${toolNames.get(block.tool_use_id) ?? 'unknown tool'})`);
      else if (block?.type === 'text') parts.push(`text:${textMarker(block.text)}`);
      else parts.push(String(block?.type ?? 'unknown'));
    }
  } else {
    parts.push(`content:${content === undefined ? 'none' : typeof content}`);
  }
  const flags = [];
  for (const field of ['isMeta', 'isCompactSummary', 'isVisibleInTranscriptOnly', 'isSidechain']) if (entry[field] === true) flags.push(field);
  if (entry.origin !== undefined) flags.push(`origin=${enumValue(entry.origin)}`);
  if (entry.promptSource !== undefined) flags.push(`promptSource=${enumValue(entry.promptSource)}`);
  if (entry.turnOrigin !== undefined) flags.push(`turnOrigin=${enumValue(entry.turnOrigin)}`);
  if (entry.origin && typeof entry.origin === 'object') {
    const extra = Object.keys(entry.origin).filter((k) => k !== 'kind' && FIELD_NAME.test(k)).sort();
    if (extra.length) flags.push(`origin+{${extra.join(',')}}`);
  }
  if (entry.entrypoint !== undefined) flags.push(`entrypoint=${enumValue(entry.entrypoint)}`);
  if (firstPrompt) flags.push('first-prompt');
  if (entry.toolUseResult !== undefined) flags.push('toolUseResult');
  if (entry.sourceToolUseID !== undefined) flags.push('sourceToolUseID');
  if (entry.sourceToolAssistantUUID !== undefined) flags.push('sourceToolAssistantUUID');
  if (entry.promptId !== undefined) flags.push('promptId');
  return `${parts.join(' + ')}${flags.length ? ` | ${flags.join(' ')}` : ''}`;
}

function bump(map, key, n = 1) { map.set(key, (map.get(key) ?? 0) + n); }

export function newTally() {
  return {
    files: { session: 0, subagent: 0 },
    lines: 0, malformed: 0, blank: 0, noTrailingNewline: 0, noType: 0,
    types: new Map(), keysByType: new Map(), enums: new Map(), userSignatures: new Map(),
    embedded: new Map(), attachmentKeys: new Map(), systemSubtypes: new Map(),
    cwd: new Map(), sessionId: new Map(),
    assistant: { entries: 0, withUsage: 0, withModel: 0, withInput: 0, withCacheRead: 0, withCacheCreation: 0, withOutput: 0, withRequestId: 0, sharedMessageId: 0, sharedSameUsage: 0, sharedDifferentUsage: 0, syntheticModel: 0 },
    entrypointByFile: new Map(), promptsByVersion: new Map(), filesWithType: new Map(),
    subagent: { entries: 0, sessionIdIsParent: 0, sessionIdOther: 0, withAgentId: 0, agentIdMatchesFile: 0, sidechain: 0, metaFiles: 0, metaToolUseIdInParent: 0, metaKeys: new Map(), notSidechainTypes: new Map(), firstParentUuidNull: 0 },
  };
}

function keyOfType(entry) {
  const t = typeof entry.type === 'string' ? entry.type : '<no type>';
  if (t === 'system' && entry.subtype) return `system:${enumValue(entry.subtype)}`;
  if (t === 'attachment' && entry.attachment?.type) return `attachment:${enumValue(entry.attachment.type)}`;
  return t;
}

function readLines(file) {
  const text = fs.readFileSync(file, 'utf8');
  return { lines: text.split('\n'), trailing: text.endsWith('\n') || text === '' };
}

// Reads one transcript file into the tally. `parentToolUseIds` (a Set) is
// filled from a session file's tool_use blocks, for linking subagents.
export function tallyFile(tally, file, { kind, parentSessionId = null, agentFileId = null, perEntry = null, toolUseIds = null }) {
  tally.files[kind] += 1;
  const { lines, trailing } = readLines(file);
  if (!trailing) tally.noTrailingNewline += 1;
  const toolNames = new Map();
  let firstEntrypoint = null;
  let first = true;
  let promptSeen = false;
  const typesSeen = new Set();
  lines.forEach((line, index) => {
    if (line.trim() === '') { if (index < lines.length - 1) tally.blank += 1; return; }
    tally.lines += 1;
    let entry;
    try { entry = JSON.parse(line); } catch { tally.malformed += 1; perEntry?.({ index, malformed: true }); return; }
    if (typeof entry.type !== 'string') tally.noType += 1;
    const type = keyOfType(entry);
    typesSeen.add(type);
    bump(tally.types, `${kind}:${type}`);
    let keys = tally.keysByType.get(type);
    if (!keys) { keys = new Map(); tally.keysByType.set(type, keys); }
    for (const p of keyPaths(entry)) bump(keys, p);
    for (const field of ENUM_FIELDS) {
      const v = field.split('.').reduce((o, k) => (o == null ? undefined : o[k]), entry);
      const e = enumValue(v);
      if (e !== undefined && field !== 'type') bump(tally.enums, `${type} ${field}=${e}`);
    }
    if (Array.isArray(entry.message?.content)) {
      for (const block of entry.message.content) {
        if (block?.type === 'tool_use') {
          toolNames.set(block.id, typeof block.name === 'string' && ENUM_VALUE.test(block.name) ? block.name : '<tool>');
          toolUseIds?.add(block.id);
        }
      }
    }
    bump(tally.cwd, `${type} cwd=${'cwd' in entry ? 'yes' : 'no'}`);
    bump(tally.sessionId, `${type} sessionId=${'sessionId' in entry ? 'yes' : 'no'}`);
    if (entry.entrypoint && !firstEntrypoint) firstEntrypoint = enumValue(entry.entrypoint);
    let signature = null;
    if (entry.type === 'user') {
      // The file's first user entry that is a prompt (text, not a tool result or meta).
      const isPrompt = entry.isMeta !== true && (typeof entry.message?.content === 'string'
        || (Array.isArray(entry.message?.content) && !entry.message.content.some((b) => b?.type === 'tool_result')));
      const firstPrompt = isPrompt && !promptSeen;
      signature = userSignature(entry, toolNames, { firstPrompt });
      if (isPrompt) promptSeen = true;
      if (isPrompt && kind === 'session') {
        const firstText = typeof entry.message?.content === 'string' ? entry.message.content
          : (entry.message?.content ?? []).find((b) => b?.type === 'text')?.text;
        bump(tally.promptsByVersion, `${enumValue(entry.version) ?? 'no version'} ${enumValue(entry.entrypoint) ?? 'no entrypoint'} origin=${entry.origin ? enumValue(entry.origin) : 'none'} promptSource=${entry.promptSource ? enumValue(entry.promptSource) : 'none'} turnOrigin=${entry.turnOrigin ? enumValue(entry.turnOrigin) : 'none'}${firstPrompt ? ' first-prompt' : ''} starts ${textMarker(firstText)}`);
      }
      bump(tally.userSignatures, `${kind}: ${signature}`);
      const texts = typeof entry.message?.content === 'string' ? [entry.message.content]
        : Array.isArray(entry.message?.content) ? entry.message.content.filter((b) => b?.type === 'text').map((b) => b.text) : [];
      const from = [entry.isMeta === true ? 'isMeta' : '', entry.origin ? `origin=${enumValue(entry.origin)}` : '', entry.promptSource ? `promptSource=${enumValue(entry.promptSource)}` : '']
        .filter(Boolean).join(' ') || 'no origin fields';
      for (const t of texts) for (const tag of embeddedTags(t)) bump(tally.embedded, `user text holds ${tag} (${from}; starts ${textMarker(t)})`);
    }
    if (entry.type === 'attachment' && entry.attachment && typeof entry.attachment === 'object') {
      const a = `attachment:${enumValue(entry.attachment.type)}`;
      for (const p of keyPaths(entry.attachment)) bump(tally.attachmentKeys, `${a} ${p}`);
      const via = entry.attachment.origin ? ` origin=${enumValue(entry.attachment.origin)}` : '';
      for (const p of ['content', 'prompt', 'text']) {
        if (typeof entry.attachment[p] === 'string') bump(tally.embedded, `${a}${via} .${p}: ${textMarker(entry.attachment[p])}`);
      }
    }
    if (entry.type === 'assistant') {
      const a = tally.assistant;
      a.entries += 1;
      const usage = entry.message?.usage;
      if (usage) a.withUsage += 1;
      if (typeof entry.message?.model === 'string') a.withModel += 1;
      if (entry.message?.model === '<synthetic>') a.syntheticModel += 1;
      if (Number.isFinite(usage?.input_tokens)) a.withInput += 1;
      if (Number.isFinite(usage?.cache_read_input_tokens)) a.withCacheRead += 1;
      if (Number.isFinite(usage?.cache_creation_input_tokens)) a.withCacheCreation += 1;
      if (Number.isFinite(usage?.output_tokens)) a.withOutput += 1;
      if (entry.requestId) a.withRequestId += 1;
    }
    if (kind === 'subagent') {
      const s = tally.subagent;
      s.entries += 1;
      if (entry.sessionId === parentSessionId) s.sessionIdIsParent += 1; else if (entry.sessionId) s.sessionIdOther += 1;
      if (entry.agentId) s.withAgentId += 1;
      if (agentFileId && entry.agentId === agentFileId) s.agentIdMatchesFile += 1;
      if (entry.isSidechain === true) s.sidechain += 1;
      else bump(s.notSidechainTypes, type);
      if (first && 'parentUuid' in entry && entry.parentUuid === null) s.firstParentUuidNull += 1;
    }
    first = false;
    perEntry?.({ index, entry, type, signature });
  });
  // Assistant entries that share one API message (one per content block).
  const byMessage = new Map();
  for (const line of lines) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.type !== 'assistant' || !e.message?.id) continue;
    const list = byMessage.get(e.message.id) ?? [];
    const u = e.message.usage ?? {};
    list.push(JSON.stringify([u.input_tokens, u.cache_read_input_tokens, u.cache_creation_input_tokens]));
    byMessage.set(e.message.id, list);
  }
  for (const list of byMessage.values()) {
    if (list.length < 2) continue;
    tally.assistant.sharedMessageId += list.length;
    if (new Set(list).size === 1) tally.assistant.sharedSameUsage += list.length; else tally.assistant.sharedDifferentUsage += list.length;
  }
  if (kind === 'session') bump(tally.entrypointByFile, `entrypoint=${firstEntrypoint ?? 'none'}`);
  for (const t of typesSeen) bump(tally.filesWithType, `${kind}:${t}`);
  if (kind === 'subagent') bump(tally.entrypointByFile, `subagent entrypoint=${firstEntrypoint ?? 'none'}`);
}

function tallyMeta(tally, metaFile, parentToolUseIds) {
  let meta;
  try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch { bump(tally.subagent.metaKeys, '<unparseable>'); return; }
  tally.subagent.metaFiles += 1;
  for (const k of Object.keys(meta)) bump(tally.subagent.metaKeys, FIELD_NAME.test(k) ? k : '<key>');
  if (meta.toolUseId && parentToolUseIds.has(meta.toolUseId)) tally.subagent.metaToolUseIdInParent += 1;
}

// A session file and everything under <session id>/subagents/.
export function tallySession(tally, sessionFile, options = {}) {
  const sessionId = path.basename(sessionFile, '.jsonl');
  const toolUseIds = new Set();
  tallyFile(tally, sessionFile, { kind: 'session', toolUseIds, perEntry: options.perEntry?.('session') });
  const subDir = path.join(path.dirname(sessionFile), sessionId, 'subagents');
  if (!fs.existsSync(subDir)) return;
  for (const name of fs.readdirSync(subDir).sort()) {
    const full = path.join(subDir, name);
    if (name.endsWith('.jsonl')) {
      const agentFileId = name.replace(/^agent-/, '').replace(/\.jsonl$/, '');
      tallyFile(tally, full, { kind: 'subagent', parentSessionId: sessionId, agentFileId, perEntry: options.perEntry?.(`subagent ${options.mask ? '<agent>' : agentFileId}`) });
    } else if (name.endsWith('.meta.json')) {
      tallyMeta(tally, full, toolUseIds);
    }
  }
}

function sorted(map) { return [...map.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))); }

export function summarise(tally) {
  const out = [];
  const line = (s = '') => out.push(s);
  line(`Files: ${tally.files.session} session files, ${tally.files.subagent} subagent files`);
  line(`Lines: ${tally.lines} entries; malformed ${tally.malformed}; blank lines inside a file ${tally.blank}; files whose last line has no newline ${tally.noTrailingNewline}; entries with no type ${tally.noType}`);
  line('\n== Entry types (file kind:type, count)');
  for (const [k, n] of sorted(tally.types)) line(`  ${n}\t${k}`);
  line('\n== Files holding at least one entry of each type (file kind:type, files)');
  for (const [k, n] of sorted(tally.filesWithType)) line(`  ${n}\t${k}`);
  line('\n== Session file entrypoint (first entry that has one)');
  for (const [k, n] of sorted(tally.entrypointByFile)) line(`  ${n}\t${k}`);
  line('\n== User entries by signature (content shape and marker | flags)');
  for (const [k, n] of sorted(tally.userSignatures)) line(`  ${n}\t${k}`);
  line('\n== Session prompts (not tool results, not meta) by Claude Code version, entrypoint, origin and promptSource');
  for (const [k, n] of [...tally.promptsByVersion.entries()].sort()) line(`  ${n}\t${k}`);
  line('\n== Known tags found anywhere in user text, and attachment text markers');
  for (const [k, n] of sorted(tally.embedded)) line(`  ${n}\t${k}`);
  line('\n== Enumerated values (type field=value)');
  for (const [k, n] of sorted(tally.enums)) line(`  ${n}\t${k}`);
  line('\n== Assistant entries');
  const a = tally.assistant;
  line(`  entries ${a.entries}; with message.usage ${a.withUsage}; with message.model ${a.withModel} (of them "<synthetic>" ${a.syntheticModel}); requestId ${a.withRequestId}`);
  line(`  usage.input_tokens ${a.withInput}; usage.cache_read_input_tokens ${a.withCacheRead}; usage.cache_creation_input_tokens ${a.withCacheCreation}; usage.output_tokens ${a.withOutput}`);
  line(`  entries sharing a message.id with another entry ${a.sharedMessageId} (input, cache read and cache creation the same on each ${a.sharedSameUsage}; they differ ${a.sharedDifferentUsage})`);
  line('\n== cwd and sessionId presence (type field=yes|no)');
  for (const [k, n] of sorted(tally.cwd)) line(`  ${n}\t${k}`);
  for (const [k, n] of sorted(tally.sessionId)) line(`  ${n}\t${k}`);
  line('\n== Subagent files');
  const s = tally.subagent;
  line(`  entries ${s.entries}; sessionId equals the parent session file's id ${s.sessionIdIsParent}; another sessionId ${s.sessionIdOther}`);
  line(`  with agentId ${s.withAgentId}; agentId equals the file's agent-<id> ${s.agentIdMatchesFile}; isSidechain true ${s.sidechain}; files whose first entry has parentUuid null ${s.firstParentUuidNull}`);
  line(`  entries without isSidechain true, by type: ${sorted(s.notSidechainTypes).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`);
  line(`  .meta.json files ${s.metaFiles}; their toolUseId found as a tool_use id in the parent session file ${s.metaToolUseIdInParent}`);
  line(`  .meta.json keys: ${sorted(s.metaKeys).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  line('\n== Field names by entry type (count of entries holding each key path)');
  for (const [type, keys] of [...tally.keysByType.entries()].sort()) {
    line(`  -- ${type}`);
    for (const [k, n] of sorted(keys)) line(`    ${n}\t${k}`);
  }
  line('\n== Attachment key paths');
  for (const [k, n] of sorted(tally.attachmentKeys)) line(`  ${n}\t${k}`);
  return out.join('\n');
}

// ------------------------------------------------------------ --mine

function recentSessionFiles(days) {
  const since = Date.now() - days * DAY;
  const found = [];
  if (!fs.existsSync(projectsRoot)) return found;
  for (const project of fs.readdirSync(projectsRoot)) {
    // The scratch run's own sessions are left out: this pass is about the director's.
    if (project.includes('wheelhouse-probe-')) continue;
    const dir = path.join(projectsRoot, project);
    let names;
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const name of names) {
      if (!/^[0-9a-f-]{36}\.jsonl$/.test(name)) continue;
      const file = path.join(dir, name);
      let newest = fs.statSync(file).mtimeMs;
      const sub = path.join(dir, name.replace(/\.jsonl$/, ''), 'subagents');
      if (fs.existsSync(sub)) for (const s of fs.readdirSync(sub)) newest = Math.max(newest, fs.statSync(path.join(sub, s)).mtimeMs);
      if (newest >= since) found.push(file);
    }
  }
  return found;
}

function mine(argv) {
  const days = Number(argv[argv.indexOf('--days') + 1]) > 0 && argv.includes('--days') ? Number(argv[argv.indexOf('--days') + 1]) : 7;
  const outArg = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : null;
  const outFile = outArg ? path.resolve(outArg) : path.join(os.tmpdir(), `wheelhouse-probe-39-mine-${Date.now()}.txt`);
  // Never inside the repository: the output describes the director's own transcripts.
  const realRepo = fs.realpathSync(repoDir);
  for (const root of [repoDir, realRepo]) {
    if (outFile === root || outFile.startsWith(root + path.sep)) throw new Error('--out must be outside the repository');
  }
  const tally = newTally();
  const files = recentSessionFiles(days);
  for (const file of files) tallySession(tally, file);
  const text = [`Check 39, --mine: transcripts changed in the last ${days} days, read ${new Date().toISOString().slice(0, 10)}.`,
    'Types, field names, kinds of marker and counts only.', '', summarise(tally)].join('\n');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${text}\n`, 'utf8');
  console.log(`Read ${files.length} session files. Written to ${outFile}`);
}

// ------------------------------------------------------------ the scratch run

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const MESSAGES = {
  plain: 'Reply with the single word: ok.',
  ask: 'Use the AskUserQuestion tool once, with one question, "Approve the probe card?", header "Probe", and two options labelled "Approve" and "Not now". When the answer comes back, reply with only the label you received.',
  background: 'Use the Agent tool once to start one general-purpose subagent with run_in_background set to true. Its prompt: "Reply with the single word: sub-ok. Use no tools." Do not wait for it: end your turn straight after starting it with the single word: started.',
  replyCode: 'K7QD Approve',
  relay: 'Wheelhouse: read relay.md',
};

function sessionArgs() {
  const model = process.env.WHEELHOUSE_PROBE_MODEL;
  return ['--setting-sources', 'project', '--permission-mode', 'default', ...(model ? ['--model', model] : [])];
}

const cleanEnv = () => withoutHostVariables(process.env);

async function streamSession({ cwd, sessionId, log }) {
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--max-turns', '6', '--session-id', sessionId, '--permission-prompt-tool', 'stdio', ...sessionArgs()];
  const child = spawn('claude', args, { cwd, env: cleanEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
  const t0 = Date.now();
  const events = [];
  let buffered = '';
  let stderr = '';
  let exited = false;
  child.stdout.on('data', (chunk) => {
    buffered += chunk.toString('utf8');
    let nl;
    while ((nl = buffered.indexOf('\n')) >= 0) {
      const lineText = buffered.slice(0, nl);
      buffered = buffered.slice(nl + 1);
      let event;
      try { event = JSON.parse(lineText); } catch { continue; }
      events.push({ t: Date.now() - t0, ...event });
      // The permission host's part (the Agent SDK's canUseTool): answer an
      // AskUserQuestion as a click on "Approve", and allow anything else.
      if (event.type === 'control_request' && event.request?.subtype === 'can_use_tool') {
        const input = event.request.input ?? {};
        let updatedInput = input;
        if (event.request.tool_name === 'AskUserQuestion') {
          const answers = {};
          for (const q of input.questions ?? []) {
            const labels = (q.options ?? []).map((o) => o.label);
            answers[q.question] = labels.find((l) => l === 'Approve') ?? labels[0] ?? 'Approve';
          }
          updatedInput = { ...input, answers };
        }
        log(`  permission host asked about ${event.request.tool_name}; answered allow${event.request.tool_name === 'AskUserQuestion' ? ' with "Approve"' : ''}`);
        child.stdin.write(`${JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: event.request_id, response: { behavior: 'allow', updatedInput } } })}\n`);
      }
    }
  });
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString('utf8')).slice(-2000); });
  const closed = new Promise((resolve) => { child.on('close', (code) => { exited = true; resolve(code); }); child.on('error', () => { exited = true; resolve(1); }); });
  child.stdin.on('error', () => {});
  const results = () => events.filter((e) => e.type === 'result').length;
  const waitFor = async (test, ms) => { const end = Date.now() + ms; while (!test() && !exited && Date.now() < end) await sleep(250); return test(); };
  const send = async (label, text, { extraResults = 0, ms = 120000 } = {}) => {
    const before = results();
    log(`send ${label} at ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null })}\n`);
    const ok = await waitFor(() => results() >= before + 1 + extraResults, ms);
    const last = events.filter((e) => e.type === 'result').at(-1);
    log(`  ${ok ? 'answered' : 'no result in time'}: ${last ? `${last.subtype} turns=${last.num_turns} "${String(last.result ?? '').slice(0, 60)}"` : 'none'}`);
  };
  await send('plain', MESSAGES.plain);
  await send('ask', MESSAGES.ask);
  // The background subagent's end comes back as a notification, which starts a turn of its own.
  await send('background', MESSAGES.background, { extraResults: 1, ms: 150000 });
  await send('replyCode', MESSAGES.replyCode);
  child.stdin.end();
  const killer = setTimeout(() => child.kill('SIGKILL'), 60000);
  const code = await closed;
  clearTimeout(killer);
  const kinds = new Map();
  for (const e of events) bump(kinds, e.subtype ? `${e.type}:${e.subtype}` : e.type);
  log(`stream session exited ${code}; events: ${sorted(kinds).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  if (code !== 0 && stderr) log(`stderr: ${stderr.slice(-400)}`);
  return { events };
}

function relay({ cwd, sessionId, log }) {
  const t0 = Date.now();
  const r = spawnSync('claude', ['-p', MESSAGES.relay, '--resume', sessionId, '--output-format', 'json', '--max-turns', '4', ...sessionArgs()],
    { cwd, env: cleanEnv(), encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
  let result = null;
  try { result = JSON.parse(r.stdout); } catch { /* not JSON */ }
  log(`relay by a second process: exit ${r.status} in ${((Date.now() - t0) / 1000).toFixed(1)} s; same session id ${result?.session_id === sessionId}; result "${String(result?.result ?? r.stderr ?? '').slice(0, 60)}"`);
}

function findTranscript(sessionId) {
  for (const project of fs.existsSync(projectsRoot) ? fs.readdirSync(projectsRoot) : []) {
    const file = path.join(projectsRoot, project, `${sessionId}.jsonl`);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function describeEntry(entry, type, signature) {
  const keys = Object.keys(entry).filter((k) => !['message', 'toolUseResult', 'attachment', 'snapshot'].includes(k));
  const marks = [];
  for (const f of ['userType', 'entrypoint', 'isMeta', 'isSidechain', 'isCompactSummary', 'isVisibleInTranscriptOnly', 'promptId', 'agentId', 'requestId', 'cwd', 'sessionId']) {
    if (f in entry) marks.push(['isMeta', 'isSidechain', 'isCompactSummary', 'isVisibleInTranscriptOnly', 'userType', 'entrypoint'].includes(f) ? `${f}=${enumValue(entry[f])}` : f);
  }
  if (entry.origin !== undefined) marks.push(`origin=${JSON.stringify(entry.origin)}`);
  let detail = '';
  if (entry.type === 'assistant') {
    const u = entry.message?.usage ?? {};
    const blocks = (entry.message?.content ?? []).map((b) => (b.type === 'tool_use' ? `tool_use(${b.name})` : b.type)).join(',');
    detail = ` blocks=[${blocks}] model=${entry.message?.model ? 'yes' : 'no'} in=${u.input_tokens} cacheRead=${u.cache_read_input_tokens} cacheCreate=${u.cache_creation_input_tokens} out=${u.output_tokens}`;
  }
  if (entry.type === 'user') {
    const c = entry.message?.content;
    const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => (b.type === 'text' ? b.text : b.type === 'tool_result' ? `[tool_result] ${typeof b.content === 'string' ? b.content : JSON.stringify(b.content)}` : `[${b.type}]`)).join(' ') : '';
    const result = entry.toolUseResult && typeof entry.toolUseResult === 'object' && !Array.isArray(entry.toolUseResult)
      ? ` toolUseResult keys=${Object.keys(entry.toolUseResult).join(',')}` : '';
    const decision = entry.permissionDecision ? ` permissionDecision=${JSON.stringify(entry.permissionDecision)}` : '';
    detail = ` sig=${signature}${result}${decision} text="${text.replace(/\s+/g, ' ').slice(0, 70)}"`;
  }
  if (entry.type === 'attachment') {
    const a = entry.attachment ?? {};
    // Only a hook's own output is shown; other attachments (the skill list, the
    // environment) describe this computer.
    const own = /^hook_/.test(String(a.type)) ? ` content=${JSON.stringify(a.content).slice(0, 80)}` : '';
    detail = ` attachment keys=${Object.keys(a).join(',')}${a.hookEvent ? ` hookEvent=${a.hookEvent}` : ''}${own}`;
  }
  if (entry.type === 'system') detail = ` content="${String(entry.content ?? '').slice(0, 60)}"`;
  return `${type} keys=${keys.join(',')}${marks.length ? ` | ${marks.join(' ')}` : ''}${detail}`;
}

async function scratch(argv) {
  const logDir = probeLogDir('39-transcripts');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const lines = [];
  const log = (s) => { lines.push(s); console.log(s); };
  const which = spawnSync('claude', ['--version'], { encoding: 'utf8', env: cleanEnv() });
  log(`Check 39, scratch run, ${new Date().toISOString().slice(0, 10)}; Claude Code ${String(which.stdout).trim()}; model ${process.env.WHEELHOUSE_PROBE_MODEL ? 'from WHEELHOUSE_PROBE_MODEL' : 'the default'}`);
  const hook = (file) => ({ type: 'command', command: `node "${path.join(probeDir, 'hooks', file)}"` });
  const project = await makeScratchProject({
    name: '39-transcripts',
    settings: {
      hooks: {
        SessionStart: [{ hooks: [hook('context.js')] }],
        UserPromptSubmit: [{ hooks: [hook('context.js')] }],
      },
    },
    files: { 'relay.md': 'Reply with the single word: relayed. Use no tools.\n' },
  });
  const sessionId = crypto.randomUUID();
  let transcript = null;
  try {
    await streamSession({ cwd: project.dir, sessionId, log });
    relay({ cwd: project.dir, sessionId, log });
    await sleep(2000);
    transcript = findTranscript(sessionId);
    if (!transcript) { log('No transcript found for the session.'); return; }
    log('\n== Every entry, in order (scratch session only)');
    const tally = newTally();
    tallySession(tally, transcript, {
      perEntry: (label) => ({ index, entry, type, signature, malformed }) => {
        log(malformed ? `${label} #${index} MALFORMED` : `${label} #${index} ${describeEntry(entry, type, signature)}`);
      },
    });
    log('\n== Summary');
    log(summarise(tally));
  } finally {
    const full = lines.join('\n');
    fs.writeFileSync(path.join(logDir, `scratch-${stamp}.txt`), `${full}\n`, 'utf8');
    // The kept copy: ids, folders and the home folder masked.
    const realTmp = fs.realpathSync(os.tmpdir());
    let masked = full.split(fs.realpathSync(project.dir)).join('<scratch>').split(project.dir).join('<scratch>');
    masked = masked.split(realTmp).join('<tmp>').split(os.homedir()).join('<home>').split(repoDir).join('<repo>');
    masked = masked.replace(/\/Users\/[^/\s"]+/g, '<home>').replace(UUID, '<uuid>').replace(/\ba[0-9a-f]{16}\b/g, '<agent id>').replace(/"runId":"[^"]+"/g, '"runId":"<id>"')
      .replace(/"(msg|req|toolu)_[A-Za-z0-9]+"/g, '"$1_<id>"').replace(/claude-[a-z0-9-]+-\d[\w-]*/gi, '<model>');
    fs.mkdirSync(path.join(probeDir, 'reports'), { recursive: true });
    fs.writeFileSync(path.join(probeDir, 'reports', 'scratch.txt'), `${masked}\n`, 'utf8');
    if (!argv.includes('--keep')) await project.cleanup();
    log(`\nFull report: ${path.join(logDir, `scratch-${stamp}.txt`)}; masked copy: probes/39-transcripts/reports/scratch.txt`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--mine')) mine(argv);
  else await scratch(argv);
}
