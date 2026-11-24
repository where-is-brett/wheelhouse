// scripts/lib/sign-in-gate.js
// The sign-in gate (builders and settings design, section 10.2). One fact file on this computer, `<home>/sign-in.json`, maps
// `<agent>:<route>` to what a start that couldn't sign in left: { kind, since, command, excerpt, starts }. While a route has
// a fact, the waker starts nothing on it, for any project, because one sign-in serves every project on the computer. The fact
// is cleared only by a passing check (part 4); this file writes, reads, classifies and words it.
//
// A file that can't be read is never "no fact": the gate stays shut and names the file, the line and the column.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { faultLine, readJsonNamed } from './read-json-named.js';
import { hide } from './clean.js';

export const KINDS = Object.freeze(['not-signed-in', 'blocked', 'no-program', 'other']);
export const EXCERPT_CHARS = 200;
// A sign-in failure is one short message at the start of a run. Output longer than this is a session that ran, and what it
// printed about logging in is its own work, not a refusal.
const SHORT_OUTPUT = 2000;
const NAME_CHARS = 60;

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

export const signInFile = (home) => path.join(home, 'sign-in.json');

// The words each kind is shown as, after "said it".
const KIND_WORDS = Object.freeze({
  'not-signed-in': 'not signed in',
  blocked: 'blocked',
  'no-program': "the program wasn't found",
  other: 'it failed',
});
export const kindWords = (kind) => KIND_WORDS[kind] ?? KIND_WORDS.other;

function validFact(fact) {
  return isPlain(fact) && KINDS.includes(fact.kind) && typeof fact.since === 'string' && !Number.isNaN(Date.parse(fact.since))
    && typeof fact.command === 'string' && typeof fact.excerpt === 'string' && Number.isInteger(fact.starts) && fact.starts >= 1;
}

// { ok: true, facts } | { ok: false, fault } where fault is { file, line, column, hint }. No file is no facts.
export function readSignIn(home) {
  const file = signInFile(home);
  const read = readJsonNamed(file);
  if (read.ok === false) return { ok: false, fault: { file, line: read.line, column: read.column, hint: read.hint } };
  if (read.missing === true) return { ok: true, facts: {} };
  const bad = (hint) => ({ ok: false, fault: { file, line: null, column: null, hint } });
  if (!isPlain(read.value)) return bad('the file must be written inside one pair of curly brackets `{ }`');
  for (const [route, fact] of Object.entries(read.value)) {
    if (!/^[a-z0-9-]+:[a-z0-9-]+$/.test(route)) return bad('a name in it is not an agent and a route, like "claude-code:background"');
    if (!validFact(fact)) return bad(`the entry for ${route} doesn't hold a kind, a time, a command, an excerpt and a count`);
  }
  return { ok: true, facts: read.value };
}

// Writes the whole map to a temporary name renamed over the file, so no reader sees half of it.
function writeFacts(home, facts) {
  const file = signInFile(home);
  fs.mkdirSync(home, { recursive: true });
  const temp = path.join(home, `.sign-in.${crypto.randomUUID().slice(0, 12)}.tmp`);
  try {
    fs.writeFileSync(temp, `${JSON.stringify(facts, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

// Records `fact` for `agentRoute`. A route with a fact already keeps its first time and counts the new start on it. A file
// that can't be read is not written over: it throws with the fault named.
export function writeSignInFact(home, agentRoute, fact) {
  const read = readSignIn(home);
  if (!read.ok) throw new Error(faultLine(read.fault));
  const before = read.facts[agentRoute];
  const next = { ...fact, ...(before ? { since: before.since, starts: before.starts + 1 } : {}) };
  if (!validFact(next)) throw new Error('This is not a sign-in fact');
  writeFacts(home, { ...read.facts, [agentRoute]: next });
  return next;
}

// Takes `agentRoute`'s fact away; nothing else. Says whether there was one.
export function clearSignInFact(home, agentRoute) {
  const read = readSignIn(home);
  if (!read.ok) throw new Error(faultLine(read.fault));
  if (!Object.hasOwn(read.facts, agentRoute)) return false;
  const { [agentRoute]: gone, ...rest } = read.facts;
  writeFacts(home, rest);
  return gone !== undefined;
}

// What a start refused by the gate says, as a start refused for a damaged settings file says its own.
export const GATE_LINE = "not started: builders can't sign in";

// { open: true } | { open: false, reason }. A fact shuts the route; so does a file that can't be read.
export function gateFor(home, agentRoute) {
  const read = readSignIn(home);
  if (!read.ok) return { open: false, reason: `${GATE_LINE}: ${faultLine(read.fault)}` };
  const fact = read.facts[agentRoute];
  if (fact === undefined) return { open: true };
  return { open: false, reason: `${GATE_LINE} (${kindWords(fact.kind)} since ${timeWords(fact.since)})` };
}

// `exit` is { code, signal, error }: the run's own end. no-program is the system's word (a program not found or not allowed
// to run, or a command line cmd.exe can't be given safely), never the output's. Otherwise the short output is read with the
// agent's `patterns` ({ notSignedIn, blocked }): a forbidden organisation or a policy is blocked, before the rest.
export function classify(output, exit, patterns) {
  const error = exit?.error;
  if (error) {
    const code = typeof error === 'string' ? error : error.code;
    const said = typeof error === 'string' ? error : String(error.message ?? '');
    if (code === 'ENOENT' || code === 'EACCES' || code === 'EPERM' || /Cannot pass this to a \.cmd program safely/.test(said)) return 'no-program';
  }
  const text = typeof output === 'string' ? output : '';
  if (text.length > SHORT_OUTPUT) return 'other';
  const any = (list) => Array.isArray(list) && list.some((re) => re instanceof RegExp && re.test(text));
  if (any(patterns?.blocked)) return 'blocked';
  if (any(patterns?.notSignedIn)) return 'not-signed-in';
  return 'other';
}

// Up to EXCERPT_CHARS of the output as one line: control characters and runs of space made one space, and an address's own
// sign-in hidden, as setup's journal lines are.
export function cleanExcerpt(output) {
  const one = hide(String(output ?? ''), []).replace(/[\u0000-\u001F\u007F-\u009F]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (one.length <= EXCERPT_CHARS) return one;
  let cut = one.slice(0, EXCERPT_CHARS - 1);
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

// The program's name only: the last part of its path, with no extension a Windows program has, cut to NAME_CHARS. `file` is
// one program (a path may hold spaces), never a command line, so no argument and no folder ever reaches a line.
export function commandName(file) {
  const base = String(file ?? '').trim().split(/[\\/]/).pop().replace(/\.(?:exe|cmd|bat)$/i, '').replace(/[^\w.+-]/g, '');
  return (base === '' ? 'claude' : base).slice(0, NAME_CHARS);
}

// "14:02", this computer's own clock.
export function timeWords(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'an unknown time';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// The First Mate's Builders line, stated from the recorded facts and nothing else (section 10.5):
//   Builders: background as `claude` · can't sign in since 14:02 (not signed in)
// A fact file that can't be read is said so, never left out. Part 5 extends this with the route.
export function buildersLine({ home, agent = 'claude-code', route = 'background', program = 'claude' } = {}) {
  const as = `${route} as \`${commandName(program)}\``;
  const read = readSignIn(home);
  if (!read.ok) return `Builders: ${as} · ${faultLine(read.fault)}`;
  const fact = read.facts[`${agent}:${route}`];
  if (fact === undefined) return `Builders: ${as}`;
  return `Builders: ${route} as \`${commandName(fact.command)}\` · can't sign in since ${timeWords(fact.since)} (${kindWords(fact.kind)})`;
}

// The same line for the board's status lines, with its level: `watch` while builders can't sign in or the file can't be read.
export function buildersHealth({ home, agent = 'claude-code', route = 'background', program = 'claude' } = {}) {
  const read = readSignIn(home);
  const calm = read.ok && read.facts[`${agent}:${route}`] === undefined;
  return { level: calm ? 'ok' : 'watch', text: buildersLine({ home, agent, route, program }) };
}
