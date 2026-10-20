// scripts/setup/rules.js
// Step 5, Rules found (design sections 9 and 15): the rules an existing project already follows,
// found in its CLAUDE.md, its README and its docs, each quoted with where it was found, matched
// back to the director's own words where their past sessions in this folder hold them, and shown
// on one card with Confirm all and Let me correct some (ruling R35).
//
// The card is a `confirm-all` ask: its line names how many rules it lists and the hash of that
// list, and the asked record keeps the list. Confirm all is recorded by the prompt record, which
// signs: one ruling per rule, each with its own confirmation, and the signed confirm-all action
// (scripts/lib/setup-writes.js). Let me correct some asks about each rule on the card in turn:
// Keep as found or typed words record that one ruling and its confirmation the same way; Leave it
// out records nothing. Once every rule is answered the step settles (ruling R32), with no Go ahead.
// A project with no rules found settles at once. Rules too many for one card's length go on as
// few cards as hold them, each with its own Confirm all.
//
// Every quote, from the project's files or from a transcript, goes through the secret scan before
// it is kept: a rule holding one is left out, and a transcript's words holding one are not used.
// The transcripts are read here, by the helper, outside the agents' sandbox, and never more than
// TRANSCRIPT_BYTES of them, since the plan is worked out each time setup resumes.
import fs from 'node:fs';
import path from 'node:path';
import { SETUP_TITLES, CONFIRM_ALL_LABEL, CORRECT_SOME_LABEL } from '../state/card-lines.js';
import { scanContent } from '../state/secret-scan.js';
import { composeCard } from '../cards/compose.js';
import { listHash, isRule } from '../lib/setup-writes.js';
import { hide } from '../lib/clean.js';
import { readJournal } from './journal.js';
import { askedIn } from './clicks.js';
import {
  connectedProject, waitForProject, readmeOf, readStart, isFile, MEANWHILE,
} from './questions.js';

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

// The answers to a question about one rule (Let me correct some).
export const RULE_LABELS = Object.freeze({ keep: 'Keep as found', leave: 'Leave it out' });

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

// The files rules are looked for in, in order: CLAUDE.md, the README, then docs/.
function ruleFiles(folder) {
  const claude = ['CLAUDE.md', path.join('.claude', 'CLAUDE.md')].map((f) => path.join(folder, f)).filter(isFile);
  const readme = readmeOf(folder);
  return [...claude, ...(readme ? [readme] : []), ...docsOf(folder)];
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
// project's CLAUDE.md, README and docs/, outside code blocks, and in the README and docs outside
// sections of steps (installing, setting up, running), with its file (from the folder, with forward
// slashes) and line. A sentence holding what looks like a secret is left out, any sign-in in an
// address is hidden, as a card shows it, and a rule found twice in the same words is listed once,
// where it was found first.
export function findRules(folder) {
  const out = [];
  const seen = new Set();
  for (const file of ruleFiles(folder)) {
    const text = readStart(file, FILE_BYTES);
    if (text === null) continue;
    const claude = path.basename(file) === 'CLAUDE.md';
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
      if (/^#{1,6}\s/.test(trimmed)) steps = !claude && STEPS_HEADING.test(trimmed);
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

const said = (rule) => `"${rule.words}" (${rule.source.file} line ${rule.source.line}, ${rule.original ? 'your words' : 'paraphrase'})`;

// The input of the card of the rules found for one group of rules, without its kind's target,
// which the engine gives (ruling R35). `more` says more cards follow.
export function rulesCard(name, rules, { more = false } = {}) {
  const n = rules.length;
  const listed = rules.map((r, i) => `${i + 1}) ${said(r)}`).join('; ');
  return {
    kind: 'confirm-all',
    level: 3,
    what: `Setup step 5 found ${n} ${n === 1 ? 'rule' : 'rules'} ${name} already follows: ${listed}.${more ? ' More follow on the next card.' : ''}`,
    why: 'They are in force already; confirmed, they become your rulings. Paraphrase: not found in your own messages.',
    options: [
      { label: CONFIRM_ALL_LABEL, says: 'Each goes into the rulebook as shown.' },
      { label: CORRECT_SOME_LABEL, says: 'Keep, reword or leave out each in turn.' },
      { label: 'Not now', says: 'Nothing is recorded yet.' },
      { label: 'Explain more', says: 'I explain it more plainly.' },
    ],
    recommend: CONFIRM_ALL_LABEL,
    because: 'the project already follows them',
    meanwhile: 'Setup waits; nothing is recorded yet.',
  };
}

// Whether a card of these rules can be composed.
function fits(name, rules, more) {
  try {
    composeCard({ ...rulesCard(name, rules, { more }), target: { count: rules.length, hash: listHash(rules) } });
    return true;
  } catch {
    return false;
  }
}

// The rules in groups, each as many, in order, as one card holds. A rule that no card can carry
// alone (its words read as a card's own line) is left out.
export function cardsOf(name, rules) {
  const groups = [];
  let group = [];
  for (const [i, rule] of rules.entries()) {
    const last = i === rules.length - 1;
    if (fits(name, [...group, rule], !last)) {
      group.push(rule);
      continue;
    }
    if (group.length > 0) groups.push(group);
    group = fits(name, [rule], !last) ? [rule] : [];
  }
  if (group.length > 0) groups.push(group);
  return groups;
}

// The question about one rule, when the director chose to correct some.
function ruleAsk(id, name, rule) {
  return {
    id,
    typed: true,
    card: {
      level: 3,
      what: `Setup step 5: keep this rule ${name} follows as found, type its words as they should be, or leave it out. Found in ${rule.source.file} line ${rule.source.line}, ${rule.original ? 'in your words' : 'paraphrase'}: "${rule.words}"`,
      why: 'A rule you keep or correct goes into the rulebook as your ruling, confirmed, in the words you choose.',
      options: [
        { label: RULE_LABELS.keep, says: 'It goes into the rulebook, confirmed, in the words shown.' },
        { label: RULE_LABELS.leave, says: 'It is not recorded as a rule.' },
      ],
      recommend: RULE_LABELS.keep,
      because: 'the project already follows it',
      meanwhile: MEANWHILE,
    },
    writes: {
      labels: { [RULE_LABELS.keep]: [{ kind: 'ruling', data: rule }] },
      typed: [{ kind: 'ruling', data: { source: rule.source, original: true }, typedInto: 'words' }],
    },
  };
}

// A rule's question id, and a group's card's: each carries its words' hash, so changed words are
// asked about again (ruling R51).
const groupId = (group) => `rules-${listHash(group).slice(0, 10)}`;
const ruleId = (rule) => `rule-${listHash([rule]).slice(0, 10)}`;

export function rulesStep({ env = process.env } = {}) {
  return {
    n: 5,
    title: SETUP_TITLES[5],
    async plan(ctx) {
      const project = connectedProject(ctx.folder);
      if (project === null) return waitForProject(5);
      const answers = ctx.answers ?? {};
      // The rules are found once a run (ruling R62): once a card of them has been asked, the list
      // kept with it is the list, whatever the files and transcripts say since, so nothing confirmed
      // is asked again. The run's own sessions, after it began, are not the director's past words.
      const kept = askedIn(ctx.runId, 5).map((r) => r.found).find((f) => Array.isArray(f) && f.length > 0 && f.every(isRule));
      const startedAt = readJournal().runs.find((r) => r?.id === ctx.runId)?.startedAt;
      const before = typeof startedAt === 'string' ? startedAt : (ctx.now?.() ?? new Date()).toISOString();
      const rules = kept ?? rulesOf(ctx.folder, { userHome: ctx.userHome, env, before });
      const groups = rules.length === 0 ? [] : cardsOf(project.name, rules);
      // Only the rules a card can show are counted: one no card can carry is never asked about.
      const tally = { rules: groups.flat().length, confirmed: 0, kept: 0, corrected: 0, left: 0 };
      for (const group of groups) {
        const id = groupId(group);
        const got = answers[`5.${id}`];
        if (!got) {
          const more = group !== groups.at(-1);
          return { ask: { id, card: rulesCard(project.name, group, { more }), rules: group, found: rules } };
        }
        if (got.label === CONFIRM_ALL_LABEL) {
          tally.confirmed += group.length;
          continue;
        }
        for (const rule of group) {
          const one = answers[`5.${ruleId(rule)}`];
          if (!one) return { ask: { ...ruleAsk(ruleId(rule), project.name, rule), found: rules } };
          if (typeof one.text === 'string') tally.corrected += 1;
          else if (one.label === RULE_LABELS.keep) tally.kept += 1;
          else tally.left += 1;
        }
      }
      return { settled: { record: tally } };
    },
    async apply() {
      return [];
    },
  };
}
