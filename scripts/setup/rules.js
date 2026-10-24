// scripts/setup/rules.js
// Step 5, Rules found (design sections 9 and 15; plan ruling P7): the rules an existing project
// already follows, found in its CLAUDE.md, its README, its docs and the instruction files of another
// agent setup (AGENTS.md and the like), each quoted with where it was found and
// matched back to the director's own words where their past sessions in this folder hold them.
//
// The step asks nothing. The rules are followed as they are: it settles at once, recording how many
// it found and saying so, and finishSetup passes the rules themselves into the survey
// (scripts/setup/health.js), where the intake confirms one as a ruling when it first matters.
//
// Every quote, from the project's files or from a transcript, goes through the secret scan before
// it is kept: a rule holding one is left out, and a transcript's words holding one are not used.
// The transcripts are read here, by the helper, outside the agents' sandbox, and never more than
// TRANSCRIPT_BYTES of them.
import fs from 'node:fs';
import path from 'node:path';
import { SETUP_TITLES } from '../state/card-lines.js';
import { scanContent } from '../state/secret-scan.js';
import { hide } from '../lib/clean.js';
import { instructionsOf } from '../survey/look.js';
import { readJournal } from './journal.js';
import { connectedProject, waitForProject, readmeOf, readStart, isFile } from './questions.js';

// What is read: each file up to FILE_BYTES, at most DOC_FILES files under docs/, and of the
// transcripts at most TRANSCRIPT_BYTES in all, each file's first TRANSCRIPT_FILE_BYTES.
export const FILE_BYTES = 256 * 1024;
export const DOC_FILES = 200;
export const TRANSCRIPT_BYTES = 16 * 1024 * 1024;
export const TRANSCRIPT_FILE_BYTES = 4 * 1024 * 1024;
// How much of a transcript is read to tell whether its session was in the folder, which costs
// nothing of TRANSCRIPT_BYTES, and of at most how many transcripts.
export const PROBE_BYTES = 16 * 1024;
export const PROBE_FILES = 2000;
// A rule is a sentence of at most RULE_CHARS characters and at least three words.
export const RULE_CHARS = 300;

const caseBlind = process.platform === 'win32' || process.platform === 'darwin';
const keyOf = (p) => {
  const text = p.normalize('NFC');
  return caseBlind ? text.toLowerCase() : text;
};

// Words that begin an instruction: a sentence starting with one, capitalised, reads as a rule.
const IMPERATIVES = new Set([
  'add', 'answer', 'ask', 'avoid', 'build', 'call', 'check', 'commit', 'create', 'delete', 'deploy', 'describe', 'document',
  'ensure', 'explain', 'follow', 'format', 'give', 'include', 'keep', 'label', 'leave', 'limit', 'make', 'mark', 'merge',
  'name', 'open', 'pin', 'prefer', 'push', 'put', 'read', 'refer', 'remove', 'reply', 'report', 'respond', 'review', 'run',
  'say', 'sort', 'start', 'stop', 'store', 'talk', 'tell', 'test', 'treat', 'update', 'use', 'write',
]);
// The words that make any sentence a rule (design section 9's "always", "never", "must", "don't").
const RULE_WORDS = /(?<![\p{L}\p{N}])(?:always|never|must|mustn['’]t|don['’]t|do not)(?![\p{L}\p{N}])/iu;
// An instruction followed by a command is a step to run, not a rule: "Run npm install", "Use
// `npm test`".
const COMMANDS = new Set([
  'npm', 'npx', 'yarn', 'pnpm', 'bun', 'node', 'deno', 'git', 'gh', 'glab', 'brew', 'pip', 'pip3', 'python', 'python3', 'cd', 'make',
  'docker', 'curl', 'wget', 'bash', 'sh', 'cargo', 'go', 'claude',
]);
// A README's or doc's section of steps to follow, not rules: installing, setting up, running.
const STEPS_HEADING = /^#{1,6}\s*(?:\d+[.)]?\s*)?(?:install(?:ation|ing)?|getting started|set ?up|setting up|usage|quick ?start|running|development|build(?:ing)?|requirements|prerequisites)\b/i;

const relative = (folder, file) => path.relative(folder, file).split(path.sep).join('/');



// The Markdown files under docs/, sorted, at most DOC_FILES, never through a link.
function docsOf(folder) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= DOC_FILES) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') walk(full);
      else if (e.isFile() && /\.(?:md|markdown)$/i.test(e.name)) out.push(full);
    }
  };
  walk(path.join(folder, 'docs'));
  return out;
}

// The instruction files of another agent setup that read as text: Markdown, Cursor's .mdc, and the
// plain .cursorrules and .windsurfrules.
const TEXT_INSTRUCTIONS = /(?:\.(?:md|markdown|mdc)|(?:^|\/)\.(?:cursorrules|windsurfrules))$/i;

// The files rules are looked for in, in order: CLAUDE.md, the README, docs/, then another agent
// setup's instruction files. `own` marks the files that are all instruction, not prose with some.
function ruleFiles(folder) {
  const claude = ['CLAUDE.md', path.join('.claude', 'CLAUDE.md')].map((f) => path.join(folder, f)).filter(isFile);
  const readme = readmeOf(folder);
  const others = instructionsOf(folder).files.filter((f) => TEXT_INSTRUCTIONS.test(f)).map((f) => path.join(folder, ...f.split('/')));
  const seen = new Set();
  return [
    ...claude.map((file) => ({ file, own: true })),
    ...(readme ? [{ file: readme, own: false }] : []),
    ...docsOf(folder).map((file) => ({ file, own: false })),
    ...others.map((file) => ({ file, own: true })),
  ].filter(({ file }) => !seen.has(file) && seen.add(file));
}

// A line of Markdown as plain words: no list marker, quote mark or emphasis. Null for a line that
// is no sentence: a heading, a table row, markup, a comment or a rule line.
function prose(line) {
  const text = line.trim();
  if (text === '' || /^(?:#|\||<|!\[|---|===|\*\*\*|```|~~~|\[[^\]]*\]:)/.test(text)) return null;
  return text.replace(/^(?:>\s*)+/, '').replace(/^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '').replace(/\*\*|__/g, '').trim() || null;
}

// The sentences of a line of plain words.
function sentences(text) {
  return text.split(/(?<=[.!?])\s+(?=[\p{Lu}"'“‘`*])/u).map((s) => s.trim()).filter(Boolean);
}

// Whether a sentence reads as a rule: it holds always, never, must or don't, or starts with an
// instruction, and is at least three words and at most RULE_CHARS characters.
function ruleLike(sentence) {
  const words = sentence.split(/\s+/);
  if (words.length < 3 || sentence.length > RULE_CHARS) return false;
  if (RULE_WORDS.test(sentence)) return true;
  const first = words[0].replace(/[^\p{L}]/gu, '');
  if (!/^\p{Lu}/u.test(first) || !IMPERATIVES.has(first.toLowerCase())) return false;
  const next = words[1];
  return !next.startsWith('`') && !COMMANDS.has(next.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase());
}

// findRules(folder) -> [{ words, source: { file, line } }]: every rule-like sentence in the
// project's CLAUDE.md, README, docs/ and another agent setup's instruction files, outside code
// blocks, and in the README and docs outside sections of steps (installing, setting up, running),
// with its file (from the folder, with forward
// slashes) and line. A sentence holding what looks like a secret is left out, any sign-in in an
// address is hidden, as a card shows it, and a rule found twice in the same words is listed once,
// where it was found first.
export function findRules(folder) {
  const out = [];
  const seen = new Set();
  for (const { file, own } of ruleFiles(folder)) {
    const text = readStart(file, FILE_BYTES);
    if (text === null) continue;
    let fence = null;
    let front = false;
    let steps = false;
    text.split(/\r\n|\n|\r/).forEach((raw, i) => {
      const trimmed = raw.trim();
      if (i === 0 && trimmed === '---') front = true;
      else if (front) {
        if (trimmed === '---') front = false;
        return;
      }
      const marker = /^(```|~~~)/.exec(trimmed);
      if (marker) {
        fence = fence === null ? marker[1] : (fence === marker[1] ? null : fence);
        return;
      }
      if (fence !== null) return;
      if (/^#{1,6}\s/.test(trimmed)) steps = !own && STEPS_HEADING.test(trimmed);
      if (steps) return;
      const line = prose(raw);
      if (line === null) return;
      for (const sentence of sentences(line).filter(ruleLike)) {
        if (scanContent(sentence).length > 0) continue;
        const words = hide(sentence, []);
        const key = words.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ words, source: { file: relative(folder, file), line: i + 1 } });
      }
    });
  }
  return out;
}

// Whether a transcript's working folder is the project's folder or inside it, by the paths as
// written and then, where they can be had, by real paths.
function inFolder(cwd, folder, realFolder) {
  if (typeof cwd !== 'string' || cwd === '') return false;
  const within = (base, target) => {
    const b = keyOf(base);
    const t = keyOf(target);
    return t === b || t.startsWith(b.endsWith(path.sep) ? b : b + path.sep);
  };
  return within(folder, cwd) || (realFolder !== null && within(realFolder, cwd));
}

// The text the director typed in one transcript entry, or null: a user's own message, not a tool's
// result, a command's output or a message from Claude Code itself.
function typedIn(entry) {
  if (entry?.type !== 'user' || entry.isMeta === true || entry.isSidechain === true || entry.message?.role !== 'user') return null;
  const content = entry.message.content;
  let text = null;
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content) && content.every((c) => c?.type === 'text' && typeof c.text === 'string')) text = content.map((c) => c.text).join('\n');
  if (text === null || text.trim() === '' || text.trimStart().startsWith('<')) return null;
  return text;
}

// Whether an entry was written before `before` (an ISO time): by its own timestamp, or, where it
// has none, by its file's time.
function earlier(entry, before, fileAt) {
  if (before === undefined) return true;
  const limit = Date.parse(before);
  const at = Date.parse(entry?.timestamp);
  return Number.isFinite(at) ? at < limit : fileAt < limit;
}

// folderEntries(folder, { userHome, env }) -> the entries of the director's past Claude Code
// sessions in this folder, as { entry, fileAt }, newest session first: from
// ~/.claude/projects/*/*.jsonl (under CLAUDE_CONFIG_DIR when it is set), each entry matched by its
// `cwd` field (the folder or a folder inside it), never by the folder's name; `fileAt` is its
// file's time. Each transcript's first PROBE_BYTES tell whether its session was in the folder; of
// those that were, at most TRANSCRIPT_BYTES are read, from the newest back, and of each its first
// TRANSCRIPT_FILE_BYTES. A line that isn't an entry is passed over. Step 1 reads the session's
// first message from these (scripts/setup/install-step.js, ruling R76).
export function folderEntries(folder, {
  userHome, env = process.env, totalBytes = TRANSCRIPT_BYTES, fileBytes = TRANSCRIPT_FILE_BYTES,
} = {}) {
  const config = typeof env.CLAUDE_CONFIG_DIR === 'string' && env.CLAUDE_CONFIG_DIR !== '' ? env.CLAUDE_CONFIG_DIR : path.join(userHome, '.claude');
  const projects = path.join(config, 'projects');
  let realFolder = null;
  try {
    realFolder = fs.realpathSync.native(folder);
  } catch { /* the paths as written */ }
  const files = [];
  let dirs = [];
  try {
    dirs = fs.readdirSync(projects, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return [];
  }
  for (const d of dirs) {
    let names = [];
    try {
      names = fs.readdirSync(path.join(projects, d.name)).filter((n) => n.endsWith('.jsonl'));
    } catch { /* passed over */ }
    for (const name of names) {
      const file = path.join(projects, d.name, name);
      try {
        const stat = fs.lstatSync(file);
        if (stat.isFile()) files.push({ file, at: stat.mtimeMs, size: stat.size });
      } catch { /* passed over */ }
    }
  }
  files.sort((a, b) => b.at - a.at || (a.file < b.file ? -1 : 1));
  const entries = (text) => text.split('\n').flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
  const found = [];
  let left = totalBytes;
  for (const { file, at, size } of files.slice(0, PROBE_FILES)) {
    if (left <= 0) break;
    const probe = readStart(file, Math.min(size, PROBE_BYTES));
    if (probe === null || !entries(probe).some((e) => inFolder(e?.cwd, folder, realFolder))) continue;
    const take = Math.min(size, fileBytes, left);
    left -= take;
    const text = take <= PROBE_BYTES ? probe.slice(0, take) : readStart(file, take);
    if (text === null) continue;
    for (const entry of entries(text)) if (inFolder(entry?.cwd, folder, realFolder)) found.push({ entry, fileAt: at });
  }
  return found;
}

// readTranscripts(folder, { userHome, env, before }) -> the director's typed messages in their past
// Claude Code sessions in this folder, newest session first, read as folderEntries reads them, and
// with `before`, only those written before then (the setup run's own sessions are not past words,
// ruling R62).
export function readTranscripts(folder, { before, ...reading } = {}) {
  return folderEntries(folder, reading).flatMap(({ entry, fileAt }) => {
    if (!earlier(entry, before, fileAt)) return [];
    const said = typedIn(entry);
    return said === null ? [] : [said];
  });
}

// The words of a text, in lower case: runs of letters and digits.
const tokens = (text) => (String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);

// matchWords(rule, transcripts) -> { words, original }: the director's own words for a rule, from
// their typed messages (`transcripts`, as readTranscripts gives them), when one of their sentences
// holds every word of three letters or more in the rule's words, whatever the case, order or
// punctuation; the first such sentence, newest session first, that the secret scan finds nothing
// in. Otherwise the rule as found, which the card marks "paraphrase". `rule` is the rule's words,
// or { words }.
export function matchWords(rule, transcripts) {
  const found = typeof rule === 'string' ? rule : rule?.words;
  const asFound = { words: found, original: false };
  const need = [...new Set(tokens(found).filter((t) => t.length >= 3))];
  if (need.length < 3) return asFound;
  for (const message of Array.isArray(transcripts) ? transcripts : []) {
    if (typeof message !== 'string') continue;
    for (const part of message.split(/\r\n|\n|\r/)) {
      for (const sentence of sentences(part.trim())) {
        const own = sentence.replace(/\s+/g, ' ').trim();
        if (own === '' || own.length > RULE_CHARS) continue;
        const have = new Set(tokens(own));
        if (!need.every((t) => have.has(t))) continue;
        if (scanContent(own).length > 0) continue;
        return { words: hide(own, []), original: true };
      }
    }
  }
  return asFound;
}

// The rules of the project, each with the director's words where found: [{ words, source,
// original }], a rule whose words come out the same as an earlier one's listed once.
export function rulesOf(folder, { userHome, env, before } = {}) {
  const found = findRules(folder);
  if (found.length === 0) return [];
  const transcripts = readTranscripts(folder, { userHome, env, before });
  const seen = new Set();
  const out = [];
  for (const rule of found) {
    const { words, original } = matchWords(rule, transcripts);
    if (seen.has(words.toLowerCase())) continue;
    seen.add(words.toLowerCase());
    out.push({ words, source: rule.source, original });
  }
  return out;
}

// A rule that sends changes straight to the main line, which step 7's protection keeps off: a push,
// commit or merge straight or directly to main, master, trunk or the default branch, unless it says
// not to.
const STRAIGHT_TO_MAIN = /\b(?:push|commit|merge)\w*\s+(?:\w+\s+){0,2}?(?:straight|directly)\s+(?:in)?to\s+(?:the\s+)?(?:main|master|trunk|default branch)\b/i;
const SAYS_NOT_TO = /(?<![\p{L}\p{N}])(?:never|don['’]t|do not|avoid|no)(?![\p{L}\p{N}])/iu;
export const overriddenByProtection = (rule) => STRAIGHT_TO_MAIN.test(rule.words) && !SAYS_NOT_TO.test(rule.words);

// A rule's words as a quote, cut short past QUOTE_CHARS so the line stays within what setup says.
const QUOTE_CHARS = 120;
const quote = (words) => `"${words.length > QUOTE_CHARS ? `${words.slice(0, QUOTE_CHARS - 1).trimEnd()}…` : words}"`;

// What step 5 says of the rules found: how many, followed as they are, but for any protection keeps off.
export function rulesLine(rules) {
  if (rules.length === 0) return 'No rules found to follow.';
  const head = `Found ${rules.length} rules in the project; they're followed as they are`;
  const off = rules.filter(overriddenByProtection);
  if (off.length === 0) return `${head}.`;
  if (off.length === 1) return `${head}, except your rule ${quote(off[0].words)} where it pushes straight to the main line: that stays off, as changes go through Wheelhouse's checks.`;
  return `${head}, except ${off.length} rules that push straight to the main line (${off.map((r) => quote(r.words)).join('; ')}): those stay off, as changes go through Wheelhouse's checks.`;
}

export function rulesStep({ env = process.env } = {}) {
  return {
    n: 5,
    title: SETUP_TITLES[5],
    async plan(ctx) {
      if (connectedProject(ctx.folder) === null) return waitForProject(5);
      // The run's own sessions, after it began, are not the director's past words.
      const startedAt = readJournal().runs.find((r) => r?.id === ctx.runId)?.startedAt;
      const before = typeof startedAt === 'string' ? startedAt : (ctx.now?.() ?? new Date()).toISOString();
      const rules = rulesOf(ctx.folder, { userHome: ctx.userHome, env, before });
      ctx.say?.(rulesLine(rules));
      return { settled: { record: { rules: rules.length } } };
    },
    async apply() {
      return [];
    },
  };
}
